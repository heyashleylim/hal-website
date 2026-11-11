// Sending the queued ActiveCampaign updates (sync.process), with a stand-in database and a stand-in AC client:
// what is sent for a purchase, what happens when a field is missing or AC is down, and that nothing is sent twice.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('../../api/_lib/shop/http.js');

const lib = (f) => require.resolve(path.join(__dirname, '../../api/_lib', f));

// A fresh sync.js wired to stand-ins. `rows` is the outbox; `ac` records every call.
function load({ rows, fields = ['ORDER_NUMBER', 'ORDER_PRODUCT'], existing = null, failTag = null }) {
  const calls = [];
  const customers = new Map();
  const db = {
    async query(text, params = []) {
      if (/^SELECT o\.\*/.test(text.trim())) return rows.filter((r) => r.status === 'pending' && (params.length ? r.order_id === params[0] : true)).map((r) => ({ ...r, ac_contact_id: customers.get(r.customer_id) || null }));
      if (/UPDATE shop_customers SET ac_contact_id/.test(text)) { customers.set(params[0], params[1]); return []; }
      if (/SET status = 'done'/.test(text)) { const r = rows.find((x) => x.id === params[0]); r.status = 'done'; r.attempts += 1; r.last_error = params[1]; return []; }
      if (/SET attempts = \$2/.test(text)) { const r = rows.find((x) => x.id === params[0]); r.attempts = params[1]; r.last_error = params[2]; r.status = params[3]; r.delay = Number(params[4]); return []; }
      throw new Error('unexpected query: ' + text);
    },
    async one() { return { n: rows.filter((r) => r.status === 'pending').length }; },
  };
  const ac = {
    async findContactByEmail(email) { calls.push(['find', email]); return existing; },
    async syncContact(c) { calls.push(['create', c.email, c.firstName]); return 77; },
    async subscribeToList(id, name) { calls.push(['list', String(id), name]); },
    async addTag(id, tag) { calls.push(['tag', String(id), tag]); if (tag === failTag) throw new Error('AC POST /contactTags → 503'); },
    async removeTag(id, tag) { calls.push(['untag', String(id), tag]); },
    async findField(name) { if (!fields.includes(name)) throw new Error(`no contact field ${name} in ActiveCampaign (contact fields found: none)`); return { id: 1 }; },
    async updateContactFields(id, f) { calls.push(['fields', String(id), f]); },
  };
  for (const [file, exports] of [['db.js', db], ['ac.js', ac]]) require.cache[lib(file)] = { id: lib(file), filename: lib(file), loaded: true, exports };
  delete require.cache[lib('shop/sync.js')];
  const sync = require('../../api/_lib/shop/sync.js');
  return { sync, calls, rows, customers };
}

function restore() {
  for (const f of ['db.js', 'ac.js', 'shop/sync.js']) delete require.cache[lib(f)];
}

const row = (id, op, payload) => ({ id, customer_id: 4, order_id: 9, op, payload, status: 'pending', attempts: 0, email: 'jiyeon@example.com', name: '김지연' });
const purchase = () => [
  row(1, 'contact', { name: '김지연' }),
  row(2, 'tag_add', { tag: 'purchased_eft' }),
  row(3, 'fields', { fields: { ORDER_NUMBER: '100042', ORDER_PRODUCT: 'EFT', ORDER_RECEIPT_URL: 'https://x' } }),
];

test.beforeEach(() => { process.env.AC_API_URL = 'https://x.api-us1.com'; process.env.AC_API_KEY = 'k'; delete process.env.AC_LIST_NAME; });
test.after(restore);

test('reads its settings from the environment (it once crashed doing so)', () => {
  const { sync } = load({ rows: [] });
  assert.equal(sync.acConfigured(), true);
  assert.equal(sync.acConfigured({}), false);
  assert.equal(typeof sync.process, 'function');
});

test('a new buyer: contact created with their name, list, tag, fields — in that order, once', async () => {
  const { sync, calls, rows, customers } = load({ rows: purchase() });
  const r = await sync.process({ orderId: 9 });
  assert.deepEqual(r, { done: 3, failed: 0, left: 0 });
  assert.deepEqual(calls, [
    ['find', 'jiyeon@example.com'], ['create', 'jiyeon@example.com', '김지연'], ['list', '77', 'Master Contact List'],
    ['tag', '77', 'purchased_eft'],
    ['fields', '77', { ORDER_NUMBER: '100042', ORDER_PRODUCT: 'EFT' }],
  ]);
  assert.equal(customers.get(4), '77');
  assert.ok(rows.every((x) => x.status === 'done'));
  // The field AC doesn't have yet is reported, and did not block the others or the tag.
  assert.match(rows[2].last_error, /ORDER_RECEIPT_URL/);
  // Running again sends nothing.
  calls.length = 0;
  assert.deepEqual(await sync.process({ orderId: 9 }), { done: 0, failed: 0, left: 0 });
  assert.deepEqual(calls, []);
});

test('an existing contact is found, never re-created, and their name in AC is left alone', async () => {
  const { sync, calls } = load({ rows: purchase(), existing: { id: 55 } });
  await sync.process({});
  assert.ok(!calls.some((c) => c[0] === 'create'));
  assert.deepEqual(calls.filter((c) => c[0] === 'find').length, 1, 'looked up once for the whole run');
  assert.ok(calls.some((c) => c[0] === 'tag' && c[1] === '55'));
});

test('when ActiveCampaign fails, the update stays queued with a growing delay, and the rest still goes', async () => {
  const { sync, rows } = load({ rows: purchase(), failTag: 'purchased_eft' });
  const r = await sync.process({});
  assert.deepEqual(r, { done: 2, failed: 1, left: 1 });
  assert.equal(rows[1].status, 'pending');
  assert.equal(rows[1].attempts, 1);
  assert.equal(rows[1].delay, 5 * 60 * 1000);
  assert.match(rows[1].last_error, /503/);
  assert.equal(rows[2].status, 'done', 'the fields were still sent');
  // After 8 failures it is marked failed (and shows in the admin).
  rows[1].attempts = 7;
  await sync.process({});
  assert.equal(rows[1].status, 'failed');
});

test('without ActiveCampaign keys nothing is attempted and nothing is lost', async () => {
  delete process.env.AC_API_KEY;
  const { sync, calls, rows } = load({ rows: purchase() });
  const r = await sync.process({});
  assert.match(r.skipped, /not configured/);
  assert.deepEqual(calls, []);
  assert.ok(rows.every((x) => x.status === 'pending'));
});

test('request bodies: form posts, JSON, broken input', () => {
  assert.deepEqual(http.parse('name=%EA%B9%80%EC%A7%80%EC%97%B0&plan=full', 'application/x-www-form-urlencoded'), { name: '김지연', plan: 'full' });
  assert.deepEqual(http.parse('{"a":1}', 'application/json; charset=utf-8'), { a: 1 });
  assert.deepEqual(http.parse('{broken', 'application/json'), {});
  assert.deepEqual(http.parse('[1,2]', 'application/json'), {});
  assert.deepEqual(http.parse('null', 'application/json'), {});
  assert.deepEqual(http.parse('', ''), {});
  assert.deepEqual(http.parse('paymentState=COMPLETE&price=220000', ''), { paymentState: 'COMPLETE', price: '220000' });
});

test('a form or request from another site is refused', () => {
  const req = (headers) => ({ headers });
  assert.equal(http.sameOrigin(req({ origin: 'https://www.ashleylim.com', host: 'www.ashleylim.com' })), true);
  assert.equal(http.sameOrigin(req({ origin: 'https://www.ashleylim.com', host: 'internal', 'x-forwarded-host': 'www.ashleylim.com' })), true);
  assert.equal(http.sameOrigin(req({ origin: 'https://evil.example', host: 'www.ashleylim.com' })), false);
  assert.equal(http.sameOrigin(req({ origin: 'https://www.ashleylim.com.evil.example', host: 'www.ashleylim.com' })), false);
  assert.equal(http.sameOrigin(req({ origin: 'null', host: 'www.ashleylim.com' })), false);   // sandboxed page
  assert.equal(http.sameOrigin(req({ origin: 'not a url', host: 'www.ashleylim.com' })), false);
  assert.equal(http.sameOrigin(req({ host: 'www.ashleylim.com' })), true);                    // not a browser
});
