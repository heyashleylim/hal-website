import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import mw from '../../middleware.js';

const auth = createRequire(import.meta.url)('../../api/_lib/auth.js');
const base = 'https://www.ashleylim.com';
const post = (path, fields) => new Request(base + path, { method: 'POST', body: new URLSearchParams(fields) });

process.env.PREVIEW_USER = 'preview';
process.env.PREVIEW_PASSWORD = 'pp';
process.env.ADMIN_USER = 'Admin';
process.env.ADMIN_PASSWORD = 'ap';

test('preview: unchanged behaviour', async () => {
  let res = await mw(new Request(base + '/preview/eft'));
  assert.match(await res.text(), /비공개 미리보기[\s\S]*action="\/preview\/login"[\s\S]*value="\/preview\/eft"/);
  res = await mw(post('/preview/login', { username: 'preview', password: 'pp', next: '/preview/eft' }));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/preview/eft');
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^hal_preview=[0-9a-f]{64}; Path=\/preview; Max-Age=2592000/);
  assert.equal(await mw(new Request(base + '/preview/eft', { headers: { cookie: cookie.split(';')[0] } })), undefined);
  assert.equal(await mw(new Request(base + '/preview/eft', { headers: { authorization: 'Basic ' + btoa('preview:pp') } })), undefined);
  res = await mw(post('/preview/login', { username: 'preview', password: 'pp', next: 'https://evil.example' }));
  assert.equal(res.headers.get('location'), '/preview/nsmb');
});

test('admin: login, cookie shared with the API, logout', async () => {
  let res = await mw(new Request(base + '/admin/podcast/students'));
  const html = await res.text();
  assert.match(html, /<html lang="en">[\s\S]*<title>Admin · Log in<\/title>[\s\S]*action="\/admin\/login"[\s\S]*<h1>Admin<\/h1>[\s\S]*value="\/admin\/podcast\/students"/);
  res = await mw(post('/admin/login', { username: 'admin', password: 'wrong', next: '/admin/podcast' }));
  assert.match(await res.text(), /Wrong username or password/);
  res = await mw(post('/admin/login', { username: 'admin', password: 'ap', next: '/admin/podcast' }));
  assert.equal(res.status, 303);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /^hal_admin=[0-9a-f]{64}; Path=\/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax$/);
  const pair = cookie.split(';')[0];
  assert.equal(await mw(new Request(base + '/admin/podcast', { headers: { cookie: pair } })), undefined);
  // The API recognises the same cookie.
  assert.equal(auth.adminFromRequest({ headers: { cookie: pair } }), 'Admin');
  // Preview cookie doesn't open admin, and Basic Auth isn't accepted there.
  assert.notEqual(await mw(new Request(base + '/admin/podcast', { headers: { cookie: 'hal_preview=' + pair.split('=')[1] } })), undefined);
  assert.notEqual(await mw(new Request(base + '/admin/podcast', { headers: { authorization: 'Basic ' + btoa('admin:ap') } })), undefined);
  res = await mw(new Request(base + '/admin/logout'));
  assert.match(res.headers.get('set-cookie'), /^hal_admin=; Path=\/; Max-Age=0/);
});

test('admin fails closed without credentials', async () => {
  delete process.env.ADMIN_PASSWORD;
  const res = await mw(new Request(base + '/admin/podcast'));
  assert.equal(res.status, 503);
  process.env.ADMIN_PASSWORD = 'ap';
});
