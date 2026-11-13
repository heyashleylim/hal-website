/*
 * Orders: creating one at checkout, and recording the payment when a provider confirms it.
 *
 * The rules that matter:
 * - The browser never sets an amount. An order's amounts come from pricing.quote() on the product.
 * - A payment is recorded once: shop_payments has a unique (provider, kind, provider_ref), and the payment,
 *   its tax ledger line and the order's new state are written by ONE statement, so they can't drift apart.
 * - Money that was really received is never dropped: a valid payment for an order that had expired, or a
 *   second payment for an order already paid, is still recorded (and flagged), never ignored.
 */
const db = require('../db.js');
const pricing = require('./pricing.js');
const ledger = require('./ledger.js');
const config = require('./config.js');

// Instalment plans are built in phase 3 (docs/commerce-plan.md). Until then the checkout only sells pay-in-full.
const INSTALMENTS_ENABLED = false;

// Orders started from one network per 10 minutes. Mobile carriers put many buyers behind one address, so it is
// generous. There is deliberately no limit per email: anyone could type a buyer's email to lock them out.
const RATE_LIMIT = { perNetwork: 30, minutes: 10 };

// A checkout problem with a stable code (copy.ko.js `problems`), safe to show to the buyer.
class CheckoutError extends Error {
  constructor(code, detail = '', fields = null) {
    super(detail || code);
    this.code = code;
    this.fields = fields;
  }
}

const providerFor = (currency) => (currency === 'USD' ? 'paypal' : 'ciderpay');

// The ways this product can be bought right now (currency + plan), priced.
// `providers`: the payment providers this deployment has keys for (default: both, for tests and pricing).
function offers(product, providers = ['ciderpay', 'paypal']) {
  return pricing.options(product)
    .filter((o) => o.plan === 'full' || INSTALMENTS_ENABLED)
    .filter((o) => providers.includes(providerFor(o.currency)))
    .map((o) => ({ ...pricing.quote(product, o), provider: providerFor(o.currency) }));
}

async function productBySlug(slug) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(String(slug || ''))) return null;
  return db.one('SELECT * FROM shop_products WHERE slug = $1', [slug]);
}

// The add-ons `product`'s checkout offers in `currency` right now (pricing.addonChoices), read from the database.
async function addonChoices(product, currency, now = new Date()) {
  const ids = [...new Set(product.addon_ids || [])];
  if (!ids.length) return [];
  const rows = await db.query('SELECT * FROM shop_products WHERE id = ANY($1::int[])', [ids]);
  return pricing.addonChoices(product, rows, currency, now);
}

// The add-on ids a checkout form asked for: fields named addon_<id> that are ticked (at most 10).
function requestedAddons(input) {
  const ids = [];
  for (const [k, v] of Object.entries(input || {})) {
    const m = /^addon_(\d{1,9})$/.exec(k);
    if (m && ['1', 'on', 'true', 'yes'].includes(String(v).toLowerCase())) ids.push(Number(m[1]));
  }
  return [...new Set(ids)].sort((a, b) => a - b).slice(0, 11);
}

/*
 * Creates the order for one purchase. `billing` is the cleaned form (validate.checkoutInput).
 * `addons`: the add-on products the buyer ticked, each one of addonChoices() (checked by the caller).
 * The order and its items are written by one statement.
 * Throws CheckoutError('closed' | 'unavailable' | 'too_many').
 */
async function createOrder({ product, currency, plan, billing, addons = [], source = {}, ipHash = null, now = new Date() }) {
  if (!pricing.saleState(product, now).open) throw new CheckoutError('closed');
  if (!offers(product).some((o) => o.currency === currency && o.plan === plan)) throw new CheckoutError('unavailable', `no ${currency} ${plan} offer for ${product.slug}`);
  let offer;
  try {
    offer = { ...pricing.quote(product, { currency, plan, addons }), provider: providerFor(currency) };
  } catch (err) {
    if (err instanceof pricing.PricingError) throw new CheckoutError(err.code === 'addon_plan' || err.code === 'bad_addon' || err.code === 'no_price' ? 'addon_unavailable' : 'unavailable', err.message);
    throw err;
  }

  if (ipHash) {
    const recent = await db.one(
      `SELECT count(*)::int AS n FROM shop_orders WHERE ip_hash = $1 AND created_at > now() - ($2 || ' minutes')::interval`,
      [ipHash, String(RATE_LIMIT.minutes)],
    );
    if (recent.n >= RATE_LIMIT.perNetwork) throw new CheckoutError('too_many');
  }

  // The customer row is created from this form, but an existing customer's details are only replaced once a
  // payment is confirmed (afterPaid): typing someone else's email must not rewrite their record.
  const customer = await db.one(
    `INSERT INTO shop_customers (email, name, phone, country, postcode, address1, address2) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (email) DO UPDATE SET updated_at = shop_customers.updated_at RETURNING id`,
    [billing.email, billing.name, billing.phone, billing.country, billing.postcode, billing.address1, billing.address2],
  );
  const it = offer.items;
  const order = await db.one(
    `WITH o AS (
       INSERT INTO shop_orders (token, customer_id, product_id, product_name, currency, plan, subtotal, discount, total, due_today, status, provider, billing, source, ip_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'created', $11, $12::jsonb, $13::jsonb, $14) RETURNING *),
     i AS (
       INSERT INTO shop_order_items (order_id, position, kind, product_id, name, amount, vat_rule)
       SELECT o.id, x.position - 1, x.kind, x.product_id, x.name, x.amount, x.vat_rule
         FROM o, unnest($15::text[], $16::int[], $17::text[], $18::int[], $19::text[]) WITH ORDINALITY AS x(kind, product_id, name, amount, vat_rule, position)
       RETURNING 1)
     SELECT o.*, (SELECT count(*)::int FROM i) AS item_count FROM o`,
    [config.newToken(), customer.id, product.id, product.name, offer.currency, offer.plan, offer.subtotal, offer.discount, offer.total, offer.dueToday,
      offer.provider, JSON.stringify(billing), JSON.stringify(source), ipHash,
      it.map((x) => x.kind), it.map((x) => x.product_id), it.map((x) => x.name), it.map((x) => x.amount), it.map((x) => x.vatRule)],
  );
  if (!order || order.item_count !== it.length) throw new Error('the order and its items were not saved together');
  delete order.item_count;
  return order;
}

// An order's items, in order (the product first). Orders from before add-ons have their one item since migration 009.
async function items(orderId) {
  return db.query(
    `SELECT i.position, i.kind, i.product_id, p.slug, i.name, i.amount, i.vat_rule
       FROM shop_order_items i JOIN shop_products p ON p.id = i.product_id WHERE i.order_id = $1 ORDER BY i.position`, [orderId]);
}

// The provider accepted our request: the buyer is on their way to pay.
async function awaitPayment(orderId, providerRequest) {
  return db.one(
    `UPDATE shop_orders SET provider_request = $2, status = 'awaiting_payment', updated_at = now() WHERE id = $1 AND status = 'created' RETURNING *`,
    [orderId, providerRequest],
  );
}

// The provider refused our request: the order never reached the payment page.
async function abandon(orderId, note) {
  await db.query(`UPDATE shop_orders SET status = 'cancelled', note = $2, updated_at = now() WHERE id = $1 AND status = 'created'`, [orderId, String(note).slice(0, 500)]);
}

async function byToken(token) {
  if (!config.isToken(token)) return null;
  return db.one('SELECT * FROM shop_orders WHERE token = $1', [token]);
}

async function byProviderRequest(provider, providerRequest) {
  if (!providerRequest) return null;
  return db.one('SELECT * FROM shop_orders WHERE provider = $1 AND provider_request = $2', [provider, String(providerRequest)]);
}

const UNPAID = ['created', 'awaiting_payment', 'expired', 'cancelled'];

/*
 * What to do with a confirmed payment for `order` (pure). `payment`: { provider, currency, amount, ref }.
 *   { action: 'accept' }            the expected payment
 *   { action: 'extra' }             valid, but the order is already paid: held for a person (not recorded), alert
 *   { action: 'reject', reason }    not what this order expects: nothing is recorded as paid
 */
function decide(order, payment) {
  if (!payment.ref) return { action: 'reject', reason: 'the provider gave no payment reference' };
  if (payment.provider !== order.provider) return { action: 'reject', reason: `order expects ${order.provider}, notice is from ${payment.provider}` };
  if (payment.currency !== order.currency) return { action: 'reject', reason: `currency ${payment.currency}, order is in ${order.currency}` };
  if (!Number.isInteger(payment.amount) || payment.amount !== order.due_today) return { action: 'reject', reason: `amount ${payment.amount}, order expects ${order.due_today}` };
  return { action: UNPAID.includes(order.status) ? 'accept' : 'extra' };
}

/*
 * Records a confirmed payment: the payment row, its tax ledger line and the order's state, in one statement.
 * → { recorded: true, order } the first time; { recorded: false, order } when this reference was already recorded.
 * payment: { provider, amount, ref, fee?, approvalNo?, refundToken?, method?, receiptUrl?, raw? }
 */
async function recordPayment(order, product, payment) {
  const at = new Date();
  // One tax line per VAT rule of the order's items (normally one). An order without items (none since migration
  // 009) falls back to its product's rule.
  const sold = await items(order.id);
  const base = { kind: 'payment', amount: payment.amount, fee: payment.fee == null ? null : payment.fee, provider: payment.provider, method: payment.method || '', at };
  const ls = sold.length ? ledger.lines({ payment: base, order, items: sold }) : [ledger.line({ payment: base, order, product })];
  const row = await db.one(
    `WITH pay AS (
       INSERT INTO shop_payments (order_id, provider, kind, currency, amount, fee, instalment_no, provider_ref, approval_no, refund_token, method, receipt_url, raw, at)
       VALUES ($1::int, $2::text, 'payment', $3::text, $4::int, $5::int, NULL, $6::text, $7::text, $8::text, $9::text, $10::text, $11::jsonb, $12::timestamptz)
       ON CONFLICT (provider, kind, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
       RETURNING id),
     led AS (
       INSERT INTO shop_ledger (at, order_id, payment_id, kind, provider, method, currency, amount, supply, vat, vat_rule, fee)
       SELECT $12::timestamptz, $1::int, pay.id, l.kind, $2::text, $9::text, $3::text, l.amount, l.supply, l.vat, l.rule, l.fee
         FROM pay, unnest($13::text[], $14::int[], $15::int[], $16::int[], $17::text[], $18::int[]) AS l(kind, amount, supply, vat, rule, fee)
       RETURNING id),
     ord AS (
       UPDATE shop_orders
          SET paid_total = paid_total + $4::int,
              status = CASE WHEN status IN ('created', 'awaiting_payment', 'expired', 'cancelled') THEN 'paid' ELSE status END,
              paid_at = COALESCE(paid_at, $12::timestamptz), updated_at = now()
        WHERE id = $1::int AND EXISTS (SELECT 1 FROM pay)
        RETURNING id)
     SELECT (SELECT id FROM pay) AS payment_id, (SELECT count(*)::int FROM led) AS ledger_lines, (SELECT id FROM ord) AS order_id`,
    [order.id, payment.provider, order.currency, payment.amount, payment.fee == null ? null : payment.fee, String(payment.ref),
      payment.approvalNo || null, payment.refundToken || null, payment.method || '', payment.receiptUrl || null,
      JSON.stringify(payment.raw || {}), at.toISOString(),
      ls.map((l) => l.kind), ls.map((l) => l.amount), ls.map((l) => l.supply), ls.map((l) => l.vat), ls.map((l) => l.vat_rule), ls.map((l) => l.fee)],
  );
  const fresh = await db.one('SELECT * FROM shop_orders WHERE id = $1', [order.id]);
  return { recorded: Boolean(row && row.payment_id), paymentId: row ? row.payment_id : null, order: fresh };
}

// Once paid: the customer's record takes the details given for this order.
async function refreshCustomer(order) {
  const b = order.billing || {};
  await db.query(
    `UPDATE shop_customers SET name = $2, phone = $3, country = $4, postcode = $5, address1 = $6, address2 = $7, updated_at = now() WHERE id = $1`,
    [order.customer_id, b.name || '', b.phone || '', b.country || '', b.postcode || '', b.address1 || '', b.address2 || ''],
  );
}

async function logCallback({ provider, outcome, reason = '', orderId = null, payload = {} }) {
  try {
    await db.query('INSERT INTO shop_callbacks (provider, outcome, reason, order_id, payload) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [provider, outcome, String(reason).slice(0, 500), orderId, JSON.stringify(payload)]);
  } catch (err) {
    console.error('shop: could not log a provider notice', err);
  }
}

// Orders started more than a day ago and never paid. A payment arriving later is still accepted (decide()).
async function expireStale() {
  const rows = await db.query(
    `UPDATE shop_orders SET status = 'expired', updated_at = now()
      WHERE status IN ('created', 'awaiting_payment') AND created_at < now() - interval '24 hours' RETURNING id`);
  return rows.length;
}

// The purchase event reached GTM (once per order).
async function markTracked(token) {
  if (!config.isToken(token)) return false;
  const row = await db.one(`UPDATE shop_orders SET tracked_at = now() WHERE token = $1 AND tracked_at IS NULL AND paid_at IS NOT NULL RETURNING id`, [token]);
  return Boolean(row);
}

// Paid orders whose ActiveCampaign updates were never queued (the queueing step failed after the payment was
// recorded). Used by the daily job and shown in the admin, so a buyer never silently misses their purchase tag.
async function paidWithoutSync() {
  return db.query(
    `SELECT o.* FROM shop_orders o
      WHERE o.paid_at IS NOT NULL AND o.status = 'paid'
        AND NOT EXISTS (SELECT 1 FROM shop_outbox x WHERE x.order_id = o.id)
      ORDER BY o.id LIMIT 200`);
}

// Another order of the same customer for the same product, paid in the last 24 hours (a probable double payment).
async function samePurchaseRecently(order) {
  return db.one(
    `SELECT number FROM shop_orders WHERE customer_id = $1 AND product_id = $2 AND id <> $3 AND paid_at > now() - interval '24 hours' ORDER BY id DESC LIMIT 1`,
    [order.customer_id, order.product_id, order.id]);
}

async function payments(orderId) {
  return db.query(`SELECT * FROM shop_payments WHERE order_id = $1 ORDER BY at, id`, [orderId]);
}

module.exports = {
  INSTALMENTS_ENABLED, RATE_LIMIT, CheckoutError, providerFor, offers, productBySlug, createOrder, awaitPayment, abandon,
  byToken, byProviderRequest, decide, recordPayment, items, addonChoices, requestedAddons, refreshCustomer, logCallback, expireStale, markTracked, payments, UNPAID,
  paidWithoutSync, samePurchaseRecently,
};
