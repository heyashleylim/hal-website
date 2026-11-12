const test = require('node:test');
const assert = require('node:assert/strict');
const { assess, rank, LIMITS } = require('../../api/_lib/sharing.js');

test('limits: more than 2 networks, 1 country, 1 app, 1 network per episode', () => {
  assert.deepEqual({ ...LIMITS }, { networks: 2, countries: 1, apps: 1, episodeNetworks: 1, windowDays: 7 });
});

test('one phone on two networks, one country and one app is not flagged', () => {
  const r = assess({ networks: 2, countries: ['KR'], apps: ['Apple Podcasts'], episode_networks: 1 });
  assert.equal(r.suspect, false);
  assert.deepEqual(r.reasons, []);
});

test('missing or empty stats are not flagged', () => {
  assert.equal(assess().suspect, false);
  assert.equal(assess({ countries: null, apps: [null] }).suspect, false);
});

test('each signal gives its own reason', () => {
  assert.deepEqual(assess({ networks: 3 }).reasons, ['3 networks in 7 days']);
  assert.deepEqual(assess({ countries: ['KR', 'US'] }).reasons, ['2 countries (KR, US)']);
  assert.deepEqual(assess({ apps: ['Apple Podcasts', 'Pocket Casts'] }).reasons, ['2 podcast apps (Apple Podcasts, Pocket Casts)']);
  assert.deepEqual(assess({ episode_networks: 2 }).reasons, ['one episode downloaded from 2 networks']);
});

test('several signals add up in the score, and rank puts them first', () => {
  const a = { networks: 3, sharing: assess({ networks: 3 }) };
  const b = { networks: 4, sharing: assess({ networks: 4, episode_networks: 3 }) };
  const c = { networks: 9, sharing: assess({ networks: 9 }) };
  assert.equal(b.sharing.score, 2);
  assert.deepEqual([a, b, c].sort(rank), [b, c, a]);
});
