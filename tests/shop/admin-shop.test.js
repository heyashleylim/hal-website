const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const products = require('../../api/_lib/admin/shop-products.js');
const orders = require('../../api/_lib/admin/shop-orders.js');

const nsmb = {
  name: '내성만방 프로그램', slug: 'nsmb', status: 'open', price_krw: '2690000', price_usd: '2299',
  instalment_first: '930000', instalment_monthly: '930000', instalment_count: '2',
  purchase_tag: 'purchased_nsmb_03_202701', extra_tags: 'customer, nsmb', legacy_ids: '2882, 4536',
  content: { summary: '12주 라이브 프로그램', included: '라이브 그룹 코칭\n프라이빗 커뮤니티\n\n', image: '/assets/img/shop/nsmb.webp', thanks: '' },
};

test('product form → stored columns', () => {
  const p = products.productInput(nsmb);
  assert.equal(p.price_krw, 2690000);
  assert.equal(p.price_usd, 229900); // cents
  assert.deepEqual([p.instalment_first, p.instalment_monthly, p.instalment_count], [930000, 930000, 2]);
  assert.deepEqual(p.extra_tags, ['customer', 'nsmb']);
  assert.deepEqual(p.legacy_ids, [2882, 4536]);
  assert.deepEqual(p.content.included, ['라이브 그룹 코칭', '프라이빗 커뮤니티']);
  assert.equal(p.usd_vat, 'taxable');
  assert.equal(p.sale_starts_at, null);
});

test('dollars are read as typed', () => {
  assert.equal(products.cents('2299', 'USD price'), 229900);
  assert.equal(products.cents('2,299', 'USD price'), 229900);
  assert.equal(products.cents('19.5', 'USD price'), 1950);
  assert.equal(products.cents('19.05', 'USD price'), 1905);
  assert.equal(products.cents('', 'USD price'), null);
  assert.throws(() => products.cents('19.999', 'USD price'), /amount in dollars/);
  assert.throws(() => products.cents('$20', 'USD price'), /amount in dollars/);
  assert.throws(() => products.cents('0.50', 'USD price'), /between/);
});

test('sale dates are Seoul time', () => {
  assert.equal(products.seoulTime('2026-11-20T00:00', 'Sale end'), '2026-11-19T15:00:00.000Z');
  assert.equal(products.seoulTime('', 'Sale end'), null);
  assert.throws(() => products.seoulTime('2026-11-20', 'Sale end'), /date and time/);
  const p = products.productInput({ ...nsmb, sale_starts_at: '2026-11-01T09:00', sale_ends_at: '2026-11-20T23:59' });
  assert.ok(p.sale_starts_at < p.sale_ends_at);
  assert.throws(() => products.productInput({ ...nsmb, sale_starts_at: '2026-11-20T09:00', sale_ends_at: '2026-11-01T09:00' }), /after sale start/);
});

test('refuses incomplete or unsafe products', () => {
  const bad = (change, message) => assert.throws(() => products.productInput({ ...nsmb, ...change }), message);
  bad({ name: '' }, /Name is required/);
  bad({ slug: 'NSMB 2026' }, /lowercase letters/);
  bad({ slug: '내성만방' }, /lowercase letters/);
  bad({ status: 'live' }, /Status/);
  bad({ price_krw: '', price_usd: '' }, /KRW price, a USD price, or both/);
  bad({ price_krw: '500' }, /KRW price must be a whole number/); // under CiderPay's ₩1,000 minimum
  bad({ price_krw: '2690000.5' }, /whole number/);
  bad({ instalment_count: '' }, /all three/);
  bad({ price_krw: '' }, /add a KRW price/);
  bad({ purchase_tag: 'purchased eft' }, /one ActiveCampaign tag/);
  bad({ legacy_ids: 'abc' }, /WooCommerce id/);
  bad({ content: { image: 'https://example.com/x.png' } }, /site path/);
  bad({ usd_vat: 'exempt' }, /USD VAT/);
  bad({ slug: 'complete' }, /already uses/);        // /checkout/complete is the thank-you page
  bad({ slug: 'order-received' }, /already uses/);  // still a WooCommerce address
  bad({ content: { page: 'https://evil.example' } }, /page of this site/);
  bad({ content: { page: '//evil.example' } }, /page of this site/);
  assert.equal(products.productInput({ ...nsmb, content: { page: '/nsmb' } }).content.page, '/nsmb');
});

test('a USD-only product without a plan is fine', () => {
  const p = products.productInput({ name: 'X', slug: 'x', price_usd: '99', price_krw: '', instalment_first: '', instalment_monthly: '', instalment_count: '' });
  assert.equal(p.price_krw, null);
  assert.equal(p.status, 'draft');
  assert.deepEqual(p.content, { summary: '', included: [], image: '', thanks: '', page: '', guarantee: '', testimonials: [], addon_details: '', addon_note: '' });
});

test('guarantee and reviews are kept exactly as typed', () => {
  const c = products.productInput({ ...nsmb, content: {
    guarantee: ' 14일 전액 환불 보장 \n\n프로그램 시작 후 14일 이내에… ',
    testimonials: '인생의 마스터 키를 쥔 기분. 😭\n둘째 줄\n— 유00, 자영업\n\n\n이름 없는 후기\n\n- 한 줄만 있는 후기',
  } }).content;
  assert.equal(c.guarantee, '14일 전액 환불 보장\n프로그램 시작 후 14일 이내에…');
  assert.deepEqual(c.testimonials, [
    { text: '인생의 마스터 키를 쥔 기분. 😭\n둘째 줄', name: '유00, 자영업' },
    { text: '이름 없는 후기', name: '' },
    { text: '- 한 줄만 있는 후기', name: '' },   // a single line starting with a dash is the review itself
  ]);
  // saving what the form shows again changes nothing
  assert.deepEqual(products.testimonials(c.testimonials), c.testimonials);
  assert.throws(() => products.productInput({ ...nsmb, content: { testimonials: Array(7).fill('후기').join('\n\n') } }), /at most 6/);
  assert.throws(() => products.productInput({ ...nsmb, content: { guarantee: 'x'.repeat(801) } }), /Guarantee is too long/);
});

test('warnings point at likely mistakes without blocking', () => {
  const base = { status: 'open', purchase_tag: 'purchased_x', price_krw: 2690000, instalment_first: 930000, instalment_monthly: 930000, instalment_count: 2 };
  assert.deepEqual(products.warnings(base), []);
  assert.match(products.warnings({ ...base, instalment_monthly: 500000 })[0], /less than the pay-in-full price/);
  assert.match(products.warnings({ ...base, purchase_tag: '' })[0], /No purchase tag/);
  assert.deepEqual(products.warnings({ ...base, purchase_tag: '', status: 'draft' }), []);
});

test('settings keep only known keys', () => {
  const s = products.settingsInput({ checkout_texts: { consent: ' 동의합니다 ', hack: 'x' }, notifications: { paid: false, refund: 'false' }, other: 1 });
  assert.deepEqual(s.checkout_texts, { consent: '동의합니다', guarantee: '', secure_note: '', paypal_instalments: '' });
  assert.deepEqual(s.notifications, { paid: false, refund: false, instalment_failed: true });
  assert.deepEqual(Object.keys(s), ['checkout_texts', 'notifications']);
});

test('shop actions are prefixed, and every write is a known action', () => {
  for (const m of [products, orders]) {
    assert.equal(m.section, 'shop');
    for (const name of Object.keys(m.actions)) assert.match(name, /^shop-/);
    for (const w of m.writes) assert.ok(m.actions[w], w);
  }
});

test('order statuses in the admin match the database', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../db/migrations/005_shop.sql'), 'utf8');
  const inDb = /status\s+text NOT NULL DEFAULT 'created' CHECK \(status IN\s*\(([^)]+)\)/.exec(sql)[1].match(/'[a-z_]+'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(orders.STATUSES, inDb);
});
