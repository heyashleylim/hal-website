/*
 * Shop → ActiveCampaign. Like the podcast's queue (automation.js): the site never calls AC while a buyer
 * waits. Each fact is written to shop_outbox with a dedupe key (so it is queued once), and process() sends
 * the pending ones, retrying failures with a growing delay. Ashley's automations react to the tags.
 *
 * On a paid order:
 *   contact   the buyer exists in AC (created with their name if new) and is on the Master Contact List
 *   tag_add   the product's purchase tag (purchased_eft, purchased_nsmb_XX_YYYYMM…) and its extra tags
 *   fields    ORDER_NUMBER, ORDER_PRODUCT, ORDER_DATE, ORDER_TOTAL, ORDER_PLAN, ORDER_RECEIPT_URL
 * A contact field that doesn't exist in AC yet is skipped and reported (it never blocks the tags).
 */
const db = require('../db.js');
const ac = require('../ac.js');
const pricing = require('./pricing.js');
const ledger = require('./ledger.js');

const ORDER_FIELDS = ['ORDER_NUMBER', 'ORDER_PRODUCT', 'ORDER_DATE', 'ORDER_TOTAL', 'ORDER_PLAN', 'ORDER_RECEIPT_URL'];

function acConfigured(env = process.env) {
  return Boolean((env.AC_API_URL || '').trim() && (env.AC_API_KEY || '').trim());
}

const listName = (env = process.env) => (env.AC_LIST_NAME || 'Master Contact List').trim();

async function enqueue({ customerId, orderId = null, op, payload = {}, dedupe = null }) {
  await db.query(
    `INSERT INTO shop_outbox (customer_id, order_id, op, payload, dedupe_key) VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (dedupe_key) DO NOTHING`,
    [customerId, orderId, op, JSON.stringify(payload), dedupe],
  );
}

// What a paid order sends to AC (pure): [{ op, payload, dedupe }].
function purchaseOps(order, product, payment = {}) {
  const key = `o${order.id}`;
  const ops = [{ op: 'contact', payload: { name: (order.billing || {}).name || '' }, dedupe: `${key}:contact` }];
  const tags = [...new Set([product.purchase_tag, ...(product.extra_tags || [])].map((t) => String(t || '').trim()).filter(Boolean))];
  for (const tag of tags) ops.push({ op: 'tag_add', payload: { tag }, dedupe: `${key}:tag:${tag}` });
  ops.push({
    op: 'fields',
    payload: {
      fields: {
        ORDER_NUMBER: String(order.number),
        ORDER_PRODUCT: order.product_name,
        ORDER_DATE: ledger.seoul(order.paid_at || new Date()).date,
        ORDER_TOTAL: pricing.formatMoney(order.total, order.currency),
        ORDER_PLAN: order.plan === 'instalment' ? '할부' : '일시불',
        ORDER_RECEIPT_URL: payment.receiptUrl || '',
      },
    },
    dedupe: `${key}:fields:paid`,
  });
  return ops;
}

async function queuePurchase(order, product, payment) {
  for (const x of purchaseOps(order, product, payment)) await enqueue({ customerId: order.customer_id, orderId: order.id, ...x });
}

// The customer's AC contact id: known, found by email, or created (only then is our name used: AC's own
// First name, where Ashley's team keeps the full Korean name, is never overwritten).
async function ensureContact(row, name) {
  if (row.ac_contact_id) return String(row.ac_contact_id);
  const found = await ac.findContactByEmail(row.email);
  if (found) return String(found.id);
  return String(await ac.syncContact({ email: row.email, firstName: name || row.name || undefined }));
}

// Sets the fields that exist in AC; returns the names of the ones that don't.
async function setFields(contactId, fields) {
  const known = {}, missing = [];
  for (const [name, value] of Object.entries(fields)) {
    try {
      await ac.findField(name);
      known[name] = value;
    } catch (err) {
      if (/no contact field/.test(err.message)) missing.push(name);
      else throw err;
    }
  }
  if (Object.keys(known).length) await ac.updateContactFields(contactId, known);
  return missing;
}

// Delay before the next try: 5 min, 10, 20 … up to 12 h.
function backoffMs(attempts) {
  return Math.min(12 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.max(0, attempts - 1));
}

// Sends pending updates until the time budget is used. → { done, failed, left } (or { skipped } without AC keys).
async function sendPending({ budgetMs = 6000, orderId = null } = {}) {
  if (!acConfigured()) return { done: 0, failed: 0, left: null, skipped: 'ActiveCampaign is not configured (AC_API_URL / AC_API_KEY)' };
  const started = Date.now();
  const rows = await db.query(
    `SELECT o.*, c.email, c.name, c.ac_contact_id FROM shop_outbox o JOIN shop_customers c ON c.id = o.customer_id
      WHERE o.status = 'pending' AND o.next_attempt_at <= now() ${orderId ? 'AND o.order_id = $1' : ''}
      ORDER BY o.id LIMIT 100`, orderId ? [orderId] : []);
  let done = 0, failed = 0;
  const contactIds = new Map(); // customer → contact id found during this run
  for (const row of rows) {
    if (Date.now() - started > budgetMs) break;
    try {
      const contactId = contactIds.get(row.customer_id) || await ensureContact(row, row.payload && row.payload.name);
      contactIds.set(row.customer_id, contactId);
      let note = null;
      if (row.op === 'contact') await ac.subscribeToList(contactId, listName());
      else if (row.op === 'tag_add') await ac.addTag(contactId, row.payload.tag, { description: 'Shop (hal-website)' });
      else if (row.op === 'tag_remove') await ac.removeTag(contactId, row.payload.tag);
      else if (row.op === 'fields') {
        const missing = await setFields(contactId, row.payload.fields || {});
        if (missing.length) note = `contact fields not found in ActiveCampaign, skipped: ${missing.join(', ')}`;
      }
      if (String(contactId) !== String(row.ac_contact_id || '')) await db.query('UPDATE shop_customers SET ac_contact_id = $2 WHERE id = $1', [row.customer_id, contactId]);
      await db.query(`UPDATE shop_outbox SET status = 'done', done_at = now(), attempts = attempts + 1, last_error = $2 WHERE id = $1`, [row.id, note]);
      done++;
    } catch (err) {
      const attempts = row.attempts + 1;
      await db.query(
        `UPDATE shop_outbox SET attempts = $2, last_error = $3, status = $4, next_attempt_at = now() + ($5 || ' milliseconds')::interval WHERE id = $1`,
        [row.id, attempts, String(err.message).slice(0, 500), attempts >= 8 ? 'failed' : 'pending', String(backoffMs(attempts))],
      );
      failed++;
    }
  }
  const left = (await db.one(`SELECT count(*)::int AS n FROM shop_outbox WHERE status = 'pending'`)).n;
  return { done, failed, left };
}

// Exported as `process` for callers; never named that inside this file, where `process` must stay Node's.
module.exports = { ORDER_FIELDS, acConfigured, enqueue, purchaseOps, queuePurchase, process: sendPending, backoffMs, setFields };
