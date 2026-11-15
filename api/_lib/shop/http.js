/*
 * Small HTTP helpers for the shop endpoints (plain Vercel Node functions, also run by tools/shop/dev-server.js).
 */
const MAX_BODY = 64 * 1024;

// The request body, however the platform hands it over: → { text, data }.
// `data` is the parsed object (JSON or form fields); `text` the body as received, when we still have it.
async function readBody(req) {
  const type = String(req.headers['content-type'] || '');
  // 1. The bytes as sent, when the stream can still be read. Read BEFORE touching `req.body`: on Vercel that
  //    getter parses the body, and PayPal's signature check needs the exact text, not a re-serialised copy.
  let text = null;
  if (typeof req[Symbol.asyncIterator] === 'function' && !req.readableEnded && !req.complete) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
      chunks.push(chunk);
    }
    if (size > 0) text = Buffer.concat(chunks).toString('utf8');
  }
  // 2. Otherwise what the platform already read (Vercel's `req.body`; reading it throws on broken JSON).
  if (text === null) {
    let parsed;
    try { parsed = req.body; } catch (_) { return { text: null, data: {} }; }
    if (Buffer.isBuffer(parsed)) text = parsed.toString('utf8');
    else if (typeof parsed === 'string') text = parsed;
    else if (parsed && typeof parsed === 'object') return { text: null, data: Array.isArray(parsed) ? {} : flat(parsed) };
    else text = '';
  }
  if (text.length > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
  return { text, data: parse(text, type) };
}

// A parsed body as plain fields: a repeated form key (an array) keeps its first value, never "a,b".
function flat(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = Array.isArray(v) ? v[0] : v;
  return out;
}

// JSON when the body says or looks like JSON, form fields otherwise. Always a plain object.
function parse(text, type = '') {
  const isJson = /json/i.test(type);
  if (isJson || /^\s*\{/.test(text)) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data === 'object' && !Array.isArray(data)) return data;
    } catch (_) { /* not JSON after all */ }
    if (isJson) return {};
  }
  return firstValues(new URLSearchParams(text));
}

// Form fields; a repeated key keeps its first value (the same rule as flat()).
function firstValues(params) {
  const out = {};
  for (const [k, v] of params) if (!(k in out)) out[k] = v;
  return out;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.end(html);
}

function redirect(res, status, location) {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

// A form or fetch from another site is refused. Browsers send Origin on every POST; when it is missing
// (non-browser clients) there is no cross-site page to protect against.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return !origin;
  try {
    return new URL(origin).host === String(req.headers['x-forwarded-host'] || req.headers.host || '');
  } catch (_) {
    return false;
  }
}

module.exports = { readBody, parse, flat, sendJson, sendHtml, redirect, sameOrigin, MAX_BODY };
