const test = require('node:test');
const assert = require('node:assert/strict');
const automation = require('../../api/_lib/automation.js');
const { contactFrom, addedTagFrom } = require('../../api/podcast-ac.js');

const show = { slug: 'nsmb', ac_tag_prefix: 'learning_nsmb' };
const ep = (n, releaseAt) => ({ episode: { id: n, kind: 'week', number: n }, releaseAt: new Date(releaseAt) });
const now = new Date('2026-11-20T01:00:00Z');

test('tag names per program (renamed from podcast_… on 2026-11-26; unused ones removed)', () => {
  const t = automation.tags(show);
  assert.equal(t.enrolled, 'learning_nsmb_enrolled');
  assert.equal(t.released(3), 'learning_nsmb_week03_released');
  assert.equal(t.notStarted3, 'learning_nsmb_not_started_3d');
  assert.equal(t.notStarted7, 'learning_nsmb_not_started_7d');
  assert.equal(t.subscribed, undefined);
  assert.equal(t.downloaded, undefined);
  assert.equal(automation.tags({ slug: 'eft-test', ac_tag_prefix: '' }).completed, 'learning_eft_test_completed');
  assert.equal(automation.defaultPrefix('eft-test'), 'learning_eft_test');
  assert.equal(automation.LINK_RESET_TAG, 'learning_link_reset');
});

test('the sign-in link goes to the LEARNINGLINK field unless Vercel names another', () => {
  assert.equal(automation.linkField({}), 'LEARNINGLINK');
  assert.equal(automation.linkField({ AC_FIELD_LEARNING_LINK: '%MY_LINK%' }), 'MY_LINK');
  assert.equal(automation.linkField({ AC_FIELD_PODCAST_LINK: 'OLD' }), 'OLD');
});

test('public address: explicit, preview, production default', () => {
  assert.equal(automation.publicBase({ LEARNING_PUBLIC_URL: 'https://www.ashleylim.com/' }), 'https://www.ashleylim.com');
  assert.equal(automation.publicBase({ PODCAST_PUBLIC_URL: 'https://old.example/' }), 'https://old.example');
  assert.equal(automation.publicBase({ VERCEL_ENV: 'preview', VERCEL_BRANCH_URL: 'x-git-podcast.vercel.app' }), 'https://x-git-podcast.vercel.app');
  assert.equal(automation.publicBase({ VERCEL_ENV: 'production', VERCEL_BRANCH_URL: 'x.vercel.app' }), 'https://www.ashleylim.com');
});

test('daily tags: today\'s release yes, catch-up modules no', () => {
  const access = { state: 'active', episodes: [ep(1, '2026-11-02T00:00:00Z'), ep(2, '2026-11-09T00:00:00Z'), ep(3, '2026-11-16T00:00:00Z'), ep(4, '2026-11-19T15:00:00Z')], expires: new Date('2027-11-01T15:00:00Z') };
  const tags = automation.dailyTags({ show, access, enrolledAt: new Date('2026-11-01T00:00:00Z'), subscribed: true, now }).map((x) => x.tag);
  assert.deepEqual(tags, ['learning_nsmb_week04_released']);
  // Enrolled after module 4 came out (late joiner): no release tag for it.
  const late = automation.dailyTags({ show, access, enrolledAt: new Date('2026-11-19T20:00:00Z'), subscribed: true, now }).map((x) => x.tag);
  assert.deepEqual(late, []);
});

test('daily tags: nothing played after 3 and 7 days; expiring; expired', () => {
  const access = { state: 'active', episodes: [ep(1, '2026-11-02T00:00:00Z')], expires: new Date('2026-12-10T15:00:00Z') };
  const tags = automation.dailyTags({ show, access, enrolledAt: new Date('2026-11-05T00:00:00Z'), subscribed: false, now }).map((x) => x.tag);
  assert.deepEqual(tags, ['learning_nsmb_not_started_3d', 'learning_nsmb_not_started_7d', 'learning_nsmb_expiring_30d']);
  const four = automation.dailyTags({ show, access: { ...access, expires: new Date('2027-11-01T15:00:00Z') }, enrolledAt: new Date('2026-11-16T00:00:00Z'), subscribed: false, now }).map((x) => x.tag);
  assert.deepEqual(four, ['learning_nsmb_not_started_3d']);
  const ended = automation.dailyTags({ show, access: { state: 'expired', episodes: [], expires: new Date('2026-11-18T15:00:00Z') }, enrolledAt: new Date('2025-11-01T00:00:00Z'), subscribed: true, now });
  assert.deepEqual(ended.map((x) => x.tag), ['learning_nsmb_expired']);
  assert.match(ended[0].key, /^expired:2026-11-18$/);
});

test('retry delays grow and cap at 12 hours', () => {
  assert.equal(automation.backoffMs(1), 5 * 60 * 1000);
  assert.equal(automation.backoffMs(3), 20 * 60 * 1000);
  assert.equal(automation.backoffMs(20), 12 * 60 * 60 * 1000);
});

test('webhook body: AC form fields and JSON', () => {
  const form = Object.fromEntries(new URLSearchParams('contact%5Bid%5D=42&contact%5Bemail%5D=Ji%40Ex.kr&contact%5Bfirst_name%5D=%EA%B9%80%EC%A7%80%EC%97%B0&contact%5Btags%5D=nsmb-2%EA%B8%B0%2C+newsletter'));
  assert.deepEqual(contactFrom(form), { id: '42', email: 'ji@ex.kr', firstName: '김지연', tags: ['nsmb-2기', 'newsletter'] });
  assert.deepEqual(contactFrom({ contact: { email: 'a@b.kr', tags: ['x'] } }), { id: null, email: 'a@b.kr', firstName: '', tags: ['x'] });
  assert.equal(contactFrom({ 'contact[email]': 'a@b.kr' }).tags, null); // no tags: AC is asked instead
});

test('the account-level "Contact Tag Added" webhook names the added tag', () => {
  assert.equal(addedTagFrom({ type: 'contact_tag_added', tag: ' purchased_nsmb_12_202612 ', 'contact[email]': 'a@b.kr' }), 'purchased_nsmb_12_202612');
  assert.equal(addedTagFrom({ tag: { name: 'x' } }), 'x');
  assert.equal(addedTagFrom({ 'contact[email]': 'a@b.kr', 'contact[tags]': 'a, b' }), null); // automation webhook: no single tag
  assert.equal(addedTagFrom({ tag: '' }), null);
});

test('week tags: only Week episodes, once per week number even with several episodes in that week', () => {
  const now = new Date('2026-11-16T01:00:00Z');
  const access = { state: 'active', expires: new Date('2027-11-01T00:00:00Z'), episodes: [
    { episode: { id: 1, kind: 'week', number: 2 }, releaseAt: new Date('2026-11-16T00:00:00Z') },
    { episode: { id: 2, kind: 'week', number: 2 }, releaseAt: new Date('2026-11-16T00:00:00Z') },
    { episode: { id: 3, kind: 'qa', number: 2 }, releaseAt: new Date('2026-11-16T00:00:00Z') },
    { episode: { id: 4, kind: 'live', number: null }, releaseAt: new Date('2026-11-16T00:00:00Z') },
  ] };
  const tags = automation.dailyTags({ show: { slug: 'nsmb', ac_tag_prefix: 'learning_nsmb' }, access, enrolledAt: new Date('2026-11-01T00:00:00Z'), subscribed: true, now });
  const released = tags.filter((t) => /_released$/.test(t.tag));
  assert.deepEqual([...new Set(released.map((t) => t.key))], ['ep2-released'], 'one dedupe key for the week');
  assert.ok(released.every((t) => t.tag === 'learning_nsmb_week02_released'));
});
