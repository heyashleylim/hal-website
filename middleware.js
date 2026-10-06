/*
 * Vercel Routing Middleware: password-protects everything under /preview/.
 *
 * The /preview/* pages are private copies of ashleylim.com pages that include
 * the elements hidden on the live site. They must never be public or indexed.
 *
 * Set in Vercel → Project → Settings → Environment Variables (all environments):
 *   PREVIEW_USER       username for the browser login prompt
 *   PREVIEW_PASSWORD   password (never commit it)
 * If either is missing, /preview/* is refused for everyone (fails closed).
 */
export const config = { matcher: ['/preview', '/preview/:path*'] };

const ROBOTS = { 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cache-Control': 'no-store' };

function unauthorized(message) {
  return new Response(message, {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="HAL preview", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8', ...ROBOTS },
  });
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Browsers differ in how they encode non-ASCII credentials (Chrome/Firefox: UTF-8, Safari: Latin-1),
// so decode both ways and accept either.
function decodeBasic(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return [new TextDecoder().decode(bytes), bin];
}

function matches(decoded, user, pass) {
  const sep = decoded.indexOf(':');
  if (sep < 0) return false;
  const u = decoded.slice(0, sep).trim().normalize('NFC').toLowerCase();
  const p = decoded.slice(sep + 1).normalize('NFC');
  return safeEqual(u, user.toLowerCase()) && (safeEqual(p, pass) || safeEqual(p.trim(), pass));
}

export default function middleware(request) {
  // Trim: values pasted into Vercel often carry a trailing space or newline.
  const user = (process.env.PREVIEW_USER || '').trim().normalize('NFC');
  const pass = (process.env.PREVIEW_PASSWORD || '').trim().normalize('NFC');
  if (!user || !pass) {
    return new Response('Preview is not configured.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...ROBOTS } });
  }

  const header = request.headers.get('authorization') || '';
  if (!/^Basic\s+/i.test(header)) return unauthorized('Login required.');

  let candidates = [];
  try {
    candidates = decodeBasic(header.replace(/^Basic\s+/i, '').trim());
  } catch (_) {
    return unauthorized('Login required.');
  }
  if (!candidates.some((d) => matches(d, user, pass))) return unauthorized('Wrong username or password.');

  // Authorised: continue to the static file (returning nothing lets the request through).
  return undefined;
}
