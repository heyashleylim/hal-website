/*
 * Secrets and sessions for the private podcast.
 *
 * - Student tokens: 128-bit random, URL-safe (22 characters). They are the only key to a feed.
 * - Admin session: the same scheme as the /preview login in middleware.js, with its own credentials
 *   (ADMIN_USER / ADMIN_PASSWORD) and cookie (hal_admin). The middleware shows the login page;
 *   the admin API checks the cookie again here, so it stays closed even if the middleware matcher changes.
 * - IP addresses are never stored: only an HMAC with PODCAST_SECRET (enough to count distinct networks).
 */
const crypto = require('node:crypto');

const ADMIN_COOKIE = 'hal_admin';

function newToken() {
  return crypto.randomBytes(16).toString('base64url');
}

function isToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function secret() {
  const s = (process.env.PODCAST_SECRET || '').trim();
  if (s.length < 32) throw new Error('PODCAST_SECRET is missing or shorter than 32 characters');
  return s;
}

function ipHash(ip) {
  if (!ip) return null;
  return crypto.createHmac('sha256', secret()).update('ip:' + ip).digest('hex').slice(0, 32);
}

// The secret in the ActiveCampaign webhook address (?key=…), derived from PODCAST_SECRET: no extra setting.
// Changing PODCAST_SECRET changes it (update the webhook steps in AC then).
function webhookKey() {
  return crypto.createHmac('sha256', secret()).update('ac-webhook').digest('base64url').slice(0, 32);
}

function adminCredentials() {
  const user = (process.env.ADMIN_USER || '').trim().normalize('NFC');
  const pass = (process.env.ADMIN_PASSWORD || '').trim().normalize('NFC');
  return user && pass ? { user, pass } : null;
}

// Must match sessionToken() in middleware.js for the 'hal-admin:' scope.
function adminSessionToken(user, pass) {
  return crypto.createHmac('sha256', pass).update('hal-admin:' + user.toLowerCase()).digest('hex');
}

function readCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : '';
}

// The admin's user name when the request carries a valid admin cookie, else null.
function adminFromRequest(req) {
  const creds = adminCredentials();
  if (!creds) return null;
  return safeEqual(readCookie(req, ADMIN_COOKIE), adminSessionToken(creds.user, creds.pass)) ? creds.user : null;
}

// Writes from the admin pages must come from this site (cookie is SameSite=Strict too).
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.host;
  } catch (_) {
    return false;
  }
}

module.exports = { ADMIN_COOKIE, newToken, isToken, safeEqual, ipHash, webhookKey, adminCredentials, adminSessionToken, adminFromRequest, sameOrigin };
