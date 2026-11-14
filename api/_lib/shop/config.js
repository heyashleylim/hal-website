/*
 * Shop configuration: secrets, signatures and addresses. Everything that depends on the environment
 * (production, preview, this computer) is decided here, so the rest of the shop code doesn't look at env vars.
 *
 *   SHOP_SECRET   random, 32+ characters. Signs payment notices and order links. Never change it once live:
 *                 notices for payments in progress would stop being accepted.
 */
const crypto = require('node:crypto');

function secret(env = process.env) {
  const s = (env.SHOP_SECRET || '').trim();
  if (s.length < 32) throw new Error('SHOP_SECRET is missing or shorter than 32 characters');
  return s;
}

function configured(env = process.env) {
  return (env.SHOP_SECRET || '').trim().length >= 32;
}

// A signature of `value` for one purpose ("order", "ciderpay-callback"…): a different purpose gives a different
// signature, so one can never be replayed as another.
function sign(purpose, value, env = process.env) {
  return crypto.createHmac('sha256', secret(env)).update(`${purpose}:${value}`).digest('base64url').slice(0, 32);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a == null ? '' : a));
  const y = Buffer.from(String(b == null ? '' : b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function verify(purpose, value, signature, env = process.env) {
  return safeEqual(sign(purpose, value, env), signature);
}

// The key in the address CiderPay calls back (…/api/shop-callback?p=ciderpay&k=<key>). It only ever travels
// between our server and CiderPay's.
function callbackKey(env = process.env) {
  return sign('callback', 'ciderpay', env);
}

function newToken() {
  return crypto.randomBytes(16).toString('base64url');
}

function isToken(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value);
}

// The buyer's network as an HMAC (never the address itself): enough to slow down someone flooding the checkout.
function ipHash(req, env = process.env) {
  const ip = String(req.headers['x-real-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '').trim();
  return ip ? sign('ip', ip, env) : null;
}

const isProduction = (env = process.env) => env.VERCEL_ENV === 'production';

// The address customers and payment providers use for this deployment.
//   production: SHOP_PUBLIC_URL, or https://www.ashleylim.com
//   preview:    the deployment's own address
//   local:      SHOP_PUBLIC_URL (tools/shop/dev-server.js sets it)
function publicBase(env = process.env) {
  const explicit = (env.SHOP_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  if (isProduction(env)) return 'https://www.ashleylim.com';
  const host = env.VERCEL_BRANCH_URL || env.VERCEL_URL;
  if (host) return `https://${host}`;
  throw new Error('SHOP_PUBLIC_URL is not set');
}

// Where a provider sends its notices. Vercel previews sit behind Vercel's own login: providers can only reach
// them with the project's "Protection Bypass for Automation" secret, which Vercel exposes to the deployment.
function callbackUrl(provider, env = process.env) {
  const url = new URL(`${publicBase(env)}/api/shop-callback`);
  url.searchParams.set('p', provider);
  if (provider === 'ciderpay') url.searchParams.set('k', callbackKey(env));
  const bypass = (env.VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
  if (bypass && !isProduction(env)) url.searchParams.set('x-vercel-protection-bypass', bypass);
  return url.toString();
}

function completeUrl(token, env = process.env) {
  return `${publicBase(env)}/checkout/complete?o=${encodeURIComponent(token)}`;
}

function checkoutUrl(slug, params = {}, env = process.env) {
  const url = new URL(`${publicBase(env)}/checkout/${slug}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
  return url.toString();
}

// Provider API addresses. Production always talks to the real ones; elsewhere a test double can stand in
// (CIDERPAY_API_BASE / PAYPAL_API_BASE: used by tools/shop/ only).
function ciderpayBase(env = process.env) {
  const override = (env.CIDERPAY_API_BASE || '').trim().replace(/\/$/, '');
  return !isProduction(env) && override ? override : 'https://api.ciderpay.com';
}

// PayPal: live on production, sandbox everywhere else, unless PAYPAL_ENV says otherwise ("live" or "sandbox").
// Production is ALWAYS live: sandbox money must never count as paid there, whatever PAYPAL_ENV says.
function paypalMode(env = process.env) {
  if (isProduction(env)) return 'live';
  const mode = (env.PAYPAL_ENV || '').trim().toLowerCase();
  return mode === 'live' ? 'live' : 'sandbox';
}

function paypalBase(env = process.env) {
  const override = (env.PAYPAL_API_BASE || '').trim().replace(/\/$/, '');
  if (!isProduction(env) && override) return override;
  return paypalMode(env) === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

// A payment page we send the buyer to must belong to the provider (or to the test double in use).
function trustedPayUrl(value, provider, env = process.env) {
  let url;
  try { url = new URL(String(value)); } catch (_) { return null; }
  const base = new URL(provider === 'paypal' ? paypalBase(env) : ciderpayBase(env));
  const double = base.hostname === 'localhost' || base.hostname === '127.0.0.1';
  if (double) return url.host === base.host ? url.toString() : null;
  if (url.protocol !== 'https:') return null;
  const domain = provider === 'paypal' ? 'paypal.com' : 'ciderpay.com';
  return url.hostname === domain || url.hostname.endsWith('.' + domain) ? url.toString() : null;
}

function present(name, env = process.env) {
  return Boolean((env[name] || '').trim());
}

const ciderpayConfigured = (env = process.env) => present('CIDERPAY_MEMBER_ID', env) && present('CIDERPAY_API_TOKEN', env);
const paypalConfigured = (env = process.env) => present('PAYPAL_CLIENT_ID', env) && present('PAYPAL_SECRET', env);

module.exports = {
  secret, configured, sign, verify, safeEqual, callbackKey, newToken, isToken, ipHash, isProduction, publicBase,
  callbackUrl, completeUrl, checkoutUrl, ciderpayBase, paypalMode, paypalBase, trustedPayUrl, ciderpayConfigured, paypalConfigured,
};
