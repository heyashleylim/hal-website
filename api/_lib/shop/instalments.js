/*
 * Instalment plans (phase 3; docs/commerce-plan.md 3.2 and section 14). KRW only, through CiderPay's 정기 결제.
 *
 * How a plan runs:
 *   1. Checkout: the order is created with its schedule (shop_instalments: number 1 = paid at checkout, then one per
 *      month) and its terms (plan_terms). CiderPay is asked for an agreement page (ciderpay.requestPlan) that also
 *      charges the first payment.
 *   2. CiderPay's notices (fromCiderpay):
 *        agreeRegularPayment   the buyer agreed: the plan's token (rpToken) is kept, to pause or end the plan
 *        rejectRegularPayment  the buyer refused: the unpaid order is cancelled
 *        completeRpPayment     a charge went through (turnSeq 0 = the first payment, 1 = the second…): recorded
 *                              with its tax line, the instalment marked paid, ActiveCampaign and Slack told
 *        errorRpPayment        a charge failed: the instalment is "failed", the plan "overdue", Slack at once,
 *                              ActiveCampaign tag instalment_failed_<product> (the customer's email starts from it)
 *   3. Every morning (checkLate): an instalment whose date has passed by GRACE_DAYS without any word from CiderPay is
 *      "overdue", with the same alert. This doesn't depend on CiderPay telling us anything.
 *   4. The last instalment received: the plan is "completed" and the agreement is ended at CiderPay (destroyMp).
 *   5. In the admin: pause / resume / stop the plan (at CiderPay too), or record an instalment paid another way.
 *      A full refund of the order stops the plan.
 *
 * Money really received is never dropped, and never recorded twice: a charge for an instalment already paid (or
 * for a stopped plan) is held for a person, with a Slack alert, exactly like a second payment of a paid order.
 */
const db = require('../db.js');
const pricing = require('./pricing.js');
const ledger = require('./ledger.js');
const orders = require('./orders.js');
const sync = require('./sync.js');
const notify = require('./notify.js');
const settings = require('./settings.js');
const config = require('./config.js');
const ciderpay = require('./pay/ciderpay.js');

const GRACE_DAYS = 2;       // a charge can come late in the day, and its notice later still
const OPEN = ['due', 'failed', 'overdue'];
const RUNNING = ['active', 'overdue', 'paused'];

class PlanError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true; // shown to the admin as is
  }
}

// ---------- rules (pure) ----------

// The plan's state from its schedule. 'stopped' stays stopped; 'paused' stays paused until resumed (or completed).
function planStatus(rows, current) {
  if (current === 'stopped') return 'stopped';
  const live = rows.filter((r) => r.status !== 'cancelled');
  if (live.length && live.every((r) => r.status === 'paid')) return 'completed';
  if (current === 'paused') return 'paused';
  if (live.some((r) => r.status === 'failed' || r.status === 'overdue')) return 'overdue';
  return 'active';
}

// 'YYYY-MM-DD' + n days.
function addDays(date, n) {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const dateOf = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

// Instalments still 'due' whose date passed more than `grace` days before `today` (Seoul dates).
function lateRows(rows, today, grace = GRACE_DAYS) {
  return rows.filter((r) => r.status === 'due' && addDays(dateOf(r.due_date), grace) < today);
}

// The next instalment to be paid (the earliest one not paid), or null.
function nextOpen(rows) {
  return rows.filter((r) => OPEN.includes(r.status)).sort((a, b) => a.number - b.number)[0] || null;
}

// The ActiveCampaign fields of a running plan (empty once nothing is left).
function planFields(order, rows) {
  const next = nextOpen(rows);
  const left = rows.filter((r) => OPEN.includes(r.status)).reduce((s, r) => s + r.amount, 0);
  return {
    INSTALMENT_NEXT_DATE: next ? dateOf(next.due_date) : '',
    INSTALMENT_NEXT_AMOUNT: next ? pricing.formatMoney(next.amount, order.currency) : '',
    INSTALMENT_REMAINING: left ? pricing.formatMoney(left, order.currency) : '',
  };
}

// nsmb_03_202701 from purchased_nsmb_03_202701 (the part every tag of the product shares; refunds.tagKey).
function tagKey(product) {
  return require('./refunds.js').tagKey(product);
}

/*
 * What a plan event sends to ActiveCampaign (pure): [{ op, payload, dedupe }].
 *   started    instalment_active_<product>
 *   paid       instalment_paid_<product>_<n> (n = the instalment's number, 2 for the first monthly one);
 *              instalment_failed_<product> removed (it was paid after all)
 *   completed  instalment_completed_<product>; instalment_active_ and instalment_failed_ removed
 *   failed     instalment_failed_<product> (once per instalment: an automation emails the customer)
 *   stopped    cancelled_<product>; instalment_active_ removed
 * Each carries the fields INSTALMENT_NEXT_DATE / _NEXT_AMOUNT / _REMAINING, written before the tag (an automation
 * started by the tag already finds them).
 */
function planOps(order, product, event, { number = null, rows = [] } = {}) {
  const k = tagKey(product);
  const key = `o${order.id}:plan:${event}${number ? ':' + number : ''}`;
  const out = [{ op: 'fields', payload: { fields: planFields(order, rows) }, dedupe: `${key}:fields` }];
  const add = (tag) => out.push({ op: 'tag_add', payload: { tag }, dedupe: `${key}:add:${tag}` });
  const remove = (tag) => out.push({ op: 'tag_remove', payload: { tag }, dedupe: `${key}:remove:${tag}` });
  if (event === 'started') add(`instalment_active_${k}`);
  if (event === 'paid') { remove(`instalment_failed_${k}`); add(`instalment_paid_${k}_${number}`); }
  if (event === 'completed') { remove(`instalment_failed_${k}`); remove(`instalment_active_${k}`); add(`instalment_completed_${k}`); }
  if (event === 'failed') add(`instalment_failed_${k}`);
  if (event === 'stopped') { remove(`instalment_active_${k}`); add(`cancelled_${k}`); }
  return out;
}

// The instalment a CiderPay charge is for: turnSeq 0 is the first payment (number 1). Without turnSeq, the earliest
// instalment not paid yet whose amount is the amount charged.
function numberFor(notice, rows) {
  if (notice.turnSeq != null) return notice.turnSeq + 1;
  const match = rows.filter((r) => r.status !== 'paid' && r.status !== 'cancelled' && (notice.amount == null || r.amount === notice.amount))
    .sort((a, b) => a.number - b.number)[0];
  return match ? match.number : null;
}

const adminLink = (order) => `${config.publicBase()}/admin/shop/orders/?id=${order.id}`;
const ofN = (number, rows) => `${number} of ${rows.length}`;

// ---------- database ----------

async function rowsOf(orderId) {
  return db.query(`SELECT id, number, to_char(due_date, 'YYYY-MM-DD') AS due_date, amount, status, payment_id, error, alerted_at, note
                     FROM shop_instalments WHERE order_id = $1 ORDER BY number`, [orderId]);
}

async function productOf(order) {
  return db.one('SELECT * FROM shop_products WHERE id = $1', [order.product_id]);
}

async function queue(order, product, event, extra) {
  for (const x of planOps(order, product, event, extra)) await sync.enqueue({ customerId: order.customer_id, orderId: order.id, ...x });
}

// Sets the plan's state from its schedule. → { order, rows, from, to }
async function refresh(orderId) {
  const order = await db.one('SELECT * FROM shop_orders WHERE id = $1', [orderId]);
  const rows = await rowsOf(orderId);
  if (!order || order.plan !== 'instalment' || !order.plan_status) return { order, rows, from: order && order.plan_status, to: order && order.plan_status };
  const to = planStatus(rows, order.plan_status);
  if (to === order.plan_status) return { order, rows, from: to, to };
  const fresh = await db.one(`UPDATE shop_orders SET plan_status = $2, updated_at = now() WHERE id = $1 RETURNING *`, [orderId, to]);
  return { order: fresh, rows, from: order.plan_status, to };
}

// The order a plan notice is about: by our token (var1), else by the plan's token.
async function orderOf(notice) {
  return (await orders.byToken(notice.token)) || (notice.rpToken ? await db.one('SELECT * FROM shop_orders WHERE rp_token = $1', [notice.rpToken]) : null);
}

/*
 * A CiderPay instalment notice (cmd set). → 'agreed' | 'refused' | 'paid' | 'duplicate' | 'extra' | 'failed' |
 * 'ignored' | 'rejected' | 'unknown_order'. Every notice is kept in shop_callbacks with what was done.
 */
async function fromCiderpay(notice, payload) {
  const log = (outcome, reason, orderId = null) => orders.logCallback({ provider: 'ciderpay', outcome, reason, orderId, payload });
  const order = await orderOf(notice);
  if (!order) {
    await log('rejected', `${notice.cmd}: no order with this token`);
    return 'unknown_order';
  }
  const problem = order.plan !== 'instalment' ? 'not an instalment order' : ciderpay.planNoticeProblem(notice, order);
  if (problem) {
    await log('rejected', `${notice.cmd}: ${problem}`, order.id);
    await notify.attention('a CiderPay instalment notice was refused', [`Order ${order.number} (${orders.orderName(order)})`, problem, 'Nothing was recorded. Check CiderPay’s dashboard.']).catch(() => {});
    return 'rejected';
  }
  require('./flow.js').guardDatabase();
  // The plan's token: kept from the first notice that carries one (the agreement, or a charge that came first).
  if (notice.rpToken && !order.rp_token) {
    await db.query(`UPDATE shop_orders SET rp_token = $2, rp_card = COALESCE(NULLIF($3, ''), rp_card), updated_at = now() WHERE id = $1 AND rp_token IS NULL`, [order.id, notice.rpToken, notice.last4 || '']);
    order.rp_token = notice.rpToken;
  }

  if (notice.cmd === 'agreeRegularPayment') {
    if (notice.last4) await db.query('UPDATE shop_orders SET rp_card = $2 WHERE id = $1', [order.id, notice.last4]);
    await log('agreed', `plan agreed${notice.last4 ? ` (card …${notice.last4})` : ''}`, order.id);
    return 'agreed';
  }
  if (notice.cmd === 'rejectRegularPayment') {
    await db.query(`UPDATE shop_orders SET status = 'cancelled', note = 'The buyer refused the instalment agreement at CiderPay', updated_at = now()
                     WHERE id = $1 AND status IN ('created', 'awaiting_payment')`, [order.id]);
    await log('refused', 'the buyer refused the instalment agreement', order.id);
    return 'refused';
  }
  const rows = await rowsOf(order.id);
  const number = numberFor(notice, rows);
  if (notice.cmd === 'completeRpPayment') {
    const payment = {
      provider: 'ciderpay', currency: 'KRW', amount: notice.amount, ref: notice.orderNo, approvalNo: notice.approvalNo,
      refundToken: notice.refundToken, method: notice.method, receiptUrl: notice.receiptUrl, raw: payload, instalmentNo: number,
    };
    // The first payment is the checkout's: the same path as a payment in full (order paid, purchase tags…).
    if (number === 1) return (await require('./flow.js').confirm(order, payment, { sendNow: true })).outcome;
    return confirmInstalment(order, number, payment);
  }
  if (notice.cmd === 'errorRpPayment') return failed(order, number, notice.errorMessage || 'no reason given', payload);
  await log('ignored', `unknown instalment notice: ${notice.cmd}`, order.id);
  return 'ignored';
}

/*
 * A charge for instalment `number` (2 or more) of a paid order. → 'paid' | 'duplicate' | 'extra' | 'rejected'
 */
async function confirmInstalment(order, number, payment, { sendNow = true, slack = true } = {}) {
  const log = (outcome, reason) => orders.logCallback({ provider: payment.provider, outcome, reason, orderId: order.id, payload: payment.raw || {} });
  const rows = await rowsOf(order.id);
  const row = rows.find((r) => r.number === number);
  const reject = async (reason) => {
    await log('rejected', reason);
    await notify.attention('an instalment payment was refused', [`Order ${order.number} (${orders.orderName(order)})`, reason, 'Nothing was recorded. Check CiderPay’s dashboard.', adminLink(order)]).catch(() => {});
    return 'rejected';
  };
  if (!row) return reject(`no instalment ${number} on this order`);
  if (!payment.ref) return reject('the provider gave no payment reference');
  if (payment.amount !== row.amount) return reject(`instalment ${number}: amount ${payment.amount}, expected ${row.amount}`);
  if (!order.paid_at) return reject(`instalment ${number} arrived before the first payment was recorded`);

  const seen = await db.one(`SELECT 1 AS x FROM shop_payments WHERE provider = $1 AND kind = 'payment' AND provider_ref = $2`, [payment.provider, String(payment.ref)]);
  if (seen) {
    await log('duplicate', `payment ${payment.ref} was already recorded`);
    return 'duplicate';
  }
  // Real money that shouldn't have come: an instalment already paid (by hand, say), or a plan stopped or refunded.
  const stopped = order.plan_status === 'stopped' || ['refunded', 'cancelled'].includes(order.status);
  if (row.status === 'paid' || row.status === 'cancelled' || stopped) {
    const why = row.status === 'paid' ? `instalment ${number} is already paid` : `the plan is ${stopped ? 'stopped' : 'cancelled'}`;
    await log('extra', `charge ${payment.ref} held for review (${why}): not recorded in the ledger`);
    await notify.attention('CiderPay charged an instalment that was not expected', [
      `Order ${order.number} (${orders.orderName(order)}): instalment ${ofN(number, rows)}, ${pricing.formatMoney(payment.amount, order.currency)}`,
      `${why}. The charge was NOT recorded.`, 'If it is real, refund it in CiderPay’s dashboard.', adminLink(order)]).catch(() => {});
    return 'extra';
  }

  const product = await productOf(order);
  let result;
  try {
    result = await orders.recordPayment(order, product, { ...payment, instalmentNo: number });
  } catch (err) {
    // The database refuses a second payment for one instalment (shop_payments_instalment): two charges raced.
    if (err && err.code === '23505') {
      await log('extra', `charge ${payment.ref} held: instalment ${number} was recorded at the same moment`);
      await notify.attention('two charges arrived for one instalment', [`Order ${order.number}: instalment ${number}. One was NOT recorded: check CiderPay.`, adminLink(order)]).catch(() => {});
      return 'extra';
    }
    throw err;
  }
  if (!result.recorded) {
    await log('duplicate', `payment ${payment.ref} was already recorded`);
    return 'duplicate';
  }
  await log('paid', `instalment ${number}`);
  await afterInstalment(result.order, product, number, payment, { was: row.status, sendNow, slack });
  return 'paid';
}

// After an instalment was recorded (never fails the caller): plan state, ActiveCampaign, Slack, end of plan.
async function afterInstalment(order, product, number, payment, { was = 'due', sendNow = true, slack = true } = {}) {
  const step = async (name, fn) => { try { await fn(); } catch (err) { console.error(`shop: order ${order.number} instalment ${number}: ${name} failed`, err); } };
  let state = { order, rows: await rowsOf(order.id), to: order.plan_status };
  await step('plan state', async () => { state = await refresh(order.id); });
  const done = state.to === 'completed';
  await step('ActiveCampaign queue', async () => {
    await queue(state.order, product, 'paid', { number, rows: state.rows });
    if (done) await queue(state.order, product, 'completed', { rows: state.rows });
  });
  const s = await settings.read().catch(() => settings.DEFAULTS);
  if (slack) {
    await step('Slack', () => notify.paid(state.order, payment.method, s, undefined, [], {
      amount: payment.amount, suffix: ` — instalment ${ofN(number, state.rows)}${done ? ', all paid ✅' : ''}`,
    }));
    if (was === 'failed' || was === 'overdue') {
      await step('Slack (recovered)', () => notify.send(`✅ Instalment received after all: order ${order.number} (${orders.orderName(order)}), instalment ${ofN(number, state.rows)}, ${pricing.formatMoney(payment.amount, order.currency)}`));
    }
  }
  if (done) await step('end the agreement at CiderPay', () => endAtCiderpay(state.order));
  if (sendNow) await step('ActiveCampaign send', () => sync.process({ orderId: order.id, budgetMs: 4000 }));
}

// After the first payment of a plan (flow.afterPaid): the plan has started.
async function started(order, product) {
  const rows = await rowsOf(order.id);
  await queue(order, product, 'started', { rows });
}

/*
 * A charge failed (CiderPay's errorRpPayment), or nothing came (checkLate, `late`). The instalment is marked, the
 * plan becomes overdue, and the first time: Slack and ActiveCampaign. → 'failed' | 'ignored'
 */
async function failed(order, number, message, payload = {}, { late = false } = {}) {
  const log = (outcome, reason) => orders.logCallback({ provider: late ? 'shop' : 'ciderpay', outcome, reason, orderId: order.id, payload });
  // The first payment refused: the buyer is still at CiderPay (or back on our page); the order simply isn't paid.
  if (!order.paid_at) {
    await log('failed', `the first payment was refused: ${message}`);
    return 'failed';
  }
  const rows = await rowsOf(order.id);
  const row = rows.find((r) => r.number === number);
  if (!row || !OPEN.includes(row.status)) {
    await log('ignored', `${late ? 'late check' : 'failure notice'} for instalment ${number}: ${row ? `already ${row.status}` : 'no such instalment'}`);
    return 'ignored';
  }
  const marked = await db.one(
    `UPDATE shop_instalments SET status = $3, error = $4, alerted_at = COALESCE(alerted_at, now()), updated_at = now()
      WHERE order_id = $1 AND number = $2 AND status IN ('due', 'failed', 'overdue') RETURNING alerted_at`,
    [order.id, number, late ? 'overdue' : 'failed', String(message).slice(0, 300)]);
  const first = !row.alerted_at && marked;
  if (!late) await log('failed', `instalment ${number}: ${message}`);
  const state = await refresh(order.id);
  if (!first) return 'failed';
  const product = await productOf(order);
  const step = async (name, fn) => { try { await fn(); } catch (err) { console.error(`shop: order ${order.number} instalment ${number}: ${name} failed`, err); } };
  await step('ActiveCampaign queue', () => queue(state.order, product, 'failed', { number, rows: state.rows }));
  const s = await settings.read().catch(() => settings.DEFAULTS);
  if (s.notifications.instalment_failed !== false) {
    const customer = await db.one('SELECT name, email FROM shop_customers WHERE id = $1', [order.customer_id]);
    const b = order.billing || {};
    await step('Slack', () => notify.attention(late ? 'an instalment is late (no payment from CiderPay)' : 'an instalment payment failed', [
      `${b.name || customer.name || ''} <${customer.email}> — ${orders.orderName(order)} [order ${order.number}]`,
      `Instalment ${ofN(number, state.rows)}: ${pricing.formatMoney(row.amount, order.currency)}, due ${row.due_date}`,
      late ? `No payment notice ${GRACE_DAYS} days after the date.` : `CiderPay: ${message}`,
      adminLink(order)]));
  }
  await step('ActiveCampaign send', () => sync.process({ orderId: order.id, budgetMs: 4000 }));
  return 'failed';
}

/*
 * Daily job: instalments of running plans whose date passed GRACE_DAYS ago with no word from CiderPay become
 * overdue (alert once); completed or stopped plans whose agreement is still open at CiderPay are ended again.
 * → { late, ended }
 */
async function checkLate(now = new Date()) {
  const today = ledger.seoul(now).date;
  const rows = await db.query(
    `SELECT o.*, i.number AS i_number FROM shop_instalments i JOIN shop_orders o ON o.id = i.order_id
      WHERE o.plan = 'instalment' AND o.plan_status IN ('active', 'overdue') AND i.status = 'due'
        AND i.due_date + $1::int < $2::date
      ORDER BY o.id, i.number`, [GRACE_DAYS, today]);
  let late = 0;
  for (const r of rows) {
    const { i_number: number, ...order } = r;
    try {
      if (await failed(order, number, 'no payment notice from CiderPay', { checked: today }, { late: true }) === 'failed') late++;
    } catch (err) {
      console.error(`shop: late check of order ${order.number} failed`, err);
    }
  }
  let ended = 0;
  const open = await db.query(`SELECT * FROM shop_orders WHERE plan = 'instalment' AND plan_status IN ('completed', 'stopped') AND rp_token IS NOT NULL AND rp_closed_at IS NULL LIMIT 50`);
  for (const order of open) if (await endAtCiderpay(order).catch(() => false)) ended++;
  return { late, ended };
}

// Ends the agreement at CiderPay (no more charges). → true when CiderPay confirmed (or there is nothing to end).
async function endAtCiderpay(order) {
  if (!order.rp_token || order.rp_closed_at) return true;
  let r;
  try {
    r = await ciderpay.planAction('end', order.rp_token);
  } catch (err) {
    await orders.logCallback({ provider: 'ciderpay', outcome: 'error', reason: `ending the plan: ${err.message}`, orderId: order.id });
    return false;
  }
  if (!r.ok) {
    await orders.logCallback({ provider: 'ciderpay', outcome: 'error', reason: `ending the plan was refused: ${r.detail}`, orderId: order.id, payload: r.raw || {} });
    return false;
  }
  await db.query('UPDATE shop_orders SET rp_closed_at = now() WHERE id = $1', [order.id]);
  await orders.logCallback({ provider: 'ciderpay', outcome: 'plan_ended', reason: 'agreement ended at CiderPay', orderId: order.id, payload: r.raw || {} });
  return true;
}

async function planOrder(orderId) {
  const order = await db.one('SELECT * FROM shop_orders WHERE id = $1', [orderId]);
  if (!order) throw new PlanError('order not found');
  if (order.plan !== 'instalment' || !order.plan_status) throw new PlanError('this order has no running instalment plan');
  return order;
}

// CiderPay's answer to a pause / resume / end, as an admin message.
async function atCiderpay(action, order) {
  if (!order.rp_token) throw new PlanError('this plan has no CiderPay token yet (the agreement notice never arrived): check CiderPay’s dashboard');
  let r;
  try {
    r = await ciderpay.planAction(action, order.rp_token);
  } catch (err) {
    throw new PlanError(`CiderPay did not answer (${err.message}). Check CiderPay’s dashboard before trying again.`);
  }
  if (!r.ok) throw new PlanError(`CiderPay refused: ${r.detail}`);
  return r;
}

// Admin: no charges for now (a customer asking for time). The schedule is kept; late instalments aren't flagged.
async function pause(orderId, { by = 'admin' } = {}) {
  const order = await planOrder(orderId);
  if (!['active', 'overdue'].includes(order.plan_status)) throw new PlanError(`the plan is ${order.plan_status}`);
  await atCiderpay('pause', order);
  const row = await db.one(`UPDATE shop_orders SET plan_status = 'paused', updated_at = now() WHERE id = $1 RETURNING *`, [orderId]);
  await orders.logCallback({ provider: 'ciderpay', outcome: 'plan_paused', reason: `paused by ${by}`, orderId });
  return row;
}

// Admin: charges again. Instalments whose date passed during the pause are flagged by the next morning's check.
async function resume(orderId, { by = 'admin' } = {}) {
  const order = await planOrder(orderId);
  if (order.plan_status !== 'paused') throw new PlanError(`the plan is ${order.plan_status}, not paused`);
  await atCiderpay('resume', order);
  await db.query(`UPDATE shop_orders SET plan_status = 'active', updated_at = now() WHERE id = $1`, [orderId]);
  await orders.logCallback({ provider: 'ciderpay', outcome: 'plan_resumed', reason: `resumed by ${by}`, orderId });
  return (await refresh(orderId)).order;
}

/*
 * Ends the plan: no more charges (the agreement is ended at CiderPay), the instalments not paid are cancelled,
 * ActiveCampaign gets cancelled_<product>. Money already received stays (refund it separately if needed).
 * `force`: stop it here even though CiderPay refused or didn't answer (a person checked CiderPay's dashboard).
 */
async function stop(orderId, { by = 'admin', reason = '', force = false } = {}) {
  const order = await planOrder(orderId);
  if (!RUNNING.includes(order.plan_status)) throw new PlanError(`the plan is already ${order.plan_status}`);
  let ended = !order.rp_token;
  if (order.rp_token) {
    try {
      await atCiderpay('end', order);
      ended = true;
    } catch (err) {
      if (!force) throw err;
    }
  }
  const row = await db.one(
    `WITH o AS (UPDATE shop_orders SET plan_status = 'stopped', rp_closed_at = CASE WHEN $2 THEN COALESCE(rp_closed_at, now()) ELSE rp_closed_at END,
                note = CASE WHEN note = '' THEN $3 ELSE note || E'\\n' || $3 END, updated_at = now() WHERE id = $1 RETURNING *),
          c AS (UPDATE shop_instalments SET status = 'cancelled', updated_at = now() WHERE order_id = $1 AND status IN ('due', 'failed', 'overdue') RETURNING 1)
     SELECT o.*, (SELECT count(*)::int FROM c) AS cancelled_count FROM o`,
    [orderId, ended, `Instalment plan stopped by ${by}${reason ? ': ' + reason : ''}`.slice(0, 500)]);
  await orders.logCallback({ provider: 'ciderpay', outcome: 'plan_stopped', reason: `stopped by ${by}${ended ? '' : ' (NOT confirmed by CiderPay)'}${reason ? ': ' + reason : ''}`, orderId });
  const step = async (name, fn) => { try { await fn(); } catch (err) { console.error(`shop: order ${order.number} stop: ${name} failed`, err); } };
  const product = await productOf(order);
  await step('ActiveCampaign', async () => {
    await queue(row, product, 'stopped', { rows: await rowsOf(orderId) });
    await sync.process({ orderId, budgetMs: 4000 });
  });
  delete row.cancelled_count;
  return { order: row, endedAtCiderpay: ended };
}

/*
 * Admin: instalment `number` was paid another way (a bank transfer after a failed charge…). Recorded like a
 * payment by hand (manual.js): its own payment, tax line, the instalment marked paid, then the usual steps.
 */
async function settleByHand(orderId, number, { method, at, reference = '', by = 'admin' }) {
  const manual = require('./manual.js');
  const order = await planOrder(orderId);
  const rows = await rowsOf(orderId);
  const row = rows.find((r) => r.number === number);
  if (!row) throw new PlanError(`no instalment ${number} on this order`);
  if (number === 1 || !order.paid_at) throw new PlanError('the first payment is made at checkout: it can’t be recorded here');
  if (!OPEN.includes(row.status)) throw new PlanError(`instalment ${number} is ${row.status}`);
  require('./flow.js').guardDatabase();
  const payment = {
    provider: 'manual', currency: order.currency, amount: row.amount, ref: `manual-${order.id}-i${number}`, method: manual.METHODS[method] || 'other', at,
    raw: { recorded_by: by, reference, received: at.toISOString(), instalment: number },
  };
  const outcome = await confirmInstalment(order, number, payment, { sendNow: true, slack: false });
  if (outcome !== 'paid') throw new PlanError(`not recorded (${outcome}): see the order’s notices`);
  return (await refresh(orderId)).order;
}

module.exports = {
  GRACE_DAYS, PlanError, planStatus, lateRows, nextOpen, planFields, planOps, numberFor, addDays,
  rowsOf, refresh, fromCiderpay, confirmInstalment, started, failed, checkLate, endAtCiderpay, pause, resume, stop, settleByHand,
};
