/*
 * /api/podcast-admin?action=… — JSON API behind the private podcast admin pages (site/admin/podcast/).
 *
 * Every request needs the admin cookie (set by the /admin login in middleware.js, checked again here).
 * Writes (POST) must also come from this site's own pages (Origin check).
 * Each change is recorded in admin_log.
 *
 * So far: `health`, plus test tools for phase 2 (`episodes`, `episode-upload` for files up to 4 MB,
 * `test-setup`). Shows, full episode management, cohorts, students, analytics and the daily job are added
 * in later phases (docs/podcast-plan.md).
 */
const crypto = require('node:crypto');
const blob = require('@vercel/blob');
const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');
const release = require('./_lib/release.js');

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

  // GET: episodes of the NSMB show.
  async episodes() {
    const rows = await db.query(
      `SELECT e.id, e.guid, e.kind, e.number, e.title, e.day_offset, e.status, e.bytes, e.duration_seconds, e.mime_type, e.updated_at
         FROM episodes e JOIN shows s ON s.id = e.show_id WHERE s.slug = 'nsmb'
        ORDER BY e.day_offset, e.number NULLS LAST, e.id`,
    );
    return { episodes: rows };
  },

  // POST (raw audio body, ≤ 4 MB until phase 3 adds direct uploads): adds or replaces module <number>, published.
  async 'episode-upload'(input, { body, req }) {
    const number = Number(input.number);
    const dayOffset = Number(input.day_offset);
    const title = String(input.title || '').trim();
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
    if (!Number.isInteger(number) || number < 1) throw userError('number must be a positive integer');
    if (!Number.isInteger(dayOffset) || dayOffset < 0) throw userError('day_offset must be 0 or more');
    if (!title) throw userError('title is required');
    if (!/^audio\/(mpeg|mp4|x-m4a|aac)$/.test(mime)) throw userError('upload an MP3 or M4A file');
    if (!body || !body.length) throw userError('empty file');
    const show = await db.one(`SELECT id, slug FROM shows WHERE slug = 'nsmb'`);
    const ext = mime === 'audio/mpeg' ? 'mp3' : 'm4a';
    const stored = await blob.put(`podcast/${show.slug}/module-${String(number).padStart(2, '0')}-${crypto.randomUUID()}.${ext}`, body, { access: 'private', contentType: mime });
    const duration = Math.round(Number(input.duration)) || null;
    const row = await db.one(
      `INSERT INTO episodes (show_id, kind, number, title, day_offset, status, blob_pathname, bytes, duration_seconds, mime_type)
       VALUES ($1, 'module', $2, $3, $4, 'published', $5, $6, $7, $8)
       ON CONFLICT (show_id, number) WHERE kind = 'module'
       DO UPDATE SET title = EXCLUDED.title, day_offset = EXCLUDED.day_offset, status = 'published', blob_pathname = EXCLUDED.blob_pathname,
                     bytes = EXCLUDED.bytes, duration_seconds = EXCLUDED.duration_seconds, mime_type = EXCLUDED.mime_type, updated_at = now()
       RETURNING id, guid, number, title`,
      [show.id, number, title, dayOffset, stored.pathname, body.length, duration, mime],
    );
    return { episode: row, target: `episode ${row.id}` };
  },

  // POST: creates (or updates) the "테스트" cohort and a test student; returns their subscribe link.
  async 'test-setup'(input, { req }) {
    const email = String(input.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw userError('a valid email is required');
    const startDate = String(input.start_date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw userError('start_date must be YYYY-MM-DD');
    const show = await db.one(`SELECT * FROM shows WHERE slug = 'nsmb'`);
    const cohort = await db.one(
      `INSERT INTO cohorts (show_id, name, ac_tag, start_date) VALUES ($1, '테스트', 'nsmb-test', $2)
       ON CONFLICT (show_id, name) DO UPDATE SET start_date = EXCLUDED.start_date, updated_at = now()
       RETURNING id, name, to_char(start_date, 'YYYY-MM-DD') AS start_date`,
      [show.id, startDate],
    );
    const listener = await db.one(
      `INSERT INTO listeners (show_id, cohort_id, email, name, token, source) VALUES ($1, $2, $3, $4, $5, 'manual')
       ON CONFLICT (show_id, lower(email)) DO UPDATE SET cohort_id = EXCLUDED.cohort_id, name = EXCLUDED.name, status = 'active', updated_at = now()
       RETURNING id, token, email`,
      [show.id, cohort.id, email, String(input.name || '').trim(), auth.newToken()],
    );
    const base = `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
    return {
      cohort,
      listener: { id: listener.id, email: listener.email },
      subscribeUrl: `${base}/podcast/${listener.token}`,
      feedUrl: `${base}/f/${listener.token}`,
      firstRelease: release.zonedTime(cohort.start_date, show.release_time, show.timezone),
      target: `listener ${listener.id}`,
    };
  },
};

const WRITE = new Set(['episode-upload', 'test-setup']); // actions that change data (POST only)
const RAW = new Set(['episode-upload']); // the body is a file; other inputs come from the query string
const MAX_RAW = 4 * 1024 * 1024;

function userError(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(body));
}

async function readRaw(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_RAW) throw userError('file too large for this test upload (max 4 MB)');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
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
    const raw = RAW.has(name);
    const body = raw ? await readRaw(req) : null;
    const input = isWrite && !raw ? await readJson(req) : Object.fromEntries(url.searchParams);
    const result = await action(input, { admin, req, body });
    if (isWrite) {
      const details = raw ? { ...input, bytes: body.length } : input;
      await db.query('INSERT INTO admin_log (admin, action, target, details) VALUES ($1, $2, $3, $4)', [admin, name, result && result.target ? String(result.target) : null, JSON.stringify(details)]);
    }
    return send(res, 200, result);
  } catch (err) {
    console.error('podcast-admin', name, err);
    return send(res, err.status && err.status < 500 ? err.status : 500, { error: err.expose ? err.message : 'server error' });
  }
};
