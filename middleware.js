/*
 * Vercel Routing Middleware: password-protects everything under /preview/.
 *
 * The /preview/* pages are private copies of ashleylim.com pages that include
 * the elements hidden on the live site. They must never be public or indexed.
 *
 * Set in Vercel → Project → Settings → Environment Variables (all environments):
 *   PREVIEW_USER       username for the login page
 *   PREVIEW_PASSWORD   password (never commit it)
 * If either is missing, /preview/* is refused for everyone (fails closed).
 *
 * Login is a small form (not the browser's Basic Auth pop-up, whose header can be
 * lost behind Vercel's own deployment protection). A correct login sets an
 * HttpOnly cookie for /preview, valid 30 days. Changing the password logs everyone out.
 * Basic Auth headers are still accepted (handy for curl).
 */
export const config = { matcher: ['/preview', '/preview/:path*'] };

const COOKIE = 'hal_preview';
const MAX_AGE = 60 * 60 * 24 * 30;
const ROBOTS = { 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cache-Control': 'no-store' };

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function credentialsMatch(u, p, user, pass) {
  u = String(u || '').trim().normalize('NFC').toLowerCase();
  p = String(p || '').normalize('NFC');
  return safeEqual(u, user.toLowerCase()) && (safeEqual(p, pass) || safeEqual(p.trim(), pass));
}

// Cookie value = HMAC-SHA256(password, username): proves a past login without storing the password.
async function sessionToken(user, pass) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode('hal-preview:' + user.toLowerCase()));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function readCookie(request, name) {
  const m = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : '';
}

// Browsers differ in how they encode non-ASCII Basic credentials (UTF-8 vs Latin-1): try both.
function basicCandidates(request) {
  const header = request.headers.get('authorization') || '';
  if (!/^Basic\s+/i.test(header)) return [];
  try {
    const bin = atob(header.replace(/^Basic\s+/i, '').trim());
    return [new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))), bin].map((d) => {
      const i = d.indexOf(':');
      return i < 0 ? null : [d.slice(0, i), d.slice(i + 1)];
    }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function safeNext(value) {
  const v = String(value || '');
  return /^\/preview(\/[^\s\\]*)?$/.test(v) && !v.startsWith('//') ? v : '/preview/nsmb';
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage(next, error, status = 401) {
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive"><title>비공개 미리보기 · 로그인</title>
<link rel="stylesheet" href="/assets/css/fonts.css"><link rel="stylesheet" href="/assets/css/brand.css">
<style>
main{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px var(--gutter)}
form{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-xl);padding:36px 28px;display:flex;flex-direction:column;gap:16px}
h1{font-size:24px;margin-bottom:4px}
label{display:flex;flex-direction:column;gap:6px;font-size:14px;font-weight:600;color:var(--ink-2)}
input{font:400 16px/1.4 var(--font-body);padding:12px 14px;border:1px solid var(--line);border-radius:var(--r-sm);background:var(--bg)}
input:focus-visible{outline:3px solid var(--accent);outline-offset:1px}
.err{color:var(--accent);font-size:14px;font-weight:600}
.btn{margin-top:8px}
</style></head><body><main>
<form method="post" action="/preview/login">
<h1>비공개 미리보기</h1>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<input type="hidden" name="next" value="${esc(next)}">
<label>아이디<input name="username" autocomplete="username" autocapitalize="none" required></label>
<label>비밀번호<input name="password" type="password" autocomplete="current-password" required></label>
<button class="btn btn--block" type="submit">들어가기</button>
</form></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...ROBOTS } });
}

export default async function middleware(request) {
  // Trim: values pasted into Vercel often carry a trailing space or newline.
  const user = (process.env.PREVIEW_USER || '').trim().normalize('NFC');
  const pass = (process.env.PREVIEW_PASSWORD || '').trim().normalize('NFC');
  if (!user || !pass) {
    return new Response('Preview is not configured (PREVIEW_USER / PREVIEW_PASSWORD missing for this environment).', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...ROBOTS } });
  }

  const url = new URL(request.url);
  const token = await sessionToken(user, pass);

  if (url.pathname === '/preview/login') {
    if (request.method !== 'POST') return loginPage(safeNext(url.searchParams.get('next')), '', 200);
    let form;
    try { form = await request.formData(); } catch (_) { form = new FormData(); }
    const next = safeNext(form.get('next'));
    if (!credentialsMatch(form.get('username'), form.get('password'), user, pass)) {
      return loginPage(next, '아이디 또는 비밀번호가 맞지 않아요.');
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: next,
        'Set-Cookie': `${COOKIE}=${token}; Path=/preview; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
        ...ROBOTS,
      },
    });
  }

  if (safeEqual(readCookie(request, COOKIE), token)) return undefined; // logged in: serve the file
  if (basicCandidates(request).some(([u, p]) => credentialsMatch(u, p, user, pass))) return undefined;

  return loginPage(safeNext(url.pathname));
}
