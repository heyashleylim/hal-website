/*
 * PayPal (USD), Orders API v2, redirect flow: no PayPal script on our page.
 *
 *   PAYPAL_CLIENT_ID / PAYPAL_SECRET   a REST app (sandbox credentials on previews, live on production)
 *   PAYPAL_WEBHOOK_ID                  the webhook's id, to check that a notice really comes from PayPal
 *   PAYPAL_ENV                         optional "live" | "sandbox" (default: live on production, sandbox elsewhere)
 *
 * Flow: createOrder() → the buyer approves on PayPal → PayPal sends them back to /checkout/complete → our
 * server captures the payment (captureOrder) and checks the amount before the order is marked paid. If the
 * buyer never comes back, PayPal's webhook (CHECKOUT.ORDER.APPROVED) triggers the same capture.
 */
const config = require('../config.js');
const { PayError } = require('./ciderpay.js');

let cached = null; // { token, expires, key }

function credentials(env = process.env) {
  const id = (env.PAYPAL_CLIENT_ID || '').trim();
  const secret = (env.PAYPAL_SECRET || '').trim();
  if (!id || !secret) throw new PayError('not_configured', 'PAYPAL_CLIENT_ID / PAYPAL_SECRET are not set');
  return { id, secret };
}

async function accessToken({ fetchImpl = fetch, env = process.env } = {}) {
  const { id, secret } = credentials(env);
  const key = `${config.paypalBase(env)}|${id}`;
  if (cached && cached.key === key && cached.expires > Date.now() + 60000) return cached.token;
  let res, data;
  try {
    res = await fetchImpl(`${config.paypalBase(env)}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(15000),
    });
    data = await res.json().catch(() => null);
  } catch (err) {
    throw new PayError('provider', `PayPal could not be reached: ${err.message}`);
  }
  if (!res.ok || !data || !data.access_token) throw new PayError('provider', `PayPal refused our credentials (HTTP ${res.status})`);
  cached = { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 300) * 1000, key };
  return cached.token;
}

async function call(method, path, body, { fetchImpl = fetch, env = process.env, requestId = null } = {}) {
  const token = await accessToken({ fetchImpl, env });
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json', Prefer: 'return=representation' };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  let res, data;
  try {
    res = await fetchImpl(config.paypalBase(env) + path, { method, headers, body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    data = await res.json().catch(() => null);
  } catch (err) {
    throw new PayError('provider', `PayPal could not be reached: ${err.message}`);
  }
  return { status: res.status, ok: res.ok, data: data || {} };
}

// 229900 → "2299.00"
function dollars(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new PayError('unavailable', `not an amount in cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

// "2299.00" → 229900; anything that isn't a plain dollar amount → null.
function cents(value) {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(String(value == null ? '' : value).trim());
  return m ? Number(m[1]) * 100 + Number((m[2] || '').padEnd(2, '0')) : null;
}

// The order we ask PayPal to create. Pure, so tests can check exactly what is sent.
function orderRequest({ order, productName, slug }, env = process.env) {
  if (order.currency !== 'USD') throw new PayError('unavailable', 'PayPal is used for USD only');
  if (!Number.isInteger(order.due_today) || order.due_today < 100) throw new PayError('unavailable', `amount too small for PayPal: ${order.due_today}`);
  return {
    intent: 'CAPTURE',
    purchase_units: [{
      reference_id: String(order.number),
      custom_id: order.token,                                   // comes back on the capture and in webhooks
      invoice_id: `${order.number}-${order.token.slice(0, 8)}`, // unique per PayPal account
      description: String(productName).slice(0, 120),
      amount: { currency_code: 'USD', value: dollars(order.due_today) },
    }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: 'Ashley Lim',
          locale: 'ko-KR',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: config.completeUrl(order.token, env),
          cancel_url: config.checkoutUrl(slug, { currency: 'usd', problem: 'cancelled' }, env),
        },
      },
    },
  };
}

// → { id, approveUrl }
async function createOrder(args, opts = {}) {
  const env = opts.env || process.env;
  const r = await call('POST', '/v2/checkout/orders', orderRequest(args, env), { ...opts, requestId: `order-${args.order.token}` });
  const link = (r.data.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  if (!r.ok || !r.data.id || !link) throw new PayError('provider', `PayPal did not create the order (HTTP ${r.status}): ${JSON.stringify(r.data).slice(0, 300)}`);
  const approveUrl = config.trustedPayUrl(link.href, 'paypal', env);
  if (!approveUrl) throw new PayError('provider', `PayPal returned an address we don't recognise: ${String(link.href).slice(0, 200)}`);
  return { id: String(r.data.id), approveUrl };
}

// One shape for a capture, whether it comes from a capture call, an order lookup or a webhook.
//   { status, captureId, amount (cents), currency, fee (cents) | null, customId, payerEmail, payerCountry }
function readCapture(capture, order = {}) {
  const amount = capture.amount || {};
  const fee = capture.seller_receivable_breakdown && capture.seller_receivable_breakdown.paypal_fee;
  const payer = order.payer || {};
  return {
    status: String(capture.status || ''),
    captureId: capture.id ? String(capture.id) : '',
    amount: cents(amount.value),
    currency: String(amount.currency_code || ''),
    fee: fee && fee.currency_code === 'USD' ? cents(fee.value) : null,
    customId: String(capture.custom_id || ''),
    payerEmail: String(payer.email_address || ''),
    payerCountry: String((payer.address && payer.address.country_code) || ''),
  };
}

function firstCapture(order) {
  const unit = (order.purchase_units || [])[0] || {};
  const capture = ((unit.payments || {}).captures || [])[0];
  return capture ? readCapture({ custom_id: unit.custom_id, ...capture }, order) : null;
}

/*
 * Captures an approved order. →
 *   { outcome: 'captured', capture }      money received (also when it had already been captured)
 *   { outcome: 'not_approved' }           the buyer hasn't approved (came back without paying)
 *   { outcome: 'declined', detail }       PayPal refused the buyer's funding source
 *   { outcome: 'pending', capture }       captured but held by PayPal (review): not paid yet
 */
async function captureOrder(paypalOrderId, opts = {}) {
  const id = encodeURIComponent(paypalOrderId);
  const r = await call('POST', `/v2/checkout/orders/${id}/capture`, {}, { ...opts, requestId: `capture-${paypalOrderId}` });
  const issue = ((r.data.details || [])[0] || {}).issue || '';
  let order = r.data;
  if (!r.ok) {
    if (issue === 'ORDER_NOT_APPROVED' || issue === 'PAYER_ACTION_REQUIRED') return { outcome: 'not_approved' };
    if (issue === 'INSTRUMENT_DECLINED' || issue === 'PAYER_CANNOT_PAY' || issue === 'TRANSACTION_REFUSED') return { outcome: 'declined', detail: issue };
    if (issue !== 'ORDER_ALREADY_CAPTURED') throw new PayError('provider', `PayPal capture failed (HTTP ${r.status}): ${issue || JSON.stringify(r.data).slice(0, 300)}`);
    const again = await call('GET', `/v2/checkout/orders/${id}`, null, opts);
    if (!again.ok) throw new PayError('provider', `PayPal order lookup failed (HTTP ${again.status})`);
    order = again.data;
  }
  const capture = firstCapture(order);
  if (!capture) throw new PayError('provider', `PayPal answered without a capture: ${JSON.stringify(order).slice(0, 300)}`);
  if (capture.status === 'COMPLETED') return { outcome: 'captured', capture };
  if (capture.status === 'PENDING') return { outcome: 'pending', capture };
  return { outcome: 'declined', detail: capture.status };
}

// Does this webhook really come from PayPal? Asks PayPal to check its own signature.
// `rawText` is the notice exactly as received: when we have it, it is passed on untouched, because PayPal
// signs the exact bytes and re-writing the JSON (number formats, escapes) can make a genuine notice fail.
async function verifyWebhook(headers, event, opts = {}) {
  const env = opts.env || process.env;
  const webhookId = (env.PAYPAL_WEBHOOK_ID || '').trim();
  if (!webhookId) throw new PayError('not_configured', 'PAYPAL_WEBHOOK_ID is not set');
  const h = (name) => String(headers[name] || '');
  const envelope = {
    auth_algo: h('paypal-auth-algo'), cert_url: h('paypal-cert-url'), transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'), transmission_time: h('paypal-transmission-time'), webhook_id: webhookId,
  };
  if (!envelope.transmission_id || !envelope.transmission_sig) return false;
  const raw = typeof opts.rawText === 'string' && opts.rawText.trim().startsWith('{') ? opts.rawText : JSON.stringify(event);
  const body = JSON.stringify(envelope).slice(0, -1) + ',"webhook_event":' + raw + '}';
  const r = await call('POST', '/v1/notifications/verify-webhook-signature', body, opts);
  return r.ok && r.data.verification_status === 'SUCCESS';
}

function resetCache() { cached = null; }

module.exports = { orderRequest, createOrder, captureOrder, verifyWebhook, readCapture, firstCapture, dollars, cents, accessToken, resetCache };
