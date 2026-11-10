/*
 * Local admin for development: serves site/ and runs the real admin API (api/admin.js) on this computer.
 * The normal local preview ("site") serves static files only, so admin pages can't load data there.
 *
 *   node --env-file-if-exists=.env.local tools/shop/dev-server.js      → http://localhost:8793/admin/shop
 *   (or the "shop-admin" preview in .claude/launch.json)
 *
 * NOTHING IS SAVED. Every query runs inside one database transaction that is rolled back when the server
 * stops: migrations that haven't been applied yet are applied inside it (so new tables can be tried before
 * they exist for real), and whatever you create or change in the pages disappears on exit. It uses the
 * previews' database (PODCAST_DATABASE_URL) when set, otherwise DATABASE_URL.
 * No login: this server signs you in as "dev". It listens on localhost only. It never calls ActiveCampaign.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('@neondatabase/serverless');

const root = path.join(__dirname, '..', '..');
const PORT = Number(process.env.PORT || 8793);
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };

async function main() {
  const url = process.env.PODCAST_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('No database address: add DATABASE_URL (or PODCAST_DATABASE_URL) to .env.local');

  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  await client.query('BEGIN');

  // Migrations not applied yet, inside the transaction only.
  const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const dir = path.join(root, 'db', 'migrations');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    console.log(`applied ${file} (inside the transaction: rolled back on exit)`);
  }

  // The API's database module, pointed at this transaction. A failed query must not poison the rest of the
  // session, so each one runs behind a savepoint.
  let chain = Promise.resolve();
  const run = (text, params = []) => {
    const next = chain.then(async () => {
      await client.query('SAVEPOINT q');
      try {
        const res = await client.query(text, params);
        await client.query('RELEASE SAVEPOINT q');
        return res.rows;
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT q');
        throw err;
      }
    });
    chain = next.catch(() => {});
    return next;
  };
  const dbPath = require.resolve(path.join(root, 'api', '_lib', 'db.js'));
  require.cache[dbPath] = {
    id: dbPath, filename: dbPath, loaded: true,
    exports: {
      query: run,
      one: async (text, params) => (await run(text, params))[0] || null,
      tx: async (statements) => { const out = []; for (const [text, params] of statements) out.push(await run(text, params)); return out; },
      databaseUrl: () => url,
      separateFromProduction: () => true,
    },
  };

  // Signed in as "dev" for this process only; ActiveCampaign switched off.
  process.env.ADMIN_USER = 'dev';
  process.env.ADMIN_PASSWORD = crypto.randomBytes(18).toString('base64url');
  delete process.env.AC_API_KEY;
  delete process.env.AC_API_URL;
  delete process.env.VERCEL_ENV;
  const auth = require(path.join(root, 'api', '_lib', 'auth.js'));
  const admin = require(path.join(root, 'api', 'admin.js'));
  const cookie = `${auth.ADMIN_COOKIE}=${auth.adminSessionToken(process.env.ADMIN_USER, process.env.ADMIN_PASSWORD)}`;

  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/api/admin') {
      req.headers.cookie = cookie;
      return admin(req, res);
    }
    // Static files from site/, with clean URLs (/admin/shop → site/admin/shop/index.html).
    let file = path.normalize(path.join(root, 'site', decodeURIComponent(pathname)));
    if (!file.startsWith(path.join(root, 'site'))) { res.statusCode = 403; return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`Local admin: http://localhost:${PORT}/admin/shop — nothing is saved (${new URL(url).host})`));

  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    server.close();
    try { await client.query('ROLLBACK'); console.log('rolled back: the database is unchanged'); } catch (err) { console.error(err.message); }
    client.release();
    await pool.end();
    process.exit(0);
  }
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
