/*
 * /api/podcast-admin?action=… — JSON API behind the private podcast admin pages (site/admin/podcast/).
 *
 * Every request needs the admin cookie (set by the /admin login in middleware.js, checked again here).
 * Writes (POST) must also come from this site's own pages (Origin check).
 * Each change is recorded in admin_log.
 *
 * Actions: `health` here; show settings, artwork and episodes in _lib/admin-content.js; cohorts and schedules
 * in _lib/admin-cohorts.js; students and the activity log in _lib/admin-students.js. Analytics and the daily
 * job come in later phases (docs/podcast-plan.md).
 */
const blob = require('@vercel/blob');
const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');
const content = require('./_lib/admin-content.js');
const cohorts = require('./_lib/admin-cohorts.js');
const students = require('./_lib/admin-students.js');
const automationAdmin = require('./_lib/admin-automation.js');
const automation = require('./_lib/automation.js');
const { userError } = require('./_lib/admin-util.js');

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
    try {
      await blob.list({ limit: 1 });
      out.storage = { connected: true };
    } catch (err) {
      out.storage = { connected: false, error: err.message };
    }
    out.ok = missing.length === 0 && out.database.connected === true && out.storage.connected === true;
    return out;
  },
};

Object.assign(actions, content.actions, cohorts.actions, students.actions, automationAdmin.actions);

// Actions that change data: POST only, same-origin, recorded in admin_log.
const WRITE = new Set([...content.writes, ...cohorts.writes, ...students.writes, ...automationAdmin.writes]);

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
  // The daily job (vercel.json "crons", production only): Vercel sends Authorization: Bearer <CRON_SECRET>.
  if (new URL(req.url, 'http://local').searchParams.get('action') === 'cron') {
    const secret = (process.env.CRON_SECRET || '').trim();
    if (!secret || !auth.safeEqual(req.headers.authorization || '', `Bearer ${secret}`)) return send(res, 401, { error: 'cron only' });
    try {
      const result = await automation.dailyJob();
      await db.query('INSERT INTO admin_log (admin, action, target, details) VALUES ($1, $2, $3, $4)', ['cron', 'daily-job', 'daily job', JSON.stringify(result)]);
      return send(res, 200, result);
    } catch (err) {
      console.error('podcast cron', err);
      return send(res, 500, { error: 'daily job failed' });
    }
  }

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
      // An action can replace what's logged (result.log), or skip logging with log: null (e.g. a dry run).
      const details = result && 'log' in result ? result.log : input;
      if (details !== null) {
        await db.query('INSERT INTO admin_log (admin, action, target, details) VALUES ($1, $2, $3, $4)', [admin, name, result && result.target ? String(result.target) : null, JSON.stringify(details)]);
      }
      if (result) { delete result.target; delete result.log; }
    }
    return send(res, 200, result);
  } catch (err) {
    console.error('podcast-admin', name, err);
    return send(res, err.status && err.status < 500 ? err.status : 500, { error: err.expose ? err.message : 'server error' });
  }
};
