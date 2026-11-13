/*
 * The checkout flow, shared by the three shop endpoints:
 *   start()         a buyer submits the form → order created → provider asked for a payment page
 *   confirm()       a provider says money was received → checked → recorded once → AC, Slack
 *   settlePaypal()  capture an approved PayPal order, then confirm()
 */
const db = require('../db.js');
const orders = require('./orders.js');
const pricing = require('./pricing.js');
const validate = require('./validate.js');
const settings = require('./settings.js');
const sync = require('./sync.js');
const notify = require('./notify.js');
const ciderpay = require('./pay/ciderpay.js');
const paypal = require('./pay/paypal.js');
const config = require('./config.js');
const { CheckoutError } = orders;

// Payment providers this deployment can use (keys present).
function providers() {
  return [config.ciderpayConfigured() && 'ciderpay', config.paypalConfigured() && 'paypal'].filter(Boolean);
}

// A preview without its own database would write test orders and tax lines into production's tables.
function guardDatabase() {
  if (!db.separateFromProduction()) throw new CheckoutError('not_configured', 'this preview has no database of its own (PODCAST_DATABASE_URL): the shop is switched off here');
}

async function productOf(order) {
  return db.one('SELECT * FROM shop_products WHERE id = $1', [order.product_id]);
}

/*
 * → { order, redirect } where `redirect` is the provider's payment page.
 * Throws CheckoutError: 'invalid' (with .fields), 'closed', 'unavailable', 'too_many', 'provider', 'not_configured'.
 */
async function start({ product, currency, plan, input, source, ipHash }) {
  // First: is this product on sale, in this currency, with this plan? Only then is the form worth checking.
  guardDatabase();
  if (!pricing.saleState(product).open) throw new CheckoutError('closed');
  if (!orders.offers(product, providers()).some((o) => o.currency === currency && o.plan === plan)) throw new CheckoutError('unavailable', `no ${currency} ${plan} offer for ${product.slug}`);
  const checked = validate.checkoutInput(input, currency);
  if (!checked.ok) throw new CheckoutError('invalid', 'form', checked.errors);
  const billing = checked.value;
  const order = await orders.createOrder({ product, currency, plan, billing, source: validate.sourceInput(source), ipHash });
  try {
    if (order.provider === 'paypal') {
      const created = await paypal.createOrder({ order, productName: product.name, slug: product.slug });
      await orders.awaitPayment(order.id, created.id);
      return { order, redirect: created.approveUrl };
    }
    const page = await ciderpay.requestPayment({ order, productName: product.name, billing });
    await orders.awaitPayment(order.id, page.payUniqueNo);
    return { order, redirect: page.payUrl };
  } catch (err) {
    const code = err instanceof ciderpay.PayError ? (err.code === 'not_configured' ? 'not_configured' : err.code === 'unavailable' ? 'unavailable' : 'provider') : null;
    await orders.abandon(order.id, err.message).catch(() => {});
    if (!code) throw err;
    console.error(`shop: order ${order.number} could not start payment:`, err.message);
    throw new CheckoutError(code, err.message);
  }
}

/*
 * A provider confirmed a payment for `order`.
 *   payment  { provider, currency, amount, ref, fee?, approvalNo?, refundToken?, method?, receiptUrl?, raw? }
 *   sendNow  also send the ActiveCampaign updates before returning (provider notices: nobody is waiting)
 * → { outcome: 'paid' | 'duplicate' | 'extra' | 'rejected', reason?, order }
 */
async function confirm(order, payment, { sendNow = false } = {}) {
  guardDatabase();
  const product = await productOf(order);
  const verdict = orders.decide(order, payment);
  const step = async (name, fn) => { try { await fn(); } catch (err) { console.error(`shop: order ${order.number}: ${name} failed`, err); } };

  // A second payment for an order that is already paid is held for a person, not recorded: either a buyer
  // really paid twice (refund one at the provider) or someone replays a notice. Recording it would write a
  // permanent tax line that could never be taken back.
  if (verdict.action === 'extra') {
    const seen = await db.one(`SELECT 1 AS x FROM shop_payments WHERE provider = $1 AND kind = 'payment' AND provider_ref = $2`, [payment.provider, String(payment.ref)]);
    if (seen) {
      await orders.logCallback({ provider: payment.provider, outcome: 'duplicate', reason: `payment ${payment.ref} was already recorded`, orderId: order.id, payload: payment.raw });
      await step('ActiveCampaign queue (repeat)', () => ensureSynced(order, product));
      return { outcome: 'duplicate', order };
    }
    await orders.logCallback({ provider: payment.provider, outcome: 'extra', reason: `second payment ${payment.ref} held for review: not recorded in the ledger`, orderId: order.id, payload: payment.raw });
    await step('alert', () => notify.attention('a second payment arrived for an order that was already paid', [
      `Order ${order.number} (${order.product_name})`, `Payment ${payment.ref} (${pricing.formatMoney(payment.amount, order.currency)}) was NOT recorded.`,
      'Check the provider’s dashboard: if it is real, refund it there.']));
    return { outcome: 'extra', order };
  }
  if (verdict.action === 'reject') {
    await orders.logCallback({ provider: payment.provider, outcome: 'rejected', reason: verdict.reason, orderId: order.id, payload: payment.raw });
    await notify.attention('a payment notice was refused', [`Order ${order.number} (${order.product_name})`, verdict.reason, 'Nothing was recorded as paid. Check the provider’s dashboard.']).catch(() => {});
    return { outcome: 'rejected', reason: verdict.reason, order };
  }

  const result = await orders.recordPayment(order, product, payment);
  if (!result.recorded) {
    await orders.logCallback({ provider: payment.provider, outcome: 'duplicate', reason: `payment ${payment.ref} was already recorded`, orderId: order.id, payload: payment.raw });
    // The first notice may have failed right after recording the payment: make sure the buyer still gets their tags.
    await step('ActiveCampaign queue (repeat)', () => ensureSynced(result.order, product));
    return { outcome: 'duplicate', order: result.order };
  }
  // Two different payments can race past decide() with the same (unpaid) view of the order: the recorded total tells.
  const outcome = verdict.action === 'extra' || result.order.paid_total > result.order.due_today ? 'extra' : 'paid';
  await orders.logCallback({ provider: payment.provider, outcome, orderId: order.id, payload: payment.raw });

  // From here the money is recorded. Nothing below may undo that or fail the caller.
  if (outcome === 'extra') {
    // Only when two different payments raced past decide() at the same instant: both are real money and recorded.
    await step('alert', () => notify.attention('two payments arrived at the same time for one order', [
      `Order ${order.number} (${order.product_name})`, `Payment ${payment.ref}: recorded in the ledger.`, 'One of the two payments probably needs a refund.']));
    return { outcome, order: result.order };
  }
  await step('customer update', () => orders.refreshCustomer(result.order));
  await step('ActiveCampaign queue', () => sync.queuePurchase(result.order, product, payment));
  await step('Slack', async () => notify.paid(result.order, payment.method, await settings.read()));
  await step('double payment check', async () => {
    const other = await orders.samePurchaseRecently(result.order);
    if (other) await notify.attention('the same buyer paid twice for the same product', [`Orders ${other.number} and ${result.order.number} (${order.product_name}), both paid within 24 hours.`, 'If it was a mistake, refund one at the provider.']);
  });
  // A short budget: the provider is waiting for our answer. Whatever isn't sent now goes from the thank-you page or the daily job.
  if (sendNow) await step('ActiveCampaign send', () => sync.process({ orderId: order.id, budgetMs: 4000 }));
  return { outcome, order: result.order };
}

/*
 * Captures the PayPal order behind `order` (the buyer approved it) and records the payment.
 * → { outcome: 'paid' | 'duplicate' | 'extra' | 'rejected' | 'not_approved' | 'declined' | 'pending', order }
 */
async function settlePaypal(order, opts = {}) {
  if (order.provider !== 'paypal' || !order.provider_request) return { outcome: 'not_approved', order };
  const r = await paypal.captureOrder(order.provider_request);
  if (r.outcome !== 'captured') {
    const reason = `capture: ${r.outcome}${r.detail ? ' ' + r.detail : ''}`;
    // PayPal holding the money (e.g. a receiving setting to accept by hand) needs a person: say so once per order.
    if (r.outcome === 'pending') {
      const told = await db.one(`SELECT 1 AS x FROM shop_callbacks WHERE order_id = $1 AND reason LIKE 'capture: pending%'`, [order.id]);
      if (!told) await notify.attention('PayPal is holding a payment', [`Order ${order.number} (${order.product_name})`, 'The buyer paid but PayPal has not released the money: check the PayPal account (pending payments).']).catch(() => {});
    }
    await orders.logCallback({ provider: 'paypal', outcome: 'ignored', reason, orderId: order.id, payload: r.capture || {} });
    return { outcome: r.outcome, order };
  }
  return confirmCapture(order, r.capture, opts);
}

// A completed PayPal capture (from a capture call or a webhook) for `order`.
async function confirmCapture(order, capture, opts = {}) {
  if (capture.customId && capture.customId !== order.token) {
    await orders.logCallback({ provider: 'paypal', outcome: 'rejected', reason: 'capture belongs to another order', orderId: order.id, payload: capture });
    return { outcome: 'rejected', reason: 'capture belongs to another order', order };
  }
  return confirm(order, {
    provider: 'paypal', currency: capture.currency, amount: capture.amount, ref: capture.captureId, fee: capture.fee,
    method: 'PayPal', raw: capture,
  }, opts);
}

// A paid order's ActiveCampaign updates, queued if they never were (idempotent: dedupe keys).
async function ensureSynced(order, product) {
  if (!order.paid_at || order.status !== 'paid') return;
  const p = await db.one(`SELECT receipt_url FROM shop_payments WHERE order_id = $1 AND kind = 'payment' ORDER BY at, id LIMIT 1`, [order.id]);
  await orders.refreshCustomer(order);
  await sync.queuePurchase(order, product || await productOf(order), { receiptUrl: p ? p.receipt_url : '' });
}

// Daily job: queue the ActiveCampaign updates of every paid order that has none (see orders.paidWithoutSync).
async function repairSync() {
  const rows = await orders.paidWithoutSync();
  for (const order of rows) await ensureSynced(order);
  return rows.length;
}

// The receipt link of an order's (first) payment, if the provider gave one.
async function receiptUrl(orderId) {
  const row = await db.one(`SELECT receipt_url FROM shop_payments WHERE order_id = $1 AND kind = 'payment' AND receipt_url IS NOT NULL ORDER BY at, id LIMIT 1`, [orderId]);
  return row ? row.receipt_url : '';
}

module.exports = { start, confirm, settlePaypal, confirmCapture, productOf, receiptUrl, providers, ensureSynced, repairSync };
