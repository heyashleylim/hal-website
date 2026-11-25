/*
 * Imports a review form's CSV export into the Students section, like the admin's "Import reviews" page (same code:
 * api/_lib/students/reviews.js).
 *
 *   node --env-file-if-exists=.env.local tools/students/reviews.js <export.csv> --form lifeartist-2026 [--preview]
 *
 * Production (DATABASE_URL) by default; --preview = the previews' database (PODCAST_DATABASE_URL). Safe to run again.
 * The export holds students' names and emails: keep it outside the repository (or in the git-ignored _originals/).
 */
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--form');
  const formKey = args[args.indexOf('--form') + 1];
  if (!file || !args.includes('--form') || !formKey) throw new Error('usage: reviews.js <export.csv> --form lifeartist-2026 [--preview]');
  const inside = path.relative(path.join(__dirname, '..', '..'), path.resolve(file));
  if (!inside.startsWith('..') && !inside.startsWith('_originals')) throw new Error('keep the export outside the repository (or in _originals/)');
  const preview = args.includes('--preview');
  // db.js reads PODCAST_DATABASE_URL first: point it at the database asked for.
  const url = preview ? process.env.PODCAST_DATABASE_URL : process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error(preview ? 'PODCAST_DATABASE_URL is not set' : 'DATABASE_URL is not set');
  process.env.PODCAST_DATABASE_URL = url;
  console.log(`${preview ? 'Preview' : 'Production'} database (${new URL(url).host})`);

  const reviews = require('../../api/_lib/students/reviews.js');
  const rows = reviews.fromCsv(formKey, reviews.parseCsv(fs.readFileSync(file, 'utf8')));
  for (const r of rows) {
    try {
      const out = await reviews.save(r, { source: `CSV export (${path.basename(file)})` });
      console.log(`${r.name}: #${out.sheet_row}${out.created ? ' (new)' : ''} · ${out.texts.added} added, ${out.texts.new_version} changed, ${out.texts.unchanged} unchanged` +
        ` · ${out.contact_id ? 'contact ' + out.contact_id : 'no contact'}${out.linked.length ? ' · linked to enrolment ' + out.linked.join(', ') : ''}`);
    } catch (err) {
      console.log(`${r.name}: NOT SAVED (${err.message})`);
    }
  }
}

main().catch((err) => { console.error(err.message); process.exit(1); });
