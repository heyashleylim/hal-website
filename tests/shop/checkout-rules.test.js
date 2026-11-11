// Checkout rules that need no database: configuration and signatures, the buyer's form, what is accepted as a payment.
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../../api/_lib/shop/config.js');
const validate = require('../../api/_lib/shop/validate.js');
const copy = require('../../api/_lib/shop/copy.ko.js');

const SECRET = 'test-secret-test-secret-test-secret-1234';
const prod = { SHOP_SECRET: SECRET, VERCEL_ENV: 'production' };
const preview = { SHOP_SECRET: SECRET, VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'hal-git-shop.vercel.app', VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass123' };

test('the shop refuses to sign anything without a real secret', () => {
  assert.throws(() => config.sign('x', 'y', {}), /SHOP_SECRET/);
  assert.throws(() => config.sign('x', 'y', { SHOP_SECRET: 'short' }), /SHOP_SECRET/);
  assert.equal(config.configured({ SHOP_SECRET: 'short' }), false);
  assert.equal(config.configured(prod), true);
});

test('signatures: one purpose can never stand in for another', () => {
  const a = config.sign('order', 'abc', prod);
  assert.equal(a.length, 32);
  assert.equal(config.sign('order', 'abc', prod), a);
  assert.notEqual(config.sign('callback', 'abc', prod), a);
  assert.notEqual(config.sign('order', 'abd', prod), a);
  assert.notEqual(config.sign('order', 'abc', { SHOP_SECRET: SECRET + 'x' }), a);
  assert.equal(config.verify('order', 'abc', a, prod), true);
  assert.equal(config.verify('order', 'abc', a.slice(0, -1) + 'A', prod), false);
  assert.equal(config.verify('order', 'abc', '', prod), false);
  assert.equal(config.verify('order', 'abc', undefined, prod), false);
});

test('order tokens are random and well-formed', () => {
  const t = config.newToken();
  assert.equal(config.isToken(t), true);
  assert.notEqual(config.newToken(), t);
  for (const bad of ['', 'short', t + 'x', t.slice(0, 21) + '!', null, 42, "' OR 1=1 --"]) assert.equal(config.isToken(bad), false);
});

test('addresses: production, preview (with the protection bypass) and callbacks', () => {
  assert.equal(config.publicBase(prod), 'https://www.ashleylim.com');
  assert.equal(config.publicBase({ ...prod, SHOP_PUBLIC_URL: 'https://ashleylim.com/' }), 'https://ashleylim.com');
  assert.equal(config.publicBase(preview), 'https://hal-git-shop.vercel.app');
  assert.throws(() => config.publicBase({ SHOP_SECRET: SECRET }), /SHOP_PUBLIC_URL/);

  const cb = new URL(config.callbackUrl('ciderpay', prod));
  assert.equal(cb.origin + cb.pathname, 'https://www.ashleylim.com/api/shop-callback');
  assert.equal(cb.searchParams.get('p'), 'ciderpay');
  assert.equal(cb.searchParams.get('k'), config.callbackKey(prod));
  assert.equal(cb.searchParams.has('x-vercel-protection-bypass'), false); // never on production
  assert.equal(new URL(config.callbackUrl('ciderpay', preview)).searchParams.get('x-vercel-protection-bypass'), 'bypass123');
  assert.equal(new URL(config.callbackUrl('paypal', prod)).searchParams.has('k'), false);

  assert.equal(config.completeUrl('tok', prod), 'https://www.ashleylim.com/checkout/complete?o=tok');
  assert.equal(config.checkoutUrl('eft', { currency: 'usd', problem: 'cancelled', empty: '' }, prod), 'https://www.ashleylim.com/checkout/eft?currency=usd&problem=cancelled');
});

test('production always talks to the real providers', () => {
  const tampered = { ...prod, CIDERPAY_API_BASE: 'https://evil.example', PAYPAL_API_BASE: 'https://evil.example', PAYPAL_ENV: '' };
  assert.equal(config.ciderpayBase(tampered), 'https://api.ciderpay.com');
  assert.equal(config.paypalBase(tampered), 'https://api-m.paypal.com');
  assert.equal(config.paypalBase(preview), 'https://api-m.sandbox.paypal.com');
  assert.equal(config.paypalBase({ ...preview, PAYPAL_ENV: 'live' }), 'https://api-m.paypal.com');
  assert.equal(config.paypalBase({ ...prod, PAYPAL_ENV: 'sandbox' }), 'https://api-m.sandbox.paypal.com');
  assert.equal(config.ciderpayBase({ ...preview, CIDERPAY_API_BASE: 'http://localhost:8793/__fake/ciderpay' }), 'http://localhost:8793/__fake/ciderpay');
});

test('a buyer is only ever sent to the provider’s own payment page', () => {
  const ok = (u, p, env = prod) => assert.equal(config.trustedPayUrl(u, p, env), new URL(u).toString());
  const no = (u, p, env = prod) => assert.equal(config.trustedPayUrl(u, p, env), null);
  ok('https://pay.ciderpay.com/p/abc', 'ciderpay');
  ok('https://ciderpay.com/pay?x=1', 'ciderpay');
  ok('https://www.paypal.com/checkoutnow?token=1', 'paypal');
  ok('https://www.sandbox.paypal.com/checkoutnow?token=1', 'paypal', preview);
  no('http://pay.ciderpay.com/p/abc', 'ciderpay');           // not https
  no('https://ciderpay.com.evil.example/p', 'ciderpay');
  no('https://evilciderpay.com/p', 'ciderpay');
  no('https://www.paypal.com/x', 'ciderpay');
  no('https://pay.ciderpay.com/p', 'paypal');
  no('javascript:alert(1)', 'ciderpay');
  no('', 'ciderpay');
  no('https://paypal.com@evil.example/', 'paypal');
  // With the local test double, only the double's own address is accepted.
  const local = { SHOP_SECRET: SECRET, CIDERPAY_API_BASE: 'http://localhost:8793/__fake/ciderpay' };
  ok('http://localhost:8793/__fake/ciderpay/pay?id=1', 'ciderpay', local);
  no('http://localhost:9999/pay', 'ciderpay', local);
  no('https://pay.ciderpay.com/p/abc', 'ciderpay', local);
});

test('the buyer’s network is stored as a signature, never as an address', () => {
  process.env.SHOP_SECRET = SECRET;
  const h = config.ipHash({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } });
  assert.equal(h, config.ipHash({ headers: { 'x-real-ip': '203.0.113.7' } }));
  assert.notEqual(h, config.ipHash({ headers: { 'x-real-ip': '203.0.113.8' } }));
  assert.ok(!h.includes('203'));
  assert.equal(config.ipHash({ headers: {} }), null);
});

// ---------- the form ----------
const krw = { name: ' 김지연 ', email: ' Jiyeon@Example.COM ', phone: '010-1234-5678', postcode: '48095', address1: '부산 해운대구 중동1로17번길 15-1', address2: '101호' };
const usd = { name: 'Jiyeon Kim', email: 'j@example.com', phone: '+1 (415) 555-0123', country: 'us', address1: '1 Market St, San Francisco, CA', address2: '', postcode: '94105' };

test('a complete Korean form is cleaned and accepted', () => {
  const r = validate.checkoutInput(krw, 'KRW');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { name: '김지연', email: 'jiyeon@example.com', phone: '01012345678', country: 'KR', postcode: '48095', address1: '부산 해운대구 중동1로17번길 15-1', address2: '101호' });
});

test('a complete overseas form is accepted, with the country and an international phone', () => {
  const r = validate.checkoutInput(usd, 'USD');
  assert.equal(r.ok, true);
  assert.equal(r.value.country, 'US');
  assert.equal(r.value.phone, '+14155550123');
  // a Korean living abroad can still give a Korean mobile number
  assert.equal(validate.checkoutInput({ ...usd, phone: '010 1234 5678' }, 'USD').value.phone, '01012345678');
  // postcode is optional abroad
  assert.equal(validate.checkoutInput({ ...usd, postcode: '' }, 'USD').ok, true);
});

test('every missing or wrong field is reported at once, each with its own message', () => {
  const r = validate.checkoutInput({}, 'KRW');
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, { name: 'name_required', email: 'email_required', phone: 'phone_required', address1: 'address1_required', postcode: 'postcode_required' });
  const u = validate.checkoutInput({}, 'USD');
  assert.deepEqual(u.errors, { name: 'name_required', email: 'email_required', phone: 'phone_required', address1: 'address1_required', country: 'country_required' });
  for (const code of [...Object.values(r.errors), ...Object.values(u.errors)]) assert.ok(copy.errors[code], `no Korean message for ${code}`);
});

test('field rules', () => {
  const bad = (change, field, code, currency = 'KRW') => {
    const r = validate.checkoutInput({ ...(currency === 'USD' ? usd : krw), ...change }, currency);
    assert.equal(r.ok, false, JSON.stringify(change));
    assert.equal(r.errors[field], code, JSON.stringify(change));
    assert.ok(copy.errors[code], `no Korean message for ${code}`);
  };
  bad({ name: 'x'.repeat(61) }, 'name', 'name_long');
  bad({ name: '​ \t' }, 'name', 'name_required');
  for (const email of ['jiyeon', 'jiyeon@', '@example.com', 'a b@example.com', 'a@b', 'a@b..com', 'a@-b.com', 'a@b.com,c@d.com', 'a"b@example.com', 'a@exa mple.com', 'x'.repeat(250) + '@a.com']) bad({ email }, 'email', 'email_invalid');
  for (const phone of ['02-123-4567', '0101234567890', '010-12-34', 'abc', '011-12-3456', '+1 415 555 0123']) bad({ phone }, 'phone', 'phone_invalid');
  for (const phone of ['12345', '1'.repeat(16), '555-CALL-NOW']) bad({ phone }, 'phone', 'phone_invalid_intl', 'USD');
  bad({ postcode: '4809' }, 'postcode', 'postcode_invalid');
  bad({ postcode: '480-95' }, 'postcode', 'postcode_invalid');
  bad({ postcode: 'x'.repeat(21) }, 'postcode', 'postcode_long', 'USD');
  bad({ address1: 'x'.repeat(201) }, 'address1', 'address1_long');
  bad({ address2: 'x'.repeat(101) }, 'address2', 'address2_long');
  bad({ country: 'XX' }, 'country', 'country_required', 'USD');
  bad({ country: '' }, 'country', 'country_required', 'USD');
});

test('Korean mobile numbers in every common spelling', () => {
  for (const p of ['01012345678', '010-1234-5678', '010 1234 5678', '+82 10-1234-5678', '+821012345678', '82-10-1234-5678', '0082 10 1234 5678', '+82 010-1234-5678']) assert.equal(validate.koreanMobile(p), '01012345678', p);
  assert.equal(validate.koreanMobile('011-234-5678'), '0112345678'); // older 10-digit numbers
  for (const p of ['', null, '1012345678', '020-1234-5678', '010-1234-567', '+1 415 555 0123']) assert.equal(validate.koreanMobile(p), null, String(p));
});

test('what the buyer types can never smuggle in markup or control characters', () => {
  const r = validate.checkoutInput({ ...krw, name: 'Kim\u0000<script>\n', address2: 'a\tb\r\nc' }, 'KRW');
  assert.equal(r.value.name, 'Kim <script>'); // kept as text: the pages escape it
  assert.equal(r.value.address2, 'a b c');
  assert.equal(validate.checkoutInput({ ...krw, name: { toString: () => 'x' } }, 'KRW').ok, true);
  assert.equal(validate.checkoutInput(null, 'KRW').ok, false);
  assert.equal(validate.checkoutInput('name=x', 'KRW').ok, false);
});

test('campaign values are kept short and to known names', () => {
  assert.deepEqual(validate.sourceInput({ utm_source: ' instagram ', utm_campaign: 'x'.repeat(300), evil: 'drop', gclid: '', ref: 'abc' }),
    { utm_source: 'instagram', utm_campaign: 'x'.repeat(200), ref: 'abc' });
  assert.deepEqual(validate.sourceInput(null), {});
});

test('the country list is in Korean, without duplicates, common countries first', () => {
  const list = validate.countries();
  assert.equal(list[0].code, 'US');
  assert.equal(list[0].name, '미국');
  assert.equal(new Set(list.map((c) => c.code)).size, list.length);
  assert.ok(list.length > 200);
  assert.ok(list.every((c) => c.name && c.name !== c.code), 'every country has a Korean name');
  assert.ok(list.some((c) => c.code === 'KR' && c.name === '대한민국'));
});

test('every problem code the API can return has a Korean message', () => {
  for (const code of ['invalid', 'closed', 'unavailable', 'too_many', 'provider', 'not_configured', 'cancelled', 'declined', 'network', 'server']) assert.ok(copy.problems[code], code);
});
