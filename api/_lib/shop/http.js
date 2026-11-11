/*
 * Small HTTP helpers for the shop endpoints (plain Vercel Node functions, also run by tools/shop/dev-server.js).
 */
const MAX_BODY = 64 * 1024;

// The request body, however the platform hands it over: → { text, data }.
// `data` is the parsed object (JSON or form fields); `text` the body as received, when we still have it.
async function readBody(req) {
  const type = String(req.headers['content-type'] || '');
  let text = null;
  let parsed;
  // On Vercel `req.body` is already parsed (and reading it throws when the body is broken JSON).
  try { parsed = req.body; } catch (_) { return { text: null, data: {} }; }
  if (parsed !== undefined && parsed !== null) {
    if (Buffer.isBuffer(parsed)) text = parsed.toString('utf8');
    else if (typeof parsed === 'string') text = parsed;
    else if (typeof parsed === 'object') return { text: null, data: Array.isArray(parsed) ? {} : parsed };
  }
  if (text === null) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
      chunks.push(chunk);
    }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (text.length > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 });
  return { text, data: parse(text, type) };
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
  return Object.fromEntries(new URLSearchParams(text));
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

module.exports = { readBody, parse, sendJson, sendHtml, redirect, sameOrigin, MAX_BODY };
