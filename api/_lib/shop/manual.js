/*
 * Orders made by hand in the admin (shop_orders.origin = 'manual'), docs/commerce-plan.md section 13.
 *
 * Three ways such an order is paid:
 *   link   the customer gets a payment link (/checkout/pay/<token>, LINK_DAYS days) and pays it by card (KRW,
 *          CiderPay) or PayPal (USD), exactly like a checkout order from then on: the provider's notice records it.
 *   paid   the money already arrived another way (bank transfer, cash…): recorded now, by hand, with the day it
 *          was received, its own tax ledger line(s), and the customer's ActiveCampaign tags.
 *   free   given for free (a scholarship, a guest): no payment and no tax line; the order is "paid" so the
 *          customer gets their purchase tags, like any buyer.
 * The admin can also record any unpaid order (checkout or link) as paid by hand, and cancel an unpaid one.
 *
 * The rules that matter:
 * - Amounts still come from pricing.quote(): the admin picks the product, option, add-ons and currency, and may
 *   set a special price for the product (never above its price). The difference is the order's discount.
 * - A product doesn't need to be on sale (a late joiner, a closed cohort). Draft products can't be sold.
 * - Pay in full only (instalment plans are phase 3).
 * - A payment by hand is recorded once per order (provider_ref 'manual-<order id>'), with the same single
 *   statement as a provider's payment (orders.recordPayment).
 */
const db = require('../db.js');
const orders = require('./orders.js');
const pricing = require('./pricing.js');
const config = require('./config.js');
const validate = require('./validate.js');

const LINK_DAYS = orders.LINK_DAYS;
const HOW = ['link', 'paid', 'free'];
// How money received outside the site came in (stored as the payment's and the tax line's `method`).
const METHODS = { bank: 'bank transfer', cash: 'cash', card: 'card (outside the site)', paypal: 'PayPal (outside the site)', other: 'other' };

class ManualError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
    this.expose = true;
  }
}

/*
 * The price of an order made by hand (pure). `price`: the special price of the product (or option), or null for
 * its own price. `addons`: add-on products (any of the ones this product offers, on sale or not).
 * → a pricing.quote() whose discount is (price of the product − special price).
 */
function quoteManual(product, { currency, option = null, addons = [], price = null }) {
  let base;
  try {
    base = pricing.quote(product, { currency, plan: 'full', option, addons });
  } catch (err) {
    if (err instanceof pricing.PricingError) throw new ManualError(err.message);
    throw err;
  }
  if (price == null) return base;
  const regular = base.items[0].amount;
  if (!Number.isInteger(price) || price < 0) throw new ManualError('the special price must be a whole number, zero or more');
  if (price > regular) throw new ManualError(`the special price is above the product's price (${pricing.formatMoney(regular, currency)})`);
  return pricing.quote(product, { currency, plan: 'full', option, addons, discount: regular - price });
}

// The add-ons the admin may add: the ones this product offers (product.addon_ids), whatever their sale state.
async function addonsOf(product, ids) {
  const wanted = [...new Set((ids || []).map(Number))];
  if (!wanted.length) return [];
  const offered = new Set((product.addon_ids || []).map(Number));
  if (wanted.some((id) => !offered.has(id))) throw new ManualError('an add-on is not one this product offers');
  const rows = await db.query('SELECT * FROM shop_products WHERE id = ANY($1::int[])', [wanted]);
  return (product.addon_ids || []).map(Number).filter((id) => wanted.includes(id)).map((id) => rows.find((r) => r.id === id)).filter(Boolean);
}

/*
 * The customer's details for the order: what the admin typed, and for an existing customer their known details
 * where the admin left a field empty (refreshCustomer copies the order's details onto the customer once paid,
 * so an empty field must not wipe what was known).
 */
async function billingFor(input) {
  const email = String(input.email || '').trim().toLowerCase();
  const known = email ? await db.one('SELECT * FROM shop_customers WHERE email = $1', [email]) : null;
  const pick = (k) => {
    const v = validate.clean(input[k]);
    return v || (known ? String(known[k] || '') : '');
  };
  const billing = { name: pick('name'), email, phone: '', country: pick('country').toUpperCase(), postcode: pick('postcode'), address1: pick('address1'), address2: pick('address2') };
  if (!validate.validEmail(billing.email)) throw new ManualError('a valid email is required');
  if (!billing.name) throw new ManualError('the customer’s name is required');
  if (billing.name.length > 60) throw new ManualError('the name is too long (60 characters at most)');
  const typed = validate.clean(input.phone);
  if (typed) {
    const p = validate.phoneInput(input.phone_country || billing.country || 'KR', typed);
    if (p.error) throw new ManualError('the phone number is not valid (a Korean mobile number, or a number with its country code: +1 415…)');
    billing.phone = p.value;
  } else if (known) billing.phone = String(known.phone || '');
  return billing;
}

// "2026-11-18" (a Seoul day) → that day at 12:00 KST; never in the future, never before 2020.
function receivedAt(day, now = new Date()) {
  if (!day) return now;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new ManualError('the date received must be a date (YYYY-MM-DD)');
  const at = new Date(`${day}T12:00:00+09:00`);
  if (Number.isNaN(at.getTime()) || at.getUTCFullYear() < 2020) throw new ManualError('the date received is not valid');
  if (at.getTime() - 12 * 60 * 60 * 1000 > now.getTime()) throw new ManualError('the date received is in the future');
  return at > now ? now : at;
}

/*
 * Creates an order by hand. input:
 *   product (id), currency, option (key), addons ([ids]), price (special price, or null), how ('link' | 'paid' | 'free')
 *   customer: email, name, phone, phone_country, country, postcode, address1, address2
 *   method, received (YYYY-MM-DD), reference   for 'paid'
 *   note                                        kept on the order (the admin sees it)
 * → { order, link }   link = the payment link ('link' only)
 */
async function create(input, { by = 'admin', providers = ['ciderpay', 'paypal'], now = new Date() } = {}) {
  const how = String(input.how || '');
  if (!HOW.includes(how)) throw new ManualError('choose how the order is paid: payment link, already paid, or free');
  const product = await db.one('SELECT * FROM shop_products WHERE id = $1', [Number(input.product) || 0]);
  if (!product) throw new ManualError('product not found');
  if (product.status === 'draft') throw new ManualError('this product is a draft: open or close it first');
  if (product.addon_only) throw new ManualError('this product is only sold as an add-on');
  const currency = String(input.currency || '').toUpperCase();
  if (!pricing.CURRENCIES.includes(currency)) throw new ManualError('choose a currency');
  const hasOptions = pricing.priceOptions(product).length > 0;
  const option = hasOptions ? String(input.option || '') : null;
  if (hasOptions && !pricing.priceOptions(product).some((o) => o.key === option)) throw new ManualError('choose one of the product’s pricing options');
  const addons = await addonsOf(product, input.addons);
  const price = how === 'free' ? 0 : input.price === '' || input.price == null ? null : Number(input.price);
  if (how === 'free' && addons.length) throw new ManualError('a free order can’t include add-ons: make it for the product alone');
  const offer = quoteManual(product, { currency, option, addons, price });
  if (how !== 'free' && offer.total <= 0) throw new ManualError('this order costs nothing: choose “free” instead');
  if (how === 'link') {
    const provider = orders.providerFor(currency);
    if (!providers.includes(provider)) throw new ManualError(`${provider === 'paypal' ? 'PayPal' : 'CiderPay'} is not set up on this site: a payment link in ${currency} can’t be paid`);
    if (provider === 'paypal' && offer.total < 100) throw new ManualError('PayPal needs at least $1.00');
  }
  const billing = await billingFor(input.customer || {});
  if (how === 'link' && currency === 'KRW' && !billing.phone) throw new ManualError('a payment link in won needs the customer’s mobile number (the card payment page asks for it)');
  const note = String(input.note || '').trim().slice(0, 1000);
  const paidInfo = how === 'paid' ? paidDetails(input, now) : null;

  const order = await orders.insertOrder({
    product, billing, origin: 'manual', note,
    offer: { ...offer, provider: how === 'link' ? orders.providerFor(currency) : null },
    source: { by },
  });
  if (how === 'link') return { order, link: config.payLinkUrl(order.token) };
  if (how === 'free') return { order: await giveFree(order, product, { by }) };
  return { order: await recordByHand(order, product, { ...paidInfo, by }) };
}

function paidDetails(input, now = new Date()) {
  const method = String(input.method || '');
  if (!METHODS[method]) throw new ManualError('choose how the money was received');
  const reference = String(input.reference || '').trim().slice(0, 200);
  return { method, at: receivedAt(input.received, now), reference };
}

/*
 * Records the order's payment as received outside the site (the whole amount still due). One per order.
 * → the order, now paid. Then the usual steps (AC tags, Slack…).
 */
async function recordByHand(order, product, { method, at, reference = '', by = 'admin' }) {
  if (!orders.UNPAID.includes(order.status)) throw new ManualError('this order is already paid');
  if (order.plan !== 'full') throw new ManualError('instalment orders can’t be recorded by hand yet');
  if (!(order.due_today > 0)) throw new ManualError('nothing to pay on this order');
  const flow = require('./flow.js');
  flow.guardDatabase();
  const payment = {
    provider: 'manual', amount: order.due_today, ref: `manual-${order.id}`, method: METHODS[method] || 'other', at,
    raw: { recorded_by: by, reference, received: at.toISOString() },
  };
  const result = await orders.recordPayment(order, product, payment);
  if (!result.recorded) throw new ManualError('this order already has a payment recorded by hand');
  await orders.logCallback({ provider: 'manual', outcome: 'paid', reason: `recorded by hand (${payment.method}${reference ? ': ' + reference : ''})`, orderId: order.id, payload: payment.raw });
  await flow.afterPaid(result.order, product, payment, { sendNow: true });
  return result.order;
}

// A free order: paid, with nothing to pay and no tax line. The customer gets their purchase tags.
async function giveFree(order, product, { by = 'admin' } = {}) {
  if (order.total !== 0) throw new ManualError('only an order at ₩0 / $0 can be given for free');
  const flow = require('./flow.js');
  flow.guardDatabase();
  const row = await db.one(
    `UPDATE shop_orders SET status = 'paid', paid_at = now(), provider = NULL, updated_at = now()
      WHERE id = $1 AND status IN ('created', 'awaiting_payment', 'expired', 'cancelled') RETURNING *`, [order.id]);
  if (!row) throw new ManualError('this order is already paid');
  await orders.logCallback({ provider: 'manual', outcome: 'paid', reason: `given for free by ${by}`, orderId: order.id, payload: { by } });
  await flow.afterPaid(row, product, { method: 'free' }, { sendNow: true, slack: false });
  return row;
}

// An unpaid order the customer will not pay (a link sent by mistake…). A payment that still arrives is recorded.
async function cancel(orderId, { by = 'admin', reason = '' } = {}) {
  const row = await db.one(
    `UPDATE shop_orders SET status = 'cancelled', note = CASE WHEN note = '' THEN $2 ELSE note || E'\\n' || $2 END, updated_at = now()
      WHERE id = $1 AND status IN ('created', 'awaiting_payment', 'expired') RETURNING *`,
    [orderId, `Cancelled by ${by}${reason ? ': ' + reason : ''}`.slice(0, 500)]);
  if (!row) throw new ManualError('only an unpaid order can be cancelled');
  return row;
}

// The last day a payment link works (Seoul date), from the order's creation.
function linkLastDay(order) {
  const end = new Date(new Date(order.created_at).getTime() + LINK_DAYS * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(end);
}

// Can the customer pay this order from its link right now? → null, or why not: 'paid' | 'ended'.
function linkState(order, now = new Date()) {
  if (order.paid_at) return 'paid';
  if (order.origin !== 'manual' || !order.provider || !['created', 'awaiting_payment'].includes(order.status)) return 'ended';
  if (now.getTime() - new Date(order.created_at).getTime() >= LINK_DAYS * 24 * 60 * 60 * 1000) return 'ended';
  return null;
}

module.exports = { LINK_DAYS, HOW, METHODS, ManualError, quoteManual, addonsOf, billingFor, receivedAt, create, paidDetails, recordByHand, giveFree, cancel, linkLastDay, linkState };
