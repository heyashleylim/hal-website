/*
 * Loads an analysis of review answers (written in a Claude session, e.g. _originals/lifeartist-reviews/analysis.json)
 * as an analysis round of each student, with its snippets. Students are found by program + email.
 *
 *   node --env-file-if-exists=.env.local tools/students/analysis.js <analysis.json> --program lifeartist --round <name> [--preview] [--dry-run]
 *
 * One object per student: { email, rating, specificity, outcome, quotability, completeness, depth, advocacy,
 * return_signal, rating_why, snippets: [{ text, source: <question key>, en, use, cats, sensitive }], sensitive_flags,
 * feedback, notes }. A snippet must be an exact passage of that answer (else it is listed and skipped). Running it
 * again replaces the round's analysis; snippets are added once, and their English and categories only fill gaps.
 * Add the round's name to ROUNDS in site/assets/js/admin/student-records.js so the admin names it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('@neondatabase/serverless');

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const file = args.find((a, i) => !a.startsWith('--') && !['--program', '--round'].includes(args[i - 1]));
  const program = opt('--program'), round = opt('--round');
  if (!file || !program || !round) throw new Error('usage: analysis.js <analysis.json> --program lifeartist --round <name> [--preview] [--dry-run]');
  const inside = path.relative(path.join(__dirname, '..', '..'), path.resolve(file));
  if (!inside.startsWith('..') && !inside.startsWith('_originals')) throw new Error('keep the analysis outside the repository (or in _originals/)');
  const { USE_CATS } = require('../../api/_lib/admin/program-students.js');
  const preview = args.includes('--preview'), dry = args.includes('--dry-run');
  const url = preview ? process.env.PODCAST_DATABASE_URL : process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error(preview ? 'PODCAST_DATABASE_URL is not set' : 'DATABASE_URL is not set');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pool = new Pool({ connectionString: url });
  const db = await pool.connect();
  const counts = { analyses: 0, snippets_added: 0, not_exact: [], no_student: [] };
  try {
    await db.query('BEGIN');
    for (const a of list) {
      const st = (await db.query(`SELECT id, name FROM program_students WHERE program = $1 AND lower(email) = lower($2) ORDER BY cohort DESC NULLS LAST LIMIT 1`, [program, a.email])).rows[0];
      if (!st) { counts.no_student.push(a.email); continue; }
      const scores = Object.fromEntries(['specificity', 'outcome', 'quotability', 'completeness', 'depth', 'advocacy', 'return_signal'].filter((k) => a[k] != null).map((k) => [k, a[k]]));
      await db.query(
        `INSERT INTO student_analyses (student_id, round, rating, scores, rating_why, flags, notes, extra)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (student_id, round) DO UPDATE SET rating = EXCLUDED.rating, scores = EXCLUDED.scores, rating_why = EXCLUDED.rating_why,
           flags = EXCLUDED.flags, notes = EXCLUDED.notes, extra = student_analyses.extra || EXCLUDED.extra`,
        [st.id, round, a.rating ?? null, JSON.stringify(scores), a.rating_why || '', JSON.stringify(a.sensitive_flags || []), a.notes || '',
          JSON.stringify(a.feedback ? { feedback: a.feedback } : {})]);
      counts.analyses++;
      for (const sn of a.snippets || []) {
        for (const c of sn.cats || []) if (!(c in USE_CATS)) throw new Error(`${a.email}: unknown "good for" category ${c}`);
        const t = (await db.query(`SELECT id, strpos(text_ko, $3) AS pos FROM student_texts WHERE student_id = $1 AND kind = 'review' AND question_key = $2 AND superseded_by IS NULL`,
          [st.id, sn.source, sn.text])).rows[0];
        if (!t || !t.pos) { counts.not_exact.push(`${st.name} (${sn.source})`); continue; }
        const r = await db.query(
          `INSERT INTO student_snippets (text_id, start, quote, quote_en, use_for, use_cats, origin, sensitive) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (text_id, start, quote) DO UPDATE SET quote_en = CASE WHEN student_snippets.quote_en = '' THEN EXCLUDED.quote_en ELSE student_snippets.quote_en END,
             use_cats = CASE WHEN student_snippets.use_cats = '{}' THEN EXCLUDED.use_cats ELSE student_snippets.use_cats END
           RETURNING (xmax = 0) AS added`,
          [t.id, t.pos, sn.text, sn.en || '', sn.use || '', sn.cats || [], round, Boolean(sn.sensitive)]);
        if (r.rows[0].added) counts.snippets_added++;
      }
    }
    if (dry) { await db.query('ROLLBACK'); console.log('DRY RUN: nothing saved'); } else await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    db.release();
    await pool.end();
  }
  console.log(`${preview ? 'preview' : 'production'} database (${new URL(url).host}): ${counts.analyses} analyses (${round}), ${counts.snippets_added} snippets added.`);
  if (counts.no_student.length) console.log(`No ${program} student with these emails: ${counts.no_student.join(', ')}`);
  if (counts.not_exact.length) console.log(`Not word for word in that answer, so skipped: ${counts.not_exact.join(', ')}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
