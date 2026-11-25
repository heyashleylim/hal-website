/*
 * Abandoned checkouts (docs/commerce-plan.md 3.4, section 19). Someone who gave their email on the checkout and didn't
 * pay gets checkout_abandoned_<product> in ActiveCampaign, with CHECKOUT_LINK (that product's checkout), so an
 * automation can send one reminder. Buying the product later removes the tag (sync.customerOps).
 *
 * Switched off by default (Shop → Settings): the privacy policy must say so first (Ashley's legal page).
 * Run by the daily job (09:10 Seoul time; on Vercel Pro it could run hourly).
 *
 * Who counts: an order made on the checkout (not in the admin) at least an hour ago and at most 3 days ago, never
 * paid, whose buyer hasn't paid for that product since (or in the 30 days before). One tag per person and product per
 * 30 days, even if they started several checkouts.
 */
const db = require('../db.js');
const sync = require('./sync.js');
const config = require('./config.js');
const settings = require('./settings.js');

const AFTER_MINUTES = 60;
const WITHIN_DAYS = 3;
const ONCE_PER_DAYS = 30;

// What one abandoned checkout sends (pure): the link field first, then the tag (an automation on the tag finds it).
function ops(row, product, { base = '', stamp = '' } = {}) {
  const key = `abandon:c${row.customer_id}:p${product.id}:${stamp}`;
  return [
    { op: 'fields', payload: { fields: { CHECKOUT_LINK: `${base}/checkout/${product.slug}` } }, dedupe: `${key}:fields` },
    { op: 'tag_add', payload: { tag: sync.abandonedTag(product) }, dedupe: `${key}:tag` },
  ];
}

// The 30-day window a tag belongs to ('2026-11-24' → a number of 30-day periods since 1970): one tag per window.
const windowOf = (date) => String(Math.floor(new Date(date).getTime() / (ONCE_PER_DAYS * 24 * 60 * 60 * 1000)));

/*
 * The daily job: tags every abandoned checkout not tagged yet. → { tagged, skipped? }
 */
async function run({ now = new Date() } = {}) {
  const s = await settings.read();
  if (!s.abandoned || s.abandoned.enabled !== true) return { tagged: 0, skipped: 'off (Shop → Settings)' };
  const rows = await db.query(
    `SELECT DISTINCT ON (o.customer_id, o.product_id) o.id, o.customer_id, o.product_id, o.created_at
       FROM shop_orders o
      WHERE o.origin = 'site' AND o.paid_at IS NULL
        AND o.status IN ('created', 'awaiting_payment', 'expired', 'cancelled')
        AND o.created_at < $1::timestamptz - ($2 || ' minutes')::interval
        AND o.created_at > $1::timestamptz - ($3 || ' days')::interval
        AND NOT EXISTS (SELECT 1 FROM shop_orders p WHERE p.customer_id = o.customer_id AND p.product_id = o.product_id
                         AND p.paid_at IS NOT NULL AND p.created_at > o.created_at - ($4 || ' days')::interval)
      ORDER BY o.customer_id, o.product_id, o.created_at DESC`,
    [now, String(AFTER_MINUTES), String(WITHIN_DAYS), String(ONCE_PER_DAYS)]);
  let tagged = 0;
  for (const row of rows) {
    const product = await db.one('SELECT id, slug, purchase_tag FROM shop_products WHERE id = $1', [row.product_id]);
    if (!product) continue;
    const before = await db.one('SELECT count(*)::int AS n FROM shop_outbox WHERE dedupe_key LIKE $1', [`abandon:c${row.customer_id}:p${product.id}:${windowOf(row.created_at)}:%`]);
    if (before.n) continue;
    for (const x of ops(row, product, { base: config.publicBase(), stamp: windowOf(row.created_at) })) {
      await sync.enqueue({ customerId: row.customer_id, orderId: row.id, ...x });
    }
    tagged++;
  }
  return { tagged };
}

module.exports = { AFTER_MINUTES, WITHIN_DAYS, ONCE_PER_DAYS, ops, windowOf, run };
