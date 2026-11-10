/*
 * Shop admin API: overview and orders (read-only in phase 1; actions are routed by api/admin.js).
 * Orders are created by the checkout (phase 2) and the WooCommerce import (phase 4). Plan: docs/commerce-plan.md.
 */
const db = require('../db.js');
const ledger = require('../shop/ledger.js');
const { userError, text, int } = require('./util.js');

const STATUSES = ['created', 'awaiting_payment', 'paid', 'refund_requested', 'partially_refunded', 'refunded', 'expired', 'cancelled'];

const ORDER_COLUMNS = `o.id, o.number, o.product_id, o.product_name, o.currency, o.plan, o.subtotal, o.discount, o.total,
  o.paid_total, o.refunded_total, o.status, o.plan_status, o.origin, o.legacy_id, o.created_at, o.paid_at,
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
                     (SELECT count(*)::int FROM shop_orders WHERE status = 'awaiting_payment' AND created_at < now() - interval '1 hour') AS unpaid`),
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
          AND ($3::int IS NULL OR o.product_id = $3)
        ORDER BY o.created_at DESC LIMIT $4`,
      [q, status, product, limit],
    );
    return { orders: rows, statuses: STATUSES };
  },

  // One order with everything behind it: customer, payments, instalment schedule and tax lines.
  async 'shop-order'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const order = await db.one(
      `SELECT ${ORDER_COLUMNS}, o.billing, o.source, o.note, c.phone, c.country, c.postcode, c.address1, c.address2
         FROM shop_orders o JOIN shop_customers c ON c.id = o.customer_id WHERE o.id = $1`, [id]);
    if (!order) throw userError('order not found', 404);
    const [payments, instalments, lines] = await Promise.all([
      db.query(`SELECT id, provider, kind, currency, amount, fee, instalment_no, provider_ref, approval_no, method, receipt_url, at
                  FROM shop_payments WHERE order_id = $1 ORDER BY at, id`, [id]),
      db.query(`SELECT number, to_char(due_date, 'YYYY-MM-DD') AS due_date, amount, status, error FROM shop_instalments WHERE order_id = $1 ORDER BY number`, [id]),
      db.query(`SELECT at, kind, method, currency, amount, supply, vat, vat_rule, fee, fx_rate, amount_krw, note FROM shop_ledger WHERE order_id = $1 ORDER BY at, id`, [id]),
    ]);
    return { order, payments, instalments, ledger: lines };
  },
};

module.exports = { section: 'shop', actions, writes: [], STATUSES };
