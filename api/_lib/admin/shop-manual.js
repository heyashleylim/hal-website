/*
 * Shop admin API: orders made by hand (rules in api/_lib/shop/manual.js; docs/commerce-plan.md section 13).
 * Page: /admin/shop/orders/ ("New order", and the actions on an unpaid order).
 */
const db = require('../db.js');
const manual = require('../shop/manual.js');
const flow = require('../shop/flow.js');
const pricing = require('../shop/pricing.js');
const config = require('../shop/config.js');
const { userError, text, int } = require('./util.js');
const { cents } = require('./shop-products.js');

const id = (value, label) => int(value, { min: 1, max: 2147483647, label });

// The special price as typed: won for KRW, dollars ("1,990.00") for USD → the smallest unit, or null when empty.
function priceInput(value, currency) {
  const s = String(value == null ? '' : value).replace(/,/g, '').trim();
  if (!s) return null;
  if (currency === 'USD') return s === '0' || s === '0.00' ? 0 : cents(s, 'Special price');
  return int(s, { min: 0, max: 1000000000, label: 'Special price' });
}

// What the form sends → manual.create's input (the admin page posts the same shape for a preview and to create).
function orderInput(input) {
  const currency = String(input.currency || '').toUpperCase();
  return {
    product: id(input.product, 'product'),
    currency,
    option: text(input.option, { max: 40 }),
    addons: (Array.isArray(input.addons) ? input.addons : []).map((x) => id(x, 'add-on')),
    price: input.how === 'free' ? 0 : priceInput(input.price, currency),
    how: String(input.how || ''),
    customer: input.customer && typeof input.customer === 'object' ? input.customer : {},
    method: String(input.method || ''),
    received: text(input.received, { max: 10 }),
    reference: text(input.reference, { max: 200, label: 'Reference' }),
    note: text(input.note, { max: 1000, label: 'Note' }),
  };
}

const asUserError = async (fn) => {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof manual.ManualError || err instanceof pricing.PricingError) throw userError(err.message);
    if (err && err.code === 'not_configured') throw userError(err.message, 503);
    throw err;
  }
};

async function orderById(orderId) {
  const order = await db.one('SELECT * FROM shop_orders WHERE id = $1', [orderId]);
  if (!order) throw userError('order not found', 404);
  return order;
}

const actions = {
  // What the "New order" form offers: every product that can be sold by hand, with its options, add-ons and
  // prices, and which payment links this site can take (CiderPay = KRW, PayPal = USD).
  async 'shop-manual-form'() {
    const rows = await db.query(`SELECT id, name, slug, status, price_krw, price_usd, price_options, addon_ids, addon_only FROM shop_products WHERE status <> 'draft' ORDER BY name, id`);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const products = rows.filter((r) => !r.addon_only).map((p) => ({
      id: p.id, name: p.name, slug: p.slug, status: p.status, price_krw: p.price_krw, price_usd: p.price_usd,
      options: pricing.priceOptions(p).map((o) => ({ key: o.key, label: o.label, price_krw: o.price_krw, price_usd: o.price_usd })),
      addons: (p.addon_ids || []).map((a) => byId.get(Number(a))).filter(Boolean).map((a) => ({ id: a.id, name: a.name, price_krw: a.price_krw, price_usd: a.price_usd })),
    }));
    return { products, providers: flow.providers(), methods: manual.METHODS, linkDays: manual.LINK_DAYS };
  },

  // The amounts the order would have (nothing is saved, nothing logged: POST only because it takes lists).
  async 'shop-manual-quote'(input) {
    const x = orderInput(input);
    return asUserError(async () => {
      const product = await db.one('SELECT * FROM shop_products WHERE id = $1', [x.product]);
      if (!product) throw userError('product not found', 404);
      if (!pricing.CURRENCIES.includes(x.currency)) throw userError('choose a currency');
      const opts = pricing.priceOptions(product).length ? x.option : null;
      const q = manual.quoteManual(product, { currency: x.currency, option: opts || null, addons: await manual.addonsOf(product, x.addons), price: x.price });
      return { quote: { currency: q.currency, subtotal: q.subtotal, discount: q.discount, total: q.total, vat: q.vat, items: q.items.map((i) => ({ kind: i.kind, name: i.name, amount: i.amount })) }, log: null };
    });
  },

  async 'shop-manual-create'(input, { admin }) {
    const x = orderInput(input);
    const r = await asUserError(() => manual.create(x, { by: admin, providers: flow.providers() }));
    return {
      order: { id: r.order.id, number: r.order.number, status: r.order.status, total: r.order.total, currency: r.order.currency },
      link: r.link || '',
      target: `order ${r.order.number}`,
      log: { order: r.order.number, how: x.how, product: x.product, currency: x.currency, total: r.order.total, email: r.order.billing && r.order.billing.email },
    };
  },

  // An unpaid order (from the checkout or a payment link) paid another way: recorded by hand.
  async 'shop-order-mark-paid'(input, { admin }) {
    const order = await orderById(id(input.order, 'order'));
    const product = await db.one('SELECT * FROM shop_products WHERE id = $1', [order.product_id]);
    const paid = await asUserError(() => manual.recordByHand(order, product, { ...manual.paidDetails(input), by: admin }));
    return { order: { id: paid.id, status: paid.status }, target: `order ${order.number}`, log: { order: order.number, method: input.method, reference: input.reference || '' } };
  },

  async 'shop-order-cancel'(input, { admin }) {
    const order = await orderById(id(input.order, 'order'));
    const reason = text(input.reason, { max: 300, label: 'Reason' });
    const row = await asUserError(() => manual.cancel(order.id, { by: admin, reason }));
    return { order: { id: row.id, status: row.status }, target: `order ${order.number}`, log: { order: order.number, reason } };
  },
};

// The payment link of an order made in the admin, while it can still be paid ('' otherwise).
function linkOf(order) {
  return order.origin === 'manual' && !manual.linkState(order) ? config.payLinkUrl(order.token) : '';
}

module.exports = { section: 'shop', actions, writes: ['shop-manual-quote', 'shop-manual-create', 'shop-order-mark-paid', 'shop-order-cancel'], linkOf, priceInput };
