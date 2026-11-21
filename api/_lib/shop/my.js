/*
 * "내 주문" (/my): a customer's own orders, payments, receipts and instalment plan (docs/commerce-plan.md 3.9,
 * section 16). Signed in with the student area's email code and cookie (api/_lib/learn/auth.js): one sign-in for
 * both pages. The customer is the shop customer with the signed-in email; nothing else is ever shown.
 *
 * The page is api/_lib/shop/my-page.js; the routes are in api/learn.js (/my, POST /my/pay).
 * view() is pure (unit-tested in tests/shop/my.test.js); the rest reads the database.
 */
const db = require('../db.js');
const config = require('./config.js');

// Orders a customer sees: those that were paid at some point. Unpaid, expired and cancelled checkouts are not orders
// to them (a cancelled order that had been paid is a refund, and stays).
const SHOWN = `(o.paid_at IS NOT NULL OR o.status IN ('paid', 'refund_requested', 'partially_refunded', 'refunded'))`;

// Instalments the customer may pay themself from /my: missed ones of a plan still running (not paused by the admin).
const PAYABLE_PLAN = ['active', 'overdue'];
const PAYABLE_ROW = ['failed', 'overdue'];

const dateOf = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));

/*
 * What the page shows for one order (pure).
 *   order: the shop_orders row; items, payments, instalments, refunds: its rows.
 * → { id, number, name, option, status, currency, plan, total, paid, refunded, coupon, placed, items (add-ons only
 *     when there are any), payments [{ at, amount, kind, number, receipt }], refunds [{ at, amount }],
 *     schedule [{ number, due, amount, status, payable }] | null, planInfo { status, card, next, left, count, paidCount } | null }
 */
function view({ order, items = [], payments = [], instalments = [], refunds = [] }) {
  const isPlan = order.plan === 'instalment' && instalments.length > 0;
  const running = PAYABLE_PLAN.includes(order.plan_status);
  const schedule = isPlan ? instalments.slice().sort((a, b) => a.number - b.number).map((r) => ({
    number: r.number,
    due: dateOf(r.due_date),
    amount: r.amount,
    status: r.status,
    // A missed instalment the customer can pay now, by card (won only: CiderPay).
    payable: running && order.currency === 'KRW' && r.number > 1 && PAYABLE_ROW.includes(r.status),
  })) : null;
  const open = schedule ? schedule.filter((r) => ['due', 'failed', 'overdue'].includes(r.status)) : [];
  const next = open.find((r) => r.status === 'due') || null;
  const option = order.price_option && order.price_option.label ? order.price_option.label : '';
  return {
    id: order.id,
    number: order.number,
    name: order.product_name,
    option,
    status: order.status,
    currency: order.currency,
    plan: order.plan,
    total: order.total,
    paid: order.paid_total || 0,
    refunded: order.refunded_total || 0,
    discount: order.discount || 0,
    coupon: order.coupon_code || '',
    placed: order.paid_at || order.created_at,
    // Add-ons are listed only when the order has more than its main item.
    items: items.length > 1 ? items.map((i) => ({ name: i.name, amount: i.amount })) : [],
    payments: payments.map((p) => ({
      at: p.at,
      amount: p.amount,
      number: p.instalment_no || null,
      // Only an https address is a link (CiderPay's card receipt); PayPal sends its own receipt by email.
      receipt: p.receipt_url && /^https:\/\//.test(p.receipt_url) ? p.receipt_url : '',
    })),
    refunds: refunds.map((r) => ({ at: r.done_at || r.created_at, amount: r.amount })),
    schedule,
    planInfo: isPlan ? {
      status: order.plan_status,
      card: order.rp_card || '',
      count: schedule.length,
      next: next && ['active', 'overdue'].includes(order.plan_status) ? { due: next.due, amount: next.amount } : null,
      left: open.reduce((s, r) => s + r.amount, 0),
      paidCount: schedule.filter((r) => r.status === 'paid').length,
    } : null,
  };
}

// The instalments the customer should pay now, across their orders: [{ order, number, due, amount, count }].
function missed(views) {
  const out = [];
  for (const v of views) {
    for (const r of v.schedule || []) {
      if (r.payable) out.push({ order: v.id, orderNumber: v.number, name: v.name, number: r.number, due: r.due, amount: r.amount, currency: v.currency, count: v.schedule.length });
    }
  }
  return out;
}

// The shop customer of this email (the sign-in's), or null.
async function customerOf(email) {
  return db.one('SELECT * FROM shop_customers WHERE lower(email) = lower($1)', [email]);
}

// True when this email has an order that was paid (so it may sign in to see it, even before ActiveCampaign has its tag).
async function hasOrders(email) {
  const row = await db.one(`SELECT EXISTS (SELECT 1 FROM shop_orders o JOIN shop_customers c ON c.id = o.customer_id
                                             WHERE lower(c.email) = lower($1) AND ${SHOWN}) AS yes`, [email]);
  return Boolean(row && row.yes);
}

// Everything /my shows for this email. → { customer, orders: [view], missed }
async function forEmail(email) {
  const customer = await customerOf(email);
  if (!customer) return { customer: null, orders: [], missed: [] };
  const list = await db.query(`SELECT o.* FROM shop_orders o WHERE o.customer_id = $1 AND ${SHOWN} ORDER BY coalesce(o.paid_at, o.created_at) DESC, o.id DESC LIMIT 100`, [customer.id]);
  if (!list.length) return { customer, orders: [], missed: [] };
  const ids = list.map((o) => o.id);
  const by = async (sql) => {
    const rows = await db.query(sql, [ids]);
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.order_id)) map.set(r.order_id, []);
      map.get(r.order_id).push(r);
    }
    return map;
  };
  const [items, payments, instalments, refunds] = await Promise.all([
    by('SELECT order_id, name, amount FROM shop_order_items WHERE order_id = ANY($1::int[]) ORDER BY order_id, position'),
    by(`SELECT order_id, at, amount, instalment_no, receipt_url FROM shop_payments WHERE order_id = ANY($1::int[]) AND kind = 'payment' ORDER BY order_id, at, id`),
    by(`SELECT order_id, number, to_char(due_date, 'YYYY-MM-DD') AS due_date, amount, status FROM shop_instalments WHERE order_id = ANY($1::int[]) ORDER BY order_id, number`),
    by(`SELECT order_id, amount, done_at, created_at FROM shop_refunds WHERE order_id = ANY($1::int[]) AND status = 'done' ORDER BY order_id, coalesce(done_at, created_at)`),
  ]);
  const orders = list.map((order) => view({
    order, items: items.get(order.id) || [], payments: payments.get(order.id) || [],
    instalments: instalments.get(order.id) || [], refunds: refunds.get(order.id) || [],
  }));
  return { customer, orders, missed: missed(orders) };
}

/*
 * The customer pressed "지금 결제하기" on a missed instalment: the payment link of that instalment (made, or renewed
 * for 14 more days, exactly like the admin's "Payment link"). Only for this customer's own order.
 * → the link's address, or null when that instalment can't be paid from /my (paid meanwhile, plan paused…).
 */
async function payLink(email, orderId, number) {
  const customer = await customerOf(email);
  if (!customer || !Number.isInteger(orderId) || !Number.isInteger(number)) return null;
  const order = await db.one('SELECT * FROM shop_orders WHERE id = $1 AND customer_id = $2', [orderId, customer.id]);
  if (!order) return null;
  const rows = await db.query(`SELECT number, to_char(due_date, 'YYYY-MM-DD') AS due_date, amount, status FROM shop_instalments WHERE order_id = $1`, [order.id]);
  const row = view({ order, instalments: rows }).schedule;
  const target = row && row.find((r) => r.number === number);
  if (!target || !target.payable || !config.ciderpayConfigured()) return null;
  const instalments = require('./instalments.js');
  try {
    const link = await instalments.makeLink(order.id, number, { by: 'the customer (/my)' });
    return link.url;
  } catch (err) {
    if (err instanceof instalments.PlanError) return null;
    throw err;
  }
}

module.exports = { view, missed, customerOf, hasOrders, forEmail, payLink, PAYABLE_PLAN, PAYABLE_ROW };
