/*
 * Applies the SQL files in db/migrations/ that haven't run yet, in name order, each in a transaction.
 *
 *   npm run db:migrate          (reads DATABASE_URL from .env.local or the environment)
 *
 * Get the connection string from Vercel → Storage → the Neon database → .env.local tab,
 * or with `vercel env pull .env.local`. Run it once against each database (preview and production).
 */
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('@neondatabase/serverless');

const dir = path.join(__dirname, '..', '..', 'db', 'migrations');

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('DATABASE_URL is not set (add it to .env.local)');
  const pool = new Pool({ connectionString: url });
  const db = await pool.connect();
  try {
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await db.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const host = new URL(url).host;
    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      process.stdout.write(`${host}: applying ${file}… `);
      await db.query('BEGIN');
      try {
        await db.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        await db.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await db.query('COMMIT');
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
      console.log('done');
      applied++;
    }
    console.log(applied ? `${applied} migration(s) applied.` : `${host}: up to date.`);
  } finally {
    db.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
