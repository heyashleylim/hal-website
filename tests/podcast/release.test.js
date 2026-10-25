const test = require('node:test');
const assert = require('node:assert/strict');
const r = require('../../api/_lib/release.js');

const show = { release_time: '09:00', timezone: 'Asia/Seoul', access_days: 365 };
const cohortA = { id: 1, start_date: '2026-11-02' };
const listener = { id: 1, status: 'active', start_override: null, expires_override: null };
const episodes = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, number: i + 1, day_offset: i * 7, status: 'published' }));
const iso = (d) => d && d.toISOString();

test('zonedTime: 09:00 KST is 00:00 UTC', () => {
  assert.equal(iso(r.zonedTime('2026-11-02', '09:00', 'Asia/Seoul')), '2026-11-02T00:00:00.000Z');
});

test('zonedTime handles a DST zone', () => {
  assert.equal(iso(r.zonedTime('2026-07-01', '09:00', 'Europe/Paris')), '2026-07-01T07:00:00.000Z');
  assert.equal(iso(r.zonedTime('2026-12-01', '09:00', 'Europe/Paris')), '2026-12-01T08:00:00.000Z');
});

test('ymd accepts strings and local-midnight Dates', () => {
  assert.equal(r.ymd('2026-11-02'), '2026-11-02');
  assert.equal(r.ymd(new Date(2026, 10, 2)), '2026-11-02');
  assert.equal(r.addDays('2026-12-28', 7), '2027-01-04');
});

test('weekly drip from the cohort start, at the release time', () => {
  const s = r.schedule({ show, cohort: cohortA, listener, episodes });
  assert.equal(s.length, 12);
  assert.equal(iso(s[0].releaseAt), '2026-11-02T00:00:00.000Z');
  assert.equal(iso(s[1].releaseAt), '2026-11-09T00:00:00.000Z');
  assert.equal(iso(s[11].releaseAt), '2027-01-18T00:00:00.000Z');
});

test('nothing before the start; module 1 at 09:00 KST on day one', () => {
  const before = r.released({ show, cohort: cohortA, listener, episodes, now: new Date('2026-11-01T23:59:00Z') });
  assert.equal(before.episodes.length, 0);
  assert.equal(before.next.episode.number, 1);
  const at = r.released({ show, cohort: cohortA, listener, episodes, now: new Date('2026-11-02T00:00:00Z') });
  assert.deepEqual(at.episodes.map((e) => e.episode.number), [1]);
  assert.equal(at.next.episode.number, 2);
});

test('late joiner gets everything already released at once (D5)', () => {
  const late = { ...listener, created_at: '2026-11-20' };
  const res = r.released({ show, cohort: cohortA, listener: late, episodes, now: new Date('2026-11-20T03:00:00Z') });
  assert.deepEqual(res.episodes.map((e) => e.episode.number), [1, 2, 3]);
});

test('two cohorts on the same show have their own schedules', () => {
  const cohortB = { id: 2, start_date: '2027-03-01' };
  const now = new Date('2027-03-02T00:00:00Z');
  assert.equal(r.released({ show, cohort: cohortA, listener, episodes, now }).episodes.length, 12);
  assert.equal(r.released({ show, cohort: cohortB, listener, episodes, now }).episodes.length, 1);
});

test('drafts are never released', () => {
  const eps = episodes.map((e) => (e.number === 2 ? { ...e, status: 'draft' } : e));
  const res = r.released({ show, cohort: cohortA, listener, episodes: eps, now: new Date('2026-12-01T00:00:00Z') });
  assert.deepEqual(res.episodes.map((e) => e.episode.number), [1, 3, 4, 5]);
});

test('cohort override moves one episode; own schedule ignores it', () => {
  const overrides = new Map([[3, new Date('2026-11-25T00:00:00Z')]]);
  const s = r.schedule({ show, cohort: cohortA, listener, episodes, overrides });
  assert.equal(iso(s.find((e) => e.episode.id === 3).releaseAt), '2026-11-25T00:00:00.000Z');
  const own = { ...listener, start_override: '2026-12-07' };
  const s2 = r.schedule({ show, cohort: cohortA, listener: own, episodes, overrides });
  assert.equal(iso(s2.find((e) => e.episode.id === 3).releaseAt), '2026-12-21T00:00:00.000Z');
});

test('access ends 365 days after the cohort start (D4), at 00:00 KST', () => {
  const end = r.expiresAt({ show, cohort: cohortA, listener });
  assert.equal(iso(end), '2027-11-01T15:00:00.000Z');
  assert.equal(r.accessState({ show, cohort: cohortA, listener, now: new Date('2027-11-01T14:59:00Z') }), 'active');
  const after = r.released({ show, cohort: cohortA, listener, episodes, now: new Date('2027-11-01T15:00:00Z') });
  assert.equal(after.state, 'expired');
  assert.equal(after.episodes.length, 0);
});

test('expiry: cohort access_days and per-student override win', () => {
  assert.equal(iso(r.expiresAt({ show, cohort: { ...cohortA, access_days: 30 }, listener })), '2026-12-01T15:00:00.000Z');
  const extended = { ...listener, expires_override: '2028-01-01T00:00:00Z' };
  assert.equal(r.accessState({ show, cohort: cohortA, listener: extended, now: new Date('2027-12-01T00:00:00Z') }), 'active');
});

test('revoked and cohort-less students get nothing', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  assert.equal(r.released({ show, cohort: cohortA, listener: { ...listener, status: 'revoked' }, episodes, now }).state, 'revoked');
  const none = r.released({ show, cohort: null, listener, episodes, now });
  assert.equal(none.state, 'no-cohort');
  assert.equal(none.episodes.length, 0);
});

// ---- several enrolments in one show (showAccess) ----
const enr = (cohort, extra = {}) => ({ cohort, enrollment: { status: 'active', start_override: null, expires_override: null, ...extra } });
const cohortB = { id: 2, start_date: '2027-03-01' };

test('two cohorts: earliest release wins, access until the later end', () => {
  const now = new Date('2027-03-02T00:00:00Z');
  const a = r.showAccess({ show, student: { status: 'active' }, enrollments: [enr(cohortA), enr(cohortB)], episodes, now });
  assert.equal(a.state, 'active');
  assert.equal(a.episodes.length, 12); // all from cohort A
  assert.equal(iso(a.expires), '2028-02-28T15:00:00.000Z'); // 00:00 KST on 29 Feb 2028 = cohort B start + 365 days
});

test('returning student: old cohort expired, new cohort drips from module 1', () => {
  const now = new Date('2027-11-10T00:00:00Z'); // cohort A ended 2027-11-02
  const cohortC = { id: 3, start_date: '2027-11-08' };
  const a = r.showAccess({ show, student: { status: 'active' }, enrollments: [enr(cohortA), enr(cohortC)], episodes, now });
  assert.equal(a.state, 'active');
  assert.deepEqual(a.episodes.map((e) => e.episode.number), [1]);
  assert.equal(a.next.episode.number, 2);
});

test('states: expired, revoked enrolment, revoked student, not enrolled', () => {
  const late = new Date('2028-01-01T00:00:00Z');
  assert.equal(r.showAccess({ show, student: { status: 'active' }, enrollments: [enr(cohortA)], episodes, now: late }).state, 'expired');
  assert.equal(r.showAccess({ show, student: { status: 'active' }, enrollments: [enr(cohortA, { status: 'revoked' })], episodes }).state, 'revoked');
  const both = r.showAccess({ show, student: { status: 'active' }, enrollments: [enr(cohortA, { status: 'revoked' }), enr(cohortB)], episodes, now: new Date('2027-03-02T00:00:00Z') });
  assert.equal(both.state, 'active');
  assert.equal(both.episodes.length, 1); // revoked enrolment gives nothing
  assert.equal(r.showAccess({ show, student: { status: 'revoked' }, enrollments: [enr(cohortA)], episodes }).state, 'revoked');
  assert.equal(r.showAccess({ show, student: { status: 'active' }, enrollments: [], episodes }).state, 'not-enrolled');
});

test('own start date and extended access on one enrolment', () => {
  const now = new Date('2027-12-01T00:00:00Z');
  const a = r.showAccess({ show, student: { status: 'active' }, enrollments: [enr(cohortA, { expires_override: '2028-06-01T00:00:00Z' })], episodes, now });
  assert.equal(a.state, 'active');
  assert.equal(a.episodes.length, 12);
});
