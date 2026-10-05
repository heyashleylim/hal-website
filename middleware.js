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

export default function middleware(request) {
  const user = process.env.PREVIEW_USER;
  const pass = process.env.PREVIEW_PASSWORD;
  if (!user || !pass) {
    return new Response('Preview is not configured.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...ROBOTS } });
  }

  const header = request.headers.get('authorization') || '';
  if (!header.startsWith('Basic ')) return unauthorized('Login required.');

  let decoded = '';
  try {
    decoded = new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (c) => c.charCodeAt(0)));
  } catch (_) {
    return unauthorized('Login required.');
  }
  const sep = decoded.indexOf(':');
  const u = decoded.slice(0, sep), p = decoded.slice(sep + 1);
  if (sep < 0 || !safeEqual(u, user) || !safeEqual(p, pass)) return unauthorized('Wrong username or password.');

  // Authorised: continue to the static file (returning nothing lets the request through).
  return undefined;
}
