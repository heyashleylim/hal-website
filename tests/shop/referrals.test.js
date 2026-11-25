const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../../api/_lib/shop/referrals.js');
const { myPage } = require('../../api/_lib/shop/my-page.js');
const products = require('../../api/_lib/admin/shop-products.js');

const DAY = 24 * 60 * 60 * 1000;

test('the reward rule of a product, per currency', () => {
  assert.equal(r.ruleOf({}, 'KRW'), null);
  assert.deepEqual(r.ruleOf({ reward_kind: 'percent', reward_percent: 10 }, 'USD'), { kind: 'percent', percent: 10 });
  const fixed = { reward_kind: 'amount', reward_krw: 50000, reward_usd: null };
  assert.deepEqual(r.ruleOf(fixed, 'KRW'), { kind: 'amount', amount: 50000 });
  assert.equal(r.ruleOf(fixed, 'USD'), null);
});

test('what an order and each payment earn (rounded down, never more than the money)', () => {
  const ten = { kind: 'percent', percent: 10 };
  assert.equal(r.orderReward(ten, 2690000), 269000);
  assert.equal(r.orderReward(ten, 21999), 2199);
  assert.equal(r.orderReward({ kind: 'amount', amount: 50000 }, 30000), 30000);
  assert.equal(r.orderReward(null, 100000), 0);
  // instalments: the reward follows the money received
  assert.equal(r.paymentReward(ten, 2790000, 930000), 93000);
  assert.equal(r.paymentReward({ kind: 'amount', amount: 100000 }, 2790000, 930000), 33333);
});

const order = (over = {}) => ({ total: 2790000, paid_total: 930000, refunded_total: 0, status: 'paid', referral_reward: { kind: 'percent', percent: 10 }, ...over });
const pay = (id, amount, at = '2026-11-21T03:00:00Z') => ({ id, amount, at });

test('a new payment adds a pending reward, approved 14 days later', () => {
  const plan = r.reconcilePlan(order(), [pay(1, 930000)], []);
  assert.equal(plan.add.length, 1);
  assert.deepEqual([plan.add[0].payment_id, plan.add[0].amount, plan.add[0].earned], [1, 93000, 93000]);
  assert.equal(plan.add[0].approve_after.getTime(), Date.parse('2026-11-21T03:00:00Z') + 14 * DAY);
  assert.deepEqual(plan.change, []);
  // nothing changes once it is there
  const again = r.reconcilePlan(order(), [pay(1, 930000)], [{ id: 9, payment_id: 1, amount: 93000, earned: 93000, status: 'pending', approve_after: plan.add[0].approve_after }]);
  assert.deepEqual([again.add, again.change], [[], []]);
});

test('a partial refund lowers the newest pending reward; a full refund cancels everything', () => {
  const full = { total: 220000, paid_total: 220000, referral_reward: { kind: 'percent', percent: 10 } };
  const rewards = [{ id: 5, payment_id: 1, amount: 22000, earned: 22000, status: 'pending', approve_after: new Date() }];
  const half = r.reconcilePlan({ ...full, refunded_total: 110000 }, [pay(1, 220000)], rewards);
  assert.deepEqual(half.change, [{ id: 5, amount: 11000, status: 'pending' }]);
  const all = r.reconcilePlan({ ...full, refunded_total: 220000, status: 'refunded' }, [pay(1, 220000)], rewards);
  assert.deepEqual(all.change, [{ id: 5, amount: 0, status: 'cancelled' }]);
  // pending ones are lowered before approved ones
  const two = [
    { id: 1, payment_id: 1, amount: 93000, earned: 93000, status: 'approved', approve_after: new Date('2026-12-05') },
    { id: 2, payment_id: 2, amount: 93000, earned: 93000, status: 'pending', approve_after: new Date('2027-01-04') },
  ];
  const p = r.reconcilePlan(order({ paid_total: 1860000, refunded_total: 930000 }), [pay(1, 930000), pay(2, 930000)], two);
  assert.deepEqual(p.change, [{ id: 2, amount: 0, status: 'cancelled' }]);
});

test('an order without a reward rule earns nothing (a reward of 0 is cancelled at once)', () => {
  const plan = r.reconcilePlan(order({ referral_reward: null }), [pay(1, 930000)], []);
  assert.deepEqual([plan.add.length, plan.add[0].amount, plan.add[0].cancelled, plan.owed], [1, 0, true, 0]);
});

test('no self-referral: same email (any case) or same phone (+82 or 0)', () => {
  const ref = { email: 'Jiyeon@Example.com', phone: '010-1234-5678' };
  assert.equal(r.isSelf(ref, { email: 'jiyeon@example.com', phone: '' }), true);
  assert.equal(r.isSelf(ref, { email: 'friend@example.com', phone: '+82 10 1234 5678' }), true);
  assert.equal(r.isSelf(ref, { email: 'friend@example.com', phone: '010-9999-0000' }), false);
  assert.equal(r.isSelf({ email: 'a@x.com', phone: '' }, { email: 'b@x.com', phone: '' }), false);
});

test('where a referral link lands, and its cookie', () => {
  assert.equal(r.landing(null), '/');
  assert.equal(r.landing({ slug: 'eft', content: { page: '/eft' } }), '/eft');
  assert.equal(r.landing({ slug: 'eft', content: { page: 'https://evil.example' } }), '/checkout/eft');
  assert.equal(r.landing({ slug: 'eft', content: { page: '//evil.example' } }), '/checkout/eft');
  const c = r.cookieHeader('K7MD-Q2XP');
  assert.ok(c.startsWith('hal_ref=K7MD-Q2XP;') && /Max-Age=2592000/.test(c) && /HttpOnly/.test(c) && /SameSite=Lax/.test(c));
  assert.equal(r.codeFromRequest({ headers: { cookie: 'a=1; hal_ref=k7md-q2xp' } }), 'K7MD-Q2XP');
  assert.equal(r.codeFromRequest({ headers: { cookie: 'hal_ref=<script>' } }), '');
});

test('the product form takes no reward, a percentage, or fixed amounts', () => {
  const base = { name: 'EFT', slug: 'eft-x', status: 'open', price_krw: '220000', purchase_tag: 'purchased_eft', content: {} };
  const none = products.productInput(base);
  assert.deepEqual([none.reward_kind, none.reward_percent, none.reward_krw, none.reward_usd], [null, null, null, null]);
  assert.equal(products.productInput({ ...base, reward_kind: 'percent', reward_percent: '10' }).reward_percent, 10);
  assert.throws(() => products.productInput({ ...base, reward_kind: 'percent', reward_percent: '80' }), /1 and 50/);
  const fixed = products.productInput({ ...base, reward_kind: 'amount', reward_krw: '50000', reward_usd: '40' });
  assert.deepEqual([fixed.reward_krw, fixed.reward_usd], [50000, 4000]);
  assert.throws(() => products.productInput({ ...base, reward_kind: 'amount' }), /won, in dollars/);
});

test('/my shows the referral link and numbers, escaped', () => {
  const html = myPage({ student: { name: '' }, orders: [], missed: [], referral: { code: 'K7MD-Q2XP', link: 'https://www.ashleylim.com/r/K7MD-Q2XP', clicks: 3, orders: 1, rewards: { KRW: { pending: 22000, approved: 0, cancelled: 0 } } } });
  assert.ok(html.includes('친구 추천') && html.includes('value="https://www.ashleylim.com/r/K7MD-Q2XP"') && html.includes('₩22,000') && html.includes('K7MD-Q2XP'));
  assert.ok(!myPage({ student: {}, orders: [], missed: [], referral: null }).includes('친구 추천'));
});
