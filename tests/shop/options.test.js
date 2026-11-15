// Pricing options (기본 / VIP…; Alex, 2026-11-14): priced on the server, stored on the order, tagged in ActiveCampaign.
const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../../api/_lib/shop/pricing.js');
const orders = require('../../api/_lib/shop/orders.js');
const sync = require('../../api/_lib/shop/sync.js');
const notify = require('../../api/_lib/shop/notify.js');
const products = require('../../api/_lib/admin/shop-products.js');

const opts = [
  { key: 'basic', label: '기본', note: '', price_krw: 2690000, price_usd: 229900, compare_krw: null, compare_usd: null, tag: '' },
  { key: 'vip', label: 'VIP', note: '1:1 코칭 2회', price_krw: 3990000, price_usd: 329900, compare_krw: 4990000, compare_usd: null, tag: 'nsmb_vip' },
];
const nsmb = { id: 1, slug: 'nsmb', name: '내성만방', status: 'open', price_krw: 2690000, price_usd: 229900, usd_vat: 'zero', purchase_tag: 'purchased_nsmb', extra_tags: [], price_options: opts, content: {} };
const scripts = { id: 2, slug: 'scripts', name: '스크립트', status: 'open', price_krw: 47000, price_usd: 4700, usd_vat: 'taxable', purchase_tag: 'purchased_scripts', extra_tags: [] };

test('the option picked sets the price; the item is named "product · option"', () => {
  const q = pricing.quote(nsmb, { currency: 'KRW', option: 'vip' });
  assert.equal(q.total, 3990000);
  assert.deepEqual(q.option, { key: 'vip', label: 'VIP', tag: 'nsmb_vip' });
  assert.equal(q.items[0].name, '내성만방 · VIP');
  assert.equal(pricing.quote(nsmb, { currency: 'USD', option: 'vip' }).total, 329900);
  // With add-ons: the option's price plus each add-on, VAT split per rule (the product's dollars are zero-rated here).
  const withAddon = pricing.quote(nsmb, { currency: 'USD', option: 'vip', addons: [scripts] });
  assert.equal(withAddon.total, 329900 + 4700);
  assert.deepEqual(withAddon.groups.map((g) => [g.vatRule, g.amount]), [['taxable', 4700], ['zero', 329900]]);
});

test('no key: the first option (lists and price checks); a wrong key is refused', () => {
  assert.equal(pricing.quote(nsmb, { currency: 'KRW' }).total, 2690000);
  assert.equal(pricing.quote(nsmb, { currency: 'KRW' }).option.key, 'basic');
  assert.throws(() => pricing.quote(nsmb, { currency: 'KRW', option: 'gold' }), (e) => e.code === 'bad_option');
  // A product without options takes none.
  const plain = { ...nsmb, price_options: [] };
  assert.equal(pricing.quote(plain, { currency: 'KRW' }).option, null);
  assert.equal(pricing.quote(plain, { currency: 'KRW' }).items[0].name, '내성만방');
  assert.throws(() => pricing.quote(plain, { currency: 'KRW', option: 'vip' }), (e) => e.code === 'bad_option');
  // Not with the instalment plan (phase 3).
  assert.throws(() => pricing.quote({ ...nsmb, instalment_first: 1000000, instalment_monthly: 1000000, instalment_count: 2 }, { currency: 'KRW', plan: 'instalment', option: 'vip' }), (e) => e.code === 'option_plan');
});

test('the currencies offered come from the options', () => {
  assert.deepEqual(pricing.options(nsmb).map((o) => o.currency), ['KRW', 'USD']);
  const krwOnly = { ...nsmb, price_usd: null, price_options: opts.map((o) => ({ ...o, price_usd: null })) };
  assert.deepEqual(pricing.options(krwOnly).map((o) => o.currency), ['KRW']);
  // An instalment plan is not offered on a product with options.
  assert.deepEqual(pricing.options({ ...nsmb, instalment_first: 1000000, instalment_monthly: 1000000, instalment_count: 2 }).map((o) => o.plan), ['full', 'full']);
});

test('the order name, the option tag in ActiveCampaign and the Slack line', () => {
  const order = { id: 7, number: 100050, customer_id: 3, product_name: '내성만방', currency: 'KRW', plan: 'full', total: 3990000, due_today: 3990000, paid_at: '2026-11-14T01:00:00Z', billing: { name: '김지연' }, price_option: { key: 'vip', label: 'VIP', tag: 'nsmb_vip' } };
  assert.equal(orders.orderName(order), '내성만방 · VIP');
  assert.equal(orders.orderName({ ...order, price_option: null }), '내성만방');
  const ops = sync.purchaseOps(order, nsmb, {}, [scripts]);
  assert.deepEqual(ops.filter((o) => o.op === 'tag_add').map((o) => o.payload.tag), ['purchased_nsmb', 'purchased_scripts', 'nsmb_vip']);
  assert.equal(ops.find((o) => o.op === 'fields').payload.fields.ORDER_PRODUCT, '내성만방 · VIP');
  assert.ok(notify.paidText(order, '').includes('김지연 - 내성만방 · VIP [100050]'));
  // No option: no extra tag, the plain name.
  const plain = sync.purchaseOps({ ...order, price_option: null }, nsmb);
  assert.deepEqual(plain.filter((o) => o.op === 'tag_add').map((o) => o.payload.tag), ['purchased_nsmb']);
});

test('admin: pricing options are checked, keep their keys and set the product’s prices', () => {
  const base = { name: '내성만방', slug: 'nsmb', status: 'open', price_krw: '1000', content: {} };
  const typed = [
    { key: 'basic', label: ' 기본 ', price_krw: '2690000', price_usd: '2299', compare_krw: '', compare_usd: '', tag: '', note: '' },
    { key: '', label: 'VIP', price_krw: '3,990,000'.replace(/,/g, ''), price_usd: '3299.50', compare_krw: '4990000', compare_usd: '', tag: 'nsmb_vip', note: '1:1 코칭' },
  ];
  const p = products.productInput({ ...base, price_options: typed });
  assert.equal(p.price_options.length, 2);
  assert.equal(p.price_options[0].key, 'basic', 'a saved key is kept');
  assert.match(p.price_options[1].key, /^[a-z0-9]{1,20}$/, 'a new option gets a key');
  assert.notEqual(p.price_options[1].key, 'basic');
  assert.deepEqual([p.price_options[1].label, p.price_options[1].price_usd, p.price_options[1].compare_krw, p.price_options[1].tag], ['VIP', 329950, 4990000, 'nsmb_vip']);
  assert.deepEqual([p.price_krw, p.price_usd], [2690000, 229900], 'the product’s prices are the first option’s');
  assert.deepEqual(products.productInput(base).price_options, []);

  const bad = (rows, re, extra = {}) => assert.throws(() => products.productInput({ ...base, ...extra, price_options: rows }), re);
  bad([typed[0]], /at least two/);
  bad(Array.from({ length: 7 }, (_, i) => ({ ...typed[0], key: `k${i}`, label: `L${i}` })), /at most 6/);
  bad([typed[0], { ...typed[1], label: '' }], /Option 2: name/);
  bad([typed[0], { ...typed[1], price_krw: '', price_usd: '' }], /give it a KRW price/);
  bad([typed[0], { ...typed[1], price_usd: '' }], /every option a USD price, or none/);
  bad([typed[0], { ...typed[1], key: 'basic' }], /key is not valid/);
  bad([typed[0], { ...typed[1], key: 'Bad Key' }], /key is not valid/);
  bad([typed[0], { ...typed[1], label: '기본' }], /same name/);
  bad([typed[0], { ...typed[1], tag: 'two tags' }], /one ActiveCampaign tag/);
  bad([typed[0], { ...typed[1], compare_usd: '99', price_usd: '' }], /USD price/);
  bad(typed, /add-on can’t have pricing options/, { addon_only: true });
  bad(typed, /instalment plan can’t be combined/, { instalment_first: '930000', instalment_monthly: '930000', instalment_count: '2' });

  const w = products.warnings({ ...nsmb, price_options: [opts[0], { ...opts[1], compare_krw: 100 }] });
  assert.ok(w.some((x) => /Option “VIP”: the regular KRW price is not higher/.test(x)));
});

test('admin: what’s included is a title and a paragraph each', () => {
  const base = { name: 'X', slug: 'x', price_krw: '1000' };
  const p = products.productInput({ ...base, content: { included_title: ' 받으시는 것 ', included: [{ title: ' 8주 라이브 ', text: '매주 화요일\r\n\r\n\r\n녹화본' }, { title: '', text: '' }, '커뮤니티'] } });
  assert.equal(p.content.included_title, '받으시는 것');
  assert.deepEqual(p.content.included, [{ title: '8주 라이브', text: '매주 화요일\n\n녹화본' }, { title: '커뮤니티', text: '' }]);
  assert.deepEqual(products.productInput({ ...base, content: { included: '한 줄\n두 줄' } }).content.included, [{ title: '한 줄', text: '' }, { title: '두 줄', text: '' }]);
  assert.throws(() => products.productInput({ ...base, content: { included: [{ title: '', text: '제목 없는 문단' }] } }), /needs a title/);
  assert.throws(() => products.productInput({ ...base, content: { included: Array.from({ length: 13 }, (_, i) => `x${i}`) } }), /at most 12/);
  assert.throws(() => products.productInput({ ...base, content: { included: [{ title: 'x', text: 'y'.repeat(601) }] } }), /too long/);
});
