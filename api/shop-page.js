/*
 * The shop's pages (rewrites in vercel.json):
 *   GET /checkout/<product>   → ?view=checkout&slug=<product>   the checkout form
 *   GET /checkout/complete    → ?view=complete&o=<order token>  where the buyer lands after the payment page
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
const { sendHtml, redirect } = require('./_lib/shop/http.js');

const PROBLEMS = new Set(['cancelled', 'declined', 'provider', 'server']);
const SLOW_AFTER = 8; // reloads without JavaScript before the page stops reloading itself

async function checkout(req, res, url) {
  const product = await orders.productBySlug(url.searchParams.get('slug'));
  if (!product || product.status === 'draft') return sendHtml(res, 404, page.notFoundPage());
  const sale = pricing.saleState(product);
  const offers = orders.offers(product);
  if (!sale.open || !offers.length) return sendHtml(res, 200, page.closedPage({ product, reason: sale.reason || 'closed' }));
  const wanted = String(url.searchParams.get('currency') || '').toUpperCase();
  const currency = offers.some((o) => o.currency === wanted) ? wanted : offers[0].currency;
  const problem = PROBLEMS.has(url.searchParams.get('problem')) ? url.searchParams.get('problem') : '';
  return sendHtml(res, 200, page.checkoutPage({
    product, offers, currency, problem, settings: await settings.read(), query: Object.fromEntries(url.searchParams),
  }));
}

async function complete(req, res, url) {
  let order = await orders.byToken(url.searchParams.get('o'));
  if (!order) return sendHtml(res, 404, page.completePage({ order: null }));
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
  return sendHtml(res, 200, page.completePage({ order, product, receiptUrl, tries, slow: tries >= SLOW_AFTER }));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendHtml(res, 405, page.errorPage());
  }
  const url = new URL(req.url, 'http://local');
  try {
    if (url.searchParams.get('view') === 'complete') return await complete(req, res, url);
    return await checkout(req, res, url);
  } catch (err) {
    console.error('shop-page', err);
    return sendHtml(res, 503, page.errorPage());
  }
};
