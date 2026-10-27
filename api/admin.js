/*
 * /api/admin?action=… — the JSON API behind the admin (site/admin/), for every section.
 *
 * Sections register their actions here (MODULES). Today: system (status, activity log) and podcast
 * (_lib/admin/podcast-*.js). A new section (e.g. e-commerce) adds its module to MODULES; action names must be
 * unique across sections (prefix them, e.g. "shop-orders").
 *
 * Every request needs the admin cookie (set by the /admin login in middleware.js, checked again here).
 * Writes (POST) must also come from this site's own pages (Origin check), and are recorded in admin_log with
 * their section. GET /api/admin?action=cron is the podcast daily job, called by Vercel Cron with CRON_SECRET.
 */
const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');
const automation = require('./_lib/automation.js');

const MODULES = [
  require('./_lib/admin/system.js'),
  require('./_lib/admin/podcast-content.js'),
  require('./_lib/admin/podcast-cohorts.js'),
  require('./_lib/admin/podcast-students.js'),
  require('./_lib/admin/podcast-automation.js'),
];

const actions = {};      // name → handler
const sectionOf = {};    // name → section
const WRITE = new Set(); // actions that change data: POST only, same-origin, logged
for (const m of MODULES) {
  for (const [name, fn] of Object.entries(m.actions)) {
    if (actions[name]) throw new Error(`admin action "${name}" is defined twice`);
    actions[name] = fn;
    sectionOf[name] = m.section;
  }
  m.writes.forEach((w) => WRITE.add(w));
}

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

async function log(admin, section, action, target, details) {
  await db.query('INSERT INTO admin_log (admin, section, action, target, details) VALUES ($1, $2, $3, $4, $5)',
    [admin, section, action, target, JSON.stringify(details)]);
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  const name = url.searchParams.get('action') || '';

  // The podcast daily job (vercel.json "crons", production only): Vercel sends Authorization: Bearer <CRON_SECRET>.
  if (name === 'cron') {
    const secret = (process.env.CRON_SECRET || '').trim();
    if (!secret || !auth.safeEqual(req.headers.authorization || '', `Bearer ${secret}`)) return send(res, 401, { error: 'cron only' });
    try {
      const result = await automation.dailyJob();
      await log('cron', 'podcast', 'daily-job', 'daily job', result);
      return send(res, 200, result);
    } catch (err) {
      console.error('admin cron', err);
      return send(res, 500, { error: 'daily job failed' });
    }
  }

  const admin = auth.adminFromRequest(req);
  if (!admin) return send(res, 401, { error: 'login required' });

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
      if (details !== null) await log(admin, sectionOf[name], name, result && result.target ? String(result.target) : null, details);
      if (result) { delete result.target; delete result.log; }
    }
    return send(res, 200, result);
  } catch (err) {
    console.error('admin', name, err);
    return send(res, err.status && err.status < 500 ? err.status : 500, { error: err.expose ? err.message : 'server error' });
  }
};
