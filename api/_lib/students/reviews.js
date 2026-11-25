/*
 * Saving a review (one text per answer) for a program student, from the review form page (api/review.js), the CSV
 * import in the admin (api/_lib/admin/program-students.js) or tools/students/reviews.js.
 *
 * - The enrolment is found by program + cohort + email, or created (sheet_row = the next number in that program).
 * - Each answer is a student text (kind 'review', question_key). An unchanged answer is left alone; a changed one is
 *   saved as a new version and the old one is kept (the database never lets a student's words be changed).
 * - She is linked to her ActiveCampaign contact by email, and her other enrolments (e.g. NSMB, where we have no email)
 *   to the same contact when exactly one of them has her name and the contact bought that program. Nothing is
 *   sent to ActiveCampaign.
 */
const db = require('../db.js');
const { form, MAX_ANSWER } = require('./forms.js');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const squash = (s) => String(s || '').normalize('NFC').replace(/\s+/g, '');

function clean(input) {
  const f = form(input.form);
  const name = String(input.name || '').normalize('NFC').trim().slice(0, 100);
  const email = String(input.email || '').trim().toLowerCase().slice(0, 200);
  const answers = {};
  for (const q of f.questions) {
    // Kept exactly as written (no trimming inside); only empty answers are dropped. Line breaks are stored as "\n"
    // (exports and form posts send "\r\n"), so a passage selected in the admin is found again in the text.
    const v = input.answers && input.answers[q.key] != null ? String(input.answers[q.key]).replace(/\r\n?/g, '\n') : '';
    if (v.trim()) answers[q.key] = v.length > MAX_ANSWER ? v.slice(0, MAX_ANSWER) : v;
  }
  const problems = [];
  if (!name) problems.push('name');
  if (!EMAIL.test(email)) problems.push('email');
  for (const q of f.questions) if (input.strict && q.required && !answers[q.key]) problems.push(q.key);
  if (!Object.keys(answers).length) problems.push('answers');
  let submittedAt = null;
  if (input.submitted_at) {
    // the old form's export: "2026-08-31 10:18:20", Seoul time
    const s = String(input.submitted_at).trim().replace(' ', 'T');
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + '+09:00');
    if (!Number.isNaN(d.getTime())) submittedAt = d.toISOString();
  }
  return { f, formKey: input.form, name, email, answers, submittedAt, problems };
}

async function enrolment(f, name, email) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.one(
        `INSERT INTO program_students (program, cohort, sheet_row, name, email)
         SELECT $1, $2, coalesce(max(sheet_row), 0) + 1, $3, $4 FROM program_students WHERE program = $1
         ON CONFLICT (program, cohort, lower(email)) WHERE email <> '' DO UPDATE SET updated_at = now()
         RETURNING id, sheet_row, (xmax = 0) AS created`, [f.program, f.cohort, name, email]);
    } catch (err) {
      if (!/program_students_program_sheet_row_key/.test(err.message)) throw err; // two at once took the same number
    }
  }
  throw new Error('could not save the enrolment');
}

async function linkContact(student, email) {
  const contact = await db.one(
    `SELECT id, tags FROM contacts WHERE lower(email) = $1 ORDER BY gone_from_ac_at IS NOT NULL, id LIMIT 1`, [email]);
  if (contact) await db.query(`UPDATE program_students SET contact_id = $2, updated_at = now() WHERE id = $1 AND contact_id IS NULL`, [student.id, contact.id]);
  return contact;
}

// Her enrolments in other programs that have no email (the NSMB spreadsheet): link the one with her name, if the
// contact bought that program and exactly one record fits.
async function linkOtherEnrolments(student, name, contact, program) {
  if (!contact) return [];
  const already = await db.query(`SELECT program FROM program_students WHERE contact_id = $1 AND id <> $2`, [contact.id, student.id]);
  const have = new Set(already.map((r) => r.program));
  const rows = await db.query(
    `SELECT id, program, name FROM program_students WHERE program <> $1 AND contact_id IS NULL AND email = ''`, [program]);
  const want = squash(name);
  const fits = (n) => { const s = squash(n.replace(/\(.*?\)/g, '')); return s === want || (want.length >= 2 && s.slice(1) === want); };
  const linked = [];
  const byProgram = {};
  for (const r of rows) if (fits(r.name)) (byProgram[r.program] = byProgram[r.program] || []).push(r);
  for (const [prog, list] of Object.entries(byProgram)) {
    if (have.has(prog) || list.length !== 1) continue;
    if (!(contact.tags || []).some((t) => t.toLowerCase().startsWith(`purchased_${prog}`))) continue;
    await db.query(`UPDATE program_students SET contact_id = $2, updated_at = now() WHERE id = $1 AND contact_id IS NULL`, [list[0].id, contact.id]);
    linked.push(list[0].id);
  }
  return linked;
}

async function saveAnswers(student, c, source) {
  const keys = Object.keys(c.answers);
  const ids = await db.query(`SELECT nextval(pg_get_serial_sequence('student_texts', 'id'))::int AS id FROM generate_series(1, $1)`, [keys.length]);
  const counts = { added: 0, new_version: 0, unchanged: 0 };
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i], text = c.answers[key], newId = ids[i].id;
    const cur = await db.one(
      `SELECT id, text_ko FROM student_texts WHERE student_id = $1 AND kind = 'review' AND question_key = $2 AND superseded_by IS NULL`, [student.id, key]);
    if (cur && cur.text_ko === text) { counts.unchanged++; continue; }
    await db.tx([
      [`UPDATE student_texts SET superseded_by = $3 WHERE student_id = $1 AND kind = 'review' AND question_key = $2 AND superseded_by IS NULL`, [student.id, key, newId]],
      [`INSERT INTO student_texts (id, student_id, kind, question_key, text_ko, source, submitted_at) VALUES ($1, $2, 'review', $3, $4, $5, $6)`,
        [newId, student.id, key, text, source, c.submittedAt || new Date().toISOString()]],
    ]);
    if (cur) counts.new_version++; else counts.added++;
  }
  return counts;
}

// → { student_id, sheet_row, created, texts: { added, new_version, unchanged }, contact_id, linked: [ids] }
async function save(input, { source } = {}) {
  const c = clean(input);
  if (c.problems.length) {
    const err = new Error(`missing or invalid: ${c.problems.join(', ')}`);
    err.status = 400; err.expose = true; err.problems = c.problems;
    throw err;
  }
  const student = await enrolment(c.f, c.name, c.email);
  const contact = await linkContact(student, c.email);
  const linked = await linkOtherEnrolments(student, c.name, contact, c.f.program);
  const texts = await saveAnswers(student, c, source || `review form (${c.formKey})`);
  // She agreed that her review may be introduced with her name hidden; never overrides the admin's own choice.
  if (input.share) await db.query(`UPDATE program_students SET permission = 'yes', updated_at = now() WHERE id = $1 AND permission = 'unknown'`, [student.id]);
  return { student_id: student.id, sheet_row: student.sheet_row, created: student.created, texts, contact_id: contact ? contact.id : null, linked };
}

// CSV text → [{ column: value }] (RFC 4180: quoted fields, "" inside quotes, line breaks inside quotes).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(text).replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const [head, ...data] = rows;
  if (!head) return [];
  return data.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), r[i] == null ? '' : r[i]])));
}

// Rows of the old form's export → save() inputs.
function fromCsv(formKey, records) {
  const f = form(formKey);
  const missing = [f.csv.name, f.csv.email, ...f.questions.map((q) => q.csv)].filter((col) => records.length && !(col in records[0]));
  if (missing.length) {
    const err = new Error(`this file doesn't look like the ${f.title} export: missing columns ${missing.join(', ')}`);
    err.status = 400; err.expose = true; throw err;
  }
  return records.map((r) => ({
    form: formKey, name: r[f.csv.name], email: r[f.csv.email], submitted_at: r[f.csv.submitted_at],
    answers: Object.fromEntries(f.questions.map((q) => [q.key, r[q.csv]])),
  }));
}

module.exports = { save, clean, parseCsv, fromCsv };
