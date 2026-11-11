// The email performance score (api/_lib/emails/score.js): who is compared with whom, and what counts as an outlier.
const test = require('node:test');
const assert = require('node:assert/strict');
const { score, legacy, median, level } = require('../../api/_lib/emails/score.js');

const DAY = 86400000;
const NOW = new Date('2026-11-01T00:00:00Z');
let nextId = 1;
// An email sent `daysAgo` days before NOW to `sent` people, with these open and click rates.
function email(daysAgo, sent, open, click, extra = {}) {
  return { id: nextId++, kind: 'campaign', sent_at: new Date(NOW.getTime() - daysAgo * DAY), sent, opened: Math.round(sent * open), clicked: Math.round(sent * click), has_link: null, ...extra };
}
// 40 ordinary emails to ~600 people: opens around 25%, clicks around 1.5%.
function ordinary(n = 40, sent = 600, startDay = 10) {
  return Array.from({ length: n }, (_, i) => email(startDay + i * 3, sent + (i % 5) * 10, 0.23 + (i % 5) * 0.01, 0.011 + (i % 4) * 0.003));
}

test('median', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test('levels', () => {
  assert.deepEqual([2.4, 2, 1.99, 1, 0.99, 0, -1.99, -2].map(level), ['top', 'top', 'above', 'above', 'typical', 'typical', 'typical', 'low']);
});

test('an email far above its neighbours is an outlier; an ordinary one is not', () => {
  const list = ordinary();
  const star = email(40, 610, 0.42, 0.05);
  const flop = email(55, 600, 0.11, 0.001);
  const s = score([...list, star, flop], NOW);
  assert.equal(s.get(star.id).level, 'top');
  assert.ok(s.get(star.id).open.z > 2 && s.get(star.id).click.z > 2);
  assert.equal(s.get(flop.id).level, 'low');
  const levels = list.map((e) => s.get(e.id).level);
  assert.ok(levels.every((l) => l === 'typical' || l === 'above'), levels.join());
  assert.equal(s.get(list[0].id).compared, 30);
});

test('an email without a link is scored on opens only, and can be an outlier', () => {
  const list = ordinary();
  const story = email(30, 600, 0.40, 0);
  const s = score([...list, story], NOW).get(story.id);
  assert.equal(s.click, null);
  assert.equal(s.score, s.open.z);
  assert.equal(s.level, 'top');
});

test('a link that nobody clicked counts against the email when we know it had one', () => {
  const list = ordinary();
  const unknown = email(30, 600, 0.25, 0);                       // spreadsheet: no clicks → treated as "no link"
  const linked = email(31, 600, 0.25, 0, { has_link: true });    // ActiveCampaign: it had a link
  const s = score([...list, unknown, linked], NOW);
  assert.equal(s.get(unknown.id).click, null);
  assert.ok(s.get(linked.id).click.z < -1);
  assert.ok(s.get(linked.id).score < s.get(unknown.id).score);
});

test('a small engaged segment is compared with similar audiences, not with the whole list', () => {
  // 30 sends to 1,700 people at 20% opens, 12 sends to 450 engaged people at 40% opens.
  const big = Array.from({ length: 30 }, (_, i) => email(10 + i * 2, 1700, 0.19 + (i % 3) * 0.01, 0.012));
  const segment = Array.from({ length: 12 }, (_, i) => email(11 + i * 4, 450, 0.39 + (i % 3) * 0.01, 0.012));
  const s = score([...big, ...segment], NOW);
  for (const e of segment) assert.notEqual(s.get(e.id).level, 'top'); // 40% is normal for that audience
  assert.ok(Math.abs(s.get(segment[3].id).open.usual - 0.40) < 0.02);
  assert.ok(Math.abs(s.get(big[3].id).open.usual - 0.20) < 0.02);
});

test('the comparison follows time: what was good in 2024 is not judged by 2026 numbers', () => {
  const old = Array.from({ length: 35 }, (_, i) => email(700 + i * 3, 600, 0.30 + (i % 3) * 0.01, 0.015));
  const recent = Array.from({ length: 35 }, (_, i) => email(10 + i * 3, 700, 0.20 + (i % 3) * 0.01, 0.015));
  const s = score([...old, ...recent], NOW);
  assert.ok(Math.abs(s.get(old[10].id).open.usual - 0.31) < 0.02);
  assert.ok(Math.abs(s.get(recent[10].id).open.usual - 0.21) < 0.02);
  assert.equal(s.get(recent[10].id).level, 'typical');
});

test('not scored: small sends, emails younger than 3 days, automation emails, and when there is nothing to compare with', () => {
  const list = ordinary();
  const small = email(20, 299, 0.6, 0.1);
  const fresh = email(2, 900, 0.5, 0.1);
  const auto = email(100, 5000, 0.6, 0.2, { kind: 'automation' });
  const s = score([...list, small, fresh, auto], NOW);
  assert.deepEqual([s.get(small.id), s.get(fresh.id), s.get(auto.id)], [{ state: 'small' }, { state: 'recent' }, { state: 'automation' }]);
  // they are not part of anyone's comparison either
  const without = score(list, NOW);
  assert.equal(s.get(list[0].id).score, without.get(list[0].id).score);
  const few = ordinary(4);
  assert.deepEqual(score(few, NOW).get(few[0].id), { state: 'alone' });
});

test('chance is taken into account: a few extra clicks on a small send are not an outlier', () => {
  // identical history, so the spread between emails is zero: only chance is left
  const list = Array.from({ length: 30 }, (_, i) => email(10 + i * 3, 320, 0.25, 0.0125)); // 4 clicks each
  const lucky = email(15, 320, 0.25, 0.025);                                             // 8 clicks
  const s = score([...list, lucky], NOW).get(lucky.id);
  assert.ok(Number.isFinite(s.click.z));
  assert.ok(s.click.z < 2.5, String(s.click.z));
});

test('the spreadsheet formula (Perf) is reproduced', () => {
  // medians: open rate 0.20, click rate (clicked > 0 only) 0.025
  const pool = [
    { id: 1, openRate: 0.10, clickRate: 0.01 }, { id: 2, openRate: 0.20, clickRate: 0.02 }, { id: 3, openRate: 0.30, clickRate: 0.03 },
    { id: 4, openRate: 0.26, clickRate: 0 }, { id: 5, openRate: 0.15, clickRate: 0.06 },
  ];
  const p = legacy(pool);
  assert.equal(p.get(2).toFixed(4), '0.8600');                      // 0.7 × 0.02/0.025 + 0.3 × 0.20/0.20
  assert.equal(p.get(4).toFixed(4), '1.3000');                      // no click: open rate / median only
  assert.equal(p.get(5).toFixed(4), (0.7 * 0.06 / 0.025 + 0.3 * 0.15 / 0.2).toFixed(4));
  const list = ordinary();
  const s = score(list, NOW);
  assert.ok(s.get(list[0].id).legacy > 0);
});
