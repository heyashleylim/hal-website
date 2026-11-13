// The checkout and thank-you pages (HTML), the ActiveCampaign updates of a purchase, and the Slack message.
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('../../api/_lib/shop/page.js');
const orders = require('../../api/_lib/shop/orders.js');
const sync = require('../../api/_lib/shop/sync.js');
const notify = require('../../api/_lib/shop/notify.js');
const copy = require('../../api/_lib/shop/copy.ko.js');

const EVIL = '<script>alert(1)</script>"\'><img src=x onerror=alert(2)>';
const product = {
  id: 1, slug: 'nsmb', name: '내성만방 프로그램', status: 'open', price_krw: 2690000, price_usd: 229900,
  instalment_first: 930000, instalment_monthly: 930000, instalment_count: 2, usd_vat: 'taxable',
  purchase_tag: 'purchased_nsmb_03_202701', extra_tags: ['customer'], content: { summary: '12주 라이브 프로그램', included: ['라이브 그룹 코칭', '프라이빗 커뮤니티'], image: '/assets/img/shop/nsmb.webp', thanks: '첫 줄\n둘째 줄', page: '/nsmb' },
};
const offers = orders.offers(product);
const order = {
  id: 9, number: 100042, token: 'abcdefghijklmnopqrstuv', product_id: 1, product_name: '내성만방 프로그램', currency: 'KRW', plan: 'full',
  total: 2690000, due_today: 2690000, status: 'paid', paid_at: '2026-11-11T03:00:00Z', tracked_at: null, customer_id: 4,
  billing: { name: '김지연', email: 'j@example.com', phone: '01012345678' },
};
const dataOf = (html) => JSON.parse(/<script type="application\/json" id="co-data">([\s\S]*?)<\/script>/.exec(html)[1]);

test('only the payment methods this deployment has keys for are offered', () => {
  assert.deepEqual(orders.offers(product, ['ciderpay']).map((o) => o.currency), ['KRW']);
  assert.deepEqual(orders.offers(product, ['paypal']).map((o) => o.currency), ['USD']);
  assert.deepEqual(orders.offers(product, []), []);
});

test('until instalments are built, the checkout only offers pay-in-full', () => {
  assert.equal(orders.INSTALMENTS_ENABLED, false);
  assert.deepEqual(offers.map((o) => `${o.currency} ${o.plan} ${o.provider} ${o.dueToday}`), ['KRW full ciderpay 2690000', 'USD full paypal 229900']);
});

test('checkout page: the product, the price and a form that works without JavaScript', () => {
  const html = page.checkoutPage({ product, offers, currency: 'KRW' });
  assert.match(html, /<form class="co-form" id="co-form" method="post" action="\/api\/shop\?action=order" novalidate>/);
  assert.match(html, /<input type="hidden" name="slug" value="nsmb">/);
  assert.match(html, /<input type="hidden" name="currency" value="KRW">/);
  assert.ok(html.includes('내성만방 프로그램'));
  assert.ok(html.includes('₩2,690,000 결제하기'));
  assert.ok(html.includes('부가세 ₩244,545 포함'));
  assert.ok(html.includes('라이브 그룹 코칭'));
  assert.ok(html.includes('href="/checkout/nsmb?currency=usd"'), 'link to the USD checkout');
  assert.ok(!html.includes('930,000'), 'the instalment plan is not offered yet');
  assert.equal((html.match(/<h1/g) || []).length, 1);
  for (const name of ['name', 'email', 'phone', 'postcode', 'address1', 'address2']) {
    assert.match(html, new RegExp(`<label for="co-${name}">`), name);
    assert.match(html, new RegExp(`<input id="co-${name}" name="${name}"`), name);
  }
  assert.ok(!html.includes('name="country"'), 'no country list for Korean buyers');
  assert.ok(html.includes(copy.consent), 'the published consent line is the default');
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive">/);
  assert.ok(html.includes('GTM-MK4FNWNV'));
  assert.ok(html.includes('사업자등록번호 : 708-81-01999'), 'legal business details from the site footer');
  assert.ok(html.includes('<header class="site-header">') && html.includes('<footer class="site-footer">'), 'the site’s own header and footer');
  assert.ok(html.includes('/assets/css/header.css') && html.includes('/assets/css/footer.css'));
  assert.match(html, /<h1 class="co-title">내성만방 프로그램<\/h1>/);
  assert.deepEqual([...html.matchAll(/<span class="co-step__n" aria-hidden="true">(\d)<\/span>([^<]+)/g)].map((m) => m[1] + m[2]), ['1내 정보', '2주소', '3결제 방법']);
  assert.ok(html.indexOf('co-order__title') < html.indexOf('id="co-pay"'), 'the order and its total sit right above the button');
  assert.ok(html.includes('₩2,690,000 결제하기 →'));
  const data = dataOf(html);
  assert.equal(data.slug, 'nsmb');
  assert.equal(data.value, 2690000);
  assert.equal(data.kakao, true);
});

test('beside the form: what you get, the guarantee and reviews, only when the product has them', () => {
  const rich = { ...product, content: { ...product.content, guarantee: '14일 전액 환불 보장\n조건이 있어요.', testimonials: [{ text: '인생의 마스터 키를 쥔 기분.\n정말로요', name: '유00' }, { text: '이름 없는 후기', name: '' }] } };
  let html = page.checkoutPage({ product: rich, offers, currency: 'KRW' });
  assert.ok(html.includes('<h2 class="co-box__title" id="co-g-title">14일 전액 환불 보장</h2>') && html.includes('<p>조건이 있어요.</p>'));
  assert.ok(html.includes('인생의 마스터 키를 쥔 기분.<br>정말로요') && html.includes('<figcaption class="t-card__by">유00</figcaption>'));
  assert.equal((html.match(/<figure class="t-card co-review">/g) || []).length, 2);
  assert.equal((html.match(/<figcaption/g) || []).length, 1, 'no empty name line');
  assert.ok(html.includes('src="/assets/img/shop/nsmb.webp"') && /<img class="co-box__img"[^>]*width="\d+" height="\d+" loading="lazy"/.test(html));
  // nothing set: no empty boxes
  html = page.checkoutPage({ product: { ...product, content: {} }, offers, currency: 'KRW' });
  assert.ok(!html.includes('co-box') && !html.includes('co-reviews') && !html.includes('co-sub'));
  // the shop-wide guarantee line (Settings) is used when the product has none
  html = page.checkoutPage({ product: { ...product, content: {} }, offers, currency: 'KRW', settings: { checkout_texts: { guarantee: '환불 보장' } } });
  assert.ok(html.includes('id="co-g-title">환불 보장</h2>'));
});

test('checkout page in USD: PayPal, a country list in Korean, dollars', () => {
  const html = page.checkoutPage({ product, offers, currency: 'USD', settings: { checkout_texts: { paypal_instalments: 'PayPal 화면에서 분할 결제를 선택할 수 있는 경우가 있어요.' } } });
  assert.ok(html.includes('$2,299 결제하기'));
  assert.ok(html.includes('<option value="US">미국</option>'));
  assert.ok(html.includes('PayPal 화면에서 분할 결제를 선택할 수 있는 경우가 있어요.'));
  assert.ok(html.includes('href="/checkout/nsmb"'), 'link back to the KRW checkout');
  assert.equal(dataOf(html).kakao, false);
  assert.equal(dataOf(html).value, 2299);
  assert.ok(!html.includes('id="co-kakao"'));
});

test('what the buyer typed comes back after an error, with the message next to the field', () => {
  const html = page.checkoutPage({ product, offers, currency: 'KRW', values: { name: '김지연', email: 'wrong', phone: '010' }, errors: { email: 'email_invalid', phone: 'phone_invalid' }, problem: 'invalid' });
  assert.ok(html.includes('value="김지연"'));
  assert.ok(html.includes(copy.errors.email_invalid));
  assert.ok(html.includes(copy.errors.phone_invalid));
  assert.ok(html.includes(copy.problems.invalid));
  assert.match(html, /<input id="co-email"[^>]*aria-invalid="true"/);
  assert.doesNotMatch(html, /<input id="co-name"[^>]*aria-invalid/);
});

test('nothing typed by a buyer or stored on a product can inject markup', () => {
  const evilProduct = { ...product, name: EVIL, content: { summary: EVIL, included: [EVIL], thanks: EVIL, image: 'javascript:alert(1)', page: 'javascript:alert(1)', guarantee: EVIL + '\n' + EVIL, testimonials: [{ text: EVIL, name: EVIL }] } };
  const pages = [
    page.checkoutPage({ product: evilProduct, offers: orders.offers(evilProduct), currency: 'KRW', values: { name: EVIL, email: EVIL, phone: EVIL, postcode: EVIL, address1: EVIL, address2: EVIL }, query: { utm_source: EVIL, utm_campaign: '"><script>x</script>' }, settings: { checkout_texts: { consent: EVIL, guarantee: EVIL, secure_note: EVIL } } }),
    page.checkoutPage({ product: evilProduct, offers: orders.offers(evilProduct), currency: 'USD', values: { country: EVIL }, settings: { checkout_texts: { paypal_instalments: EVIL } } }),
    page.closedPage({ product: evilProduct, reason: 'ended' }),
    page.completePage({ order: { ...order, product_name: EVIL, billing: { name: EVIL } }, product: evilProduct, receiptUrl: 'javascript:alert(1)' }),
    page.completePage({ order: { ...order, status: 'awaiting_payment', paid_at: null, product_name: EVIL }, product: evilProduct }),
  ];
  for (const html of pages) {
    // Our own scripts are the only <script> elements; the hostile text only ever appears escaped.
    const withoutOurs = html.replace(/<script type="application\/json" id="co-data">[\s\S]*?<\/script>/g, '').replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, '').replace(/<script>[\s\S]*?<\/script>/g, '');
    assert.ok(!/<script/i.test(withoutOurs), 'no injected script element');
    assert.ok(!/<img src=x/i.test(html), 'no injected element');
    assert.ok(!html.includes('href="javascript:'), 'no javascript: link');
    assert.ok(!html.includes('src="javascript:'), 'no javascript: image');
    const m = /<script type="application\/json" id="co-data">([\s\S]*?)<\/script>/.exec(html);
    if (m) { assert.ok(!m[1].includes('<'), 'JSON in the page never contains a raw <'); JSON.parse(m[1]); }
  }
});

test('the consent line keeps links to this site only', () => {
  assert.equal(page.consentHtml(''), page.consentHtml(copy.consent));
  assert.ok(page.consentHtml('').includes('<a href="/terms-and-conditions" target="_blank" rel="noopener">이용 약관</a>'));
  const out = page.consentHtml('동의 <a href="https://evil.example">x</a> <a href="/privacy-policy" onclick="x()">정책</a> <b>굵게</b>');
  assert.ok(out.includes('<a href="/privacy-policy" target="_blank" rel="noopener">정책</a>'));
  assert.ok(!out.includes('evil.example">'));
  assert.ok(!out.includes('onclick'));
  assert.ok(out.includes('&lt;b&gt;'));
});

test('a product that is not on sale gets a clear page, not a form', () => {
  for (const [reason, text] of [['not_started', copy.closed.notStarted], ['ended', copy.closed.ended], ['closed', copy.closed.closed]]) {
    const html = page.closedPage({ product, reason });
    assert.ok(html.includes(text));
    assert.ok(!html.includes('<form'));
    assert.ok(html.includes('href="/nsmb"'));
  }
});

test('thank-you page: paid', () => {
  const html = page.completePage({ order, product, receiptUrl: 'https://ciderpay.com/receipt/1' });
  assert.ok(html.includes(copy.complete.paidTitle));
  assert.ok(html.includes('김지연님, 감사합니다.'));
  assert.ok(html.includes('100042'));
  assert.ok(html.includes('₩2,690,000'));
  assert.ok(html.includes('2026년 11월 11일'));
  assert.ok(html.includes('href="https://ciderpay.com/receipt/1"'));
  assert.ok(html.includes('첫 줄<br>둘째 줄'));
  const data = dataOf(html);
  assert.deepEqual(data.purchase, { transaction_id: '100042', value: 2690000, tax: 244545, currency: 'KRW', items: [{ item_id: 'nsmb', item_name: '내성만방 프로그램', price: 2690000, quantity: 1 }] });
  // The purchase event carries no personal data.
  assert.ok(!JSON.stringify(data.purchase).includes('김지연') && !JSON.stringify(data.purchase).includes('example.com'));
  // The order token is taken out of the address before Google Tag Manager loads.
  assert.ok(html.indexOf("history.replaceState(null,'',u.pathname)") < html.indexOf('googletagmanager.com/gtm.js'));
  assert.ok(html.indexOf("history.replaceState") > 0);
});

test('thank-you page: the purchase event is only offered once', () => {
  assert.equal(dataOf(page.completePage({ order: { ...order, tracked_at: '2026-11-11T03:01:00Z' }, product })).purchase, null);
});

test('thank-you page: USD amounts in dollars for analytics', () => {
  const usd = { ...order, currency: 'USD', total: 229900, due_today: 229900 };
  const data = dataOf(page.completePage({ order: usd, product }));
  assert.equal(data.purchase.value, 2299);
  assert.equal(data.purchase.tax, 209);
  assert.equal(data.purchase.currency, 'USD');
  assert.equal(dataOf(page.completePage({ order: usd, product: { ...product, usd_vat: 'zero' } })).purchase.tax, 0);
});

test('thank-you page: waiting, slow, ended, refunded, unknown', () => {
  const waiting = { ...order, status: 'awaiting_payment', paid_at: null };
  let html = page.completePage({ order: waiting, product, tries: 2 });
  assert.ok(html.includes(copy.complete.pendingTitle));
  assert.match(html, /<noscript><meta http-equiv="refresh" content="4;url=\/checkout\/complete\?o=abcdefghijklmnopqrstuv&amp;n=3"><\/noscript>/);
  assert.equal(dataOf(html).complete, 'pending');
  assert.ok(!html.includes(copy.complete.paidTitle));

  html = page.completePage({ order: waiting, product, tries: 8, slow: true });
  assert.ok(html.includes(copy.complete.slowTitle));
  assert.ok(!html.includes('http-equiv="refresh"'), 'stops reloading itself');
  assert.ok(html.includes('href="/checkout/nsmb"'), 'offers to pay again');

  html = page.completePage({ order: { ...waiting, status: 'expired' }, product });
  assert.ok(html.includes(copy.complete.endedTitle));
  html = page.completePage({ order: { ...order, status: 'refunded' }, product });
  assert.ok(html.includes(copy.complete.refundedTitle));
  assert.ok(!html.includes(copy.complete.paidTitle));
  html = page.completePage({ order: null });
  assert.ok(html.includes(copy.complete.missingTitle));
  assert.ok(!html.includes('co-data'));
});

test('JSON embedded in a page cannot break out of its script element', () => {
  const out = page.json({ a: '</script><script>alert(1)</script>', b: '<!--', c: ' ' });
  assert.ok(!out.includes('<') && !out.includes('>'));
  assert.deepEqual(JSON.parse(out), { a: '</script><script>alert(1)</script>', b: '<!--', c: ' ' });
});

// ---------- ActiveCampaign and Slack ----------
test('a paid order queues the contact, the product’s tags and the order fields, each once', () => {
  const ops = sync.purchaseOps(order, product, { receiptUrl: 'https://ciderpay.com/receipt/1' });
  assert.deepEqual(ops.map((o) => `${o.op}:${o.payload.tag || ''}`), ['contact:', 'tag_add:purchased_nsmb_03_202701', 'tag_add:customer', 'fields:']);
  assert.equal(new Set(ops.map((o) => o.dedupe)).size, ops.length);
  assert.ok(ops.every((o) => o.dedupe.startsWith('o9:')));
  assert.deepEqual(ops[3].payload.fields, { ORDER_NUMBER: '100042', ORDER_PRODUCT: '내성만방 프로그램', ORDER_DATE: '2026-11-11', ORDER_TOTAL: '₩2,690,000', ORDER_PLAN: '일시불', ORDER_RECEIPT_URL: 'https://ciderpay.com/receipt/1' });
  assert.deepEqual(Object.keys(ops[3].payload.fields), sync.ORDER_FIELDS);
  // no purchase tag set, a repeated tag, blanks: no empty or duplicate tag is ever sent
  const none = sync.purchaseOps(order, { ...product, purchase_tag: '', extra_tags: ['customer', ' customer ', ''] });
  assert.deepEqual(none.filter((o) => o.op === 'tag_add').map((o) => o.payload.tag), ['customer']);
});

test('retries wait longer each time, up to 12 hours', () => {
  assert.deepEqual([1, 2, 3, 4].map((n) => sync.backoffMs(n) / 60000), [5, 10, 20, 40]);
  assert.equal(sync.backoffMs(30), 12 * 60 * 60 * 1000);
});

test('Slack: the payment message, test payments marked, only real Slack addresses used', async () => {
  assert.equal(notify.paidText(order, '신한카드'), "You've got MONEY!\nYAY!! Paid ₩2,690,000 🎉 (신한카드)\n김지연 - 내성만방 프로그램 [100042]");
  const env = { SLACK_WEBHOOK_ASHLEY: 'https://hooks.slack.com/services/T/B/x', SLACK_WEBHOOK_ALEX: 'https://evil.example/hook' };
  assert.deepEqual(notify.webhooks(env), ['https://hooks.slack.com/services/T/B/x']);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, text: JSON.parse(init.body).text }); return { ok: true }; };
  assert.equal(await notify.paid(order, 'PayPal', { notifications: { paid: true } }, { fetchImpl, env }), 1);
  assert.ok(calls[0].text.startsWith('[TEST] '), 'outside production a payment is marked as a test');
  await notify.paid(order, 'PayPal', { notifications: { paid: true } }, { fetchImpl, env: { ...env, VERCEL_ENV: 'production' } });
  assert.ok(calls[1].text.startsWith("You've got MONEY!"));
  assert.equal(await notify.paid(order, 'PayPal', { notifications: { paid: false } }, { fetchImpl, env }), 0, 'switched off in settings');
  // A Slack failure never throws.
  assert.equal(await notify.send('x', { fetchImpl: async () => { throw new Error('down'); }, env }), 1);
});
