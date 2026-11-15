const test = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../../api/_lib/shop/ledger.js');

const at = '2026-11-10T05:00:00Z';
const krwOrder = { id: 7, currency: 'KRW', plan: 'full' };
const product = { usd_vat: 'taxable' };

test('Seoul dates decide the tax period', () => {
  assert.deepEqual(ledger.seoul('2026-12-31T15:00:00Z'), { date: '2027-01-01', year: 2027, month: 1, quarter: 1, half: 1 }); // already next year in Seoul
  assert.deepEqual(ledger.seoul('2026-06-30T14:59:59Z'), { date: '2026-06-30', year: 2026, month: 6, quarter: 2, half: 1 });
  assert.equal(ledger.seoul('2026-06-30T15:00:00Z').half, 2);
  assert.equal(ledger.seoul('2026-09-30T15:00:00Z').quarter, 4);
});

test('a sale and its refund cancel out to the won', () => {
  const sale = ledger.line({ payment: { id: 1, kind: 'payment', amount: 220000, provider: 'ciderpay', method: '신한카드', at }, order: krwOrder, product });
  assert.equal(sale.kind, 'sale');
  assert.deepEqual([sale.amount, sale.supply, sale.vat], [220000, 200000, 20000]);
  assert.equal(sale.vat_rule, 'taxable');
  assert.equal(sale.amount_krw, null);

  const refund = ledger.line({ payment: { id: 2, kind: 'refund', amount: 220000, provider: 'ciderpay', at }, order: krwOrder, product });
  assert.equal(refund.kind, 'refund');
  assert.deepEqual([refund.amount, refund.supply, refund.vat], [-220000, -200000, -20000]);

  const t = ledger.totals([sale, refund]).KRW;
  assert.deepEqual(t.approved, { count: 1, amount: 220000, supply: 200000, vat: 20000 });
  assert.deepEqual(t.cancelled, { count: 1, amount: -220000, supply: -200000, vat: -20000 });
  assert.deepEqual(t.net, { count: 2, amount: 0, supply: 0, vat: 0 });
});

test('each instalment is its own line; a partial refund is split like a sale', () => {
  const order = { id: 8, currency: 'KRW', plan: 'instalment' };
  const lines = [1, 2, 3].map((n) => ledger.line({ payment: { id: n, kind: 'payment', amount: 930000, instalment_no: n, provider: 'ciderpay', at }, order, product }));
  assert.ok(lines.every((l) => l.kind === 'instalment' && l.supply + l.vat === l.amount));
  assert.equal(ledger.totals(lines).KRW.net.amount, 2790000);
  const part = ledger.line({ payment: { id: 9, kind: 'refund', amount: 100000, provider: 'ciderpay', at }, order, product });
  assert.deepEqual([part.amount, part.supply, part.vat], [-100000, -90909, -9091]);
});

test('USD lines: VAT rule from the product, won value when a rate is known, PayPal fee signed', () => {
  const order = { id: 9, currency: 'USD', plan: 'full' };
  const pay = { id: 3, kind: 'payment', amount: 229900, fee: 10146, provider: 'paypal', method: 'paypal', at };
  const taxable = ledger.line({ payment: pay, order, product, fx: { rate: 1380.5, source: 'manual' } });
  assert.deepEqual([taxable.amount, taxable.supply, taxable.vat, taxable.fee], [229900, 209000, 20900, 10146]);
  assert.equal(taxable.amount_krw, 3173770); // 2,299.00 × 1,380.5
  assert.equal(taxable.fx_source, 'manual');

  const zero = ledger.line({ payment: pay, order, product: { usd_vat: 'zero' } });
  assert.deepEqual([zero.supply, zero.vat, zero.vat_rule, zero.amount_krw, zero.fx_rate], [229900, 0, 'zero', null, null]);

  const refund = ledger.line({ payment: { ...pay, kind: 'refund' }, order, product, fx: { rate: 1380.5 } });
  assert.deepEqual([refund.amount, refund.fee, refund.amount_krw], [-229900, -10146, -3173770]);
  assert.throws(() => ledger.wonValue(100, 0), /exchange rate/);
});

test('amounts must be positive whole numbers; totals keep currencies apart', () => {
  assert.throws(() => ledger.line({ payment: { kind: 'payment', amount: 0, provider: 'manual', at }, order: krwOrder, product }), /positive whole number/);
  assert.throws(() => ledger.line({ payment: { kind: 'payment', amount: 10.5, provider: 'manual', at }, order: krwOrder, product }), /positive whole number/);
  const t = ledger.totals([
    ledger.line({ payment: { kind: 'payment', amount: 220000, provider: 'ciderpay', at }, order: krwOrder, product }),
    ledger.line({ payment: { kind: 'payment', amount: 229900, provider: 'paypal', at }, order: { id: 1, currency: 'USD', plan: 'full' }, product }),
  ]);
  assert.equal(t.KRW.net.amount, 220000);
  assert.equal(t.USD.net.amount, 229900);
  assert.deepEqual(ledger.totals([]), {});
});
