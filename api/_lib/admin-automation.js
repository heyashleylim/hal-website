/*
 * Podcast admin API: the Automation page (ActiveCampaign) — setup status, webhook addresses, tag names, the queue
 * of pending AC updates, the webhook log, retries and the daily job. Actions are routed by api/podcast-admin.js.
 */
const db = require('./db.js');
const ac = require('./ac.js');
const auth = require('./auth.js');
const automation = require('./automation.js');
const podcast = require('./podcast.js');
const { userError, getShow, int } = require('./admin-util.js');

function baseUrl(req) {
  return `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

const actions = {
  async automation(input, { req }) {
    const show = await getShow(input.show);
    const t = automation.tags(show);
    const configured = automation.acConfigured();
    let field = { name: automation.linkField(), ok: false, error: null, perstag: null };
    if (configured) {
      try {
        const f = await ac.findField(field.name);
        field.ok = true;
        field.perstag = f.perstag; // what to type in AC emails, e.g. %PODCASTLINK%
        field.title = f.title;
      } catch (err) {
        field.error = err.message;
      }
    }
    let key = null;
    try { key = auth.webhookKey(); } catch (_) { /* PODCAST_SECRET missing: shown as not ready */ }
    // On preview deployments AC must pass Vercel's login too: add the bypass secret (never on production).
    const bypass = podcast.linkQuery().replace(/^\?/, '&');
    const hook = key ? `${baseUrl(req)}/api/podcast-ac?key=${key}${bypass}` : null;
    const cohorts = await db.query(`SELECT name, ac_tag FROM cohorts WHERE show_id = $1 ORDER BY start_date`, [show.id]);
    const modules = await db.query(`SELECT number FROM episodes WHERE show_id = $1 AND kind = 'module' AND number IS NOT NULL ORDER BY number`, [show.id]);
    const [counts, outbox, webhooks, daily] = await Promise.all([
      db.one(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'failed')::int AS failed,
                     count(*) FILTER (WHERE status = 'done')::int AS done FROM ac_outbox`),
      db.query(`SELECT o.id, o.op, o.payload, o.status, o.attempts, o.last_error, o.created_at, o.done_at, s.email, s.id AS student_id
                  FROM ac_outbox o JOIN students s ON s.id = o.student_id ORDER BY o.id DESC LIMIT 100`),
      db.query(`SELECT w.at, w.payload, w.result, w.student_id FROM webhook_log w ORDER BY w.at DESC LIMIT 50`),
      db.one(`SELECT value, updated_at FROM settings WHERE key = 'daily-job'`),
    ]);
    const sample = modules.length ? modules[0].number : 1;
    return {
      program: { slug: show.slug, title: show.title, prefix: show.ac_tag_prefix },
      ready: {
        ac: configured, field, webhook: Boolean(key),
        cron: Boolean((process.env.CRON_SECRET || '').trim()),
        production: process.env.VERCEL_ENV === 'production',
        public_url: automation.publicBase(), public_url_set: Boolean((process.env.PODCAST_PUBLIC_URL || '').trim()),
      },
      webhook: hook && {
        enroll: hook,
        revoke: `${hook}&action=revoke&tag=`,
      },
      cohorts,
      tags: [
        { tag: t.enrolled, when: 'Enrolled in this program (purchase webhook, or added here with "Tell ActiveCampaign"). Use it to send the welcome email with %' + (field.perstag || automation.linkField()) + '%.' },
        { tag: t.subscribed, when: 'Their podcast app fetched this program\'s feed for the first time.' },
        { tag: t.notSubscribed3, when: '3 days after enrolling (and after the first release) without subscribing. Reminder email.' },
        { tag: t.notSubscribed7, when: 'Same after 7 days.' },
        { tag: t.released(sample).replace(/_ep\d+_/, '_epNN_'), when: 'Module NN was released for them (e.g. ' + t.released(sample) + '). "New module" email. Not added for modules already out when they enrolled.' },
        { tag: t.downloaded(sample).replace(/_ep\d+_/, '_epNN_'), when: 'They downloaded module NN for the first time.' },
        { tag: t.completed, when: 'They downloaded every published module.' },
        { tag: t.expiring, when: 'Their access ends within 30 days.' },
        { tag: t.expired, when: 'Their access ended (in the last 7 days).' },
        { tag: t.revoked, when: 'Access revoked by the refund webhook.' },
        { tag: automation.LINK_RESET_TAG, when: 'Their personal link was reset in the admin (re-added each time). Email the new %' + (field.perstag || automation.linkField()) + '%.' },
      ],
      counts, outbox, webhooks,
      daily: daily ? { ...daily.value, updated_at: daily.updated_at } : null,
    };
  },

  // Send pending updates now (instead of waiting for the daily job).
  async 'outbox-process'() {
    return { ...(await automation.processOutbox({ budgetMs: 20000 })), target: 'ac queue' };
  },

  // Put failed (or the given) updates back in the queue and send them.
  async 'outbox-retry'(input) {
    const ids = input.ids ? (Array.isArray(input.ids) ? input.ids : [input.ids]).map((v) => int(v, { min: 1, max: Number.MAX_SAFE_INTEGER, label: 'id' })) : null;
    const rows = await db.query(
      `UPDATE ac_outbox SET status = 'pending', next_attempt_at = now() WHERE status IN ('failed', 'pending') ${ids ? 'AND id = ANY($1::bigint[])' : ''} RETURNING id`,
      ids ? [ids] : []);
    const sent = await automation.processOutbox({ budgetMs: 20000 });
    return { requeued: rows.length, ...sent, target: 'ac queue' };
  },

  async 'daily-run'() {
    return { ...(await automation.dailyJob()), target: 'daily job' };
  },

  // Fill their link field in AC again (e.g. after fixing the field), without any tag.
  async 'student-ac-push'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'student' });
    const st = await db.one('SELECT id, token FROM students WHERE id = $1', [id]);
    if (!st) throw userError('student not found', 404);
    await automation.enqueue({ op: 'fields', studentId: id, payload: { fields: { [automation.linkField()]: automation.pageUrl(st.token) } } });
    return { ...(await automation.processOutbox({ budgetMs: 8000 })), target: `student ${id}` };
  },

  // Re-adds <prefix>_enrolled for one program so AC's welcome automation runs again.
  async 'student-resend-welcome'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'student' });
    const showId = int(input.show_id, { min: 1, max: 2147483647, label: 'program' });
    if (!automation.acConfigured()) throw userError('ActiveCampaign is not configured (AC_API_URL / AC_API_KEY in Vercel)');
    await automation.resendWelcome(id, showId);
    return { ...(await automation.processOutbox({ budgetMs: 8000 })), target: `student ${id}` };
  },
};

const writes = ['outbox-process', 'outbox-retry', 'daily-run', 'student-ac-push', 'student-resend-welcome'];

module.exports = { actions, writes };
