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
  // Refunds. `modes` sets how the next refund calls are answered (tests change it):
  //   ciderpayCancel: 'ok' | 'settled' (cancel → CANCEL_REQ, then the cancel request is accepted) | 'refuse' | 'down' | 'hang'
  //   paypalRefund:   'ok' | 'pending' | 'refuse' | 'down' | 'hang'
  //   ciderpayPlan:   'ok' | 'refuse' | 'down'   (pause, resume and end of an instalment plan)
  const modes = { ciderpayCancel: 'ok', paypalRefund: 'ok', ciderpayPlan: 'ok' };
  const plans = new Map();    // plan request id → { body, rpToken, agreed }
  const planCalls = [];       // every pause / resume / end call: { action, rpToken }
  const refundCalls = [];    // every refund call received: { provider, path, body }
  const ciderRefunded = new Map(); // rid → won refunded
  const paypalRefunds = new Map(); // PayPal-Request-Id → refund answer (idempotency)
  const hang = (res) => { setTimeout(() => res.destroy(), 50); };
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

  // ---------- CiderPay instalment plans (정기 결제) ----------
  // A plan notice as CiderPay posts it (form-encoded): agreeRegularPayment / rejectRegularPayment to feedbackUrl,
  // completeRpPayment / errorRpPayment to payFeedbackUrl. `turnSeq` 0 is the first payment.
  function planFeedback(pid, cmd, { turnSeq = 0, amount = null, message = '잔액 부족', ...overrides } = {}) {
    const p = plans.get(pid);
    if (!p) throw new Error('unknown fake CiderPay plan ' + pid);
    const b = p.body;
    const common = { cmd, memberID: b.memberID, rpToken: p.rpToken, customerName: b.customName, customerMobile: b.customMobile };
    if (cmd === 'agreeRegularPayment' || cmd === 'rejectRegularPayment') return { ...common, var1: b.var1, var2: b.var2, last4: '1234', ...overrides };
    const price = String(amount == null ? (turnSeq === 0 ? b.firstPrice : b.price) : amount);
    const out = { ...common, var1: b.payVar1, var2: b.payVar2, price, turnSeq: String(turnSeq), customerEmail: b.customEmail };
    if (cmd === 'errorRpPayment') return { ...out, errorMessage: message, ...overrides };
    // A charge: refundable like a one-time payment (its orderNo / feedbackToken work with the cancel calls).
    const rid = id('R');
    cider.set(rid, { body: { memberID: b.memberID, price: Number(price), goodName: b.goodName } });
    return { ...out, paymentState: 'COMPLETE', orderNo: 'CP' + rid, feedbackToken: 'FT' + rid, approvalNo: '40012345', ccname: '국민카드', cardNum: '1234-****-****-1234', cardQuota: '00', csturl: 'https://example.com/receipt/' + rid, ...overrides };
  }
  async function notifyPlan(pid, cmd, opts = {}) {
    const p = plans.get(pid);
    const body = new URLSearchParams(planFeedback(pid, cmd, opts)).toString();
    const to = opts.url || (cmd === 'agreeRegularPayment' || cmd === 'rejectRegularPayment' ? p.body.feedbackUrl : p.body.payFeedbackUrl);
    const res = await fetch(to, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const out = { provider: 'ciderpay', status: res.status, body: await res.text() };
    sent.push(out);
    return out;
  }
  // The plan of an order (by its token, var1), for tests.
  function planOf(token) {
    for (const [pid, p] of plans) if (p.body.var1 === token) return { pid, ...p };
    return null;
  }

  async function planRoutes(req, res, url, path) {
    const devOk = req.headers.devid === memberId && req.headers.devtoken === apiToken;
    if (req.method === 'POST' && path === '/oapi/regularPay/request') {
      const body = await readJson(req);
      if (!devOk) return send(res, 200, { success: false, errCode: '1002', message: 'devToken 오류' });
      for (const k of ['memberID', 'customMobile', 'goodName', 'price', 'periodDateVal']) if (body[k] == null || body[k] === '') return send(res, 200, { success: false, errCode: '1001', message: `필수 필드 에러: ${k}` });
      if (body.memberID !== memberId) return send(res, 200, { success: false, errCode: '1003', message: '회원 아이디 오류' });
      if (!(Number(body.price) >= 1000) || !(Number(body.firstPrice) >= 1000)) return send(res, 200, { success: false, errCode: '1004', message: '1,000원 이상 부터 결제 가능합니다.' });
      if (body.customName === 'PROVIDERFAIL') return send(res, 200, { success: false, errCode: '9999', message: '시스템 오류' });
      const pid = id('P');
      plans.set(pid, { body, rpToken: 'RP' + pid, agreed: false });
      return send(res, 200, { success: true, var1: `${base}/__fake/ciderpay/plan?id=${pid}`, var2: pid });
    }
    const act = /^\/oapi\/regularPay\/(pauseAct|unpauseAct)$/.exec(path);
    const end = /^\/oapi\/regularPay\/destroyMp\/([^/]+)\/([^/]+)$/.exec(path);
    if ((req.method === 'POST' && act) || (req.method === 'DELETE' && end)) {
      let rpToken = end ? decodeURIComponent(end[2]) : '';
      if (act) { const chunks = []; for await (const c of req) chunks.push(c); rpToken = new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('rpToken') || ''; }
      planCalls.push({ action: act ? (act[1] === 'pauseAct' ? 'pause' : 'resume') : 'end', rpToken });
      if (!devOk) return send(res, 200, { success: false, errCode: '1002', message: 'devToken 오류' });
      if (modes.ciderpayPlan === 'down') { res.statusCode = 503; return res.end('down'); }
      if (modes.ciderpayPlan === 'refuse') return send(res, 200, { success: false, errCode: '3001', message: '정기 결제 상태 오류' });
      const known = [...plans.values()].some((p) => p.rpToken === rpToken);
      return known ? send(res, 200, { success: true, errorMessage: '' }) : send(res, 200, { success: false, errCode: '3002', message: '토큰 에러' });
    }
    const pid = url.searchParams.get('id');
    const p = plans.get(pid);
    if (!p) { res.statusCode = 404; return res.end('unknown plan'); }
    if (path === '/plan') {
      const a = (x, label) => link(`${base}/__fake/ciderpay/plan-do?id=${pid}&act=${x}`, label);
      return html(res, `<h1>Fake CiderPay: 정기 결제</h1><p>${p.body.goodName}<br><strong>₩${Number(p.body.firstPrice).toLocaleString('en-US')}</strong> today, then ₩${Number(p.body.price).toLocaleString('en-US')} on day ${p.body.periodDateVal} of each month until ${p.body.limitDateStr} · ${p.body.customName}</p>
        ${a('agree', 'Agree and pay the first instalment')}${a('paidfirst', 'Agree, payment notice before the agreement')}${a('declined', 'Agree, first charge declined')}${a('refuse', 'Refuse')}`);
    }
    if (path === '/plan-do') {
      const x = url.searchParams.get('act');
      if (x === 'agree') { await notifyPlan(pid, 'agreeRegularPayment'); await notifyPlan(pid, 'completeRpPayment', { turnSeq: 0 }); }
      if (x === 'paidfirst') { await notifyPlan(pid, 'completeRpPayment', { turnSeq: 0 }); await notifyPlan(pid, 'agreeRegularPayment'); }
      if (x === 'declined') { await notifyPlan(pid, 'agreeRegularPayment'); await notifyPlan(pid, 'errorRpPayment', { turnSeq: 0, message: '한도 초과' }); }
      if (x === 'refuse') await notifyPlan(pid, 'rejectRegularPayment');
      p.agreed = x !== 'refuse';
      return go(res, p.body.returnUrl);
    }
    res.statusCode = 404; return res.end('not found');
  }

  async function ciderpayRoutes(req, res, url, path) {
    if (path.startsWith('/oapi/regularPay/') || path === '/plan' || path === '/plan-do') return planRoutes(req, res, url, path);
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
    if (req.method === 'POST' && (path === '/oapi/payment/cancel' || path === '/oapi/payment/cancelRequest')) {
      const body = await readJson(req);
      refundCalls.push({ provider: 'ciderpay', path, body });
      if (req.headers.approvaltoken !== apiToken) return send(res, 200, { success: false, errCode: '1002', message: 'approvalToken 오류' });
      if (body.memberID !== memberId) return send(res, 200, { success: false, errCode: '1003', message: '회원 아이디 오류' });
      const rid = String(body.orderNo || '').replace(/^CP/, '');
      const r = cider.get(rid);
      if (!r || body.token !== 'FT' + rid) return send(res, 200, { success: false, errCode: '2002', message: '결제 토큰 에러' });
      const mode = modes.ciderpayCancel;
      if (mode === 'down') { res.statusCode = 503; return res.end('down'); }
      if (mode === 'hang') return hang(res);
      if (mode === 'refuse') return send(res, 200, { success: false, errCode: '2001', message: '취소 가능 상태 에러' });
      if (path === '/oapi/payment/cancel' && mode === 'settled') return send(res, 200, { success: false, var1: 'CANCEL_REQ', errorMessage: '정산 완료: 취소 요청이 필요합니다' });
      const done = ciderRefunded.get(rid) || 0;
      const amount = body.rangeType === 'ALL' ? Number(r.body.price) - done : Number(body.cancelPrice);
      if (body.rangeType === 'ALL' && done > 0) return send(res, 200, { success: false, errCode: '2001', message: '부분 취소된 결제는 전체 취소할 수 없습니다' });
      if (!(amount > 0) || done + amount > Number(r.body.price)) return send(res, 200, { success: false, errCode: '2001', message: '취소 금액 오류' });
      ciderRefunded.set(rid, done + amount);
      return send(res, 200, { success: true });
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
  // A refund as PayPal describes it (refund call answer, and the resource of PAYMENT.CAPTURE.REFUNDED).
  function paypalRefund(captureId, { amount, custom_id = '', status = 'COMPLETED', id: rid = id('RF') }) {
    const fee = (Math.round(Math.round(Number(amount.value) * 100) * 0.03) / 100).toFixed(2);
    return { id: rid, status, amount, custom_id, seller_payable_breakdown: { paypal_fee: { currency_code: 'USD', value: fee } },
      links: [{ rel: 'self', href: `${base}/__fake/paypal/v2/payments/refunds/${rid}` }, { rel: 'up', href: `${base}/__fake/paypal/v2/payments/captures/${captureId}` }] };
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
    const rf = /^\/v2\/payments\/captures\/(CAP[A-Z0-9]+)\/refund$/.exec(path);
    if (req.method === 'POST' && rf) {
      const body = await readJson(req);
      const key = req.headers['paypal-request-id'] || '';
      refundCalls.push({ provider: 'paypal', path, body, key });
      if (key && paypalRefunds.has(key)) return send(res, 201, paypalRefunds.get(key));
      const o = paypal.get(rf[1].slice(3));
      if (!o || o.status !== 'COMPLETED') return send(res, 404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] });
      const mode = modes.paypalRefund;
      if (mode === 'down') return send(res, 503, { name: 'INTERNAL_SERVER_ERROR' });
      if (mode === 'hang') return hang(res);
      if (mode === 'refuse') return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'REFUND_NOT_ALLOWED' }] });
      const paid = Math.round(Number(o.body.purchase_units[0].amount.value) * 100);
      const want = Math.round(Number(body.amount.value) * 100);
      o.refunded = o.refunded || 0;
      if (want + o.refunded > paid) return send(res, 422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'REFUND_AMOUNT_EXCEEDED' }] });
      o.refunded += want;
      const answer = paypalRefund(rf[1], { amount: body.amount, custom_id: body.custom_id, status: mode === 'pending' ? 'PENDING' : 'COMPLETED' });
      if (key) paypalRefunds.set(key, answer);
      return send(res, 201, answer);
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

  return { handle, cider, paypal, sent, ciderpayFeedback, notifyCiderpay, notifyPaypal, paypalOrder, paypalRefund, modes, refundCalls, plans, planCalls, planFeedback, notifyPlan, planOf };
}

module.exports = { create };
