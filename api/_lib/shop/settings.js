/*
 * Shop settings edited in the admin (Shop → Settings), stored in shop_settings. Secrets never live here.
 */
const db = require('../db.js');

const DEFAULTS = {
  // Korean lines shown on the checkout; empty until Ashley provides the wording (an empty line isn't shown,
  // except the consent line, which falls back to the wording published on the WooCommerce checkout).
  checkout_texts: { consent: '', guarantee: '', secure_note: '', paypal_instalments: '' },
  // Slack messages (webhook addresses are Vercel env vars).
  notifications: { paid: true, refund: true, instalment_failed: true },
};

async function read() {
  const rows = await db.query('SELECT key, value FROM shop_settings');
  const out = JSON.parse(JSON.stringify(DEFAULTS));
  for (const r of rows) if (out[r.key] && r.value && typeof r.value === 'object') Object.assign(out[r.key], r.value);
  return out;
}

module.exports = { DEFAULTS, read };
