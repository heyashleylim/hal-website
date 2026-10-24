const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const auth = require('../../api/_lib/auth.js');

test('tokens are 22 URL-safe characters and unique', () => {
  const a = auth.newToken();
  assert.ok(auth.isToken(a));
  assert.notEqual(a, auth.newToken());
  assert.ok(!auth.isToken('../etc/passwd'));
  assert.ok(!auth.isToken(a + 'x'));
});

test('ipHash needs a long secret and is stable', () => {
  delete process.env.PODCAST_SECRET;
  assert.throws(() => auth.ipHash('1.2.3.4'));
  process.env.PODCAST_SECRET = 'x'.repeat(40);
  assert.equal(auth.ipHash('1.2.3.4'), auth.ipHash('1.2.3.4'));
  assert.notEqual(auth.ipHash('1.2.3.4'), auth.ipHash('1.2.3.5'));
  assert.equal(auth.ipHash(''), null);
});

test('admin cookie: matches the middleware HMAC and is checked', () => {
  process.env.ADMIN_USER = 'Alex';
  process.env.ADMIN_PASSWORD = 'pw';
  // Same computation as middleware.js sessionToken('alex', 'pw', 'hal-admin:').
  const expected = crypto.createHmac('sha256', 'pw').update('hal-admin:alex').digest('hex');
  assert.equal(auth.adminSessionToken('Alex', 'pw'), expected);
  assert.equal(auth.adminFromRequest({ headers: { cookie: 'a=1; hal_admin=' + expected } }), 'Alex');
  assert.equal(auth.adminFromRequest({ headers: { cookie: 'hal_admin=' + expected.slice(1) + '0' } }), null);
  assert.equal(auth.adminFromRequest({ headers: {} }), null);
  delete process.env.ADMIN_PASSWORD;
  assert.equal(auth.adminFromRequest({ headers: { cookie: 'hal_admin=' + expected } }), null);
});

test('sameOrigin', () => {
  assert.ok(auth.sameOrigin({ headers: { origin: 'https://www.ashleylim.com', host: 'www.ashleylim.com' } }));
  assert.ok(!auth.sameOrigin({ headers: { origin: 'https://evil.example', host: 'www.ashleylim.com' } }));
  assert.ok(!auth.sameOrigin({ headers: { host: 'www.ashleylim.com' } }));
});
