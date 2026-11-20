/*
 * /api/shop?action=… — what the checkout page calls.
 *
 *   POST order    the checkout form (JSON from checkout.js, or a plain form post without JavaScript)
 *                 → the provider's payment page: { redirect } as JSON, or a 303 for a form post.
 *                 The only inputs that matter are the product, the currency (= payment method: KRW card,
 *                 USD PayPal), the plan, the pricing option, the add-ons ticked (addon_<id>) and the buyer's
 *                 details: every amount is computed here from the products.
 *   POST coupon   { slug, code } from checkout.js's "적용" → { coupon: { code, label, off } } (the discount on every
 *                 option and currency the page shows) or { error: 'coupon', fields: { coupon: <reason> } }.
 *                 Without JavaScript the button opens the checkout again with ?coupon=… (api/shop-page.js applies it).
 *                 The order itself carries the code applied (`coupon`), checked again with the buyer's email.
 *   POST pay      { o } from a payment link (/checkout/pay/<token>, an order made in the admin) → 303 to the
 *                 provider's payment page, or back to the link with ?problem=… . The order's amounts are fixed.
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
const coupons = require('./_lib/shop/coupons.js');
const manual = require('./_lib/shop/manual.js');
const { readBody, sendJson, sendHtml, redirect, sameOrigin } = require('./_lib/shop/http.js');
const { CheckoutError } = orders;

const STATUS = { invalid: 422, coupon: 422, closed: 409, unavailable: 409, addon_unavailable: 409, option_unavailable: 409, currency_changed: 409, plan_changed: 409, plan_card_only: 409, too_many: 429, provider: 502, not_configured: 503, server: 500 };

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
    const shopSettings = await settings.read();
    const offers = orders.offers(product, flow.providers(), { instalments: shopSettings.instalments.enabled === true });
    const sale = pricing.saleState(product);
    if (!sale.open || !offers.some((o) => o.currency === currency)) return sendHtml(res, status === 422 ? 409 : status, page.closedPage({ product, reason: sale.reason || 'closed' }));
    const hasPlan = offers.some((o) => o.plan === 'instalment');
    const plan = code !== 'plan_card_only' && String(data.plan || '') === 'instalment' && hasPlan ? 'instalment' : 'full';
    const addons = await addonsByCurrency(product, offers);
    const typed = coupons.normalize(data.coupon);
    const coupon = fields && fields.coupon ? { code: typed, error: fields.coupon } : await pageCoupon(product, offers, typed, config.ipHash(req), hasPlan ? 'both' : 'full');
    const errors = fields && fields.coupon ? Object.fromEntries(Object.entries(fields).filter(([k]) => k !== 'coupon')) : fields;
    return sendHtml(res, status, page.checkoutPage({ product, offers, currency, addons, values: data, errors, problem: code, settings: shopSettings, query: data, coupon, plan }));
  };

  // An add-on is only sold with the product that offers it, never on its own.
  if (!product || product.status === 'draft' || product.addon_only) return wantsJson ? sendJson(res, 404, { error: 'closed' }) : sendHtml(res, 404, page.notFoundPage());
  if (!config.configured()) {
    console.error('shop: SHOP_SECRET is not set, orders cannot be taken');
    return fail('not_configured');
  }
  // Without JavaScript the prices on the page don't follow the payment method: a buyer who picked the other
  // method (card ↔ PayPal, so another currency) first sees the page again in that currency, then pays.
  const shown = String(data.shown_currency || '').toUpperCase();
  if (!wantsJson && (shown === 'KRW' || shown === 'USD') && shown !== currency) return fail('currency_changed');
  // The plan is paid by card in won only. Without JavaScript the order shown follows the plan picked when the page
  // was made: another plan picked since → the page again with its amounts (today, then each month), then pay.
  const plan = String(data.plan || 'full');
  if (plan === 'instalment' && currency === 'USD') return fail('plan_card_only');
  const shownPlan = String(data.shown_plan || '');
  if (!wantsJson && (shownPlan === 'full' || shownPlan === 'instalment') && shownPlan !== plan) return fail('plan_changed');

  try {
    const started = await flow.start({
      product, currency, plan, input: data, source: data, ipHash: config.ipHash(req),
    });
    return wantsJson ? sendJson(res, 200, { redirect: started.redirect }) : redirect(res, 303, started.redirect);
  } catch (err) {
    if (err instanceof CheckoutError) return fail(err.code, err.fields);
    console.error('shop: order', err);
    return fail('server');
  }
}

// The coupon to show on a page made again: applied, or why it can't be used (null without a code).
async function pageCoupon(product, offers, code, ipHash, plan = 'full') {
  if (!code) return null;
  try {
    return await coupons.forPage({ code, product, currencies: [...new Set(offers.map((o) => o.currency))], plan, ipHash });
  } catch (err) {
    if (err instanceof coupons.CouponError) return { code, error: err.code === 'too_many' ? 'coupon_unknown' : err.code };
    throw err;
  }
}

// "적용" with JavaScript: the discount this code gives on every price the page can show.
async function coupon(req, res) {
  const { data } = await readBody(req);
  const product = await orders.productBySlug(data.slug);
  if (!product || product.status === 'draft' || product.addon_only) return sendJson(res, 404, { error: 'closed' });
  const offers = orders.offers(product, flow.providers(), { instalments: (await settings.read()).instalments.enabled === true });
  if (!pricing.saleState(product).open || !offers.length) return sendJson(res, 409, { error: 'closed' });
  const code = coupons.normalize(data.code);
  if (!code) return sendJson(res, 422, { error: 'coupon', fields: { coupon: 'coupon_unknown' } });
  const plan = offers.some((o) => o.plan === 'instalment') ? 'both' : 'full';
  try {
    const found = await coupons.forPage({ code, product, currencies: [...new Set(offers.map((o) => o.currency))], plan, ipHash: config.ipHash(req) });
    return sendJson(res, 200, { coupon: found });
  } catch (err) {
    if (!(err instanceof coupons.CouponError)) throw err;
    if (err.code === 'too_many') return sendJson(res, 429, { error: 'too_many' });
    return sendJson(res, 422, { error: 'coupon', fields: { coupon: err.code } });
  }
}

// The add-ons the checkout offers, per currency it is sold in (the page switches between them with the payment method).
async function addonsByCurrency(product, offers) {
  const out = {};
  for (const cur of [...new Set(offers.map((o) => o.currency))]) out[cur] = await orders.addonChoices(product, cur);
  return out;
}

// The button of a payment link. Always answers with a redirect: the payment page, or the link with what went wrong.
async function payLink(req, res) {
  const { data } = await readBody(req);
  const order = await orders.byToken(String(data.o || ''));
  if (!order || order.origin !== 'manual') return sendHtml(res, 404, page.notFoundPage());
  const back = (problem) => redirect(res, 303, `/checkout/pay/${encodeURIComponent(order.token)}${problem ? `?problem=${problem}` : ''}`);
  if (manual.linkState(order)) return back('');
  try {
    flow.guardDatabase();
    const product = await flow.productOf(order);
    const addonCount = (await orders.items(order.id)).filter((i) => i.kind === 'addon').length;
    const target = await flow.requestPage(order, product, { addonCount, cancelUrl: `${config.payLinkUrl(order.token)}?problem=cancelled` });
    return redirect(res, 303, target);
  } catch (err) {
    if (err instanceof CheckoutError) return back(err.code === 'not_configured' || err.code === 'unavailable' ? err.code : 'provider');
    console.error('shop: pay link', err);
    return back('server');
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
    if (action === 'order' || action === 'after' || action === 'coupon' || action === 'pay') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST required' });
      if (!sameOrigin(req)) return sendJson(res, 403, { error: 'bad origin' });
      if (action === 'pay') return await payLink(req, res);
      return action === 'order' ? await order(req, res) : action === 'coupon' ? await coupon(req, res) : await after(req, res);
    }
    return sendJson(res, 404, { error: 'unknown action' });
  } catch (err) {
    console.error('shop', action, err);
    return sendJson(res, err.status === 413 ? 413 : 500, { error: 'server' });
  }
};
