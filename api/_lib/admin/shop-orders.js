/*
 * Shop admin API: overview and orders (actions are routed by api/admin.js). Orders are created by the checkout,
 * by hand in the admin (shop-manual.js) and by the WooCommerce import (phase 4). Plan: docs/commerce-plan.md.
 */
const db = require('../db.js');
const ledger = require('../shop/ledger.js');
const sync = require('../shop/sync.js');
const refunds = require('../shop/refunds.js');
const { userError, text, int } = require('./util.js');

const STATUSES = ['created', 'awaiting_payment', 'paid', 'refund_requested', 'partially_refunded', 'refunded', 'expired', 'cancelled'];

const ORDER_COLUMNS = `o.id, o.number, o.product_id, o.product_name, o.price_option, o.currency, o.plan, o.subtotal, o.discount, o.total,
  o.paid_total, o.refunded_total, o.refund_pending, (SELECT count(*)::int FROM shop_order_items i WHERE i.order_id = o.id AND i.kind = 'addon') AS addon_count, o.status, o.plan_status, o.origin, o.legacy_id, o.created_at, o.paid_at, o.provider, o.due_today,
  c.email, c.name AS customer_name`;

const actions = {
  // Home of the Shop section: what is on sale, money received in the last 30 days, and what needs someone's attention.
  async 'shop-overview'() {
    const [products, orders, money, attention] = await Promise.all([
      db.one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'open')::int AS open FROM shop_products`),
      db.one(`SELECT count(*) FILTER (WHERE paid_at IS NOT NULL)::int AS paid,
                     count(*) FILTER (WHERE paid_at >= now() - interval '30 days')::int AS paid_30d FROM shop_orders`),
      db.query(`SELECT currency, amount, supply, vat FROM shop_ledger WHERE at >= now() - interval '30 days'`),
      db.one(`SELECT (SELECT count(*)::int FROM shop_instalments WHERE status IN ('failed', 'overdue')) AS instalments,
                     (SELECT count(*)::int FROM shop_orders WHERE status = 'refund_requested') AS refunds,
                     (SELECT count(*)::int FROM shop_orders WHERE status = 'awaiting_payment' AND created_at < now() - interval '1 hour') AS unpaid,
                     (SELECT count(*)::int FROM shop_outbox WHERE status = 'failed') AS ac_failed,
                     (SELECT count(*)::int FROM shop_outbox WHERE status = 'pending') AS ac_pending,
                     (SELECT count(*)::int FROM shop_orders o WHERE o.paid_at IS NOT NULL AND o.status = 'paid'
                        AND NOT EXISTS (SELECT 1 FROM shop_outbox x WHERE x.order_id = o.id)) AS ac_missing,
                     (SELECT count(*)::int FROM shop_callbacks WHERE outcome IN ('rejected', 'error', 'extra') AND at > now() - interval '14 days') AS notices`),
    ]);
    return { overview: { products, orders, last30days: ledger.totals(money), attention } };
  },

  async 'shop-orders'(input) {
    const q = text(input.q, { max: 100 });
    const status = text(input.status, { max: 30 });
    if (status && !STATUSES.includes(status)) throw userError('unknown status');
    const product = input.product ? int(input.product, { min: 1, max: 2147483647, label: 'product' }) : null;
    const limit = int(input.limit || 200, { min: 1, max: 1000, label: 'limit' });
    const rows = await db.query(
      `SELECT ${ORDER_COLUMNS}
         FROM shop_orders o JOIN shop_customers c ON c.id = o.customer_id
        WHERE ($1 = '' OR o.number::text = $1 OR c.email ILIKE '%' || $1 || '%' OR c.name ILIKE '%' || $1 || '%')
          AND ($2 = '' OR o.status = $2)
          AND ($3::int IS NULL OR o.product_id = $3 OR EXISTS (SELECT 1 FROM shop_order_items i WHERE i.order_id = o.id AND i.product_id = $3))
        ORDER BY o.created_at DESC, o.id DESC LIMIT $4`,
      [q, status, product, limit],
    );
    return { orders: rows, statuses: STATUSES };
  },

  // One order with everything behind it: customer, payments, instalment schedule and tax lines.
  async 'shop-order'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const order = await db.one(
      `SELECT ${ORDER_COLUMNS}, o.billing, o.source, o.note, c.phone, c.country, c.postcode, c.address1, c.address2, o.coupon_code,
              (SELECT json_build_object('id', k.id, 'name', k.name, 'key', k.key) FROM shop_coupons x JOIN shop_coupon_campaigns k ON k.id = x.campaign_id WHERE x.id = o.coupon_id) AS coupon_campaign
         FROM shop_orders o JOIN shop_customers c ON c.id = o.customer_id WHERE o.id = $1`, [id]);
    if (!order) throw userError('order not found', 404);
    const [items, payments, instalments, lines, outbox, notices, refundRows] = await Promise.all([
      db.query(`SELECT position, kind, product_id, name, amount, vat_rule FROM shop_order_items WHERE order_id = $1 ORDER BY position`, [id]),
      db.query(`SELECT id, provider, kind, currency, amount, fee, instalment_no, provider_ref, approval_no, method, receipt_url, at
                  FROM shop_payments WHERE order_id = $1 ORDER BY at, id`, [id]),
      db.query(`SELECT number, to_char(due_date, 'YYYY-MM-DD') AS due_date, amount, status, error FROM shop_instalments WHERE order_id = $1 ORDER BY number`, [id]),
      db.query(`SELECT at, kind, method, currency, amount, supply, vat, vat_rule, fee, fx_rate, amount_krw, note FROM shop_ledger WHERE order_id = $1 ORDER BY at, id`, [id]),
      db.query(`SELECT op, payload, status, attempts, last_error, created_at, done_at FROM shop_outbox WHERE order_id = $1 ORDER BY id`, [id]),
      db.query(`SELECT at, provider, outcome, reason FROM shop_callbacks WHERE order_id = $1 ORDER BY at, id`, [id]),
      db.query(`SELECT id, payment_id, provider, currency, amount, reason, by, origin, status, provider_ref, error, created_at, done_at, notice_at FROM shop_refunds WHERE order_id = $1 ORDER BY id`, [id]),
    ]);
    // What can still be refunded: per payment, and in all (what's left, minus refunds still on their way).
    const left = refunds.remaining(payments, refundRows);
    const refundable = refunds.REFUNDABLE.includes(order.status)
      ? payments.filter((p) => p.kind === 'payment').map((p) => ({ payment_id: p.id, provider: p.provider, amount: p.amount, left: Math.max(0, left.get(p.id) || 0) })).filter((p) => p.left > 0)
      : [];
    // An order made in the admin: its payment link while it can be paid, and how long it works.
    const full = await db.one('SELECT origin, provider, status, paid_at, created_at, token FROM shop_orders WHERE id = $1', [id]);
    const manualLink = require('./shop-manual.js').linkOf(full);
    const link = manualLink ? { url: manualLink, last_day: require('../shop/manual.js').linkLastDay(full) } : null;
    return { order, items, payments, instalments, ledger: lines, outbox, notices, refunds: refundRows, refundable, link, unpaid: ['created', 'awaiting_payment', 'expired', 'cancelled'].includes(order.status) };
  },

  // Provider notices that were refused, failed, or brought a second payment: the ones a person should look at.
  async 'shop-notices'(input) {
    const limit = int(input.limit || 100, { min: 1, max: 500, label: 'limit' });
    const rows = await db.query(
      `SELECT n.at, n.provider, n.outcome, n.reason, n.order_id, o.number FROM shop_callbacks n LEFT JOIN shop_orders o ON o.id = n.order_id
        WHERE n.outcome IN ('rejected', 'error', 'extra') ORDER BY n.at DESC LIMIT $1`, [limit]);
    return { notices: rows };
  },

  // Refund all or part of a paid order through its provider (CiderPay cancel / cancel request, PayPal refund).
  // The amount is in the order's smallest unit (won, cents). → { status: 'done' | 'requested' | 'check' | 'failed', message }
  async 'shop-refund'(input, { admin }) {
    const orderId = int(input.order, { min: 1, max: 2147483647, label: 'order' });
    const amount = int(input.amount, { min: 1, max: 2000000000, label: 'amount' });
    const reason = text(input.reason, { max: 300, required: true, label: 'reason' });
    const r = await refunds.request({ orderId, amount, reason, by: admin });
    return { status: r.status, message: r.message, target: `order ${orderId}`, log: { order: orderId, amount, reason, refund: r.refund.id, status: r.status } };
  },

  // A refund already made at the provider (CiderPay's dashboard, a bank transfer…): recorded, no provider is called.
  async 'shop-refund-record'(input, { admin }) {
    const orderId = int(input.order, { min: 1, max: 2147483647, label: 'order' });
    const amount = int(input.amount, { min: 1, max: 2000000000, label: 'amount' });
    const reason = text(input.reason, { max: 300, required: true, label: 'reason' });
    const r = await refunds.record({ orderId, amount, reason, by: admin });
    return { status: r.status, message: r.message, target: `order ${orderId}`, log: { order: orderId, amount, reason, refund: r.refund.id, recorded: true } };
  },

  // A refund whose provider never answered, or a cancel request still waiting: did the money go back?
  async 'shop-refund-resolve'(input, { admin }) {
    const refundId = int(input.refund, { min: 1, max: 2147483647, label: 'refund' });
    const happened = input.happened === true || input.happened === 'true';
    const r = await refunds.resolve({ refundId, happened, by: admin });
    return { status: r.status, target: `order ${r.refund.order_id}`, log: { refund: refundId, happened } };
  },

  // Sends the ActiveCampaign updates still waiting (all of them, or one order's), and retries the failed ones.
  async 'shop-sync-run'(input) {
    const orderId = input.order ? int(input.order, { min: 1, max: 2147483647, label: 'order' }) : null;
    // A paid order that never got its updates queued gets them now (idempotent).
    if (orderId) {
      const order = await db.one('SELECT * FROM shop_orders WHERE id = $1', [orderId]);
      if (!order) throw userError('order not found', 404);
      await require('../shop/flow.js').ensureSynced(order);
    } else await require('../shop/flow.js').repairSync();
    await db.query(`UPDATE shop_outbox SET status = 'pending', next_attempt_at = now() WHERE status IN ('failed', 'pending') AND ($1::int IS NULL OR order_id = $1)`, [orderId]);
    const result = await sync.process({ budgetMs: 20000, orderId });
    return { result, target: orderId ? `order ${orderId}` : 'all pending updates', log: result };
  },
};

module.exports = { section: 'shop', actions, writes: ['shop-sync-run', 'shop-refund', 'shop-refund-record', 'shop-refund-resolve'], STATUSES };
