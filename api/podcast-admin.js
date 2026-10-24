/*
 * /api/podcast-admin?action=… — JSON API behind the private podcast admin pages (site/admin/podcast/).
 *
 * Every request needs the admin cookie (set by the /admin login in middleware.js, checked again here).
 * Writes (POST) must also come from this site's own pages (Origin check).
 * Each change is recorded in admin_log.
 *
 * Phase 1: only `health`. Shows, episodes, cohorts, students, analytics and the daily job are added
 * in later phases (docs/podcast-plan.md).
 */
const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');

const ENV = ['DATABASE_URL', 'PODCAST_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD', 'AC_API_URL', 'AC_API_KEY'];

const actions = {
  // GET: is everything configured? Lists missing env vars (names only) and the database state.
  async health() {
    const missing = ENV.filter((name) => !(name === 'DATABASE_URL' ? db.databaseUrl() : (process.env[name] || '')).trim());
    const out = { ok: false, missingEnv: missing, database: null };
    try {
      const migrations = await db.query('SELECT name, applied_at FROM schema_migrations ORDER BY name');
      const shows = await db.query('SELECT slug, title FROM shows ORDER BY id');
      out.database = { connected: true, migrations, shows };
    } catch (err) {
      out.database = { connected: false, error: /schema_migrations/.test(err.message) ? 'connected, but migrations have not run (npm run db:migrate)' : err.message };
    }
    out.ok = missing.length === 0 && out.database.connected === true;
    return out;
  },
};

const WRITE = new Set([]); // actions that change data (POST only)

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

module.exports = async function handler(req, res) {
  const admin = auth.adminFromRequest(req);
  if (!admin) return send(res, 401, { error: 'login required' });

  const url = new URL(req.url, 'http://local');
  const name = url.searchParams.get('action') || '';
  const action = Object.hasOwn(actions, name) ? actions[name] : null;
  if (!action) return send(res, 404, { error: 'unknown action' });

  const isWrite = WRITE.has(name);
  if (isWrite && req.method !== 'POST') return send(res, 405, { error: 'POST required' });
  if (!isWrite && req.method !== 'GET') return send(res, 405, { error: 'GET required' });
  if (isWrite && !auth.sameOrigin(req)) return send(res, 403, { error: 'bad origin' });

  try {
    const input = isWrite ? await readJson(req) : Object.fromEntries(url.searchParams);
    const result = await action(input, { admin, req });
    if (isWrite) {
      await db.query('INSERT INTO admin_log (admin, action, target, details) VALUES ($1, $2, $3, $4)', [admin, name, result && result.target ? String(result.target) : null, JSON.stringify(input)]);
    }
    return send(res, 200, result);
  } catch (err) {
    console.error('podcast-admin', name, err);
    return send(res, err.status && err.status < 500 ? err.status : 500, { error: err.expose ? err.message : 'server error' });
  }
};
