const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../../api/_lib/shop/pricing.js');

// NSMB as sold on WooCommerce on 2026-11-10: ₩2,690,000 in full, or ₩930,000 now + 2 × ₩930,000; $2,299.
const nsmb = { status: 'open', price_krw: 2690000, price_usd: 229900, instalment_first: 930000, instalment_monthly: 930000, instalment_count: 2, usd_vat: 'taxable' };
const eft = { status: 'open', price_krw: 220000, price_usd: null, instalment_first: null, instalment_monthly: null, instalment_count: null, usd_vat: 'taxable' };

test('VAT split: supply + VAT always equals the amount', () => {
  assert.deepEqual(p.vatSplit(220000), { supply: 200000, vat: 20000 }); // the EFT checkout shows "₩20,000 Tax 포함"
  assert.deepEqual(p.vatSplit(2690000), { supply: 2445455, vat: 244545 });
  assert.deepEqual(p.vatSplit(930000), { supply: 845455, vat: 84545 });
  assert.deepEqual(p.vatSplit(1000), { supply: 909, vat: 91 });
  assert.deepEqual(p.vatSplit(0), { supply: 0, vat: 0 });
  for (let amount = 1000; amount < 1200; amount++) {
    const { supply, vat } = p.vatSplit(amount);
    assert.equal(supply + vat, amount);
    assert.equal(vat, Math.round(amount / 11));
  }
});

test('VAT split of a refund mirrors the sale; zero-rated has no VAT', () => {
  const sale = p.vatSplit(930000), refund = p.vatSplit(-930000);
  assert.deepEqual(refund, { supply: -sale.supply, vat: -sale.vat });
  assert.deepEqual(p.vatSplit(229900, 'zero'), { supply: 229900, vat: 0 });
  assert.throws(() => p.vatSplit(10.5), /whole number/);
});

test('pay in full, KRW and USD', () => {
  const krw = p.quote(nsmb, { currency: 'KRW', plan: 'full' });
  assert.equal(krw.total, 2690000);
  assert.equal(krw.dueToday, 2690000);
  assert.deepEqual(krw.payments, [{ number: 1, amount: 2690000 }]);
  assert.equal(krw.supply + krw.vat, krw.total);

  const usd = p.quote(nsmb, { currency: 'USD' });
  assert.equal(usd.total, 229900);
  assert.equal(usd.vatRule, 'taxable');
  assert.equal(p.quote({ ...nsmb, usd_vat: 'zero' }, { currency: 'USD' }).vat, 0);
  // usd_vat never changes KRW sales
  assert.equal(p.quote({ ...nsmb, usd_vat: 'zero' }, { currency: 'KRW' }).vatRule, 'taxable');
});

test('instalment plan: first payment today, then the monthly payments', () => {
  const q = p.quote(nsmb, { currency: 'KRW', plan: 'instalment' });
  assert.equal(q.dueToday, 930000);
  assert.equal(q.total, 2790000);
  assert.equal(q.subtotal, 2790000);
  assert.deepEqual(q.payments, [{ number: 1, amount: 930000 }, { number: 2, amount: 930000 }, { number: 3, amount: 930000 }]);
  assert.equal(q.payments.reduce((sum, x) => sum + x.amount, 0), q.total);

  const uneven = p.quote({ ...nsmb, instalment_first: 1000000, instalment_monthly: 600000, instalment_count: 3 }, { plan: 'instalment' });
  assert.equal(uneven.dueToday, 1000000);
  assert.equal(uneven.total, 2800000);
  assert.equal(uneven.payments.length, 4);
});

test('refuses what the product does not offer', () => {
  assert.throws(() => p.quote(eft, { currency: 'USD' }), (e) => e.code === 'no_price');
  assert.throws(() => p.quote(eft, { plan: 'instalment' }), (e) => e.code === 'no_plan');
  assert.throws(() => p.quote(nsmb, { currency: 'USD', plan: 'instalment' }), (e) => e.code === 'no_plan');
  assert.throws(() => p.quote(nsmb, { currency: 'EUR' }), (e) => e.code === 'bad_currency');
  assert.throws(() => p.quote(nsmb, { plan: 'weekly' }), (e) => e.code === 'bad_plan');
});

test('discounts (pay in full only for now)', () => {
  const q = p.quote(eft, { discount: 20000 });
  assert.equal(q.subtotal, 220000);
  assert.equal(q.total, 200000);
  assert.equal(q.dueToday, 200000);
  assert.throws(() => p.quote(eft, { discount: 220001 }), (e) => e.code === 'discount_too_big');
  assert.throws(() => p.quote(eft, { discount: -1 }), (e) => e.code === 'bad_discount');
  assert.throws(() => p.quote(nsmb, { plan: 'instalment', discount: 1000 }), (e) => e.code === 'discount_plan');
  assert.equal(p.quote(eft, { discount: 220000 }).total, 0);
});

test('options list every way to buy', () => {
  assert.deepEqual(p.options(nsmb), [{ currency: 'KRW', plan: 'full' }, { currency: 'KRW', plan: 'instalment' }, { currency: 'USD', plan: 'full' }]);
  assert.deepEqual(p.options(eft), [{ currency: 'KRW', plan: 'full' }]);
  assert.deepEqual(p.options({ ...eft, price_krw: null, price_usd: 19900 }), [{ currency: 'USD', plan: 'full' }]);
});

test('sale state follows status and the sale window', () => {
  const now = new Date('2026-11-10T03:00:00Z');
  assert.deepEqual(p.saleState(eft, now), { open: true, reason: null });
  assert.equal(p.saleState({ ...eft, status: 'draft' }, now).reason, 'draft');
  assert.equal(p.saleState({ ...eft, status: 'closed' }, now).reason, 'closed');
  assert.equal(p.saleState({ ...eft, sale_starts_at: '2026-11-11T00:00:00+09:00' }, now).reason, 'not_started');
  assert.equal(p.saleState({ ...eft, sale_ends_at: '2026-11-10T12:00:00+09:00' }, now).reason, 'ended'); // ends at the instant itself
  assert.equal(p.saleState({ ...eft, sale_starts_at: '2026-11-01T00:00:00+09:00', sale_ends_at: '2026-11-20T00:00:00+09:00' }, now).open, true);
});

test('instalment dates: same day each month, capped at the 30th and at short months', () => {
  assert.deepEqual(p.schedule('2026-11-10', 3), ['2026-11-10', '2026-12-10', '2027-01-10']);
  assert.deepEqual(p.schedule('2026-12-31', 4), ['2026-12-31', '2027-01-30', '2027-02-28', '2027-03-30']);
  assert.deepEqual(p.schedule('2028-01-30', 3), ['2028-01-30', '2028-02-29', '2028-03-30']); // leap year
  assert.deepEqual(p.schedule('2028-02-29', 3), ['2028-02-29', '2028-03-29', '2028-04-29']);
  assert.deepEqual(p.schedule('2026-11-10', 1), ['2026-11-10']);
  assert.equal(p.schedule('2026-01-15', 25).at(-1), '2028-01-15');
  assert.throws(() => p.schedule('2026-02-30', 3), /not a real date/);
  assert.throws(() => p.schedule('10/11/2026', 3), /start date/);
  assert.throws(() => p.schedule('2026-11-10', 0), /number of payments/);
});

test('money formatting', () => {
  assert.equal(p.formatMoney(2690000, 'KRW'), '₩2,690,000');
  assert.equal(p.formatMoney(229900, 'USD'), '$2,299');
  assert.equal(p.formatMoney(1950, 'USD'), '$19.50');
  assert.equal(p.formatMoney(105, 'USD'), '$1.05');
  assert.equal(p.formatMoney(-930000, 'KRW'), '-₩930,000');
  assert.equal(p.formatMoney(0, 'KRW'), '₩0');
});
