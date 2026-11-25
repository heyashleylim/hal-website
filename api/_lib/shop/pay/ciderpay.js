/*
 * CiderPay (card payments in KRW). API documentation: http://uddocs.net/v/ciderpay (공개 API → 결제 API).
 *
 *   CIDERPAY_MEMBER_ID   the merchant's CiderPay id
 *   CIDERPAY_API_TOKEN   the payment token (approvalToken header; also the devToken of the instalment calls)
 *   CIDERPAY_DEV_ID / CIDERPAY_DEV_TOKEN   only if CiderPay ever gives separate developer credentials for
 *                        instalment plans (the WooCommerce plugin sent the member id and the same token)
 *
 * Flow: requestPayment() asks CiderPay for a payment page (payUrl) and the buyer is sent there. When the card
 * is charged, CiderPay calls our callback address with a "feedback" (readNotice() turns it into one shape).
 * CiderPay has no test mode and no "look up a payment" call, so a notice is only believed when it carries
 * the two values we attached to the request: var1 = the order's token, var2 = our signature of it.
 */
const config = require('../config.js');
const pricing = require('../pricing.js');

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
 * kind 'recurring' covers the instalment-plan notices (cmd = agreeRegularPayment…), handled by instalments.js.
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
    // Instalment plans (cmd = agreeRegularPayment | rejectRegularPayment | completeRpPayment | errorRpPayment)
    rpToken: get('rpToken'),
    turnSeq: /^\d{1,3}$/.test(get('turnSeq')) ? Number(get('turnSeq')) : null,
    errorMessage: get('errorMessage').slice(0, 300),
    last4: /^\d{4}$/.test(get('last4')) ? get('last4') : (/(\d{4})\D*$/.exec(get('cardNum')) || [])[1] || '',
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
 * Is this instalment notice really about `order`? → null when fine, else the reason.
 * CiderPay returns var1/var2 (our token and signature) with every plan notice. Should a payment notice come without
 * them, the plan's rpToken (learned from a checked agreement notice) identifies it instead.
 */
function planNoticeProblem(notice, order, env = process.env) {
  const { memberId } = credentials(env);
  if (!notice.memberId) return 'no merchant id';
  if (notice.memberId !== memberId) return 'another merchant id';
  if (notice.token || notice.signature) {
    if (!config.safeEqual(notice.token, order.token)) return 'token does not match the order';
    if (!config.safeEqual(notice.signature, signature(order, env))) return 'bad signature';
  } else if (!order.rp_token || !config.safeEqual(notice.rpToken, order.rp_token)) {
    return 'no token, and the plan token does not match';
  }
  if (order.rp_token && notice.rpToken && !config.safeEqual(notice.rpToken, order.rp_token)) return 'another plan token';
  if (notice.cmd === 'completeRpPayment' && !notice.orderNo) return 'no CiderPay order number';
  return null;
}

// ---------- Instalment plans (정기 결제, CiderPay's 개발사 API) ----------

function devCredentials(env = process.env) {
  const { memberId, token } = credentials(env);
  return { memberId, devId: (env.CIDERPAY_DEV_ID || '').trim() || memberId, devToken: (env.CIDERPAY_DEV_TOKEN || '').trim() || token };
}

// '821012345678' (how the checkout stores a Korean mobile) → '01012345678', the format the plan request takes.
function localMobile(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d.startsWith('82')) return d;
  const rest = d.slice(2);
  return rest.startsWith('0') ? rest : '0' + rest;
}

function addDays(date, days) {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/*
 * The request for an instalment plan (정기 결제 요청). Pure. `terms` = { first, monthly, count, day } (orders.planTerms),
 * `start` = the Seoul date of the first payment. As the WooCommerce plugin did: the first payment is charged at once
 * (MUST_FIRST_PAYMENT), then `monthly` on `day` of each month, and the agreement ends 7 days after the last due date.
 */
function planRequest({ order, productName, billing, terms, start }, env = process.env) {
  const { memberId } = credentials(env);
  if (order.currency !== 'KRW' || order.plan !== 'instalment') throw new PayError('unavailable', 'an instalment plan is for KRW instalment orders only');
  if (!terms || !Number.isInteger(terms.first) || !Number.isInteger(terms.monthly) || !Number.isInteger(terms.count) || terms.count < 1) throw new PayError('unavailable', 'this order has no instalment terms');
  if (terms.first < 1000 || terms.monthly < 1000) throw new PayError('unavailable', `CiderPay's minimum is ₩1,000 (asked: ${terms.first} then ${terms.monthly})`);
  const mobile = localMobile(billing.phone);
  if (!mobile) throw new PayError('unavailable', 'an instalment plan needs a mobile number');
  const last = pricing.schedule(start, terms.count + 1).at(-1);
  const sig = signature(order, env);
  const back = config.callbackUrl('ciderpay', env);
  return {
    memberID: memberId,
    customName: billing.name,
    customMobile: mobile,
    customEmail: billing.email,
    goodName: goodName(productName, order.number),
    price: terms.monthly,
    limitDateStr: addDays(last, 7),
    returnUrl: config.completeUrl(order.token, env),
    feedbackUrl: back,       // agreement accepted / refused
    var1: order.token,
    var2: sig,
    payFeedbackUrl: back,    // each charge, paid or failed
    payVar1: order.token,
    payVar2: sig,
    periodDateType: 'MONTH',
    periodDateVal: String(terms.day),
    firstBillingType: 'MUST_FIRST_PAYMENT',
    firstPrice: terms.first,
    taxType: 'TAX',
  };
}

async function devFetch(method, path, { json = null, form = null } = {}, { fetchImpl = fetch, env = process.env } = {}) {
  const { devId, devToken } = devCredentials(env);
  const headers = { Accept: 'application/json', devID: devId, devToken };
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
  let res, text;
  try {
    res = await fetchImpl(`${config.ciderpayBase(env)}${path}`, { method, headers, body, signal: AbortSignal.timeout(20000) });
    text = await res.text();
  } catch (err) {
    throw new PayError('unknown', `CiderPay could not be reached or did not answer: ${err.message}`);
  }
  let data = null;
  try { data = JSON.parse(text); } catch (_) { /* not JSON */ }
  return { status: res.status, data: data || {}, text: String(text || '').slice(0, 500) };
}

// Asks CiderPay for the page where the buyer agrees to the plan (and pays the first instalment). → { payUrl, payUniqueNo }
async function requestPlan(args, opts = {}) {
  const env = opts.env || process.env;
  const body = planRequest(args, env);
  let r;
  try {
    r = await devFetch('POST', '/oapi/regularPay/request', { json: body }, opts);
  } catch (err) {
    throw new PayError('provider', err.detail || err.message);
  }
  if (r.status !== 200) throw new PayError('provider', `CiderPay answered HTTP ${r.status}: ${r.text}`);
  // The answer carries the agreement page in var1 and the request number in var2 (not payUrl / payUniqueNo).
  if (r.data.success !== true || !r.data.var1) throw new PayError('provider', `CiderPay refused the instalment request: ${why(r.data, r.text)}`);
  const payUrl = config.trustedPayUrl(r.data.var1, 'ciderpay', env);
  if (!payUrl) throw new PayError('provider', `CiderPay returned an agreement address we don't recognise: ${String(r.data.var1).slice(0, 200)}`);
  return { payUrl, payUniqueNo: r.data.var2 ? String(r.data.var2) : null };
}

/*
 * Pause, resume or end a plan at CiderPay. → { ok: true } or { ok: false, detail }.
 * Throws PayError('unknown') when no answer came (whether it happened is then unknown).
 */
async function planAction(action, rpToken, opts = {}) {
  const env = opts.env || process.env;
  const { memberId } = credentials(env);
  if (!rpToken) return { ok: false, detail: 'this plan has no CiderPay token' };
  let r;
  if (action === 'pause' || action === 'resume') {
    r = await devFetch('POST', `/oapi/regularPay/${action === 'pause' ? 'pauseAct' : 'unpauseAct'}`, { form: { rpToken, memberID: memberId } }, opts);
  } else if (action === 'end') {
    r = await devFetch('DELETE', `/oapi/regularPay/destroyMp/${encodeURIComponent(memberId)}/${encodeURIComponent(rpToken)}`, {}, opts);
  } else {
    throw new Error(`unknown plan action ${action}`);
  }
  if (r.status >= 500) throw new PayError('unknown', `CiderPay answered HTTP ${r.status}: ${r.text}`);
  if (r.data.success === true) return { ok: true, raw: r.data };
  return { ok: false, detail: why(r.data, r.text), raw: r.data };
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

module.exports = {
  PayError, paymentRequest, requestPayment, parseBody, readNotice, noticeProblem, planNoticeProblem, signature, goodName, won, cancelBody, cancelPayment,
  localMobile, planRequest, requestPlan, planAction,
};
