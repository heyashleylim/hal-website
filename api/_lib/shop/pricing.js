/*
 * Shop prices (pure: no database, no network). Every amount a customer is shown or charged is worked out
 * here, on the server, from the product: the browser only ever says "this product, this currency, this plan".
 * Unit-tested in tests/shop/pricing.test.js. Change the rules here and in the tests only.
 *
 * Money is a whole number in the currency's smallest unit: won for KRW, cents for USD.
 * Prices include VAT (10%). Coupons and referral discounts join in a later phase (quote() takes `discount`).
 */

const CURRENCIES = ['KRW', 'USD'];
const VAT_RATE = 10; // percent, included in the price

// A pricing problem with a stable code (the checkout turns codes into Korean messages; the admin shows `message`).
class PricingError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 400;
    this.expose = true;
  }
}

function isAmount(n) {
  return Number.isInteger(n) && n >= 0;
}

// Splits a VAT-inclusive amount into supply (공급가액) and VAT (부가세): supply = amount × 10/11, rounded
// to the unit; VAT is the rest, so the two always add up. rule 'zero' = zero-rated or not taxable: no VAT.
// Works for negative amounts (refunds): the split of −x is the negative of the split of x.
function vatSplit(amount, rule = 'taxable') {
  if (!Number.isInteger(amount)) throw new PricingError('bad_amount', 'amount must be a whole number');
  if (rule === 'zero') return { supply: amount, vat: 0 };
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  const supply = Math.round((abs * 100) / (100 + VAT_RATE));
  return { supply: sign * supply, vat: sign * (abs - supply) };
}

// How VAT applies to a sale of this product in this currency.
function vatRule(product, currency) {
  return currency === 'USD' && product.usd_vat === 'zero' ? 'zero' : 'taxable';
}

// The product's instalment plan (KRW only), or null: { first, monthly, count, payments, total }.
function instalmentPlan(product) {
  const { instalment_first: first, instalment_monthly: monthly, instalment_count: count } = product;
  if (first == null || monthly == null || count == null) return null;
  return { first, monthly, count, payments: count + 1, total: first + monthly * count };
}

// Is the product on sale at `now`? → { open, reason } with reason 'draft' | 'closed' | 'not_started' | 'ended'.
function saleState(product, now = new Date()) {
  if (product.status === 'draft') return { open: false, reason: 'draft' };
  if (product.status !== 'open') return { open: false, reason: 'closed' };
  if (product.sale_starts_at && now < new Date(product.sale_starts_at)) return { open: false, reason: 'not_started' };
  if (product.sale_ends_at && now >= new Date(product.sale_ends_at)) return { open: false, reason: 'ended' };
  return { open: true, reason: null };
}

// Which currencies and plans this product can be bought with.
function options(product) {
  const out = [];
  if (product.price_krw != null) {
    out.push({ currency: 'KRW', plan: 'full' });
    if (instalmentPlan(product)) out.push({ currency: 'KRW', plan: 'instalment' });
  }
  if (product.price_usd != null) out.push({ currency: 'USD', plan: 'full' });
  return out;
}

/*
 * The price of one purchase.
 *   quote(product, { currency: 'KRW', plan: 'instalment' })
 *   quote(product, { currency: 'KRW', addons: [addonProduct, …] })   (pay in full only)
 * → { currency, plan, subtotal, discount, total, dueToday, vatRule, supply, vat, payments: [{ number, amount }],
 *     items: [{ kind, product_id, name, amount, vatRule }], groups: [{ vatRule, amount, supply, vat }] }
 * `total` is everything the customer will pay; `dueToday` what is charged at checkout; `payments` lists each
 * charge in order (one entry for pay-in-full). A discount applies to the product, in pay-in-full only for now.
 * `vatRule` is the product's; with add-ons under another rule, `groups` has one entry per rule.
 */
function quote(product, { currency = 'KRW', plan = 'full', discount = 0, addons = [] } = {}) {
  if (!CURRENCIES.includes(currency)) throw new PricingError('bad_currency', `unknown currency "${currency}"`);
  if (plan !== 'full' && plan !== 'instalment') throw new PricingError('bad_plan', `unknown plan "${plan}"`);
  if (!isAmount(discount)) throw new PricingError('bad_discount', 'discount must be a whole number, zero or more');
  if (!Array.isArray(addons)) throw new PricingError('bad_addon', 'addons must be a list of products');

  const price = priceIn(product, currency);
  if (price == null) throw new PricingError('no_price', `this product has no ${currency} price`);

  const rule = vatRule(product, currency);
  let subtotal = price;
  let mainAmount = price;
  let payments;
  if (plan === 'instalment') {
    const p = currency === 'KRW' ? instalmentPlan(product) : null;
    if (!p) throw new PricingError('no_plan', currency === 'KRW' ? 'this product has no instalment plan' : 'instalments are only available in KRW');
    if (discount) throw new PricingError('discount_plan', 'a discount cannot be combined with the instalment plan yet');
    if (addons.length) throw new PricingError('addon_plan', 'add-ons cannot be combined with the instalment plan yet');
    subtotal = p.total;
    mainAmount = p.total;
    payments = [{ number: 1, amount: p.first }];
    for (let i = 1; i <= p.count; i++) payments.push({ number: i + 1, amount: p.monthly });
  } else {
    if (discount > price) throw new PricingError('discount_too_big', 'the discount is larger than the price');
    mainAmount = price - discount;
  }

  // What the order holds: the product (less any discount), then each add-on at its price in this currency.
  const items = [{ kind: 'main', product_id: product.id == null ? null : product.id, name: product.name, amount: mainAmount, vatRule: rule }];
  const seen = new Set([product.id]);
  for (const a of addons) {
    if (!a || a.id == null || seen.has(a.id)) throw new PricingError('bad_addon', 'an add-on is missing, repeated or the product itself');
    seen.add(a.id);
    const amount = priceIn(a, currency);
    if (amount == null) throw new PricingError('no_price', `the add-on "${a.name}" has no ${currency} price`);
    items.push({ kind: 'addon', product_id: a.id, name: a.name, amount, vatRule: vatRule(a, currency) });
    subtotal += amount;
  }
  const total = subtotal - discount;
  if (!payments) payments = [{ number: 1, amount: total }];

  // VAT is split once per VAT rule (normally one: the whole order), so the order's lines add up exactly.
  const groups = vatGroups(items);
  const supply = groups.reduce((s, g) => s + g.supply, 0);
  const vat = groups.reduce((s, g) => s + g.vat, 0);
  return { currency, plan, subtotal, discount, total, dueToday: payments[0].amount, vatRule: rule, supply, vat, payments, items, groups };
}

const priceIn = (product, currency) => (currency === 'KRW' ? product.price_krw : product.price_usd);
const compareIn = (product, currency) => (currency === 'KRW' ? product.compare_krw : product.compare_usd);

// Items → one entry per VAT rule: [{ vatRule, amount, supply, vat }] ('taxable' first). Items need { amount, vatRule }.
function vatGroups(items) {
  const sums = new Map();
  for (const it of items) {
    const rule = it.vatRule || it.vat_rule;
    if (rule !== 'taxable' && rule !== 'zero') throw new PricingError('bad_rule', `unknown VAT rule "${rule}"`);
    if (!isAmount(it.amount)) throw new PricingError('bad_amount', 'an item amount must be a whole number, zero or more');
    sums.set(rule, (sums.get(rule) || 0) + it.amount);
  }
  return ['taxable', 'zero'].filter((r) => sums.has(r)).map((r) => ({ vatRule: r, amount: sums.get(r), ...vatSplit(sums.get(r), r) }));
}

/*
 * The add-ons the checkout of `product` offers in `currency` at `now`, in the order set in the admin:
 * [{ product, amount, compare, vatRule }]. `all` is a list of products (at least those in product.addon_ids).
 * An add-on is left out when it is the product itself, not on sale, or has no price in this currency.
 * `compare` (the regular price, shown crossed out) is null unless it is higher than the price.
 */
function addonChoices(product, all, currency, now = new Date()) {
  const byId = new Map((all || []).map((p) => [p.id, p]));
  const out = [];
  for (const id of [...new Set(product.addon_ids || [])]) {
    const a = byId.get(id);
    if (!a || a.id === product.id || !saleState(a, now).open) continue;
    const amount = priceIn(a, currency);
    if (amount == null) continue;
    const compare = compareIn(a, currency);
    out.push({ product: a, amount, compare: compare != null && compare > amount ? compare : null, vatRule: vatRule(a, currency) });
  }
  return out;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function daysInMonth(year, month) { // month 1–12
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/*
 * Due dates of an instalment plan that starts on `start` ('YYYY-MM-DD', Seoul date) with `payments` charges:
 * the first is due that day, then one per month on the same day of the month. CiderPay bills on a fixed day
 * of the month, so the day is capped at 30 (as the WooCommerce plugin did), and at the month's last day in
 * shorter months (30 Jan → 28 or 29 Feb → 30 Mar).
 */
function schedule(start, payments) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(start));
  if (!m || !Number.isInteger(payments) || payments < 1) throw new PricingError('bad_schedule', 'schedule needs a start date (YYYY-MM-DD) and a number of payments');
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) throw new PricingError('bad_schedule', 'not a real date');
  const billingDay = Math.min(day, 30);
  const dates = [`${m[1]}-${m[2]}-${m[3]}`];
  for (let i = 1; i < payments; i++) {
    const index = month - 1 + i;
    const y = year + Math.floor(index / 12);
    const mo = (index % 12) + 1;
    dates.push(`${y}-${pad(mo)}-${pad(Math.min(billingDay, daysInMonth(y, mo)))}`);
  }
  return dates;
}

// '₩2,690,000', '$2,299', '$19.50'. Negative amounts keep their sign in front: '-₩10,000'.
function formatMoney(amount, currency) {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (currency === 'USD') {
    const dollars = Math.floor(abs / 100).toLocaleString('en-US');
    const cents = abs % 100;
    return `${sign}$${dollars}${cents ? '.' + pad(cents) : ''}`;
  }
  return `${sign}₩${abs.toLocaleString('en-US')}`;
}

module.exports = { CURRENCIES, VAT_RATE, PricingError, vatSplit, vatRule, vatGroups, instalmentPlan, saleState, options, quote, addonChoices, schedule, formatMoney };
