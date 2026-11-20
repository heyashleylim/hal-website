/*
 * Refunds (phase 3, docs/commerce-plan.md 3.2): one click in the admin, and everything follows.
 *
 *   request()       the admin asks: the amount is reserved on the order, then CiderPay (cancel, or cancel request
 *                   once settled) or PayPal (refund) is called
 *   record()        a refund already made at the provider (CiderPay's dashboard…), written down by a person
 *   resolve()       a call whose answer never came: a person checked the provider and says whether it happened
 *   fromCiderpay()  CiderPay's CANCEL notice: confirms a cancel request, or tells us of a dashboard cancel
 *   fromPaypal()    PayPal's PAYMENT.CAPTURE.REFUNDED webhook: confirms ours, or records one made inside PayPal
 *
 * Once the money has gone back (finish): a refund payment, its negative tax lines and the order's totals and status are
 * written by ONE statement, once. Then: ActiveCampaign (refund tag and fields; on a full refund the purchase tags
 * are removed), podcast access revoked on a full refund, Slack.
 *
 * Money is never sent back twice: request() and record() reserve the amount on the order (refund_pending) with a
 * single UPDATE that only succeeds while paid − refunded − reserved still covers it, and the database refuses any
 * order whose refunds would exceed what was paid (shop_orders_refund_fits).
 */
const db = require('../db.js');
const ledger = require('./ledger.js');
const pricing = require('./pricing.js');
const sync = require('./sync.js');
const notify = require('./notify.js');
const orders = require('./orders.js');
const ciderpay = require('./pay/ciderpay.js');
const paypal = require('./pay/paypal.js');
const enrolments = require('../enrolments.js');

const OPEN = ['sending', 'requested', 'check'];
const REFUNDABLE = ['paid', 'partially_refunded', 'refund_requested'];

class RefundError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true; // shown to the admin as is
  }
}

// ---------- rules (pure) ----------

// What is left to give back on each payment: its amount minus every refund that isn't failed. → Map(paymentId → amount)
function remaining(payments, refunds) {
  const left = new Map();
  for (const p of payments) if (p.kind === 'payment') left.set(p.id, p.amount);
  for (const r of refunds) if (r.status !== 'failed' && left.has(r.payment_id)) left.set(r.payment_id, left.get(r.payment_id) - r.amount);
  return left;
}

// The payment a refund of `amount` comes out of: the latest one with enough left. Throws RefundError.
function choosePayment(payments, refunds, amount) {
  if (!Number.isInteger(amount) || amount <= 0) throw new RefundError('The amount must be more than zero.');
  const left = remaining(payments, refunds);
  const total = [...left.values()].reduce((s, n) => s + Math.max(0, n), 0);
  if (amount > total) throw new RefundError(`That is more than what is left to refund on this order (${total}).`);
  const candidates = payments.filter((p) => p.kind === 'payment' && left.get(p.id) >= amount);
  if (!candidates.length) throw new RefundError('No single payment of this order covers that amount: refund it in parts, one per payment.');
  const payment = candidates[candidates.length - 1];
  return { payment, left: left.get(payment.id), full: amount === payment.amount && left.get(payment.id) === payment.amount };
}

// The part of a product's purchase tag that names it in other tags: purchased_nsmb_03_202701 → nsmb_03_202701.
function tagKey(product) {
  const tag = String((product && product.purchase_tag) || '').trim();
  const m = /^purchased_(.+)$/i.exec(tag);
  return m ? m[1] : String((product && product.slug) || 'product').replace(/-/g, '_');
}

// Every tag the order's purchase added in ActiveCampaign (product, add-ons, pricing option).
function purchaseTags(order, product, addons = []) {
  const optionTag = order.price_option && order.price_option.tag;
  return [...new Set([...[product, ...addons].flatMap((p) => [p.purchase_tag, ...(p.extra_tags || [])]), optionTag]
    .map((t) => String(t || '').trim()).filter(Boolean))];
}

/*
 * What a refund sends to ActiveCampaign (pure): [{ op, payload, dedupe }].
 *   full refund:  refund_<product>, the purchase tags removed (Ashley's refund email starts from the tag)
 *   partial:      refund_partial_<product>, purchase tags kept
 *   both:         REFUND_AMOUNT, REFUND_DATE
 */
function refundOps(order, product, addons, refund, { full }) {
  const key = `o${order.id}:refund${refund.id}`;
  const ops = [{ op: 'tag_add', payload: { tag: `${full ? 'refund' : 'refund_partial'}_${tagKey(product)}` }, dedupe: `${key}:tag` }];
  if (full) for (const tag of purchaseTags(order, product, addons)) ops.push({ op: 'tag_remove', payload: { tag }, dedupe: `${key}:untag:${tag}` });
  ops.push({
    op: 'fields',
    payload: { fields: { REFUND_AMOUNT: pricing.formatMoney(refund.amount, refund.currency), REFUND_DATE: ledger.seoul(refund.done_at || new Date()).date } },
    dedupe: `${key}:fields`,
  });
  return ops;
}

function slackText(order, refund, { full }) {
  const name = (order.billing || {}).name || '';
  const how = refund.origin === 'provider' ? ' (made in PayPal)' : refund.origin === 'recorded' ? ' (made at the provider, recorded by hand)' : '';
  return [`↩️ ${full ? 'Refunded' : 'Partly refunded'} ${pricing.formatMoney(refund.amount, refund.currency)}${how}`,
    `${name} - ${orders.orderName(order)} [${order.number}]`, refund.reason ? `Reason: ${refund.reason}` : '', refund.by ? `By: ${refund.by}` : ''].filter(Boolean).join('\n');
}

// ---------- database ----------

async function load(orderId) {
  const order = await db.one('SELECT * FROM shop_orders WHERE id = $1', [orderId]);
  if (!order) throw new RefundError('Order not found.');
  const [payments, refunds] = await Promise.all([
    db.query(`SELECT * FROM shop_payments WHERE order_id = $1 ORDER BY at, id`, [orderId]),
    db.query(`SELECT * FROM shop_refunds WHERE order_id = $1 ORDER BY id`, [orderId]),
  ]);
  return { order, payments, refunds };
}

// Reserves `amount` on the order (once only). False when the order no longer covers it.
async function reserve(orderId, amount) {
  const row = await db.one(
    `UPDATE shop_orders SET refund_pending = refund_pending + $2, updated_at = now()
      WHERE id = $1 AND status = ANY($3::text[]) AND paid_total - refunded_total - refund_pending >= $2 RETURNING id`,
    [orderId, amount, REFUNDABLE]);
  return Boolean(row);
}

// The order's status from its totals and open refunds (SQL, for statements that change them).
const STATUS_SQL = (o, refunded, pending, exceptId) => `CASE
    WHEN ${o}.status NOT IN ('paid', 'partially_refunded', 'refund_requested', 'refunded') THEN ${o}.status
    WHEN ${refunded} >= ${o}.paid_total AND ${o}.paid_total > 0 THEN 'refunded'
    WHEN EXISTS (SELECT 1 FROM shop_refunds x WHERE x.order_id = ${o}.id AND x.id <> ${exceptId} AND x.status IN ('requested', 'check')) THEN 'refund_requested'
    WHEN ${refunded} > 0 THEN 'partially_refunded'
    ELSE 'paid' END`;

async function setStatus(orderId, status) {
  await db.query(`UPDATE shop_orders SET status = $2, updated_at = now() WHERE id = $1 AND status = ANY($3::text[])`, [orderId, status, REFUNDABLE]);
}

// A refund that did not happen: the reservation is released and the order's status put back.
async function fail(refundId, error) {
  await db.query(
    `WITH r AS (UPDATE shop_refunds SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 AND status = ANY($3::text[]) RETURNING *)
     UPDATE shop_orders o SET refund_pending = o.refund_pending - CASE WHEN r.origin IN ('admin', 'recorded') THEN r.amount ELSE 0 END,
            status = ${STATUS_SQL('o', 'o.refunded_total', 'o.refund_pending', 'r.id')}, updated_at = now()
       FROM r WHERE o.id = r.order_id`,
    [refundId, String(error || '').slice(0, 500), OPEN]);
}

/*
 * The money went back: writes the refund payment, its tax lines, the order's totals and status, and marks the
 * refund done — one statement, once (a second call finds nothing open and does nothing).
 * → { finished: true, order, refund } the first time; { finished: false } otherwise.
 */
async function finish(refundId, { ref = null, fee = null, raw = {}, notice = false } = {}) {
  const refund = await db.one('SELECT * FROM shop_refunds WHERE id = $1', [refundId]);
  if (!refund || !OPEN.includes(refund.status)) return { finished: false };
  const order = await db.one('SELECT * FROM shop_orders WHERE id = $1', [refund.order_id]);
  const sold = await orders.items(order.id);
  const at = new Date();
  const feeBack = fee == null ? refund.fee : fee;
  const base = { kind: 'refund', amount: refund.amount, fee: feeBack, provider: refund.provider, method: 'refund', at };
  const ls = ledger.lines({ payment: base, order, items: sold.length ? sold : [{ amount: order.total, vat_rule: 'taxable' }], note: refund.reason });
  const row = await db.one(
    `WITH pay AS (
       INSERT INTO shop_payments (order_id, provider, kind, currency, amount, fee, provider_ref, method, raw, at, refund_of)
       SELECT r.order_id, r.provider, 'refund', r.currency, r.amount, $2::int, 'refund-' || r.id, 'refund', $3::jsonb, $4::timestamptz, r.payment_id
         FROM shop_refunds r WHERE r.id = $1 AND r.status = ANY($5::text[])
       ON CONFLICT (provider, kind, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
       RETURNING id, order_id, amount),
     led AS (
       INSERT INTO shop_ledger (at, order_id, payment_id, kind, provider, method, currency, amount, supply, vat, vat_rule, fee, note)
       SELECT $4::timestamptz, pay.order_id, pay.id, 'refund', $6::text, 'refund', $7::text, l.amount, l.supply, l.vat, l.rule, l.fee, $8::text
         FROM pay, unnest($9::int[], $10::int[], $11::int[], $12::text[], $13::int[]) AS l(amount, supply, vat, rule, fee)
       RETURNING id),
     ref AS (
       UPDATE shop_refunds r SET status = 'done', refund_payment_id = pay.id, done_at = $4::timestamptz, updated_at = now(),
              provider_ref = COALESCE(r.provider_ref, $14::text), fee = COALESCE($2::int, r.fee),
              notice_at = CASE WHEN $15::boolean THEN COALESCE(r.notice_at, now()) ELSE r.notice_at END
         FROM pay WHERE r.id = $1
       RETURNING r.*),
     ord AS (
       UPDATE shop_orders o
          SET refunded_total = o.refunded_total + pay.amount,
              refund_pending = o.refund_pending - CASE WHEN $16::text IN ('admin', 'recorded') THEN pay.amount ELSE 0 END,
              status = ${STATUS_SQL('o', '(o.refunded_total + pay.amount)', 'o.refund_pending', '$1::int')},
              updated_at = now()
         FROM pay WHERE o.id = pay.order_id
       RETURNING o.*)
     SELECT (SELECT id FROM pay) AS payment_id, (SELECT count(*)::int FROM led) AS lines, (SELECT row_to_json(ord) FROM ord) AS order_row,
            (SELECT row_to_json(ref) FROM ref) AS refund_row`,
    [refund.id, feeBack, JSON.stringify(raw || {}), at.toISOString(), OPEN, refund.provider, refund.currency, refund.reason,
      ls.map((l) => l.amount), ls.map((l) => l.supply), ls.map((l) => l.vat), ls.map((l) => l.vat_rule), ls.map((l) => l.fee),
      ref, Boolean(notice), refund.origin],
  );
  if (!row || !row.payment_id) return { finished: false };
  if (!row.order_row || row.lines !== ls.length) throw new Error(`refund ${refund.id}: the payment, its tax lines and the order were not written together`);
  const done = { order: row.order_row, refund: row.refund_row };
  await after(done.order, done.refund);
  return { finished: true, ...done };
}

// After the money went back (never undoes it, never fails the caller): ActiveCampaign, podcast access, Slack.
async function after(order, refund) {
  const step = async (name, fn) => { try { await fn(); } catch (err) { console.error(`shop: order ${order.number} refund ${refund.id}: ${name} failed`, err); } };
  const full = order.status === 'refunded';
  const product = await db.one('SELECT * FROM shop_products WHERE id = $1', [order.product_id]);
  const addons = await db.query(
    `SELECT p.* FROM shop_order_items i JOIN shop_products p ON p.id = i.product_id WHERE i.order_id = $1 AND i.kind = 'addon' ORDER BY i.position`, [order.id]);
  await step('ActiveCampaign queue', async () => {
    for (const x of refundOps(order, product, addons, refund, { full })) await sync.enqueue({ customerId: order.customer_id, orderId: order.id, ...x });
  });
  // A fully refunded instalment order: no more charges (the plan is stopped, at CiderPay too).
  if (full && order.plan === 'instalment' && ['active', 'overdue', 'paused'].includes(order.plan_status)) {
    await step('stop the instalment plan', async () => {
      const r = await require('./instalments.js').stop(order.id, { by: 'refund', reason: 'order fully refunded', force: true });
      if (!r.endedAtCiderpay) await notify.attention('a refunded instalment plan could not be ended at CiderPay', [`Order ${order.number} (${orders.orderName(order)})`, 'End the plan in CiderPay’s dashboard, or the card will be charged again.']);
    });
  }
  if (full) {
    await step('podcast access', async () => {
      const customer = await db.one('SELECT email FROM shop_customers WHERE id = $1', [order.customer_id]);
      const r = await enrolments.revokeByTags(customer.email, purchaseTags(order, product, addons));
      if (r.revoked.length) await orders.logCallback({ provider: refund.provider, outcome: 'access_revoked', reason: r.result, orderId: order.id });
    });
  }
  await step('Slack', () => notify.send(slackText(order, refund, { full })));
  await step('ActiveCampaign send', () => sync.process({ orderId: order.id, budgetMs: 4000 }));
}

// A refund asked for in the admin (or recorded by a person): checked, reserved, written as a row.
async function open({ orderId, amount, reason, by, origin }) {
  const { order, payments, refunds } = await load(orderId);
  if (!REFUNDABLE.includes(order.status)) throw new RefundError(`An order that is “${order.status}” can’t be refunded.`);
  const busy = refunds.find((r) => r.status === 'sending');
  if (busy) throw new RefundError('Another refund of this order is being sent right now: wait a few seconds and reload.');
  const { payment, full } = choosePayment(payments, refunds, amount);
  if (!(await reserve(order.id, amount))) throw new RefundError('That is more than what is left to refund on this order: reload the order.');
  const provider = origin === 'recorded' && !['ciderpay', 'paypal'].includes(payment.provider) ? 'manual' : payment.provider;
  const refund = await db.one(
    `INSERT INTO shop_refunds (order_id, payment_id, provider, currency, amount, reason, by, origin, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'sending') RETURNING *`,
    [order.id, payment.id, provider, order.currency, amount, String(reason || '').slice(0, 300), String(by || '').slice(0, 100), origin]);
  return { order, payment, refund, full };
}

/*
 * The admin asks for a refund. → { status: 'done' | 'requested' | 'check' | 'failed', message, refund }
 * Throws RefundError when it can't be asked (amount, order state).
 */
async function request({ orderId, amount, reason, by }) {
  const why = String(reason || '').trim();
  if (!why) throw new RefundError('Give a reason: it is kept with the refund and shown in the tax records.');
  const { order, payment, refund, full } = await open({ orderId, amount, reason: why, by, origin: 'admin' });
  let r;
  try {
    if (payment.provider === 'ciderpay') {
      r = await ciderpay.cancelPayment({ orderNo: payment.provider_ref, refundToken: payment.refund_token, amount, full, reason: why });
    } else if (payment.provider === 'paypal') {
      r = await paypal.refundCapture({ captureId: payment.provider_ref, amount, currency: order.currency, key: `r${refund.id}`, note: '' });
    } else {
      r = { outcome: 'refused', detail: `payments made with “${payment.provider}” can’t be refunded from here: refund it yourself, then use “Record a refund”` };
    }
  } catch (err) {
    if (err instanceof ciderpay.PayError && err.code === 'unknown') {
      // We can't know whether the provider refunded it. The amount stays reserved; a person checks.
      await db.query(`UPDATE shop_refunds SET status = 'check', error = $2, updated_at = now() WHERE id = $1 AND status = 'sending'`, [refund.id, String(err.message).slice(0, 500)]);
      await setStatus(order.id, 'refund_requested');
      await notify.attention('a refund needs checking', [`Order ${order.number} (${orders.orderName(order)}): ${pricing.formatMoney(amount, order.currency)}`, err.message,
        `Check ${payment.provider === 'paypal' ? 'PayPal' : 'CiderPay'}’s dashboard, then say in the admin whether it went through.`]).catch(() => {});
      return { status: 'check', message: 'No answer from the provider: check its dashboard, then say below whether the refund went through.', refund };
    }
    await fail(refund.id, err.message);
    throw new RefundError(`The refund could not be sent: ${err.message}`);
  }
  // From here the provider has answered. Its refund id is kept so its webhook finds this refund.
  if (r.refund && r.refund.id) await db.query(`UPDATE shop_refunds SET provider_ref = $2 WHERE id = $1 AND provider_ref IS NULL`, [refund.id, r.refund.id]).catch((err) => console.error('shop: refund id not saved', err));
  if (r.outcome === 'done') {
    try {
      await finish(refund.id, { ref: r.refund ? r.refund.id : null, fee: r.refund ? r.refund.fee : null, raw: r.raw || r.refund || {} });
    } catch (err) {
      // The money went back but recording failed: a person confirms it ("It went through"), which records it.
      console.error(`shop: refund ${refund.id} was made but not recorded`, err);
      await db.query(`UPDATE shop_refunds SET status = 'check', error = $2, updated_at = now() WHERE id = $1 AND status = 'sending'`, [refund.id, `refunded by the provider, but not recorded: ${String(err.message).slice(0, 300)}`]).catch(() => {});
      await setStatus(order.id, 'refund_requested').catch(() => {});
      await notify.attention('a refund was made but not recorded', [`Order ${order.number}: ${pricing.formatMoney(amount, order.currency)}`, 'Open the order and press “It went through” to record it.']).catch(() => {});
      return { status: 'check', message: 'The provider refunded it, but recording it failed: press “It went through” below to record it.', refund };
    }
    return { status: 'done', message: 'Refunded.', refund };
  }
  if (r.outcome === 'requested') {
    await db.query(`UPDATE shop_refunds SET status = 'requested', updated_at = now() WHERE id = $1 AND status = 'sending'`, [refund.id]);
    await setStatus(order.id, 'refund_requested');
    return { status: 'requested', message: payment.provider === 'ciderpay'
      ? 'CiderPay has already settled this payment, so it accepted a cancel request: the order is updated when CiderPay confirms.'
      : 'PayPal is processing the refund: the order is updated when PayPal confirms.', refund };
  }
  await fail(refund.id, r.detail);
  return { status: 'failed', message: `${payment.provider === 'paypal' ? 'PayPal' : 'CiderPay'} refused the refund: ${r.detail}. Nothing was refunded.`, refund };
}

// A refund already made at the provider, written down by a person (no provider is called).
async function record({ orderId, amount, reason, by }) {
  const why = String(reason || '').trim();
  if (!why) throw new RefundError('Give a reason: it is kept with the refund and shown in the tax records.');
  const { refund } = await open({ orderId, amount, reason: why, by, origin: 'recorded' });
  const r = await finish(refund.id, { raw: { recorded_by: by } });
  if (!r.finished) throw new Error(`refund ${refund.id} could not be recorded`);
  return { status: 'done', message: 'Recorded.', refund };
}

// A refund whose answer never came ("check"), or a cancel request still waiting: a person says what happened.
async function resolve({ refundId, happened, by }) {
  const refund = await db.one('SELECT * FROM shop_refunds WHERE id = $1', [refundId]);
  if (!refund) throw new RefundError('Refund not found.');
  if (!['check', 'requested'].includes(refund.status)) throw new RefundError(`This refund is already “${refund.status}”.`);
  if (happened) {
    await db.query(`UPDATE shop_refunds SET by = by || $2, updated_at = now() WHERE id = $1`, [refund.id, by ? ` (confirmed by ${by})` : '']);
    const r = await finish(refund.id, { raw: { confirmed_by: by } });
    return { status: r.finished ? 'done' : refund.status, refund };
  }
  await fail(refund.id, `did not happen (checked by ${by || 'admin'})`);
  return { status: 'failed', refund };
}

/*
 * CiderPay's CANCEL notice for `order` (already checked: our merchant, token, signature). →
 *   'refunded'   it confirms a refund we asked for (cancel request, or a call whose answer never came)
 *   'duplicate'  the notice of a refund already recorded
 *   'attention'  a cancel made in CiderPay's dashboard: a person records it (the notice doesn't say how much)
 *   'rejected'   it names a payment that isn't this order's
 */
async function fromCiderpay(order, notice, payload) {
  const payment = await db.one(`SELECT * FROM shop_payments WHERE order_id = $1 AND provider = 'ciderpay' AND kind = 'payment' AND provider_ref = $2`, [order.id, notice.orderNo]);
  if (!payment) {
    await orders.logCallback({ provider: 'ciderpay', outcome: 'rejected', reason: `cancel notice for CiderPay order ${notice.orderNo}, not a payment of this order`, orderId: order.id, payload });
    return 'rejected';
  }
  const waiting = await db.one(`SELECT * FROM shop_refunds WHERE payment_id = $1 AND status = ANY($2::text[]) ORDER BY id LIMIT 1`, [payment.id, OPEN]);
  if (waiting) {
    const r = await finish(waiting.id, { raw: payload, notice: true });
    await orders.logCallback({ provider: 'ciderpay', outcome: r.finished ? 'refunded' : 'duplicate', reason: `confirms refund ${waiting.id}`, orderId: order.id, payload });
    return r.finished ? 'refunded' : 'duplicate';
  }
  const known = await db.one(`UPDATE shop_refunds SET notice_at = now() WHERE id = (SELECT id FROM shop_refunds WHERE payment_id = $1 AND status = 'done' AND notice_at IS NULL ORDER BY id LIMIT 1) RETURNING id`, [payment.id]);
  if (known) {
    await orders.logCallback({ provider: 'ciderpay', outcome: 'duplicate', reason: `notice of refund ${known.id}, already recorded`, orderId: order.id, payload });
    return 'duplicate';
  }
  const fully = await db.one(`SELECT 1 AS x FROM shop_orders WHERE id = $1 AND status = 'refunded'`, [order.id]);
  if (fully) {
    await orders.logCallback({ provider: 'ciderpay', outcome: 'duplicate', reason: 'cancel notice for an order already fully refunded', orderId: order.id, payload });
    return 'duplicate';
  }
  await orders.logCallback({ provider: 'ciderpay', outcome: 'attention', reason: 'cancelled in CiderPay’s dashboard: record the refund on the order', orderId: order.id, payload });
  await notify.attention('CiderPay reports a cancellation made in its dashboard', [`Order ${order.number} (${orders.orderName(order)})`,
    'Open the order in the admin and use “Record a refund made at CiderPay” with the amount refunded, so the tax records and ActiveCampaign follow.']).catch(() => {});
  return 'attention';
}

/*
 * PayPal's PAYMENT.CAPTURE.REFUNDED webhook (already verified with PayPal). `resource` is the refund. →
 *   'refunded' | 'duplicate' | 'ignored' | 'attention'
 */
async function fromPaypal(resource, brief) {
  const r = paypal.readRefund(resource);
  const log = (outcome, reason, orderId = null) => orders.logCallback({ provider: 'paypal', outcome, reason, orderId, payload: brief });
  if (!r.id || r.status !== 'COMPLETED' || r.currency !== 'USD' || !r.amount) { await log('ignored', `refund ${r.id || '?'} ${r.status || ''}`); return 'ignored'; }
  // Ours: custom_id "r<id>" (sent with the refund call) or the refund id we stored.
  const ourId = /^r(\d{1,9})$/.exec(r.customId);
  let refund = ourId ? await db.one(`SELECT * FROM shop_refunds WHERE id = $1 AND provider = 'paypal'`, [Number(ourId[1])]) : null;
  if (!refund) refund = await db.one(`SELECT * FROM shop_refunds WHERE provider = 'paypal' AND provider_ref = $1`, [r.id]);
  if (refund) {
    const payment = await db.one('SELECT provider_ref FROM shop_payments WHERE id = $1', [refund.payment_id]);
    if (r.captureId && payment.provider_ref !== r.captureId) { await log('rejected', `refund ${r.id} names capture ${r.captureId}, not this refund’s`, refund.order_id); return 'ignored'; }
    if (refund.status === 'failed') {
      await log('attention', `PayPal says refund ${r.id} went through, but it was marked failed here`, refund.order_id);
      await notify.attention('PayPal reports a refund that was marked failed here', [`Refund ${r.id}: check PayPal and the order, then record it if the money really went back.`]).catch(() => {});
      return 'attention';
    }
    if (refund.status === 'done') {
      await db.query(`UPDATE shop_refunds SET notice_at = COALESCE(notice_at, now()), provider_ref = COALESCE(provider_ref, $2) WHERE id = $1`, [refund.id, r.id]);
      await log('duplicate', `refund ${r.id} already recorded`, refund.order_id);
      return 'duplicate';
    }
    await db.query(`UPDATE shop_refunds SET provider_ref = COALESCE(provider_ref, $2) WHERE id = $1`, [refund.id, r.id]);
    const f = await finish(refund.id, { ref: r.id, fee: r.fee, raw: brief, notice: true });
    await log(f.finished ? 'refunded' : 'duplicate', `refund ${r.id}`, refund.order_id);
    return f.finished ? 'refunded' : 'duplicate';
  }
  // Made inside PayPal: recorded as PayPal reports it.
  const payment = r.captureId ? await db.one(`SELECT * FROM shop_payments WHERE provider = 'paypal' AND kind = 'payment' AND provider_ref = $1`, [r.captureId]) : null;
  if (!payment) { await log('ignored', `refund ${r.id} for a capture we do not know`); return 'ignored'; }
  try {
    const row = await db.one(
      `INSERT INTO shop_refunds (order_id, payment_id, provider, currency, amount, reason, by, origin, status, provider_ref, fee)
       VALUES ($1, $2, 'paypal', 'USD', $3, 'Made in PayPal', 'PayPal', 'provider', 'sending', $4, $5)
       ON CONFLICT (provider, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING RETURNING id`,
      [payment.order_id, payment.id, r.amount, r.id, r.fee]);
    if (!row) { await log('duplicate', `refund ${r.id} already recorded`, payment.order_id); return 'duplicate'; }
    try {
      const f = await finish(row.id, { ref: r.id, fee: r.fee, raw: brief, notice: true });
      await log(f.finished ? 'refunded' : 'duplicate', `refund ${r.id} made in PayPal`, payment.order_id);
      return f.finished ? 'refunded' : 'duplicate';
    } catch (err) {
      await fail(row.id, err.message);
      throw err;
    }
  } catch (err) {
    console.error('shop: PayPal refund could not be recorded', err);
    await log('attention', `refund ${r.id} could not be recorded: ${err.message}`, payment.order_id);
    await notify.attention('a PayPal refund could not be recorded', [`Refund ${r.id} (${pricing.formatMoney(r.amount, 'USD')})`, err.message, 'Check the order in the admin.']).catch(() => {});
    return 'attention';
  }
}

// Daily job: a refund still "sending" after 15 minutes means its call was cut off (the function stopped): a person checks.
async function sweep() {
  const rows = await db.query(
    `UPDATE shop_refunds SET status = 'check', error = 'the call to the provider was interrupted', updated_at = now()
      WHERE status = 'sending' AND created_at < now() - interval '15 minutes' RETURNING id, order_id`);
  for (const r of rows) await setStatus(r.order_id, 'refund_requested');
  if (rows.length) await notify.attention('refunds need checking', [`${rows.length} refund(s) were interrupted while being sent: open Shop → Orders (status “Refund requested”) and say whether each went through.`]).catch(() => {});
  return rows.length;
}

module.exports = { RefundError, OPEN, REFUNDABLE, remaining, choosePayment, tagKey, purchaseTags, refundOps, slackText, request, record, resolve, finish, fromCiderpay, fromPaypal, sweep };
