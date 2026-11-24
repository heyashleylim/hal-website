/*
 * Shop admin API: the referral program (docs/commerce-plan.md 3.5, section 17; rules in api/_lib/shop/referrals.js).
 * Page: /admin/shop/referrals/. The friend's discount is the coupon campaign marked `referral` (saved here, key
 * "referral"); each product's reward is on the product. Referrers, their numbers, and every reward.
 */
const db = require('../db.js');
const coupons = require('../shop/coupons.js');
const pricing = require('../shop/pricing.js');
const referrals = require('../shop/referrals.js');
const { userError, text, int } = require('./util.js');
const { campaignInput } = require('./shop-coupons.js');

const STATUSES = ['active', 'paused', 'banned'];

const actions = {
  async 'shop-referrals'() {
    const program = await referrals.program();
    const [products, totals, referrers, rewards, missing] = await Promise.all([
      db.query(`SELECT id, name, slug, status, addon_only, reward_kind, reward_percent, reward_krw, reward_usd FROM shop_products ORDER BY addon_only, name`),
      db.query(`SELECT currency, status, count(*)::int AS count, coalesce(sum(amount), 0)::bigint AS amount FROM shop_rewards GROUP BY currency, status ORDER BY currency, status`),
      db.query(
        `SELECT r.id, r.status, r.note, r.created_at, cu.email, cu.name, c.code,
                (SELECT coalesce(sum(clicks), 0)::int FROM shop_referral_clicks k WHERE k.referrer_id = r.id) AS clicks,
                (SELECT count(*)::int FROM shop_orders o WHERE o.referrer_id = r.id AND o.paid_at IS NOT NULL) AS orders,
                (SELECT coalesce(json_object_agg(t.k, t.amount), '{}'::json) FROM (
                   SELECT w.currency || ':' || w.status AS k, sum(w.amount)::bigint AS amount FROM shop_rewards w WHERE w.referrer_id = r.id GROUP BY w.currency, w.status) t) AS rewards
           FROM shop_referrers r JOIN shop_customers cu ON cu.id = r.customer_id LEFT JOIN shop_coupons c ON c.referrer_id = r.id
          ORDER BY orders DESC, clicks DESC, r.id DESC LIMIT 1000`),
      db.query(
        `SELECT w.id, w.currency, w.amount, w.earned, w.status, w.approve_after, w.approved_at, w.cancelled_at, w.note, w.created_at,
                o.id AS order_id, o.number, o.product_name, o.status AS order_status, p.instalment_no,
                cu.email AS referrer_email, cu.name AS referrer_name
           FROM shop_rewards w JOIN shop_orders o ON o.id = w.order_id JOIN shop_payments p ON p.id = w.payment_id
           JOIN shop_referrers r ON r.id = w.referrer_id JOIN shop_customers cu ON cu.id = r.customer_id
          ORDER BY w.created_at DESC, w.id DESC LIMIT 500`),
      // Customers with a paid order and no referral code yet (they get one at their next payment or visit to /my).
      db.query(`SELECT count(DISTINCT o.customer_id)::int AS n FROM shop_orders o LEFT JOIN shop_referrers r ON r.customer_id = o.customer_id
                 LEFT JOIN shop_coupons c ON c.referrer_id = r.id WHERE o.paid_at IS NOT NULL AND c.id IS NULL`),
    ]);
    return {
      program: program ? { ...program, value: coupons.describe(program) } : null,
      products: products.map((p) => ({ ...p, reward: rewardLabel(p) })),
      totals: totals.map((t) => ({ ...t, label: pricing.formatMoney(Number(t.amount), t.currency) })),
      referrers: referrers.map((r) => ({ ...r, link: r.code ? referrals.linkOf(r.code) : '' })),
      rewards,
      without_code: missing[0].n,
      window_days: referrals.WINDOW_DAYS,
    };
  },

  // The friend's discount: the referral program's coupon campaign (created the first time, key "referral").
  async 'shop-referral-program-save'(input) {
    const existing = await referrals.program();
    const v = campaignInput({ ...input, key: 'referral' }, existing);
    if (v.product_ids.length) {
      const found = await db.query('SELECT id FROM shop_products WHERE id = ANY($1::int[])', [v.product_ids]);
      if (found.length !== v.product_ids.length) throw userError('a product in the list no longer exists');
    }
    const cols = ['name', 'kind', 'percent', 'amount_krw', 'amount_usd', 'product_ids', 'starts_at', 'ends_at', 'per_person', 'status', 'note'];
    const vals = cols.map((c) => v[c]);
    const set = (c, i) => `$${i + 2}${c === 'product_ids' ? '::int[]' : ''}`;
    let row;
    try {
      row = existing
        ? await db.one(`UPDATE shop_coupon_campaigns SET ${cols.map((c, i) => `${c} = ${set(c, i)}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [existing.id, ...vals])
        : await db.one(`INSERT INTO shop_coupon_campaigns (key, referral, ${cols.join(', ')}) VALUES ($1, true, ${cols.map(set).join(', ')}) RETURNING *`, ['referral', ...vals]);
    } catch (err) {
      if (err.code === '23505') throw userError('The tag key "referral" is already used by an ordinary coupon campaign: rename that campaign’s key first');
      throw err;
    }
    return { program: { ...row, value: coupons.describe(row) }, target: 'referral program', log: { value: coupons.describe(row), status: row.status } };
  },

  // Pause (the code stops working, nothing is lost), ban (the same, for abuse) or reactivate a referrer.
  async 'shop-referrer-status'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const status = STATUSES.includes(input.status) ? input.status : null;
    if (!status) throw userError('Choose active, paused or banned');
    const note = text(input.note, { max: 500, label: 'Note' });
    const row = await db.one(`UPDATE shop_referrers SET status = $2, note = CASE WHEN $3 = '' THEN note ELSE $3 END, updated_at = now() WHERE id = $1 RETURNING id, status`, [id, status, note]);
    if (!row) throw userError('referrer not found', 404);
    return { referrer: row, target: `referrer ${id}`, log: { status, note: note || undefined } };
  },

  // Codes for every customer with a paid order who has none yet (also written to ActiveCampaign as REFERRAL_LINK).
  async 'shop-referrals-create-links'() {
    if (!(await referrals.program())) throw userError('Set up the referral program (the friend’s discount) first');
    const rows = await db.query(
      `SELECT DISTINCT o.customer_id FROM shop_orders o LEFT JOIN shop_referrers r ON r.customer_id = o.customer_id
         LEFT JOIN shop_coupons c ON c.referrer_id = r.id WHERE o.paid_at IS NOT NULL AND c.id IS NULL LIMIT 2000`);
    const started = Date.now();
    let made = 0;
    for (const r of rows) {
      if (Date.now() - started > 40000) break;
      await referrals.ensureReferrer(r.customer_id);
      made += 1;
    }
    return { made, left: rows.length - made, target: 'referral codes', log: { made } };
  },

  // Brings every referred order's rewards up to date and approves the ones due (what the daily job does).
  async 'shop-referrals-sweep'() {
    const r = await referrals.sweep();
    return { ...r, target: 'referral rewards', log: r };
  },
};

function rewardLabel(p) {
  if (p.reward_kind === 'percent') return `${p.reward_percent}%`;
  if (p.reward_kind === 'amount') return [p.reward_krw != null && pricing.formatMoney(p.reward_krw, 'KRW'), p.reward_usd != null && pricing.formatMoney(p.reward_usd, 'USD')].filter(Boolean).join(' / ');
  return '';
}

module.exports = {
  section: 'shop', actions,
  writes: ['shop-referral-program-save', 'shop-referrer-status', 'shop-referrals-create-links', 'shop-referrals-sweep'],
  rewardLabel,
};
