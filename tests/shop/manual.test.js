const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../../api/_lib/shop/manual.js');

const nsmb = { id: 1, name: '내성만방', status: 'closed', price_krw: 2690000, price_usd: 229900, usd_vat: 'taxable', instalment_first: 930000, instalment_monthly: 930000, instalment_count: 2 };
const vip = { ...nsmb, price_options: [{ key: 'basic', label: '기본', price_krw: 2690000, price_usd: 229900 }, { key: 'vip', label: 'VIP', price_krw: 3500000, price_usd: 299900 }] };
const book = { id: 2, name: '워크북', status: 'closed', price_krw: 30000, price_usd: 2500, usd_vat: 'zero' };

test('an order made by hand: the product’s price, or a special price for the product only', () => {
  assert.equal(m.quoteManual(nsmb, { currency: 'KRW' }).total, 2690000);
  const q = m.quoteManual(nsmb, { currency: 'KRW', price: 2000000, addons: [book] });
  assert.equal(q.subtotal, 2720000);
  assert.equal(q.discount, 690000);
  assert.equal(q.total, 2030000);
  assert.deepEqual(q.items.map((i) => i.amount), [2000000, 30000]); // the add-on keeps its price
  assert.equal(m.quoteManual(nsmb, { currency: 'USD', price: 199900 }).total, 199900);
  assert.equal(m.quoteManual(nsmb, { currency: 'KRW', price: 0 }).total, 0); // free
  assert.equal(m.quoteManual(vip, { currency: 'KRW', option: 'vip', price: 3000000 }).discount, 500000);
  assert.equal(m.quoteManual(vip, { currency: 'KRW', option: 'vip' }).items[0].name, '내성만방 · VIP');
});

test('a special price is never above the price, never negative; the product must have the currency and option', () => {
  assert.throws(() => m.quoteManual(nsmb, { currency: 'KRW', price: 2690001 }), (e) => e instanceof m.ManualError && /above/.test(e.message));
  assert.throws(() => m.quoteManual(nsmb, { currency: 'KRW', price: -1 }), m.ManualError);
  assert.throws(() => m.quoteManual(nsmb, { currency: 'KRW', price: 10.5 }), m.ManualError);
  assert.throws(() => m.quoteManual({ ...nsmb, price_usd: null }, { currency: 'USD' }), m.ManualError);
  assert.throws(() => m.quoteManual(vip, { currency: 'KRW', option: 'gold' }), m.ManualError);
});

test('the day money was received: noon in Seoul, never in the future', () => {
  const now = new Date('2026-11-19T05:00:00Z'); // 14:00 in Seoul
  assert.equal(m.receivedAt('2026-11-18', now).toISOString(), '2026-11-18T03:00:00.000Z');
  assert.equal(m.receivedAt('2026-11-19', now).toISOString(), '2026-11-19T03:00:00.000Z');
  const morning = new Date('2026-11-18T23:30:00Z'); // 08:30 on the 19th in Seoul: noon hasn't come
  assert.equal(m.receivedAt('2026-11-19', morning).getTime(), morning.getTime());
  assert.throws(() => m.receivedAt('2026-11-20', now), /future/);
  assert.throws(() => m.receivedAt('19/11/2026', now), m.ManualError);
  assert.throws(() => m.receivedAt('2019-12-31', now), m.ManualError);
  assert.equal(m.receivedAt('', now), now);
});

test('a payment link works for LINK_DAYS days, only while the order is unpaid', () => {
  const created = '2026-11-19T01:00:00Z'; // 10:00 in Seoul
  const order = { origin: 'manual', provider: 'ciderpay', status: 'created', created_at: created, paid_at: null };
  assert.equal(m.LINK_DAYS, 14);
  assert.equal(m.linkLastDay(order), '2026-12-03');
  assert.equal(m.linkState(order, new Date('2026-12-03T00:59:00Z')), null);
  assert.equal(m.linkState(order, new Date('2026-12-03T01:00:00Z')), 'ended');
  assert.equal(m.linkState({ ...order, status: 'awaiting_payment' }, new Date(created)), null);
  assert.equal(m.linkState({ ...order, status: 'cancelled' }, new Date(created)), 'ended');
  assert.equal(m.linkState({ ...order, status: 'expired' }, new Date(created)), 'ended');
  assert.equal(m.linkState({ ...order, paid_at: created, status: 'paid' }, new Date(created)), 'paid');
  assert.equal(m.linkState({ ...order, origin: 'site' }, new Date(created)), 'ended');
  assert.equal(m.linkState({ ...order, provider: null }, new Date(created)), 'ended');
});
