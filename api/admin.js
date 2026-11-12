/*
 * /api/admin?action=… — the JSON API behind the admin (site/admin/), for every section.
 *
 * Sections register their actions here (MODULES). Today: system (status, activity log), podcast
 * (_lib/admin/podcast-*.js), waitlist (_lib/admin/waitlist.js: personal link codes), shop (_lib/admin/shop-*.js: products,
 * orders, settings; docs/commerce-plan.md) and emails (_lib/admin/emails.js: the archive of sent emails and their performance). A new section adds its module to MODULES; action names must be
 * unique across sections (prefix them, e.g. "shop-orders").
 *
 * Every request needs the admin cookie (set by the /admin login in middleware.js, checked again here).
 * Writes (POST) must also come from this site's own pages (Origin check), and are recorded in admin_log with
 * their section. GET /api/admin?action=cron is the daily job (podcast, then shop, then the emails' ActiveCampaign sync),
 * called by Vercel Cron with CRON_SECRET.
 */
const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');
const automation = require('./_lib/automation.js');
const shopOrders = require('./_lib/shop/orders.js');
const shopSync = require('./_lib/shop/sync.js');
const emailsSync = require('./_lib/emails/ac-sync.js');
const emailsTranslate = require('./_lib/emails/translate.js');

// Shop daily job: unpaid orders older than a day expire; ActiveCampaign updates still waiting are sent.
async function shopJob() {
  const expired = await shopOrders.expireStale();
  const sent = await shopSync.process({ budgetMs: 60 * 1000 });
  return { expired, sent };
}

const MODULES = [
  require('./_lib/admin/system.js'),
  require('./_lib/admin/podcast-content.js'),
  require('./_lib/admin/podcast-cohorts.js'),
  require('./_lib/admin/podcast-students.js'),
  require('./_lib/admin/podcast-automation.js'),
  require('./_lib/admin/waitlist.js'),
  require('./_lib/admin/shop-products.js'),
  require('./_lib/admin/shop-orders.js'),
  require('./_lib/admin/emails.js'),
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
      // The shop's daily job runs after the podcast's and never makes it fail.
      try {
        result.shop = await shopJob();
        await log('cron', 'shop', 'daily-job', 'daily job', result.shop);
      } catch (err) {
        console.error('admin cron: shop job', err);
        result.shop = { error: 'shop job failed' };
      }
      // Emails: ActiveCampaign's emails and their stats are copied once a day. Never makes the other jobs fail.
      try {
        result.emails = await emailsSync.sync({ trigger: 'cron', budgetMs: 120 * 1000 });
        if (!result.emails.skipped) await log('cron', 'emails', 'daily-sync', 'ActiveCampaign emails', result.emails);
        // New emails get their English translation (saved once; see _lib/emails/translate.js).
        const translated = await emailsTranslate.run({ budgetMs: 100 * 1000, token: req.headers['x-vercel-oidc-token'] });
        result.emails_translated = translated;
        if (translated.translated || (translated.error && !translated.skipped)) await log('cron', 'emails', 'daily-translate', 'English translations', translated);
      } catch (err) {
        console.error('admin cron: emails sync', err);
        result.emails = { error: 'emails sync failed' };
      }
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
  if (isWrite && name !== 'cron' && !db.separateFromProduction()) {
    return send(res, 409, { error: 'This preview uses the production database, so changes are blocked here. Set PODCAST_DATABASE_URL for Preview in Vercel (a Neon branch), or make the change in the production admin.' });
  }

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
