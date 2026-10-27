const test = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../../api/_lib/auth.js');
const handler = require('../../api/admin.js');

function call({ url, method = 'GET', cookie = '' }) {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200,
      setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
      end: (body) => resolve({ status: res.statusCode, headers, body: JSON.parse(body) }),
    };
    handler({ url, method, headers: { cookie, host: 'x' } }, res);
  });
}

test.before(() => {
  process.env.ADMIN_USER = 'admin';
  process.env.ADMIN_PASSWORD = 'pw';
  delete process.env.DATABASE_URL;
});
const cookie = () => 'hal_admin=' + auth.adminSessionToken('admin', 'pw');

test('refuses without the admin cookie', async () => {
  const r = await call({ url: '/api/admin?action=health' });
  assert.equal(r.status, 401);
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('unknown action and wrong method', async () => {
  assert.equal((await call({ url: '/api/admin?action=toString', cookie: cookie() })).status, 404);
  assert.equal((await call({ url: '/api/admin?action=health', method: 'POST', cookie: cookie() })).status, 405);
});

test('health reports missing configuration by name only', async () => {
  const r = await call({ url: '/api/admin?action=health', cookie: cookie() });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.ok(r.body.missingEnv.includes('DATABASE_URL'));
  assert.ok(!r.body.missingEnv.includes('ADMIN_USER'));
  assert.equal(r.body.database.connected, false);
});
