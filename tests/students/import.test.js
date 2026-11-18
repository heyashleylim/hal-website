// Students section: reading the spreadsheet (tools/students/import.js), translations (tools/students/translations.js)
// and when a student waits for the admin's decision (api/_lib/admin/program-students.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { students, sheetRows } = require('../../tools/students/import.js');
const { parseBatch, md5, HANGUL } = require('../../tools/students/translations.js');
const { needsDecision } = require('../../api/_lib/admin/program-students.js');

const header = { row: 1, cells: { A: '#', B: 'Cohort', C: 'Student', D: 'Occupation', E: 'Age', F: 'Testimonial', G: 'Persona', H: 'rating', I: 'top_quotable_line', J: 'return_signal', K: 'specificity' } };

test('a student row keeps her texts exactly as in the cell (spaces, line breaks, emoji)', () => {
  const text = '  첫 줄입니다.\n\n둘째 줄 💡  ';
  const [s] = students([header, { row: 2, cells: { A: 7, B: 4, C: '김테스트', E: '30대', F: text, G: 'P2', H: 4, I: '둘째 줄', J: 'Y', K: 2 } }]);
  assert.equal(s.texts.testimonial, text);
  assert.equal(s.row, 7);
  assert.equal(s.cohort, 4);
  assert.equal(s.round1.persona, 'P2');
  assert.equal(s.round1.rating, 4);
  assert.equal(s.round1.scores.return_signal, true);
  assert.equal(s.round1.scores.specificity, 2);
});

test('rows without a "#" are skipped; a sheet without the key columns is refused', () => {
  assert.equal(students([header, { row: 2, cells: { C: 'note only' } }]).length, 0);
  assert.throws(() => students([{ row: 1, cells: { A: 'Name' } }]), /no column #, cohort, student/);
});

test('a reference sheet keeps every cell in its column, blanks included', () => {
  const rows = sheetRows([{ row: 1, cells: { A: 'persona_id', C: 'P2' } }, { row: 2, cells: { B: 0.2545454545 } }]);
  assert.deepEqual(rows[0].map((c) => c.ko), ['persona_id', '', 'P2']);
  assert.equal(rows[1][1].ko, '0.255');
  assert.ok(rows.every((r) => r.every((c) => c.en === '')));
});

test('translated batches are read item by item, keyed by the md5 of the Korean', () => {
  const key = md5('안녕하세요');
  const out = parseBatch(`=====ITEM ${key}=====\nHello\n\nSecond line\n=====ITEM ${md5('x')}=====\nX\n`);
  assert.deepEqual(out[0], { key, en: 'Hello\n\nSecond line' });
  assert.equal(out.length, 2);
  assert.ok(HANGUL.test('P2 번아UT') && !HANGUL.test('P2 only'));
});

test('a student waits for a decision only when the rounds disagree and nothing is decided', () => {
  const base = { persona: null, rating: null, kinds: ['onboarding', 'testimonial'] };
  assert.deepEqual(needsDecision({ ...base, rounds: [{ persona: 'P1', rating: 4 }, { persona: 'P1', rating: 4 }] }), { persona: false, rating: false });
  assert.deepEqual(needsDecision({ ...base, rounds: [{ persona: 'P1', rating: 5 }, { persona: 'P5', rating: 4 }] }), { persona: true, rating: true });
  assert.deepEqual(needsDecision({ ...base, persona: 'P5', rating: 4, rounds: [{ persona: 'P1', rating: 5 }, { persona: 'P5', rating: 4 }] }), { persona: false, rating: false });
  assert.deepEqual(needsDecision({ ...base, kinds: ['onboarding'], rounds: [{ persona: 'P1', rating: null }, { persona: 'P1', rating: 3 }] }), { persona: false, rating: false });
});

test('"good for" categories: only known keys, no duplicates; empty means none', () => {
  const { useCats, USE_CATS } = require('../../api/_lib/admin/program-students.js');
  assert.deepEqual(useCats(['hook', 'before', 'hook']), ['hook', 'before']);
  assert.deepEqual(useCats('outcome,why'), ['outcome', 'why']);
  assert.deepEqual(useCats(''), []);
  assert.deepEqual(useCats(undefined), []);
  assert.throws(() => useCats(['headline']), /unknown/);
  assert.ok(Object.keys(USE_CATS).length >= 5);
});
