/*
 * English for every Korean part of the Students section, written by Claude in a working session (no paid service),
 * then saved into the database, like tools/emails/translations.js does for the emails.
 *
 *   node --env-file-if-exists=.env.local tools/students/translations.js export <folder> [--preview] [--all]
 *       writes what still has no English to <folder>/batch-NN.json (about 14,000 characters each):
 *       students' texts, snippets, names and occupations, analysis "top lines", and Korean cells of the reference sheets.
 *   node --env-file-if-exists=.env.local tools/students/translations.js import <folder> [--preview] [--dry-run]
 *       reads <folder>/batch-NN.out.txt and saves each English text where its Korean is still the one translated.
 *
 * Items are identified by the md5 of their Korean, so one translated folder can be imported into production and into
 * the preview database alike. The folder must be OUTSIDE the repository (or in the git-ignored _originals/).
 *
 * A translated batch (batch-NN.out.txt), one block per item, in the batch's order:
 *   =====ITEM <key>=====
 *   The English
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('@neondatabase/serverless');

const BATCH_CHARS = 14000;
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const HANGUL = /[ㄱ-ㆎ가-힣]/;

const HOW = {
  text: 'A student\'s own words (sales-call notes, questionnaire answers, testimonial or a speech-to-text video transcript). Translate everything, faithfully and completely, keeping line breaks, numbering, emoji and tone (informal stays informal). Keep the names of people as they are, romanised. For garbled transcript passages, translate the likely meaning and mark guesses with [?].',
  snippet: 'A short quote from a student, used for marketing: translate it faithfully and naturally, nothing added.',
  name: 'A Korean personal name: romanise it (Revised Romanisation, family name first, e.g. 김지연 → Kim Ji-yeon). Keep any Latin part as it is.',
  occupation: 'A job title or occupation: translate it in a few words.',
  top_line: 'A short quote from a student, chosen by an analysis: translate it faithfully.',
  cell: 'A cell of an analysis spreadsheet (personas, methodology), often English mixed with Korean: write it entirely in English, translating the Korean parts and keeping the English parts as they are.',
};

function parseBatch(text) {
  const out = [];
  const blocks = text.split(/^=====ITEM ([0-9a-f]{32})=====[ \t]*$/m);
  for (let i = 1; i < blocks.length; i += 2) out.push({ key: blocks[i], en: blocks[i + 1].replace(/^\n+|\s+$/g, '') });
  return out;
}

// Every Korean item still without English: [{ key, kind, ko }]
async function pending(pool, all) {
  const items = [];
  const add = (kind, ko) => { if (ko && HANGUL.test(ko)) items.push({ key: md5(ko), kind, ko }); };
  const texts = await pool.query(`SELECT text_ko FROM student_texts WHERE superseded_by IS NULL ${all ? '' : 'AND translated_of IS DISTINCT FROM md5(text_ko)'} ORDER BY id`);
  texts.rows.forEach((r) => add('text', r.text_ko));
  const snips = await pool.query(`SELECT DISTINCT quote FROM student_snippets ${all ? '' : `WHERE quote_en = ''`}`);
  snips.rows.forEach((r) => add('snippet', r.quote));
  const people = await pool.query(`SELECT name, occupation, name_en, occupation_en FROM program_students`);
  people.rows.forEach((r) => { if (all || !r.name_en) add('name', r.name); if (all || !r.occupation_en) add('occupation', r.occupation); });
  const tops = await pool.query(`SELECT DISTINCT top_line FROM student_analyses WHERE top_line <> '' ${all ? '' : `AND coalesce(extra->>'top_line_en', '') = ''`}`);
  tops.rows.forEach((r) => add('top_line', r.top_line));
  const refs = await pool.query(`SELECT rows FROM student_reference`);
  for (const r of refs.rows) for (const row of r.rows) for (const c of row) if (all || !c.en) add('cell', c.ko);
  const seen = new Set();
  return items.filter((it) => !seen.has(it.key) && seen.add(it.key));
}

async function save(pool, map, dry) {
  const n = { texts: 0, snippets: 0, people: 0, top_lines: 0, cells: 0 };
  const get = (ko) => map.get(md5(ko));
  for (const r of (await pool.query(`SELECT id, text_ko FROM student_texts WHERE superseded_by IS NULL`)).rows) {
    const en = get(r.text_ko);
    if (en == null) continue;
    if (!dry) await pool.query(`UPDATE student_texts SET text_en = $2, translated_of = md5(text_ko), translated_at = now() WHERE id = $1`, [r.id, en]);
    n.texts++;
  }
  for (const r of (await pool.query(`SELECT id, quote FROM student_snippets`)).rows) {
    const en = get(r.quote);
    if (en == null) continue;
    if (!dry) await pool.query(`UPDATE student_snippets SET quote_en = $2 WHERE id = $1`, [r.id, en]);
    n.snippets++;
  }
  for (const r of (await pool.query(`SELECT id, name, occupation FROM program_students`)).rows) {
    const name = get(r.name), job = r.occupation ? get(r.occupation) : null;
    if (name == null && job == null) continue;
    if (!dry) await pool.query(`UPDATE program_students SET name_en = coalesce($2, name_en), occupation_en = coalesce($3, occupation_en) WHERE id = $1`, [r.id, name, job]);
    n.people++;
  }
  for (const r of (await pool.query(`SELECT id, top_line FROM student_analyses WHERE top_line <> ''`)).rows) {
    const en = get(r.top_line);
    if (en == null) continue;
    if (!dry) await pool.query(`UPDATE student_analyses SET extra = extra || jsonb_build_object('top_line_en', $2::text) WHERE id = $1`, [r.id, en]);
    n.top_lines++;
  }
  for (const r of (await pool.query(`SELECT id, rows FROM student_reference`)).rows) {
    let changed = 0;
    const rows = r.rows.map((row) => row.map((c) => {
      const en = c.ko && HANGUL.test(c.ko) ? get(c.ko) : null;
      if (en == null || en === c.en) return c;
      changed++;
      return { ko: c.ko, en };
    }));
    if (changed && !dry) await pool.query(`UPDATE student_reference SET rows = $2, updated_at = now() WHERE id = $1`, [r.id, JSON.stringify(rows)]);
    n.cells += changed;
  }
  return n;
}

async function main() {
  const [command, folder] = process.argv.slice(2);
  const flag = (name) => process.argv.includes(name);
  if (!['export', 'import'].includes(command) || !folder) throw new Error('usage: translations.js export|import <folder> [--preview] [--all] [--dry-run]');
  const dir = path.resolve(folder);
  const rel = path.relative(path.join(__dirname, '..', '..'), dir);
  if (!rel.startsWith('..') && !rel.startsWith('_originals')) throw new Error('choose a folder outside the repository (or in _originals/): students\' words are never committed');
  const url = flag('--preview') ? process.env.PODCAST_DATABASE_URL : process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error(flag('--preview') ? 'PODCAST_DATABASE_URL is not set' : 'DATABASE_URL is not set');
  const where = `${flag('--preview') ? 'preview' : 'production'} database (${new URL(url).host})`;
  const pool = new Pool({ connectionString: url });
  try {
    if (command === 'export') {
      const items = await pending(pool, flag('--all'));
      fs.mkdirSync(dir, { recursive: true });
      const batches = [[]];
      let size = 0;
      for (const it of items) {
        if (size && size + it.ko.length > BATCH_CHARS) { batches.push([]); size = 0; }
        batches.at(-1).push({ key: it.key, kind: it.kind, how: HOW[it.kind], ko: it.ko });
        size += it.ko.length;
      }
      const lines = batches.filter((b) => b.length).map((b, i) => {
        const file = path.join(dir, `batch-${String(i + 1).padStart(2, '0')}.json`);
        fs.writeFileSync(file, JSON.stringify(b, null, 1));
        return `${path.basename(file)}: ${b.length} items, ${b.reduce((n, x) => n + x.ko.length, 0)} characters`;
      });
      console.log(`${items.length} Korean items to translate, from the ${where}\n${lines.join('\n')}`);
    } else {
      const map = new Map();
      for (const f of fs.readdirSync(dir).filter((n) => /^batch-\d+\.out\.txt$/.test(n)).sort()) {
        for (const t of parseBatch(fs.readFileSync(path.join(dir, f), 'utf8'))) if (t.en) map.set(t.key, t.en);
      }
      const n = await save(pool, map, flag('--dry-run'));
      const left = await pending(pool, false);
      console.log(`${where}: ${map.size} translations read; ${flag('--dry-run') ? 'would save' : 'saved'} ${n.texts} texts, ${n.snippets} snippets, ${n.people} names/occupations, ${n.top_lines} top lines, ${n.cells} sheet cells. ${flag('--dry-run') ? '' : `${left.length} items still without English.`}`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
module.exports = { parseBatch, md5, HANGUL };
