/*
 * The shop's pages (rewrites in vercel.json):
 *   GET /checkout/<product>   → ?view=checkout&slug=<product>   the checkout form (?plan=instalment: 분할 결제 preselected)
 *   GET /checkout/complete    → ?view=complete&o=<order token>  where the buyer lands after the payment page
 *   GET /checkout/pay/<token> → ?view=pay&o=<order token>       the payment link of an order made in the admin
 *                                (&i=<n>: the payment link of one instalment of a plan)
 *
 * Server-rendered (api/_lib/shop/page.js). The thank-you page never marks an order paid because someone
 * opened it: only a provider's confirmation does. For PayPal, opening it is the moment we capture the payment
 * the buyer just approved, and the capture's answer is what counts.
 */
const orders = require('./_lib/shop/orders.js');
const flow = require('./_lib/shop/flow.js');
const pricing = require('./_lib/shop/pricing.js');
const settings = require('./_lib/shop/settings.js');
const page = require('./_lib/shop/page.js');
const coupons = require('./_lib/shop/coupons.js');
const manual = require('./_lib/shop/manual.js');
const instalments = require('./_lib/shop/instalments.js');
const config = require('./_lib/shop/config.js');
const { sendHtml, redirect } = require('./_lib/shop/http.js');

const PROBLEMS = new Set(['cancelled', 'declined', 'provider', 'server']);
const SLOW_AFTER = 8; // reloads without JavaScript before the page stops reloading itself

async function checkout(req, res, url) {
  const product = await orders.productBySlug(url.searchParams.get('slug'));
  // A product sold only as an add-on has no checkout of its own.
  if (!product || product.status === 'draft' || product.addon_only) return sendHtml(res, 404, page.notFoundPage());
  const sale = pricing.saleState(product);
  const shopSettings = await settings.read();
  const offers = orders.offers(product, flow.providers(), { instalments: shopSettings.instalments.enabled === true });
  if (!sale.open || !offers.length) return sendHtml(res, 200, page.closedPage({ product, reason: sale.reason || 'closed' }));
  const wanted = String(url.searchParams.get('currency') || '').toUpperCase();
  const currency = offers.some((o) => o.currency === wanted) ? wanted : offers[0].currency;
  // ?plan=instalment opens the checkout with 분할 결제 already chosen (when this product has a plan on sale).
  const hasPlan = offers.some((o) => o.plan === 'instalment');
  const plan = url.searchParams.get('plan') === 'instalment' && hasPlan ? 'instalment' : 'full';
  const problem = PROBLEMS.has(url.searchParams.get('problem')) ? url.searchParams.get('problem') : '';
  const addons = {};
  for (const cur of [...new Set(offers.map((o) => o.currency))]) addons[cur] = await orders.addonChoices(product, cur);
  // A code in the link (?coupon=…, as ActiveCampaign emails send it) is applied without typing.
  let coupon = null;
  const code = coupons.normalize(url.searchParams.get('coupon'));
  if (code) {
    try {
      coupon = await coupons.forPage({ code, product, currencies: [...new Set(offers.map((o) => o.currency))], plan: hasPlan ? 'both' : 'full', ipHash: config.ipHash(req) });
    } catch (err) {
      if (!(err instanceof coupons.CouponError)) throw err;
      coupon = { code, error: err.code === 'too_many' ? 'coupon_unknown' : err.code };
    }
  }
  return sendHtml(res, 200, page.checkoutPage({
    product, offers, currency, problem, addons, coupon, plan,
    settings: shopSettings, query: Object.fromEntries(url.searchParams),
  }));
}

// The order token from the address. Some payment pages append their own "?…" to the return address, which can
// leave junk after it ("abc…xyz?payState=1"): only the first 22 characters are the token.
function tokenFrom(url) {
  const m = /^[A-Za-z0-9_-]{22}/.exec(url.searchParams.get('o') || '');
  return m ? m[0] : '';
}

async function complete(req, res, url) {
  const token = tokenFrom(url);
  let order = await orders.byToken(token);
  // No token at all: the page reloaded after hiding it; its script brings the buyer back to their order.
  if (!order) return sendHtml(res, token || url.searchParams.has('o') ? 404 : 200, page.completePage({ order: null }));
  const product = await flow.productOf(order);

  // Back from PayPal: capture what the buyer approved. A failure here is not final (the webhook and a reload retry).
  if (order.provider === 'paypal' && (order.status === 'awaiting_payment' || order.status === 'created')) {
    try {
      const r = await flow.settlePaypal(order);
      order = r.order && r.order.id ? await orders.byToken(order.token) : order;
      if (r.outcome === 'declined' && product) return redirect(res, 303, `/checkout/${product.slug}?currency=usd&problem=declined`);
    } catch (err) {
      console.error(`shop-page: PayPal capture for order ${order.number} failed`, err);
    }
  }

  const tries = Math.max(0, Math.min(99, parseInt(url.searchParams.get('n') || '0', 10) || 0));
  const receiptUrl = order.paid_at ? await flow.receiptUrl(order.id) : '';
  const items = order.paid_at ? await orders.items(order.id) : [];
  const plan = order.paid_at && order.plan === 'instalment' ? await instalments.rowsOf(order.id) : [];
  return sendHtml(res, 200, page.completePage({ order, product, items, receiptUrl, plan, tries, slow: tries >= SLOW_AFTER }));
}

// A payment link: the order as made in the admin, and a button to its payment page. Paid → the thank-you page.
// ?i=<n>: the link for one instalment of a plan (instalments.makeLink).
async function pay(req, res, url) {
  if (url.searchParams.has('i')) return payInstalment(req, res, url);
  const order = await orders.byToken(tokenFrom(url));
  if (!order || order.origin !== 'manual') return sendHtml(res, 404, page.notFoundPage());
  const state = manual.linkState(order);
  if (state === 'paid') return redirect(res, 303, `/checkout/complete?o=${encodeURIComponent(order.token)}`);
  const problem = String(url.searchParams.get('problem') || '');
  return sendHtml(res, 200, page.payPage({
    order, items: await orders.items(order.id), state, lastDay: manual.linkLastDay(order),
    problem: ['cancelled', 'declined', 'provider', 'not_configured', 'unavailable', 'server'].includes(problem) ? problem : '',
    settings: await settings.read(),
  }));
}

async function payInstalment(req, res, url) {
  const order = await orders.byToken(tokenFrom(url));
  const number = parseInt(url.searchParams.get('i'), 10);
  if (!order || order.plan !== 'instalment' || !(number >= 2)) return sendHtml(res, 404, page.notFoundPage());
  const rows = await instalments.rowsOf(order.id);
  const row = rows.find((r) => r.number === number);
  if (!row) return sendHtml(res, 404, page.notFoundPage());
  const state = instalments.linkState(order, row);
  if (state === 'paid') return redirect(res, 303, `/checkout/complete?o=${encodeURIComponent(order.token)}`);
  const problem = String(url.searchParams.get('problem') || '');
  return sendHtml(res, 200, page.instalmentPayPage({
    order, row, count: rows.length, state, lastDay: instalments.linkLastDay(row),
    problem: ['provider', 'not_configured', 'unavailable', 'server'].includes(problem) ? problem : '',
    settings: await settings.read(),
  }));
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  const view = url.searchParams.get('view');
  // A payment page may send the buyer back with a form POST: the thank-you page answers it like a GET (it only
  // reads the order from the address; nothing in the posted body is used).
  const allowed = view === 'complete' ? ['GET', 'HEAD', 'POST'] : ['GET', 'HEAD'];
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '));
    return sendHtml(res, 405, page.errorPage());
  }
  try {
    if (view === 'complete') return await complete(req, res, url);
    if (view === 'pay') return await pay(req, res, url);
    return await checkout(req, res, url);
  } catch (err) {
    console.error('shop-page', err);
    return sendHtml(res, 503, page.errorPage());
  }
};
