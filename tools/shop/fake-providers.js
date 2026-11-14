/*
 * Stand-ins for CiderPay and PayPal, for tools/shop/dev-server.js and tools/shop/e2e.js only.
 * They answer the same calls with the same field names as the real APIs (CiderPay: uddocs.net/v/ciderpay;
 * PayPal: Orders v2), and give a "payment page" with buttons for each thing a real buyer or provider can do:
 * pay, pay and never come back, send the notice twice, send a wrong amount, cancel…
 * No money, no network: nothing here ever talks to the real providers.
 */
const crypto = require('node:crypto');

function create({ base, memberId, apiToken }) {
  const cider = new Map();   // id → { body }
  const paypal = new Map();  // id → { body, status, declined }
  const sent = [];           // every notice the fakes sent: { provider, status, body }
  const id = (prefix) => prefix + crypto.randomBytes(5).toString('hex').toUpperCase();
  const html = (res, body) => { res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fake provider</title><body style="font:16px/1.6 system-ui;max-width:520px;margin:40px auto;padding:0 20px">${body}`); };
  const send = (res, status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  const go = (res, location) => { res.statusCode = 302; res.setHeader('Location', location); res.end(); };
  const readJson = async (req) => { const chunks = []; for await (const c of req) chunks.push(c); const t = Buffer.concat(chunks).toString('utf8'); try { return JSON.parse(t || '{}'); } catch (_) { return {}; } };
  const link = (href, label) => `<p><a id="${label.replace(/[^a-z]+/gi, '-').toLowerCase()}" href="${href}" style="display:block;padding:14px 18px;border:1px solid #222;border-radius:10px;text-decoration:none;color:#222">${label}</a></p>`;

  // ---------- CiderPay ----------
  // The feedback CiderPay posts (form-encoded) when a card is charged, for the request `rid`.
  function ciderpayFeedback(rid, overrides = {}) {
    const r = cider.get(rid);
    if (!r) throw new Error('unknown fake CiderPay request ' + rid);
    return {
      memberID: r.body.memberID, feedbackToken: 'FT' + rid, goodName: r.body.goodName, price: String(r.body.price),
      recvPhone: r.body.mobile, paymentState: 'COMPLETE', payType: '1', pts: 'CARD', pss: 'KEYIN', orderNo: 'CP' + rid,
      approvalNo: '30012345', ccname: '신한카드', var1: r.body.var1, var2: r.body.var2, cardNum: '4567-****-****-1234',
      cardQuota: '00', csturl: 'https://example.com/receipt/' + rid, ...overrides,
    };
  }
  async function notifyCiderpay(rid, overrides, url) {
    const r = cider.get(rid);
    const body = new URLSearchParams(ciderpayFeedback(rid, overrides)).toString();
    const res = await fetch(url || r.body.feedbackurl, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const out = { provider: 'ciderpay', status: res.status, body: await res.text() };
    sent.push(out);
    return out;
  }

  async function ciderpayRoutes(req, res, url, path) {
    if (req.method === 'POST' && path === '/oapi/payment/request') {
      const body = await readJson(req);
      if (req.headers.approvaltoken !== apiToken) return send(res, 200, { success: false, errCode: '1002', message: 'approvalToken 오류' });
      for (const k of ['memberID', 'price', 'goodName', 'mobile']) if (body[k] == null || body[k] === '') return send(res, 200, { success: false, errCode: '1001', message: `필수 필드 에러: ${k}` });
      if (body.memberID !== memberId) return send(res, 200, { success: false, errCode: '1003', message: '회원 아이디 오류' });
      if (!(Number(body.price) >= 1000)) return send(res, 200, { success: false, errCode: '1004', message: '1,000원 이상 부터 결제 가능합니다.' });
      if (body.customName === 'PROVIDERFAIL') return send(res, 200, { success: false, errCode: '9999', message: '시스템 오류' });
      if (body.customName === 'PROVIDERDOWN') { res.statusCode = 503; return res.end('down'); }
      const rid = id('R');
      cider.set(rid, { body });
      return send(res, 200, { success: true, payUrl: `${base}/__fake/ciderpay/pay?id=${rid}`, payUniqueNo: rid });
    }
    const rid = url.searchParams.get('id');
    const r = cider.get(rid);
    if (!r) { res.statusCode = 404; return res.end('unknown request'); }
    if (path === '/pay') {
      const act = (a, label) => link(`${base}/__fake/ciderpay/do?id=${rid}&act=${a}`, label);
      return html(res, `<h1>Fake CiderPay</h1><p>${r.body.goodName}<br><strong>₩${Number(r.body.price).toLocaleString('en-US')}</strong> · ${r.body.customName}</p>
        ${act('pay', 'Pay')}${act('twice', 'Pay, notice sent twice')}${act('noreturn', 'Pay, never return to the shop')}${act('late', 'Return first, notice 6 seconds later')}
        ${act('amount', 'Notice with a wrong amount')}${act('signature', 'Notice with a wrong signature')}${act('cancel', 'Leave without paying')}`);
    }
    if (path === '/do') {
      const act = url.searchParams.get('act');
      if (act === 'pay') await notifyCiderpay(rid);
      if (act === 'twice') { await notifyCiderpay(rid); await notifyCiderpay(rid); }
      if (act === 'amount') await notifyCiderpay(rid, { price: String(Number(r.body.price) - 100) });
      if (act === 'signature') await notifyCiderpay(rid, { var2: 'x'.repeat(32) });
      if (act === 'late') setTimeout(() => notifyCiderpay(rid).catch(() => {}), 6000);
      if (act === 'noreturn') { await notifyCiderpay(rid); return html(res, '<h1>Paid</h1><p id="stayed">The buyer closed the tab here. The shop was told about the payment.</p>'); }
      return go(res, r.body.returnurl);
    }
    res.statusCode = 404; return res.end('not found');
  }

  // ---------- PayPal ----------
  function paypalOrder(o, pid) {
    const unit = o.body.purchase_units[0];
    const out = { id: pid, status: o.status, payer: { email_address: 'buyer@example.com', address: { country_code: 'US' } }, purchase_units: [{ reference_id: unit.reference_id, custom_id: unit.custom_id }] };
    if (o.status === 'COMPLETED') {
      const cents = Math.round(Number(unit.amount.value) * 100);
      const fee = ((Math.round(cents * 0.044) + 30) / 100).toFixed(2);
      out.purchase_units[0].payments = { captures: [{ id: 'CAP' + pid, status: o.captureStatus || 'COMPLETED', amount: unit.amount, custom_id: unit.custom_id, seller_receivable_breakdown: { paypal_fee: { currency_code: 'USD', value: fee } } }] };
    }
    return out;
  }
  // A webhook as PayPal sends it. `good` decides whether the fake "verify signature" call will accept it.
  async function notifyPaypal(eventType, resource, { good = true, url } = {}) {
    const res = await fetch(url || `${base}/api/shop-callback?p=paypal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'paypal-transmission-id': id('T'), 'paypal-transmission-sig': good ? 'good' : 'forged', 'paypal-transmission-time': new Date().toISOString(), 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api.paypal.com/cert' },
      body: JSON.stringify({ id: id('WH'), event_type: eventType, resource }),
    });
    const out = { provider: 'paypal', status: res.status, body: await res.text() };
    sent.push(out);
    return out;
  }

  async function paypalRoutes(req, res, url, path) {
    if (req.method === 'POST' && path === '/v1/oauth2/token') {
      return /^Basic /.test(req.headers.authorization || '') ? send(res, 200, { access_token: 'fake-access', expires_in: 3600 }) : send(res, 401, { error: 'invalid_client' });
    }
    if (path.startsWith('/v') && req.headers.authorization !== 'Bearer fake-access') return send(res, 401, { error: 'invalid_token' });
    if (req.method === 'POST' && path === '/v2/checkout/orders') {
      const body = await readJson(req);
      const pid = id('PP');
      paypal.set(pid, { body, status: 'PAYER_ACTION_REQUIRED' });
      return send(res, 200, { id: pid, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `${base}/__fake/paypal/approve?id=${pid}`, method: 'GET' }] });
    }
    if (req.method === 'POST' && path === '/v1/notifications/verify-webhook-signature') {
      const body = await readJson(req);
      return send(res, 200, { verification_status: body.transmission_sig === 'good' && body.webhook_id && body.webhook_event ? 'SUCCESS' : 'FAILURE' });
    }
    const m = /^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/.exec(path);
    if (m) {
      const o = paypal.get(m[1]);
      if (!o) return send(res, 404, { name: 'RESOURCE_NOT_FOUND' });
      if (!m[2]) return send(res, 200, paypalOrder(o, m[1]));
      if (o.status === 'COMPLETED') return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
      if (o.declined) return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] });
      if (o.status !== 'APPROVED') return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] });
      o.status = 'COMPLETED';
      return send(res, 201, paypalOrder(o, m[1]));
    }
    const pid = url.searchParams.get('id');
    const o = paypal.get(pid);
    if (!o) { res.statusCode = 404; return res.end('unknown order'); }
    const ctx = o.body.payment_source.paypal.experience_context;
    const back = `${ctx.return_url}${ctx.return_url.includes('?') ? '&' : '?'}token=${pid}&PayerID=FAKEPAYER`;
    if (path === '/approve') {
      const act = (a, label) => link(`${base}/__fake/paypal/do?id=${pid}&act=${a}`, label);
      const unit = o.body.purchase_units[0];
      return html(res, `<h1>Fake PayPal</h1><p>${unit.description}<br><strong>$${unit.amount.value}</strong></p>
        ${act('approve', 'Approve and pay')}${act('noreturn', 'Approve, never return to the shop')}${act('pending', 'Approve, PayPal holds the payment')}${act('decline', 'Approve, card declined')}${act('cancel', 'Cancel and return')}`);
    }
    if (path === '/do') {
      const act = url.searchParams.get('act');
      if (act === 'cancel') return go(res, ctx.cancel_url);
      o.status = 'APPROVED';
      if (act === 'decline') o.declined = true;
      if (act === 'pending') o.captureStatus = 'PENDING';
      if (act === 'noreturn') {
        await notifyPaypal('CHECKOUT.ORDER.APPROVED', { id: pid, status: 'APPROVED' });
        return html(res, '<h1>Approved</h1><p id="stayed">The buyer closed the tab here. PayPal sent its webhook to the shop.</p>');
      }
      return go(res, back);
    }
    res.statusCode = 404; return res.end('not found');
  }

  async function handle(req, res, url) {
    if (url.pathname.startsWith('/__fake/ciderpay')) return ciderpayRoutes(req, res, url, url.pathname.slice('/__fake/ciderpay'.length));
    if (url.pathname.startsWith('/__fake/paypal')) return paypalRoutes(req, res, url, url.pathname.slice('/__fake/paypal'.length));
    res.statusCode = 404; res.end('not found');
  }

  return { handle, cider, paypal, sent, ciderpayFeedback, notifyCiderpay, notifyPaypal, paypalOrder };
}

module.exports = { create };
