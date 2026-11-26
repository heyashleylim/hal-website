/*
 * ActiveCampaign automation for the student area (Learning section). The site never calls AC in the middle of a
 * student's request: it writes pending operations to ac_outbox (each with a dedupe key, so it happens once), and
 * processOutbox() sends them, retrying failures with a growing delay. Ashley's AC automations react to the tags.
 *
 * Tags (Alex, 2026-11-26: renamed from podcast_…, unused ones removed). Per program, prefix = show.ac_tag_prefix
 * (e.g. learning_nsmb):
 *   <prefix>_enrolled            enrolled (purchase webhook, or by hand with "Tell ActiveCampaign")  → welcome email
 *   <prefix>_not_started_3d      enrolled 3 days ago, a lesson is out, nothing played yet            → reminder
 *   <prefix>_not_started_7d      same after 7 days
 *   <prefix>_weekNN_released     week NN opened for them (daily job, not for weeks already out when they enrolled)
 *   <prefix>_completed           finished (90%) every published Week lesson
 *   <prefix>_expiring_30d        access ends within 30 days
 *   <prefix>_expired             access ended
 *   <prefix>_revoked             access revoked by the refund webhook
 * Only "week" episodes count (not Q&A, Live or Bonus); several episodes of the same week give the tag once.
 * No link field and no link-reset tag (Alex, 2026-11-26): emails point to www.ashleylim.com/learn, where students sign
 * in with their email and a code.
 * Removed 2026-11-26: <prefix>_subscribed (podcast apps), <prefix>_epNN_downloaded (first play of a week) and
 * learning_link_reset (with the personal sign-in link).
 */
const db = require('./db.js');
const ac = require('./ac.js');
const release = require('./release.js');

const DAY = 24 * 60 * 60 * 1000;

// The site's public address. LEARNING_PUBLIC_URL (or the older PODCAST_PUBLIC_URL) wins; previews use their own.
function publicBase(env = process.env) {
  const explicit = (env.LEARNING_PUBLIC_URL || env.PODCAST_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (explicit) return explicit;
  if (env.VERCEL_ENV !== 'production' && env.VERCEL_BRANCH_URL) return `https://${env.VERCEL_BRANCH_URL}`;
  return 'https://www.ashleylim.com';
}

function acConfigured() {
  return Boolean((process.env.AC_API_URL || '').trim() && (process.env.AC_API_KEY || '').trim());
}

const pad = (n) => String(n).padStart(2, '0');

function defaultPrefix(slug) {
  return `learning_${String(slug).replace(/-/g, '_')}`;
}

function tags(show) {
  const p = show.ac_tag_prefix || defaultPrefix(show.slug);
  return {
    enrolled: `${p}_enrolled`,
    notStarted3: `${p}_not_started_3d`,
    notStarted7: `${p}_not_started_7d`,
    released: (n) => `${p}_week${pad(n)}_released`,
    completed: `${p}_completed`,
    expiring: `${p}_expiring_30d`,
    expired: `${p}_expired`,
    revoked: `${p}_revoked`,
  };
}

// Adds one pending operation; with a dedupe key it is only ever added once.
async function enqueue({ op, studentId, showId = null, payload, dedupe = null }) {
  await db.query(
    `INSERT INTO ac_outbox (op, student_id, show_id, payload, dedupe_key) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dedupe_key) DO NOTHING`,
    [op, studentId, showId, JSON.stringify(payload), dedupe],
  );
}

async function showById(id) {
  return db.one('SELECT * FROM shows WHERE id = $1', [id]);
}

// Newly enrolled in a program: add <prefix>_enrolled (once per program). The welcome email links to /learn.
async function notifyEnrolled(studentId, showId) {
  const [student, show] = await Promise.all([db.one('SELECT id FROM students WHERE id = $1', [studentId]), showById(showId)]);
  if (!student || !show) return;
  await enqueue({ op: 'tag_add', studentId, showId, payload: { tag: tags(show).enrolled }, dedupe: `s${studentId}:p${showId}:enrolled` });
}

// "Resend welcome": <prefix>_enrolled removed then added so the welcome automation runs again.
async function resendWelcome(studentId, showId) {
  const [student, show] = await Promise.all([db.one('SELECT id FROM students WHERE id = $1', [studentId]), showById(showId)]);
  if (!student || !show) return;
  await enqueue({ op: 'tag_readd', studentId, showId, payload: { tag: tags(show).enrolled } });
}

// A Week lesson was just finished (90%) in the student area: <prefix>_completed once every published Week lesson is.
async function onFinished(studentId, show, episode) {
  if (episode.kind !== 'week') return;
  const left = await db.one(
    `SELECT count(*)::int AS n FROM episodes ep
      WHERE ep.show_id = $2 AND ep.kind = 'week' AND ep.status = 'published' AND ep.blob_pathname IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM listening l WHERE l.student_id = $1 AND l.episode_id = ep.id AND l.completed_at IS NOT NULL)`,
    [studentId, show.id]);
  if (left.n === 0) {
    await enqueue({ op: 'tag_add', studentId, showId: show.id, payload: { tag: tags(show).completed }, dedupe: `s${studentId}:p${show.id}:completed` });
  }
}

async function onRevokedByWebhook(studentId, show) {
  await enqueue({ op: 'tag_add', studentId, showId: show.id, payload: { tag: tags(show).revoked } });
}

// The student's AC contact id: known, found by email, or a new contact (only then is our name used: AC's own
// First name is never overwritten).
async function ensureContact(row) {
  if (row.ac_contact_id) return row.ac_contact_id;
  const found = await ac.findContactByEmail(row.email);
  if (found) return String(found.id);
  return String(await ac.syncContact({ email: row.email, firstName: row.name || undefined }));
}

// Delay before the next try: 5 min, 10, 20 … up to 12 h.
function backoffMs(attempts) {
  return Math.min(12 * 60 * 60 * 1000, 5 * 60 * 1000 * 2 ** Math.max(0, attempts - 1));
}

// Sends pending operations to AC until the time budget is used. Returns { done, failed, left }.
async function processOutbox({ budgetMs = 8000, ids = null } = {}) {
  if (!acConfigured()) return { done: 0, failed: 0, left: null, skipped: 'ActiveCampaign is not configured (AC_API_URL / AC_API_KEY)' };
  const started = Date.now();
  const rows = await db.query(
    `SELECT o.*, s.email, s.name, s.ac_contact_id FROM ac_outbox o JOIN students s ON s.id = o.student_id
      WHERE o.status = 'pending' AND o.next_attempt_at <= now() ${ids ? 'AND o.id = ANY($1::bigint[])' : ''}
      ORDER BY o.id LIMIT 200`, ids ? [ids] : []);
  let done = 0, failed = 0;
  for (const row of rows) {
    if (Date.now() - started > budgetMs) break;
    try {
      const contactId = await ensureContact(row);
      if (row.op === 'fields') {
        await ac.syncContact({ email: row.email, fields: row.payload.fields });
      } else {
        if (row.op === 'tag_add') await ac.addTag(contactId, row.payload.tag);
        else if (row.op === 'tag_remove') await ac.removeTag(contactId, row.payload.tag);
        else if (row.op === 'tag_readd') {
          await ac.removeTag(contactId, row.payload.tag);
          await ac.addTag(contactId, row.payload.tag);
        }
      }
      if (contactId && String(contactId) !== String(row.ac_contact_id || '')) {
        await db.query('UPDATE students SET ac_contact_id = $2 WHERE id = $1', [row.student_id, String(contactId)]);
      }
      await db.query(`UPDATE ac_outbox SET status = 'done', done_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, [row.id]);
      done++;
    } catch (err) {
      const attempts = row.attempts + 1;
      await db.query(
        `UPDATE ac_outbox SET attempts = $2, last_error = $3, status = $4, next_attempt_at = now() + ($5 || ' milliseconds')::interval WHERE id = $1`,
        [row.id, attempts, String(err.message).slice(0, 500), attempts >= 8 ? 'failed' : 'pending', String(backoffMs(attempts))],
      );
      failed++;
    }
  }
  const left = (await db.one(`SELECT count(*)::int AS n FROM ac_outbox WHERE status = 'pending'`)).n;
  return { done, failed, left };
}

// ---------- daily job ----------

// Which date-based tags a student should get in one program today (pure: unit-tested).
function dailyTags({ show, access, enrolledAt, subscribed, now }) {
  const t = tags(show);
  const out = [];
  const day = (d) => new Date(d).toISOString().slice(0, 10);
  if (access.state === 'active') {
    for (const item of access.episodes) {
      const e = item.episode;
      // Released in the last 2 days, and not a catch-up week released before they enrolled.
      if (e.kind === 'week' && e.number && now - item.releaseAt < 2 * DAY && item.releaseAt >= new Date(enrolledAt.getTime() - 60 * 60 * 1000)) {
        out.push({ tag: t.released(e.number), key: `ep${e.number}-released` });
      }
    }
    const firstRelease = access.episodes.length ? access.episodes[0].releaseAt : null;
    if (!subscribed && firstRelease && firstRelease <= now) {
      const since = now - Math.max(enrolledAt.getTime(), firstRelease.getTime());
      if (since >= 3 * DAY) out.push({ tag: t.notStarted3, key: 'not-subscribed-3d' }); // keys kept: never sent twice
      if (since >= 7 * DAY) out.push({ tag: t.notStarted7, key: 'not-subscribed-7d' });
    }
    if (access.expires && access.expires - now <= 30 * DAY) out.push({ tag: t.expiring, key: `expiring:${day(access.expires)}` });
  } else if (access.state === 'expired' && access.expires && now - access.expires < 7 * DAY) {
    out.push({ tag: t.expired, key: `expired:${day(access.expires)}` });
  }
  return out;
}

async function dailyJob(now = new Date()) {
  const rows = await db.query(
    `SELECT en.student_id, en.created_at, row_to_json(en) AS enrollment,
            json_build_object('id', c.id, 'show_id', c.show_id, 'name', c.name, 'start_date', to_char(c.start_date, 'YYYY-MM-DD'), 'access_days', c.access_days) AS cohort
       FROM enrollments en JOIN cohorts c ON c.id = en.cohort_id JOIN students st ON st.id = en.student_id
      WHERE st.status = 'active'`);
  const [shows, episodes, overrideRows, feeds] = await Promise.all([
    db.query('SELECT * FROM shows'),
    db.query(`SELECT * FROM episodes WHERE status = 'published' AND blob_pathname IS NOT NULL`),
    db.query('SELECT cohort_id, episode_id, release_at FROM cohort_episode_dates'),
    // Has listened in the student area (the podcast feed was retired on 2026-11-15; old feed events still count).
    db.query(`SELECT DISTINCT student_id, show_id FROM events WHERE kind = 'feed'
              UNION SELECT DISTINCT l.student_id, ep.show_id FROM listening l JOIN episodes ep ON ep.id = l.episode_id`),
  ]);
  const showMap = new Map(shows.map((s) => [s.id, s]));
  const subscribed = new Set(feeds.map((f) => `${f.student_id}:${f.show_id}`));
  const byCohort = new Map();
  for (const r of overrideRows) {
    if (!byCohort.has(r.cohort_id)) byCohort.set(r.cohort_id, new Map());
    byCohort.get(r.cohort_id).set(r.episode_id, new Date(r.release_at));
  }
  const groups = new Map(); // student:show → enrolments
  for (const r of rows) {
    const key = `${r.student_id}:${r.cohort.show_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  let queued = 0;
  for (const [key, list] of groups) {
    const [studentId, showId] = key.split(':').map(Number);
    const show = showMap.get(showId);
    const access = release.showAccess({
      show, student: { status: 'active' }, enrollments: list.map((r) => ({ enrollment: r.enrollment, cohort: r.cohort })),
      episodes: episodes.filter((e) => e.show_id === showId), now,
      overridesFor: (cohort) => byCohort.get(cohort.id) || new Map(),
    });
    const enrolledAt = new Date(Math.min(...list.map((r) => new Date(r.created_at).getTime())));
    for (const x of dailyTags({ show, access, enrolledAt, subscribed: subscribed.has(key), now })) {
      await enqueue({ op: 'tag_add', studentId, showId, payload: { tag: x.tag }, dedupe: `s${studentId}:p${showId}:${x.key}` });
      queued++;
    }
  }
  const sent = await processOutbox({ budgetMs: 200 * 1000 });
  const cleaned = await db.one(
    `WITH a AS (DELETE FROM events WHERE at < now() - interval '13 months' RETURNING 1),
          b AS (DELETE FROM webhook_log WHERE at < now() - interval '180 days' RETURNING 1),
          c AS (DELETE FROM ac_outbox WHERE status = 'done' AND done_at < now() - interval '90 days' RETURNING 1),
          d AS (DELETE FROM learn_codes WHERE created_at < now() - interval '30 days' RETURNING 1),
          e AS (DELETE FROM learn_requests WHERE at < now() - interval '30 days' RETURNING 1),
          f AS (DELETE FROM learn_sessions WHERE (ended_at IS NOT NULL OR expires_at < now()) AND last_seen_at < now() - interval '90 days' RETURNING 1)
     SELECT (SELECT count(*) FROM a)::int AS events, (SELECT count(*) FROM b)::int AS webhooks, (SELECT count(*) FROM c)::int AS outbox,
            (SELECT count(*) FROM d)::int + (SELECT count(*) FROM e)::int + (SELECT count(*) FROM f)::int AS sign_in`);
  const result = { at: now.toISOString(), checked: groups.size, queued, sent, cleaned };
  await db.query(`INSERT INTO settings (key, value) VALUES ('daily-job', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [JSON.stringify(result)]);
  return result;
}

module.exports = {
  publicBase, acConfigured, tags, defaultPrefix, enqueue,
  notifyEnrolled, resendWelcome, onFinished, onRevokedByWebhook,
  processOutbox, backoffMs, dailyTags, dailyJob,
};
