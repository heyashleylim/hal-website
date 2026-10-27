const test = require('node:test');
const assert = require('node:assert/strict');
const u = require('../../api/_lib/admin/util.js');

test('input checks give readable errors', () => {
  assert.equal(u.text('  hi  ', { label: 'Title' }), 'hi');
  assert.throws(() => u.text('', { required: true, label: 'Title' }), /Title is required/);
  assert.equal(u.int('7', { label: 'Days' }), 7);
  assert.throws(() => u.int('1.5', { label: 'Days' }), /Days must be a whole number/);
  assert.equal(u.int('', { optional: true }), null);
  assert.equal(u.date('2026-10-25'), '2026-10-25');
  assert.throws(() => u.date('25/10/2026', { label: 'Start date' }), /Start date must be a date/);
  assert.equal(u.time('09:00'), '09:00');
  assert.throws(() => u.time('9am'), /must be a time/);
  assert.equal(u.email(' A@B.KR '), 'a@b.kr');
  assert.equal(u.email('', { optional: true }), '');
  assert.throws(() => u.email('nope'), /valid email/);
});

test('unique violations become messages', async () => {
  const dup = Object.assign(new Error('duplicate key value violates unique constraint "cohorts_ac_tag"'), { code: '23505' });
  await assert.rejects(u.friendlyUnique(Promise.reject(dup), { cohorts_ac_tag: 'tag taken' }), (e) => e.message === 'tag taken' && e.status === 400 && e.expose);
  const other = new Error('boom');
  await assert.rejects(u.friendlyUnique(Promise.reject(other), {}), /boom/);
});
