/*
 * Coupons (docs/commerce-plan.md 3.6 and section 12). Migration 017.
 *
 * A campaign holds the rules: a percentage or a fixed amount per currency, the products it works on, its dates,
 * how many paid orders one email may make with it, and the key of its ActiveCampaign tags. Its codes are
 *   shared       anyone may type it; optionally only N times (max_uses)
 *   individual   tied to one email, used once, valid `valid_days` from the day it was given (and never past the
 *                campaign's end). Written to that contact's AC fields (COUPON_CODE, COUPON_EXPIRES, COUPON_LINK)
 *                and tagged coupon_issued_<key>, so Ashley's email can show the person their own code.
 *
 * The rules that matter:
 * - A coupon only lowers the price of the product itself (the pricing option picked), never the add-ons, and only
 *   in pay-in-full. It can never make the product free: a discount must leave something to pay.
 * - The server works out the discount on every order (forOrder → pricing.quote's `discount`): the page only
 *   shows it.
 * - A use is a paid order. An order still waiting for payment (less than an hour old) also holds a limited
 *   code, so two people can't both start paying with the last use; the same email starting again doesn't
 *   block itself. A payment is never refused because of a coupon: by then the price was agreed.
 *
 * Pure helpers (normalize, newCode, discountFor, problem, offTable, lastDay, issuedOps) are unit-tested in
 * tests/shop/coupons.test.js.
 */
const crypto = require('node:crypto');
const db = require('../db.js');
const pricing = require('./pricing.js');
const ledger = require('./ledger.js');
const config = require('./config.js');

const HOLD_MINUTES = 60;                         // an unpaid order holds a limited code this long
const MISSES = { perNetwork: 20, minutes: 60 };  // unknown codes typed per network before 'too_many'
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L: codes are read from emails and typed
const ISSUE_MAX = 5000;                          // individual codes created in one go

// A coupon problem with a stable code (copy.ko.js `errors`), safe to show to the buyer.
class CouponError extends Error {
  constructor(code, detail = '') {
    super(detail || code);
    this.code = code;
    this.status = 400;
    this.expose = true;
  }
}

// What the buyer typed → the stored form: no spaces, upper case ("summer 10" → "SUMMER10").
function normalize(code) {
  return String(code == null ? '' : code).normalize('NFKC').replace(/\s+/g, '').toUpperCase().slice(0, 60);
}
const isCode = (code) => /^[A-Z0-9][A-Z0-9_-]{2,39}$/.test(code);

// A new individual code: "K7MD-Q2XP" (31^8 ≈ 850 billion), optionally after a prefix ("BF-K7MD-Q2XP").
function newCode(prefix = '') {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  const p = normalize(prefix).replace(/[^A-Z0-9]/g, '').slice(0, 12);
  return `${p ? p + '-' : ''}${s.slice(0, 4)}-${s.slice(4)}`;
}

/*
 * The discount a campaign gives on `price` (the product or option price, VAT included) in `currency`, or null
 * when it can't be used there: no fixed amount in this currency, or a discount that would leave nothing to pay.
 * A percentage is rounded down to the won (or cent): the buyer never gets more off than the rule says.
 */
function discountFor(campaign, price, currency) {
  if (!Number.isInteger(price) || price <= 0 || !campaign) return null;
  let off;
  if (campaign.kind === 'percent') off = Math.floor((price * campaign.percent) / 100);
  else off = currency === 'USD' ? campaign.amount_usd : campaign.amount_krw;
  if (!Number.isInteger(off) || off <= 0 || off >= price) return null;
  return off;
}

/*
 * Why `coupon` (with its `campaign`) can't be used, or null when it can. ctx:
 *   productId     the product bought
 *   currency      'KRW' | 'USD' (left out while the buyer hasn't picked: any currency will do)
 *   email         the buyer's (left out before the form is filled: owner and per-person checks wait for the order)
 *   used          uses of this code (paid orders, and other people's orders still waiting for payment)
 *   usedByEmail   paid orders of this email with any code of the campaign
 * Codes: coupon_unknown (also disabled: a stranger learns nothing), coupon_not_started, coupon_expired,
 * coupon_product, coupon_currency, coupon_not_yours, coupon_used_up, coupon_already_used.
 */
function problem(coupon, campaign, ctx = {}) {
  const now = ctx.now || new Date();
  if (!coupon || !campaign || coupon.disabled_at || campaign.status !== 'active') return 'coupon_unknown';
  if (campaign.starts_at && now < new Date(campaign.starts_at)) return 'coupon_not_started';
  if ((campaign.ends_at && now >= new Date(campaign.ends_at)) || (coupon.expires_at && now >= new Date(coupon.expires_at))) return 'coupon_expired';
  const products = (campaign.product_ids || []).map(Number);
  if (products.length && !products.includes(Number(ctx.productId))) return 'coupon_product';
  if (ctx.currency && campaign.kind === 'amount' && (ctx.currency === 'USD' ? campaign.amount_usd : campaign.amount_krw) == null) return 'coupon_currency';
  if (coupon.owner_email && ctx.email && String(ctx.email).trim().toLowerCase() !== coupon.owner_email) return 'coupon_not_yours';
  if (coupon.max_uses != null && (ctx.used || 0) >= coupon.max_uses) return 'coupon_used_up';
  if (ctx.email && (ctx.usedByEmail || 0) >= campaign.per_person) return 'coupon_already_used';
  return null;
}

/*
 * The discount on every price the checkout page can show: { [optionKey]: { KRW: n | null, USD: n | null } }
 * (key '' for a product without pricing options). null = this coupon can't be used with that option/currency.
 */
function offTable(campaign, product, currencies = pricing.CURRENCIES) {
  const opts = pricing.priceOptions(product);
  const sources = opts.length ? opts : [{ key: '', price_krw: product.price_krw, price_usd: product.price_usd }];
  const out = {};
  for (const o of sources) {
    out[o.key] = {};
    for (const cur of currencies) {
      const price = pricing.priceIn(o, cur);
      out[o.key][cur] = price == null ? null : discountFor(campaign, price, cur);
    }
  }
  return out;
}

// What the admin and the checkout say about a campaign's discount: "10%", "₩50,000 / $40".
function describe(campaign) {
  if (!campaign) return '';
  if (campaign.kind === 'percent') return `${campaign.percent}%`;
  return [campaign.amount_krw != null && pricing.formatMoney(campaign.amount_krw, 'KRW'), campaign.amount_usd != null && pricing.formatMoney(campaign.amount_usd, 'USD')].filter(Boolean).join(' / ');
}

const DAY = 24 * 60 * 60 * 1000;
const KST = 9 * 60 * 60 * 1000;

/*
 * An individual code given at `now`: its last valid day (Seoul date) and when it stops working (00:00 KST the
 * day after, like every "until" date in the admin). valid_days counts the day it is given: 7 → today + 6.
 * Never past the campaign's end. → { lastDay: 'YYYY-MM-DD' | '', expiresAt: Date | null }
 */
function expiryOf(campaign, now = new Date()) {
  let expiresAt = null;
  if (campaign.valid_days) {
    const today = ledger.seoul(now).date;
    const startOfToday = Date.parse(`${today}T00:00:00Z`) - KST;
    expiresAt = new Date(startOfToday + campaign.valid_days * DAY);
  }
  if (campaign.ends_at && (!expiresAt || new Date(campaign.ends_at) < expiresAt)) expiresAt = new Date(campaign.ends_at);
  return { lastDay: lastDay(expiresAt), expiresAt };
}

// The Seoul date of the last moment before `expiresAt` ('' when there is none).
function lastDay(expiresAt) {
  return expiresAt ? ledger.seoul(new Date(new Date(expiresAt).getTime() - 1)).date : '';
}

// The address in COUPON_LINK: the campaign's checkout with the code already in it ('' without a checkout to open).
function linkOf(code, productSlug, env = process.env) {
  return productSlug ? config.checkoutUrl(productSlug, { coupon: code }, env) : '';
}

/*
 * What a code given to someone sends to ActiveCampaign (pure): the fields first, then the tag, so an automation
 * started by the tag already finds the code in the fields. `stamp` makes a repeat on another day send again.
 */
function issuedOps({ coupon, campaign, link, stamp = '' }) {
  const key = `coupon${coupon.id}${stamp ? ':' + stamp : ''}`;
  return [
    { op: 'fields', payload: { fields: { COUPON_CODE: coupon.code, COUPON_EXPIRES: lastDay(coupon.expires_at), COUPON_LINK: link || '' } }, dedupe: `${key}:fields` },
    { op: 'tag_add', payload: { tag: `coupon_issued_${campaign.key}` }, dedupe: `${key}:tag` },
  ];
}

// ---------- database ----------

async function byCode(code) {
  const c = normalize(code);
  if (!isCode(c)) return null;
  return db.one(
    `SELECT c.*, row_to_json(k) AS campaign FROM shop_coupons c JOIN shop_coupon_campaigns k ON k.id = c.campaign_id WHERE c.code = $1`, [c]);
}

// Uses of a code, and this email's paid orders with the campaign (see the rules at the top).
async function usage(coupon, email = '') {
  const e = String(email || '').trim().toLowerCase();
  return db.one(
    `SELECT (SELECT count(*)::int FROM shop_orders o JOIN shop_customers cu ON cu.id = o.customer_id
              WHERE o.coupon_id = $1 AND (o.paid_at IS NOT NULL
                 OR (o.status IN ('created', 'awaiting_payment') AND o.created_at > now() - ($4 || ' minutes')::interval AND cu.email <> $2))) AS used,
            (SELECT count(*)::int FROM shop_orders o JOIN shop_customers cu ON cu.id = o.customer_id JOIN shop_coupons x ON x.id = o.coupon_id
              WHERE x.campaign_id = $3 AND cu.email = $2 AND o.paid_at IS NOT NULL) AS by_email`,
    [coupon.id, e, coupon.campaign_id, String(HOLD_MINUTES)]);
}

// Someone typing code after code: refused for a while (every unknown code counts).
async function guardGuessing(ipHash) {
  if (!ipHash) return;
  const r = await db.one(`SELECT count(*)::int AS n FROM shop_coupon_misses WHERE ip_hash = $1 AND at > now() - ($2 || ' minutes')::interval`, [ipHash, String(MISSES.minutes)]);
  if (r.n >= MISSES.perNetwork) throw new CouponError('too_many');
}
async function miss(ipHash) {
  if (ipHash) await db.query('INSERT INTO shop_coupon_misses (ip_hash) VALUES ($1)', [ipHash]).catch(() => {});
}

async function find(code, ipHash) {
  await guardGuessing(ipHash);
  const row = await byCode(code);
  if (!row) {
    await miss(ipHash);
    throw new CouponError('coupon_unknown');
  }
  return row;
}

/*
 * The checkout page applies a code (before the buyer's email is known): → { code, label, off, planOff } where `off`
 * is offTable() and `planOff` the discount on the product's instalment plan (its total, KRW), or null when the
 * code can't lower it. Throws CouponError when the code can't be used on this product at all (`plan` = 'both' on a
 * checkout that offers the plan too: when it lowers neither).
 */
async function forPage({ code, product, currencies, plan = 'full', ipHash = null, now = new Date() }) {
  const row = await find(code, ipHash);
  const why = problem(row, row.campaign, { productId: product.id, now, used: (await usage(row)).used });
  if (why) throw new CouponError(why);
  const off = offTable(row.campaign, product, currencies);
  const planOff = planDiscount(row.campaign, product);
  // `plan`: 'full', 'instalment', or 'both' (a checkout offering 일시불 and 분할 결제): refused only when it lowers nothing shown.
  const cells = Object.values(off).flatMap((x) => Object.values(x));
  const onFull = cells.some((n) => n != null);
  const usable = plan === 'instalment' ? planOff != null : plan === 'both' ? onFull || planOff != null : onFull;
  if (!usable) throw new CouponError(row.campaign.kind === 'amount' && (plan !== 'instalment' || row.campaign.amount_krw == null) ? 'coupon_currency' : 'coupon_product');
  return { code: row.code, label: describe(row.campaign), off, planOff };
}

// The discount a campaign gives on the product's instalment plan (on its total, KRW), or null (no plan, or it
// would leave an instalment at zero).
function planDiscount(campaign, product) {
  const p = pricing.instalmentPlan(product);
  if (!p) return null;
  const d = discountFor(campaign, p.total, 'KRW');
  if (d == null) return null;
  try { pricing.discountedPlan(p, d); } catch (err) { return null; }
  return d;
}

/*
 * An order is being created with `code`: → { coupon, campaign, discount } (discount on the product's price).
 * Throws CouponError with the reason the buyer sees.
 */
async function forOrder({ code, product, optionKey = null, currency, plan = 'full', email, ipHash = null, now = new Date() }) {
  const row = await find(code, ipHash);
  const use = await usage(row, email);
  const why = problem(row, row.campaign, { productId: product.id, currency, email, now, used: use.used, usedByEmail: use.by_email });
  if (why) throw new CouponError(why);
  // Pay in full: the discount is on the product's (or option's) price. Instalments: on the plan's total, which
  // pricing.quote then spreads over the payments in proportion (pricing.discountedPlan).
  const opt = plan === 'instalment' ? null : pricing.optionOf(product, optionKey || null);
  const plannable = plan === 'instalment' ? pricing.instalmentPlan(product) : null;
  if (plan === 'instalment' && (!plannable || currency !== 'KRW')) throw new CouponError('coupon_product', 'this product has no instalment plan in this currency');
  const discount = plannable ? planDiscount(row.campaign, product) : discountFor(row.campaign, pricing.priceIn(opt || product, currency), currency);
  if (discount == null) throw new CouponError('coupon_product', 'the discount would leave nothing to pay');
  return { coupon: row, campaign: row.campaign, discount };
}

async function campaignByKey(key) {
  return db.one('SELECT * FROM shop_coupon_campaigns WHERE key = $1', [String(key || '')]);
}

// The checkout COUPON_LINK opens: the campaign's own, or its only product's.
async function linkSlug(campaign) {
  const id = campaign.link_product_id || ((campaign.product_ids || []).length === 1 ? campaign.product_ids[0] : null);
  if (!id) return '';
  const p = await db.one(`SELECT slug FROM shop_products WHERE id = $1 AND NOT addon_only`, [id]);
  return p ? p.slug : '';
}

/*
 * Gives each email its own code of `campaign` (individual codes) and queues their ActiveCampaign updates.
 * Someone who already holds a code of this campaign that still works (not used, not expired, not disabled) keeps
 * it: no second code. → { created: [{ email, code }], kept: [{ email, code }] }
 *   by       'admin' | 'ac'
 *   resend   also queue the AC updates again for the codes kept (the AC webhook: a contact asking again)
 */
async function issue(campaign, emails, { by = 'admin', resend = false, now = new Date() } = {}) {
  if (campaign.status !== 'active') throw new CouponError('campaign_disabled', 'this campaign is disabled');
  if (campaign.ends_at && now >= new Date(campaign.ends_at)) throw new CouponError('campaign_ended', 'this campaign has ended');
  const list = [...new Set(emails.map((e) => String(e || '').trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254))];
  if (!list.length) return { created: [], kept: [] };
  if (list.length > ISSUE_MAX) throw new CouponError('too_many_emails', `at most ${ISSUE_MAX} emails at a time`);

  const kept = await db.query(
    `SELECT DISTINCT ON (c.owner_email) c.* FROM shop_coupons c
      WHERE c.campaign_id = $1 AND c.owner_email = ANY($2::text[]) AND c.disabled_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())
        AND NOT EXISTS (SELECT 1 FROM shop_orders o WHERE o.coupon_id = c.id AND o.paid_at IS NOT NULL)
      ORDER BY c.owner_email, c.id DESC`, [campaign.id, list]);
  const has = new Set(kept.map((c) => c.owner_email));
  const { expiresAt } = expiryOf(campaign, now);
  let waiting = list.filter((e) => !has.has(e));
  const created = [];
  // Codes are random: a clash with an existing one is retried with a new code (practically never).
  for (let round = 0; waiting.length && round < 5; round++) {
    const codes = waiting.map(() => newCode());
    const rows = await db.query(
      `INSERT INTO shop_coupons (campaign_id, code, owner_email, max_uses, expires_at, issued_by)
       SELECT $1, x.code, x.email, 1, $4::timestamptz, $5 FROM unnest($2::text[], $3::text[]) AS x(code, email)
       ON CONFLICT (code) DO NOTHING RETURNING *`,
      [campaign.id, codes, waiting, expiresAt ? expiresAt.toISOString() : null, by]);
    created.push(...rows);
    const done = new Set(rows.map((r) => r.owner_email));
    waiting = waiting.filter((e) => !done.has(e));
  }
  if (waiting.length) throw new Error(`could not create codes for ${waiting.length} email(s)`);

  const slug = await linkSlug(campaign);
  const toSend = resend ? [...created, ...kept] : created;
  await queueIssued(campaign, toSend, slug, resend ? ledger.seoul(now).date : '');
  const out = (r) => ({ email: r.owner_email, code: r.code, expires: lastDay(r.expires_at) });
  return { created: created.map(out), kept: kept.map(out) };
}

// Queues the AC updates of codes given to people (one customer row per email, created bare if new).
async function queueIssued(campaign, codes, slug, stamp = '') {
  if (!codes.length) return;
  const emails = codes.map((c) => c.owner_email);
  await db.query(`INSERT INTO shop_customers (email) SELECT unnest($1::text[]) ON CONFLICT (email) DO NOTHING`, [emails]);
  const ids = new Map((await db.query('SELECT id, email FROM shop_customers WHERE email = ANY($1::text[])', [emails])).map((r) => [r.email, r.id]));
  const rows = codes.flatMap((c) => issuedOps({ coupon: c, campaign, link: linkOf(c.code, slug), stamp }).map((x) => ({ ...x, customer: ids.get(c.owner_email) })));
  await db.query(
    `INSERT INTO shop_outbox (customer_id, op, payload, dedupe_key)
     SELECT x.customer, x.op, x.payload::jsonb, x.dedupe FROM unnest($1::int[], $2::text[], $3::text[], $4::text[]) WITH ORDINALITY AS x(customer, op, payload, dedupe, n)
     ORDER BY x.n
     ON CONFLICT (dedupe_key) DO NOTHING`,
    [rows.map((r) => r.customer), rows.map((r) => r.op), rows.map((r) => JSON.stringify(r.payload)), rows.map((r) => r.dedupe)]);
}

module.exports = {
  HOLD_MINUTES, MISSES, ISSUE_MAX, CouponError, normalize, isCode, newCode, discountFor, problem, offTable, describe, expiryOf, lastDay,
  linkOf, issuedOps, byCode, usage, forPage, forOrder, planDiscount, campaignByKey, linkSlug, issue,
};
