/*
 * The whole site on this computer, with its API: static files from site/, the admin API, and the checkout
 * (pages, order API, provider callbacks) running against FAKE payment providers (tools/shop/fake-providers.js).
 * The normal local preview ("site") serves static files only.
 *
 *   node --env-file-if-exists=.env.local tools/shop/dev-server.js
 *   (or the "shop-admin" preview in .claude/launch.json)
 *   → http://localhost:8793/admin/shop           the admin, signed in as "dev"
 *   → http://localhost:8793/checkout/<product>   the checkout; "paying" opens a fake payment page
 *
 * NOTHING IS SAVED AND NO MONEY MOVES. Every query runs inside one database transaction that is rolled back
 * when the server stops: migrations that haven't been applied yet are applied inside it, and whatever you
 * create (products, orders, payments) disappears on exit. It uses the previews' database
 * (PODCAST_DATABASE_URL) when set, otherwise DATABASE_URL. CiderPay and PayPal are always the fakes here,
 * whatever keys are in .env.local; ActiveCampaign and Slack are switched off. It listens on localhost only.
 * The Emails section's "Sync now" reads made-up campaigns (tools/emails/fake-ac.js), never the real ActiveCampaign.
 *
 * tools/shop/e2e.js starts the same server to run the end-to-end checks.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { Pool } = require('@neondatabase/serverless');
const fakes = require('./fake-providers.js');

const root = path.join(__dirname, '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain' };

async function start({ port = Number(process.env.PORT || 8793), quiet = false } = {}) {
  const say = (...a) => { if (!quiet) console.log(...a); };
  const url = process.env.PODCAST_DATABASE_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error('No database address: add DATABASE_URL (or PODCAST_DATABASE_URL) to .env.local');
  const base = `http://localhost:${port}`;

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
    say(`applied ${file} (inside the transaction: rolled back on exit)`);
  }

  // The API's database module, pointed at this transaction. Queries run one at a time, each behind a
  // savepoint, so a failed query doesn't poison the rest of the session.
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

  // This process only: signed in as "dev"; fake payment providers; ActiveCampaign and Slack off.
  const fakeEnv = {
    ADMIN_USER: 'dev', ADMIN_PASSWORD: crypto.randomBytes(18).toString('base64url'),
    SHOP_SECRET: crypto.randomBytes(32).toString('base64url'), SHOP_PUBLIC_URL: base,
    CIDERPAY_MEMBER_ID: 'fake-member', CIDERPAY_API_TOKEN: 'fake-token', CIDERPAY_API_BASE: `${base}/__fake/ciderpay`,
    PAYPAL_CLIENT_ID: 'fake-client', PAYPAL_SECRET: 'fake-secret', PAYPAL_WEBHOOK_ID: 'WH-FAKE', PAYPAL_ENV: 'sandbox', PAYPAL_API_BASE: `${base}/__fake/paypal`,
  };
  Object.assign(process.env, fakeEnv);
  for (const name of ['AC_API_KEY', 'AC_API_URL', 'VERCEL_ENV', 'VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_AUTOMATION_BYPASS_SECRET', 'SLACK_WEBHOOK_ASHLEY', 'SLACK_WEBHOOK_ALEX']) delete process.env[name];

  // The Emails section syncs from a made-up ActiveCampaign.
  require(path.join(root, 'api', '_lib', 'emails', 'ac-sync.js')).setClient(require(path.join(root, 'tools', 'emails', 'fake-ac.js')).create({ now: new Date() }).request);

  const auth = require(path.join(root, 'api', '_lib', 'auth.js'));
  const handlers = {
    '/api/admin': require(path.join(root, 'api', 'admin.js')),
    '/api/shop': require(path.join(root, 'api', 'shop.js')),
    '/api/shop-callback': require(path.join(root, 'api', 'shop-callback.js')),
    '/api/shop-page': require(path.join(root, 'api', 'shop-page.js')),
  };
  const cookie = `${auth.ADMIN_COOKIE}=${auth.adminSessionToken(fakeEnv.ADMIN_USER, fakeEnv.ADMIN_PASSWORD)}`;
  const fake = fakes.create({ base, memberId: fakeEnv.CIDERPAY_MEMBER_ID, apiToken: fakeEnv.CIDERPAY_API_TOKEN });

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url, base);
      if (u.pathname.startsWith('/__fake/')) return await fake.handle(req, res, u);
      // The rewrites of vercel.json.
      let m;
      if (u.pathname === '/checkout/complete') req.url = `/api/shop-page?view=complete&${u.searchParams}`;
      else if ((m = /^\/checkout\/([a-z0-9-]+)$/.exec(u.pathname))) req.url = `/api/shop-page?view=checkout&slug=${m[1]}&${u.searchParams}`;
      const route = new URL(req.url, base).pathname;
      if (handlers[route]) {
        if (route === '/api/admin') req.headers.cookie = cookie;
        return await handlers[route](req, res);
      }
      // Static files from site/, with clean URLs (/admin/shop → site/admin/shop/index.html).
      let file = path.normalize(path.join(root, 'site', decodeURIComponent(u.pathname)));
      if (!file.startsWith(path.join(root, 'site'))) { res.statusCode = 403; return res.end(); }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('not found'); }
      res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(file).pipe(res);
    } catch (err) {
      console.error('dev-server', err);
      if (!res.headersSent) res.statusCode = 500;
      res.end('error');
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  say(`Local site: ${base}/admin/shop — fake payments, nothing is saved (${new URL(url).host})`);

  let stopping = null;
  function stop() {
    if (!stopping) {
      stopping = (async () => {
        server.close();
        if (server.closeAllConnections) server.closeAllConnections();
        await chain.catch(() => {});
        try { await client.query('ROLLBACK'); say('rolled back: the database is unchanged'); } catch (err) { console.error(err.message); }
        client.release();
        await pool.end();
      })();
    }
    return stopping;
  }
  return { base, sql: run, fake, env: fakeEnv, stop };
}

module.exports = { start };

if (require.main === module) {
  start().then((s) => {
    const bye = () => s.stop().then(() => process.exit(0));
    process.on('SIGINT', bye);
    process.on('SIGTERM', bye);
    process.on('SIGHUP', bye);
  }).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
