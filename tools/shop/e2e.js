/*
 * End-to-end checks of the checkout: the real endpoints and the real database statements, against the fake
 * payment providers, inside a database transaction that is rolled back at the end. No money, nothing saved.
 *
 *   npm run test:shop        (needs .env.local with PODCAST_DATABASE_URL or DATABASE_URL)
 *
 * It plays the things a buyer or a provider can do — pay, pay twice, send a forged or wrong notice, come back
 * without paying, never come back — and checks the order, the payment, the tax ledger line and the queue of
 * ActiveCampaign updates after each one. Exit code 1 if any check fails.
 */
const { start } = require('./dev-server.js');

const results = [];
let current = '';
function check(name, ok, detail = '') {
  results.push({ group: current, name, ok: Boolean(ok), detail });
  if (!ok) console.log(`  ✖ ${name}${detail ? ' — ' + detail : ''}`);
}
const eq = (name, actual, expected) => check(name, JSON.stringify(actual) === JSON.stringify(expected), `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);

async function main() {
  const s = await start({ port: Number(process.env.E2E_PORT || 8795), quiet: true });
  const { base, sql, fake } = s;
  const group = (name) => { current = name; console.log(name); };
  const one = async (text, params) => (await sql(text, params))[0] || null;
  const origin = { Origin: base };
  const get = (path, init = {}) => fetch(base + path, { redirect: 'manual', ...init });
  const postJson = (path, body, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', ...origin, ...headers }, body: JSON.stringify(body) });
  const postForm = (path, body, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...origin, ...headers }, body: new URLSearchParams(body).toString() });
  const admin = async (action, body) => (await fetch(`${base}/api/admin?action=${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...origin }, body: JSON.stringify(body) })).json();

  const buyer = (n, over = {}) => ({ slug: 'e2e-eft', currency: 'KRW', plan: 'full', name: '김지연', email: `buyer${n}@example.com`, phone: '010-1234-5678', postcode: '48095', address1: '부산 해운대구 중동1로17번길 15-1', address2: '101호', ...over });
  const abroad = (n, over = {}) => ({ slug: 'e2e-nsmb', currency: 'USD', plan: 'full', name: 'Jiyeon Kim', email: `abroad${n}@example.com`, phone: '+1 415 555 0123', country: 'US', address1: '1 Market St, San Francisco', address2: '', postcode: '94105', ...over });
  const orderOf = (email) => one(`SELECT o.* FROM shop_orders o JOIN shop_customers c ON c.id = o.customer_id WHERE c.email = $1 ORDER BY o.id DESC LIMIT 1`, [email]);
  const count = async (table, where, params) => (await one(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).n;
  const ridOf = (redirect) => new URL(redirect).searchParams.get('id');
  // Each fake buyer comes from a different network, so the rate limit only triggers where it is tested.
  let net = 0;
  const from = () => ({ 'x-forwarded-for': `198.51.100.${++net}` });

  try {
    // ---------- products ----------
    group('Products');
    const eft = await admin('shop-product-save', { name: 'EFT 태핑 마스터클래스', slug: 'e2e-eft', status: 'open', price_krw: '220000', purchase_tag: 'purchased_eft', extra_tags: 'customer', content: { summary: '100분 마스터클래스', included: '상황별 태핑 스크립트\n1년 다시보기', page: '/eft' } });
    const nsmb = await admin('shop-product-save', { name: '내성만방 프로그램', slug: 'e2e-nsmb', status: 'open', price_krw: '2690000', price_usd: '2299', instalment_first: '930000', instalment_monthly: '930000', instalment_count: '2', purchase_tag: 'purchased_nsmb_03_202701', content: {} });
    await admin('shop-product-save', { name: 'Closed', slug: 'e2e-closed', status: 'closed', price_krw: '50000', content: {} });
    await admin('shop-product-save', { name: 'Draft', slug: 'e2e-draft', status: 'draft', price_krw: '50000', content: {} });
    await admin('shop-product-save', { name: 'Ended', slug: 'e2e-ended', status: 'open', price_krw: '50000', sale_starts_at: '2020-01-01T00:00', sale_ends_at: '2020-02-01T00:00', content: {} });
    await admin('shop-product-save', { name: '<script>alert(1)</script>', slug: 'e2e-evil', status: 'open', price_krw: '50000', content: { summary: '"><img src=x onerror=alert(1)>' } });
    check('products created', eft.product && nsmb.product, JSON.stringify(eft.error || nsmb.error));

    // ---------- pages ----------
    group('Checkout pages');
    let r = await get('/checkout/e2e-eft');
    let html = await r.text();
    eq('open product: 200', r.status, 200);
    check('shows the price on the button', html.includes('₩220,000 결제하기'));
    check('not cached, not indexed', r.headers.get('cache-control').includes('no-store') && r.headers.get('x-robots-tag').includes('noindex'));
    check('cannot be framed by another site', r.headers.get('x-frame-options') === 'DENY');
    r = await get('/checkout/e2e-nsmb?currency=usd');
    html = await r.text();
    check('USD checkout shows dollars and PayPal', html.includes('$2,299 결제하기') && html.includes('PayPal'));
    check('instalment plan is not offered yet', !html.includes('930,000'));
    r = await get('/checkout/e2e-eft?currency=usd');
    check('a product without a USD price falls back to KRW', (await r.text()).includes('₩220,000 결제하기'));
    eq('unknown product: 404', (await get('/checkout/e2e-nothing')).status, 404);
    eq('draft product: 404', (await get('/checkout/e2e-draft')).status, 404);
    r = await get('/checkout/e2e-closed');
    html = await r.text();
    check('closed product: a clear page, no form', r.status === 200 && html.includes('지금은 신청 기간이 아니에요') && !html.includes('<form'));
    html = await (await get('/checkout/e2e-ended')).text();
    check('sale ended: says so', html.includes('이번 신청은 마감되었어요') && !html.includes('<form'));
    html = await (await get('/checkout/e2e-evil?utm_source=%22%3E%3Cscript%3Ealert(2)%3C/script%3E')).text();
    check('hostile product name and campaign value are escaped', !html.includes('<script>alert') && !html.includes('<img src=x') && html.includes('&lt;script&gt;alert(1)'));
    eq('POST to a page: 405', (await fetch(base + '/checkout/e2e-eft', { method: 'POST' })).status, 405);
    eq('unknown order on the thank-you page: 404', (await get('/checkout/complete?o=aaaaaaaaaaaaaaaaaaaaaa')).status, 404);
    eq('malformed order token: 404', (await get("/checkout/complete?o=' OR 1=1 --")).status, 404);

    // ---------- order creation ----------
    group('Creating an order (KRW)');
    r = await postJson('/api/shop?action=order', buyer(1), from());
    let body = await r.json();
    eq('accepted', r.status, 200);
    check('sends the buyer to the provider’s page', typeof body.redirect === 'string' && body.redirect.startsWith(base + '/__fake/ciderpay/pay'));
    let o = await orderOf('buyer1@example.com');
    eq('order amounts come from the product', [o.currency, o.plan, o.subtotal, o.total, o.due_today, o.status, o.provider], ['KRW', 'full', 220000, 220000, 220000, 'awaiting_payment', 'ciderpay']);
    check('order number starts above WooCommerce’s', o.number >= 100001);
    check('the provider request is remembered', o.provider_request === ridOf(body.redirect));
    eq('billing kept as typed, cleaned', [o.billing.name, o.billing.phone, o.billing.postcode], ['김지연', '01012345678', '48095']);
    const sentBody = fake.cider.get(o.provider_request).body;
    eq('CiderPay was asked for exactly the product’s price', sentBody.price, 220000);
    check('CiderPay request carries the order token and a signature', sentBody.var1 === o.token && sentBody.var2.length === 32);
    eq('nothing is paid yet', [o.paid_total, o.paid_at], [0, null]);
    eq('no payment, no ledger line yet', [await count('shop_payments', 'order_id = $1', [o.id]), await count('shop_ledger', 'order_id = $1', [o.id])], [0, 0]);

    group('Tampering with the order form');
    r = await postJson('/api/shop?action=order', buyer(2, { price: 1000, total: 1000, due_today: 1000, amount: '1000', subtotal: 1, discount: 219000, price_krw: 1000, status: 'paid', paid_total: 220000, number: 5 }), from());
    body = await r.json();
    o = await orderOf('buyer2@example.com');
    eq('amounts sent by the browser are ignored', [o.total, o.due_today, o.discount, o.status, o.paid_total], [220000, 220000, 0, 'awaiting_payment', 0]);
    eq('CiderPay still asked for the real price', fake.cider.get(o.provider_request).body.price, 220000);
    r = await postJson('/api/shop?action=order', buyer(3, { plan: 'instalment', slug: 'e2e-nsmb' }), from());
    eq('instalment plan refused until it is built', [r.status, (await r.json()).error], [409, 'unavailable']);
    r = await postJson('/api/shop?action=order', buyer(3, { currency: 'USD' }), from());
    eq('USD for a product without a USD price refused', [r.status, (await r.json()).error], [409, 'unavailable']);
    r = await postJson('/api/shop?action=order', buyer(3, { plan: 'weekly' }), from());
    eq('unknown plan refused', r.status, 409);
    for (const slug of ['e2e-closed', 'e2e-ended']) {
      r = await postJson('/api/shop?action=order', buyer(3, { slug }), from());
      eq(`${slug}: order refused`, [r.status, (await r.json()).error], [409, 'closed']);
    }
    eq('draft product: 404', (await postJson('/api/shop?action=order', buyer(3, { slug: 'e2e-draft' }), from())).status, 404);
    eq('unknown product: 404', (await postJson('/api/shop?action=order', buyer(3, { slug: 'nope' }), from())).status, 404);
    eq('SQL in the product address: 404', (await postJson('/api/shop?action=order', buyer(3, { slug: "x' OR '1'='1" }), from())).status, 404);
    eq('none of these created an order', await count('shop_orders o JOIN shop_customers c ON c.id = o.customer_id', 'c.email = $1', ['buyer3@example.com']), 0);

    group('Form problems');
    r = await postJson('/api/shop?action=order', buyer(4, { name: '', email: 'nope', phone: '123', postcode: '', address1: '' }), from());
    body = await r.json();
    eq('422 with one code per field', [r.status, body.error, body.fields], [422, 'invalid', { name: 'name_required', email: 'email_invalid', phone: 'phone_invalid', address1: 'address1_required', postcode: 'postcode_required' }]);
    eq('no customer row for a refused form', await count('shop_customers', 'email = $1', ['nope']), 0);
    r = await postJson('/api/shop?action=order', buyer(4), { ...from(), Origin: 'https://evil.example' });
    eq('a form posted from another site is refused', r.status, 403);
    eq('GET is refused', (await get('/api/shop?action=order')).status, 405);
    eq('unknown action: 404', (await postJson('/api/shop?action=nope', {})).status, 404);
    r = await fetch(base + '/api/shop?action=order', { method: 'POST', headers: { 'Content-Type': 'application/json', ...origin }, body: 'x'.repeat(70000) });
    eq('an oversized body is refused', r.status, 413);
    r = await fetch(base + '/api/shop?action=order', { method: 'POST', headers: { 'Content-Type': 'application/json', ...origin }, body: '{broken' });
    check('broken JSON does not crash anything', r.status === 404 || r.status === 422);

    group('Without JavaScript (plain form post)');
    r = await postForm('/api/shop?action=order', buyer(5), from());
    check('303 to the payment page', r.status === 303 && String(r.headers.get('location')).startsWith(base + '/__fake/ciderpay/pay'));
    r = await postForm('/api/shop?action=order', buyer(6, { email: 'wrong', name: '김<b>지연' }), from());
    html = await r.text();
    check('errors: the page again, with the message and what was typed', r.status === 422 && html.includes('이메일 주소를 다시 확인해 주세요.') && html.includes('value="김&lt;b&gt;지연"') && html.includes('value="wrong"'));

    group('Provider problems');
    r = await postJson('/api/shop?action=order', buyer(7, { name: 'PROVIDERFAIL' }), from());
    eq('CiderPay refuses the request: 502, clean code', [r.status, (await r.json()).error], [502, 'provider']);
    o = await orderOf('buyer7@example.com');
    check('the order is closed with the reason noted', o.status === 'cancelled' && /CiderPay refused/.test(o.note));
    r = await postJson('/api/shop?action=order', buyer(8, { name: 'PROVIDERDOWN' }), from());
    eq('CiderPay is down: 502', [r.status, (await r.json()).error], [502, 'provider']);

    // ---------- CiderPay notices ----------
    group('CiderPay notice: forged or wrong');
    o = await orderOf('buyer1@example.com');
    const rid = o.provider_request;
    const feedbackUrl = fake.cider.get(rid).body.feedbackurl;
    let n = await fake.notifyCiderpay(rid, {}, feedbackUrl.replace(/k=[^&]+/, 'k=wrongkeywrongkeywrongkeywrongkey'));
    eq('wrong key in the address: 403', n.status, 403);
    n = await fake.notifyCiderpay(rid, {}, feedbackUrl.replace(/&k=[^&]+/, ''));
    eq('no key: 403', n.status, 403);
    n = await fake.notifyCiderpay(rid, { var2: 'A'.repeat(32) });
    eq('wrong signature: refused', n.status, 400);
    n = await fake.notifyCiderpay(rid, { var2: '' });
    eq('no signature: refused', n.status, 400);
    n = await fake.notifyCiderpay(rid, { var1: 'aaaaaaaaaaaaaaaaaaaaaa' });
    eq('unknown order token: 404', n.status, 404);
    const other = await orderOf('buyer2@example.com');
    n = await fake.notifyCiderpay(rid, { var1: other.token });
    eq('another order’s token with this order’s signature: refused', n.status, 400);
    n = await fake.notifyCiderpay(rid, { memberID: 'someone-else' });
    eq('another merchant id: refused', n.status, 400);
    n = await fake.notifyCiderpay(rid, { price: '1000' });
    eq('wrong amount (less): refused', n.status, 400);
    n = await fake.notifyCiderpay(rid, { price: '220001' });
    eq('wrong amount (more): refused', n.status, 400);
    n = await fake.notifyCiderpay(rid, { price: 'abc' });
    eq('amount that is not a number: refused', n.status, 400);
    n = await fake.notifyCiderpay(rid, { orderNo: '' });
    eq('no CiderPay order number: refused', n.status, 400);
    n = await fake.notifyCiderpay(rid, { paymentState: 'WAIT' });
    eq('a state that is not "paid": acknowledged, ignored', [n.status, JSON.parse(n.body).outcome], [200, 'ignored']);
    eq('GET on the callback: 405', (await get('/api/shop-callback?p=ciderpay&k=x')).status, 405);
    eq('unknown provider: 404', (await postForm('/api/shop-callback?p=stripe', {})).status, 404);
    o = await orderOf('buyer1@example.com');
    eq('after all of that the order is still unpaid', [o.status, o.paid_total, await count('shop_payments', 'order_id = $1', [o.id]), await count('shop_ledger', 'order_id = $1', [o.id])], ['awaiting_payment', 0, 0, 0]);
    check('every refused notice was logged', (await count('shop_callbacks', `order_id = $1 AND outcome = 'rejected'`, [o.id])) >= 7);
    eq('status API says pending', (await (await get(`/api/shop?action=status&o=${o.token}`)).json()).status, 'pending');
    html = await (await get(`/checkout/complete?o=${o.token}`)).text();
    check('thank-you page shows "checking", not "paid"', html.includes('결제를 확인하고 있어요') && !html.includes('결제가 완료되었어요'));
    html = await (await get(`/checkout/complete?o=${o.token}&n=8`)).text();
    check('after waiting: says it is not confirmed and offers to pay again', html.includes('아직 결제가 확인되지 않았어요') && html.includes('/checkout/e2e-eft'));

    group('CiderPay notice: the real payment');
    n = await fake.notifyCiderpay(rid);
    eq('accepted', [n.status, JSON.parse(n.body).outcome], [200, 'paid']);
    o = await orderOf('buyer1@example.com');
    eq('order is paid', [o.status, o.paid_total, Boolean(o.paid_at)], ['paid', 220000, true]);
    let pay = await one('SELECT * FROM shop_payments WHERE order_id = $1', [o.id]);
    eq('payment recorded with the provider’s references', [pay.provider, pay.kind, pay.amount, pay.currency, pay.provider_ref, pay.approval_no, pay.refund_token, pay.method, pay.receipt_url], ['ciderpay', 'payment', 220000, 'KRW', 'CP' + rid, '30012345', 'FT' + rid, '신한카드', 'https://example.com/receipt/' + rid]);
    let led = await one('SELECT * FROM shop_ledger WHERE order_id = $1', [o.id]);
    eq('tax ledger line: supply + VAT', [led.kind, led.amount, led.supply, led.vat, led.vat_rule, led.currency, led.payment_id], ['sale', 220000, 200000, 20000, 'taxable', 'KRW', pay.id]);
    let box = await sql('SELECT op, payload, status FROM shop_outbox WHERE order_id = $1 ORDER BY id', [o.id]);
    eq('ActiveCampaign updates queued: contact, both tags, fields', box.map((b) => `${b.op}:${b.payload.tag || ''}`), ['contact:', 'tag_add:purchased_eft', 'tag_add:customer', 'fields:']);
    eq('order fields for the emails', box[3].payload.fields.ORDER_NUMBER, String(o.number));
    eq('status API says paid', (await (await get(`/api/shop?action=status&o=${o.token}`)).json()).status, 'paid');

    group('CiderPay notice: repeated');
    n = await fake.notifyCiderpay(rid);
    eq('the same notice again: acknowledged as a duplicate', [n.status, JSON.parse(n.body).outcome], [200, 'duplicate']);
    await Promise.all([fake.notifyCiderpay(rid), fake.notifyCiderpay(rid), fake.notifyCiderpay(rid)]);
    o = await orderOf('buyer1@example.com');
    eq('still one payment, one ledger line, same total, same AC updates', [await count('shop_payments', 'order_id = $1', [o.id]), await count('shop_ledger', 'order_id = $1', [o.id]), o.paid_total, await count('shop_outbox', 'order_id = $1', [o.id])], [1, 1, 220000, 4]);
    n = await fake.notifyCiderpay(rid, { orderNo: 'CP-SECOND', approvalNo: '30099999' });
    eq('a second, different payment for a paid order: recorded and flagged', [n.status, JSON.parse(n.body).outcome], [200, 'extra']);
    o = await orderOf('buyer1@example.com');
    eq('the ledger shows both (money received is never dropped)', [await count('shop_ledger', 'order_id = $1', [o.id]), o.paid_total, o.status, await count('shop_outbox', 'order_id = $1', [o.id])], [2, 440000, 'paid', 4]);

    group('Thank-you page');
    r = await get(`/checkout/complete?o=${o.token}`);
    html = await r.text();
    check('paid: thanks, order number, amount, receipt', html.includes('결제가 완료되었어요') && html.includes(String(o.number)) && html.includes('₩220,000') && html.includes('https://example.com/receipt/' + rid) && html.includes('김지연님'));
    check('offers the purchase event to GTM', html.includes('"transaction_id":"' + o.number + '"'));
    r = await postJson('/api/shop?action=after', { o: o.token, tracked: true });
    eq('browser reports the event as sent', r.status, 200);
    html = await (await get(`/checkout/complete?o=${o.token}`)).text();
    check('the event is not offered a second time', html.includes('"purchase":null'));
    eq('"after" for an unpaid order is refused', (await postJson('/api/shop?action=after', { o: other.token, tracked: true })).status, 404);
    eq('…and did not mark it', (await one('SELECT tracked_at FROM shop_orders WHERE id = $1', [other.id])).tracked_at, null);
    eq('"after" from another site is refused', (await postJson('/api/shop?action=after', { o: o.token }, { Origin: 'https://evil.example' })).status, 403);

    const paidId = o.id;
    group('Customer record');
    r = await postJson('/api/shop?action=order', buyer(1, { name: '다른 사람', phone: '010-9999-9999', address2: '999호' }), from());
    let c = await one('SELECT * FROM shop_customers WHERE email = $1', ['buyer1@example.com']);
    eq('an unpaid order under someone’s email does not rewrite their record', [c.name, c.phone, c.address2], ['김지연', '01012345678', '101호']);
    eq('one customer per email', await count('shop_customers', 'email = $1', ['buyer1@example.com']), 1);

    group('Late and unusual payments');
    r = await postJson('/api/shop?action=order', buyer(9), from());
    o = await orderOf('buyer9@example.com');
    await sql(`UPDATE shop_orders SET created_at = now() - interval '25 hours' WHERE id = $1`, [o.id]);
    const cron = require('../../api/_lib/shop/orders.js');
    check('the daily job expires orders unpaid for a day', (await cron.expireStale()) >= 1);
    eq('…this one is expired', (await orderOf('buyer9@example.com')).status, 'expired');
    eq('…a paid order is not touched', (await one('SELECT status FROM shop_orders WHERE id = $1', [paidId])).status, 'paid');
    html = await (await get(`/checkout/complete?o=${o.token}`)).text();
    check('thank-you page for an expired order offers to pay again', html.includes('결제가 완료되지 않았어요'));
    eq('status API says ended', (await (await get(`/api/shop?action=status&o=${o.token}`)).json()).status, 'ended');
    n = await fake.notifyCiderpay(o.provider_request);
    eq('a real payment arriving after expiry is still accepted', [n.status, JSON.parse(n.body).outcome, (await orderOf('buyer9@example.com')).status], [200, 'paid', 'paid']);

    group('Rate limit');
    const flood = { 'x-forwarded-for': '203.0.113.99' };
    let codes = [];
    const limit = cron.RATE_LIMIT;
    for (let i = 0; i < limit.perNetwork + 2; i++) codes.push((await postJson('/api/shop?action=order', buyer(100 + i), flood)).status);
    eq(`after ${limit.perNetwork} orders from one network in ten minutes, the next are refused`, [codes.slice(0, limit.perNetwork).every((x) => x === 200), codes[limit.perNetwork], codes[limit.perNetwork + 1]], [true, 429, 429]);
    codes = [];
    for (let i = 0; i < limit.perEmail + 1; i++) codes.push((await postJson('/api/shop?action=order', buyer(200), from())).status);
    eq(`after ${limit.perEmail} orders for one email, the next is refused`, [codes.slice(0, limit.perEmail).every((x) => x === 200), codes[limit.perEmail]], [true, 429]);
    eq('another buyer is not affected', (await postJson('/api/shop?action=order', buyer(300), from())).status, 200);

    // ---------- PayPal ----------
    group('PayPal: order and approval');
    r = await postJson('/api/shop?action=order', abroad(1), from());
    body = await r.json();
    check('sends the buyer to PayPal', r.status === 200 && body.redirect.startsWith(base + '/__fake/paypal/approve'));
    o = await orderOf('abroad1@example.com');
    eq('USD order in cents', [o.currency, o.total, o.due_today, o.provider, o.status, o.billing.country, o.billing.phone], ['USD', 229900, 229900, 'paypal', 'awaiting_payment', 'US', '+14155550123']);
    const ppBody = fake.paypal.get(o.provider_request).body;
    eq('PayPal was asked for exactly $2,299.00', ppBody.purchase_units[0].amount, { currency_code: 'USD', value: '2299.00' });
    r = await get(`/checkout/complete?o=${o.token}`);
    html = await r.text();
    check('opening the thank-you page before approving does not mark it paid', html.includes('결제를 확인하고 있어요') && (await orderOf('abroad1@example.com')).status === 'awaiting_payment');
    eq('…and nothing is recorded', await count('shop_payments', 'order_id = $1', [o.id]), 0);
    r = await get(`/__fake/paypal/do?id=${o.provider_request}&act=approve`);
    const back = r.headers.get('location');
    r = await get(back.replace(base, ''));
    html = await r.text();
    check('back from PayPal: captured and thanked', r.status === 200 && html.includes('결제가 완료되었어요') && html.includes('$2,299'));
    o = await orderOf('abroad1@example.com');
    pay = await one('SELECT * FROM shop_payments WHERE order_id = $1', [o.id]);
    eq('payment recorded with PayPal’s fee', [o.status, o.paid_total, pay.provider, pay.amount, pay.currency, pay.fee, pay.provider_ref, pay.method], ['paid', 229900, 'paypal', 229900, 'USD', 10146, 'CAP' + o.provider_request, 'PayPal']);
    led = await one('SELECT * FROM shop_ledger WHERE order_id = $1', [o.id]);
    eq('ledger: USD, taxable, supply + VAT, fee', [led.currency, led.amount, led.supply, led.vat, led.vat_rule, led.fee, led.amount_krw], ['USD', 229900, 209000, 20900, 'taxable', 10146, null]);
    eq('AC updates queued for the USD buyer', await count('shop_outbox', 'order_id = $1', [o.id]), 3);
    await get(back.replace(base, ''));
    await get(back.replace(base, ''));
    eq('reloading the thank-you page captures nothing twice', [await count('shop_payments', 'order_id = $1', [o.id]), await count('shop_ledger', 'order_id = $1', [o.id]), (await orderOf('abroad1@example.com')).paid_total], [1, 1, 229900]);

    group('PayPal: cancel, decline, held');
    r = await postJson('/api/shop?action=order', abroad(2), from());
    o = await orderOf('abroad2@example.com');
    r = await get(`/__fake/paypal/do?id=${o.provider_request}&act=cancel`);
    check('cancel returns to the USD checkout with a message', String(r.headers.get('location')).includes('/checkout/e2e-nsmb?currency=usd&problem=cancelled'));
    html = await (await get('/checkout/e2e-nsmb?currency=usd&problem=cancelled')).text();
    check('…which says the payment was not completed', html.includes('결제가 완료되지 않았어요'));
    html = await (await get('/checkout/e2e-nsmb?problem=%3Cscript%3E')).text();
    check('an unknown "problem" value is ignored', /id="co-problem" role="alert" hidden><\/p>/.test(html));
    r = await postJson('/api/shop?action=order', abroad(3), from());
    o = await orderOf('abroad3@example.com');
    r = await get(`/__fake/paypal/do?id=${o.provider_request}&act=decline`);
    r = await get(r.headers.get('location').replace(base, ''));
    check('declined card: back to the checkout with a message', r.status === 303 && String(r.headers.get('location')).includes('problem=declined'));
    eq('…and the order is not paid', [(await orderOf('abroad3@example.com')).status, await count('shop_payments', 'order_id = $1', [o.id])], ['awaiting_payment', 0]);
    r = await postJson('/api/shop?action=order', abroad(4), from());
    o = await orderOf('abroad4@example.com');
    r = await get(`/__fake/paypal/do?id=${o.provider_request}&act=pending`);
    html = await (await get(r.headers.get('location').replace(base, ''))).text();
    check('a payment PayPal is holding is not treated as paid', html.includes('결제를 확인하고 있어요') && (await orderOf('abroad4@example.com')).status === 'awaiting_payment');
    const held = fake.paypalOrder(fake.paypal.get(o.provider_request), o.provider_request).purchase_units[0].payments.captures[0];
    n = await fake.notifyPaypal('PAYMENT.CAPTURE.COMPLETED', { ...held, status: 'COMPLETED' });
    eq('…until PayPal’s webhook says it completed', [n.status, JSON.parse(n.body).outcome, (await orderOf('abroad4@example.com')).status], [200, 'paid', 'paid']);

    group('PayPal: webhooks');
    r = await postJson('/api/shop?action=order', abroad(5), from());
    o = await orderOf('abroad5@example.com');
    n = await fake.notifyPaypal('CHECKOUT.ORDER.APPROVED', { id: o.provider_request }, { good: false });
    eq('a webhook PayPal does not vouch for is refused', [n.status, (await orderOf('abroad5@example.com')).status], [403, 'awaiting_payment']);
    r = await fetch(`${base}/api/shop-callback?p=paypal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'X', status: 'COMPLETED', custom_id: o.token, amount: { currency_code: 'USD', value: '2299.00' } } }) });
    eq('a webhook without PayPal’s signature headers is refused', [r.status, (await orderOf('abroad5@example.com')).status], [403, 'awaiting_payment']);
    const logged = await count('shop_callbacks', 'true', []);
    await fetch(`${base}/api/shop-callback?p=paypal`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{broken' });
    await fetch(`${base}/api/shop-callback?p=ciderpay&k=nope`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'paymentState=COMPLETE' });
    await fake.notifyPaypal('PAYMENT.CAPTURE.COMPLETED', { id: 'JUNK' }, { good: false });
    eq('notices that fail the provider check write nothing to the database', await count('shop_callbacks', 'true', []), logged);
    n = await fake.notifyPaypal('CHECKOUT.ORDER.APPROVED', { id: o.provider_request });
    eq('approved webhook before the buyer approved: nothing captured', [n.status, (await orderOf('abroad5@example.com')).status], [200, 'awaiting_payment']);
    r = await get(`/__fake/paypal/do?id=${o.provider_request}&act=noreturn`);
    o = await orderOf('abroad5@example.com');
    eq('buyer approves and never returns: the webhook captures and records', [o.status, o.paid_total, await count('shop_payments', 'order_id = $1', [o.id])], ['paid', 229900, 1]);
    const cap = fake.paypalOrder(fake.paypal.get(o.provider_request), o.provider_request).purchase_units[0].payments.captures[0];
    n = await fake.notifyPaypal('PAYMENT.CAPTURE.COMPLETED', cap);
    eq('the capture webhook for the same payment is a duplicate', [n.status, JSON.parse(n.body).outcome, await count('shop_payments', 'order_id = $1', [o.id])], [200, 'duplicate', 1]);
    n = await fake.notifyPaypal('PAYMENT.CAPTURE.COMPLETED', { ...cap, id: 'CAPOTHER', amount: { currency_code: 'USD', value: '1.00' } });
    eq('a capture for another amount is refused', [n.status, JSON.parse(n.body).outcome, await count('shop_payments', 'order_id = $1', [o.id])], [200, 'rejected', 1]);
    n = await fake.notifyPaypal('PAYMENT.CAPTURE.COMPLETED', { ...cap, id: 'CAPEUR', amount: { currency_code: 'EUR', value: '2299.00' } });
    eq('a capture in another currency is refused', JSON.parse(n.body).outcome, 'rejected');
    n = await fake.notifyPaypal('PAYMENT.CAPTURE.COMPLETED', { ...cap, id: 'CAPX', custom_id: 'aaaaaaaaaaaaaaaaaaaaaa' });
    eq('a capture for an order we do not know is ignored', JSON.parse(n.body).outcome, 'ignored');
    n = await fake.notifyPaypal('PAYMENT.CAPTURE.REFUNDED', { id: 'REF1' });
    eq('a refund webhook is acknowledged and logged for a person', [n.status, JSON.parse(n.body).outcome], [200, 'ignored']);
    eq('…the order is unchanged', (await orderOf('abroad5@example.com')).status, 'paid');

    group('Cross-provider and cross-order');
    const krwOrder = await orderOf('buyer2@example.com'); // awaiting CiderPay
    n = await fake.notifyPaypal('PAYMENT.CAPTURE.COMPLETED', { id: 'CAPCROSS', status: 'COMPLETED', custom_id: krwOrder.token, amount: { currency_code: 'USD', value: '2200.00' } });
    eq('a PayPal capture cannot pay a CiderPay order', [JSON.parse(n.body).outcome, (await orderOf('buyer2@example.com')).status], ['rejected', 'awaiting_payment']);

    group('Admin view');
    const paid = { id: paidId };
    const detail = await (await fetch(`${base}/api/admin?action=shop-order&id=${paid.id}`)).json();
    check('order page shows payments, tax lines, AC updates and notices', detail.payments.length === 2 && detail.ledger.length === 2 && detail.outbox.length === 4 && detail.notices.length >= 9);
    const overview = (await (await fetch(`${base}/api/admin?action=shop-overview`)).json()).overview;
    check('overview counts the notices needing attention and the AC updates waiting', overview.attention.notices > 0 && overview.attention.ac_pending > 0);
    check('overview totals come from the ledger', overview.last30days.KRW.net.amount >= 440000 && overview.last30days.USD.net.amount === 229900 * 3);
    const run = await admin('shop-sync-run', {});
    check('"send AC updates now" reports that ActiveCampaign is not configured here', /not configured/.test(JSON.stringify(run)));

    group('Ledger integrity');
    const sums = await one(`SELECT (SELECT COALESCE(sum(amount), 0)::int FROM shop_ledger WHERE currency = 'KRW') AS ledger, (SELECT COALESCE(sum(amount), 0)::int FROM shop_payments WHERE currency = 'KRW' AND kind = 'payment') AS payments, (SELECT COALESCE(sum(paid_total), 0)::int FROM shop_orders WHERE currency = 'KRW') AS orders`);
    eq('KRW: ledger = payments = orders’ paid totals', [sums.ledger === sums.payments, sums.payments === sums.orders], [true, true]);
    const usdSums = await one(`SELECT (SELECT COALESCE(sum(amount), 0)::int FROM shop_ledger WHERE currency = 'USD') AS ledger, (SELECT COALESCE(sum(amount), 0)::int FROM shop_payments WHERE currency = 'USD') AS payments, (SELECT COALESCE(sum(paid_total), 0)::int FROM shop_orders WHERE currency = 'USD') AS orders`);
    eq('USD: ledger = payments = orders’ paid totals', [usdSums.ledger === usdSums.payments, usdSums.payments === usdSums.orders], [true, true]);
    eq('every ledger line splits exactly', await count('shop_ledger', 'supply + vat <> amount', []), 0);
    eq('every payment has exactly one ledger line', await count('shop_payments p', 'NOT EXISTS (SELECT 1 FROM shop_ledger l WHERE l.payment_id = p.id) OR (SELECT count(*) FROM shop_ledger l WHERE l.payment_id = p.id) <> 1', []), 0);
    eq('no order is paid without a payment', await count('shop_orders o', `o.paid_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM shop_payments p WHERE p.order_id = o.id)`, []), 0);
    eq('no unpaid order has money on it', await count('shop_orders', `status IN ('created', 'awaiting_payment', 'expired', 'cancelled') AND paid_total <> 0`, []), 0);
  } catch (err) {
    check('the run finished without an exception', false, err.stack || err.message);
  } finally {
    await s.stop();
  }

  const failed = results.filter((x) => !x.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed${failed.length ? '' : ' — the database was rolled back, nothing was saved'}`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  [${f.group}] ${f.name}${f.detail ? '\n      ' + f.detail : ''}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
