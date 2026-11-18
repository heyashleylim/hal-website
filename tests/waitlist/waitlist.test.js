const test = require('node:test');
const assert = require('node:assert/strict');
const ac = require('../../api/_lib/ac.js');
const wl = require('../../api/_lib/waitlist.js');
const handler = require('../../api/waitlist.js');

const FIELDS = [
  { id: '11', perstag: 'WL_Q1_THING_TO_CHANGE', title: 'WL Q1 - Thing to change (+duration)' },
  { id: '12', perstag: 'WL_Q2_WHAT_ALREADY_TRIED', title: 'WL Q2 - What already tried' },
  { id: '13', perstag: 'WL_Q3_COMMITTED_TO_WORK', title: 'WL Q3 - Committed to work' },
  { id: '16', perstag: 'WL_SOURCE', title: 'WL Source' },
  { id: '17', perstag: 'WL_COMPLETED', title: 'WL Completed' },
  { id: '18', perstag: 'WL_LINK_CODE', title: 'WL Link code' },
];
const OPTIONS = {
  13: [
    { field: '13', orderid: '2', value: 'Maybe', label: '고민 중' },
    { field: '13', orderid: '1', value: 'Yes', label: '네' },
    { field: '13', orderid: '3', value: 'News only', label: '소식만' },
  ],
  16: ['nsmb-page', 'waitlist-page', 'reconfirm', 'ig-bio', 'manychat'].map((v, i) => ({ field: '16', orderid: String(i), value: v, label: v })),
};

// A tiny fake ActiveCampaign that keeps contacts, tags and field values in memory.
function fakeAC() {
  const state = { contacts: new Map([['42', { id: '42', email: 'jieun@example.com', firstName: '지은' }]]), fields: {}, tags: new Map(), forms: 0, calls: [] };
  let nextTag = 1;
  const tagNames = new Map();
  global.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    if (url.startsWith('https://form.example')) { state.forms++; return { ok: true, status: 302, json: async () => ({}) }; }
    const path = url.replace('https://x.api-us1.com/api/3', '');
    const bodyIn = opts.body ? JSON.parse(opts.body) : null;
    state.calls.push(`${method} ${path.split('?')[0]}`);
    const reply = (status, b) => ({ ok: status < 300, status, json: async () => b });
    let m;
    if (method === 'GET' && path.startsWith('/fields?')) return reply(200, { fields: FIELDS });
    if (method === 'GET' && (m = /^\/fields\/(\d+)\?include=options/.exec(path))) return reply(200, { field: {}, fieldOptions: OPTIONS[m[1]] || [] });
    if (method === 'POST' && path === '/contact/sync') {
      const c = bodyIn.contact;
      let found = [...state.contacts.values()].find((x) => x.email === c.email);
      if (!found) { found = { id: String(100 + state.contacts.size), email: c.email, firstName: c.firstName }; state.contacts.set(found.id, found); }
      return reply(201, { contact: { id: found.id } });
    }
    if ((m = /^\/contacts\/(\d+)$/.exec(path))) {
      const c = state.contacts.get(m[1]);
      if (!c) return reply(404, {});
      if (method === 'PUT') { for (const fv of bodyIn.contact.fieldValues) state.fields[`${m[1]}:${fv.field}`] = fv.value; return reply(200, { contact: c }); }
      return reply(200, { contact: c });
    }
    if (method === 'GET' && path.startsWith('/tags?')) {
      const name = decodeURIComponent(path.split('search=')[1]);
      return reply(200, { tags: tagNames.has(name) ? [{ id: tagNames.get(name), tag: name }] : [] });
    }
    if (method === 'POST' && path === '/tags') { const id = String(nextTag++); tagNames.set(bodyIn.tag.tag, id); return reply(201, { tag: { id, tag: bodyIn.tag.tag } }); }
    if (method === 'POST' && path === '/contactTags') {
      const { contact, tag } = bodyIn.contactTag;
      const set = state.tags.get(contact) || new Set();
      set.add(tag); state.tags.set(contact, set);
      return reply(201, { contactTag: { id: `${contact}-${tag}` } });
    }
    if (method === 'GET' && (m = /^\/contacts\/(\d+)\/contactTags/.exec(path))) {
      return reply(200, { contactTags: [...(state.tags.get(m[1]) || [])].map((t) => ({ id: `${m[1]}-${t}`, tag: t })) });
    }
    if (method === 'DELETE' && (m = /^\/contactTags\/(\d+)-(\d+)$/.exec(path))) { state.tags.get(m[1])?.delete(m[2]); return reply(200, {}); }
    if (method === 'GET' && path.startsWith('/lists?')) return reply(200, { lists: [{ id: '1', name: 'Master Contact List' }] });
    if (method === 'POST' && path === '/contactLists') return reply(201, {});
    return reply(404, {});
  };
  const tagsOf = (id) => [...(state.tags.get(id) || [])].map((t) => [...tagNames].find(([, v]) => v === t)[0]).sort();
  const field = (id, fid) => state.fields[`${id}:${fid}`];
  return { state, tagsOf, field };
}

function call(action, body, headers = {}) {
  return new Promise((resolve) => {
    const res = {
      headers: {}, statusCode: 200,
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(b) { resolve({ status: this.statusCode, body: b }); return this; },
    };
    handler({ method: 'POST', query: action ? { action } : {}, headers: { 'x-forwarded-for': `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers }, body }, res);
  });
}

test.beforeEach(() => {
  process.env.AC_API_URL = 'https://x.api-us1.com';
  process.env.AC_API_KEY = 'key';
  process.env.WAITLIST_SECRET = 'test-secret-that-is-long-enough';
  process.env.WAITLIST_MANYCHAT_KEY = 'manychat-key-0123456789abcdef';
  delete process.env.AC_FORM_ACTION;
  delete process.env.AC_FORM_ID;
  ac.resetCaches();
});

test('link codes round-trip and reject forgeries', () => {
  const code = wl.linkCode(42);
  assert.match(code, /^16-[A-Za-z0-9_-]{16}$/);
  assert.equal(wl.contactIdFromCode(code), '42');
  assert.equal(wl.contactIdFromCode('17' + code.slice(2)), null);            // someone else's id, same signature
  assert.equal(wl.contactIdFromCode(code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(wl.contactIdFromCode('nonsense'), null);
  process.env.WAITLIST_SECRET = 'a-different-secret-entirely!!';
  assert.equal(wl.contactIdFromCode(code), null);                            // a new secret invalidates old links
});

test('cleaning: Q3 forms, sources, consent', () => {
  assert.equal(wl.cleanQ3('ⓑ'), 'b');
  assert.equal(wl.cleanQ3('3'), 'c');
  assert.equal(wl.cleanQ3(wl.Q3.a), 'a');
  assert.equal(wl.cleanQ3('maybe'), null);
  assert.equal(wl.cleanSource('RECONFIRM'), 'reconfirm');
  assert.equal(wl.cleanSource('evil'), 'waitlist-page');
  assert.equal(wl.truthy('yes'), true);
  assert.equal(wl.truthy(''), false);
  assert.deepEqual(wl.cleanAnswers({ q1: '  ', q2: 'x', q3: 'z' }), { q2: 'x' });
});

test('pickOption: exact match, then position', () => {
  const opts = [{ value: 'Yes', label: '네' }, { value: 'Maybe', label: '고민' }];
  assert.equal(wl.pickOption(opts, { wanted: 'maybe' }), 'Maybe');
  assert.equal(wl.pickOption(opts, { wanted: 'nothing like it', index: 0 }), 'Yes');
  assert.equal(wl.pickOption(opts, { wanted: 'nothing like it' }), null);
});

test('website: sign-up, then answers one by one, then complete', async () => {
  const fake = fakeAC();
  const r = await call('', { name: '민지', email: 'Minji@Example.com', consent: true, source: 'nsmb-page' });
  assert.equal(r.status, 200);
  assert.equal(r.body.confirm, false);
  const id = wl.contactIdFromCode(r.body.code);
  assert.ok(id);
  assert.equal(fake.field(id, '18'), r.body.code);
  assert.equal(fake.field(id, '16'), 'nsmb-page');
  assert.deepEqual(fake.tagsOf(id), ['nsmb_wl_incomplete', 'signup_waitlist_nsmb']);

  assert.equal((await call('answers', { c: r.body.code, q1: '4년째 이직 고민' })).body.complete, false);
  await call('answers', { c: r.body.code, q2: '책, 상담' });
  const done = await call('answers', { c: r.body.code, q3: 'a' });
  assert.equal(done.body.complete, true);
  assert.equal(fake.field(id, '11'), '4년째 이직 고민');
  assert.equal(fake.field(id, '12'), '책, 상담');
  assert.equal(fake.field(id, '13'), 'Yes');                                  // first option in AC's order
  assert.match(fake.field(id, '17'), /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(fake.tagsOf(id), ['nsmb_wl_12', 'signup_waitlist_nsmb']);
});

test('website: double opt-in goes through the AC form', async () => {
  const fake = fakeAC();
  Object.assign(process.env, { AC_FORM_ACTION: 'https://form.example/proc.php', AC_FORM_ID: '4' });
  const r = await call('', { name: '민지', email: 'minji@example.com', consent: 'on' });
  assert.equal(r.body.confirm, true);
  assert.equal(fake.state.forms, 1);
  assert.ok(!fake.state.calls.includes('POST /contactLists'));
});

test('website: invalid input, honeypot and forged codes', async () => {
  fakeAC();
  assert.equal((await call('', { name: '', email: 'x@y.z', consent: true })).status, 400);
  assert.equal((await call('', { name: 'a', email: 'x@y.z', consent: false })).status, 400);
  const bot = await call('', { name: 'a', email: 'x@y.z', consent: true, website: 'spam' });
  assert.deepEqual(bot.body, { ok: true, confirm: false });
  assert.equal((await call('answers', { c: '16-AAAAAAAAAAAAAAAA', q1: 'x' })).status, 404);
  assert.equal((await call('answers', { c: wl.linkCode(42) })).status, 400);  // nothing to save
  assert.equal((await call('nope', {})).status, 404);
});

test('personal link: lookup returns the first name only', async () => {
  fakeAC();
  const r = await call('lookup', { c: wl.linkCode(42) });
  assert.deepEqual(r.body, { ok: true, firstName: '지은' });
  assert.equal((await call('lookup', { c: wl.linkCode(999) })).status, 404);
});

test('manychat: needs the key; saves everything in one go', async () => {
  const fake = fakeAC();
  const body = { first_name: 'Sora', email: 'sora@example.com', consent: 'yes', q1: '퇴사', q2: '상담', q3: 'ⓑ' };
  assert.equal((await call('manychat', body)).status, 401);
  assert.equal((await call('manychat', body, { 'x-waitlist-key': 'wrong' })).status, 401);
  const r = await call('manychat', body, { 'x-waitlist-key': process.env.WAITLIST_MANYCHAT_KEY });
  assert.equal(r.status, 200);
  const id = wl.contactIdFromCode(r.body.code);
  assert.equal(fake.field(id, '13'), 'Maybe');
  assert.equal(fake.field(id, '16'), 'manychat');
  assert.deepEqual(fake.tagsOf(id), ['nsmb_wl_12', 'signup_waitlist_nsmb']);
});

test('admin button: gives every waitlist contact their link code, in batches', async () => {
  const fake = fakeAC();
  const admin = require('../../api/_lib/admin/waitlist.js');
  // Put 3 contacts on the waitlist tag through the normal sign-up.
  for (const e of ['a@example.com', 'b@example.com', 'c@example.com']) await call('', { name: 'x', email: e, consent: true });
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const m = /\/contacts\?tagid=(\d+)/.exec(url);
    if (m) {
      const list = [...fake.state.contacts.values()].filter((c) => fake.state.tags.get(c.id)?.has(m[1]));
      return { ok: true, status: 200, json: async () => ({ contacts: list }) };
    }
    return realFetch(url, opts);
  };
  for (const c of fake.state.contacts.values()) delete fake.state.fields[`${c.id}:18`];
  const r = await admin.actions['waitlist-link-codes']({ offset: 0 });
  assert.equal(r.total, 3);
  assert.equal(r.next, null);
  for (const c of fake.state.contacts.values()) if (c.id !== '42') assert.equal(fake.field(c.id, '18'), wl.linkCode(c.id));
  delete process.env.WAITLIST_SECRET;
  await assert.rejects(admin.actions['waitlist-link-codes']({}), /WAITLIST_SECRET/);
});
