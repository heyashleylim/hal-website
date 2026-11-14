/*
 * NSMB waitlist v2: sign-up, personal link codes and the three questions → ActiveCampaign.
 * Used by api/waitlist.js (the website form and ManyChat) and tools/waitlist/link-codes.js.
 *
 * Link code: "<contact id in base 36>-<16-character signature>". The signature is an HMAC of the contact id with
 * WAITLIST_SECRET, so the site can trust a code without looking it up and nobody can guess another person's code.
 * The code is also stored in the contact field %WL_LINK_CODE%, so AC emails can put it in a link
 * (https://www.ashleylim.com/waitlist?c=%WL_LINK_CODE%). Changing WAITLIST_SECRET invalidates every code.
 *
 * Scoring and the group (%WL_SCORE%, %WL_GROUP%) are done by hand in AC; the site never writes them.
 */

const crypto = require('node:crypto');
const ac = require('./ac.js');

const FIELDS = {
  q1: 'WL_Q1_THING_TO_CHANGE',
  q2: 'WL_Q2_WHAT_ALREADY_TRIED',
  q3: 'WL_Q3_COMMITTED_TO_WORK',
  source: 'WL_SOURCE',
  completed: 'WL_COMPLETED',
  code: 'WL_LINK_CODE',
};

const TAGS = {
  signup: process.env.AC_TAG || 'signup_waitlist_nsmb', // existing tag: every sign-up (website or ManyChat)
  incomplete: 'nsmb_wl_incomplete',                    // signed up, hasn't answered all three questions yet
  answered: 'nsmb_wl_12',                              // answered all three questions
};

// Q3's choices, in the order of the AC dropdown's options. The label is the fallback when AC lists no options.
const Q3 = {
  a: '네, 이번 12기에 시작하고 싶어요',
  b: '시작하고 싶지만 시기나 비용을 고민 중이에요',
  c: '아직은 소식만 받아보고 싶어요',
};

// Where an answer came from. The website sends one of these (?src=…); ManyChat is set by the server.
const SOURCES = ['nsmb-page', 'waitlist-page', 'reconfirm', 'ig-bio', 'manychat'];

const MAX_ANSWER = 3000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function secret() {
  const s = String(process.env.WAITLIST_SECRET || '').trim();
  if (s.length < 16) throw new Error('WAITLIST_SECRET not set (at least 16 characters)');
  return s;
}

function sign(contactId) {
  return crypto.createHmac('sha256', secret()).update('wl-link:' + String(contactId)).digest('base64url').slice(0, 16);
}

function linkCode(contactId) {
  const id = Number(contactId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('bad contact id: ' + contactId);
  return id.toString(36) + '-' + sign(id);
}

// The contact id a code belongs to, or null when the code is malformed or forged.
function contactIdFromCode(code) {
  const m = /^([0-9a-z]{1,12})-([A-Za-z0-9_-]{16})$/.exec(String(code || '').trim());
  if (!m) return null;
  const id = parseInt(m[1], 36);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const want = Buffer.from(sign(id));
  const got = Buffer.from(m[2]);
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? String(id) : null;
}

const truthy = (v) => v === true || ['on', 'true', 'yes', 'y', '1', '동의'].includes(String(v || '').trim().toLowerCase());

function cleanText(v) {
  return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, MAX_ANSWER);
}

function cleanSignup(b = {}) {
  return {
    name: String(b.name || '').trim().slice(0, 100),
    email: String(b.email || '').trim().toLowerCase().slice(0, 254),
    consent: truthy(b.consent),
  };
}

function signupValid({ name, email, consent }) {
  return Boolean(name && EMAIL_RE.test(email) && consent);
}

// Normalises Q3 to 'a' | 'b' | 'c' (accepts the letter, ⓐ/ⓑ/ⓒ, 1/2/3 or the full label). Null otherwise.
function cleanQ3(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  const map = { a: 'a', b: 'b', c: 'c', 'ⓐ': 'a', 'ⓑ': 'b', 'ⓒ': 'c', 1: 'a', 2: 'b', 3: 'c' };
  if (map[s.toLowerCase()]) return map[s.toLowerCase()];
  const byLabel = Object.keys(Q3).find((k) => Q3[k] === s);
  return byLabel || null;
}

function cleanSource(v, fallback = 'waitlist-page') {
  const s = String(v || '').trim().toLowerCase();
  return SOURCES.includes(s) ? s : fallback;
}

// Answers present in the body: { q1?, q2?, q3? } (only non-empty, valid ones).
function cleanAnswers(b = {}) {
  const out = {};
  const q1 = cleanText(b.q1);
  const q2 = cleanText(b.q2);
  const q3 = cleanQ3(b.q3);
  if (q1) out.q1 = q1;
  if (q2) out.q2 = q2;
  if (q3) out.q3 = q3;
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');

// The value to store in a dropdown field: the AC option matching `wanted`, else the option at `index`, else null.
function pickOption(options, { wanted, index } = {}) {
  if (wanted) {
    const w = norm(wanted);
    const exact = options.find((o) => norm(o.value) === w || norm(o.label) === w);
    if (exact) return exact.value;
    const partial = options.find((o) => (w && norm(o.value).includes(w)) || (w && norm(o.label).includes(w)));
    if (partial) return partial.value;
  }
  if (index != null && options[index]) return options[index].value;
  return null;
}

async function dropdownValue(perstag, { wanted, index, fallback }) {
  let options = [];
  try {
    options = await ac.fieldOptions(perstag);
  } catch (err) {
    console.warn(`waitlist: couldn't read the options of %${perstag}%:`, err.message);
  }
  if (!options.length) return fallback ?? null;
  const v = pickOption(options, { wanted, index });
  if (v == null) console.warn(`waitlist: no option of %${perstag}% matches "${wanted}"; left empty`);
  return v;
}

// "YYYY-MM-DD" in Seoul.
function todayKST(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/* ---------- flows (call ActiveCampaign) ---------- */

// Double opt-in: ActiveCampaign only sends its confirmation email when the subscription goes through one of its
// own forms (AC_FORM_* — form 4, "NSMB waitlist", opt-in confirmation ON, redirect to /nsmb/confirmed).
function doubleOptInConfigured() {
  return Boolean(process.env.AC_FORM_ACTION && process.env.AC_FORM_ID);
}

async function subscribeViaForm(email, name) {
  // Same hidden fields the ActiveCampaign embed sends (u and or are form hashes from the embed code).
  const form = new URLSearchParams({ u: process.env.AC_FORM_U || process.env.AC_FORM_ID, f: process.env.AC_FORM_ID, s: '', c: '0', m: '0', act: 'sub', v: '2', or: process.env.AC_FORM_OR || '', firstname: name, fullname: name, email });
  const res = await fetch(process.env.AC_FORM_ACTION, { method: 'POST', body: form, redirect: 'manual' });
  if (res.status >= 400) throw new Error('form submit failed: ' + res.status);
}

// Creates/updates the contact, gives it a link code, tags it and subscribes it (with double opt-in when configured).
// Returns { contactId, code, confirm }.
async function signup({ name, email, source }) {
  const contactId = await ac.syncContact({ email, firstName: name });
  const code = linkCode(contactId);
  const fields = { [FIELDS.code]: code };
  const src = await dropdownValue(FIELDS.source, { wanted: source, fallback: source });
  if (src) fields[FIELDS.source] = src;
  await ac.updateContactFields(contactId, fields);

  const description = 'NSMB waitlist (hal-website)';
  await ac.addTag(contactId, TAGS.signup, { description });
  await ac.addTag(contactId, TAGS.incomplete, { description });

  const confirm = doubleOptInConfigured();
  if (confirm) await subscribeViaForm(email, name);
  else await ac.subscribeToList(contactId, process.env.AC_LIST_NAME || 'Master Contact List');
  return { contactId, code, confirm };
}

// Saves whichever answers are given. When all three are in (Q3 is the last question), marks the contact complete.
async function saveAnswers(contactId, answers, { source, complete } = {}) {
  const fields = {};
  if (answers.q1) fields[FIELDS.q1] = answers.q1;
  if (answers.q2) fields[FIELDS.q2] = answers.q2;
  if (answers.q3) {
    const index = Object.keys(Q3).indexOf(answers.q3);
    fields[FIELDS.q3] = await dropdownValue(FIELDS.q3, { wanted: Q3[answers.q3], index, fallback: Q3[answers.q3] }) ?? Q3[answers.q3];
  }
  if (source) {
    const src = await dropdownValue(FIELDS.source, { wanted: source, fallback: source });
    if (src) fields[FIELDS.source] = src;
  }
  const done = complete ?? Boolean(answers.q3);
  if (done) fields[FIELDS.completed] = todayKST();
  await ac.updateContactFields(contactId, fields);

  if (done) {
    const description = 'NSMB waitlist (hal-website)';
    await ac.addTag(contactId, TAGS.answered, { description });
    await ac.removeTag(contactId, TAGS.incomplete);
  }
  return { complete: done };
}

module.exports = {
  FIELDS, TAGS, Q3, SOURCES,
  linkCode, contactIdFromCode, cleanSignup, signupValid, cleanAnswers, cleanQ3, cleanSource, cleanText, truthy,
  pickOption, todayKST, doubleOptInConfigured, signup, saveAnswers,
};
