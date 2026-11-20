// Instalment plans: the rules (plan state, late instalments, ActiveCampaign), CiderPay's plan calls and notices
// against scripted answers, and the instalment checkout page. The database side is in tools/shop/e2e.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const plans = require('../../api/_lib/shop/instalments.js');
const ciderpay = require('../../api/_lib/shop/pay/ciderpay.js');
const orders = require('../../api/_lib/shop/orders.js');
const pricing = require('../../api/_lib/shop/pricing.js');
const page = require('../../api/_lib/shop/page.js');
const notify = require('../../api/_lib/shop/notify.js');
const products = require('../../api/_lib/admin/shop-products.js');

const env = { SHOP_SECRET: 'test-secret-test-secret-test-secret-1234', VERCEL_ENV: 'production', CIDERPAY_MEMBER_ID: 'merchant1', CIDERPAY_API_TOKEN: 'tok-123' };
const product = {
  id: 1, slug: 'nsmb', name: '내성만방 프로그램', status: 'open', price_krw: 2690000, price_usd: 229900,
  instalment_first: 930000, instalment_monthly: 930000, instalment_count: 2, usd_vat: 'taxable',
  purchase_tag: 'purchased_nsmb_03_202701', extra_tags: [], content: {},
};
const terms = { first: 930000, monthly: 930000, count: 2, day: 10 };
const order = {
  id: 7, number: 100050, token: 'abcdefghijklmnopqrstuv', currency: 'KRW', plan: 'instalment', due_today: 930000, total: 2790000,
  provider: 'ciderpay', status: 'awaiting_payment', plan_terms: terms, customer_id: 3, product_name: '내성만방 프로그램', billing: {},
};
const billing = { name: '김지연', email: 'jiyeon@example.com', phone: '+821012345678' };
const row = (number, status, due_date = '2026-12-10', amount = 930000) => ({ number, status, due_date, amount });

function scripted(...answers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const a = answers.shift();
    if (!a) throw new Error('unexpected request to ' + url);
    if (a.throw) throw new Error(a.throw);
    const text = typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
    return { ok: (a.status || 200) < 300, status: a.status || 200, text: async () => text };
  };
  fn.calls = calls;
  return fn;
}

// ---------- rules ----------
test('plan state follows the schedule; stopped and paused stay until changed', () => {
  assert.equal(plans.planStatus([row(1, 'paid'), row(2, 'due'), row(3, 'due')], 'active'), 'active');
  assert.equal(plans.planStatus([row(1, 'paid'), row(2, 'failed'), row(3, 'due')], 'active'), 'overdue');
  assert.equal(plans.planStatus([row(1, 'paid'), row(2, 'overdue'), row(3, 'due')], 'active'), 'overdue');
  assert.equal(plans.planStatus([row(1, 'paid'), row(2, 'paid'), row(3, 'due')], 'overdue'), 'active'); // paid after all
  assert.equal(plans.planStatus([row(1, 'paid'), row(2, 'paid'), row(3, 'paid')], 'overdue'), 'completed');
  assert.equal(plans.planStatus([row(1, 'paid'), row(2, 'failed'), row(3, 'due')], 'paused'), 'paused');
  assert.equal(plans.planStatus([row(1, 'paid'), row(2, 'paid'), row(3, 'paid')], 'paused'), 'completed');
  assert.equal(plans.planStatus([row(1, 'paid'), row(2, 'cancelled'), row(3, 'cancelled')], 'stopped'), 'stopped');
});

test('an instalment is late GRACE_DAYS after its date, and only while still due', () => {
  assert.equal(plans.GRACE_DAYS, 2);
  const rows = [row(1, 'paid', '2026-11-10'), row(2, 'due', '2026-12-10'), row(3, 'due', '2027-01-10')];
  assert.deepEqual(plans.lateRows(rows, '2026-12-12').map((r) => r.number), []);
  assert.deepEqual(plans.lateRows(rows, '2026-12-13').map((r) => r.number), [2]);
  assert.deepEqual(plans.lateRows(rows, '2027-01-13').map((r) => r.number), [2, 3]);
  assert.deepEqual(plans.lateRows([row(2, 'failed', '2026-12-10')], '2027-01-13'), []); // already flagged
  assert.equal(plans.addDays('2026-12-30', 3), '2027-01-02');
});

test('ActiveCampaign fields: the next instalment and what is left', () => {
  const o = { currency: 'KRW' };
  assert.deepEqual(plans.planFields(o, [row(1, 'paid', '2026-11-10'), row(2, 'failed', '2026-12-10'), row(3, 'due', '2027-01-10')]),
    { INSTALMENT_NEXT_DATE: '2026-12-10', INSTALMENT_NEXT_AMOUNT: '₩930,000', INSTALMENT_REMAINING: '₩1,860,000' });
  assert.deepEqual(plans.planFields(o, [row(1, 'paid'), row(2, 'paid'), row(3, 'cancelled')]),
    { INSTALMENT_NEXT_DATE: '', INSTALMENT_NEXT_AMOUNT: '', INSTALMENT_REMAINING: '' });
});

test('ActiveCampaign tags of each plan event (named after the purchase tag), each queued once', () => {
  const o = { id: 7, currency: 'KRW' };
  const rows = [row(1, 'paid'), row(2, 'due'), row(3, 'due')];
  const tags = (event, extra) => plans.planOps(o, product, event, { rows, ...extra }).filter((x) => x.op !== 'fields').map((x) => `${x.op === 'tag_add' ? '+' : '-'}${x.payload.tag}`);
  assert.deepEqual(tags('started'), ['+instalment_active_nsmb_03_202701']);
  assert.deepEqual(tags('paid', { number: 2 }), ['-instalment_failed_nsmb_03_202701', '+instalment_paid_nsmb_03_202701_2']);
  assert.deepEqual(tags('completed'), ['-instalment_failed_nsmb_03_202701', '-instalment_active_nsmb_03_202701', '+instalment_completed_nsmb_03_202701']);
  assert.deepEqual(tags('failed', { number: 2 }), ['+instalment_failed_nsmb_03_202701']);
  assert.deepEqual(tags('stopped'), ['-instalment_active_nsmb_03_202701', '+cancelled_nsmb_03_202701']);
  // Fields first (an automation started by the tag finds them), and keys that differ per instalment.
  const two = plans.planOps(o, product, 'failed', { number: 2, rows });
  const three = plans.planOps(o, product, 'failed', { number: 3, rows });
  assert.equal(two[0].op, 'fields');
  assert.notEqual(two[1].dedupe, three[1].dedupe);
  const keys = ['started', 'paid', 'completed', 'failed', 'stopped'].flatMap((e) => plans.planOps(o, product, e, { number: 2, rows }).map((x) => x.dedupe));
  assert.equal(new Set(keys).size, keys.length);
});

test('which instalment a charge is for: turnSeq 0 is the first; without it, the earliest unpaid of that amount', () => {
  const rows = [row(1, 'paid', '', 500000), row(2, 'due', '', 300000), row(3, 'due', '', 300000)];
  assert.equal(plans.numberFor({ turnSeq: 0 }, rows), 1);
  assert.equal(plans.numberFor({ turnSeq: 2 }, rows), 3);
  assert.equal(plans.numberFor({ turnSeq: null, amount: 300000 }, rows), 2);
  assert.equal(plans.numberFor({ turnSeq: null, amount: 1234 }, rows), null);
});

test('an order’s plan: its terms and schedule, from the quote', () => {
  const q = pricing.quote(product, { currency: 'KRW', plan: 'instalment' });
  assert.deepEqual(orders.planTerms(q, '2026-11-10'), { first: 930000, monthly: 930000, count: 2, day: 10 });
  assert.equal(orders.planTerms(pricing.quote(product, { currency: 'KRW' }), '2026-11-10'), null);
  assert.deepEqual(orders.planRows(orders.planTerms(q, '2026-12-31'), '2026-12-31'),
    [{ number: 1, due_date: '2026-12-31', amount: 930000 }, { number: 2, due_date: '2027-01-30', amount: 930000 }, { number: 3, due_date: '2027-02-28', amount: 930000 }]);
  // Paid after midnight: the first date is the day paid, then the billing day agreed with CiderPay.
  assert.deepEqual(orders.planRows({ ...terms, day: 10 }, '2026-11-11').map((r) => r.due_date), ['2026-11-11', '2026-12-10', '2027-01-10']);
  // With a coupon: the first payment absorbs the rounding.
  const d = pricing.quote({ ...product, instalment_first: 500000, instalment_monthly: 300000, instalment_count: 3 }, { currency: 'KRW', plan: 'instalment', discount: 100000 });
  assert.deepEqual(orders.planTerms(d, '2026-11-10'), { first: 464287, monthly: 278571, count: 3, day: 10 });
});

test('offers: the instalment plan only when the shop sells plans', () => {
  assert.deepEqual(orders.offers(product).map((o) => o.plan), ['full', 'full']);
  assert.deepEqual(orders.offers(product, undefined, { instalments: true }).map((o) => `${o.currency} ${o.plan}`), ['KRW full', 'KRW instalment', 'USD full']);
  assert.deepEqual(orders.offers(product, ['paypal'], { instalments: true }).map((o) => o.plan), ['full']);
});

// ---------- CiderPay ----------
test('CiderPay plan request: first payment now, then monthly on the billing day, ending 7 days after the last', () => {
  const req = ciderpay.planRequest({ order, productName: '내성만방 프로그램', billing, terms, start: '2026-11-10' }, env);
  assert.deepEqual(req, {
    memberID: 'merchant1', customName: '김지연', customMobile: '01012345678', customEmail: 'jiyeon@example.com',
    goodName: '내성만방 프로그램 [100050]', price: 930000, limitDateStr: '2027-01-17',
    returnUrl: 'https://www.ashleylim.com/checkout/complete?o=abcdefghijklmnopqrstuv',
    feedbackUrl: req.feedbackUrl, var1: order.token, var2: ciderpay.signature(order, env),
    payFeedbackUrl: req.feedbackUrl, payVar1: order.token, payVar2: ciderpay.signature(order, env),
    periodDateType: 'MONTH', periodDateVal: '10', firstBillingType: 'MUST_FIRST_PAYMENT', firstPrice: 930000, taxType: 'TAX',
  });
  assert.ok(req.feedbackUrl.startsWith('https://www.ashleylim.com/api/shop-callback?p=ciderpay&k='));
  assert.equal(ciderpay.localMobile('+821012345678'), '01012345678');
  assert.equal(ciderpay.localMobile('010-1234-5678'), '01012345678');
  assert.equal(ciderpay.localMobile('+82 010 1234 5678'), '01012345678');
  assert.throws(() => ciderpay.planRequest({ order: { ...order, plan: 'full' }, productName: 'x', billing, terms, start: '2026-11-10' }, env), (e) => e.code === 'unavailable');
  assert.throws(() => ciderpay.planRequest({ order, productName: 'x', billing: { ...billing, phone: '' }, terms, start: '2026-11-10' }, env), (e) => e.code === 'unavailable');
  assert.throws(() => ciderpay.planRequest({ order, productName: 'x', billing, terms: { ...terms, monthly: 999 }, start: '2026-11-10' }, env), (e) => e.code === 'unavailable');
});

test('CiderPay plan request: developer headers, and the page comes back in var1', async () => {
  const f = scripted({ body: { success: true, var1: 'https://pay.ciderpay.com/rp/XYZ', var2: 'U9' } });
  const r = await ciderpay.requestPlan({ order, productName: 'NSMB', billing, terms, start: '2026-11-10' }, { fetchImpl: f, env });
  assert.deepEqual(r, { payUrl: 'https://pay.ciderpay.com/rp/XYZ', payUniqueNo: 'U9' });
  assert.equal(f.calls[0].url, 'https://api.ciderpay.com/oapi/regularPay/request');
  assert.equal(f.calls[0].headers.devID, 'merchant1');
  assert.equal(f.calls[0].headers.devToken, 'tok-123');
  assert.equal(JSON.parse(f.calls[0].body).firstBillingType, 'MUST_FIRST_PAYMENT');
  // Separate developer credentials, if CiderPay ever gives them.
  const g = scripted({ body: { success: true, var1: 'https://pay.ciderpay.com/rp/1', var2: 'U1' } });
  await ciderpay.requestPlan({ order, productName: 'NSMB', billing, terms, start: '2026-11-10' }, { fetchImpl: g, env: { ...env, CIDERPAY_DEV_ID: 'dev7', CIDERPAY_DEV_TOKEN: 'dtok' } });
  assert.equal(g.calls[0].headers.devID, 'dev7');
  assert.equal(g.calls[0].headers.devToken, 'dtok');
  for (const bad of [{ body: { success: false, errCode: '1001', message: '필수 필드 에러' } }, { body: { success: true, var1: 'https://evil.example.com/x' } }, { status: 500, body: 'down' }, { throw: 'ECONNRESET' }]) {
    await assert.rejects(ciderpay.requestPlan({ order, productName: 'NSMB', billing, terms, start: '2026-11-10' }, { fetchImpl: scripted(bad), env }), (e) => e.code === 'provider');
  }
});

test('CiderPay plan pause / resume / end', async () => {
  const f = scripted({ body: { success: true } }, { body: { success: true } }, { body: { success: true } }, { body: { success: false, errCode: '3002', message: '토큰 에러' } }, { status: 503, body: 'down' });
  assert.equal((await ciderpay.planAction('pause', 'RP1', { fetchImpl: f, env })).ok, true);
  assert.equal(f.calls[0].url, 'https://api.ciderpay.com/oapi/regularPay/pauseAct');
  assert.equal(f.calls[0].headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(f.calls[0].body, 'rpToken=RP1&memberID=merchant1');
  assert.equal((await ciderpay.planAction('resume', 'RP1', { fetchImpl: f, env })).ok, true);
  assert.equal(f.calls[1].url, 'https://api.ciderpay.com/oapi/regularPay/unpauseAct');
  assert.equal((await ciderpay.planAction('end', 'RP/1', { fetchImpl: f, env })).ok, true);
  assert.equal(f.calls[2].method, 'DELETE');
  assert.equal(f.calls[2].url, 'https://api.ciderpay.com/oapi/regularPay/destroyMp/merchant1/RP%2F1');
  assert.deepEqual(await ciderpay.planAction('end', 'RP1', { fetchImpl: f, env }).then((r) => [r.ok, r.detail]), [false, '3002 토큰 에러']);
  await assert.rejects(ciderpay.planAction('end', 'RP1', { fetchImpl: f, env }), (e) => e.code === 'unknown');
  assert.equal((await ciderpay.planAction('end', '', { env })).ok, false);
});

test('CiderPay plan notices: read into one shape; the command wins over paymentState', () => {
  const n = ciderpay.readNotice(ciderpay.parseBody('cmd=completeRpPayment&paymentState=COMPLETE&memberID=merchant1&var1=abcdefghijklmnopqrstuv&var2=s&price=930000&rpToken=RP1&turnSeq=1&orderNo=CP9&feedbackToken=FT9&cardNum=1234-****-****-5678&csturl=https%3A%2F%2Fr.example.com%2F1'));
  assert.equal(n.kind, 'recurring');
  assert.equal(n.cmd, 'completeRpPayment');
  assert.deepEqual([n.amount, n.rpToken, n.turnSeq, n.orderNo, n.refundToken, n.last4], [930000, 'RP1', 1, 'CP9', 'FT9', '5678']);
  const e = ciderpay.readNotice({ cmd: 'errorRpPayment', turnSeq: 'x', errorMessage: '잔액 부족' });
  assert.deepEqual([e.turnSeq, e.errorMessage], [null, '잔액 부족']);
  assert.equal(ciderpay.readNotice({ cmd: 'agreeRegularPayment', last4: '4321' }).last4, '4321');
});

test('CiderPay plan notices: believed only with our token and signature (or the plan’s own token)', () => {
  const good = { cmd: 'completeRpPayment', memberId: 'merchant1', token: order.token, signature: ciderpay.signature(order, env), rpToken: 'RP1', orderNo: 'CP1' };
  assert.equal(ciderpay.planNoticeProblem(good, order, env), null);
  assert.equal(ciderpay.planNoticeProblem({ ...good, memberId: 'other' }, order, env), 'another merchant id');
  assert.equal(ciderpay.planNoticeProblem({ ...good, signature: 'x'.repeat(32) }, order, env), 'bad signature');
  assert.equal(ciderpay.planNoticeProblem({ ...good, orderNo: '' }, order, env), 'no CiderPay order number');
  assert.equal(ciderpay.planNoticeProblem({ ...good, cmd: 'errorRpPayment', orderNo: '' }, order, env), null);
  // Without var1/var2: the plan token learned from a checked agreement notice identifies it.
  const bare = { ...good, token: '', signature: '' };
  assert.equal(ciderpay.planNoticeProblem(bare, order, env), 'no token, and the plan token does not match');
  assert.equal(ciderpay.planNoticeProblem(bare, { ...order, rp_token: 'RP1' }, env), null);
  assert.equal(ciderpay.planNoticeProblem({ ...bare, rpToken: 'RP2' }, { ...order, rp_token: 'RP1' }, env), 'no token, and the plan token does not match');
  assert.equal(ciderpay.planNoticeProblem({ ...good, rpToken: 'RP2' }, { ...order, rp_token: 'RP1' }, env), 'another plan token');
});

// ---------- pages, Slack, settings ----------
const instOffers = orders.offers(product, undefined, { instalments: true });
const dataOf = (html) => JSON.parse(/<script type="application\/json" id="co-data">([\s\S]*?)<\/script>/.exec(html)[1]);

test('the instalment checkout: card only, today and each month, a link back to paying in full', () => {
  const html = page.checkoutPage({ product, offers: instOffers, currency: 'KRW', plan: 'instalment', query: { utm_source: 'ig' } });
  assert.match(html, /<input type="hidden" name="plan" value="instalment">/);
  assert.doesNotMatch(html, /co-method-paypal/);
  assert.match(html, /신용\/체크카드 · 분할 결제/);
  assert.match(html, /오늘 결제<\/dt><dd>₩930,000/);
  assert.match(html, /이후 매월 \d+일 · 2회<\/dt><dd>₩930,000씩/);
  assert.match(html, /data-total>₩2,790,000</);
  assert.match(html, /₩930,000 결제하기 →/);
  assert.match(html, /href="\/checkout\/nsmb\?utm_source=ig">일시불로 결제하기/);
  assert.match(html, /<input type="hidden" name="plan" value="instalment"><\/form>|name="plan" value="instalment">\s*<input type="hidden" name="utm_source"/);
  const d = dataOf(html);
  assert.equal(d.plan, 'instalment');
  assert.equal(d.planTotal, 2790000);
  assert.deepEqual(d.addons, []);
});

test('the pay-in-full checkout offers the plan under the card (only when plans are sold)', () => {
  const html = page.checkoutPage({ product, offers: instOffers, currency: 'KRW' });
  assert.match(html, /분할 결제도 가능해요/);
  assert.match(html, /오늘 ₩930,000, 이후 매월 ₩930,000씩 2회/);
  assert.match(html, /href="\/checkout\/nsmb\?plan=instalment">분할 결제로 신청하기 →/);
  assert.match(html, /class="co-plan-offer" data-cur="KRW">/);
  assert.match(page.checkoutPage({ product, offers: instOffers, currency: 'USD' }), /class="co-plan-offer" data-cur="KRW" hidden>/);
  assert.doesNotMatch(page.checkoutPage({ product, offers: orders.offers(product), currency: 'KRW' }), /co-plan-offer/);
  // ?plan=instalment while plans aren't sold: the usual checkout.
  assert.match(page.checkoutPage({ product, offers: orders.offers(product), currency: 'KRW', plan: 'instalment' }), /name="plan" value="full"/);
});

test('the instalment checkout with a coupon: the discount spread over every payment', () => {
  const p = { ...product, instalment_first: 500000, instalment_monthly: 300000, instalment_count: 3 };
  const html = page.checkoutPage({ product: p, offers: orders.offers(p, undefined, { instalments: true }), currency: 'KRW', plan: 'instalment', coupon: { code: 'SAVE', off: { '': { KRW: 1, USD: 1 } }, planOff: 100000 } });
  assert.match(html, /오늘 결제<\/dt><dd>₩464,287/);
  assert.match(html, /₩278,571씩/);
  assert.match(html, /data-total>₩1,300,000</);
  assert.deepEqual(dataOf(html).coupon, { code: 'SAVE', off: { '': { KRW: 100000 } } });
  // A code that can't lower the plan: shown as not applying, nothing taken off.
  const no = page.checkoutPage({ product: p, offers: orders.offers(p, undefined, { instalments: true }), currency: 'KRW', plan: 'instalment', coupon: { code: 'SAVE', off: {}, planOff: null } });
  assert.match(no, /data-total>₩1,400,000</);
});

test('thank-you page of a plan: the next payment', () => {
  const paid = { ...order, status: 'paid', paid_at: '2026-11-10T03:00:00Z', plan_status: 'active', billing: { name: '김지연' } };
  const html = page.completePage({ order: paid, product, plan: [row(1, 'paid', '2026-11-10'), row(2, 'due', '2026-12-10'), row(3, 'due', '2027-01-10')] });
  assert.match(html, /다음 결제<\/dt><dd>2026년 12월 10일 ₩930,000 \(남은 결제 2회\)/);
});

test('Slack: an instalment names its number', () => {
  const o = { ...order, number: 100050, billing: { name: '김지연' } };
  assert.match(notify.paidText(o, '신한카드'), /Paid ₩930,000 🎉 \(신한카드\)\n김지연 - 내성만방 프로그램 \[100050\] — instalment 1 of 3$/);
  assert.match(notify.paidText(o, '', [], { amount: 930000, suffix: ' — instalment 3 of 3, all paid ✅' }), /\[100050\] — instalment 3 of 3, all paid ✅$/);
});

test('settings: selling instalment plans is off unless ticked', () => {
  assert.deepEqual(products.settingsInput({}).instalments, { enabled: false });
  assert.deepEqual(products.settingsInput({ instalments: { enabled: 'yes' } }).instalments, { enabled: false });
  assert.deepEqual(products.settingsInput({ instalments: { enabled: true } }).instalments, { enabled: true });
});
