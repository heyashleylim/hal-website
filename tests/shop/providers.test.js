// CiderPay and PayPal modules against scripted answers (no network): what we send, and what we accept back.
const test = require('node:test');
const assert = require('node:assert/strict');
const ciderpay = require('../../api/_lib/shop/pay/ciderpay.js');
const paypal = require('../../api/_lib/shop/pay/paypal.js');
const orders = require('../../api/_lib/shop/orders.js');
const config = require('../../api/_lib/shop/config.js');

const env = {
  SHOP_SECRET: 'test-secret-test-secret-test-secret-1234', VERCEL_ENV: 'production',
  CIDERPAY_MEMBER_ID: 'merchant1', CIDERPAY_API_TOKEN: 'tok-123', PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec', PAYPAL_WEBHOOK_ID: 'WH-1',
};
const order = { id: 5, number: 100042, token: 'abcdefghijklmnopqrstuv', currency: 'KRW', plan: 'full', due_today: 220000, total: 220000, provider: 'ciderpay', status: 'awaiting_payment' };
const usdOrder = { ...order, id: 6, number: 100043, currency: 'USD', due_today: 229900, total: 229900, provider: 'paypal' };
const billing = { name: '김지연', email: 'jiyeon@example.com', phone: '01012345678' };

// A fetch that answers from a script and records what it was asked.
function scripted(...answers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const a = answers.shift();
    if (!a) throw new Error('unexpected request to ' + url);
    if (a.throw) throw new Error(a.throw);
    const text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
    return { ok: (a.status || 200) < 300, status: a.status || 200, text: async () => text, json: async () => JSON.parse(text) };
  };
  fn.calls = calls;
  return fn;
}

// ---------- CiderPay ----------
test('CiderPay: the request carries our amount, our order and our signature, never the buyer’s', () => {
  const req = ciderpay.paymentRequest({ order, productName: 'EFT 태핑 마스터클래스', billing }, env);
  assert.equal(req.memberID, 'merchant1');
  assert.equal(req.price, 220000);
  assert.equal(req.goodName, 'EFT 태핑 마스터클래스 [100042]');
  assert.equal(req.mobile, '01012345678');
  assert.equal(req.smsuse, 'N');
  assert.equal(req.var1, order.token);
  assert.equal(req.var2, ciderpay.signature(order, env));
  assert.equal(req.returnurl, 'https://www.ashleylim.com/checkout/complete?o=abcdefghijklmnopqrstuv');
  assert.ok(req.feedbackurl.startsWith('https://www.ashleylim.com/api/shop-callback?p=ciderpay&k='));
  // the signature binds the token, the order number and the amount
  assert.notEqual(ciderpay.signature({ ...order, due_today: 1000 }, env), req.var2);
  assert.notEqual(ciderpay.signature({ ...order, number: 1 }, env), req.var2);
  assert.notEqual(ciderpay.signature({ ...order, token: 'zbcdefghijklmnopqrstuv' }, env), req.var2);
});

test('CiderPay: refuses to ask for something it cannot charge', () => {
  assert.throws(() => ciderpay.paymentRequest({ order: usdOrder, productName: 'x', billing }, env), (e) => e.code === 'unavailable');
  assert.throws(() => ciderpay.paymentRequest({ order: { ...order, due_today: 999 }, productName: 'x', billing }, env), (e) => e.code === 'unavailable');
  assert.throws(() => ciderpay.paymentRequest({ order: { ...order, due_today: 1000.5 }, productName: 'x', billing }, env), (e) => e.code === 'unavailable');
  assert.throws(() => ciderpay.paymentRequest({ order, productName: 'x', billing }, { ...env, CIDERPAY_API_TOKEN: '' }), (e) => e.code === 'not_configured');
});

test('CiderPay: a good answer gives the payment page', async () => {
  const f = scripted({ body: { success: true, payUrl: 'https://pay.ciderpay.com/p/XYZ', payUniqueNo: 'U1' } });
  const r = await ciderpay.requestPayment({ order, productName: 'EFT', billing }, { fetchImpl: f, env });
  assert.deepEqual(r, { payUrl: 'https://pay.ciderpay.com/p/XYZ', payUniqueNo: 'U1' });
  assert.equal(f.calls[0].url, 'https://api.ciderpay.com/oapi/payment/request');
  assert.equal(f.calls[0].headers.approvalToken, 'tok-123');
  assert.equal(JSON.parse(f.calls[0].body).price, 220000);
});

test('CiderPay: every kind of bad answer becomes a clean "provider" problem', async () => {
  const fails = [
    { body: { success: false, errCode: '1001', message: '필수 필드 에러' } },
    { body: { success: true } },                                             // no payUrl
    { body: { success: true, payUrl: 'https://evil.example/pay' } },         // not CiderPay's address
    { body: { success: true, payUrl: 'javascript:alert(1)' } },
    { body: '<html>502 Bad Gateway</html>', status: 502 },
    { body: 'not json at all' },
    { throw: 'socket hang up' },
  ];
  for (const a of fails) {
    await assert.rejects(ciderpay.requestPayment({ order, productName: 'EFT', billing }, { fetchImpl: scripted(a), env }), (e) => e instanceof ciderpay.PayError && e.code === 'provider', JSON.stringify(a));
  }
});

const feedback = (over = {}) => ({
  memberID: 'merchant1', feedbackToken: 'FT1', goodName: 'EFT [100042]', price: '220000', recvPhone: '01012345678', paymentState: 'COMPLETE',
  payType: '1', pts: 'CARD', orderNo: 'CP-1', approvalNo: '30012345', ccname: '신한카드', var1: order.token, var2: ciderpay.signature(order, env),
  cardNum: '4567-****-****-1234', cardQuota: '00', csturl: 'https://ciderpay.com/receipt/1', ...over,
});

test('CiderPay: a notice is read the same from a form post or JSON', () => {
  const form = new URLSearchParams(feedback()).toString();
  const a = ciderpay.readNotice(ciderpay.parseBody(form, 'application/x-www-form-urlencoded'));
  const b = ciderpay.readNotice(ciderpay.parseBody(JSON.stringify({ ...feedback(), price: 220000 }), 'application/json'));
  const c = ciderpay.readNotice(ciderpay.parseBody(Buffer.from(form), ''));
  for (const n of [a, b, c]) {
    assert.equal(n.kind, 'paid');
    assert.equal(n.amount, 220000);
    assert.equal(n.orderNo, 'CP-1');
    assert.equal(n.refundToken, 'FT1');
    assert.equal(n.receiptUrl, 'https://ciderpay.com/receipt/1');
    assert.equal(n.method, '신한카드');
    assert.equal(n.token, order.token);
  }
  assert.deepEqual(ciderpay.parseBody('', ''), {});
  assert.deepEqual(ciderpay.parseBody('{"a":[1]}', 'application/json'), { a: '1' });
});

test('CiderPay: notice kinds, amounts and receipt links', () => {
  assert.equal(ciderpay.readNotice(feedback({ paymentState: 'CANCEL' })).kind, 'cancelled');
  assert.equal(ciderpay.readNotice(feedback({ paymentState: 'complete' })).kind, 'paid');
  assert.equal(ciderpay.readNotice(feedback({ paymentState: '' })).kind, 'unknown');
  assert.equal(ciderpay.readNotice({ cmd: 'completeRpPayment', price: '930000' }).kind, 'recurring');
  assert.equal(ciderpay.readNotice({}).kind, 'unknown');
  assert.equal(ciderpay.readNotice(feedback({ price: '220,000' })).amount, 220000);
  for (const price of ['', 'abc', '-5', '1e5', '220000.5', '99999999999']) assert.equal(ciderpay.readNotice(feedback({ price })).amount, null, price);
  assert.equal(ciderpay.readNotice(feedback({ csturl: 'javascript:alert(1)' })).receiptUrl, '');
  assert.equal(ciderpay.readNotice(feedback({ csturl: 'http://ciderpay.com/r' })).receiptUrl, '');
});

test('CiderPay: a notice is only believed with the order’s token and our signature', () => {
  const ok = (over) => ciderpay.noticeProblem(ciderpay.readNotice(feedback(over)), order, env);
  assert.equal(ok({}), null);
  assert.match(ok({ var2: 'forged' }), /signature/);
  assert.match(ok({ var2: '' }), /signature/);
  assert.match(ok({ var2: ciderpay.signature({ ...order, due_today: 1000 }, env) }), /signature/); // signed for another amount
  assert.match(ok({ var1: 'zbcdefghijklmnopqrstuv' }), /token/);
  assert.match(ok({ memberID: 'someone-else' }), /merchant/);
  assert.match(ok({ orderNo: '' }), /order number/);
  // a signature made with another secret is worthless
  assert.match(ok({ var2: ciderpay.signature(order, { ...env, SHOP_SECRET: 'another-secret-another-secret-another!' }) }), /signature/);
});

// ---------- what counts as the expected payment ----------
test('decide: only the exact amount, currency and provider are accepted', () => {
  const pay = { provider: 'ciderpay', currency: 'KRW', amount: 220000, ref: 'CP-1' };
  assert.deepEqual(orders.decide(order, pay), { action: 'accept' });
  for (const status of ['created', 'expired', 'cancelled']) assert.equal(orders.decide({ ...order, status }, pay).action, 'accept', status); // money received is never dropped
  for (const status of ['paid', 'partially_refunded', 'refunded', 'refund_requested']) assert.equal(orders.decide({ ...order, status }, pay).action, 'extra', status);
  const rejected = (change) => { const d = orders.decide(order, { ...pay, ...change }); assert.equal(d.action, 'reject', JSON.stringify(change)); assert.ok(d.reason); };
  rejected({ amount: 219999 });
  rejected({ amount: 220001 });
  rejected({ amount: 1000 });
  rejected({ amount: 0 });
  rejected({ amount: null });
  rejected({ amount: '220000' });   // a string is not an amount
  rejected({ amount: 220000.5 });
  rejected({ currency: 'USD' });
  rejected({ provider: 'paypal' });
  rejected({ ref: '' });
  rejected({ ref: null });
});

// ---------- PayPal ----------
test('PayPal: amounts are exact, never floating point', () => {
  assert.equal(paypal.dollars(229900), '2299.00');
  assert.equal(paypal.dollars(1905), '19.05');
  assert.equal(paypal.dollars(100), '1.00');
  assert.throws(() => paypal.dollars(19.5), (e) => e.code === 'unavailable');
  assert.throws(() => paypal.dollars(-1), (e) => e.code === 'unavailable');
  assert.equal(paypal.cents('2299.00'), 229900);
  assert.equal(paypal.cents('19.05'), 1905);
  assert.equal(paypal.cents('19.5'), 1950);
  assert.equal(paypal.cents('0.29'), 29); // 0.29 * 100 is 28.999999999999996 in floating point
  assert.equal(paypal.cents('1136.07'), 113607);
  for (const bad of ['', null, 'abc', '19.999', '-5', '1,000.00', '1e3']) assert.equal(paypal.cents(bad), null, String(bad));
  for (let c = 0; c < 3000; c += 7) assert.equal(paypal.cents(paypal.dollars(c)), c);
});

test('PayPal: the order we create states our amount and comes back to our pages', () => {
  const req = paypal.orderRequest({ order: usdOrder, productName: '내성만방 프로그램', slug: 'nsmb' }, env);
  const unit = req.purchase_units[0];
  assert.equal(req.intent, 'CAPTURE');
  assert.deepEqual(unit.amount, { currency_code: 'USD', value: '2299.00' });
  assert.equal(unit.custom_id, usdOrder.token);
  assert.equal(unit.reference_id, '100043');
  const ctx = req.payment_source.paypal.experience_context;
  assert.equal(ctx.return_url, 'https://www.ashleylim.com/checkout/complete?o=abcdefghijklmnopqrstuv');
  assert.equal(ctx.cancel_url, 'https://www.ashleylim.com/checkout/nsmb?currency=usd&problem=cancelled');
  assert.equal(ctx.shipping_preference, 'NO_SHIPPING');
  assert.equal(ctx.user_action, 'PAY_NOW');
  assert.throws(() => paypal.orderRequest({ order, productName: 'x', slug: 'x' }, env), (e) => e.code === 'unavailable'); // KRW
  assert.throws(() => paypal.orderRequest({ order: { ...usdOrder, due_today: 50 }, productName: 'x', slug: 'x' }, env), (e) => e.code === 'unavailable');
});

const token = { body: { access_token: 'A1', expires_in: 3600 } };
const captured = (over = {}) => ({
  id: 'PP1', status: 'COMPLETED', payer: { email_address: 'b@example.com', address: { country_code: 'US' } },
  purchase_units: [{ reference_id: '100043', payments: { captures: [{ id: 'CAP1', status: 'COMPLETED', amount: { currency_code: 'USD', value: '2299.00' }, custom_id: usdOrder.token, seller_receivable_breakdown: { paypal_fee: { currency_code: 'USD', value: '101.46' } }, ...over }] } }],
});

test('PayPal: creating an order returns PayPal’s approval page only', async () => {
  paypal.resetCache();
  const f = scripted(token, { status: 201, body: { id: 'PP1', links: [{ rel: 'self', href: 'https://api-m.paypal.com/x' }, { rel: 'payer-action', href: 'https://www.paypal.com/checkoutnow?token=PP1' }] } });
  const r = await paypal.createOrder({ order: usdOrder, productName: 'NSMB', slug: 'nsmb' }, { fetchImpl: f, env });
  assert.deepEqual(r, { id: 'PP1', approveUrl: 'https://www.paypal.com/checkoutnow?token=PP1' });
  assert.equal(f.calls[0].url, 'https://api-m.paypal.com/v1/oauth2/token');
  assert.equal(f.calls[0].headers.Authorization, 'Basic ' + Buffer.from('cid:sec').toString('base64'));
  assert.equal(f.calls[1].headers['PayPal-Request-Id'], 'order-' + usdOrder.token);

  paypal.resetCache();
  await assert.rejects(paypal.createOrder({ order: usdOrder, productName: 'NSMB', slug: 'nsmb' }, { fetchImpl: scripted(token, { status: 201, body: { id: 'PP1', links: [{ rel: 'payer-action', href: 'https://evil.example/pay' }] } }), env }), (e) => e.code === 'provider');
  paypal.resetCache();
  await assert.rejects(paypal.createOrder({ order: usdOrder, productName: 'NSMB', slug: 'nsmb' }, { fetchImpl: scripted(token, { status: 400, body: { name: 'INVALID_REQUEST' } }), env }), (e) => e.code === 'provider');
  paypal.resetCache();
  await assert.rejects(paypal.createOrder({ order: usdOrder, productName: 'NSMB', slug: 'nsmb' }, { fetchImpl: scripted({ status: 401, body: { error: 'invalid_client' } }), env }), (e) => e.code === 'provider');
  paypal.resetCache();
  await assert.rejects(paypal.createOrder({ order: usdOrder, productName: 'NSMB', slug: 'nsmb' }, { fetchImpl: scripted(token), env: { ...env, PAYPAL_SECRET: '' } }), (e) => e.code === 'not_configured');
});

test('PayPal: capture outcomes', async () => {
  const run = async (...answers) => { paypal.resetCache(); return paypal.captureOrder('PP1', { fetchImpl: scripted(token, ...answers), env }); };
  const ok = await run({ status: 201, body: captured() });
  assert.equal(ok.outcome, 'captured');
  assert.deepEqual(ok.capture, { status: 'COMPLETED', captureId: 'CAP1', amount: 229900, currency: 'USD', fee: 10146, customId: usdOrder.token, payerEmail: 'b@example.com', payerCountry: 'US' });

  assert.equal((await run({ status: 422, body: { details: [{ issue: 'ORDER_NOT_APPROVED' }] } })).outcome, 'not_approved');
  assert.equal((await run({ status: 422, body: { details: [{ issue: 'INSTRUMENT_DECLINED' }] } })).outcome, 'declined');
  assert.equal((await run({ status: 201, body: captured({ status: 'PENDING' }) })).outcome, 'pending');
  assert.equal((await run({ status: 201, body: captured({ status: 'DECLINED' }) })).outcome, 'declined');

  // Captured earlier (a reload, or the webhook got there first): looked up, same result.
  const again = await run({ status: 422, body: { details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] } }, { body: captured() });
  assert.equal(again.outcome, 'captured');
  assert.equal(again.capture.captureId, 'CAP1');

  await assert.rejects(run({ status: 500, body: { name: 'INTERNAL_SERVER_ERROR' } }), (e) => e.code === 'provider');
  await assert.rejects(run({ status: 201, body: { id: 'PP1', status: 'COMPLETED', purchase_units: [{}] } }), (e) => e.code === 'provider'); // no capture inside
  await assert.rejects(run({ throw: 'timeout' }), (e) => e.code === 'provider');
});

test('PayPal: a capture in another currency or with a strange amount is read as such, not guessed', () => {
  assert.equal(paypal.readCapture({ id: 'C', status: 'COMPLETED', amount: { currency_code: 'EUR', value: '10.00' } }).currency, 'EUR');
  assert.equal(paypal.readCapture({ id: 'C', status: 'COMPLETED', amount: { currency_code: 'USD', value: 'ten' } }).amount, null);
  assert.equal(paypal.readCapture({ id: 'C', status: 'COMPLETED', amount: { currency_code: 'USD', value: '10.00' }, seller_receivable_breakdown: { paypal_fee: { currency_code: 'KRW', value: '500' } } }).fee, null);
  assert.equal(paypal.readCapture({}).captureId, '');
});

test('PayPal: webhooks are checked with PayPal, passing the notice on untouched', async () => {
  const headers = { 'paypal-transmission-id': 'T1', 'paypal-transmission-sig': 'sig', 'paypal-transmission-time': '2026-11-11T00:00:00Z', 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert' };
  const raw = '{"id":"WH1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"amount":{"value":"10.00"}}}';
  paypal.resetCache();
  let f = scripted(token, { body: { verification_status: 'SUCCESS' } });
  assert.equal(await paypal.verifyWebhook(headers, JSON.parse(raw), { fetchImpl: f, env, rawText: raw }), true);
  assert.ok(f.calls[1].body.includes('"webhook_event":' + raw), 'the notice is embedded byte for byte');
  assert.equal(JSON.parse(f.calls[1].body).webhook_id, 'WH-1');

  paypal.resetCache();
  f = scripted(token, { body: { verification_status: 'FAILURE' } });
  assert.equal(await paypal.verifyWebhook(headers, JSON.parse(raw), { fetchImpl: f, env, rawText: raw }), false);
  paypal.resetCache();
  assert.equal(await paypal.verifyWebhook(headers, JSON.parse(raw), { fetchImpl: scripted(token, { status: 400, body: {} }), env }), false);
  // No PayPal signature headers at all: refused without even asking PayPal.
  paypal.resetCache();
  assert.equal(await paypal.verifyWebhook({}, JSON.parse(raw), { fetchImpl: scripted(), env }), false);
  // Without the webhook id we cannot verify anything: an error, never "true".
  await assert.rejects(paypal.verifyWebhook(headers, {}, { fetchImpl: scripted(), env: { ...env, PAYPAL_WEBHOOK_ID: '' } }), (e) => e.code === 'not_configured');
});

test('the environment decides live or sandbox', () => {
  assert.equal(config.paypalMode(env), 'live');
  assert.equal(config.paypalMode({ VERCEL_ENV: 'preview' }), 'sandbox');
  assert.equal(config.paypalMode({}), 'sandbox');
});
