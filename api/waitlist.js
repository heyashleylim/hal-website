/*
 * /api/waitlist — NSMB waitlist v2 → ActiveCampaign (logic in api/_lib/waitlist.js).
 *
 *   POST /api/waitlist                  step 1 of the form: { name, email, consent, source, website, t }
 *                                       → contact + link code + tags signup_waitlist_nsmb, nsmb_wl_incomplete + double opt-in
 *                                       ← { ok, confirm, code }   (the browser keeps `code` for the questions)
 *   POST /api/waitlist?action=lookup    { c } ← { ok, firstName }   (personal link: greet her, skip name/email)
 *   POST /api/waitlist?action=answers   { c, q1?, q2?, q3?, source? } — sent after each question; Q3 completes it
 *                                       (%WL_COMPLETED%, tag nsmb_wl_12, removes nsmb_wl_incomplete)
 *   POST /api/waitlist?action=manychat  header X-Waitlist-Key: WAITLIST_MANYCHAT_KEY
 *                                       { name, email, consent, q1, q2, q3, instagram? } — sign-up and answers at once
 *                                       ← { ok, confirm, code }
 *
 * Environment variables (Vercel → Project → Settings → Environment Variables), see .env.example:
 *   AC_API_URL, AC_API_KEY, AC_TAG, AC_LIST_NAME, AC_FORM_ACTION, AC_FORM_ID, AC_FORM_U, AC_FORM_OR (as before)
 *   WAITLIST_SECRET          random, 32+ characters: signs the personal link codes. Changing it breaks every link sent.
 *   WAITLIST_MANYCHAT_KEY    random, 24+ characters: ManyChat sends it in the X-Waitlist-Key header.
 *
 * Location: ActiveCampaign geolocates a contact from the IP that submits the form, which is this function
 * (pinned to Seoul, icn1), so contacts show Seoul.
 *
 * Spam protection on the website routes: validation, a hidden honeypot field ("website"), a minimum fill time,
 * and a per-IP rate limit (best effort, per instance). Personal codes are signed, so they can't be guessed.
 */

const crypto = require('node:crypto');
const wl = require('./_lib/waitlist.js');
const ac = require('./_lib/ac.js');

const MIN_FILL_MS = 3000;
const LIMITS = { signup: 5, lookup: 30, answers: 40 }; // per IP per 10 minutes
const WINDOW_MS = 10 * 60 * 1000;
const hits = new Map(); // `${action}:${ip}` -> [timestamps]

function rateLimited(action, ip) {
  const key = action + ':' + ip;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  return recent.length > (LIMITS[action] || 10);
}

function sameSecret(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected || ''));
  return b.length >= 24 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

async function handleSignup(req, res, b, ip) {
  // Bots: pretend success so they don't retry, but store nothing.
  if (b.website) return res.status(200).json({ ok: true, confirm: false });
  const startedAt = Number(b.t) || 0;
  if (startedAt && Date.now() - startedAt < MIN_FILL_MS) return res.status(200).json({ ok: true, confirm: false });
  if (rateLimited('signup', ip)) return res.status(429).json({ ok: false, error: 'rate_limited' });

  const s = wl.cleanSignup(b);
  if (!wl.signupValid(s)) return res.status(400).json({ ok: false, error: 'invalid' });
  const { code, confirm } = await wl.signup({ ...s, source: wl.cleanSource(b.source) });
  return res.status(200).json({ ok: true, confirm, code });
}

async function handleLookup(req, res, b, ip) {
  if (rateLimited('lookup', ip)) return res.status(429).json({ ok: false, error: 'rate_limited' });
  const id = wl.contactIdFromCode(b.c);
  const contact = id && (await ac.getContact(id));
  if (!contact) return res.status(404).json({ ok: false, error: 'unknown_code' });
  return res.status(200).json({ ok: true, firstName: contact.firstName }); // never the email
}

async function handleAnswers(req, res, b, ip) {
  if (rateLimited('answers', ip)) return res.status(429).json({ ok: false, error: 'rate_limited' });
  const id = wl.contactIdFromCode(b.c);
  if (!id) return res.status(404).json({ ok: false, error: 'unknown_code' });
  const answers = wl.cleanAnswers(b);
  if (!Object.keys(answers).length) return res.status(400).json({ ok: false, error: 'invalid' });
  const source = b.source ? wl.cleanSource(b.source) : undefined;
  const { complete } = await wl.saveAnswers(id, answers, { source });
  return res.status(200).json({ ok: true, complete });
}

async function handleManyChat(req, res, b) {
  if (!sameSecret(req.headers['x-waitlist-key'], process.env.WAITLIST_MANYCHAT_KEY)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const s = wl.cleanSignup(b);
  if (!s.name) s.name = String(b.first_name || b.instagram || '').trim().slice(0, 100);
  if (!wl.signupValid(s)) return res.status(400).json({ ok: false, error: 'invalid' });
  const { contactId, code, confirm } = await wl.signup({ ...s, source: 'manychat' });
  const answers = wl.cleanAnswers(b);
  if (Object.keys(answers).length) await wl.saveAnswers(contactId, answers, { complete: Boolean(answers.q1 && answers.q2 && answers.q3) });
  return res.status(200).json({ ok: true, confirm, code });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!process.env.AC_API_URL || !process.env.AC_API_KEY || !process.env.WAITLIST_SECRET) {
    console.error('waitlist: AC_API_URL / AC_API_KEY / WAITLIST_SECRET not set');
    return res.status(500).json({ ok: false, error: 'not_configured' });
  }

  const action = String((req.query && req.query.action) || '');
  const b = body(req);
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (action === '') return await handleSignup(req, res, b, ip);
    if (action === 'lookup') return await handleLookup(req, res, b, ip);
    if (action === 'answers') return await handleAnswers(req, res, b, ip);
    if (action === 'manychat') return await handleManyChat(req, res, b);
    return res.status(404).json({ ok: false, error: 'unknown_action' });
  } catch (err) {
    console.error('waitlist:', action || 'signup', err.message);
    return res.status(502).json({ ok: false, error: 'upstream' });
  }
};
