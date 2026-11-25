const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../../api/_lib/shop/sync.js');
const abandoned = require('../../api/_lib/shop/abandoned.js');
const referrals = require('../../api/_lib/shop/referrals.js');
const products = require('../../api/_lib/admin/shop-products.js');

const nsmb = { id: 4, slug: 'nsmb', purchase_tag: 'purchased_nsmb_03_202701' };
const order = { id: 9, currency: 'KRW', paid_total: 930000, due_today: 930000, referrer_id: null };

test('every paid order: what it paid so far, the /my link, what the customer spent in all', () => {
  const ops = sync.customerOps(order, nsmb, { spent: { KRW: 1150000, USD: 21900 }, orders: 2 }, { base: 'https://www.ashleylim.com' });
  assert.deepEqual(ops.map((o) => o.op), ['fields']);
  assert.deepEqual(ops[0].payload.fields, { ORDER_PAID_TOTAL: '₩930,000', MY_ORDERS_LINK: 'https://www.ashleylim.com/my', CUSTOMER_TOTAL_SPENT: '₩1,150,000 + $219', CUSTOMER_ORDER_COUNT: '2' });
  assert.deepEqual(Object.keys(ops[0].payload.fields), sync.CUSTOMER_FIELDS);
  assert.equal(ops[0].dedupe, 'o9:fields:customer');
});

test('a purchase removes the abandoned-checkout tag (when it was added) and marks a referred customer', () => {
  const ops = sync.customerOps({ ...order, referrer_id: 3 }, nsmb, { spent: { KRW: 930000 }, orders: 1 }, { abandoned: true });
  assert.deepEqual(ops.slice(1).map((o) => `${o.op}:${o.payload.tag}`), ['tag_remove:checkout_abandoned_nsmb_03_202701', 'tag_add:referred_customer']);
  assert.equal(new Set(ops.map((o) => o.dedupe)).size, ops.length);
});

test('an abandoned checkout: the link to its checkout first, then the tag, once per 30-day window', () => {
  const ops = abandoned.ops({ customer_id: 7 }, nsmb, { base: 'https://www.ashleylim.com', stamp: abandoned.windowOf('2026-11-24T01:00:00Z') });
  assert.deepEqual(ops.map((o) => o.op), ['fields', 'tag_add']);
  assert.deepEqual(ops[0].payload.fields, { CHECKOUT_LINK: 'https://www.ashleylim.com/checkout/nsmb' });
  assert.equal(ops[1].payload.tag, 'checkout_abandoned_nsmb_03_202701');
  assert.ok(ops[1].dedupe.startsWith('abandon:c7:p4:'));
  assert.equal(abandoned.windowOf('2026-11-24T01:00:00Z'), abandoned.windowOf('2026-11-24T23:00:00Z'));
  assert.notEqual(abandoned.windowOf('2026-11-24T01:00:00Z'), abandoned.windowOf('2027-01-10T01:00:00Z'));
});

test('referrals: a new referrer, a friend’s sale, an approved reward (tags removed first so automations start again)', () => {
  const env = { SHOP_PUBLIC_URL: 'https://www.ashleylim.com' };
  const r = referrals.referrerOps({ id: 3, code: 'K7MD-Q2XP' }, env);
  assert.deepEqual(r[0].payload.fields, { REFERRAL_LINK: 'https://www.ashleylim.com/r/K7MD-Q2XP', REFERRAL_CODE: 'K7MD-Q2XP' });
  assert.deepEqual(r[1].payload, { tag: 'referrer' });
  assert.deepEqual(referrals.saleOps({ id: 12 }).map((o) => `${o.op}:${o.payload.tag}`), ['tag_remove:referral_sale', 'tag_add:referral_sale']);
  const a = referrals.approvedOps(5, { KRW: 19800, USD: 0 });
  assert.deepEqual(a[0].payload.fields, { REFERRAL_BALANCE: '₩19,800' });
  assert.deepEqual(a.slice(1).map((o) => `${o.op}:${o.payload.tag}`), ['tag_remove:referral_reward_approved', 'tag_add:referral_reward_approved']);
  assert.equal(new Set(a.map((o) => o.dedupe)).size, 3);
});

test('Settings: abandoned checkouts are off unless ticked', () => {
  assert.deepEqual(products.settingsInput({}).abandoned, { enabled: false });
  assert.deepEqual(products.settingsInput({ abandoned: { enabled: true } }).abandoned, { enabled: true });
});
