// Copying ActiveCampaign contacts (api/_lib/contacts/ac-sync.js): what is kept from AC's answers. Read-only on AC.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sync = require('../../api/_lib/contacts/ac-sync.js');
const fakeAc = require('../../tools/contacts/fake-ac.js');

test('a contact from AC keeps its email in lower case, names, phone and dates', () => {
  const row = sync.contactRow({ id: 12, email: ' Someone@Example.COM ', firstName: ' 김테스트 ', lastName: '', phone: '010', cdate: '2026-01-02T03:04:05-06:00', udate: '0000-00-00 00:00:00' });
  assert.deepEqual(row, { ac_id: '12', email: 'someone@example.com', first_name: '김테스트', last_name: '', phone: '010', ac_created_at: '2026-01-02T09:04:05.000Z', ac_updated_at: null });
});

test('details: tag, list and field ids become their names', async () => {
  const fake = fakeAc.create({ count: 12 });
  const names = { tag: new Map([['1', 'purchased_nsmb_10_202602'], ['2', 'purchased_eft'], ['3', 'waitlist_nsmb'], ['4', 'masterclass_2026_10'], ['5', 'podcast_nsmb_enrolled']]),
    list: new Map([['1', 'Master Contact List']]), field: new Map([['2', 'Phone country']]) };
  sync.setClient(fake.request, { noPause: true });
  const d = await sync.details('1006', names);
  assert.equal(d.contact.email, 'fake.contact6@example.com');
  assert.ok(d.tags.length > 0 && d.tags.every((t) => typeof t === 'string'));
  assert.deepEqual(d.tags, [...d.tags].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(d.lists, [{ name: 'Master Contact List', status: 'subscribed' }]);
  assert.deepEqual(d.fields, { 'Phone country': 'KR' });
});

test('a contact deleted in AC answers 404 (the sync then keeps it, marked gone)', async () => {
  const fake = fakeAc.create({ count: 3 });
  fake.remove('1002');
  await assert.rejects(fake.request('/contacts/1002'), (err) => err.status === 404);
});

test('the sync never writes to ActiveCampaign: only GET requests, no ac.js helper that changes AC', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../api/_lib/contacts/ac-sync.js'), 'utf8');
  assert.doesNotMatch(src, /method:\s*['"](POST|PUT|DELETE)/);
  assert.doesNotMatch(src, /ac\.(addTag|removeTag|syncContact|updateContactFields|subscribeToList)/);
});
