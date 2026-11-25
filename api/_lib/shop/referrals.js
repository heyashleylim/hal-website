/*
 * Referral program, first part (docs/commerce-plan.md 3.5, section 17; migration 020).
 *
 *   - Every customer with a paid order gets a personal code, shared as /r/<code> (shown in /my, written to
 *     ActiveCampaign as REFERRAL_LINK). Opening it remembers the code for 30 days (cookie hal_ref) and the checkout
 *     applies it like a coupon; it can also be typed in the coupon field.
 *   - The friend's discount is the coupon campaign marked `referral` (its discount, products, dates, uses per person).
 *     One code per order, so a referral and a coupon never add up: the buyer uses one or the other.
 *   - The referrer earns, per product (shop_products.reward_*), a percentage of the money received or a fixed amount
 *     per order, one reward per payment (instalments: as the money comes in). pending for the refund window
 *     (14 days), then approved; a refund lowers or cancels it. Paying rewards out (cash or credit) waits for the
 *     accountant (O2): nothing here pays anything.
 *   - Guard rails: no self-referral (same email or phone as the referrer), a paused or banned referrer's code stops
 *     working, rewards only on money actually received.
 *
 * Pure rules first (unit-tested in tests/shop/referrals.test.js), then the database.
 */
const db = require('../db.js');
const config = require('./config.js');
const coupons = require('./coupons.js');
const sync = require('./sync.js');
const pricing = require('./pricing.js');

const WINDOW_DAYS = 14;          // the refund window: a reward is approved once it has passed
const COOKIE = 'hal_ref';
const COOKIE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

// ---------- rules (pure) ----------

// The reward rule of `product` for an order in `currency`, as stored on the order: { kind, percent } | { kind, amount } | null.
function ruleOf(product, currency) {
  if (!product || !product.reward_kind) return null;
  if (product.reward_kind === 'percent') return product.reward_percent ? { kind: 'percent', percent: product.reward_percent } : null;
  const amount = currency === 'USD' ? product.reward_usd : product.reward_krw;
  return Number.isInteger(amount) && amount > 0 ? { kind: 'amount', amount } : null;
}

// What a whole order earns (rounded down): a percentage of its total, or the fixed amount (never more than the total).
function orderReward(rule, total) {
  if (!rule || !Number.isInteger(total) || total <= 0) return 0;
  if (rule.kind === 'percent') return Math.floor((total * rule.percent) / 100);
  return Math.min(rule.amount, total);
}

// What one payment of the order earns: its share of the order's reward (rounded down).
function paymentReward(rule, total, amount) {
  const whole = orderReward(rule, total);
  if (!whole || !Number.isInteger(amount) || amount <= 0) return 0;
  return Math.floor((whole * Math.min(amount, total)) / total);
}

/*
 * What should change for one referred order (pure).
 *   order:    { total, paid_total, refunded_total, status, referral_reward }
 *   payments: its payments received [{ id, amount, at }]
 *   rewards:  its rewards [{ id, payment_id, amount, earned, status, approve_after }]
 * → { add: [{ payment_id, amount, earned, approve_after }], change: [{ id, amount, status }], owed }
 * A new payment adds its reward. Money refunded lowers what the order earns (`owed`, in proportion to what was kept):
 * the newest rewards are lowered first, pending ones before approved ones, and one lowered to 0 is cancelled.
 */
function reconcilePlan(order, payments, rewards) {
  const rule = order.referral_reward;
  const add = [];
  const have = new Set(rewards.map((r) => r.payment_id));
  for (const p of payments) {
    if (have.has(p.id)) continue;
    const earned = paymentReward(rule, order.total, p.amount);
    add.push({ payment_id: p.id, amount: earned, earned, approve_after: new Date(new Date(p.at).getTime() + WINDOW_DAYS * DAY) });
  }
  const kept = Math.max(0, (order.paid_total || 0) - (order.refunded_total || 0));
  const owed = order.total > 0 ? Math.floor((orderReward(rule, order.total) * Math.min(kept, order.total)) / order.total) : 0;
  // Every reward that still counts, the new ones included, newest first.
  const live = [
    ...rewards.filter((r) => r.status !== 'cancelled').map((r) => ({ ...r })),
    ...add.map((r) => ({ ...r, id: null, status: 'pending' })),
  ];
  let excess = live.reduce((s, r) => s + r.amount, 0) - owed;
  const change = [];
  if (excess > 0) {
    const order_ = (r) => (r.status === 'pending' ? 0 : 1);
    const queue = live.slice().sort((a, b) => order_(a) - order_(b) || new Date(b.approve_after) - new Date(a.approve_after));
    for (const r of queue) {
      if (excess <= 0) break;
      const cut = Math.min(excess, r.amount);
      excess -= cut;
      r.amount -= cut;
      if (r.id == null) {
        const a = add.find((x) => x.payment_id === r.payment_id);
        a.amount = r.amount;
      } else {
        change.push({ id: r.id, amount: r.amount, status: r.amount === 0 ? 'cancelled' : r.status });
      }
    }
  }
  // Nothing left at all (fully refunded): every reward is cancelled, even one already at 0.
  if (owed === 0) {
    for (const r of rewards) if (r.status !== 'cancelled' && !change.some((c) => c.id === r.id)) change.push({ id: r.id, amount: 0, status: 'cancelled' });
    for (const a of add) a.cancelled = true;
  }
  return { add, change, owed };
}

// Is `buyer` the referrer themself? Same email, or the same phone number (digits only, at least 8 of them).
function isSelf(referrer, buyer) {
  const email = (s) => String(s || '').trim().toLowerCase();
  if (email(referrer.email) && email(referrer.email) === email(buyer.email)) return true;
  const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^82/, '0');
  const a = digits(referrer.phone), b = digits(buyer.phone);
  return a.length >= 8 && a === b;
}

const linkOf = (code, env = process.env) => `${config.publicBase(env)}/r/${encodeURIComponent(code)}`;

// ---------- ActiveCampaign (plan 3.4; pure) ----------
// A tag added again re-starts an automation only if it was removed first: events that repeat (a second friend's
// purchase, another reward approved) remove their tag, then add it.
const again = (tag, key) => [
  { op: 'tag_remove', payload: { tag }, dedupe: `${key}:remove:${tag}` },
  { op: 'tag_add', payload: { tag }, dedupe: `${key}:add:${tag}` },
];

// A new referrer: their link and code, then the tag `referrer`.
function referrerOps(referrer, env = process.env) {
  return [
    { op: 'fields', payload: { fields: { REFERRAL_LINK: linkOf(referrer.code, env), REFERRAL_CODE: referrer.code } }, dedupe: `referrer${referrer.id}:link` },
    { op: 'tag_add', payload: { tag: 'referrer' }, dedupe: `referrer${referrer.id}:tag` },
  ];
}

// A friend paid: `referral_sale` on the referrer (once per order).
const saleOps = (order) => again('referral_sale', `o${order.id}:referrer`);

// A reward approved: REFERRAL_BALANCE (every approved reward, per currency), then `referral_reward_approved`.
function approvedOps(rewardId, balance) {
  const text = Object.entries(balance || {}).filter(([, n]) => n > 0).map(([cur, n]) => pricing.formatMoney(n, cur)).join(' + ');
  return [
    { op: 'fields', payload: { fields: { REFERRAL_BALANCE: text || pricing.formatMoney(0, 'KRW') } }, dedupe: `reward${rewardId}:balance` },
    ...again('referral_reward_approved', `reward${rewardId}`),
  ];
}

// Where /r/<code>[/<slug>] sends the friend: the program's page, else its checkout, else the home page (pure).
function landing(product) {
  if (!product) return '/';
  const page = product.content && typeof product.content.page === 'string' ? product.content.page.trim() : '';
  if (/^\/[A-Za-z0-9/_-]*$/.test(page) && !page.startsWith('//')) return page;
  return `/checkout/${product.slug}`;
}

function cookieHeader(code) {
  return `${COOKIE}=${code}; Path=/; Max-Age=${COOKIE_DAYS * 24 * 3600}; HttpOnly; Secure; SameSite=Lax`;
}

// The code remembered by this browser, or ''.
function codeFromRequest(req) {
  const value = require('../auth.js').readCookie(req, COOKIE);
  const code = coupons.normalize(value);
  return coupons.isCode(code) ? code : '';
}

// ---------- database ----------

// The referral program's coupon campaign (the friend's discount), or null when the program isn't set up.
async function program() {
  return db.one('SELECT * FROM shop_coupon_campaigns WHERE referral');
}

// The referrer row and code of a customer, or null.
async function ofCustomer(customerId) {
  return db.one(
    `SELECT r.*, c.code, c.id AS coupon_id FROM shop_referrers r LEFT JOIN shop_coupons c ON c.referrer_id = r.id WHERE r.customer_id = $1`, [customerId]);
}

/*
 * A customer's referrer row and personal code, made the first time (the program must be set up). Writes the link to
 * ActiveCampaign (REFERRAL_LINK) when the code is new. → { referrer, code, link } | null (no program).
 */
async function ensureReferrer(customerId) {
  const campaign = await program();
  if (!campaign) return null;
  await db.query('INSERT INTO shop_referrers (customer_id) VALUES ($1) ON CONFLICT (customer_id) DO NOTHING', [customerId]);
  let row = await ofCustomer(customerId);
  if (!row.code) {
    for (let i = 0; i < 5 && !row.code; i++) {
      await db.query(
        `INSERT INTO shop_coupons (campaign_id, code, referrer_id, issued_by) VALUES ($1, $2, $3, 'admin') ON CONFLICT DO NOTHING`,
        [campaign.id, coupons.newCode(), row.id]);
      row = await ofCustomer(customerId);
    }
    if (!row.code) throw new Error('could not make a referral code');
    for (const x of referrerOps(row)) await sync.enqueue({ customerId, ...x });
  }
  return { referrer: row, code: row.code, link: linkOf(row.code) };
}

// The active referrer behind a code (for /r/<code>), or null.
async function byCode(code) {
  const c = coupons.normalize(code);
  if (!coupons.isCode(c)) return null;
  return db.one(
    `SELECT r.*, c.code FROM shop_coupons c JOIN shop_referrers r ON r.id = c.referrer_id
       JOIN shop_coupon_campaigns k ON k.id = c.campaign_id
      WHERE c.code = $1 AND c.disabled_at IS NULL AND r.status = 'active' AND k.referral`, [c]);
}

async function click(referrerId) {
  await db.query(
    `INSERT INTO shop_referral_clicks (referrer_id, day, clicks) VALUES ($1, (now() AT TIME ZONE 'Asia/Seoul')::date, 1)
     ON CONFLICT (referrer_id, day) DO UPDATE SET clicks = shop_referral_clicks.clicks + 1`, [referrerId]);
}

/*
 * An order is being made with coupon `row` (from coupons.forOrder): when it is a referral code, who referred it and
 * the reward rule to keep on the order. → { referrerId, rule } | null (an ordinary coupon).
 * Throws CouponError: 'coupon_own' (the buyer is the referrer), 'coupon_unknown' (referrer paused or banned).
 */
async function attribute(row, { product, currency, billing }) {
  if (!row || !row.referrer_id) return null;
  const ref = await db.one(
    `SELECT r.id, r.status, cu.email, cu.phone FROM shop_referrers r JOIN shop_customers cu ON cu.id = r.customer_id WHERE r.id = $1`, [row.referrer_id]);
  if (!ref || ref.status !== 'active') throw new coupons.CouponError('coupon_unknown');
  if (isSelf(ref, billing)) throw new coupons.CouponError('coupon_own');
  return { referrerId: ref.id, rule: ruleOf(product, currency) };
}

// Brings one referred order's rewards up to date (new payments, refunds). → { added, changed }
async function reconcile(orderId) {
  const order = await db.one('SELECT id, referrer_id, total, paid_total, refunded_total, status, currency, referral_reward FROM shop_orders WHERE id = $1', [orderId]);
  if (!order || !order.referrer_id) return { added: 0, changed: 0 };
  const payments = await db.query(`SELECT id, amount, at FROM shop_payments WHERE order_id = $1 AND kind = 'payment' ORDER BY at, id`, [orderId]);
  const rewards = await db.query('SELECT id, payment_id, amount, earned, status, approve_after FROM shop_rewards WHERE order_id = $1', [orderId]);
  const plan = reconcilePlan(order, payments, rewards);
  for (const a of plan.add) {
    await db.query(
      `INSERT INTO shop_rewards (referrer_id, order_id, payment_id, currency, amount, earned, status, approve_after, cancelled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (payment_id) DO NOTHING`,
      [order.referrer_id, order.id, a.payment_id, order.currency, a.amount, a.earned, a.cancelled || a.amount === 0 ? 'cancelled' : 'pending', a.approve_after, a.cancelled || a.amount === 0 ? new Date() : null]);
  }
  for (const c of plan.change) {
    await db.query(
      `UPDATE shop_rewards SET amount = $2, status = $3, cancelled_at = CASE WHEN $3 = 'cancelled' THEN coalesce(cancelled_at, now()) ELSE cancelled_at END,
              note = CASE WHEN $3 = 'cancelled' THEN 'cancelled by a refund' ELSE 'lowered by a refund' END, updated_at = now() WHERE id = $1`,
      [c.id, c.amount, c.status]);
  }
  return { added: plan.add.length, changed: plan.change.length };
}

// Pending rewards whose refund window has passed → approved (not while a refund is being asked for).
async function approveDue(now = new Date()) {
  const rows = await db.query(
    `UPDATE shop_rewards w SET status = 'approved', approved_at = $1, updated_at = now()
       FROM shop_orders o WHERE o.id = w.order_id AND w.status = 'pending' AND w.approve_after <= $1 AND w.amount > 0
        AND o.status NOT IN ('refund_requested') RETURNING w.id, w.referrer_id`, [now]);
  // ActiveCampaign: the referrer's balance and the tag, so an automation can tell them.
  for (const w of rows) {
    const ref = await db.one('SELECT customer_id FROM shop_referrers WHERE id = $1', [w.referrer_id]);
    const sums = await db.query(`SELECT currency, sum(amount)::bigint AS n FROM shop_rewards WHERE referrer_id = $1 AND status = 'approved' GROUP BY currency`, [w.referrer_id]);
    for (const x of approvedOps(w.id, Object.fromEntries(sums.map((s) => [s.currency, Number(s.n)])))) await sync.enqueue({ customerId: ref.customer_id, ...x });
  }
  return rows.length;
}

/*
 * The daily job (and after a payment): every referred order is brought up to date, then the rewards due are
 * approved. → { orders, added, changed, approved }
 */
async function sweep({ now = new Date() } = {}) {
  const list = await db.query(`SELECT id FROM shop_orders WHERE referrer_id IS NOT NULL AND paid_at IS NOT NULL AND created_at > now() - interval '3 years'`);
  let added = 0, changed = 0;
  for (const o of list) {
    const r = await reconcile(o.id);
    added += r.added; changed += r.changed;
  }
  return { orders: list.length, added, changed, approved: await approveDue(now) };
}

// After a payment: the buyer gets their own code (when the program is set up), and a referred order its reward.
async function afterPayment(order) {
  await ensureReferrer(order.customer_id);
  if (!order.referrer_id) return;
  await reconcile(order.id);
  const ref = await db.one('SELECT customer_id FROM shop_referrers WHERE id = $1', [order.referrer_id]);
  if (ref) for (const x of saleOps(order)) await sync.enqueue({ customerId: ref.customer_id, orderId: order.id, ...x });
}

// A referrer's numbers (for /my and the admin): clicks, orders, rewards by status and currency.
async function statsOf(referrerId) {
  const clicks = await db.one('SELECT coalesce(sum(clicks), 0)::int AS n FROM shop_referral_clicks WHERE referrer_id = $1', [referrerId]);
  const orders = await db.one(`SELECT count(*)::int AS n FROM shop_orders WHERE referrer_id = $1 AND paid_at IS NOT NULL`, [referrerId]);
  const rewards = await db.query(
    `SELECT currency, status, count(*)::int AS count, coalesce(sum(amount), 0)::int AS amount FROM shop_rewards WHERE referrer_id = $1 GROUP BY currency, status`, [referrerId]);
  const byStatus = {};
  for (const r of rewards) {
    byStatus[r.currency] = byStatus[r.currency] || { pending: 0, approved: 0, cancelled: 0 };
    byStatus[r.currency][r.status] = r.amount;
  }
  return { clicks: clicks.n, orders: orders.n, rewards: byStatus };
}

module.exports = {
  WINDOW_DAYS, COOKIE, COOKIE_DAYS,
  ruleOf, orderReward, paymentReward, reconcilePlan, isSelf, linkOf, landing, cookieHeader, codeFromRequest, referrerOps, saleOps, approvedOps,
  program, ofCustomer, ensureReferrer, byCode, click, attribute, reconcile, approveDue, sweep, afterPayment, statsOf,
};
