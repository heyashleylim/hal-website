/*
 * Shop admin API: products, price quotes and shop settings (Shop section; actions are routed by api/admin.js).
 * Price rules live in ../shop/pricing.js. Plan: docs/commerce-plan.md.
 */
const db = require('../db.js');
const pricing = require('../shop/pricing.js');
const ledger = require('../shop/ledger.js');
const settings = require('../shop/settings.js');
const shopConfig = require('../shop/config.js');

const safe = (fn) => { try { return fn(); } catch (_) { return null; } };
const { userError, text, int, friendlyUnique } = require('./util.js');

const STATUSES = ['draft', 'open', 'closed'];
// /checkout/complete is the thank-you page; the other two are WooCommerce addresses still redirected to WordPress.
const RESERVED_SLUGS = ['complete', 'order-received', 'order-pay'];
const MAX_WON = 100000000;   // ₩100,000,000
const MAX_CENTS = 10000000;  // $100,000

// '' → null; whole won.
function won(value, label) {
  return int(value, { min: 1000, max: MAX_WON, label, optional: true });
}

// Dollars as typed ("2299", "2,299", "19.50") → cents; '' → null.
function cents(value, label) {
  const s = String(value == null ? '' : value).trim().replace(/,/g, '');
  if (!s) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) throw userError(`${label} must be an amount in dollars, like 2299 or 19.50`);
  const [d, c = ''] = s.split('.');
  const n = Number(d) * 100 + Number(c.padEnd(2, '0'));
  if (n < 100 || n > MAX_CENTS) throw userError(`${label} must be between $1 and $100,000`);
  return n;
}

// A date and time typed in the admin as Seoul time ('YYYY-MM-DDTHH:MM') → ISO instant; '' → null. Seoul has no summer time.
function seoulTime(value, label) {
  const s = String(value == null ? '' : value).trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw userError(`${label} must be a date and time`);
  const at = new Date(`${s}:00+09:00`);
  if (Number.isNaN(at.getTime())) throw userError(`${label} must be a date and time`);
  return at.toISOString();
}

// "a, b" or one per line → ['a', 'b'] (trimmed, no blanks, no repeats).
function list(value, { max, each, label }) {
  const items = [...new Set((Array.isArray(value) ? value : String(value == null ? '' : value).split(/[\n,]/)).map((x) => String(x).trim()).filter(Boolean))];
  if (items.length > max) throw userError(`${label}: at most ${max}`);
  for (const item of items) if (item.length > each) throw userError(`${label}: "${item.slice(0, 30)}…" is too long (max ${each} characters)`);
  return items;
}

// Text that keeps its line breaks (the first line is a title): trimmed lines, no blank ones.
function lines(value, { max, label }) {
  const s = String(value == null ? '' : value).split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join('\n');
  if (s.length > max) throw userError(`${label} is too long (max ${max} characters)`);
  return s;
}

// Text in paragraphs: line breaks and single empty lines kept, trimmed, at most `max` characters.
function lines2(value, { max, label }) {
  const s = String(value == null ? '' : value).replace(/\r/g, '').split('\n').map((x) => x.trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (s.length > max) throw userError(`${label} is too long (max ${max} characters)`);
  return s;
}

// Reviews for the checkout, typed as blocks separated by an empty line; a last line starting with a dash is
// the name ("— 김00, 회사원"). The text is kept exactly as typed (CLAUDE.md: testimonials are verbatim).
function testimonials(value) {
  if (Array.isArray(value)) value = value.map((r) => (r && r.text ? r.text + (r.name ? '\n— ' + r.name : '') : '')).join('\n\n');
  const blocks = String(value == null ? '' : value).replace(/\r/g, '').split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length > 6) throw userError('Reviews: at most 6 on the checkout');
  return blocks.map((block) => {
    const rows = block.split('\n');
    const last = rows[rows.length - 1].trim();
    const named = rows.length > 1 && /^[—–-]\s*\S/.test(last);
    const body = (named ? rows.slice(0, -1) : rows).join('\n').trim();
    const name = named ? last.replace(/^[—–-]\s*/, '').trim() : '';
    if (body.length > 1200) throw userError('Reviews: one review is too long for the checkout (max 1,200 characters)');
    if (name.length > 80) throw userError('Reviews: a name is too long');
    return { text: body, name };
  });
}

// Checks what the product form sends and returns the columns to store. Pure: tested in tests/shop/admin-shop.test.js.
function productInput(input) {
  const name = text(input.name, { max: 120, required: true, label: 'Name' });
  const slug = text(input.slug, { max: 60, required: true, label: 'Address' }).toLowerCase();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw userError('Address can only use lowercase letters, numbers and hyphens (e.g. nsmb, eft-masterclass)');
  if (RESERVED_SLUGS.includes(slug)) throw userError(`"${slug}" is an address the site already uses: choose another`);
  const status = String(input.status || 'draft');
  if (!STATUSES.includes(status)) throw userError('Status must be draft, open or closed');

  const price_krw = won(input.price_krw, 'KRW price');
  const price_usd = cents(input.price_usd, 'USD price');
  if (price_krw == null && price_usd == null) throw userError('Give the product a KRW price, a USD price, or both');

  const instalment_first = won(input.instalment_first, 'First payment');
  const instalment_monthly = won(input.instalment_monthly, 'Monthly payment');
  const instalment_count = int(input.instalment_count, { min: 1, max: 24, label: 'Number of monthly payments', optional: true });
  const parts = [instalment_first, instalment_monthly, instalment_count].filter((x) => x != null).length;
  if (parts !== 0 && parts !== 3) throw userError('The instalment plan needs all three: first payment, monthly payment and number of monthly payments (or leave all three empty)');
  if (parts === 3 && price_krw == null) throw userError('The instalment plan is for KRW: add a KRW price');

  const sale_starts_at = seoulTime(input.sale_starts_at, 'Sale start');
  const sale_ends_at = seoulTime(input.sale_ends_at, 'Sale end');
  if (sale_starts_at && sale_ends_at && sale_starts_at >= sale_ends_at) throw userError('Sale end must be after sale start');

  const usd_vat = String(input.usd_vat || 'taxable');
  if (usd_vat !== 'taxable' && usd_vat !== 'zero') throw userError('USD VAT must be taxable or zero');

  const purchase_tag = text(input.purchase_tag, { max: 100, label: 'Purchase tag' });
  if (/[,\s]/.test(purchase_tag)) throw userError('Purchase tag is one ActiveCampaign tag, without spaces or commas (e.g. purchased_eft)');
  const extra_tags = list(input.extra_tags, { max: 20, each: 100, label: 'Extra tags' });
  const legacy_ids = list(input.legacy_ids, { max: 10, each: 9, label: 'WooCommerce ids' }).map((x) => int(x, { min: 1, max: 2147483647, label: 'WooCommerce id' }));

  // Add-ons: which add-ons this product's checkout offers (ids, in order), whether this product is sold only as
  // an add-on, and its regular price (shown crossed out next to the add-on price).
  const addon_ids = list(input.addon_ids, { max: 6, each: 10, label: 'Add-ons' }).map((x) => int(x, { min: 1, max: 2147483647, label: 'add-on' }));
  const addon_only = input.addon_only === true || input.addon_only === 'true' || input.addon_only === 'on';
  if (addon_only && addon_ids.length) throw userError('A product sold only as an add-on can’t offer add-ons itself');
  const compare_krw = won(input.compare_krw, 'Regular KRW price');
  const compare_usd = cents(input.compare_usd, 'Regular USD price');
  if (compare_krw != null && price_krw == null) throw userError('A regular KRW price needs a KRW price');
  if (compare_usd != null && price_usd == null) throw userError('A regular USD price needs a USD price');

  const c = input.content && typeof input.content === 'object' ? input.content : {};
  const image = text(c.image, { max: 300, label: 'Image' });
  if (image && !/^\/[A-Za-z0-9/_.-]+\.(webp|jpg|jpeg|png)$/.test(image)) throw userError('Image must be a site path to a picture, like /assets/img/shop/nsmb.webp');
  const page = text(c.page, { max: 100, label: 'Program page' });
  if (page && !/^\/[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(page)) throw userError('Program page must be a page of this site, like /eft or /nsmb');
  const content = {
    summary: text(c.summary, { max: 300, label: 'Summary' }),
    included: list(c.included, { max: 12, each: 200, label: 'What’s included' }),
    image,
    thanks: text(c.thanks, { max: 2000, label: 'Thank-you text' }),
    page,
    guarantee: lines(c.guarantee, { max: 800, label: 'Guarantee' }),
    testimonials: testimonials(c.testimonials),
    addon_details: lines2(c.addon_details, { max: 2000, label: 'Add-on description' }),
    addon_note: text(c.addon_note, { max: 300, label: 'Add-on note' }),
  };

  return { name, slug, status, sale_starts_at, sale_ends_at, price_krw, price_usd, instalment_first, instalment_monthly, instalment_count, usd_vat, purchase_tag, extra_tags, legacy_ids, content, addon_ids, addon_only, compare_krw, compare_usd };
}

// Every way the product can be bought, priced: [{ currency, plan, total, dueToday, vat, payments, label }].
function priced(product) {
  return pricing.options(product).map((o) => {
    const q = pricing.quote(product, o);
    return { ...q, label: pricing.formatMoney(q.total, q.currency), dueTodayLabel: pricing.formatMoney(q.dueToday, q.currency) };
  });
}

// Things worth a second look before opening a product (shown in the admin, never blocking).
function warnings(product, all = []) {
  const out = [];
  const plan = pricing.instalmentPlan(product);
  if (plan && product.price_krw != null && plan.total < product.price_krw) out.push('The instalment plan adds up to less than the pay-in-full price.');
  if (product.status === 'open' && !product.purchase_tag) out.push('No purchase tag: buyers would not be tagged in ActiveCampaign.');
  if (product.compare_krw != null && product.price_krw != null && product.compare_krw <= product.price_krw) out.push('The regular KRW price is not higher than the price, so it is not shown.');
  if (product.compare_usd != null && product.price_usd != null && product.compare_usd <= product.price_usd) out.push('The regular USD price is not higher than the price, so it is not shown.');
  // Add-ons that the checkout would leave out right now (pass the other products as `all`).
  for (const id of product.addon_ids || []) {
    const a = all.find((x) => x.id === id);
    if (!a) continue;
    if (!pricing.saleState(a).open) out.push(`Add-on “${a.name}” is not on sale, so it is not offered.`);
    else for (const [cur, has] of [['KRW', product.price_krw != null], ['USD', product.price_usd != null]]) {
      if (has && (cur === 'KRW' ? a.price_krw : a.price_usd) == null) out.push(`Add-on “${a.name}” has no ${cur} price, so it is not offered on the ${cur} checkout.`);
    }
  }
  return out;
}

function shape(row, now, all = []) {
  return { ...row, sale: pricing.saleState(row, now), options: priced(row), warnings: warnings(row, all) };
}

const COLUMNS = ['name', 'slug', 'status', 'sale_starts_at', 'sale_ends_at', 'price_krw', 'price_usd', 'instalment_first', 'instalment_monthly', 'instalment_count', 'usd_vat', 'purchase_tag', 'extra_tags', 'legacy_ids', 'content', 'addon_ids', 'addon_only', 'compare_krw', 'compare_usd'];
const CAST = { extra_tags: '::text[]', legacy_ids: '::int[]', addon_ids: '::int[]', addon_only: '::boolean', content: '::jsonb', sale_starts_at: '::timestamptz', sale_ends_at: '::timestamptz' };

async function getProduct(id) {
  const row = await db.one('SELECT * FROM shop_products WHERE id = $1', [id]);
  if (!row) throw userError('product not found', 404);
  return row;
}

const SETTINGS = settings.DEFAULTS;

function settingsInput(input) {
  const t = input.checkout_texts || {};
  const n = input.notifications || {};
  return {
    checkout_texts: Object.fromEntries(Object.keys(SETTINGS.checkout_texts).map((k) => [k, text(t[k], { max: 500, label: k })])),
    notifications: Object.fromEntries(Object.keys(SETTINGS.notifications).map((k) => [k, n[k] !== false && n[k] !== 'false'])),
  };
}

const readSettings = settings.read;

const actions = {
  async 'shop-products'() {
    const rows = await db.query(
      `SELECT p.*, count(o.id)::int AS orders, count(o.id) FILTER (WHERE o.paid_at IS NOT NULL)::int AS paid_orders,
              (SELECT count(*)::int FROM shop_order_items i JOIN shop_orders x ON x.id = i.order_id
                WHERE i.product_id = p.id AND i.kind = 'addon' AND x.paid_at IS NOT NULL) AS paid_addon_sales
         FROM shop_products p LEFT JOIN shop_orders o ON o.product_id = p.id
        GROUP BY p.id ORDER BY (p.status = 'open') DESC, p.name`,
    );
    const now = new Date();
    return { products: rows.map((r) => shape(r, now, rows)) };
  },

  async 'shop-product-save'(input) {
    const id = input.id ? int(input.id, { min: 1, max: 2147483647, label: 'id' }) : null;
    if (id) await getProduct(id);
    const p = productInput(input);
    if (id && p.addon_ids.includes(id)) throw userError('A product can’t be its own add-on');
    if (p.addon_ids.length) {
      const found = await db.query('SELECT id, name, addon_only, addon_ids FROM shop_products WHERE id = ANY($1::int[])', [p.addon_ids]);
      if (found.length !== p.addon_ids.length) throw userError('One of the chosen add-ons no longer exists: reload the page');
    }
    const values = COLUMNS.map((c) => (c === 'content' ? JSON.stringify(p[c]) : p[c]));
    const sql = id
      ? `UPDATE shop_products SET ${COLUMNS.map((c, i) => `${c} = $${i + 2}${CAST[c] || ''}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`
      : `INSERT INTO shop_products (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((c, i) => `$${i + 1}${CAST[c] || ''}`).join(', ')}) RETURNING *`;
    const row = await friendlyUnique(db.one(sql, id ? [id, ...values] : values), { shop_products_slug_key: `another product already uses the address "${p.slug}"` });
    const all = await db.query('SELECT * FROM shop_products');
    return { product: shape(row, new Date(), all), target: `product ${row.id} (${row.slug})` };
  },

  // Only a product that was never ordered can be deleted; otherwise close it (its orders and tax lines stay).
  async 'shop-product-delete'(input) {
    const product = await getProduct(int(input.id, { min: 1, max: 2147483647, label: 'id' }));
    const { n } = await db.one(
      `SELECT (SELECT count(*) FROM shop_orders WHERE product_id = $1) + (SELECT count(*) FROM shop_order_items WHERE product_id = $1 AND kind = 'addon') AS n`, [product.id]);
    if (Number(n) > 0) throw userError(`this product has ${n} order(s), so it can't be deleted: set its status to Closed instead`);
    // No checkout keeps offering a product that is gone.
    await db.tx([
      ['UPDATE shop_products SET addon_ids = array_remove(addon_ids, $1), updated_at = now() WHERE $1 = ANY(addon_ids)', [product.id]],
      ['DELETE FROM shop_products WHERE id = $1', [product.id]],
    ]);
    return { deleted: product.id, target: `product ${product.id} (${product.slug})` };
  },

  // The price of one purchase, exactly as the checkout will compute it, with the dates of an instalment plan started today.
  async 'shop-quote'(input) {
    const slug = text(input.slug, { max: 60, required: true, label: 'product' });
    const product = await db.one('SELECT * FROM shop_products WHERE slug = $1', [slug]);
    if (!product) throw userError('product not found', 404);
    const q = pricing.quote(product, { currency: String(input.currency || 'KRW').toUpperCase(), plan: String(input.plan || 'full') });
    const dates = pricing.schedule(ledger.seoul(new Date()).date, q.payments.length);
    return {
      product: { slug: product.slug, name: product.name },
      sale: pricing.saleState(product),
      quote: {
        ...q,
        payments: q.payments.map((pay, i) => ({ ...pay, due: dates[i], label: pricing.formatMoney(pay.amount, q.currency) })),
        totalLabel: pricing.formatMoney(q.total, q.currency),
        dueTodayLabel: pricing.formatMoney(q.dueToday, q.currency),
        supplyLabel: pricing.formatMoney(q.supply, q.currency),
        vatLabel: pricing.formatMoney(q.vat, q.currency),
      },
    };
  },

  async 'shop-settings'() {
    const present = (name) => Boolean((process.env[name] || '').trim());
    return {
      settings: await readSettings(),
      // Connection status: names only, never values. Used from phase 2 on.
      connections: {
        secret: shopConfig.configured(),
        ciderpay: shopConfig.ciderpayConfigured(),
        paypal: shopConfig.paypalConfigured(),
        paypal_webhook: present('PAYPAL_WEBHOOK_ID'),
        paypal_mode: shopConfig.paypalMode(),
        slack: present('SLACK_WEBHOOK_ASHLEY') || present('SLACK_WEBHOOK_ALEX'),
        activecampaign: present('AC_API_URL') && present('AC_API_KEY'),
        bypass: shopConfig.isProduction() || present('VERCEL_AUTOMATION_BYPASS_SECRET'),
        production: shopConfig.isProduction(),
        // Where the providers must send their notices (the CiderPay address is sent with each payment request).
        paypal_webhook_url: shopConfig.configured() ? safe(() => shopConfig.callbackUrl('paypal').replace(/x-vercel-protection-bypass=[^&]+/, 'x-vercel-protection-bypass=…')) : null,
        order_fields: require('../shop/sync.js').ORDER_FIELDS,
      },
    };
  },

  async 'shop-settings-save'(input) {
    const s = settingsInput(input);
    await db.tx(Object.entries(s).map(([key, value]) => [
      `INSERT INTO shop_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    ]));
    return { settings: await readSettings(), target: 'shop settings', log: s };
  },
};

const writes = ['shop-product-save', 'shop-product-delete', 'shop-settings-save'];

module.exports = { section: 'shop', actions, writes, productInput, settingsInput, cents, seoulTime, warnings, testimonials };
