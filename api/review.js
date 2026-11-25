/*
 * /api/review: the review form pages (e.g. /lifeartist/review) → the Students section of the admin.
 *
 *   POST /api/review   { form: 'lifeartist-2026', name, email, consent, share, answers: { <question key>: text }, website, t }
 *                      ← { ok: true }  |  { ok: false, error: 'invalid', fields: [...] }  |  429 rate_limited
 *                      Without JavaScript the page posts a normal form (q_<question key> fields): the answer is then a
 *                      redirect to /lifeartist/review/thanks, or a short page saying what's missing.
 *   share = she agrees that her review may be introduced with her name hidden: sets the student's "may her words be
 *           used publicly?" to yes, unless the admin already chose something.
 *
 * Saved by api/_lib/students/reviews.js: her enrolment (program + cohort + email), one text per answer (a second
 * review from her keeps the first as an earlier version), and links to her ActiveCampaign contact and her other
 * enrolments. Nothing is sent to ActiveCampaign.
 *
 * Spam protection: same-site requests only, a hidden honeypot field ("website"), a minimum fill time, and 10 reviews
 * per network per hour (review_requests keeps a keyed hash of the address, never the address itself).
 */
const crypto = require('node:crypto');
const db = require('./_lib/db.js');
const reviews = require('./_lib/students/reviews.js');
const { FORMS } = require('./_lib/students/forms.js');

const MIN_FILL_MS = 5000;
const PER_HOUR = 10;

function ipHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const key = (process.env.PODCAST_SECRET || process.env.SHOP_SECRET || 'review-requests').trim();
  return crypto.createHmac('sha256', key).update(`review:${ip}`).digest('hex');
}

function sameSite(req) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return !origin;
  try { return new URL(origin).host === String(req.headers['x-forwarded-host'] || req.headers.host || ''); } catch { return false; }
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

const MAX_BODY = 512 * 1024;
async function body(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let text = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : null;
  if (text == null) {
    // not parsed by the platform (the local dev server): read the stream
    const chunks = [];
    let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) return {}; chunks.push(chunk); }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (/application\/x-www-form-urlencoded/.test(String(req.headers['content-type'] || ''))) return Object.fromEntries(new URLSearchParams(text));
  try { return JSON.parse(text); } catch { return {}; }
}

// A plain form post (no JavaScript): q_<key> fields → answers.
function fromPlainForm(b) {
  if (b.answers) return b;
  const answers = {};
  for (const [k, v] of Object.entries(b)) if (k.startsWith('q_')) answers[k.slice(2)] = v;
  return { ...b, answers, plain: true };
}

function plainReply(res, ok, fields) {
  if (ok) { res.statusCode = 303; res.setHeader('Location', '/lifeartist/review/thanks'); return res.end(); }
  res.statusCode = 400;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">' +
    '<title>후기</title><body style="font-family:sans-serif;max-width:36em;margin:3em auto;padding:0 1em;line-height:1.6">' +
    '<p>' + (fields && fields.length ? '빠진 항목이 있어요. 이름, 이메일, 동의와 필수 질문을 모두 적어 주세요.' : '보내지 못했어요. 잠시 후 다시 시도해 주세요.') + '</p>' +
    '<p><a href="javascript:history.back()">← 돌아가서 고치기</a></p></body>');
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, error: 'method_not_allowed' });
  }
  if (!sameSite(req)) return send(res, 403, { ok: false, error: 'bad_origin' });
  if (!db.separateFromProduction()) return send(res, 503, { ok: false, error: 'not_configured' });
  const b = fromPlainForm(await body(req));
  const reply = (status, data) => (b.plain ? plainReply(res, data.ok, data.fields) : send(res, status, data));
  if (!FORMS[b.form]) return reply(400, { ok: false, error: 'unknown_form' });
  // Bots: pretend success so they don't retry, but store nothing.
  if (b.website) return reply(200, { ok: true });
  const startedAt = Number(b.t) || 0;
  if (startedAt && Date.now() - startedAt < MIN_FILL_MS) return reply(200, { ok: true });
  if (!b.consent) return reply(400, { ok: false, error: 'invalid', fields: ['consent'] });

  try {
    const hash = ipHash(req);
    const recent = await db.one(`SELECT count(*)::int AS n FROM review_requests WHERE ip_hash = $1 AND at > now() - interval '1 hour'`, [hash]);
    if (recent.n >= PER_HOUR) return reply(429, { ok: false, error: 'rate_limited' });
    await db.query(`INSERT INTO review_requests (ip_hash, form) VALUES ($1, $2)`, [hash, b.form]);
    await db.query(`DELETE FROM review_requests WHERE at < now() - interval '2 days'`);
    await reviews.save({ form: b.form, name: b.name, email: b.email, answers: b.answers, share: Boolean(b.share), strict: true });
    return reply(200, { ok: true });
  } catch (err) {
    if (err.problems) return reply(400, { ok: false, error: 'invalid', fields: err.problems });
    console.error('review:', err.message);
    return reply(500, { ok: false, error: 'server' });
  }
};
