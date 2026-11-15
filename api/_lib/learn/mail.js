/*
 * Sends the sign-in code email through Ashley's Google Workspace (Gmail API), the same account that sends
 * WordPress's emails, so the domain is already trusted (SPF/DKIM) and no new email service is needed.
 *
 * A Google Cloud service account with domain-wide delegation, limited to the gmail.send scope (it can send, never
 * read), acts as the sending address. No npm package: the JWT is signed with node:crypto and the API is called with fetch.
 *
 * Env (Vercel): GOOGLE_SA_EMAIL (the service account's client_email), GOOGLE_SA_KEY (its private_key, the whole
 * "-----BEGIN PRIVATE KEY-----…" text; "\n" written as two characters is accepted), LEARN_MAIL_FROM (the Workspace
 * address that sends, e.g. hello@ashleylim.com) and optionally LEARN_MAIL_NAME (sender name, default 애슐리 림).
 *
 * Tests and the local server replace the transport with setTransport().
 */
const crypto = require('node:crypto');

const SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let transport = null; // test hook: async ({ to, subject, text, html }) => void
function setTransport(fn) {
  transport = fn;
  cachedToken = null;
}

// The private key however it was pasted into Vercel: the whole JSON file, the private_key value with or without its
// quotes, "\n" written as two characters, or real line breaks turned into spaces. → { key: PEM, email? }
function readKey(value) {
  let text = String(value || '').trim();
  let email = '';
  if (text.startsWith('{')) {
    try {
      const json = JSON.parse(text);
      text = String(json.private_key || '');
      email = String(json.client_email || '');
    } catch (_) { /* not JSON after all */ }
  }
  text = text.replace(/^["']+|["',]+$/g, '').replace(/\\r/g, '').replace(/\\n/g, '\n').replace(/\r/g, '').trim();
  const m = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(text);
  const label = m ? m[1] : 'PRIVATE KEY';
  const body = (m ? m[2] : text).replace(/[^A-Za-z0-9+/=]/g, '');
  if (!body) return { key: '', email };
  const pem = `-----BEGIN ${label}-----\n${body.replace(/.{64}/g, '$&\n').replace(/\n$/, '')}\n-----END ${label}-----\n`;
  return { key: pem, email };
}

// Why a key can't be used, without showing any of it.
function describeKey(value) {
  const t = String(value || '').trim();
  return `${t.length} characters, ${t.startsWith('{') ? 'starts like a JSON file' : t.includes('BEGIN') ? 'has a BEGIN line' : 'no BEGIN line'}`;
}

function config(env = process.env) {
  const parsed = readKey(env.GOOGLE_SA_KEY);
  const email = (env.GOOGLE_SA_EMAIL || '').trim().replace(/^["']|["']$/g, '') || parsed.email;
  const from = (env.LEARN_MAIL_FROM || '').trim();
  if (!email || !parsed.key || !from) return null;
  try {
    crypto.createPrivateKey(parsed.key);
  } catch (_) {
    throw new Error(`GOOGLE_SA_KEY is not a readable private key (${describeKey(env.GOOGLE_SA_KEY)}): paste the "private_key" value from the JSON file`);
  }
  return { email, key: parsed.key, from, name: (env.LEARN_MAIL_NAME || '애슐리 림').trim() };
}

function configured(env = process.env) {
  try {
    return Boolean(transport || config(env));
  } catch (_) {
    return false;
  }
}

const b64url = (s) => Buffer.from(s).toString('base64url');

let cachedToken = null; // { token, until }

async function accessToken(cfg, fetchImpl = fetch) {
  if (cachedToken && cachedToken.until > Date.now() + 60_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: cfg.email, sub: cfg.from, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claims}`), cfg.key).toString('base64url');
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${signature}` }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(`Google sign-in for sending failed (${res.status}): ${data.error_description || data.error || 'no token'}`);
  cachedToken = { token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cachedToken.token;
}

// RFC 2047 encoded header word (Korean subject and sender name).
const word = (s) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;

// A multipart/alternative message (plain text + HTML), UTF-8, base64 bodies.
function mime({ fromName, from, to, subject, text, html }) {
  const boundary = 'b' + crypto.randomBytes(12).toString('hex');
  const wrap = (s) => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${word(fromName)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${word(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

async function send({ to, subject, text, html }, { env = process.env, fetchImpl = fetch } = {}) {
  if (/[\r\n<>]/.test(to)) throw new Error('bad recipient');
  if (transport) return transport({ to, subject, text, html });
  const cfg = config(env);
  if (!cfg) throw new Error('Email sending is not set up (GOOGLE_SA_EMAIL, GOOGLE_SA_KEY, LEARN_MAIL_FROM)');
  const token = await accessToken(cfg, fetchImpl);
  const raw = Buffer.from(mime({ fromName: cfg.name, from: cfg.from, to, subject, text, html })).toString('base64url');
  const res = await fetchImpl(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(cfg.from)}/messages/send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Gmail refused the email (${res.status}): ${(data.error && data.error.message) || 'unknown error'}`);
  }
}

module.exports = { send, configured, setTransport, mime, config, readKey };
