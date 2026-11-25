const test = require('node:test');
const assert = require('node:assert/strict');
const my = require('../../api/_lib/shop/my.js');
const { myPage, day } = require('../../api/_lib/shop/my-page.js');
const { safeNext } = require('../../api/learn.js');

const planOrder = (over = {}) => ({
  id: 7, number: 100123, product_name: '내성만방 프로그램', plan: 'instalment', plan_status: 'overdue', currency: 'KRW', status: 'paid',
  total: 2790000, discount: 0, paid_total: 930000, refunded_total: 0, paid_at: '2026-11-20T03:00:00Z', created_at: '2026-11-20T02:58:00Z', rp_card: '1234', ...over,
});
const rows = (s2 = 'failed', s3 = 'due') => [
  { number: 1, due_date: '2026-11-20', amount: 930000, status: 'paid' },
  { number: 2, due_date: '2026-12-20', amount: 930000, status: s2 },
  { number: 3, due_date: '2027-01-20', amount: 930000, status: s3 },
];

test('an order paid in full: facts, add-ons only when there are some, https receipts only', () => {
  const order = { id: 1, number: 100001, product_name: 'EFT', plan: 'full', currency: 'KRW', status: 'paid', total: 220000, paid_total: 220000, refunded_total: 0, paid_at: '2026-11-01T01:00:00Z' };
  const v = my.view({ order, items: [{ name: 'EFT', amount: 220000 }], payments: [{ at: order.paid_at, amount: 220000, receipt_url: 'https://pay.example/r/1' }, { at: order.paid_at, amount: 1, receipt_url: 'javascript:alert(1)' }] });
  assert.deepEqual([v.number, v.total, v.paid, v.plan, v.items, v.schedule, v.planInfo], [100001, 220000, 220000, 'full', [], null, null]);
  assert.deepEqual(v.payments.map((p) => p.receipt), ['https://pay.example/r/1', '']);
  const withAddon = my.view({ order, items: [{ name: 'EFT', amount: 200000 }, { name: '워크북', amount: 20000 }] });
  assert.equal(withAddon.items.length, 2);
  assert.equal(my.view({ order: { ...order, price_option: { key: 'vip', label: 'VIP' } } }).option, 'VIP');
});

test('an instalment plan: next charge, what is left, and which missed instalments the customer may pay', () => {
  const v = my.view({ order: planOrder(), instalments: rows() });
  assert.equal(v.plan, 'instalment');
  assert.deepEqual(v.planInfo, { status: 'overdue', card: '1234', count: 3, next: { due: '2027-01-20', amount: 930000 }, left: 1860000, paidCount: 1 });
  assert.deepEqual(v.schedule.map((r) => r.payable), [false, true, false]);
  assert.deepEqual(my.missed([v]).map((m) => [m.order, m.number, m.amount, m.count]), [[7, 2, 930000, 3]]);
  // overdue (no notice from CiderPay) counts as missed too
  assert.deepEqual(my.view({ order: planOrder(), instalments: rows('overdue') }).schedule.map((r) => r.payable), [false, true, false]);
});

test('nothing to pay from /my when the plan is paused, stopped, completed, or in dollars', () => {
  for (const plan_status of ['paused', 'stopped', 'completed']) {
    const v = my.view({ order: planOrder({ plan_status }), instalments: rows() });
    assert.equal(my.missed([v]).length, 0, plan_status);
  }
  assert.equal(my.missed([my.view({ order: planOrder({ currency: 'USD' }), instalments: rows() })]).length, 0);
  assert.equal(my.view({ order: planOrder({ plan_status: 'stopped' }), instalments: rows('cancelled', 'cancelled') }).planInfo.next, null);
  const done = my.view({ order: planOrder({ plan_status: 'completed' }), instalments: rows('paid', 'paid') });
  assert.deepEqual([done.planInfo.next, done.planInfo.left, done.planInfo.paidCount], [null, 0, 3]);
});

test('the page: escaped, no tags, the missed instalment button posts to /my/pay', () => {
  const v = my.view({ order: planOrder({ product_name: '<script>x</script>' }), instalments: rows(), payments: [{ at: '2026-11-20T03:00:00Z', amount: 930000, instalment_no: 1, receipt_url: 'https://pay.example/r/2' }] });
  const html = myPage({ student: { name: '<b>지연</b>' }, orders: [v], missed: my.missed([v]) });
  assert.ok(!html.includes('<script>x') && html.includes('&lt;script&gt;x'));
  assert.ok(!html.includes('<b>지연') && html.includes('&lt;b&gt;지연'));
  assert.ok(!/googletagmanager|_vercel\/insights/.test(html));
  assert.ok(html.includes('action="/my/pay"') && html.includes('name="order" value="7"') && html.includes('name="i" value="2"'));
  assert.ok(html.includes('₩930,000 결제하기') && html.includes('3회 중 2회차') && html.includes('카드 끝자리 1234'));
  assert.ok(html.includes('분할 결제 3회') && html.includes('결제한 금액') && !html.includes('일시불'));
  assert.ok(html.includes('href="https://pay.example/r/2"') && html.includes('2027년 1월 20일'));
  assert.ok(html.includes('/assets/css/pages/my.css') && html.includes('noindex'));
  assert.equal((html.match(/<h1/g) || []).length, 1);
});

test('the page with no orders, and the message when a missed instalment can no longer be paid here', () => {
  const html = myPage({ student: { name: '' }, orders: [], missed: [], problem: 'pay' });
  assert.ok(html.includes('이 이메일로 결제한 주문이 아직 없어요') && html.includes('role="alert"') && !html.includes('/my/pay'));
});

test('dates are Seoul dates', () => {
  assert.equal(day('2026-12-20'), '2026년 12월 20일');
  assert.equal(day('2026-11-30T16:00:00Z'), '2026년 12월 1일'); // 01:00 in Seoul
});

test('after sign-in, only the student area or /my may be the next page', () => {
  assert.equal(safeNext('/my'), '/my');
  assert.equal(safeNext('/learn/abc?e=1'), '/learn/abc?e=1');
  for (const bad of ['//evil.example', 'https://evil.example', '/my//evil', '/mystery', '/admin']) assert.equal(safeNext(bad), '', bad);
});
