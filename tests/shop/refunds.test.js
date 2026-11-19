// Refunds (phase 3): which payment a refund comes out of, what CiderPay and PayPal are asked and what their answers
// mean, and what ActiveCampaign is told. No network, no database.
const test = require('node:test');
const assert = require('node:assert/strict');
const refunds = require('../../api/_lib/shop/refunds.js');
const ciderpay = require('../../api/_lib/shop/pay/ciderpay.js');
const paypal = require('../../api/_lib/shop/pay/paypal.js');
const ledger = require('../../api/_lib/shop/ledger.js');

const env = {
  SHOP_SECRET: 'test-secret-test-secret-test-secret-1234', VERCEL_ENV: 'production',
  CIDERPAY_MEMBER_ID: 'merchant1', CIDERPAY_API_TOKEN: 'tok-123', PAYPAL_CLIENT_ID: 'cid', PAYPAL_SECRET: 'sec', PAYPAL_WEBHOOK_ID: 'WH-1',
};

function scripted(...answers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: typeof init.body === 'string' && init.body.trim().startsWith('{') ? JSON.parse(init.body) : init.body || null });
    const a = answers.shift();
    if (!a) throw new Error('unexpected request to ' + url);
    if (a.throw) throw new Error(a.throw);
    const text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
    return { ok: (a.status || 200) < 300, status: a.status || 200, text: async () => text, json: async () => JSON.parse(text) };
  };
  fn.calls = calls;
  return fn;
}

// ---------- which payment, how much ----------
test('what is left to refund: each payment minus every refund that isn’t failed', () => {
  const payments = [{ id: 1, kind: 'payment', amount: 220000 }, { id: 2, kind: 'refund', amount: 50000 }];
  const left = refunds.remaining(payments, [{ payment_id: 1, amount: 50000, status: 'done' }, { payment_id: 1, amount: 20000, status: 'requested' }, { payment_id: 1, amount: 99999, status: 'failed' }]);
  assert.equal(left.get(1), 150000);
  assert.equal(left.has(2), false, 'a refund row is not something to refund');
});

test('choosePayment: whole or part, never more than what is left', () => {
  const payments = [{ id: 1, kind: 'payment', amount: 220000 }];
  assert.deepEqual(refunds.choosePayment(payments, [], 220000), { payment: payments[0], left: 220000, full: true });
  assert.equal(refunds.choosePayment(payments, [], 1000).full, false);
  // After a partial refund, the rest is a partial cancel at the provider (ALL would refund the whole payment again).
  assert.equal(refunds.choosePayment(payments, [{ payment_id: 1, amount: 20000, status: 'done' }], 200000).full, false);
  assert.throws(() => refunds.choosePayment(payments, [{ payment_id: 1, amount: 20000, status: 'done' }], 200001), /more than what is left/);
  assert.throws(() => refunds.choosePayment(payments, [], 0), /more than zero/);
  assert.throws(() => refunds.choosePayment(payments, [], -5), /more than zero/);
  assert.throws(() => refunds.choosePayment(payments, [], 1.5), /more than zero/);
  assert.throws(() => refunds.choosePayment([], [], 1000), /more than what is left/);
  // Several payments (instalments, later): the amount must fit in one of them.
  const two = [{ id: 1, kind: 'payment', amount: 930000 }, { id: 2, kind: 'payment', amount: 930000 }];
  assert.equal(refunds.choosePayment(two, [], 930000).payment.id, 2, 'the latest payment first');
  assert.throws(() => refunds.choosePayment(two, [], 1000000), /No single payment/);
});

test('ActiveCampaign: full refund removes the purchase tags; partial keeps them', () => {
  const order = { id: 7, number: 100050, customer_id: 3, price_option: { key: 'vip', label: 'VIP', tag: 'nsmb_vip' } };
  const product = { slug: 'nsmb', purchase_tag: 'purchased_nsmb_03_202701', extra_tags: ['customer'] };
  const addon = { slug: 'scripts', purchase_tag: 'purchased_scripts', extra_tags: [] };
  const refund = { id: 4, amount: 3990000, currency: 'KRW', done_at: '2026-11-19T03:00:00Z' };
  const full = refunds.refundOps(order, product, [addon], refund, { full: true });
  assert.deepEqual(full.filter((o) => o.op === 'tag_add').map((o) => o.payload.tag), ['refund_nsmb_03_202701']);
  assert.deepEqual(full.filter((o) => o.op === 'tag_remove').map((o) => o.payload.tag), ['purchased_nsmb_03_202701', 'customer', 'purchased_scripts', 'nsmb_vip']);
  assert.deepEqual(full.find((o) => o.op === 'fields').payload.fields, { REFUND_AMOUNT: '₩3,990,000', REFUND_DATE: '2026-11-19' });
  const part = refunds.refundOps(order, product, [], { ...refund, amount: 1000 }, { full: false });
  assert.deepEqual(part.filter((o) => o.op !== 'fields').map((o) => [o.op, o.payload.tag]), [['tag_add', 'refund_partial_nsmb_03_202701']]);
  // Each refund is queued once (its own dedupe keys).
  assert.ok(full.every((o) => o.dedupe.startsWith('o7:refund4:')));
  assert.equal(new Set(full.map((o) => o.dedupe)).size, full.length);
  // A product whose tag doesn't start with purchased_: its slug names it.
  assert.equal(refunds.tagKey({ slug: 'eft-class', purchase_tag: 'eft_buyer' }), 'eft_class');
  assert.equal(refunds.tagKey({ slug: 'eft', purchase_tag: 'purchased_eft' }), 'eft');
});

test('the tax lines of a refund mirror its sale (negative, same VAT split, add-on rules kept)', () => {
  const order = { id: 1, currency: 'USD', plan: 'full' };
  const items = [{ amount: 229900, vat_rule: 'zero' }, { amount: 4700, vat_rule: 'taxable' }];
  const at = new Date();
  const sale = ledger.lines({ payment: { kind: 'payment', amount: 234600, provider: 'paypal', at }, order, items });
  const back = ledger.lines({ payment: { kind: 'refund', amount: 234600, provider: 'paypal', at }, order, items });
  assert.deepEqual(back.map((l) => [l.kind, l.amount, l.supply, l.vat, l.vat_rule]), sale.map((l) => ['refund', -l.amount, -l.supply, -l.vat || 0, l.vat_rule]));
  const part = ledger.lines({ payment: { kind: 'refund', amount: 1000, provider: 'paypal', at }, order, items });
  assert.equal(part.reduce((s, l) => s + l.amount, 0), -1000, 'a partial refund adds up exactly');
  assert.ok(part.every((l) => l.supply + l.vat === l.amount));
});

test('Slack message names the amount, the order, why and who', () => {
  const t = refunds.slackText({ number: 100050, product_name: '내성만방', price_option: null, billing: { name: '김지연' } }, { amount: 1000, currency: 'KRW', reason: '환불 요청', by: 'alex', origin: 'admin' }, { full: true });
  assert.match(t, /Refunded ₩1,000/);
  assert.match(t, /김지연 - 내성만방 \[100050\]/);
  assert.match(t, /Reason: 환불 요청/);
  assert.match(t, /By: alex/);
  assert.match(refunds.slackText({ number: 1, product_name: 'x', billing: {} }, { amount: 100, currency: 'USD', origin: 'provider' }, { full: false }), /Partly refunded \$1 \(made in PayPal\)/);
});

// ---------- CiderPay ----------
test('CiderPay: full cancel (ALL) and partial cancel (PART with cancelPrice), with our payment’s cancel token', () => {
  const full = ciderpay.cancelBody({ orderNo: 'CP1', refundToken: 'FT1', amount: 220000, full: true, reason: '환불 요청' }, env);
  assert.deepEqual(full, { memberID: 'merchant1', orderNo: 'CP1', token: 'FT1', rangeType: 'ALL', cancelMessage: '환불 요청' });
  const part = ciderpay.cancelBody({ orderNo: 'CP1', refundToken: 'FT1', amount: 1000, full: false, reason: 'x'.repeat(300) }, env);
  assert.equal(part.rangeType, 'PART');
  assert.equal(part.cancelPrice, 1000);
  assert.equal(part.cancelMessage.length, 100);
  assert.throws(() => ciderpay.cancelBody({ orderNo: 'CP1', refundToken: '', amount: 1000 }, env), (e) => e.code === 'unavailable');
  assert.throws(() => ciderpay.cancelBody({ orderNo: 'CP1', refundToken: 'FT1', amount: 0 }, env), (e) => e.code === 'unavailable');
});

test('CiderPay: cancel answered “done”, “settled → cancel request”, or refused', async () => {
  const args = { orderNo: 'CP1', refundToken: 'FT1', amount: 1000, full: false, reason: 'r' };
  let f = scripted({ body: { success: true } });
  assert.equal((await ciderpay.cancelPayment(args, { fetchImpl: f, env })).outcome, 'done');
  assert.equal(f.calls[0].url, 'https://api.ciderpay.com/oapi/payment/cancel');
  assert.equal(f.calls[0].headers.approvalToken, 'tok-123');
  assert.equal(f.calls.length, 1);

  f = scripted({ body: { success: false, var1: 'CANCEL_REQ' } }, { body: { success: true } });
  assert.equal((await ciderpay.cancelPayment(args, { fetchImpl: f, env })).outcome, 'requested');
  assert.equal(f.calls[1].url, 'https://api.ciderpay.com/oapi/payment/cancelRequest');
  assert.deepEqual(f.calls[1].body, f.calls[0].body, 'the cancel request carries the same fields');

  let r = await ciderpay.cancelPayment(args, { fetchImpl: scripted({ body: { success: false, errCode: '2001', message: 'ERROR_CANCEL_STATE' } }), env });
  assert.deepEqual([r.outcome, r.detail], ['refused', '2001 ERROR_CANCEL_STATE']);
  r = await ciderpay.cancelPayment(args, { fetchImpl: scripted({ body: { success: false, var1: 'CANCEL_REQ' } }, { body: { success: false, errCode: '2002', message: 'ERROR_CANCEL_TOKEN' } }), env });
  assert.deepEqual([r.outcome, r.detail], ['refused', 'cancel request: 2002 ERROR_CANCEL_TOKEN']);
  // A 4xx answer without JSON is a refusal (nothing happened); "success" must be exactly true.
  assert.equal((await ciderpay.cancelPayment(args, { fetchImpl: scripted({ status: 400, body: 'bad' }), env })).outcome, 'refused');
  assert.equal((await ciderpay.cancelPayment(args, { fetchImpl: scripted({ body: { success: 'true' } }), env })).outcome, 'refused');
});

test('CiderPay: no answer, or a server error, is “unknown” (a person checks), never “refused”', async () => {
  const args = { orderNo: 'CP1', refundToken: 'FT1', amount: 1000, full: false };
  await assert.rejects(ciderpay.cancelPayment(args, { fetchImpl: scripted({ throw: 'socket hang up' }), env }), (e) => e.code === 'unknown');
  await assert.rejects(ciderpay.cancelPayment(args, { fetchImpl: scripted({ status: 502, body: 'bad gateway' }), env }), (e) => e.code === 'unknown');
  // The cancel request after CANCEL_REQ can also go unanswered.
  await assert.rejects(ciderpay.cancelPayment(args, { fetchImpl: scripted({ body: { success: false, var1: 'CANCEL_REQ' } }, { throw: 'timeout' }), env }), (e) => e.code === 'unknown');
  await assert.rejects(ciderpay.cancelPayment(args, { fetchImpl: scripted(), env: { ...env, CIDERPAY_API_TOKEN: '' } }), (e) => e.code === 'not_configured');
});

// ---------- PayPal ----------
const token = { body: { access_token: 'A1', expires_in: 3600 } };
const refundAnswer = (status, over = {}) => ({ status: 201, body: { id: 'RF1', status, amount: { currency_code: 'USD', value: '10.00' }, custom_id: 'r4',
  seller_payable_breakdown: { paypal_fee: { currency_code: 'USD', value: '0.30' } }, links: [{ rel: 'up', href: 'https://api-m.paypal.com/v2/payments/captures/CAP9' }], ...over } });

test('PayPal: the refund names the capture, the amount in dollars, and our refund id twice (idempotency + custom_id)', async () => {
  paypal.resetCache();
  const f = scripted(token, refundAnswer('COMPLETED'));
  const r = await paypal.refundCapture({ captureId: 'CAP9', amount: 1000, currency: 'USD', key: 'r4' }, { fetchImpl: f, env });
  assert.equal(r.outcome, 'done');
  assert.deepEqual([r.refund.id, r.refund.amount, r.refund.fee, r.refund.captureId, r.refund.customId], ['RF1', 1000, 30, 'CAP9', 'r4']);
  assert.match(f.calls[1].url, /\/v2\/payments\/captures\/CAP9\/refund$/);
  assert.deepEqual(f.calls[1].body, { amount: { currency_code: 'USD', value: '10.00' }, custom_id: 'r4' });
  assert.equal(f.calls[1].headers['PayPal-Request-Id'], 'refund-r4');
});

test('PayPal: pending, refused, and no answer', async () => {
  const run = async (...answers) => { paypal.resetCache(); return paypal.refundCapture({ captureId: 'CAP9', amount: 1000, currency: 'USD', key: 'r4' }, { fetchImpl: scripted(token, ...answers), env }); };
  assert.equal((await run(refundAnswer('PENDING'))).outcome, 'requested');
  assert.deepEqual(await run({ status: 422, body: { details: [{ issue: 'REFUND_AMOUNT_EXCEEDED' }] } }), { outcome: 'refused', detail: 'REFUND_AMOUNT_EXCEEDED' });
  assert.equal((await run(refundAnswer('FAILED'))).outcome, 'refused');
  await assert.rejects(run({ status: 500, body: {} }), (e) => e.code === 'unknown');
  await assert.rejects(run({ throw: 'socket hang up' }), (e) => e.code === 'unknown');
  await assert.rejects(paypal.refundCapture({ captureId: 'CAP9', amount: 1000, currency: 'KRW', key: 'r4' }, { env }), (e) => e.code === 'unavailable');
  await assert.rejects(paypal.refundCapture({ captureId: '', amount: 1000, currency: 'USD', key: 'r4' }, { env }), (e) => e.code === 'unavailable');
});

test('PayPal: a refund webhook’s resource is read the same way (capture from the “up” link)', () => {
  const r = paypal.readRefund({ id: 'RF2', status: 'COMPLETED', amount: { currency_code: 'USD', value: '2299.00' }, links: [{ rel: 'self', href: 'x' }, { rel: 'up', href: 'https://api.paypal.com/v2/payments/captures/3C679366HH908993F' }] });
  assert.deepEqual([r.id, r.amount, r.captureId, r.customId, r.fee], ['RF2', 229900, '3C679366HH908993F', '', null]);
  assert.equal(paypal.readRefund({ id: 'RF3', amount: { value: 'abc' } }).amount, null);
});
