/*
 * Admin API, general actions (not tied to one section): system status and the activity log of every section.
 */
const blob = require('@vercel/blob');
const db = require('../db.js');
const { int, text } = require('./util.js');

const ENV = ['DATABASE_URL', 'PODCAST_SECRET', 'ADMIN_USER', 'ADMIN_PASSWORD', 'AC_API_URL', 'AC_API_KEY'];

const actions = {
  // Is everything configured? Missing env vars (names only), database, storage.
  async health() {
    const missing = ENV.filter((name) => !(name === 'DATABASE_URL' ? db.databaseUrl() : (process.env[name] || '')).trim());
    const out = { ok: false, missingEnv: missing, database: null, environment: process.env.VERCEL_ENV || 'local' };
    try {
      const migrations = await db.query('SELECT name, applied_at FROM schema_migrations ORDER BY name');
      out.database = { connected: true, migrations };
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

  // Admin changes in every section, newest first (optionally one section).
  async activity(input) {
    const limit = int(input.limit || 300, { min: 1, max: 1000, label: 'limit' });
    const q = text(input.q, { max: 100 });
    const section = text(input.section, { max: 40 });
    const rows = await db.query(
      `SELECT at, admin, section, action, target, details FROM admin_log
        WHERE ($1 = '' OR action ILIKE '%' || $1 || '%' OR target ILIKE '%' || $1 || '%' OR details::text ILIKE '%' || $1 || '%')
          AND ($3 = '' OR section = $3)
        ORDER BY at DESC LIMIT $2`,
      [q, limit, section],
    );
    return { entries: rows };
  },
};

module.exports = { section: 'system', actions, writes: [] };
