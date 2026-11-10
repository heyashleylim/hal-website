/*
 * The tax ledger's rules (pure: no database). One line per movement of money, built here so every sale and
 * refund is split into supply and VAT the same way. Unit-tested in tests/shop/ledger.test.js.
 * The table (shop_ledger) is append-only; see db/migrations/005_shop.sql.
 */
const pricing = require('./pricing.js');

// Seoul date parts of an instant: { date: 'YYYY-MM-DD', year, month, quarter: 1–4, half: 1–2 }.
// VAT is filed per quarter / half-year and income per year, all on Korean dates.
function seoul(at) {
  const p = {};
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(at)).forEach((x) => { p[x.type] = x.value; });
  const month = Number(p.month);
  return { date: `${p.year}-${p.month}-${p.day}`, year: Number(p.year), month, quarter: Math.ceil(month / 3), half: month <= 6 ? 1 : 2 };
}

/*
 * The ledger line for one payment or refund.
 *   payment: { id, kind: 'payment' | 'refund', amount (positive), fee, instalment_no, provider, method, at }
 *   order:   { id, currency, plan }
 *   product: { usd_vat }
 *   fx:      optional { rate, source } for USD lines (won per dollar)
 * Sales are positive, refunds negative; supply + vat = amount on every line.
 */
function line({ payment, order, product, fx = null, note = '' }) {
  if (!Number.isInteger(payment.amount) || payment.amount <= 0) throw new Error('a payment amount must be a positive whole number');
  const refund = payment.kind === 'refund';
  const sign = refund ? -1 : 1;
  const amount = sign * payment.amount;
  const rule = pricing.vatRule(product, order.currency);
  const { supply, vat } = pricing.vatSplit(amount, rule);
  const out = {
    at: payment.at,
    order_id: order.id,
    payment_id: payment.id == null ? null : payment.id,
    kind: refund ? 'refund' : order.plan === 'instalment' ? 'instalment' : 'sale',
    provider: payment.provider,
    method: payment.method || '',
    currency: order.currency,
    amount, supply, vat,
    vat_rule: rule,
    fee: payment.fee == null ? null : sign * payment.fee,
    fx_rate: null, fx_source: null, amount_krw: null,
    note,
  };
  if (order.currency === 'USD' && fx && fx.rate) Object.assign(out, wonValue(amount, fx.rate), { fx_source: fx.source || '' });
  return out;
}

// The won value of a USD amount (cents) at `rate` won per dollar, rounded to the won. A refund rounds like
// its sale (half away from zero), so the two cancel out exactly.
function wonValue(cents, rate) {
  const r = Number(rate);
  if (!(r > 0)) throw new Error('the exchange rate must be a positive number');
  const won = Math.round((Math.abs(cents) * r) / 100);
  return { fx_rate: r, amount_krw: cents < 0 ? -won : won };
}

// Totals of ledger lines per currency: approvals (sales), cancellations (refunds) and net, with supply and VAT.
// The same three rows CiderPay's own VAT document shows (승인 / 취소 / 합계).
function totals(lines) {
  const out = {};
  const blank = () => ({ count: 0, amount: 0, supply: 0, vat: 0 });
  for (const l of lines) {
    const c = out[l.currency] || (out[l.currency] = { approved: blank(), cancelled: blank(), net: blank() });
    for (const row of [l.amount < 0 ? c.cancelled : c.approved, c.net]) {
      row.count += 1;
      row.amount += l.amount;
      row.supply += l.supply;
      row.vat += l.vat;
    }
  }
  return out;
}

module.exports = { seoul, line, wonValue, totals };
