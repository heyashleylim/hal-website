/*
 * Fills the "Good for" categories of the snippets (student_snippets.use_cats, migration 015) from their free-text
 * "Good for" note (use_for), using a mapping written once in a Claude session (note → categories). Only snippets that
 * have no category yet are filled, so what was chosen in the admin is never overwritten. Safe to run again.
 *
 *   node --env-file-if-exists=.env.local tools/students/categories.js <mapping.json> [--preview] [--dry-run]
 *
 * The mapping ({ "<use_for note>": ["before", "hook"], … }) describes students, so it lives outside the repository
 * (_originals/students-reanalysis-2026-11-18/use-categories.json). Category keys: USE_CATS in
 * api/_lib/admin/program-students.js. Notes missing from the mapping are listed and left without a category.
 */
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('@neondatabase/serverless');

function load(file) {
  const { USE_CATS } = require('../../api/_lib/admin/program-students.js');
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [note, cats] of Object.entries(map)) {
    if (!Array.isArray(cats) || !cats.length) throw new Error(`no category for “${note}”`);
    for (const c of cats) if (!(c in USE_CATS)) throw new Error(`unknown category “${c}” for “${note}”`);
  }
  return map;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) throw new Error('usage: categories.js <mapping.json> [--preview] [--dry-run]');
  const inside = path.relative(path.join(__dirname, '..', '..'), path.resolve(file));
  if (!inside.startsWith('..') && !inside.startsWith('_originals')) throw new Error('keep the mapping outside the repository (or in _originals/)');
  const map = load(file);
  const preview = args.includes('--preview'), dry = args.includes('--dry-run');
  const url = preview ? process.env.PODCAST_DATABASE_URL : process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error(preview ? 'PODCAST_DATABASE_URL is not set' : 'DATABASE_URL is not set');
  console.log(`${preview ? 'Preview' : 'Production'} database${dry ? ' (dry run: nothing saved)' : ''}`);
  const pool = new Pool({ connectionString: url });
  try {
    const { rows } = await pool.query(`SELECT id, use_for FROM student_snippets WHERE use_cats = '{}' ORDER BY id`);
    let filled = 0;
    const missing = new Set();
    for (const r of rows) {
      const cats = map[r.use_for];
      if (!cats) { if (r.use_for) missing.add(r.use_for); continue; }
      if (!dry) await pool.query(`UPDATE student_snippets SET use_cats = $2, updated_at = now() WHERE id = $1 AND use_cats = '{}'`, [r.id, cats]);
      filled++;
    }
    console.log(`${rows.length} snippets without a category; ${filled} filled${dry ? ' (would be)' : ''}.`);
    if (missing.size) console.log(`Notes not in the mapping (left without a category):\n  ${[...missing].join('\n  ')}`);
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
module.exports = { load };
