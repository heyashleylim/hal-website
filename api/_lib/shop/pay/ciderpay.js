/*
 * CiderPay (card payments in KRW). API documentation: http://uddocs.net/v/ciderpay (공개 API → 결제 API).
 *
 *   CIDERPAY_MEMBER_ID   the merchant's CiderPay id
 *   CIDERPAY_API_TOKEN   the payment token (approvalToken header)
 *
 * Flow: requestPayment() asks CiderPay for a payment page (payUrl) and the buyer is sent there. When the card
 * is charged, CiderPay calls our callback address with a "feedback" (readNotice() turns it into one shape).
 * CiderPay has no test mode and no "look up a payment" call, so a notice is only believed when it carries
 * the two values we attached to the request: var1 = the order's token, var2 = our signature of it.
 */
const config = require('../config.js');

// A payment problem with a stable code. `detail` is for logs and the admin, never for the customer.
class PayError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
  }
}

function credentials(env = process.env) {
  const memberId = (env.CIDERPAY_MEMBER_ID || '').trim();
  const token = (env.CIDERPAY_API_TOKEN || '').trim();
  if (!memberId || !token) throw new PayError('not_configured', 'CIDERPAY_MEMBER_ID / CIDERPAY_API_TOKEN are not set');
  return { memberId, token };
}

// The name shown on CiderPay's page and receipt: "<product> [<order number>]" (the format used until now).
function goodName(productName, orderNumber) {
  return `${String(productName).slice(0, 60)} [${orderNumber}]`;
}

function signature(order, env = process.env) {
  return config.sign('ciderpay-order', `${order.token}:${order.number}:${order.due_today}`, env);
}

// The request for a one-time payment (결제 요청). Pure, so tests can check exactly what is sent.
function paymentRequest({ order, productName, billing }, env = process.env) {
  const { memberId } = credentials(env);
  if (order.currency !== 'KRW') throw new PayError('unavailable', 'CiderPay only takes KRW');
  if (!Number.isInteger(order.due_today) || order.due_today < 1000) throw new PayError('unavailable', `CiderPay's minimum is ₩1,000 (asked: ${order.due_today})`);
  return {
    memberID: memberId,
    price: order.due_today,
    goodName: goodName(productName, order.number),
    mobile: String(billing.phone || '').replace(/\D/g, ''), // '821012345678': digits with the country code, as the WooCommerce plugin sent it
    customName: billing.name,
    email: billing.email,
    feedbackurl: config.callbackUrl('ciderpay', env),
    returnurl: config.completeUrl(order.token, env),
    returnmode: 'JUST',   // back to our page right after payment (our page links to the receipt)
    smsuse: 'N',          // the buyer is already on the payment page: no payment link by SMS
    payLimitDay: 0,       // the payment page is valid today only
    var1: order.token,
    var2: signature(order, env),
  };
}

// Asks CiderPay for a payment page. → { payUrl, payUniqueNo }
async function requestPayment(args, { fetchImpl = fetch, env = process.env } = {}) {
  const body = paymentRequest(args, env);
  const { token } = credentials(env);
  let res, text;
  try {
    res = await fetchImpl(`${config.ciderpayBase(env)}/oapi/payment/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', approvalToken: token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    text = await res.text();
  } catch (err) {
    throw new PayError('provider', `CiderPay could not be reached: ${err.message}`);
  }
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* not JSON */ }
  if (!res.ok) throw new PayError('provider', `CiderPay answered HTTP ${res.status}: ${String(text).slice(0, 300)}`);
  if (!data || data.success !== true || !data.payUrl) {
    const why = data ? [data.errCode, data.message || data.errorMessage].filter(Boolean).join(' ') : String(text).slice(0, 300);
    throw new PayError('provider', `CiderPay refused the payment request: ${why || 'no payUrl in the answer'}`);
  }
  const payUrl = config.trustedPayUrl(data.payUrl, 'ciderpay', env);
  if (!payUrl) throw new PayError('provider', `CiderPay returned a payment address we don't recognise: ${String(data.payUrl).slice(0, 200)}`);
  return { payUrl, payUniqueNo: data.payUniqueNo ? String(data.payUniqueNo) : null };
}

// A feedback body as sent by CiderPay: form-encoded (what it sends today) or JSON. → plain object of strings.
function parseBody(raw, contentType = '') {
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw == null ? '' : raw);
  if (!text.trim()) return {};
  if (/json/i.test(contentType) || /^\s*\{/.test(text)) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data === 'object' && !Array.isArray(data)) return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v == null ? '' : String(v)]));
    } catch (_) { /* fall through to form parsing */ }
  }
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) if (!(k in out)) out[k] = v; // a repeated key keeps its first value
  return out;
}

// Whole won from what CiderPay sends ("220000", 220000, "220,000"); anything else → null.
function won(value) {
  const s = String(value == null ? '' : value).replace(/,/g, '').trim();
  return /^\d{1,10}$/.test(s) ? Number(s) : null;
}

/*
 * One shape for every notice:
 *   { kind: 'paid' | 'cancelled' | 'recurring' | 'unknown', memberId, token, signature, amount,
 *     orderNo, approvalNo, refundToken, receiptUrl, method, cardQuota }
 * kind 'recurring' covers the instalment notices (cmd = agreeRegularPayment…), handled in a later phase.
 */
function readNotice(p) {
  const get = (...names) => { for (const n of names) if (p[n] != null && p[n] !== '') return String(p[n]); return ''; };
  const state = get('paymentState').toUpperCase();
  const cmd = get('cmd');
  const kind = cmd ? 'recurring' : state === 'COMPLETE' ? 'paid' : state === 'CANCEL' ? 'cancelled' : 'unknown';
  const receipt = get('csturl');
  return {
    kind,
    cmd,
    memberId: get('memberID', 'memberId'),
    token: get('var1'),
    signature: get('var2'),
    amount: won(get('price')),
    orderNo: get('orderNo'),
    approvalNo: get('approvalNo'),
    refundToken: get('feedbackToken'),
    receiptUrl: /^https:\/\//.test(receipt) ? receipt : '',
    method: [get('ccname'), get('pts')].filter(Boolean)[0] || 'card',
    cardQuota: get('cardQuota'),
    goodName: get('goodName', 'goodname'),
  };
}

// Is this notice really about `order`, from our CiderPay account? → null when fine, else the reason.
function noticeProblem(notice, order, env = process.env) {
  const { memberId } = credentials(env);
  if (!notice.memberId) return 'no merchant id';
  if (notice.memberId !== memberId) return 'another merchant id';
  if (!config.safeEqual(notice.token, order.token)) return 'token does not match the order';
  if (!config.safeEqual(notice.signature, signature(order, env))) return 'bad signature';
  if (!notice.orderNo) return 'no CiderPay order number';
  return null;
}

/*
 * Refunds. CiderPay has two calls, with the same fields (memberID, orderNo, token = the payment's feedbackToken,
 * rangeType ALL | PART, cancelPrice for PART, cancelMessage):
 *   POST /oapi/payment/cancel          before CiderPay has settled the payment: immediate
 *   POST /oapi/payment/cancelRequest   after settlement: a request, confirmed later by a CANCEL notice
 * /cancel answers { success: true } when done, or { success: false, var1: 'CANCEL_REQ' } when the payment is settled
 * and a cancel request is needed instead. Errors: { errCode, message } (2001 ERROR_CANCEL_STATE, 2002 ERROR_CANCEL_TOKEN).
 */
function cancelBody({ orderNo, refundToken, amount, full, reason }, env = process.env) {
  const { memberId } = credentials(env);
  if (!orderNo || !refundToken) throw new PayError('unavailable', 'this payment has no CiderPay order number or cancel token');
  if (!Number.isInteger(amount) || amount <= 0) throw new PayError('unavailable', `not a refund amount: ${amount}`);
  const body = { memberID: memberId, orderNo: String(orderNo), token: String(refundToken), rangeType: full ? 'ALL' : 'PART', cancelMessage: String(reason || '').slice(0, 100) };
  if (!full) body.cancelPrice = amount;
  return body;
}

async function post(path, body, { fetchImpl = fetch, env = process.env } = {}) {
  const { token } = credentials(env);
  let res, text;
  try {
    res = await fetchImpl(`${config.ciderpayBase(env)}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', approvalToken: token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    text = await res.text();
  } catch (err) {
    // We can't know whether CiderPay received it: the caller treats this as "check by hand".
    throw new PayError('unknown', `CiderPay could not be reached or did not answer: ${err.message}`);
  }
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* not JSON */ }
  if (res.status >= 500) throw new PayError('unknown', `CiderPay answered HTTP ${res.status}: ${String(text).slice(0, 300)}`);
  return { status: res.status, data: data || {}, text: String(text || '').slice(0, 500) };
}

const why = (data, text) => [data.errCode, data.message || data.errorMessage].filter(Boolean).join(' ') || text || 'no reason given';

/*
 * Gives back all or part of a payment. →
 *   { outcome: 'done' }                      refunded now
 *   { outcome: 'requested' }                 settled payment: CiderPay accepted a cancel request (its CANCEL notice confirms)
 *   { outcome: 'refused', detail }           nothing was refunded
 * Throws PayError('unknown') when the answer never came (the refund may or may not have happened).
 */
async function cancelPayment(args, opts = {}) {
  const env = opts.env || process.env;
  const body = cancelBody(args, env);
  const first = await post('/oapi/payment/cancel', body, opts);
  if (first.data.success === true) return { outcome: 'done', raw: first.data };
  if (String(first.data.var1 || '').toUpperCase() !== 'CANCEL_REQ') return { outcome: 'refused', detail: why(first.data, first.text), raw: first.data };
  const second = await post('/oapi/payment/cancelRequest', body, opts);
  if (second.data.success === true) return { outcome: 'requested', raw: second.data };
  return { outcome: 'refused', detail: `cancel request: ${why(second.data, second.text)}`, raw: second.data };
}

module.exports = { PayError, paymentRequest, requestPayment, parseBody, readNotice, noticeProblem, signature, goodName, won, cancelBody, cancelPayment };
