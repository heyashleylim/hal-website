/*
 * Vercel Routing Middleware: password-protects two private areas with a login page.
 *
 *   /preview/*  private copies of ashleylim.com pages that include the elements hidden on the live site.
 *               PREVIEW_USER / PREVIEW_PASSWORD, cookie hal_preview (Path=/preview, 30 days).
 *   /admin/*    the admin (every section: podcast, later e-commerce…). ADMIN_USER / ADMIN_PASSWORD, cookie hal_admin
 *               (Path=/, 14 days, so the admin API at /api/admin receives it too; that function
 *               checks the cookie itself, see api/_lib/auth.js, and is not routed through here).
 *
 * Set in Vercel → Project → Settings → Environment Variables (all environments). Never commit them.
 * If an area's variables are missing, it is refused for everyone (fails closed). They must never be
 * public or indexed.
 *
 * Login is a small form (not the browser's Basic Auth pop-up, whose header can be
 * lost behind Vercel's own deployment protection). Changing a password logs everyone out of that area.
 * Basic Auth headers are still accepted on /preview (handy for curl).
 */
export const config = { matcher: ['/preview', '/preview/:path*', '/admin', '/admin/:path*'] };

const AREAS = {
  preview: {
    prefix: '/preview', userVar: 'PREVIEW_USER', passVar: 'PREVIEW_PASSWORD', cookie: 'hal_preview', cookiePath: '/preview',
    maxAge: 60 * 60 * 24 * 30, scope: 'hal-preview:', home: '/preview/nsmb', title: '비공개 미리보기', basic: true,
    lang: 'ko', text: { login: '로그인', user: '아이디', pass: '비밀번호', submit: '들어가기', wrong: '아이디 또는 비밀번호가 맞지 않아요.' },
  },
  admin: {
    prefix: '/admin', userVar: 'ADMIN_USER', passVar: 'ADMIN_PASSWORD', cookie: 'hal_admin', cookiePath: '/',
    maxAge: 60 * 60 * 24 * 14, scope: 'hal-admin:', home: '/admin', title: 'Admin', basic: false,
    lang: 'en', text: { login: 'Log in', user: 'Username', pass: 'Password', submit: 'Log in', wrong: 'Wrong username or password.' },
  },
};
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

// Cookie value = HMAC-SHA256(password, scope + username): proves a past login without storing the password.
// api/_lib/auth.js computes the same value for the admin area.
async function sessionToken(user, pass, scope) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(pass), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(scope + user.toLowerCase()));
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

function safeNext(area, value) {
  const v = String(value || '');
  const inside = v === area.prefix || (v.startsWith(area.prefix + '/') && !/[\s\\]/.test(v));
  return inside && !v.startsWith('//') && !v.startsWith(area.prefix + '/login') ? v : area.home;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function loginPage(area, next, error, status = 200) {
  const html = `<!doctype html>
<html lang="${area.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive"><title>${esc(area.title)} · ${area.text.login}</title>
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
<form method="post" action="${area.prefix}/login">
<h1>${esc(area.title)}</h1>
${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<input type="hidden" name="next" value="${esc(next)}">
<label>${area.text.user}<input name="username" autocomplete="username" autocapitalize="none" required></label>
<label>${area.text.pass}<input name="password" type="password" autocomplete="current-password" required></label>
<button class="btn btn--block" type="submit">${area.text.submit}</button>
</form></main></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...ROBOTS } });
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const area = url.pathname === '/admin' || url.pathname.startsWith('/admin/') ? AREAS.admin : AREAS.preview;

  // Trim: values pasted into Vercel often carry a trailing space or newline.
  const user = (process.env[area.userVar] || '').trim().normalize('NFC');
  const pass = (process.env[area.passVar] || '').trim().normalize('NFC');
  if (!user || !pass) {
    return new Response(`${area.title}: not configured (${area.userVar} / ${area.passVar} missing for this environment).`, { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...ROBOTS } });
  }

  const token = await sessionToken(user, pass, area.scope);

  if (url.pathname === area.prefix + '/login') {
    if (request.method !== 'POST') return loginPage(area, safeNext(area, url.searchParams.get('next')), '', 200);
    let form;
    try { form = await request.formData(); } catch (_) { form = new FormData(); }
    const next = safeNext(area, form.get('next'));
    if (!credentialsMatch(form.get('username'), form.get('password'), user, pass)) {
      return loginPage(area, next, area.text.wrong, 200);
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: next,
        'Set-Cookie': `${area.cookie}=${token}; Path=${area.cookiePath}; Max-Age=${area.maxAge}; HttpOnly; Secure; SameSite=Lax`,
        ...ROBOTS,
      },
    });
  }

  if (area === AREAS.admin && url.pathname === '/admin/logout') {
    return new Response(null, {
      status: 303,
      headers: { Location: '/admin/login', 'Set-Cookie': `${area.cookie}=; Path=${area.cookiePath}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`, ...ROBOTS },
    });
  }

  if (safeEqual(readCookie(request, area.cookie), token)) return undefined; // logged in: serve the file
  if (area.basic && basicCandidates(request).some(([u, p]) => credentialsMatch(u, p, user, pass))) return undefined;

  return loginPage(area, safeNext(area, url.pathname)); // 200, not 401: a 401 can be mistaken for Vercel's own protection
}
