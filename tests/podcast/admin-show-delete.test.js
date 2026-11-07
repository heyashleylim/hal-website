// Deleting a program: needs its short name, never the last program, removes its files.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function load({ shows }) {
  const calls = { sql: [], deleted: [] };
  const stub = (file, exports) => {
    const id = require.resolve(file);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  stub(path.join(__dirname, '../../api/_lib/db.js'), {
    async one(sql, params) {
      calls.sql.push(sql);
      if (/FROM shows WHERE slug/.test(sql)) return shows.find((s) => s.slug === params[0]) || null;
      if (/FROM shows ORDER BY id LIMIT 1/.test(sql)) return shows[0];
      if (/count\(\*\)::int AS n FROM shows/.test(sql)) return { n: shows.length };
      if (/AS episodes/.test(sql)) return { episodes: 2, cohorts: 1, enrollments: 3 };
      return null;
    },
    async query(sql) { calls.sql.push(sql); return []; },
  });
  stub(require.resolve('@vercel/blob'), {
    async list({ prefix }) { return { blobs: [{ pathname: prefix + 'audio/a.mp3' }, { pathname: prefix + 'art/c.png' }], hasMore: false }; },
    async del(p) { calls.deleted.push(...[].concat(p)); },
  });
  for (const f of ['../../api/_lib/admin/podcast-content.js', '../../api/_lib/admin/util.js']) delete require.cache[require.resolve(f)];
  return { actions: require('../../api/_lib/admin/podcast-content.js').actions, calls };
}

const two = [{ id: 1, slug: 'nsmb', title: '내성만방' }, { id: 2, slug: 'eft-test', title: 'EFT 테스트' }];

test('program delete needs the short name typed exactly', async () => {
  const { actions, calls } = load({ shows: two });
  await assert.rejects(actions['show-delete']({ show: 'eft-test', confirm: 'eft' }), /type the short name "eft-test"/);
  assert.ok(!calls.sql.some((s) => /DELETE FROM shows/.test(s)));
});

test('the last program cannot be deleted', async () => {
  const { actions } = load({ shows: [two[0]] });
  await assert.rejects(actions['show-delete']({ show: 'nsmb', confirm: 'nsmb' }), /only program/);
});

test('program delete removes the row and only that program’s files', async () => {
  const { actions, calls } = load({ shows: two });
  const r = await actions['show-delete']({ show: 'eft-test', confirm: ' EFT-test ' });
  assert.ok(calls.sql.some((s) => /DELETE FROM shows WHERE id = \$1/.test(s)));
  assert.deepEqual(calls.deleted, ['podcast/eft-test/audio/a.mp3', 'podcast/eft-test/art/c.png']);
  assert.deepEqual(r.counts, { episodes: 2, cohorts: 1, enrollments: 3, files: 2 });
});
