/*
 * The tax and sales reports' rules (pure: no database). Unit-tested in tests/shop/reports.test.js.
 * The queries are in api/_lib/admin/shop-reports.js; the page is /admin/shop/reports.
 * Periods are Seoul dates (VAT is filed per quarter / half-year, income per year).
 */
const ledger = require('./ledger.js');

const pad = (n) => String(n).padStart(2, '0');
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(s) {
  const m = DATE.exec(String(s || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

function nextDay(s) {
  const m = DATE.exec(s);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const firstOf = (year, month) => (month > 12 ? `${year + 1}-01-01` : `${year}-${pad(month)}-01`);

/*
 * A report period from its key:
 *   '2026-11' (month), '2026-Q4' (quarter), '2026-H2' (half-year: 부가세 2기), '2026' (year),
 *   '2026-11-01..2026-11-15' (any dates, both included).
 * → { key, kind, label, from: first Seoul day, to: the day after the last, start / end: the instants (ISO, +09:00) }
 */
function period(key) {
  const k = String(key || '').trim();
  let kind, from, to, label, m;
  if ((m = /^(\d{4})-(\d{2})$/.exec(k)) && +m[2] >= 1 && +m[2] <= 12) {
    const y = +m[1], mo = +m[2];
    kind = 'month'; from = firstOf(y, mo); to = firstOf(y, mo + 1);
    label = `${y}-${pad(mo)}`;
  } else if ((m = /^(\d{4})-Q([1-4])$/i.exec(k))) {
    const y = +m[1], q = +m[2];
    kind = 'quarter'; from = firstOf(y, q * 3 - 2); to = firstOf(y, q * 3 + 1);
    label = `${y} Q${q}`;
  } else if ((m = /^(\d{4})-H([12])$/i.exec(k))) {
    const y = +m[1], h = +m[2];
    kind = 'half'; from = firstOf(y, h === 1 ? 1 : 7); to = firstOf(y, h === 1 ? 7 : 13);
    label = `${y} H${h} (부가세 ${h}기)`;
  } else if ((m = /^(\d{4})$/.exec(k))) {
    const y = +m[1];
    kind = 'year'; from = `${y}-01-01`; to = `${y + 1}-01-01`;
    label = String(y);
  } else if ((m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(k)) && validDate(m[1]) && validDate(m[2]) && m[1] <= m[2]) {
    kind = 'dates'; from = m[1]; to = nextDay(m[2]);
    label = m[1] === m[2] ? m[1] : `${m[1]} – ${m[2]}`;
  } else {
    return null;
  }
  const year = Number(from.slice(0, 4));
  if (year < 2000 || year > 2100) return null;
  return {
    key: kind === 'quarter' || kind === 'half' ? k.toUpperCase() : k, kind, label, from, to,
    start: `${from}T00:00:00+09:00`, end: `${to}T00:00:00+09:00`,
  };
}

// The period that holds a Seoul date, for each kind (the page's quick choices).
function periodsOf(at) {
  const s = ledger.seoul(at);
  return {
    month: `${s.year}-${pad(s.month)}`,
    quarter: `${s.year}-Q${s.quarter}`,
    half: `${s.year}-H${s.half}`,
    year: String(s.year),
  };
}

// How a payment was taken, for grouping: CiderPay's card page, PayPal, by hand, or imported from WooCommerce.
const CHANNELS = { ciderpay: 'Card (CiderPay)', paypal: 'PayPal', manual: 'Recorded by hand', imported: 'Imported (WooCommerce)' };
const channel = (provider) => CHANNELS[provider] || provider;

const blank = () => ({ count: 0, amount: 0, supply: 0, vat: 0 });

/*
 * Everything the "Sales by period" report shows, from the period's ledger lines:
 *   totals:    per currency, approvals / cancellations / net (ledger.totals: CiderPay's 승인 / 취소 / 합계)
 *   byChannel: the same, per currency and payment channel
 *   byRule:    per currency and VAT rule (과세 taxable / 영세 zero-rated): what the VAT return asks for
 *   won:       the period in won: KRW lines as they are, USD lines at their exchange rate; how many USD lines
 *              have no rate yet (their won value is unknown, so the won total is incomplete until they do)
 *   fees:      provider fees per currency (PayPal), and what was received after them
 */
function summary(lines) {
  const byKey = (keyOf) => {
    const groups = new Map();
    for (const l of lines) {
      const k = keyOf(l);
      const id = JSON.stringify(k);
      if (!groups.has(id)) groups.set(id, { ...k, lines: [] });
      groups.get(id).lines.push(l);
    }
    return [...groups.values()]
      .map((g) => ({ ...g, ...ledger.totals(g.lines)[g.currency], lines: undefined }))
      .sort((a, b) => (a.currency + JSON.stringify(a)).localeCompare(b.currency + JSON.stringify(b)));
  };
  const won = { amount: 0, supply: 0, vat: 0, usd_lines: 0, missing_rate: 0 };
  const fees = {};
  for (const l of lines) {
    if (l.currency === 'KRW') {
      won.amount += l.amount; won.supply += l.supply; won.vat += l.vat;
    } else {
      won.usd_lines += 1;
      if (l.amount_krw == null) won.missing_rate += 1;
      else {
        // The won value is split like the line itself: VAT at the same share as in dollars.
        const vat = l.amount === 0 ? 0 : Math.round((l.amount_krw * l.vat) / l.amount);
        won.amount += l.amount_krw; won.vat += vat; won.supply += l.amount_krw - vat;
      }
    }
    const f = fees[l.currency] || (fees[l.currency] = { fee: 0, known: 0, amount: 0 });
    f.amount += l.amount;
    if (l.fee != null) { f.fee += l.fee; f.known += 1; }
  }
  for (const f of Object.values(fees)) f.net = f.amount - f.fee;
  return {
    count: lines.length,
    totals: ledger.totals(lines),
    byChannel: byKey((l) => ({ currency: l.currency, channel: channel(l.provider) })),
    byRule: byKey((l) => ({ currency: l.currency, vat_rule: l.vat_rule })),
    won: { ...won, complete: won.missing_rate === 0 },
    fees,
  };
}

// Revenue per product (the order's product; its add-ons count with it), per currency, net of refunds.
function byProduct(lines) {
  const out = new Map();
  for (const l of lines) {
    const id = `${l.currency}|${l.product_name}`;
    const row = out.get(id) || { currency: l.currency, product: l.product_name, orders: new Set(), sales: blank(), refunds: blank(), net: blank() };
    for (const t of [l.amount < 0 ? row.refunds : row.sales, row.net]) {
      t.count += 1; t.amount += l.amount; t.supply += l.supply; t.vat += l.vat;
    }
    row.orders.add(l.order_id);
    out.set(id, row);
  }
  return [...out.values()]
    .map((r) => ({ ...r, orders: r.orders.size }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.net.amount - a.net.amount);
}

// Money still to come on running instalment plans, per currency: { count (orders), instalments, amount }.
function outstanding(rows) {
  const out = {};
  for (const r of rows) {
    const t = out[r.currency] || (out[r.currency] = { orders: new Set(), instalments: 0, amount: 0, late: 0 });
    t.orders.add(r.order_id);
    t.instalments += 1;
    t.amount += r.amount;
    if (r.status === 'failed' || r.status === 'overdue') t.late += r.amount;
  }
  for (const t of Object.values(out)) t.orders = t.orders.size;
  return out;
}

/*
 * A CSV file that opens correctly in Korean Excel: UTF-8 with a byte-order mark, CRLF line ends, every text cell
 * quoted when needed. A text cell starting with = + - @ gets a leading apostrophe, so a customer's name can never
 * run as a formula. Numbers are written as numbers.
 *   columns: [{ key, label }]   rows: plain objects
 */
function csv(columns, rows) {
  const cell = (v) => {
    if (v == null) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(','));
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

// Amounts in a CSV: won as they are, dollars with their cents (219.90), so Excel adds them up correctly.
const major = (amount, currency) => (amount == null ? null : currency === 'USD' ? Math.round(amount) / 100 : amount);

module.exports = { period, periodsOf, channel, summary, byProduct, outstanding, csv, major, validDate, CHANNELS };
