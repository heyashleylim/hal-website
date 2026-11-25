// Reviews (api/_lib/students/reviews.js, forms.js) and the review form page (site/lifeartist/review).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv, fromCsv, clean, cohortFromTags } = require('../../api/_lib/students/reviews.js');
const { FORMS, questionLabels } = require('../../api/_lib/students/forms.js');

const f = FORMS['lifeartist-2026'];
const header = [f.csv.name, f.csv.email, ...f.questions.map((q) => q.csv), f.csv.submitted_at];

test('CSV: quoted fields keep their commas, quotes, line breaks and emoji exactly', () => {
  const answer = '첫 줄, 쉼표\n\n둘째 줄 "따옴표" 🥹  ';
  const csv = '﻿' + header.join(',') + '\r\n' +
    ['김테스트', 'Test@Example.com', `"${answer.replace(/"/g, '""')}"`, ...f.questions.slice(1).map(() => '네'), '2026-08-31 10:18:20'].join(',') + '\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1);
  const [r] = fromCsv('lifeartist-2026', rows);
  assert.equal(r.answers.why_continue, answer);
  assert.equal(r.name, '김테스트');
  const c = clean(r);
  assert.equal(c.email, 'test@example.com');
  assert.equal(c.submittedAt, '2026-08-31T01:18:20.000Z'); // Seoul time
  assert.equal(c.answers.why_continue, answer); // never trimmed or changed
  assert.equal(clean({ ...r, answers: { why_continue: '한 줄\r\n두 줄\r세 줄' } }).answers.why_continue, '한 줄\n두 줄\n세 줄'); // line breaks as \n
  assert.deepEqual(c.problems, []);
});

test('CSV: a file without the form\'s columns is refused, naming what is missing', () => {
  assert.throws(() => fromCsv('lifeartist-2026', [{ Name: 'a', 'Email Address': 'a@b.co' }]), /missing columns review_why_continue_after_nsmb/);
});

test('a review needs a name, a valid email and, from the form page, every required answer', () => {
  const answers = Object.fromEntries(f.questions.map((q) => [q.key, '답']));
  assert.deepEqual(clean({ form: 'lifeartist-2026', name: '김', email: 'a@b.co', answers, strict: true }).problems, []);
  delete answers.final_thoughts; // optional
  assert.deepEqual(clean({ form: 'lifeartist-2026', name: '김', email: 'a@b.co', answers, strict: true }).problems, []);
  answers.recommend = '   ';
  assert.deepEqual(clean({ form: 'lifeartist-2026', name: ' ', email: 'nope', answers, strict: true }).problems, ['name', 'email', 'recommend']);
  assert.throws(() => clean({ form: 'nope' }), /unknown review form/);
});

for (const [key, form] of Object.entries(FORMS)) {
  test(`the ${key} review page (/${form.page.path}) asks exactly its questions, in order, with their hints`, () => {
    const html = fs.readFileSync(path.join(__dirname, '../../site', form.page.path, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`data-form="${key}"`));
    const unescape = (x) => x.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const asked = [...html.matchAll(/<label class="wlf__q" for="rv-([a-z_]+)"><span class="wlf__n">[^<]*<\/span>([^<]*)<\/label>/g)].map((m) => [m[1], unescape(m[2])]);
    assert.deepEqual(asked, form.questions.map((q) => [q.key, q.ko]));
    for (const q of form.questions) {
      if (q.hint) assert.ok(unescape(html).includes(q.hint), `hint of ${q.key}`);
      assert.match(html, new RegExp(`name="q_${q.key}"`));
      assert.match(html, new RegExp(`id="rv-${q.key}"[^>]*${q.required ? 'data-required' : ''}`));
    }
    assert.match(html, /GTM-MK4FNWNV/);
    assert.match(html, /name="robots" content="noindex"/);
    assert.ok(fs.existsSync(path.join(__dirname, '../../site', form.page.path, 'thanks', 'index.html')), 'thanks page');
  });
}

test('NSMB reviews take the cohort from her highest purchase tag', () => {
  assert.equal(cohortFromTags(['purchased_nsmb_3_202311', 'purchased_nsmb_11_202609', 'purchased_lifeartist_2026'], 'nsmb'), 11);
  assert.equal(cohortFromTags(['purchased_eft'], 'nsmb'), null);
  assert.equal(cohortFromTags(null, 'nsmb'), null);
  assert.equal(FORMS.nsmb.cohort, 'tags');
});

test('the NSMB form uses the old form\'s export columns', () => {
  const head = ['Name', 'Email Address', ...FORMS.nsmb.questions.map((q) => q.csv), 'created_at'];
  const csv = head.join(',') + '\n' + ['김', 'a@b.co', ...FORMS.nsmb.questions.map(() => '답'), '2026-07-01 09:00:00'].join(',') + '\n';
  const [r] = fromCsv('nsmb', parseCsv(csv));
  assert.equal(r.answers.life_before, '답');
  assert.equal(r.answers.final_thoughts, '답');
});

test('question labels for the admin are keyed by program and question', () => {
  const l = questionLabels();
  assert.equal(l['lifeartist:why_continue'].n, 1);
  assert.equal(l['lifeartist:final_thoughts'].n, 9);
});
