/*
 * Imports a program's student spreadsheet (and, optionally, another analysis round) into the Students section.
 *
 *   node --env-file-if-exists=.env.local tools/students/import.js <file.xlsx> [--program nsmb] [--second-read <file.json>]
 *        [--round-name reread-2026-11] [--same 49:21] [--preview] [--dry-run]
 *
 *   --preview      the previews' database (PODCAST_DATABASE_URL) instead of production (DATABASE_URL)
 *   --same 49:21   sheet row 49 is the same person as sheet row 21 (repeat enrolment); repeatable
 *   --second-read  a round written by an analysis session (format: _originals/students-third-read/PROMPT.md), saved
 *                  under --round-name. Rounds already in the database stay as they are; rerunning a round replaces it.
 *                  Its snippets' English (`en`) and "good for" categories (`cats`) fill in what a snippet doesn't have
 *                  yet; its `persona_fit` is kept with the analysis.
 *
 * Neither file may be inside the repository's tracked files (the repo is public): keep them outside it or in the
 * git-ignored _originals/ folder.
 *
 * The sheet "Students" gives, per row: #, Cohort, Student, Occupation, Age, the student's texts (Sales call form,
 * Sales call, Onboarding questionnaire, Testimonial, Video testimonial) and the first analysis round ("v2-2026-07":
 * Persona … rationale). The other sheets (personas, methodology…) are stored as reference, cell by cell.
 *
 * Importing again is safe: students are matched by program + "#"; a text that is unchanged is left alone, a changed
 * text is added as a new version (the old one is kept); analyses of a round are replaced by the file's; snippets are
 * added once; the admin's decisions (persona, rating, permission, notes, contact) are never overwritten. A persona or
 * rating the import itself filled in (decided_note "every analysis round agrees", never saved in the admin) is cleared
 * again when a new round disagrees, so the student goes back to "waiting for your decision".
 * Texts and snippets are stored exactly as in the file (the database refuses anything else).
 */
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('@neondatabase/serverless');
const xlsx = require('../../site/assets/js/admin/xlsx.js');
const { USE_CATS } = require('../../api/_lib/admin/program-students.js');

const ROUND1 = 'v2-2026-07';
const TEXT_COLUMNS = {
  'sales call form': 'sales_call_form',
  'sales call (before buying program)': 'sales_call',
  'onboarding questionnaire (before program starts)': 'onboarding',
  testimonial: 'testimonial',
  'video testimonial': 'video_testimonial',
};
const SECOND_SOURCE = { SALES_CALL_FORM: 'sales_call_form', SALES_CALL: 'sales_call', ONBOARDING: 'onboarding', TESTIMONIAL: 'testimonial', VIDEO_TESTIMONIAL: 'video_testimonial' };
const SHEET_TITLES = { Personas: 'Personas (6)', Merged_Personas: 'Merged personas (3)', Distribution: 'Distribution', Testimonial_Ratings: 'Testimonial ratings', Methodology: 'Methodology', '04_IG_Buyer_Concentration': 'Instagram buyer concentration' };

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const str = (v) => (v == null ? '' : String(v));
const slug = (s) => s.toLowerCase().replace(/^\d+_/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

// Column letter → number (A = 1).
const colNum = (c) => [...c].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// The Students sheet → [{ row, cohort, name, occupation, age, texts: { kind: text }, round1: {…} }]
function students(rows) {
  const head = {};
  for (const [col, v] of Object.entries(rows[0].cells)) head[str(v).trim().toLowerCase()] = col;
  const need = ['#', 'cohort', 'student'];
  const missing = need.filter((h) => !head[h]);
  if (missing.length) throw new Error(`the Students sheet has no column ${missing.join(', ')}`);
  return rows.slice(1).filter((r) => r.cells[head['#']] != null).map((r) => {
    const get = (h) => (head[h] ? r.cells[head[h]] : undefined);
    const texts = {};
    for (const [h, kind] of Object.entries(TEXT_COLUMNS)) {
      const v = get(h);
      if (v != null && str(v).trim() !== '') texts[kind] = str(v); // exactly as in the cell
    }
    return {
      row: num(get('#')),
      cohort: num(get('cohort')),
      name: str(get('student')).trim(),
      occupation: str(get('occupation')).trim(),
      age: str(get('age')).trim(),
      texts,
      round1: {
        persona: str(get('persona')).trim() || null,
        persona_alt: str(get('alternate_persona')).trim() || null,
        confidence: str(get('classification_confidence')).trim() || null,
        why: str(get('classification_rationale')),
        rating: num(get('rating')),
        scores: Object.fromEntries(['specificity', 'outcome', 'quotability', 'persona_fit', 'completeness', 'testimonial_depth_0_3', 'advocacy_0_2', 'return_signal']
          .filter((k) => get(k) != null).map((k) => [k.replace(/_0_\d$/, '').replace('testimonial_', ''), k === 'return_signal' ? str(get(k)) === 'Y' : num(get(k))])),
        top_line: str(get('top_quotable_line')),
        suggested_use: str(get('suggested_use')),
        rating_why: str(get('rationale')),
      },
    };
  });
}

// A reference sheet → rows of cells [{ ko, en }] (en filled later by the translation step).
function sheetRows(rows) {
  const width = Math.max(0, ...rows.map((r) => Math.max(0, ...Object.keys(r.cells).map(colNum))));
  return rows.map((r) => Array.from({ length: width }, (_, i) => {
    const v = r.cells[colName(i + 1)];
    return { ko: v == null ? '' : typeof v === 'number' && !Number.isInteger(v) ? String(Math.round(v * 1000) / 1000) : str(v), en: '' };
  }));
}

function outsideRepo(file) {
  const root = path.join(__dirname, '..', '..');
  const rel = path.relative(root, path.resolve(file));
  return rel.startsWith('..') || rel.startsWith('_originals' + path.sep);
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const flag = (name) => args.includes(name);
  const WITH_VALUE = ['--program', '--second-read', '--round-name', '--same'];
  const file = args.find((a, i) => !a.startsWith('--') && !WITH_VALUE.includes(args[i - 1]));
  if (!file) throw new Error('usage: import.js <file.xlsx> [--program nsmb] [--second-read <file.json>] [--same 49:21] [--preview] [--dry-run]');
  const second = opt('--second-read');
  for (const f of [file, second].filter(Boolean)) if (!outsideRepo(f)) throw new Error(`${f}: keep student files outside the repository (or in _originals/), it is public`);
  const program = (opt('--program') || 'nsmb').toLowerCase();
  const round2 = opt('--round-name') || 'reread-2026-11';
  const same = args.map((a, i) => (a === '--same' ? args[i + 1] : null)).filter(Boolean).map((p) => p.split(':').map(Number));

  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length);
  const names = await xlsx.sheets(ab);
  if (!names.includes('Students')) throw new Error('the file has no sheet called "Students"');
  const list = students(await xlsx.read(ab, 'Students'));
  const reference = [];
  for (const [i, n] of names.entries()) if (n !== 'Students') reference.push({ key: slug(n), title: SHEET_TITLES[n] || n.replace(/_/g, ' '), position: i, rows: sheetRows(await xlsx.read(ab, n)) });
  const secondRead = second ? JSON.parse(fs.readFileSync(second, 'utf8')) : [];
  const source = `${path.basename(file)} (${new Date(fs.statSync(file).mtime).toISOString().slice(0, 10)})`;

  const url = flag('--preview') ? process.env.PODCAST_DATABASE_URL : process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error(flag('--preview') ? 'PODCAST_DATABASE_URL is not set' : 'DATABASE_URL is not set');
  const where = `${flag('--preview') ? 'preview' : 'production'} database (${new URL(url).host})`;
  const pool = new Pool({ connectionString: url });
  const db = await pool.connect();
  const counts = { students_added: 0, texts_added: 0, texts_new_version: 0, analyses: 0, snippets_added: 0, snippets_not_exact: [], decided: 0, reference: reference.length };
  try {
    await db.query('BEGIN');
    const ids = new Map(); // sheet row → student id
    for (const s of list) {
      const r = await db.query(
        `INSERT INTO program_students (program, cohort, sheet_row, name, occupation, age) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (program, sheet_row) DO UPDATE SET cohort = EXCLUDED.cohort, name = EXCLUDED.name, occupation = EXCLUDED.occupation, age = EXCLUDED.age,
           updated_at = CASE WHEN (program_students.cohort, program_students.name, program_students.occupation, program_students.age)
                                  IS DISTINCT FROM (EXCLUDED.cohort, EXCLUDED.name, EXCLUDED.occupation, EXCLUDED.age) THEN now() ELSE program_students.updated_at END
         RETURNING id, (xmax = 0) AS inserted`,
        [program, s.cohort, s.row, s.name, s.occupation, s.age]);
      ids.set(s.row, r.rows[0].id);
      if (r.rows[0].inserted) counts.students_added++;
    }
    for (const [a, b] of same) {
      if (!ids.has(a) || !ids.has(b)) throw new Error(`--same ${a}:${b}: no such row`);
      await db.query(`UPDATE program_students SET same_as = $2 WHERE id = $1 AND same_as IS NULL`, [ids.get(a), ids.get(b)]);
    }

    // texts: the current version of each kind, or a new version when the file's text differs
    const textId = new Map(); // `${row}:${kind}` → id
    for (const s of list) {
      const sid = ids.get(s.row);
      for (const [kind, t] of Object.entries(s.texts)) {
        const cur = (await db.query(`SELECT id, text_ko FROM student_texts WHERE student_id = $1 AND kind = $2 AND superseded_by IS NULL`, [sid, kind])).rows[0];
        if (cur && cur.text_ko === t) { textId.set(`${s.row}:${kind}`, cur.id); continue; }
        // the new version's id first, so the old one is marked replaced before the new one takes its place
        const newId = (await db.query(`SELECT nextval(pg_get_serial_sequence('student_texts', 'id'))::int AS id`)).rows[0].id;
        if (cur) await db.query(`UPDATE student_texts SET superseded_by = $2 WHERE id = $1`, [cur.id, newId]);
        await db.query(`INSERT INTO student_texts (id, student_id, kind, text_ko, source) VALUES ($1, $2, $3, $4, $5)`, [newId, sid, kind, t, source]);
        if (cur) counts.texts_new_version++; else counts.texts_added++;
        textId.set(`${s.row}:${kind}`, newId);
      }
    }

    // Adds a snippet at the first place its exact words appear in that text; false when they don't.
    async function snippet(row, kind, quote, fields) {
      const tid = textId.get(`${row}:${kind}`);
      if (!tid || !quote) return false;
      const pos = (await db.query(`SELECT strpos(text_ko, $2) AS p FROM student_texts WHERE id = $1`, [tid, quote])).rows[0].p;
      if (!pos) return false;
      const r = await db.query(
        `INSERT INTO student_snippets (text_id, start, quote, use_for, origin, sensitive, quote_en, use_cats) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (text_id, start, quote) DO NOTHING RETURNING id`,
        [tid, pos, quote, fields.use_for || '', fields.origin, Boolean(fields.sensitive), fields.en || '', fields.cats || []]);
      if (r.rows.length) counts.snippets_added++;
      // a snippet already there: only fill what it doesn't have yet (its English, its categories)
      else if (fields.en || (fields.cats || []).length) {
        await db.query(
          `UPDATE student_snippets SET quote_en = CASE WHEN quote_en = '' THEN $4 ELSE quote_en END,
                  use_cats = CASE WHEN use_cats = '{}' THEN $5::text[] ELSE use_cats END
            WHERE text_id = $1 AND start = $2 AND quote = $3`, [tid, pos, quote, fields.en || '', fields.cats || []]);
      }
      return true;
    }

    async function analysis(sid, round, a) {
      await db.query(
        `INSERT INTO student_analyses (student_id, round, persona, persona_alt, confidence, why, trigger_text, outcomes, generational, rating, scores,
                                       rating_why, top_line, top_line_exact, suggested_use, flags, notes, extra)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (student_id, round) DO UPDATE SET persona = EXCLUDED.persona, persona_alt = EXCLUDED.persona_alt, confidence = EXCLUDED.confidence,
           why = EXCLUDED.why, trigger_text = EXCLUDED.trigger_text, outcomes = EXCLUDED.outcomes, generational = EXCLUDED.generational,
           rating = EXCLUDED.rating, scores = EXCLUDED.scores, rating_why = EXCLUDED.rating_why, top_line = EXCLUDED.top_line,
           top_line_exact = EXCLUDED.top_line_exact, suggested_use = EXCLUDED.suggested_use, flags = EXCLUDED.flags, notes = EXCLUDED.notes,
           extra = student_analyses.extra || EXCLUDED.extra`, // || keeps keys saved later (top_line_en, the English)
        [sid, round, a.persona, a.persona_alt, a.confidence, a.why || '', a.trigger || '', JSON.stringify(a.outcomes || []), a.generational ?? null,
          a.rating, JSON.stringify(a.scores || {}), a.rating_why || '', a.top_line || '', a.top_line_exact ?? null, a.suggested_use || '',
          JSON.stringify(a.flags || []), a.notes || '', JSON.stringify(a.extra || {})]);
      counts.analyses++;
    }

    // round 1: the spreadsheet's own analysis; its top line becomes a snippet only when it is word for word
    for (const s of list) {
      const a = s.round1;
      if (!a.persona && !a.top_line) continue;
      let exact = false;
      if (a.top_line) {
        for (const kind of ['testimonial', 'video_testimonial', 'onboarding', 'sales_call', 'sales_call_form']) {
          if (await snippet(s.row, kind, a.top_line, { origin: ROUND1, use_for: a.suggested_use })) { exact = true; break; }
        }
        if (!exact) counts.snippets_not_exact.push(s.row);
      }
      await analysis(ids.get(s.row), ROUND1, { ...a, top_line_exact: a.top_line ? exact : null });
    }

    // round 2: the independent second read (JSON written by the analysis session)
    for (const r of secondRead) {
      const row = Number(r.id);
      if (!ids.has(row)) throw new Error(`second read: no student #${row} in the sheet`);
      const scores = Object.fromEntries(['specificity', 'outcome', 'quotability', 'completeness', 'depth', 'advocacy', 'return_signal'].filter((k) => r[k] != null).map((k) => [k, r[k]]));
      for (const sn of r.snippets || []) {
        const kind = SECOND_SOURCE[sn.source];
        if (sn.cats) for (const c of sn.cats) if (!(c in USE_CATS)) throw new Error(`${round2} #${row}: unknown "good for" category ${c}`);
        if (!(await snippet(row, kind, sn.text, { origin: round2, use_for: sn.use, sensitive: sn.sensitive, en: sn.en, cats: sn.cats }))) counts.snippets_not_exact.push(`${row} (${round2})`);
      }
      await analysis(ids.get(row), round2, {
        persona: r.persona || null, persona_alt: r.alternate || null, confidence: r.confidence || null, why: r.why, trigger: r.trigger,
        outcomes: r.named_outcomes, generational: r.generational_motive ?? null, rating: r.rating ?? null, scores, rating_why: r.rating_why,
        flags: r.sensitive_flags, notes: r.notes, extra: r.persona_fit ? { persona_fit: r.persona_fit } : {},
      });
    }

    // A persona or rating the import filled in earlier, that a round now disagrees with, goes back to undecided,
    // unless the admin has saved this student since (then it is the admin's decision and stays).
    const AUTO = 'every analysis round agrees';
    const undone = (await db.query(
      `WITH a AS (SELECT student_id, count(*) AS n, count(DISTINCT persona) AS personas, count(DISTINCT rating) AS ratings, count(rating) AS rated
                    FROM student_analyses GROUP BY student_id),
            u AS (SELECT p.id, p.sheet_row,
                         (p.persona IS NOT NULL AND a.personas > 1) AS persona_off,
                         (p.rating IS NOT NULL AND NOT (a.ratings = 1 AND a.rated = a.n)) AS rating_off
                    FROM program_students p JOIN a ON a.student_id = p.id
                   WHERE p.program = $1 AND p.decided_note = $2
                     AND NOT EXISTS (SELECT 1 FROM admin_log l WHERE l.action = 'program-student-save' AND l.target = p.name || ' (cohort ' || p.cohort || ')'))
       UPDATE program_students p SET
         persona = CASE WHEN u.persona_off THEN NULL ELSE p.persona END,
         rating = CASE WHEN u.rating_off THEN NULL ELSE p.rating END,
         decided_note = CASE WHEN (u.persona_off OR p.persona IS NULL) AND (u.rating_off OR p.rating IS NULL) THEN '' ELSE p.decided_note END,
         updated_at = now()
        FROM u WHERE u.id = p.id AND (u.persona_off OR u.rating_off)
       RETURNING p.sheet_row, u.persona_off, u.rating_off`, [program, AUTO])).rows;
    counts.undone = undone.map((r) => `#${r.sheet_row} ${[r.persona_off && 'persona', r.rating_off && 'rating'].filter(Boolean).join(' + ')}`);

    // where every round agrees, that is the decision until the admin changes it
    await db.query(
      `WITH a AS (SELECT student_id, count(*) AS n, count(DISTINCT persona) AS personas, min(persona) AS persona,
                         count(DISTINCT rating) AS ratings, count(rating) AS rated, min(rating) AS rating
                    FROM student_analyses GROUP BY student_id)
       UPDATE program_students p SET
         persona = CASE WHEN p.persona IS NULL AND a.personas = 1 THEN a.persona ELSE p.persona END,
         rating = CASE WHEN p.rating IS NULL AND a.ratings = 1 AND a.rated = a.n THEN a.rating ELSE p.rating END,
         decided_note = CASE WHEN p.decided_note = '' AND (a.personas = 1 OR (a.ratings = 1 AND a.rated = a.n)) THEN $2 ELSE p.decided_note END
        FROM a WHERE a.student_id = p.id AND p.program = $1 AND a.n > 1 AND (p.persona IS NULL OR p.rating IS NULL)`, [program, AUTO]);
    const decided = (await db.query(`SELECT count(*) FILTER (WHERE persona IS NOT NULL)::int AS persona, count(*) FILTER (WHERE rating IS NOT NULL)::int AS rating FROM program_students WHERE program = $1`, [program])).rows[0];
    counts.decided = `${decided.persona} personas and ${decided.rating} ratings`;

    for (const ref of reference) {
      // keep English already written for a cell whose text is unchanged
      const old = (await db.query(`SELECT rows FROM student_reference WHERE program = $1 AND key = $2`, [program, ref.key])).rows[0];
      const known = new Map();
      if (old) for (const r of old.rows) for (const c of r) if (c.en) known.set(c.ko, c.en);
      const rows = ref.rows.map((r) => r.map((c) => ({ ko: c.ko, en: known.get(c.ko) || '' })));
      await db.query(
        `INSERT INTO student_reference (program, key, title, position, rows, source) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (program, key) DO UPDATE SET title = EXCLUDED.title, position = EXCLUDED.position, rows = EXCLUDED.rows, source = EXCLUDED.source, updated_at = now()`,
        [program, ref.key, ref.title, ref.position, JSON.stringify(rows), source]);
    }

    if (flag('--dry-run')) { await db.query('ROLLBACK'); console.log(`DRY RUN on the ${where}: nothing saved`); } else await db.query('COMMIT');
    console.log(`${where}: ${list.length} students (${counts.students_added} new), ${counts.texts_added} texts added, ${counts.texts_new_version} new text versions, ` +
      `${counts.analyses} analyses, ${counts.snippets_added} snippets added, ${counts.decided} decided (where every round agrees), ${counts.reference} reference sheets.`);
    if (counts.undone.length) console.log(`Filled in by an earlier import, now disputed by a round, so back to "waiting for your decision": ${counts.undone.join(', ')}`);
    if (counts.snippets_not_exact.length) console.log(`Not word for word in the texts, so not saved as snippets (kept in the analysis as written): rows ${counts.snippets_not_exact.join(', ')}`);
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
    await pool.end();
  }
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
module.exports = { students, sheetRows };
