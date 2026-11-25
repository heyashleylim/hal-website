/*
 * Slack alerts for the shop (payments, and anything that needs a person). Incoming-webhook addresses are
 * Vercel env vars (SLACK_WEBHOOK_ASHLEY, SLACK_WEBHOOK_ALEX); which alerts go out is set in Shop → Settings.
 * An alert never makes a payment fail: errors are logged and swallowed. Outside production, messages start
 * with [TEST] so a trial payment on a preview is never mistaken for a sale.
 */
const pricing = require('./pricing.js');
const config = require('./config.js');

function webhooks(env = process.env) {
  return [env.SLACK_WEBHOOK_ASHLEY, env.SLACK_WEBHOOK_ALEX].map((u) => (u || '').trim()).filter((u) => /^https:\/\/hooks\.slack\.com\//.test(u));
}

async function send(text, { fetchImpl = fetch, env = process.env } = {}) {
  const body = JSON.stringify({ text: (config.isProduction(env) ? '' : '[TEST] ') + text });
  const results = await Promise.allSettled(webhooks(env).map((url) =>
    fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(4000) })));
  for (const r of results) if (r.status === 'rejected') console.error('shop: Slack alert failed', r.reason && r.reason.message);
  return results.length;
}

// The message sent for a payment received (same spirit as the WooCommerce one). Add-ons are listed after the product.
// `amount`: what was paid (default: what the order charges at checkout); `suffix`: e.g. " — instalment 2 of 3".
function paidText(order, method, items = [], { amount = null, suffix = '' } = {}) {
  const name = (order.billing || {}).name || '';
  const extras = (items || []).filter((i) => i.kind === 'addon').map((i) => ` + ${i.name}`).join('');
  const plan = !suffix && order.plan === 'instalment' && order.plan_terms ? ` — instalment 1 of ${order.plan_terms.count + 1}` : '';
  return `You've got MONEY!\nYAY!! Paid ${pricing.formatMoney(amount == null ? order.due_today : amount, order.currency)} 🎉${method ? ` (${method})` : ''}\n${name} - ${order.product_name}${order.price_option && order.price_option.label ? ` · ${order.price_option.label}` : ''}${extras} [${order.number}]${suffix || plan}`;
}

async function paid(order, method, settings, opts, items = [], extra = {}) {
  if (settings && settings.notifications && settings.notifications.paid === false) return 0;
  return send(paidText(order, method, items, extra), opts);
}

// Something a person must look at: a notice we refused, a second payment for one order, a refund made at the provider…
async function attention(title, lines, opts) {
  return send(`⚠️ Shop: ${title}\n${[].concat(lines).filter(Boolean).join('\n')}`, opts);
}

module.exports = { webhooks, send, paidText, paid, attention };
