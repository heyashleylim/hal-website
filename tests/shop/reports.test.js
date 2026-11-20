const test = require('node:test');
const assert = require('node:assert/strict');
const reports = require('../../api/_lib/shop/reports.js');
const ledger = require('../../api/_lib/shop/ledger.js');
const admin = require('../../api/_lib/admin/shop-reports.js');

test('periods are Seoul dates: month, quarter, half-year, year, dates', () => {
  const m = reports.period('2026-11');
  assert.deepEqual([m.kind, m.from, m.to, m.start, m.end], ['month', '2026-11-01', '2026-12-01', '2026-11-01T00:00:00+09:00', '2026-12-01T00:00:00+09:00']);
  assert.equal(reports.period('2026-12').to, '2027-01-01');
  assert.deepEqual([reports.period('2026-Q4').from, reports.period('2026-Q4').to], ['2026-10-01', '2027-01-01']);
  assert.deepEqual([reports.period('2026-q1').from, reports.period('2026-q1').to, reports.period('2026-q1').key], ['2026-01-01', '2026-04-01', '2026-Q1']);
  assert.deepEqual([reports.period('2026-H1').from, reports.period('2026-H1').to], ['2026-01-01', '2026-07-01']);
  assert.deepEqual([reports.period('2026-H2').from, reports.period('2026-H2').to], ['2026-07-01', '2027-01-01']);
  assert.match(reports.period('2026-H2').label, /2기/);
  assert.deepEqual([reports.period('2026').from, reports.period('2026').to], ['2026-01-01', '2027-01-01']);
  const d = reports.period('2026-02-27..2026-02-28');
  assert.deepEqual([d.kind, d.from, d.to], ['dates', '2026-02-27', '2026-03-01']);
  assert.equal(reports.period('2026-11-05..2026-11-05').label, '2026-11-05');
});

test('nonsense periods are refused', () => {
  for (const k of ['', '2026-13', '2026-00', '2026-Q5', '2026-H3', '26', '2026-02-30..2026-03-01', '2026-11-10..2026-11-01', '1999', "2026'; DROP"]) {
    assert.equal(reports.period(k), null, k);
  }
});

test('the current periods follow Seoul time', () => {
  assert.deepEqual(reports.periodsOf('2026-12-31T15:30:00Z'), { month: '2027-01', quarter: '2027-Q1', half: '2027-H1', year: '2027' });
  assert.deepEqual(reports.periodsOf('2026-06-30T14:00:00Z'), { month: '2026-06', quarter: '2026-Q2', half: '2026-H1', year: '2026' });
});

const order = (id, currency) => ({ id, currency, plan: 'full' });
function lineOf({ id, orderId, currency = 'KRW', amount, kind = 'payment', provider = 'ciderpay', fee = null, rule = null, rate = null, product = 'NSMB' }) {
  const l = ledger.line({ payment: { id, kind, amount, provider, fee, at: '2026-11-10T05:00:00Z' }, order: order(orderId, currency), product: { usd_vat: 'taxable' }, rule, fx: rate ? { rate, source: 'test' } : null });
  return { ...l, id, product_name: product };
}

test('the summary adds up like CiderPay’s VAT document, per channel and VAT rule', () => {
  const lines = [
    lineOf({ id: 1, orderId: 1, amount: 2690000 }),
    lineOf({ id: 2, orderId: 2, amount: 220000, product: 'EFT' }),
    lineOf({ id: 3, orderId: 2, amount: 220000, kind: 'refund', product: 'EFT' }),
    lineOf({ id: 4, orderId: 3, amount: 110000, provider: 'manual', rule: 'zero' }),
    lineOf({ id: 5, orderId: 4, currency: 'USD', amount: 229900, provider: 'paypal', fee: 9500, rate: 1386.5 }),
    lineOf({ id: 6, orderId: 5, currency: 'USD', amount: 1950, provider: 'paypal', fee: 120 }),
  ];
  const s = reports.summary(lines);
  assert.equal(s.count, 6);
  assert.deepEqual(s.totals.KRW.net, { count: 4, amount: 2800000, supply: 2555455, vat: 244545 });
  assert.deepEqual(s.totals.KRW.cancelled, { count: 1, amount: -220000, supply: -200000, vat: -20000 });
  const card = s.byChannel.find((g) => g.currency === 'KRW' && g.channel === 'Card (CiderPay)');
  assert.equal(card.net.amount, 2690000);
  assert.equal(card.approved.count, 2);
  assert.equal(s.byChannel.find((g) => g.channel === 'Recorded by hand').net.amount, 110000);
  const zero = s.byRule.find((g) => g.currency === 'KRW' && g.vat_rule === 'zero');
  assert.deepEqual([zero.net.amount, zero.net.supply, zero.net.vat], [110000, 110000, 0]);
  // Won: KRW as is, the USD line with a rate at its won value; the one without a rate is counted as missing.
  const usdWon = Math.round(229900 * 1386.5 / 100);
  assert.equal(s.won.amount, 2800000 + usdWon);
  assert.equal(s.won.supply + s.won.vat, s.won.amount);
  assert.equal(s.won.missing_rate, 1);
  assert.equal(s.won.complete, false);
  assert.deepEqual(s.fees.USD, { fee: 9620, known: 2, amount: 231850, net: 222230 });
});

test('per product: received, refunded, net, distinct orders', () => {
  const rows = reports.byProduct([
    lineOf({ id: 1, orderId: 1, amount: 2690000 }),
    lineOf({ id: 2, orderId: 1, amount: 100000, rule: 'zero' }),
    lineOf({ id: 3, orderId: 2, amount: 220000, product: 'EFT' }),
    lineOf({ id: 4, orderId: 2, amount: 220000, kind: 'refund', product: 'EFT' }),
  ]);
  assert.deepEqual(rows.map((r) => [r.product, r.orders, r.sales.amount, r.refunds.amount, r.net.amount]), [['NSMB', 1, 2790000, 0, 2790000], ['EFT', 1, 220000, -220000, 0]]);
});

test('instalments still due: per currency, late ones apart', () => {
  const t = reports.outstanding([
    { order_id: 1, currency: 'KRW', amount: 930000, status: 'due' },
    { order_id: 1, currency: 'KRW', amount: 930000, status: 'overdue' },
    { order_id: 2, currency: 'KRW', amount: 500000, status: 'failed' },
  ]);
  assert.deepEqual(t, { KRW: { orders: 2, instalments: 3, amount: 2360000, late: 1430000 } });
});

test('CSV opens in Korean Excel and never runs a formula', () => {
  const out = reports.csv([{ key: 'name', label: '이름' }, { key: 'n', label: 'Amount' }, { key: 'x', label: 'Twice', value: (r) => r.n * 2 }], [
    { name: '김지연', n: 2690000 },
    { name: '=HYPERLINK("http://x")', n: -5 },
    { name: 'a, "b"\nc', n: null },
  ]);
  assert.ok(out.startsWith('﻿이름,Amount,Twice\r\n'));
  const rows = out.slice(1).split('\r\n');
  assert.equal(rows[1], '김지연,2690000,5380000');
  assert.equal(rows[2], `"'=HYPERLINK(""http://x"")",-5,-10`);
  assert.equal(rows[3], '"a, ""b""\nc",,0');
  assert.equal(rows[4], '');
  assert.equal(reports.major(229950, 'USD'), 2299.5);
  assert.equal(reports.major(-220000, 'KRW'), -220000);
  assert.equal(reports.major(null, 'USD'), null);
});

test('the ledger CSV has the columns the accountant needs', () => {
  const labels = admin.CSV.lines.map((c) => c.label);
  for (const l of ['Date (Seoul)', 'Order', 'Supply (공급가액)', 'VAT (부가세)', 'VAT rule', 'KRW per USD', 'Won value', 'Approval no.', 'Receipt']) assert.ok(labels.includes(l), l);
  const sample = { at: '2026-11-30T15:10:00Z', amount: 229900, supply: 209000, vat: 20900, fee: 9500, currency: 'USD', provider: 'paypal', refund_of_at: null };
  const row = reports.csv(admin.CSV.lines, [sample]).split('\r\n')[1].split(',');
  assert.equal(row[0], '2026-12-01'); // Seoul date
  assert.equal(row[1], '00:10:00');
  assert.ok(row.includes('2299') && row.includes('2090') && row.includes('209') && row.includes('95'));
});

test('exchange rates are typed as won per dollar', () => {
  assert.equal(admin.rateOf('1386.5'), '1386.5');
  assert.equal(admin.rateOf(' 1,386.25 '), '1386.25');
  for (const bad of ['', 'abc', '-1300', '0', '99', '10001', '1386.12345', '1e3']) assert.throws(() => admin.rateOf(bad), /rate/, bad);
});

test('a SQL won value equals ledger.wonValue (same rounding, a refund like its sale)', () => {
  // The admin recomputes amount_krw in SQL: sign(amount) * round(abs(amount) * rate / 100). Same as wonValue.
  for (const [cents, rate] of [[229900, 1386.5], [1950, 1300.3], [-229900, 1386.5], [5, 1300]]) {
    const sql = Math.sign(cents) * Math.round(Math.abs(cents) * rate / 100);
    assert.equal(ledger.wonValue(cents, rate).amount_krw, sql);
  }
});
