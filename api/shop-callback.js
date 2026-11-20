/*
 * /api/shop-callback — where the payment providers tell us what happened. Server to server: no buyer here.
 *
 *   POST ?p=ciderpay&k=<key>   CiderPay's "feedback" (form-encoded). The key is ours (config.callbackKey);
 *                              the notice must also carry the order's token and our signature (var1, var2).
 *                              Instalment-plan notices (cmd=…) go to instalments.fromCiderpay.
 *   POST ?p=paypal             PayPal webhooks, verified with PayPal before anything is believed.
 *   POST ?p=ac-coupon&k=<key>&campaign=<campaign key>
 *                              An ActiveCampaign automation's "Webhook" step: give this contact (contact[email]) their
 *                              own code of the campaign, written to their AC fields and tagged coupon_issued_<key>.
 *                              A contact who still holds a working code of the campaign gets that one again.
 *
 * Every notice is stored in shop_callbacks with what we did with it. Answers: 200 once handled (also for a
 * repeat), 4xx when the notice is refused, 500 when something failed on our side (so the provider tries again).
 */
const orders = require('./_lib/shop/orders.js');
const flow = require('./_lib/shop/flow.js');
const config = require('./_lib/shop/config.js');
const notify = require('./_lib/shop/notify.js');
const ciderpay = require('./_lib/shop/pay/ciderpay.js');
const paypal = require('./_lib/shop/pay/paypal.js');
const refunds = require('./_lib/shop/refunds.js');
const instalments = require('./_lib/shop/instalments.js');
const coupons = require('./_lib/shop/coupons.js');
const sync = require('./_lib/shop/sync.js');
const { readBody, sendJson } = require('./_lib/shop/http.js');

const done = (res, outcome) => sendJson(res, 200, { status: 'ok', outcome });

async function fromCiderpay(req, res, url, state) {
  if (!config.safeEqual(url.searchParams.get('k') || '', config.callbackKey())) return sendJson(res, 403, { status: 'error', message: 'forbidden' });
  state.verified = true;
  const { text, data } = await readBody(req);
  const payload = text == null ? Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v == null ? '' : String(v)])) : ciderpay.parseBody(text, req.headers['content-type']);
  const notice = ciderpay.readNotice(payload);

  // Instalment plans (cmd = agreeRegularPayment, completeRpPayment, errorRpPayment…): instalments.js.
  if (notice.kind === 'recurring') {
    const outcome = await instalments.fromCiderpay(notice, payload);
    if (outcome === 'unknown_order') return sendJson(res, 404, { status: 'error', message: 'unknown order' });
    return outcome === 'rejected' ? sendJson(res, 400, { status: 'error', message: 'rejected' }) : done(res, outcome);
  }
  if (notice.kind !== 'paid' && notice.kind !== 'cancelled') {
    await orders.logCallback({ provider: 'ciderpay', outcome: 'ignored', reason: 'unknown notice', payload });
    return done(res, 'ignored');
  }

  const order = await orders.byToken(notice.token);
  if (!order) {
    await orders.logCallback({ provider: 'ciderpay', outcome: 'rejected', reason: 'no order with this token', payload });
    return sendJson(res, 404, { status: 'error', message: 'unknown order' });
  }
  const problem = ciderpay.noticeProblem(notice, order);
  if (problem) {
    await orders.logCallback({ provider: 'ciderpay', outcome: 'rejected', reason: problem, orderId: order.id, payload });
    await notify.attention('a CiderPay notice was refused', [`Order ${order.number} (${order.product_name})`, problem, 'It reached our secret address but failed the order check. Nothing was recorded as paid.']).catch(() => {});
    return sendJson(res, 400, { status: 'error', message: 'rejected' });
  }

  if (notice.kind === 'cancelled') {
    // A refund: the confirmation of a cancel request we made, the notice of one already recorded, or a cancel made
    // in CiderPay's dashboard (a person records its amount: the notice alone doesn't say how much went back).
    const outcome = await refunds.fromCiderpay(order, notice, payload);
    return outcome === 'rejected' ? sendJson(res, 400, { status: 'error', message: 'rejected' }) : done(res, outcome);
  }

  const r = await flow.confirm(order, {
    provider: 'ciderpay', currency: 'KRW', amount: notice.amount, ref: notice.orderNo, approvalNo: notice.approvalNo,
    refundToken: notice.refundToken, method: notice.method, receiptUrl: notice.receiptUrl, raw: payload,
  }, { sendNow: true });
  return r.outcome === 'rejected' ? sendJson(res, 400, { status: 'error', message: 'rejected' }) : done(res, r.outcome);
}

const NEEDS_A_PERSON = /^(PAYMENT\.CAPTURE\.(REVERSED|DENIED)|CUSTOMER\.DISPUTE\.)/;

async function fromPaypal(req, res, state) {
  const { text, data: event } = await readBody(req);
  let genuine = false;
  try {
    genuine = await paypal.verifyWebhook(req.headers, event, { rawText: text });
  } catch (err) {
    console.error('shop-callback: PayPal webhook could not be verified', err.message);
    return sendJson(res, 500, { status: 'error', message: 'verification unavailable' });
  }
  if (!genuine) {
    console.warn('shop-callback: a PayPal webhook was refused (signature not confirmed by PayPal)');
    return sendJson(res, 403, { status: 'error', message: 'forbidden' });
  }
  state.verified = true;

  const type = String(event.event_type || '');
  const resource = event.resource || {};
  const brief = { event_type: type, id: event.id, resource_id: resource.id };

  if (type === 'CHECKOUT.ORDER.APPROVED') {
    // The buyer approved but may never come back to our page: capture now.
    const order = await orders.byProviderRequest('paypal', resource.id);
    if (!order) {
      await orders.logCallback({ provider: 'paypal', outcome: 'ignored', reason: 'approved order we do not know', payload: brief });
      return done(res, 'ignored');
    }
    const r = await flow.settlePaypal(order, { sendNow: true });
    return done(res, r.outcome);
  }

  if (type === 'PAYMENT.CAPTURE.COMPLETED') {
    const capture = paypal.readCapture(resource);
    const related = ((resource.supplementary_data || {}).related_ids || {}).order_id;
    const order = (await orders.byToken(capture.customId)) || (await orders.byProviderRequest('paypal', related));
    if (!order) {
      await orders.logCallback({ provider: 'paypal', outcome: 'ignored', reason: 'capture for an order we do not know', payload: brief });
      return done(res, 'ignored');
    }
    const r = await flow.confirmCapture(order, capture, { sendNow: true });
    return done(res, r.outcome);
  }

  if (type === 'PAYMENT.CAPTURE.REFUNDED') {
    // A refund: ours confirmed, or one made inside PayPal (recorded as PayPal reports it).
    return done(res, await refunds.fromPaypal(resource, brief));
  }

  await orders.logCallback({ provider: 'paypal', outcome: 'ignored', reason: type || 'no event type', payload: brief });
  if (NEEDS_A_PERSON.test(type)) {
    await notify.attention(`PayPal reports ${type}`, ['A reversal or dispute: check PayPal, then refund or record it on the order in the admin.']).catch(() => {});
  }
  return done(res, 'ignored');
}

// The contact's email from AC's webhook body (form fields contact[email], or JSON { contact: { email } }).
function acEmail(data) {
  const c = data.contact && typeof data.contact === 'object' ? data.contact : {};
  return String(data['contact[email]'] || c.email || data.email || '').trim().toLowerCase();
}

async function fromAcCoupon(req, res, url, state) {
  if (!config.safeEqual(url.searchParams.get('k') || '', config.acCouponKey())) return sendJson(res, 403, { status: 'error', message: 'forbidden' });
  state.verified = true;
  const { text, data: parsed } = await readBody(req);
  let data = parsed;
  if (text && text.trim().startsWith('{')) { try { data = JSON.parse(text); } catch (_) { /* keep the form fields */ } }
  const key = String(url.searchParams.get('campaign') || '');
  const email = acEmail(data);
  const brief = { campaign: key, email };
  const campaign = await coupons.campaignByKey(key);
  if (!campaign || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await orders.logCallback({ provider: 'ac-coupon', outcome: 'rejected', reason: campaign ? 'no contact email in the webhook' : `no coupon campaign "${key}"`, payload: brief });
    return sendJson(res, campaign ? 400 : 404, { status: 'error', message: campaign ? 'no email' : 'unknown campaign' });
  }
  let r;
  try {
    r = await coupons.issue(campaign, [email], { by: 'ac', resend: true });
  } catch (err) {
    if (!(err instanceof coupons.CouponError)) throw err;
    await orders.logCallback({ provider: 'ac-coupon', outcome: 'rejected', reason: err.message, payload: brief });
    return sendJson(res, 409, { status: 'error', message: err.code });
  }
  const given = r.created[0] || r.kept[0];
  await orders.logCallback({ provider: 'ac-coupon', outcome: r.created.length ? 'issued' : 'kept', reason: given ? given.code : '', payload: brief });
  // Write the fields and the tag now (short budget: AC is waiting); the rest goes with the daily job.
  try { await sync.process({ budgetMs: 5000 }); } catch (err) { console.error('shop-callback: AC send after coupon', err.message); }
  return done(res, r.created.length ? 'issued' : 'kept');
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  const provider = url.searchParams.get('p');
  if (req.method !== 'POST') return sendJson(res, 405, { status: 'error', message: 'POST required' });
  const state = { verified: false }; // set once the notice is proven to come from the provider
  try {
    if (!config.configured()) throw new Error('SHOP_SECRET is not set');
    if (provider === 'ciderpay') return await fromCiderpay(req, res, url, state);
    if (provider === 'paypal') return await fromPaypal(req, res, state);
    if (provider === 'ac-coupon') return await fromAcCoupon(req, res, url, state);
    return sendJson(res, 404, { status: 'error', message: 'unknown provider' });
  } catch (err) {
    console.error('shop-callback', provider, err);
    if (state.verified) await orders.logCallback({ provider, outcome: 'error', reason: err.message }).catch(() => {});
    return sendJson(res, err.status === 413 ? 413 : 500, { status: 'error', message: 'server error' });
  }
};
