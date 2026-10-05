/*
 * POST /api/waitlist — NSMB waitlist sign-up → ActiveCampaign.
 *
 * Every valid sign-up is:
 *   1. created/updated as a contact (email + first name),
 *   2. tagged AC_TAG (default "signup_waitlist_nsmb"),
 *   3. added to AC_LIST_NAME (default "Master Contact List").
 *
 * Double opt-in: ActiveCampaign only sends its confirmation email when the
 * subscription goes through one of its own forms. When AC_FORM_ACTION and
 * AC_FORM_ID are set, step 3 is done by submitting that form (configure the
 * form in ActiveCampaign to subscribe to Master Contact List with opt-in
 * confirmation ON). Without them, the contact is subscribed directly via the
 * API and no confirmation email is sent.
 *
 * Environment variables (Vercel → Project → Settings → Environment Variables):
 *   AC_API_URL      e.g. https://youraccount.api-us1.com   (Settings → Developer)
 *   AC_API_KEY      API key from the same page — never commit it
 *   AC_TAG          optional, default "signup_waitlist_nsmb"
 *   AC_LIST_NAME    optional, default "Master Contact List"
 *   AC_FORM_ACTION  optional, e.g. https://youraccount.activehosted.com/proc.php
 *   AC_FORM_ID      optional, the form's numeric id, the embed's `f` value (enables double opt-in)
 *   AC_FORM_U       the embed's hidden `u` value (a hash, not secret)
 *   AC_FORM_OR      the embed's hidden `or` value (a hash, not secret)
 *
 * Spam protection: server-side validation, a hidden honeypot field ("website"),
 * a minimum fill time, and a per-IP rate limit (best effort, per instance).
 */

const TAG = process.env.AC_TAG || 'signup_waitlist_nsmb';
const LIST_NAME = process.env.AC_LIST_NAME || 'Master Contact List';
const MIN_FILL_MS = 3000;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };

const hits = new Map(); // ip -> [timestamps]
let tagIdCache = null;
let listIdCache = null;

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE_LIMIT.max;
}

async function ac(path, options = {}) {
  const res = await fetch(process.env.AC_API_URL.replace(/\/$/, '') + '/api/3' + path, {
    ...options,
    headers: { 'Api-Token': process.env.AC_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, body };
}

async function getTagId() {
  if (tagIdCache) return tagIdCache;
  const found = await ac('/tags?search=' + encodeURIComponent(TAG));
  const match = (found.body.tags || []).find((t) => t.tag === TAG);
  if (match) return (tagIdCache = match.id);
  const created = await ac('/tags', { method: 'POST', body: JSON.stringify({ tag: { tag: TAG, tagType: 'contact', description: 'NSMB waitlist sign-up (hal-website /nsmb)' } }) });
  if (!created.ok) throw new Error('tag create failed: ' + created.status);
  return (tagIdCache = created.body.tag.id);
}

async function getListId() {
  if (listIdCache) return listIdCache;
  const found = await ac('/lists?limit=100&filters[name]=' + encodeURIComponent(LIST_NAME));
  const match = (found.body.lists || []).find((l) => l.name === LIST_NAME);
  if (!match) throw new Error('list not found: ' + LIST_NAME);
  return (listIdCache = match.id);
}

async function subscribeViaForm(email, name) {
  // Same hidden fields the ActiveCampaign embed sends (u and or are form hashes from the embed code).
  // The name goes in both firstname and fullname, so it works whichever name field the form uses.
  const form = new URLSearchParams({ u: process.env.AC_FORM_U || process.env.AC_FORM_ID, f: process.env.AC_FORM_ID, s: '', c: '0', m: '0', act: 'sub', v: '2', or: process.env.AC_FORM_OR || '', firstname: name, fullname: name, email });
  const res = await fetch(process.env.AC_FORM_ACTION, { method: 'POST', body: form, redirect: 'manual' });
  if (res.status >= 400) throw new Error('form submit failed: ' + res.status);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.AC_API_URL || !process.env.AC_API_KEY) {
    console.error('waitlist: AC_API_URL / AC_API_KEY not set');
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 100);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 254);
  const consent = b.consent === true || b.consent === 'on' || b.consent === 'true';
  const startedAt = Number(b.t) || 0;
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  // Bots: pretend success so they don't retry, but store nothing.
  if (b.website) return res.status(200).json({ ok: true, confirm: false });
  if (startedAt && Date.now() - startedAt < MIN_FILL_MS) return res.status(200).json({ ok: true, confirm: false });
  if (rateLimited(ip)) return res.status(429).json({ ok: false, error: 'rate_limited' });

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !consent) {
    return res.status(400).json({ ok: false, error: 'invalid' });
  }

  try {
    const synced = await ac('/contact/sync', { method: 'POST', body: JSON.stringify({ contact: { email, firstName: name } }) });
    if (!synced.ok) throw new Error('contact sync failed: ' + synced.status);
    const contactId = synced.body.contact.id;

    const tagId = await getTagId();
    const tagged = await ac('/contactTags', { method: 'POST', body: JSON.stringify({ contactTag: { contact: contactId, tag: tagId } }) });
    if (!tagged.ok && tagged.status !== 422) throw new Error('tagging failed: ' + tagged.status);

    const doubleOptIn = Boolean(process.env.AC_FORM_ACTION && process.env.AC_FORM_ID);
    if (doubleOptIn) {
      await subscribeViaForm(email, name);
    } else {
      const listId = await getListId();
      const listed = await ac('/contactLists', { method: 'POST', body: JSON.stringify({ contactList: { list: listId, contact: contactId, status: 1 } }) });
      if (!listed.ok && listed.status !== 422) throw new Error('list subscribe failed: ' + listed.status);
    }

    return res.status(200).json({ ok: true, confirm: doubleOptIn });
  } catch (err) {
    console.error('waitlist:', err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
