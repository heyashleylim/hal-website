/*
 * Shop admin API: tax and sales reports (rules in api/_lib/shop/reports.js; docs/commerce-plan.md 3.7 and
 * section 15). Page: /admin/shop/reports. Everything comes from the tax ledger (shop_ledger), so the figures are
 * the ones the business files.
 */
const db = require('../db.js');
const reports = require('../shop/reports.js');
const ledger = require('../shop/ledger.js');
const { userError, text, int, date } = require('./util.js');

function periodOf(input) {
  const p = reports.period(input.period || reports.periodsOf(new Date()).month);
  if (!p) throw userError('period must be a month (2026-11), a quarter (2026-Q4), a half-year (2026-H2), a year (2026) or two dates (2026-11-01..2026-11-15)');
  return p;
}

// Every ledger line of a period, with the order, customer and payment behind it.
function linesOf(p) {
  return db.query(
    `SELECT l.id, l.at, l.kind, l.provider, l.method, l.currency, l.amount, l.supply, l.vat, l.vat_rule, l.fee,
            l.fx_rate::float8 AS fx_rate, l.fx_source, l.amount_krw, l.note, l.order_id,
            o.number, o.product_name, o.price_option->>'label' AS option, o.origin, o.coupon_code,
            c.name AS customer_name, c.email, c.country,
            p.provider_ref, p.approval_no, p.receipt_url, p.instalment_no,
            op.at AS refund_of_at, op.provider_ref AS refund_of_ref,
            (SELECT r.reason FROM shop_refunds r WHERE r.refund_payment_id = p.id ORDER BY r.id LIMIT 1) AS refund_reason
       FROM shop_ledger l
       JOIN shop_orders o ON o.id = l.order_id
       JOIN shop_customers c ON c.id = o.customer_id
       LEFT JOIN shop_payments p ON p.id = l.payment_id
       LEFT JOIN shop_payments op ON op.id = p.refund_of
      WHERE l.at >= $1::timestamptz AND l.at < $2::timestamptz
      ORDER BY l.at, l.id`,
    [p.start, p.end],
  );
}

// Instalments still to come on running plans (today, whatever the period).
function outstandingRows() {
  return db.query(
    `SELECT i.order_id, o.number, o.currency, o.product_name, o.plan_status, c.name AS customer_name, c.email,
            i.number AS instalment, to_char(i.due_date, 'YYYY-MM-DD') AS due_date, i.amount, i.status
       FROM shop_instalments i
       JOIN shop_orders o ON o.id = i.order_id
       JOIN shop_customers c ON c.id = o.customer_id
      WHERE i.status IN ('due', 'failed', 'overdue') AND o.plan_status IN ('active', 'overdue', 'paused')
      ORDER BY i.due_date, o.number, i.number`,
  );
}

const CSV = {
  // The detail behind every total: one row per ledger line.
  lines: [
    { key: 'date', label: 'Date (Seoul)', value: (l) => ledger.seoul(l.at).date },
    { key: 'time', label: 'Time (Seoul)', value: (l) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(l.at)) },
    { key: 'number', label: 'Order' },
    { key: 'kind', label: 'Kind' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'email', label: 'Email' },
    { key: 'country', label: 'Country' },
    { key: 'product_name', label: 'Product' },
    { key: 'option', label: 'Option' },
    { key: 'channel', label: 'Channel', value: (l) => reports.channel(l.provider) },
    { key: 'method', label: 'Method' },
    { key: 'currency', label: 'Currency' },
    { key: 'amount', label: 'Amount (VAT incl.)', value: (l) => reports.major(l.amount, l.currency) },
    { key: 'supply', label: 'Supply (공급가액)', value: (l) => reports.major(l.supply, l.currency) },
    { key: 'vat', label: 'VAT (부가세)', value: (l) => reports.major(l.vat, l.currency) },
    { key: 'vat_rule', label: 'VAT rule' },
    { key: 'fee', label: 'Provider fee', value: (l) => reports.major(l.fee, l.currency) },
    { key: 'fx_rate', label: 'KRW per USD' },
    { key: 'fx_source', label: 'Rate source' },
    { key: 'amount_krw', label: 'Won value' },
    { key: 'instalment_no', label: 'Instalment' },
    { key: 'coupon_code', label: 'Coupon' },
    { key: 'provider_ref', label: 'Provider reference' },
    { key: 'approval_no', label: 'Approval no.' },
    { key: 'receipt_url', label: 'Receipt' },
    { key: 'refund_of', label: 'Refund of payment on', value: (l) => (l.refund_of_at ? ledger.seoul(l.refund_of_at).date : null) },
    { key: 'refund_reason', label: 'Refund reason' },
    { key: 'origin', label: 'Order origin' },
    { key: 'note', label: 'Note' },
  ],
  outstanding: [
    { key: 'number', label: 'Order' },
    { key: 'customer_name', label: 'Customer' },
    { key: 'email', label: 'Email' },
    { key: 'product_name', label: 'Product' },
    { key: 'instalment', label: 'Instalment' },
    { key: 'due_date', label: 'Due (Seoul)' },
    { key: 'currency', label: 'Currency' },
    { key: 'amount', label: 'Amount', value: (r) => reports.major(r.amount, r.currency) },
    { key: 'status', label: 'Status' },
    { key: 'plan_status', label: 'Plan' },
  ],
};

// A rate typed in the admin: won per dollar, e.g. 1386.5 (up to 4 decimals).
function rateOf(value) {
  const s = String(value == null ? '' : value).replace(/,/g, '').trim();
  if (!/^\d{1,5}(\.\d{1,4})?$/.test(s)) throw userError('the rate must be a number of won per dollar, e.g. 1386.5');
  const r = Number(s);
  if (r < 100 || r > 10000) throw userError('the rate must be between 100 and 10,000 won per dollar');
  return s;
}

const actions = {
  // Sales by period, by channel and VAT rule, per product, refunds, USD sales, coupons and instalments still due.
  async 'shop-report'(input) {
    const p = periodOf(input);
    const [lines, coupons, owed] = await Promise.all([
      linesOf(p),
      db.query(
        `SELECT k.name, k.key, o.currency, count(*)::int AS orders, sum(o.discount)::bigint AS discount, sum(o.total)::bigint AS total
           FROM shop_orders o
           LEFT JOIN shop_coupons x ON x.id = o.coupon_id
           LEFT JOIN shop_coupon_campaigns k ON k.id = x.campaign_id
          WHERE o.paid_at >= $1::timestamptz AND o.paid_at < $2::timestamptz AND o.discount > 0
          GROUP BY k.name, k.key, o.currency ORDER BY o.currency, k.name NULLS LAST`,
        [p.start, p.end]),
      outstandingRows(),
    ]);
    const usd = lines.filter((l) => l.currency === 'USD');
    // The Seoul days with USD lines still missing an exchange rate (one rate per day).
    const missing = {};
    for (const l of usd) if (l.amount_krw == null) { const d = ledger.seoul(l.at).date; missing[d] = (missing[d] || 0) + 1; }
    return {
      period: p,
      quick: reports.periodsOf(new Date()),
      summary: reports.summary(lines),
      products: reports.byProduct(lines),
      refunds: lines.filter((l) => l.amount < 0).map((l) => ({
        id: l.id, at: l.at, order_id: l.order_id, number: l.number, customer_name: l.customer_name, product_name: l.product_name,
        currency: l.currency, amount: l.amount, supply: l.supply, vat: l.vat, refund_of_at: l.refund_of_at, reason: l.refund_reason || '',
      })),
      foreign: usd.map((l) => ({
        id: l.id, at: l.at, order_id: l.order_id, number: l.number, customer_name: l.customer_name, country: l.country, product_name: l.product_name,
        kind: l.kind, amount: l.amount, supply: l.supply, vat: l.vat, vat_rule: l.vat_rule, fee: l.fee,
        net: l.fee == null ? null : l.amount - l.fee, fx_rate: l.fx_rate, fx_source: l.fx_source, amount_krw: l.amount_krw,
      })),
      missing_rates: Object.keys(missing).sort().map((d) => ({ date: d, lines: missing[d] })),
      coupons: coupons.map((c) => ({ ...c, discount: Number(c.discount), total: Number(c.total) })),
      outstanding: { totals: reports.outstanding(owed), rows: owed },
    };
  },

  // A report as a CSV file for Excel: every ledger line of the period, or the instalments still due.
  async 'shop-report-csv'(input) {
    const file = text(input.file, { max: 20 }) || 'lines';
    if (!CSV[file]) throw userError('unknown file');
    if (file === 'outstanding') {
      const today = ledger.seoul(new Date()).date;
      return { filename: `instalments-due-${today}.csv`, csv: reports.csv(CSV.outstanding, await outstandingRows()) };
    }
    const p = periodOf(input);
    const lines = await linesOf(p);
    return { filename: `ledger-${p.key.replace(/\.\./, '_to_')}.csv`, csv: reports.csv(CSV.lines, lines), count: lines.length };
  },

  // Everything one customer bought and paid: their orders and every ledger line, with totals per currency.
  // Useful for a receipt request or a dispute. Found by email (or the customer's id).
  async 'shop-customer-statement'(input) {
    const byId = input.customer ? int(input.customer, { min: 1, max: 2147483647, label: 'customer' }) : null;
    const email = byId ? '' : text(input.email, { max: 254, required: true, label: 'email' }).toLowerCase();
    const customer = await db.one(
      `SELECT id, email, name, phone, country, postcode, address1, address2, created_at FROM shop_customers WHERE ($1::int IS NOT NULL AND id = $1) OR ($1::int IS NULL AND email = $2)`,
      [byId, email]);
    if (!customer) throw userError('no customer with this email', 404);
    const [orders, lines] = await Promise.all([
      db.query(
        `SELECT id, number, product_name, price_option->>'label' AS option, currency, plan, plan_status, subtotal, discount, total,
                paid_total, refunded_total, status, origin, coupon_code, created_at, paid_at
           FROM shop_orders WHERE customer_id = $1 ORDER BY created_at, id`, [customer.id]),
      db.query(
        `SELECT l.id, l.at, l.kind, l.provider, l.method, l.currency, l.amount, l.supply, l.vat, l.vat_rule, l.fee,
                l.fx_rate::float8 AS fx_rate, l.amount_krw, l.order_id, o.number, o.product_name,
                p.provider_ref, p.approval_no, p.receipt_url, p.instalment_no
           FROM shop_ledger l JOIN shop_orders o ON o.id = l.order_id LEFT JOIN shop_payments p ON p.id = l.payment_id
          WHERE o.customer_id = $1 ORDER BY l.at, l.id`, [customer.id]),
    ]);
    return { customer, orders, lines, totals: ledger.totals(lines) };
  },

  // The monthly copies of the ledger in the private Blob store (api/_lib/shop/backup.js), with download links.
  async 'shop-backups'() {
    return require('../shop/backup.js').list();
  },

  // Writes the monthly copies now, replacing the existing files (after exchange rates were typed, for example).
  async 'shop-backup-run'() {
    const r = await require('../shop/backup.js').run({ replace: true });
    return { ...r, target: 'ledger backups', log: r };
  },

  /*
   * The exchange rate of USD ledger lines (won per dollar, and where it came from): for one line, or for every
   * line of one Seoul day. Lines that already have a rate keep it unless `replace` is set. The won value is
   * recomputed from the rate (ledger.wonValue: rounded to the won, a refund like its sale). The ledger's trigger
   * lets only these three columns change.
   */
  async 'shop-fx-set'(input, { admin }) {
    const rate = rateOf(input.rate);
    const source = text(input.source, { max: 200, required: true, label: 'Rate source' });
    const replace = input.replace === true || input.replace === 'true';
    const line = input.line ? int(input.line, { min: 1, max: Number.MAX_SAFE_INTEGER, label: 'line' }) : null;
    const day = line ? null : date(input.date, { label: 'Date' });
    const stamped = `${source} (${admin || 'admin'})`;
    const rows = await db.query(
      `UPDATE shop_ledger
          SET fx_rate = $1::numeric, fx_source = $2,
              amount_krw = (sign(amount) * round(abs(amount)::numeric * $1::numeric / 100))::int
        WHERE currency = 'USD'
          AND ($3::bigint IS NULL OR id = $3)
          AND ($4::date IS NULL OR (at AT TIME ZONE 'Asia/Seoul')::date = $4::date)
          AND ($5 OR fx_rate IS NULL)
        RETURNING id`,
      [rate, stamped, line, day, replace]);
    if (line && !rows.length) {
      const l = await db.one('SELECT currency, fx_rate FROM shop_ledger WHERE id = $1', [line]);
      if (!l) throw userError('ledger line not found', 404);
      if (l.currency !== 'USD') throw userError('only USD lines have an exchange rate');
      throw userError('this line already has a rate: tick “Replace” to change it');
    }
    return {
      updated: rows.length,
      target: line ? `ledger line ${line}` : `USD lines of ${day}`,
      log: { rate: Number(rate), source, line, date: day, replace, updated: rows.length },
    };
  },
};

module.exports = { section: 'shop', actions, writes: ['shop-fx-set', 'shop-backup-run'], CSV, rateOf, linesOf };
