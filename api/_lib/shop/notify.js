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

// The message sent for a payment received (same spirit as the WooCommerce one).
function paidText(order, method) {
  const name = (order.billing || {}).name || '';
  return `You've got MONEY!\nYAY!! Paid ${pricing.formatMoney(order.due_today, order.currency)} 🎉${method ? ` (${method})` : ''}\n${name} - ${order.product_name} [${order.number}]`;
}

async function paid(order, method, settings, opts) {
  if (settings && settings.notifications && settings.notifications.paid === false) return 0;
  return send(paidText(order, method), opts);
}

// Something a person must look at: a notice we refused, a second payment for one order, a refund made at the provider…
async function attention(title, lines, opts) {
  return send(`⚠️ Shop: ${title}\n${[].concat(lines).filter(Boolean).join('\n')}`, opts);
}

module.exports = { webhooks, send, paidText, paid, attention };
