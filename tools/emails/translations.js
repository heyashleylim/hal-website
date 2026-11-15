/*
 * English translations written outside the site (by Claude in a working session) and saved into the database,
 * instead of the paid translation service used by api/_lib/emails/translate.js. Both fill the same columns
 * (emails.subject_en / body_en / translated_of), so the admin shows them the same way.
 *
 *   node --env-file-if-exists=.env.local tools/emails/translations.js export <folder> [--preview] [--all]
 *       writes the emails still waiting for a translation to <folder>/batch-NN.json (about 22,000 characters each).
 *       --all: every email, also the ones already translated.
 *   node --env-file-if-exists=.env.local tools/emails/translations.js import <folder> [--preview] [--dry-run]
 *       reads <folder>/batch-NN.out.txt and saves each translation, only if the Korean text is still the one that
 *       was translated. Run it once for production and once with --preview: emails are matched by where they came
 *       from (spreadsheet row or ActiveCampaign campaign), not by database id.
 *
 * The folder must be OUTSIDE the repository: the emails are never committed (the repo is public).
 *
 * A translated batch (batch-NN.out.txt) looks like this, one block per email:
 *   =====EMAIL <key>=====
 *   <subject>The subject in English</subject>
 *   <body>
 *   The email in English
 *   </body>
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('@neondatabase/serverless');

const BATCH_CHARS = 22000;
const fingerprint = (subject, body) => crypto.createHash('md5').update(`${subject}\n${body}`).digest('hex');
// what identifies an email in every database: its source, where it came from, and the exact text translated
const keyOf = (e) => `${e.source}:${e.source_ref}:${fingerprint(e.subject, e.body_text)}`;

// batch-NN.out.txt → [{ key, subject, body }]; throws with the block's key when one is not readable.
function parseBatch(text) {
  const out = [];
  const blocks = text.split(/^=====EMAIL (\S+)=====[ \t]*$/m);
  for (let i = 1; i < blocks.length; i += 2) {
    const key = blocks[i], block = blocks[i + 1];
    const subject = /<subject>([\s\S]*?)<\/subject>/.exec(block);
    const body = /<body>([\s\S]*?)<\/body>/.exec(block);
    if (!subject || !body) throw new Error(`email ${key}: no <subject> or <body>`);
    out.push({ key, subject: subject[1].trim(), body: body[1].replace(/^\n+|\s+$/g, '') });
  }
  return out;
}

async function main() {
  const [command, folder] = process.argv.slice(2);
  const flag = (name) => process.argv.includes(name);
  if (!['export', 'import'].includes(command) || !folder) throw new Error('usage: translations.js export|import <folder> [--preview] [--all] [--dry-run]');
  const dir = path.resolve(folder);
  if (!path.relative(path.join(__dirname, '..', '..'), dir).startsWith('..')) throw new Error('choose a folder outside the repository: the emails are never committed');
  const url = flag('--preview') ? process.env.PODCAST_DATABASE_URL : process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error(flag('--preview') ? 'PODCAST_DATABASE_URL is not set' : 'DATABASE_URL is not set');
  const where = `${flag('--preview') ? 'preview' : 'production'} database (${new URL(url).host})`;
  const pool = new Pool({ connectionString: url });
  try {
    if (command === 'export') {
      const { rows } = await pool.query(
        `SELECT source, source_ref, name, subject, body_text FROM emails
          WHERE (subject <> '' OR body_text <> '') ${flag('--all') ? '' : `AND translated_of IS DISTINCT FROM md5(subject || E'\\n' || body_text)`}
          ORDER BY sent_at, id`);
      fs.mkdirSync(dir, { recursive: true });
      const batches = [[]];
      let size = 0;
      for (const e of rows) {
        const chars = e.subject.length + e.body_text.length;
        if (size && size + chars > BATCH_CHARS) { batches.push([]); size = 0; }
        batches.at(-1).push({ key: keyOf(e), name: e.name, subject: e.subject, body: e.body_text });
        size += chars;
      }
      const files = batches.filter((b) => b.length).map((b, i) => {
        const file = path.join(dir, `batch-${String(i + 1).padStart(2, '0')}.json`);
        fs.writeFileSync(file, JSON.stringify(b, null, 1));
        return `${path.basename(file)}: ${b.length} emails, ${b.reduce((n, e) => n + e.subject.length + e.body.length, 0)} characters`;
      });
      console.log(`${rows.length} emails to translate, from the ${where}\n${files.join('\n')}`);
    } else {
      const translations = new Map();
      for (const f of fs.readdirSync(dir).filter((n) => /^batch-\d+\.out\.txt$/.test(n)).sort()) {
        for (const t of parseBatch(fs.readFileSync(path.join(dir, f), 'utf8'))) translations.set(t.key, t);
      }
      const { rows } = await pool.query(`SELECT id, source, source_ref, name, subject, body_text, translated_of FROM emails WHERE subject <> '' OR body_text <> ''`);
      let saved = 0, already = 0;
      const missing = [];
      for (const e of rows) {
        const print = fingerprint(e.subject, e.body_text);
        const t = translations.get(keyOf(e));
        if (!t) { if (e.translated_of !== print) missing.push(e.name); continue; }
        if (e.translated_of === print && !flag('--force')) { already++; continue; }
        if (!flag('--dry-run')) {
          await pool.query(
            `UPDATE emails SET subject_en = $2, body_en = $3, translated_of = $4, translated_at = now(), translate_tries = 0, translate_error = NULL WHERE id = $1`,
            [e.id, t.subject, t.body, print]);
        }
        saved++;
      }
      console.log(`${where}: ${translations.size} translations read, ${saved} ${flag('--dry-run') ? 'would be saved' : 'saved'}, ${already} already there, ${missing.length} emails still without one`);
      if (missing.length) console.log('still waiting: ' + missing.slice(0, 20).join(' | ') + (missing.length > 20 ? ' …' : ''));
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
module.exports = { parseBatch, fingerprint };
