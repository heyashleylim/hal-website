// Add-ons (an order bump offered on a product's checkout): which are offered, how an order with add-ons is
// priced and taxed, what the buyer sees, what ActiveCampaign and Slack receive, and what the admin accepts.
const test = require('node:test');
const assert = require('node:assert/strict');
const pricing = require('../../api/_lib/shop/pricing.js');
const ledger = require('../../api/_lib/shop/ledger.js');
const orders = require('../../api/_lib/shop/orders.js');
const page = require('../../api/_lib/shop/page.js');
const sync = require('../../api/_lib/shop/sync.js');
const notify = require('../../api/_lib/shop/notify.js');
const flow = require('../../api/_lib/shop/flow.js');
const copy = require('../../api/_lib/shop/copy.ko.js');
const products = require('../../api/_lib/admin/shop-products.js');

const EVIL = '<script>alert(1)</script>"\'><img src=x onerror=alert(2)>';
const main = {
  id: 1, slug: 'eft', name: 'EFT 태핑 마스터클래스', status: 'open', price_krw: 220000, price_usd: 19900, usd_vat: 'taxable',
  purchase_tag: 'purchased_eft', extra_tags: ['customer'], addon_ids: [3, 2, 9, 4, 5, 6, 1], content: { summary: '100분 마스터클래스' },
};
const scripts = {
  id: 2, slug: 'eft-scripts', name: '태핑 스크립트 모음', status: 'open', addon_only: true, price_krw: 47000, price_usd: 4700, compare_krw: 99000, compare_usd: 4700,
  usd_vat: 'taxable', purchase_tag: 'purchased_eft_scripts', extra_tags: ['customer'],
  content: { summary: '상황별 스크립트 30개', addon_details: '첫 문단\n둘째 줄\n\n둘째 문단', addon_note: '디지털 상품은 환불되지 않아요.' },
};
const workshop = { id: 3, slug: 'workshop', name: '워크숍 다시보기', status: 'open', price_krw: 57000, price_usd: null, usd_vat: 'zero', purchase_tag: 'purchased_workshop', content: {} };
const closed = { id: 4, slug: 'closed', name: 'Closed', status: 'closed', price_krw: 10000, content: {} };
const draft = { id: 5, slug: 'draft', name: 'Draft', status: 'draft', price_krw: 10000, content: {} };
const ended = { id: 6, slug: 'ended', name: 'Ended', status: 'open', price_krw: 10000, sale_ends_at: '2020-01-01T00:00:00Z', content: {} };
const all = [main, scripts, workshop, closed, draft, ended];

test('add-ons offered: in the admin’s order, only on sale, priced in the currency, never the product itself', () => {
  const krw = pricing.addonChoices(main, all, 'KRW');
  assert.deepEqual(krw.map((c) => c.product.id), [3, 2]);   // 9 doesn't exist; 4 closed, 5 draft, 6 ended, 1 itself
  assert.deepEqual(krw.map((c) => c.amount), [57000, 47000]);
  assert.deepEqual(krw.map((c) => c.compare), [null, 99000]);
  assert.deepEqual(krw.map((c) => c.vatRule), ['taxable', 'taxable']);
  const usd = pricing.addonChoices(main, all, 'USD');
  assert.deepEqual(usd.map((c) => c.product.id), [2], 'the workshop has no USD price');
  assert.equal(usd[0].compare, null, 'a regular price that is not higher is not shown');
  assert.deepEqual(pricing.addonChoices({ ...main, addon_ids: [] }, all, 'KRW'), []);
  assert.deepEqual(pricing.addonChoices({ ...main, addon_ids: undefined }, all, 'KRW'), []);
  assert.deepEqual(pricing.addonChoices({ ...main, addon_ids: [2, 2] }, all, 'KRW').length, 1);
});

test('an order with add-ons: items, total and VAT', () => {
  const q = pricing.quote(main, { currency: 'KRW', addons: [scripts, workshop] });
  assert.equal(q.total, 220000 + 47000 + 57000);
  assert.equal(q.dueToday, q.total);
  assert.deepEqual(q.payments, [{ number: 1, amount: 324000 }]);
  assert.deepEqual(q.items.map((i) => [i.kind, i.product_id, i.amount, i.vatRule]), [['main', 1, 220000, 'taxable'], ['addon', 2, 47000, 'taxable'], ['addon', 3, 57000, 'taxable']]);
  assert.deepEqual({ supply: q.supply, vat: q.vat }, pricing.vatSplit(324000), 'one VAT rule: split once, on the whole order');
  assert.equal(q.supply + q.vat, q.total);
  // Without add-ons: exactly as before.
  const plain = pricing.quote(main, { currency: 'KRW' });
  assert.deepEqual([plain.total, plain.supply, plain.vat, plain.items.length, plain.groups.length], [220000, 200000, 20000, 1, 1]);
});

test('an add-on taxed differently: one VAT split per rule, adding up exactly', () => {
  const zeroMain = { ...main, usd_vat: 'zero' };
  const q = pricing.quote(zeroMain, { currency: 'USD', addons: [scripts] });
  assert.equal(q.total, 19900 + 4700);
  assert.deepEqual(q.groups, [{ vatRule: 'taxable', amount: 4700, ...pricing.vatSplit(4700) }, { vatRule: 'zero', amount: 19900, supply: 19900, vat: 0 }]);
  assert.equal(q.vat, pricing.vatSplit(4700).vat);
  assert.equal(q.supply + q.vat, q.total);
  // In KRW the zero rule never applies.
  assert.equal(pricing.quote({ ...workshop, id: 7, addon_ids: [] }, { currency: 'KRW', addons: [] }).vatRule, 'taxable');
});

test('add-ons that cannot be priced are refused', () => {
  const nsmb = { ...main, instalment_first: 100000, instalment_monthly: 100000, instalment_count: 2 };
  assert.throws(() => pricing.quote(nsmb, { plan: 'instalment', addons: [scripts] }), (e) => e.code === 'addon_plan');
  assert.throws(() => pricing.quote(main, { addons: [scripts, scripts] }), (e) => e.code === 'bad_addon');
  assert.throws(() => pricing.quote(main, { addons: [main] }), (e) => e.code === 'bad_addon');
  assert.throws(() => pricing.quote(main, { addons: [null] }), (e) => e.code === 'bad_addon');
  assert.throws(() => pricing.quote(main, { currency: 'USD', addons: [workshop] }), (e) => e.code === 'no_price');
  assert.throws(() => pricing.quote(main, { addons: 'all' }), (e) => e.code === 'bad_addon');
});

test('tax ledger: one line per VAT rule, adding up to the payment; fee on the first line only', () => {
  const at = '2026-11-13T03:00:00Z';
  const order = { id: 9, currency: 'USD', plan: 'full' };
  const items = [{ amount: 19900, vat_rule: 'zero' }, { amount: 4700, vat_rule: 'taxable' }];
  const ls = ledger.lines({ payment: { kind: 'payment', amount: 24600, fee: 120, provider: 'paypal', method: 'PayPal', at }, order, items });
  assert.deepEqual(ls.map((l) => [l.vat_rule, l.amount, l.supply, l.vat, l.fee, l.kind]), [
    ['taxable', 4700, pricing.vatSplit(4700).supply, pricing.vatSplit(4700).vat, 120, 'sale'],
    ['zero', 19900, 19900, 0, null, 'sale'],
  ]);
  for (const l of ls) assert.equal(l.supply + l.vat, l.amount);
  // One rule: the same single line as before add-ons.
  const one = ledger.lines({ payment: { kind: 'payment', amount: 267000, provider: 'ciderpay', at }, order: { id: 1, currency: 'KRW', plan: 'full' }, items: [{ amount: 220000, vat_rule: 'taxable' }, { amount: 47000, vat_rule: 'taxable' }] });
  assert.equal(one.length, 1);
  assert.deepEqual([one[0].amount, one[0].supply, one[0].vat], [267000, ...Object.values(pricing.vatSplit(267000))]);
  // A partial refund is split in proportion and still adds up exactly (negative).
  const part = ledger.lines({ payment: { kind: 'refund', amount: 10001, provider: 'paypal', at }, order, items });
  assert.equal(part.reduce((s, l) => s + l.amount, 0), -10001);
  for (const l of part) { assert.ok(l.amount < 0); assert.equal(l.supply + l.vat, l.amount); assert.equal(l.kind, 'refund'); }
  assert.throws(() => ledger.lines({ payment: { kind: 'payment', amount: 100, at }, order, items: [] }), /at least one item/);
  assert.throws(() => ledger.lines({ payment: { kind: 'payment', amount: 0, at }, order, items }), /positive/);
});

test('the add-ons a form asks for: ticked addon_<id> fields only', () => {
  assert.deepEqual(orders.requestedAddons({ addon_3: '1', addon_2: 'on', addon_4: '0', addon_5: '', addon_x: '1', addon: '1', name: 'x' }), [2, 3]);
  assert.deepEqual(orders.requestedAddons({ addon_3: 'true', addon_03: '1' }), [3]);
  assert.deepEqual(orders.requestedAddons({}), []);
  assert.deepEqual(orders.requestedAddons(null), []);
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`addon_${i + 1}`, '1']));
  assert.equal(orders.requestedAddons(many).length, 11, 'capped: more than offered is refused by the caller');
  assert.deepEqual(orders.requestedAddons({ addon_12345678901: '1' }), [], 'not an id');
});

test('payment page title, ActiveCampaign tags and Slack name the add-ons', () => {
  assert.equal(flow.orderTitle('EFT 태핑 마스터클래스', 0), 'EFT 태핑 마스터클래스');
  assert.equal(flow.orderTitle('EFT 태핑 마스터클래스', 2), 'EFT 태핑 마스터클래스 외 2건');
  const order = { id: 9, number: 100042, product_name: main.name, currency: 'KRW', plan: 'full', total: 267000, due_today: 267000, paid_at: '2026-11-13T03:00:00Z', billing: { name: '김지연' } };
  const ops = sync.purchaseOps(order, main, {}, [scripts, workshop]);
  assert.deepEqual(ops.filter((o) => o.op === 'tag_add').map((o) => o.payload.tag), ['purchased_eft', 'customer', 'purchased_eft_scripts', 'purchased_workshop']);
  assert.equal(new Set(ops.map((o) => o.dedupe)).size, ops.length, 'each fact queued once');
  assert.equal(ops.find((o) => o.op === 'fields').payload.fields.ORDER_PRODUCT, main.name);
  assert.equal(notify.paidText(order, '신한카드', [{ kind: 'main', name: main.name }, { kind: 'addon', name: scripts.name }]),
    "You've got MONEY!\nYAY!! Paid ₩267,000 🎉 (신한카드)\n김지연 - EFT 태핑 마스터클래스 + 태핑 스크립트 모음 [100042]");
  assert.equal(notify.paidText(order, ''), "You've got MONEY!\nYAY!! Paid ₩267,000 🎉\n김지연 - EFT 태핑 마스터클래스 [100042]");
});

const dataOf = (html) => JSON.parse(/<script type="application\/json" id="co-data">([\s\S]*?)<\/script>/.exec(html)[1]);
const offers = orders.offers(main);

test('checkout page: add-on cards, unticked, with a real checkbox each', () => {
  const addons = pricing.addonChoices(main, all, 'KRW');
  const html = page.checkoutPage({ product: main, offers, currency: 'KRW', addons });
  assert.ok(html.includes(`<h2 class="co-addons__title" id="co-addons-title">${copy.addons.title}</h2>`));
  assert.match(html, /<input class="co-addon__check" type="checkbox" id="co-addon-2" name="addon_2" value="1" data-addon="2">/);
  assert.match(html, /<label class="co-addon__toggle" for="co-addon-2"><span class="sr-only">태핑 스크립트 모음 주문에 추가<\/span>/);
  assert.ok(html.indexOf('co-addon-3') < html.indexOf('co-addon-2'), 'in the admin’s order');
  assert.ok(html.includes('<s><span class="sr-only">정가 </span>₩99,000</s>') && html.includes('₩47,000'));
  assert.ok(html.includes('<p class="co-addon__sum">상황별 스크립트 30개</p>'));
  assert.ok(html.includes('<summary>자세히 보기</summary>') && html.includes('<p>첫 문단<br>둘째 줄</p><p>둘째 문단</p>') && html.includes('<p class="co-addon__note">디지털 상품은 환불되지 않아요.</p>'));
  assert.ok(!/<details class="co-addon__more">[\s\S]*?워크숍/.test(html.split('co-addon-3')[1].split('co-addon-2')[0]), 'no details box without details');
  assert.ok(!/addon_\d+" value="1" data-addon="\d+" checked/.test(html), 'nothing ticked by default');
  // The order shows the product; add-on lines are there but hidden until ticked; the total is the product alone.
  assert.match(html, /<div class="co-order__row co-order__row--addon" data-line="2" hidden>/);
  assert.match(html, /<strong data-total>₩220,000<\/strong>/);
  assert.ok(html.includes('₩220,000 결제하기'));
  assert.ok(html.indexOf('co-addons') > html.indexOf('co-method') && html.indexOf('co-addons') < html.indexOf('co-order'), 'between the payment method and the order');
  const d = dataOf(html);
  assert.deepEqual(d.main, { amount: 220000, vatRule: 'taxable', item: { item_id: 'eft', item_name: main.name, price: 220000, quantity: 1 } });
  assert.deepEqual(d.addons.map((a) => [a.id, a.amount, a.vatRule, a.item.item_id]), [[3, 57000, 'taxable', 'workshop'], [2, 47000, 'taxable', 'eft-scripts']]);
  assert.equal(d.payTemplate, '{price} 결제하기 →');
});

test('checkout page after a failed submit: ticked add-ons stay ticked and are in the total', () => {
  const addons = pricing.addonChoices(main, all, 'KRW');
  const html = page.checkoutPage({ product: main, offers, currency: 'KRW', addons, values: { addon_2: '1', name: '김지연' }, problem: 'addon_unavailable' });
  assert.match(html, /name="addon_2" value="1" data-addon="2" checked>/);
  assert.match(html, /name="addon_3" value="1" data-addon="3">/);
  assert.match(html, /data-line="2">/);
  assert.match(html, /data-line="3" hidden>/);
  assert.match(html, /<strong data-total>₩267,000<\/strong>/);
  assert.ok(html.includes('₩267,000 결제하기') && html.includes(`<span class="co-method__price" data-due>₩267,000</span>`));
  assert.ok(html.includes(copy.summary.vat(pricing.formatMoney(pricing.vatSplit(267000).vat, 'KRW'))));
  assert.ok(html.includes(copy.problems.addon_unavailable));
  assert.equal(dataOf(html).value, 267000);
});

test('checkout page: no add-on section when none is offered; hostile add-on texts are escaped', () => {
  assert.ok(!page.checkoutPage({ product: main, offers, currency: 'KRW' }).includes('co-addons'));
  const evil = { ...scripts, name: EVIL, content: { summary: EVIL, addon_details: EVIL, addon_note: EVIL } };
  const html = page.checkoutPage({ product: main, offers, currency: 'KRW', addons: pricing.addonChoices({ ...main, addon_ids: [2] }, [evil], 'KRW'), values: { addon_2: '1' } });
  assert.ok(!html.includes('<script>alert') && !html.includes('<img src=x'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  // USD: dollars, and only the add-ons with a USD price.
  const usd = page.checkoutPage({ product: main, offers, currency: 'USD', addons: pricing.addonChoices(main, all, 'USD'), values: { addon_2: '1' } });
  assert.ok(usd.includes('$246 결제하기') && !usd.includes('co-addon-3'));
  assert.equal(dataOf(usd).value, 246);
});

test('thank-you page: the add-ons bought, and each item in the purchase event', () => {
  const order = { id: 9, number: 100042, token: 'abcdefghijklmnopqrstuv', product_id: 1, product_name: main.name, currency: 'KRW', plan: 'full', total: 267000, due_today: 267000, status: 'paid', paid_at: '2026-11-13T03:00:00Z', tracked_at: null, billing: { name: '김지연' } };
  const items = [
    { position: 0, kind: 'main', product_id: 1, slug: 'eft', name: main.name, amount: 220000, vat_rule: 'taxable' },
    { position: 1, kind: 'addon', product_id: 2, slug: 'eft-scripts', name: scripts.name, amount: 47000, vat_rule: 'taxable' },
  ];
  const html = page.completePage({ order, product: main, items });
  assert.ok(html.includes(`<div><dt>${copy.complete.addon}</dt><dd>태핑 스크립트 모음</dd></div>`));
  const p = dataOf(html).purchase;
  assert.equal(p.value, 267000);
  assert.equal(p.tax, pricing.vatSplit(267000).vat);
  assert.deepEqual(p.items.map((i) => [i.item_id, i.price]), [['eft', 220000], ['eft-scripts', 47000]]);
  // An order without items (none since migration 009) is its product.
  const plain = dataOf(page.completePage({ order: { ...order, total: 220000 }, product: main })).purchase;
  assert.deepEqual(plain.items.map((i) => [i.item_id, i.price]), [['eft', 220000]]);
});

test('admin: add-on settings of a product', () => {
  const base = { name: '태핑 스크립트 모음', slug: 'eft-scripts', status: 'open', price_krw: '47000', price_usd: '47', content: {} };
  const p = products.productInput({ ...base, addon_only: true, compare_krw: '99,000'.replace(/,/g, ''), compare_usd: '99', content: { addon_details: ' 첫 줄 \r\n\r\n\r\n\r\n둘째 ', addon_note: '환불 불가' } });
  assert.deepEqual([p.addon_only, p.compare_krw, p.compare_usd, p.addon_ids], [true, 99000, 9900, []]);
  assert.equal(p.content.addon_details, '첫 줄\n\n둘째');
  assert.equal(p.content.addon_note, '환불 불가');
  assert.deepEqual(products.productInput({ ...base, addon_ids: ['3', '2', '3'] }).addon_ids, [3, 2]);
  assert.deepEqual(products.productInput({ ...base, addon_ids: '3, 2' }).addon_ids, [3, 2]);
  assert.equal(products.productInput({ ...base, addon_only: 'false' }).addon_only, false);
  assert.throws(() => products.productInput({ ...base, addon_ids: ['1', '2', '3', '4', '5', '6', '7'] }), /at most 6/);
  assert.throws(() => products.productInput({ ...base, addon_ids: ['x'] }), /add-on/);
  assert.throws(() => products.productInput({ ...base, addon_only: true, addon_ids: ['3'] }), /can’t offer add-ons/);
  assert.throws(() => products.productInput({ ...base, price_usd: '', compare_usd: '99' }), /needs a USD price/);
  assert.throws(() => products.productInput({ ...base, compare_krw: '500' }), /Regular KRW price/);
  assert.throws(() => products.productInput({ ...base, content: { addon_details: 'x'.repeat(2001) } }), /too long/);
  const w = products.warnings({ ...main, compare_krw: 100, addon_ids: [3, 4] }, all);
  assert.ok(w.some((x) => /regular KRW price is not higher/.test(x)));
  assert.ok(w.some((x) => /“Closed” is not on sale/.test(x)));
  assert.ok(w.some((x) => /“워크숍 다시보기” has no USD price/.test(x)));
});
