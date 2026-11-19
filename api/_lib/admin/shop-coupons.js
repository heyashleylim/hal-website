/*
 * Shop admin API: coupons (docs/commerce-plan.md 3.6, section 12; rules in api/_lib/shop/coupons.js).
 * Page: /admin/shop/coupons/. Campaigns hold the rules; codes are shared (typed by anyone) or individual (one
 * person's, written to their ActiveCampaign fields). Nothing is ever deleted once an order used it: disable instead.
 */
const db = require('../db.js');
const coupons = require('../shop/coupons.js');
const config = require('../shop/config.js');
const sync = require('../shop/sync.js');
const pricing = require('../shop/pricing.js');
const { userError, text, int } = require('./util.js');
const { cents, seoulTime } = require('./shop-products.js');

function won(value, label) {
  return int(String(value == null ? '' : value).replace(/,/g, ''), { min: 1, max: 100000000, label, optional: true });
}

function campaignInput(input, existing) {
  const name = text(input.name, { required: true, max: 100, label: 'Name' });
  const key = existing ? existing.key : text(input.key, { required: true, max: 40, label: 'Tag key' }).toLowerCase();
  if (!/^[a-z0-9]+(_[a-z0-9]+)*$/.test(key)) throw userError('Tag key: lower-case letters, digits and single underscores, e.g. black_friday_2026');
  const kind = input.kind === 'amount' ? 'amount' : input.kind === 'percent' ? 'percent' : null;
  if (!kind) throw userError('Choose a percentage or a fixed amount');
  let percent = null, amount_krw = null, amount_usd = null;
  if (kind === 'percent') percent = int(input.percent, { min: 1, max: 99, label: 'Percentage' });
  else {
    amount_krw = won(input.amount_krw, 'Amount off (KRW)');
    amount_usd = input.amount_usd === '' || input.amount_usd == null ? null : cents(input.amount_usd, 'Amount off (USD)');
    if (amount_krw == null && amount_usd == null) throw userError('Give the amount off in won, in dollars, or both');
  }
  const product_ids = [...new Set((Array.isArray(input.product_ids) ? input.product_ids : []).map((x) => int(x, { min: 1, max: 2147483647, label: 'product' })))];
  const link_product_id = input.link_product_id ? int(input.link_product_id, { min: 1, max: 2147483647, label: 'Checkout link' }) : null;
  const starts_at = seoulTime(input.starts_at, 'Starts');
  const ends_at = seoulTime(input.ends_at, 'Ends');
  if (starts_at && ends_at && starts_at >= ends_at) throw userError('The end must be after the start');
  const valid_days = int(input.valid_days, { min: 1, max: 3650, label: 'Days a personal code works', optional: true });
  const per_person = int(input.per_person || 1, { min: 1, max: 100, label: 'Uses per person' });
  const status = input.status === 'disabled' ? 'disabled' : 'active';
  const note = text(input.note, { max: 1000, label: 'Note' });
  return { name, key, kind, percent, amount_krw, amount_usd, product_ids, link_product_id, starts_at, ends_at, valid_days, per_person, status, note };
}

// A code's state for the admin: disabled, used (individual), used up (shared with a limit), expired, unused / active.
function codeState(c, campaign, now = new Date()) {
  if (c.disabled_at || campaign.status !== 'active') return 'disabled';
  if (c.max_uses != null && c.uses >= c.max_uses) return c.owner_email ? 'used' : 'used up';
  if ((c.expires_at && now >= new Date(c.expires_at)) || (campaign.ends_at && now >= new Date(campaign.ends_at))) return 'expired';
  if (campaign.starts_at && now < new Date(campaign.starts_at)) return 'not started';
  return c.uses ? 'active' : 'unused';
}

function webhookUrl(key) {
  try { return config.acCouponUrl(key); } catch (_) { return ''; }
}

async function getCampaign(id) {
  const c = await db.one('SELECT * FROM shop_coupon_campaigns WHERE id = $1', [id]);
  if (!c) throw userError('campaign not found', 404);
  return c;
}

const PAID = `o.paid_at IS NOT NULL`;

const actions = {
  async 'shop-coupons'() {
    const [campaigns, products] = await Promise.all([
      db.query(`SELECT k.*,
                  (SELECT count(*)::int FROM shop_coupons c WHERE c.campaign_id = k.id AND c.owner_email IS NULL) AS shared_codes,
                  (SELECT count(*)::int FROM shop_coupons c WHERE c.campaign_id = k.id AND c.owner_email IS NOT NULL) AS personal_codes,
                  (SELECT count(*)::int FROM shop_orders o JOIN shop_coupons c ON c.id = o.coupon_id WHERE c.campaign_id = k.id AND ${PAID}) AS orders,
                  (SELECT coalesce(json_object_agg(t.currency, t.off), '{}'::json) FROM (
                     SELECT o.currency, sum(o.discount)::bigint AS off FROM shop_orders o JOIN shop_coupons c ON c.id = o.coupon_id
                      WHERE c.campaign_id = k.id AND ${PAID} GROUP BY o.currency) t) AS discounts
                 FROM shop_coupon_campaigns k ORDER BY k.status, k.created_at DESC, k.id DESC`),
      db.query(`SELECT id, name, slug, addon_only, status FROM shop_products ORDER BY addon_only, name`),
    ]);
    return {
      campaigns: campaigns.map((k) => ({
        ...k, value: coupons.describe(k), webhook: webhookUrl(k.key),
        discountsLabel: Object.entries(k.discounts || {}).map(([cur, n]) => pricing.formatMoney(Number(n), cur)).join(' + '),
      })),
      products,
    };
  },

  // One campaign and its codes (the newest first; at most 5000).
  async 'shop-coupon-campaign'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const campaign = await getCampaign(id);
    const codes = await db.query(
      `SELECT c.id, c.code, c.owner_email, c.max_uses, c.expires_at, c.issued_by, c.disabled_at, c.created_at,
              (SELECT count(*)::int FROM shop_orders o WHERE o.coupon_id = c.id AND ${PAID}) AS uses,
              (SELECT json_agg(json_build_object('id', o.id, 'number', o.number) ORDER BY o.id) FROM shop_orders o WHERE o.coupon_id = c.id AND ${PAID}) AS orders
         FROM shop_coupons c WHERE c.campaign_id = $1 ORDER BY (c.owner_email IS NOT NULL), c.id DESC LIMIT 5000`, [id]);
    const now = new Date();
    return {
      campaign: { ...campaign, value: coupons.describe(campaign), webhook: webhookUrl(campaign.key) },
      codes: codes.map((c) => ({ ...c, state: codeState(c, campaign, now), last_day: coupons.lastDay(c.expires_at) })),
      linkSlug: await coupons.linkSlug(campaign),
    };
  },

  async 'shop-coupon-campaign-save'(input) {
    const id = input.id ? int(input.id, { min: 1, max: 2147483647, label: 'id' }) : null;
    const existing = id ? await getCampaign(id) : null;
    const v = campaignInput(input, existing);
    if (v.product_ids.length) {
      const found = await db.query('SELECT id FROM shop_products WHERE id = ANY($1::int[])', [v.product_ids]);
      if (found.length !== v.product_ids.length) throw userError('a product in the list no longer exists');
    }
    if (v.link_product_id) {
      const p = await db.one('SELECT addon_only FROM shop_products WHERE id = $1', [v.link_product_id]);
      if (!p || p.addon_only) throw userError('The checkout link must be a product with a checkout of its own');
    }
    const cols = ['name', 'kind', 'percent', 'amount_krw', 'amount_usd', 'product_ids', 'link_product_id', 'starts_at', 'ends_at', 'valid_days', 'per_person', 'status', 'note'];
    const vals = cols.map((c) => v[c]);
    let row;
    try {
      row = existing
        ? await db.one(`UPDATE shop_coupon_campaigns SET ${cols.map((c, i) => `${c} = $${i + 2}${c === 'product_ids' ? '::int[]' : ''}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [id, ...vals])
        : await db.one(`INSERT INTO shop_coupon_campaigns (key, ${cols.join(', ')}) VALUES ($1, ${cols.map((c, i) => `$${i + 2}${c === 'product_ids' ? '::int[]' : ''}`).join(', ')}) RETURNING *`, [v.key, ...vals]);
    } catch (err) {
      if (err.code === '23505') throw userError(`The tag key "${v.key}" is already used by another campaign`);
      throw err;
    }
    return { campaign: row, target: `coupon campaign ${row.key}`, log: { id: row.id, key: row.key, value: coupons.describe(row), status: row.status } };
  },

  // A shared code: typed by the admin, or made up.
  async 'shop-coupon-code-add'(input) {
    const campaign = await getCampaign(int(input.campaign_id, { min: 1, max: 2147483647, label: 'campaign' }));
    const typed = coupons.normalize(input.code);
    const code = typed || coupons.newCode();
    if (!coupons.isCode(code)) throw userError('A code is 3–40 letters, digits, - or _ (no spaces or Korean), e.g. SUMMER10');
    const max_uses = int(input.max_uses, { min: 1, max: 1000000, label: 'Maximum uses', optional: true });
    let row;
    try {
      row = await db.one(`INSERT INTO shop_coupons (campaign_id, code, max_uses, issued_by) VALUES ($1, $2, $3, 'admin') RETURNING *`, [campaign.id, code, max_uses]);
    } catch (err) {
      if (err.code === '23505') throw userError(`The code ${code} already exists`);
      throw err;
    }
    return { code: row, target: `coupon ${row.code}`, log: { campaign: campaign.key, code: row.code, max_uses } };
  },

  // Personal codes for a list of emails, or for every ActiveCampaign contact with a tag (from the Contacts copy).
  async 'shop-coupon-issue'(input) {
    const campaign = await getCampaign(int(input.campaign_id, { min: 1, max: 2147483647, label: 'campaign' }));
    const tag = text(input.tag, { max: 200, label: 'Tag' });
    let emails;
    if (tag) {
      const rows = await db.query(`SELECT DISTINCT lower(email) AS email FROM contacts WHERE $1 = ANY(tags) AND email <> '' AND gone_from_ac_at IS NULL`, [tag]);
      emails = rows.map((r) => r.email);
      if (!emails.length) throw userError(`No contact has the tag "${tag}" in the Contacts copy (Contacts → Sync brings it up to date)`);
    } else {
      emails = String(input.emails || '').split(/[\s,;]+/).map((e) => e.trim()).filter(Boolean);
      if (!emails.length) throw userError('Paste at least one email address, or give a tag');
      const bad = emails.filter((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
      if (bad.length) throw userError(`Not an email address: ${bad.slice(0, 5).join(', ')}`);
    }
    let r;
    try {
      r = await coupons.issue(campaign, emails, { by: 'admin' });
    } catch (err) {
      if (err instanceof coupons.CouponError) throw userError(err.message);
      throw err;
    }
    const sent = await sync.process({ budgetMs: 15000 }).catch((err) => ({ error: err.message }));
    return {
      created: r.created.length, kept: r.kept.length, sample: r.created.slice(0, 20), sent,
      target: `coupon campaign ${campaign.key}`, log: { campaign: campaign.key, created: r.created.length, kept: r.kept.length, tag: tag || undefined },
    };
  },

  async 'shop-coupon-code-state'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const disabled = input.disabled === true || input.disabled === 'true';
    const row = await db.one(`UPDATE shop_coupons SET disabled_at = ${disabled ? 'now()' : 'NULL'} WHERE id = $1 RETURNING id, code, disabled_at`, [id]);
    if (!row) throw userError('code not found', 404);
    return { code: row, target: `coupon ${row.code}`, log: { code: row.code, disabled } };
  },
};

module.exports = {
  section: 'shop', actions, writes: ['shop-coupon-campaign-save', 'shop-coupon-code-add', 'shop-coupon-issue', 'shop-coupon-code-state'],
  campaignInput, codeState,
};
