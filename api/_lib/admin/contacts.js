/*
 * Contacts admin API (/admin/contacts): every ActiveCampaign contact, copied by ../contacts/ac-sync.js (read-only on
 * the AC side), with what the site knows about each one (shop orders, Learning access, Students records).
 *   contacts-overview   counts and the state of the sync
 *   contacts-list       search and filters, 100 at a time
 *   contacts-get        one contact with everything linked to it
 *   contacts-tags       tag names with how many contacts have each (for the filter)
 *   contacts-sync       sync history;  contacts-sync-run  runs a sync now (40 s; the page repeats it while work is left)
 */
const db = require('../db.js');
const acSync = require('../contacts/ac-sync.js');
const { userError, text, int } = require('./util.js');

const LIGHT = `id, ac_id, email, first_name, last_name, phone, tags, ac_created_at, ac_updated_at, details_at, gone_from_ac_at`;
const SORTS = {
  newest: 'ac_created_at DESC NULLS LAST, id DESC',
  oldest: 'ac_created_at ASC NULLS LAST, id',
  updated: 'ac_updated_at DESC NULLS LAST, id DESC',
  name: 'first_name, last_name, email',
  email: 'email',
};

const actions = {
  async 'contacts-overview'() {
    const [counts, last, lastOk, state] = await Promise.all([
      db.one(`SELECT count(*)::int AS total,
                     count(*) FILTER (WHERE gone_from_ac_at IS NULL)::int AS in_ac,
                     count(*) FILTER (WHERE gone_from_ac_at IS NOT NULL)::int AS gone,
                     count(*) FILTER (WHERE details_at IS NULL AND gone_from_ac_at IS NULL)::int AS details_pending,
                     count(*) FILTER (WHERE ac_created_at > now() - interval '30 days')::int AS new_30d
                FROM contacts`),
      db.one(`SELECT started_at, ok, error FROM contact_sync_runs ORDER BY id DESC LIMIT 1`),
      db.one(`SELECT max(finished_at) AS at FROM contact_sync_runs WHERE ok`),
      acSync.getState(),
    ]);
    const students = await db.one(`SELECT count(*)::int AS n FROM program_students WHERE contact_id IS NOT NULL`);
    return { counts: { ...counts, students_linked: students.n }, last_run: last, last_ok_at: lastOk && lastOk.at, connected: acSync.configured(), sweep: sweepInfo(state) };
  },

  async 'contacts-list'(input) {
    const q = text(input.q, { max: 100, label: 'search' }).toLowerCase();
    const tag = text(input.tag, { max: 200, label: 'tag' });
    const status = ['', 'in_ac', 'gone'].includes(input.status || '') ? input.status || '' : '';
    const linked = ['', 'student', 'buyer', 'learning'].includes(input.linked || '') ? input.linked || '' : '';
    const sort = Object.hasOwn(SORTS, input.sort || '') ? input.sort : 'newest';
    const offset = int(input.offset || 0, { min: 0, max: 10000000, label: 'offset' });
    const where = [];
    const params = [];
    if (q) {
      params.push(q);
      where.push(`(position($${params.length} in lower(email || ' ' || first_name || ' ' || last_name || ' ' || phone)) > 0
                   OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE position($${params.length} in lower(t)) > 0))`);
    }
    if (tag) { params.push(tag); where.push(`$${params.length} = ANY(tags)`); }
    if (status === 'in_ac') where.push('gone_from_ac_at IS NULL');
    if (status === 'gone') where.push('gone_from_ac_at IS NOT NULL');
    if (linked === 'student') where.push('EXISTS (SELECT 1 FROM program_students p WHERE p.contact_id = contacts.id)');
    if (linked === 'buyer') where.push(`EXISTS (SELECT 1 FROM shop_customers sc JOIN shop_orders o ON o.customer_id = sc.id WHERE sc.email = contacts.email AND contacts.email <> '' AND o.paid_total > 0)`);
    if (linked === 'learning') where.push(`EXISTS (SELECT 1 FROM students s WHERE s.ac_contact_id = contacts.ac_id OR (lower(s.email) = contacts.email AND contacts.email <> ''))`);
    const filter = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const [rows, total, all] = await Promise.all([
      db.query(`SELECT ${LIGHT}, (SELECT array_agg(p.id) FROM program_students p WHERE p.contact_id = contacts.id) AS student_ids
                  FROM contacts ${filter} ORDER BY ${SORTS[sort]} LIMIT 100 OFFSET ${offset}`, params),
      db.one(`SELECT count(*)::int AS n FROM contacts ${filter}`, params),
      db.one(`SELECT count(*)::int AS n FROM contacts`),
    ]);
    return { contacts: rows, total: total.n, all: all.n, offset };
  },

  async 'contacts-get'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const c = await db.one(`SELECT * FROM contacts WHERE id = $1`, [id]);
    if (!c) throw userError('contact not found', 404);
    const byEmail = c.email || '\u0000';
    const [orders, learning, students] = await Promise.all([
      db.query(`SELECT o.id, o.number, o.product_name, o.currency, o.total, o.paid_total, o.refunded_total, o.status, o.created_at, o.paid_at
                  FROM shop_orders o JOIN shop_customers sc ON sc.id = o.customer_id WHERE sc.email = $1 ORDER BY o.created_at DESC`, [byEmail]),
      db.query(`SELECT s.id, s.email, s.name, s.status,
                       coalesce(json_agg(json_build_object('cohort', co.name, 'program', sh.title, 'status', en.status) ORDER BY en.id)
                                FILTER (WHERE en.id IS NOT NULL), '[]') AS enrollments
                  FROM students s
                  LEFT JOIN enrollments en ON en.student_id = s.id
                  LEFT JOIN cohorts co ON co.id = en.cohort_id
                  LEFT JOIN shows sh ON sh.id = co.show_id
                 WHERE s.ac_contact_id = $1 OR lower(s.email) = $2
                 GROUP BY s.id ORDER BY s.id`, [c.ac_id, byEmail]),
      db.query(`SELECT id, program, cohort, name, name_en, persona, rating FROM program_students WHERE contact_id = $1 ORDER BY cohort, id`, [id]),
    ]);
    delete c.details_wanted;
    return { contact: c, orders, learning, students };
  },

  async 'contacts-tags'() {
    const tags = await db.query(`SELECT t AS tag, count(*)::int AS n FROM contacts, unnest(tags) t GROUP BY t ORDER BY t`);
    return { tags };
  },

  async 'contacts-sync'() {
    const [runs, state] = await Promise.all([
      db.query(`SELECT started_at, finished_at, trigger, ok, summary, error FROM contact_sync_runs ORDER BY id DESC LIMIT 15`),
      acSync.getState(),
    ]);
    return { connected: acSync.configured(), runs, sweep: sweepInfo(state) };
  },

  async 'contacts-sync-run'() {
    const result = await acSync.sync({ trigger: 'admin', budgetMs: 40000 });
    if (result.skipped) throw userError(result.error, 409);
    // logged only when something happened, so "Keep syncing" doesn't fill the activity log
    const happened = !result.ok || result.recent.added || (result.sweep && (result.sweep.added || result.sweep.done)) || result.details.done;
    return { result, target: 'ActiveCampaign contacts', log: happened ? result : null };
  },
};

function sweepInfo(state) {
  return {
    running: Boolean(state.sweep_started_at),
    offset: state.sweep_offset || 0,
    total: state.sweep_total || null,
    finished_at: state.sweep_finished_at || null,
  };
}

module.exports = { section: 'contacts', actions, writes: ['contacts-sync-run'] };
