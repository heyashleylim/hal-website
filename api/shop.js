/*
 * /api/shop?action=… — what the checkout page calls.
 *
 *   POST order    the checkout form (JSON from checkout.js, or a plain form post without JavaScript)
 *                 → the provider's payment page: { redirect } as JSON, or a 303 for a form post.
 *                 The only inputs that matter are the product, the currency, the plan, the add-ons ticked
 *                 (addon_<id>) and the buyer's details: every amount is computed here from the products.
 *   GET  status   ?o=<order token> → { status: 'paid' | 'pending' | 'ended' | 'refunded' | 'unknown' }
 *                 (the thank-you page asks until the provider's confirmation has arrived)
 *   POST after    { o, tracked } from the thank-you page: remembers that the purchase event reached GTM,
 *                 and sends the order's ActiveCampaign updates if any are still waiting.
 */
const orders = require('./_lib/shop/orders.js');
const flow = require('./_lib/shop/flow.js');
const config = require('./_lib/shop/config.js');
const settings = require('./_lib/shop/settings.js');
const sync = require('./_lib/shop/sync.js');
const pricing = require('./_lib/shop/pricing.js');
const page = require('./_lib/shop/page.js');
const { readBody, sendJson, sendHtml, redirect, sameOrigin } = require('./_lib/shop/http.js');
const { CheckoutError } = orders;

const STATUS = { invalid: 422, closed: 409, unavailable: 409, addon_unavailable: 409, too_many: 429, provider: 502, not_configured: 503, server: 500 };

async function order(req, res) {
  const wantsJson = /json/i.test(String(req.headers['content-type'] || ''));
  const { data } = await readBody(req);
  const currency = String(data.currency || 'KRW').toUpperCase() === 'USD' ? 'USD' : 'KRW';
  const product = await orders.productBySlug(data.slug);

  const fail = async (code, fields = null) => {
    const status = STATUS[code] || 500;
    if (wantsJson) return sendJson(res, status, { error: code, fields: fields || undefined });
    // Without JavaScript: the same page again, with what was typed and what to fix.
    if (!product || product.status === 'draft' || product.addon_only) return sendHtml(res, 404, page.notFoundPage());
    const offers = orders.offers(product, flow.providers());
    const sale = pricing.saleState(product);
    if (!sale.open || !offers.some((o) => o.currency === currency)) return sendHtml(res, status === 422 ? 409 : status, page.closedPage({ product, reason: sale.reason || 'closed' }));
    const addons = await orders.addonChoices(product, currency);
    return sendHtml(res, status, page.checkoutPage({ product, offers, currency, addons, values: data, errors: fields, problem: code, settings: await settings.read(), query: data }));
  };

  // An add-on is only sold with the product that offers it, never on its own.
  if (!product || product.status === 'draft' || product.addon_only) return wantsJson ? sendJson(res, 404, { error: 'closed' }) : sendHtml(res, 404, page.notFoundPage());
  if (!config.configured()) {
    console.error('shop: SHOP_SECRET is not set, orders cannot be taken');
    return fail('not_configured');
  }
  try {
    const started = await flow.start({
      product, currency, plan: String(data.plan || 'full'), input: data, source: data, ipHash: config.ipHash(req),
    });
    return wantsJson ? sendJson(res, 200, { redirect: started.redirect }) : redirect(res, 303, started.redirect);
  } catch (err) {
    if (err instanceof CheckoutError) return fail(err.code, err.fields);
    console.error('shop: order', err);
    return fail('server');
  }
}

async function status(req, res, url) {
  const row = await orders.byToken(url.searchParams.get('o'));
  if (!row) return sendJson(res, 404, { status: 'unknown' });
  const state = row.status === 'refunded' ? 'refunded' : row.paid_at ? 'paid' : row.status === 'expired' || row.status === 'cancelled' ? 'ended' : 'pending';
  return sendJson(res, 200, { status: state });
}

async function after(req, res) {
  const { data } = await readBody(req);
  const row = await orders.byToken(data.o);
  if (!row || !row.paid_at) return sendJson(res, 404, { ok: false });
  if (data.tracked === true || data.tracked === 'true') await orders.markTracked(row.token);
  let sent = null;
  try { sent = await sync.process({ orderId: row.id, budgetMs: 8000 }); } catch (err) { console.error('shop: after', err); }
  return sendJson(res, 200, { ok: true, pending: sent && sent.left != null ? sent.left : null });
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  const action = url.searchParams.get('action') || '';
  try {
    if (action === 'status') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: 'GET required' });
      return await status(req, res, url);
    }
    if (action === 'order' || action === 'after') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST required' });
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'bad origin' });
      return action === 'order' ? await order(req, res) : await after(req, res);
    }
    return sendJson(res, 404, { error: 'unknown action' });
  } catch (err) {
    console.error('shop', action, err);
    return sendJson(res, err.status === 413 ? 413 : 500, { error: 'server' });
  }
};
