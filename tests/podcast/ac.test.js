const test = require('node:test');
const assert = require('node:assert/strict');
const ac = require('../../api/_lib/ac.js');

// A tiny fake ActiveCampaign: records calls, answers from `routes`.
function fakeAC(routes) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    const path = url.replace('https://x.api-us1.com/api/3', '');
    const method = opts.method || 'GET';
    calls.push({ method, path, body: opts.body && JSON.parse(opts.body), key: opts.headers['Api-Token'] });
    const handler = routes[`${method} ${path.split('?')[0]}`];
    const [status, body] = handler ? handler(path, opts) : [404, {}];
    return { ok: status < 300, status, json: async () => body };
  };
  return calls;
}

test.beforeEach(() => {
  process.env.AC_API_URL = 'https://x.api-us1.com/';
  process.env.AC_API_KEY = ' key ';
  ac.resetCaches();
});

test('syncContact maps perstags to field ids', async () => {
  const calls = fakeAC({
    'GET /fields': () => [200, { fields: [{ id: '7', perstag: 'PODCAST_NSMB_LINK' }, { id: '8', perstag: 'PODCAST_NSMB_COHORT' }] }],
    'POST /contact/sync': () => [200, { contact: { id: '42' } }],
  });
  const id = await ac.syncContact({ email: 'a@b.kr', fields: { '%PODCAST_NSMB_LINK%': 'https://x/podcast/t', PODCAST_NSMB_COHORT: '2기' } });
  assert.equal(id, '42');
  assert.equal(calls[0].key, 'key');
  assert.deepEqual(calls.at(-1).body.contact.fieldValues, [{ field: '7', value: 'https://x/podcast/t' }, { field: '8', value: '2기' }]);
});

test('syncContact explains a missing custom field', async () => {
  fakeAC({ 'GET /fields': () => [200, { fields: [] }] });
  await assert.rejects(ac.syncContact({ email: 'a@b.kr', fields: { PODCAST_NSMB_LINK: 'x' } }), /PODCAST_NSMB_LINK not found/);
});

test('addTag creates the tag once and tolerates "already tagged"', async () => {
  const calls = fakeAC({
    'GET /tags': () => [200, { tags: [] }],
    'POST /tags': () => [201, { tag: { id: '5', tag: 'podcast-nsmb-subscribed' } }],
    'POST /contactTags': () => [422, {}],
  });
  await ac.addTag('42', 'podcast-nsmb-subscribed');
  await ac.addTag('42', 'podcast-nsmb-subscribed');
  assert.equal(calls.filter((c) => c.method === 'POST' && c.path === '/tags').length, 1);
  assert.deepEqual(calls.at(-1).body, { contactTag: { contact: '42', tag: '5' } });
});

test('contactHasTags finds the cohort tag (case-insensitive)', async () => {
  fakeAC({
    'GET /tags': (path) => [200, { tags: path.includes(encodeURIComponent('nsmb-2기')) ? [{ id: '9', tag: 'NSMB-2기' }] : [] }],
    'GET /contacts/42/contactTags': () => [200, { contactTags: [{ id: '100', tag: '9' }, { id: '101', tag: '3' }] }],
  });
  assert.deepEqual(await ac.contactHasTags('42', ['nsmb-1기', 'nsmb-2기']), ['nsmb-2기']);
});

test('errors carry the status for retries', async () => {
  fakeAC({ 'GET /contacts': () => [500, {}] });
  await assert.rejects(ac.findContactByEmail('a@b.kr'), (err) => err.status === 500);
});

test('contactsWithTag pages through every contact with the tag', async () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ id: String(i), email: `S${i}@x.kr`, firstName: 'A' }));
  const calls = fakeAC({
    'GET /tags': () => [200, { tags: [{ id: '9', tag: 'nsmb-1기' }] }],
    'GET /contacts': (path) => [200, { contacts: /offset=0/.test(path) ? many : [{ id: '100', email: 'last@x.kr' }, { id: '101', email: '' }] }],
  });
  const list = await ac.contactsWithTag('nsmb-1기');
  assert.equal(list.length, 101); // the contact without an email is dropped
  assert.equal(list[0].email, 's0@x.kr');
  assert.ok(calls.some((c) => /tagid=9&status=-1&limit=100&offset=100/.test(c.path)));
});

test('contactsWithTag: unknown tag → null', async () => {
  fakeAC({ 'GET /tags': () => [200, { tags: [] }] });
  assert.equal(await ac.contactsWithTag('nope'), null);
});
