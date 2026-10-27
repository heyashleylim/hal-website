/*
 * Podcast admin API: cohorts, their release schedule and per-cohort date changes
 * (Podcast section; actions are routed by api/admin.js). Release rules live in release.js.
 */
const db = require('../db.js');
const release = require('../release.js');
const { userError, getShow, text, int, date, time, friendlyUnique } = require('./util.js');

const COHORT_COLUMNS = `c.id, c.name, c.ac_tag, to_char(c.start_date, 'YYYY-MM-DD') AS start_date, c.access_days, c.created_at`;

async function getCohort(show, id) {
  const cohort = await db.one(`SELECT ${COHORT_COLUMNS} FROM cohorts c WHERE c.id = $1 AND c.show_id = $2`, [id, show.id]);
  if (!cohort) throw userError('cohort not found', 404);
  return cohort;
}

function cohortStatus(show, cohort, episodes, now = new Date()) {
  const start = release.zonedTime(cohort.start_date, show.release_time, show.timezone);
  const end = release.expiresAt({ show, cohort, listener: {} });
  if (now < start) return 'upcoming';
  if (now >= end) return 'finished';
  return 'active';
}

const actions = {
  async cohorts(input) {
    const show = await getShow(input.show);
    const rows = await db.query(
      `SELECT ${COHORT_COLUMNS},
              count(en.id)::int AS students,
              count(en.id) FILTER (WHERE st.first_seen_at IS NOT NULL)::int AS subscribed,
              count(en.id) FILTER (WHERE en.status = 'revoked' OR st.status = 'revoked')::int AS revoked
         FROM cohorts c LEFT JOIN enrollments en ON en.cohort_id = c.id LEFT JOIN students st ON st.id = en.student_id
        WHERE c.show_id = $1
        GROUP BY c.id ORDER BY c.start_date DESC, c.id DESC`,
      [show.id],
    );
    const now = new Date();
    return {
      cohorts: rows.map((c) => ({ ...c, status: cohortStatus(show, c, null, now), expires_at: release.expiresAt({ show, cohort: c, listener: {} }) })),
      default_access_days: show.access_days,
    };
  },

  async 'cohort-save'(input) {
    const show = await getShow(input.show);
    const id = input.id ? int(input.id, { min: 1, max: 2147483647, label: 'id' }) : null;
    if (id) await getCohort(show, id);
    const name = text(input.name, { max: 60, required: true, label: 'Name' });
    const acTag = text(input.ac_tag, { max: 100, required: true, label: 'AC tag' });
    const startDate = date(input.start_date, { label: 'Start date' });
    const accessDays = int(input.access_days, { min: 1, max: 3650, label: 'Access length', optional: true });
    const values = [name, acTag, startDate, accessDays];
    const row = await friendlyUnique(
      id
        ? db.one(`UPDATE cohorts SET name = $2, ac_tag = $3, start_date = $4, access_days = $5, updated_at = now() WHERE id = $1 RETURNING id`, [id, ...values])
        : db.one(`INSERT INTO cohorts (show_id, name, ac_tag, start_date, access_days) VALUES ($1, $2, $3, $4, $5) RETURNING id`, [show.id, ...values]),
      { cohorts_show_id_name_key: `a cohort named "${name}" already exists`, cohorts_ac_tag: `another cohort (in this or another program) already uses the AC tag "${acTag}"` },
    );
    return { cohort: await getCohort(show, row.id), target: `cohort ${row.id} (${name})` };
  },

  async 'cohort-delete'(input) {
    const show = await getShow(input.show);
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const cohort = await getCohort(show, id);
    const { n } = await db.one('SELECT count(*)::int AS n FROM enrollments WHERE cohort_id = $1', [id]);
    if (n > 0) throw userError(`this cohort has ${n} student(s); remove their enrolment first (Students page)`);
    await db.query('DELETE FROM cohorts WHERE id = $1', [id]);
    return { deleted: id, target: `cohort ${id} (${cohort.name})` };
  },

  // Every episode with its release date for this cohort, and whether it's already out.
  async 'cohort-schedule'(input) {
    const show = await getShow(input.show);
    const cohort = await getCohort(show, int(input.id, { min: 1, max: 2147483647, label: 'id' }));
    const [episodes, overrideRows] = await Promise.all([
      db.query(`SELECT id, kind, number, title, day_offset, status, blob_pathname FROM episodes WHERE show_id = $1 ORDER BY day_offset, number NULLS LAST, id`, [show.id]),
      db.query('SELECT episode_id, release_at FROM cohort_episode_dates WHERE cohort_id = $1', [cohort.id]),
    ]);
    const overrides = new Map(overrideRows.map((r) => [r.episode_id, new Date(r.release_at)]));
    const now = new Date();
    const listener = {};
    const rows = episodes.map((e) => {
      const at = release.releaseAt({ show, cohort, listener, episode: { ...e, status: 'published' }, override: overrides.get(e.id) });
      return {
        id: e.id, kind: e.kind, number: e.number, title: e.title, day_offset: e.day_offset, status: e.status,
        has_audio: Boolean(e.blob_pathname), release_at: at, overridden: overrides.has(e.id),
        released: e.status === 'published' && Boolean(e.blob_pathname) && at <= now,
      };
    }).sort((a, b) => a.release_at - b.release_at);
    return { cohort, episodes: rows, expires_at: release.expiresAt({ show, cohort, listener }), release_time: show.release_time, timezone: show.timezone };
  },

  // Moves one episode for one cohort (date + time in the show's timezone), or clears the change.
  async 'cohort-override'(input) {
    const show = await getShow(input.show);
    const cohort = await getCohort(show, int(input.cohort_id, { min: 1, max: 2147483647, label: 'cohort' }));
    const episodeId = int(input.episode_id, { min: 1, max: 2147483647, label: 'episode' });
    const episode = await db.one('SELECT id, title FROM episodes WHERE id = $1 AND show_id = $2', [episodeId, show.id]);
    if (!episode) throw userError('episode not found', 404);
    if (input.clear) {
      await db.query('DELETE FROM cohort_episode_dates WHERE cohort_id = $1 AND episode_id = $2', [cohort.id, episode.id]);
      return { cleared: true, target: `cohort ${cohort.id} episode ${episode.id}` };
    }
    const at = release.zonedTime(date(input.date, { label: 'Date' }), time(input.time || show.release_time, { label: 'Time' }), show.timezone);
    await db.query(
      `INSERT INTO cohort_episode_dates (cohort_id, episode_id, release_at) VALUES ($1, $2, $3)
       ON CONFLICT (cohort_id, episode_id) DO UPDATE SET release_at = EXCLUDED.release_at`,
      [cohort.id, episode.id, at.toISOString()],
    );
    return { release_at: at, target: `cohort ${cohort.id} episode ${episode.id}` };
  },
};

const writes = ['cohort-save', 'cohort-delete', 'cohort-override'];

module.exports = { section: 'podcast', actions, writes };
