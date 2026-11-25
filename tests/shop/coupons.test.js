const test = require('node:test');
const assert = require('node:assert/strict');
const coupons = require('../../api/_lib/shop/coupons.js');
const pricing = require('../../api/_lib/shop/pricing.js');
const sync = require('../../api/_lib/shop/sync.js');
const { campaignInput, codeState } = require('../../api/_lib/admin/shop-coupons.js');

const pct = (percent, extra = {}) => ({ id: 1, key: 'bf', kind: 'percent', percent, amount_krw: null, amount_usd: null, product_ids: [], per_person: 1, status: 'active', ...extra });
const amt = (krw, usd, extra = {}) => ({ id: 2, key: 'fixed', kind: 'amount', percent: null, amount_krw: krw, amount_usd: usd, product_ids: [], per_person: 1, status: 'active', ...extra });
const code = (extra = {}) => ({ id: 10, campaign_id: 1, code: 'SUMMER10', owner_email: null, max_uses: null, expires_at: null, disabled_at: null, ...extra });
const NOW = new Date('2026-11-19T03:00:00Z'); // 12:00 in Seoul

test('codes are normalised: spaces gone, upper case, full-width folded', () => {
  assert.equal(coupons.normalize(' summer 10 '), 'SUMMER10');
  assert.equal(coupons.normalize('ｓｕｍｍｅｒ１０'), 'SUMMER10');
  assert.equal(coupons.normalize(null), '');
  assert.ok(coupons.isCode('BF-K7MD-Q2XP'));
  assert.ok(!coupons.isCode('AB'));
  assert.ok(!coupons.isCode('쿠폰10'));
  assert.ok(!coupons.isCode('-START'));
});

test('new codes are readable and never use 0/O/1/I/L', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const c = coupons.newCode();
    assert.match(c, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    assert.ok(coupons.isCode(c));
    seen.add(c);
  }
  assert.equal(seen.size, 500);
  assert.match(coupons.newCode('bf 26!'), /^BF26-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
});

test('a percentage is rounded down to the won and the cent', () => {
  assert.equal(coupons.discountFor(pct(10), 2690000, 'KRW'), 269000);
  assert.equal(coupons.discountFor(pct(15), 99999, 'KRW'), 14999); // 14999.85 → 14999
  assert.equal(coupons.discountFor(pct(15), 229900, 'USD'), 34485);
  assert.equal(coupons.discountFor(pct(33), 1001, 'USD'), 330); // 330.33 cents → 330
});

test('a fixed amount needs that currency and must leave something to pay', () => {
  assert.equal(coupons.discountFor(amt(50000, null), 290000, 'KRW'), 50000);
  assert.equal(coupons.discountFor(amt(50000, null), 29900, 'USD'), null);
  assert.equal(coupons.discountFor(amt(null, 4000), 29900, 'USD'), 4000);
  assert.equal(coupons.discountFor(amt(290000, null), 290000, 'KRW'), null); // free: refused
  assert.equal(coupons.discountFor(amt(300000, null), 290000, 'KRW'), null);
  assert.equal(coupons.discountFor(pct(99), 1, 'KRW'), null); // rounds to 0 off: not a discount
  assert.equal(coupons.discountFor(pct(10), 0, 'KRW'), null);
});

test('problem(): every reason a code can be refused', () => {
  const ctx = { productId: 5, currency: 'KRW', now: NOW };
  assert.equal(coupons.problem(code(), pct(10), ctx), null);
  assert.equal(coupons.problem(null, pct(10), ctx), 'coupon_unknown');
  assert.equal(coupons.problem(code({ disabled_at: NOW }), pct(10), ctx), 'coupon_unknown');
  assert.equal(coupons.problem(code(), pct(10, { status: 'disabled' }), ctx), 'coupon_unknown');
  assert.equal(coupons.problem(code(), pct(10, { starts_at: '2026-11-20T00:00:00+09:00' }), ctx), 'coupon_not_started');
  assert.equal(coupons.problem(code(), pct(10, { ends_at: '2026-11-19T12:00:00+09:00' }), ctx), 'coupon_expired'); // ends exactly now
  assert.equal(coupons.problem(code({ expires_at: '2026-11-19T00:00:00+09:00' }), pct(10), ctx), 'coupon_expired');
  assert.equal(coupons.problem(code(), pct(10, { product_ids: [6, 7] }), ctx), 'coupon_product');
  assert.equal(coupons.problem(code(), pct(10, { product_ids: [5] }), ctx), null);
  assert.equal(coupons.problem(code(), amt(null, 4000), ctx), 'coupon_currency');
  assert.equal(coupons.problem(code(), amt(null, 4000), { ...ctx, currency: undefined }), null); // page: no currency picked yet
  assert.equal(coupons.problem(code({ max_uses: 3 }), pct(10), { ...ctx, used: 3 }), 'coupon_used_up');
  assert.equal(coupons.problem(code({ max_uses: 3 }), pct(10), { ...ctx, used: 2 }), null);
});

test('a personal code only works for its owner, and once per person', () => {
  const mine = code({ code: 'K7MD-Q2XP', owner_email: 'ji@example.com', max_uses: 1 });
  const ctx = { productId: 5, currency: 'KRW', now: NOW };
  assert.equal(coupons.problem(mine, pct(10), { ...ctx, email: 'Ji@Example.com ' }), null);
  assert.equal(coupons.problem(mine, pct(10), { ...ctx, email: 'other@example.com' }), 'coupon_not_yours');
  assert.equal(coupons.problem(mine, pct(10), ctx), null); // before the email is known (applying on the page)
  assert.equal(coupons.problem(mine, pct(10), { ...ctx, email: 'ji@example.com', used: 1 }), 'coupon_used_up');
  // A shared code: the campaign's per-person limit counts this email's paid orders.
  assert.equal(coupons.problem(code(), pct(10), { ...ctx, email: 'a@b.co', usedByEmail: 1 }), 'coupon_already_used');
  assert.equal(coupons.problem(code(), pct(10, { per_person: 2 }), { ...ctx, email: 'a@b.co', usedByEmail: 1 }), null);
});

test('offTable(): the discount on every option and currency the page shows', () => {
  const plain = { id: 5, price_krw: 290000, price_usd: 22900 };
  assert.deepEqual(coupons.offTable(pct(10), plain), { '': { KRW: 29000, USD: 2290 } });
  assert.deepEqual(coupons.offTable(amt(50000, null), plain, ['KRW']), { '': { KRW: 50000 } });
  const withOptions = { id: 6, price_options: [
    { key: 'basic', label: '기본', price_krw: 100000, price_usd: 8000 },
    { key: 'vip', label: 'VIP', price_krw: 300000, price_usd: 24000 },
  ] };
  assert.deepEqual(coupons.offTable(amt(150000, 10000), withOptions), { basic: { KRW: null, USD: null }, vip: { KRW: 150000, USD: 10000 } });
});

test('the order with a coupon: only the product is discounted, items add up, VAT on what is paid', () => {
  const product = { id: 5, name: '내성만방', price_krw: 290000, usd_vat: 'zero' };
  const addon = { id: 9, name: '워크북', price_krw: 50000 };
  const off = coupons.discountFor(pct(10), 290000, 'KRW');
  const q = pricing.quote(product, { currency: 'KRW', addons: [addon], discount: off });
  assert.equal(q.subtotal, 340000);
  assert.equal(q.discount, 29000);
  assert.equal(q.total, 311000);
  assert.deepEqual(q.items.map((i) => i.amount), [261000, 50000]);
  assert.equal(q.items.reduce((s, i) => s + i.amount, 0), q.total);
  assert.equal(q.supply + q.vat, q.total);
  assert.equal(q.vat, 311000 - Math.round(311000 * 100 / 110));
});

test('describe(): what the admin shows', () => {
  assert.equal(coupons.describe(pct(15)), '15%');
  assert.equal(coupons.describe(amt(50000, 4000)), '₩50,000 / $40');
  assert.equal(coupons.describe(amt(null, 1950)), '$19.50');
});

test('a personal code works through the Seoul day N−1 after it is given, never past the campaign', () => {
  const k = pct(10, { valid_days: 7 });
  const e = coupons.expiryOf(k, NOW); // given 2026-11-19 (Seoul)
  assert.equal(e.lastDay, '2026-11-25');
  assert.equal(e.expiresAt.toISOString(), '2026-11-25T15:00:00.000Z'); // 00:00 KST on the 26th
  // Given at 23:30 in Seoul (still the 19th there, already the 19th in UTC too)
  assert.equal(coupons.expiryOf(k, new Date('2026-11-19T14:30:00Z')).lastDay, '2026-11-25');
  // Given at 00:30 on the 20th in Seoul (still the 19th in UTC)
  assert.equal(coupons.expiryOf(k, new Date('2026-11-19T15:30:00Z')).lastDay, '2026-11-26');
  const capped = coupons.expiryOf(pct(10, { valid_days: 30, ends_at: '2026-11-30T00:00:00+09:00' }), NOW);
  assert.equal(capped.lastDay, '2026-11-29');
  assert.deepEqual(coupons.expiryOf(pct(10), NOW), { lastDay: '', expiresAt: null });
});

test('a code given to someone: AC fields first, then the tag; a repeat on another day sends again', () => {
  const c = { id: 42, code: 'K7MD-Q2XP', expires_at: '2026-11-25T15:00:00.000Z' };
  const ops = coupons.issuedOps({ coupon: c, campaign: { key: 'bf_2026' }, link: 'https://www.ashleylim.com/checkout/nsmb?coupon=K7MD-Q2XP' });
  assert.deepEqual(ops.map((o) => o.op), ['fields', 'tag_add']);
  assert.deepEqual(ops[0].payload.fields, { COUPON_CODE: 'K7MD-Q2XP', COUPON_EXPIRES: '2026-11-25', COUPON_LINK: 'https://www.ashleylim.com/checkout/nsmb?coupon=K7MD-Q2XP' });
  assert.equal(ops[1].payload.tag, 'coupon_issued_bf_2026');
  assert.deepEqual(ops.map((o) => o.dedupe), ['coupon42:fields', 'coupon42:tag']);
  const again = coupons.issuedOps({ coupon: c, campaign: { key: 'bf_2026' }, link: '', stamp: '2026-11-20' });
  assert.deepEqual(again.map((o) => o.dedupe), ['coupon42:2026-11-20:fields', 'coupon42:2026-11-20:tag']);
  assert.equal(coupons.linkOf('K7MD-Q2XP', 'nsmb', { SHOP_PUBLIC_URL: 'https://www.ashleylim.com' }), 'https://www.ashleylim.com/checkout/nsmb?coupon=K7MD-Q2XP');
  assert.equal(coupons.linkOf('K7MD-Q2XP', ''), '');
});

test('a paid order with a coupon adds coupon_used_<key>', () => {
  const order = { id: 7, number: 1007, billing: { name: '김지연' }, product_name: '내성만방', total: 261000, currency: 'KRW', plan: 'full', paid_at: NOW };
  const tags = (key) => sync.purchaseOps(order, { purchase_tag: 'purchased_nsmb' }, {}, [], key).filter((o) => o.op === 'tag_add').map((o) => o.payload.tag);
  assert.deepEqual(tags('bf_2026'), ['purchased_nsmb', 'coupon_used_bf_2026']);
  assert.deepEqual(tags(''), ['purchased_nsmb']);
});

test('admin: campaign input is checked', () => {
  const ok = campaignInput({ name: 'Black Friday', key: 'Black_Friday_2026', kind: 'percent', percent: '20', per_person: '1', product_ids: [3, '3', 4] });
  assert.equal(ok.key, 'black_friday_2026');
  assert.deepEqual(ok.product_ids, [3, 4]);
  assert.equal(ok.percent, 20);
  const fixed = campaignInput({ name: 'x', key: 'x', kind: 'amount', amount_krw: '50,000', amount_usd: '19.50' });
  assert.equal(fixed.amount_krw, 50000);
  assert.equal(fixed.amount_usd, 1950);
  assert.equal(fixed.percent, null);
  assert.throws(() => campaignInput({ name: 'x', key: 'bad key', kind: 'percent', percent: 10 }), /Tag key/);
  assert.throws(() => campaignInput({ name: 'x', key: 'x', kind: 'percent', percent: 100 }), /Percentage/);
  assert.throws(() => campaignInput({ name: 'x', key: 'x', kind: 'amount' }), /amount off/);
  assert.throws(() => campaignInput({ name: 'x', key: 'x', kind: 'percent', percent: 10, starts_at: '2026-12-01T00:00', ends_at: '2026-11-01T00:00' }), /end must be after/);
  // The key never changes once the campaign exists (its AC tags would change under Ashley's automations).
  assert.equal(campaignInput({ name: 'x', key: 'other', kind: 'percent', percent: 10 }, { key: 'kept' }).key, 'kept');
});

test('admin: code states', () => {
  const k = pct(10, { ends_at: '2026-12-01T00:00:00+09:00' });
  assert.equal(codeState({ ...code(), uses: 0 }, k, NOW), 'unused');
  assert.equal(codeState({ ...code(), uses: 4 }, k, NOW), 'active');
  assert.equal(codeState({ ...code({ max_uses: 4 }), uses: 4 }, k, NOW), 'used up');
  assert.equal(codeState({ ...code({ owner_email: 'a@b.co', max_uses: 1 }), uses: 1 }, k, NOW), 'used');
  assert.equal(codeState({ ...code({ disabled_at: NOW }), uses: 0 }, k, NOW), 'disabled');
  assert.equal(codeState({ ...code(), uses: 0 }, k, new Date('2026-12-02T00:00:00Z')), 'expired');
});
