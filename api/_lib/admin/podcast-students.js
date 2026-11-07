/*
 * Admin API, Podcast section: students (people), their enrolments (one per cohort, any program), CSV import and
 * Sync from ActiveCampaign. Actions are routed by api/admin.js.
 *
 * A student has one personal link (/podcast/<token>) listing every show they're enrolled in.
 * What they can hear in a show follows release.showAccess (all their running enrolments in that show combined).
 */
const db = require('../db.js');
const auth = require('../auth.js');
const ac = require('../ac.js');
const release = require('../release.js');
const automation = require('../automation.js');
const { userError, getShow, text, int, date, email, friendlyUnique } = require('./util.js');

const MAX_IDS = 1000;

// "Tell ActiveCampaign" (input.notify): fill the link field and add <prefix>_enrolled for these new enrolments,
// then send what fits in a few seconds (the rest goes with the next send or the daily job).
async function notifyNew(pairs, input) {
  if (!input.notify || !pairs.length) return null;
  for (const [studentId, showId] of pairs) await automation.notifyEnrolled(studentId, showId);
  return automation.acConfigured() ? automation.processOutbox({ budgetMs: 8000 }) : { skipped: 'ActiveCampaign is not configured: the updates wait in the queue' };
}
const NOT_A_PERSON = `e.app NOT IN ('Bot', 'Web browser', 'Unknown', 'Other') AND e.app NOT LIKE '%(server)'`;

function baseUrl(req) {
  return `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

function idList(value, label = 'id') {
  const list = (Array.isArray(value) ? value : [value]).map((v) => int(v, { min: 1, max: 2147483647, label }));
  if (!list.length) throw userError('select at least one');
  if (list.length > MAX_IDS) throw userError(`at most ${MAX_IDS} at once`);
  return [...new Set(list)];
}

function target(kind, list) {
  return list.length === 1 ? `${kind} ${list[0]}` : `${list.length} ${kind}s`;
}

// "Access until" is the last day (inclusive) in the show's timezone; stored as the instant access ends.
function accessEnd(show, lastDay) {
  return release.zonedTime(release.addDays(date(lastDay, { label: 'Access until' }), 1), '00:00', show.timezone);
}

// Shows, their published episodes and every cohort's date changes, loaded once.
async function context() {
  const [shows, episodes, overrideRows] = await Promise.all([
    db.query('SELECT * FROM shows ORDER BY id'),
    db.query(`SELECT id, show_id, kind, number, day_offset, status, blob_pathname FROM episodes WHERE status = 'published' AND blob_pathname IS NOT NULL`),
    db.query('SELECT cohort_id, episode_id, release_at FROM cohort_episode_dates'),
  ]);
  const byCohort = new Map();
  for (const r of overrideRows) {
    if (!byCohort.has(r.cohort_id)) byCohort.set(r.cohort_id, new Map());
    byCohort.get(r.cohort_id).set(r.episode_id, new Date(r.release_at));
  }
  return {
    shows: new Map(shows.map((s) => [s.id, s])),
    episodesOf: (showId) => episodes.filter((e) => e.show_id === showId),
    overridesFor: (cohort) => byCohort.get(cohort.id) || new Map(),
  };
}

const STUDENT_SQL = `
  WITH d AS (
    SELECT e.student_id,
           count(DISTINCT e.episode_id) FILTER (WHERE e.kind = 'download' AND ${NOT_A_PERSON}) AS downloaded,
           max(e.at) FILTER (WHERE e.kind = 'download' AND ${NOT_A_PERSON}) AS last_download_at,
           array_agg(DISTINCT e.app) FILTER (WHERE ${NOT_A_PERSON}) AS apps
      FROM events e GROUP BY e.student_id),
  en AS (
    SELECT en.student_id, json_agg(json_build_object(
             'id', en.id, 'status', en.status, 'source', en.source, 'start_override', to_char(en.start_override, 'YYYY-MM-DD'),
             'expires_override', en.expires_override, 'created_at', en.created_at, 'revoked_at', en.revoked_at,
             'cohort', json_build_object('id', c.id, 'show_id', c.show_id, 'name', c.name, 'ac_tag', c.ac_tag,
                                         'start_date', to_char(c.start_date, 'YYYY-MM-DD'), 'access_days', c.access_days))
             ORDER BY c.show_id, c.start_date) AS enrollments
      FROM enrollments en JOIN cohorts c ON c.id = en.cohort_id GROUP BY en.student_id)
  SELECT row_to_json(st) AS student, COALESCE(en.enrollments, '[]'::json) AS enrollments, d.downloaded, d.last_download_at, d.apps
    FROM students st LEFT JOIN en ON en.student_id = st.id LEFT JOIN d ON d.student_id = st.id`;

// Everything the list and the detail show about one student.
function describe(ctx, row, req, now = new Date()) {
  const s = row.student;
  const byShow = new Map();
  for (const en of row.enrollments) {
    if (!byShow.has(en.cohort.show_id)) byShow.set(en.cohort.show_id, []);
    byShow.get(en.cohort.show_id).push(en);
  }
  let released = 0, latest = null;
  const shows = [];
  for (const [showId, list] of byShow) {
    const show = ctx.shows.get(showId);
    const access = release.showAccess({
      show, student: s, enrollments: list.map((en) => ({ enrollment: en, cohort: en.cohort })),
      episodes: ctx.episodesOf(showId), overridesFor: ctx.overridesFor, now,
    });
    released += access.episodes.length;
    if (access.expires && (!latest || access.expires > latest)) latest = access.expires;
    shows.push({ id: show.id, slug: show.slug, title: show.title, state: access.state, released: access.episodes.length, next_release: access.next ? access.next.releaseAt : null, expires_at: access.expires });
  }
  const enrollments = row.enrollments.map((en) => {
    const show = ctx.shows.get(en.cohort.show_id);
    const state = en.status === 'revoked' ? 'revoked' : release.accessState({ show, cohort: en.cohort, listener: { ...en, status: 'active' }, now });
    return { ...en, show: { id: show.id, slug: show.slug, title: show.title }, state, expires_at: release.expiresAt({ show, cohort: en.cohort, listener: en }) };
  });
  const state = s.status === 'revoked' ? 'revoked' : !shows.length ? 'not-enrolled' : shows.some((x) => x.state === 'active') ? 'active' : shows.every((x) => x.state === 'revoked') ? 'revoked' : 'expired';
  return {
    id: s.id, email: s.email, name: s.name, notes: s.notes, status: s.status, state,
    ac_contact_id: s.ac_contact_id, first_seen_at: s.first_seen_at, last_seen_at: s.last_seen_at,
    created_at: s.created_at, revoked_at: s.revoked_at,
    enrollments, shows, released, expires_at: latest,
    downloaded: Number(row.downloaded || 0), last_download_at: row.last_download_at, apps: row.apps || [],
    page_url: `${baseUrl(req)}/podcast/${s.token}`,
  };
}

async function loadRow(id) {
  const row = await db.one(`${STUDENT_SQL} WHERE st.id = $1`, [id]);
  if (!row) throw userError('student not found', 404);
  return row;
}

async function cohortById(id) {
  const c = await db.one('SELECT c.*, s.slug AS show_slug FROM cohorts c JOIN shows s ON s.id = c.show_id WHERE c.id = $1', [int(id, { min: 1, max: 2147483647, label: 'cohort' })]);
  if (!c) throw userError('cohort not found');
  return c;
}

// Minimal CSV parser (quotes, doubled quotes, commas/semicolons/tabs, CRLF). Returns rows of strings.
function parseCsv(textIn) {
  const rows = [];
  let row = [], field = '', quoted = false;
  const s = String(textIn || '').replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const actions = {
  async students(input, { req }) {
    const [rows, ctx] = await Promise.all([db.query(`${STUDENT_SQL} ORDER BY st.created_at DESC`), context()]);
    const now = new Date();
    const cohorts = await db.query(`SELECT c.id, c.name, c.ac_tag, c.show_id, s.slug AS show_slug, s.title AS show_title FROM cohorts c JOIN shows s ON s.id = c.show_id ORDER BY s.id, c.start_date DESC`);
    return { students: rows.map((r) => describe(ctx, r, req, now)), cohorts, shows: [...ctx.shows.values()].map((s) => ({ id: s.id, slug: s.slug, title: s.title })) };
  },

  async student(input, { req }) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const [row, ctx] = await Promise.all([loadRow(id), context()]);
    const [events, networks, outbox, history] = await Promise.all([
      db.query(
        `SELECT e.kind, e.at, e.app, e.country, sh.title AS show_title, ep.kind AS episode_kind, ep.number, ep.title
           FROM events e LEFT JOIN episodes ep ON ep.id = e.episode_id LEFT JOIN shows sh ON sh.id = e.show_id
          WHERE e.student_id = $1 ORDER BY e.at DESC LIMIT 200`, [id]),
      // Feed checks come from the apps' servers; downloads come from the student's phone.
      db.one(
        `SELECT count(DISTINCT ip_hash) FILTER (WHERE at > now() - interval '7 days')::int AS networks_7d,
                count(DISTINCT ip_hash)::int AS networks_all,
                array_remove(array_agg(DISTINCT country), NULL) AS countries
           FROM events e WHERE student_id = $1 AND kind = 'download' AND ${NOT_A_PERSON}`, [id]),
      db.query(`SELECT op, payload, status, attempts, last_error, created_at, done_at FROM ac_outbox WHERE student_id = $1 ORDER BY created_at DESC LIMIT 50`, [id]),
      db.query(`SELECT at, admin, action, details FROM admin_log WHERE target = $1 ORDER BY at DESC LIMIT 50`, [`student ${id}`]),
    ]);
    return { student: describe(ctx, row, req), events, networks, outbox, history };
  },

  // Create (no id) or update a student. On create, `cohort_id` (optional) enrols them at once.
  async 'student-save'(input, { req }) {
    const id = input.id ? int(input.id, { min: 1, max: 2147483647, label: 'id' }) : null;
    if (id) await loadRow(id);
    const fields = {
      email: email(input.email, { label: 'Email' }),
      name: text(input.name, { max: 100, label: 'Name' }),
      notes: text(input.notes, { max: 2000, label: 'Notes' }),
    };
    const cohort = !id && input.cohort_id ? await cohortById(input.cohort_id) : null;
    const keys = Object.keys(fields);
    const values = keys.map((k) => fields[k]);
    const row = await friendlyUnique(
      id
        ? db.one(`UPDATE students SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`, [id, ...values])
        : db.one(`INSERT INTO students (token, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING id`, [auth.newToken(), ...values]),
      { students_email: `${fields.email} is already a student (search for them on this page)` },
    );
    let ac = null;
    if (cohort) {
      const en = await db.one(`INSERT INTO enrollments (student_id, cohort_id, source) VALUES ($1, $2, 'manual') ON CONFLICT DO NOTHING RETURNING id`, [row.id, cohort.id]);
      if (en) ac = await notifyNew([[row.id, cohort.show_id]], input);
    }
    return { student: describe(await context(), await loadRow(row.id), req), ac, target: `student ${row.id}` };
  },

  // Revoke or restore everything for these students (all shows).
  async 'students-status'(input) {
    const list = idList(input.ids, 'student');
    const revoke = input.status === 'revoked';
    const rows = await db.query(
      revoke
        ? `UPDATE students SET status = 'revoked', revoked_at = now(), updated_at = now() WHERE id = ANY($1::int[]) AND status <> 'revoked' RETURNING id`
        : `UPDATE students SET status = 'active', revoked_at = NULL, updated_at = now() WHERE id = ANY($1::int[]) AND status = 'revoked' RETURNING id`,
      [list],
    );
    return { changed: rows.length, target: target('student', list) };
  },

  // Enrol students in a cohort (already enrolled ones are skipped).
  async 'students-enroll'(input) {
    const list = idList(input.ids, 'student');
    const cohort = await cohortById(input.cohort_id);
    const rows = await db.query(
      `INSERT INTO enrollments (student_id, cohort_id, source) SELECT id, $2, 'manual' FROM students WHERE id = ANY($1::int[])
       ON CONFLICT (student_id, cohort_id) DO NOTHING RETURNING id, student_id`, [list, cohort.id]);
    const ac = await notifyNew(rows.map((r) => [r.student_id, cohort.show_id]), input);
    return { added: rows.length, skipped: list.length - rows.length, ac, target: `${target('student', list)} → cohort ${cohort.id} (${cohort.name})` };
  },

  // Create ({student_id, cohort_id}) or update ({id}) one enrolment: own start date, last day of access.
  async 'enrollment-save'(input) {
    let en;
    if (input.id) {
      en = await db.one('SELECT * FROM enrollments WHERE id = $1', [int(input.id, { min: 1, max: 2147483647, label: 'enrolment' })]);
      if (!en) throw userError('enrolment not found', 404);
    } else {
      const studentId = int(input.student_id, { min: 1, max: 2147483647, label: 'student' });
      await loadRow(studentId);
      const cohort = await cohortById(input.cohort_id);
      en = await friendlyUnique(
        db.one(`INSERT INTO enrollments (student_id, cohort_id, source) VALUES ($1, $2, 'manual') RETURNING *`, [studentId, cohort.id]),
        { enrollments_student_id_cohort_id_key: `already enrolled in ${cohort.name}` },
      );
    }
    const cohort = await cohortById(en.cohort_id);
    const show = await db.one('SELECT * FROM shows WHERE id = $1', [cohort.show_id]);
    const ac = input.id ? null : await notifyNew([[en.student_id, show.id]], input);
    const start = input.start_override ? date(input.start_override, { label: 'Own start date' }) : null;
    const end = input.access_until ? accessEnd(show, input.access_until).toISOString() : null;
    await db.query('UPDATE enrollments SET start_override = $2, expires_override = $3, updated_at = now() WHERE id = $1', [en.id, start, end]);
    return { enrollment: en.id, ac, target: `student ${en.student_id}` };
  },

  async 'enrollments-status'(input) {
    const list = idList(input.ids, 'enrolment');
    const revoke = input.status === 'revoked';
    const rows = await db.query(
      revoke
        ? `UPDATE enrollments SET status = 'revoked', revoked_at = now(), updated_at = now() WHERE id = ANY($1::int[]) AND status <> 'revoked' RETURNING student_id`
        : `UPDATE enrollments SET status = 'active', revoked_at = NULL, updated_at = now() WHERE id = ANY($1::int[]) AND status = 'revoked' RETURNING student_id`,
      [list],
    );
    const students = [...new Set(rows.map((r) => r.student_id))];
    return { changed: rows.length, target: students.length === 1 ? `student ${students[0]}` : `${list.length} enrolments` };
  },

  async 'enrollment-delete'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'enrolment' });
    const row = await db.one('DELETE FROM enrollments WHERE id = $1 RETURNING student_id, cohort_id', [id]);
    if (!row) throw userError('enrolment not found', 404);
    return { deleted: id, target: `student ${row.student_id}`, log: { enrollment: id, cohort_id: row.cohort_id } };
  },

  // New personal link: every feed, audio link and the page of the old link stop working at once.
  async 'student-reset-link'(input, { req }) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    await loadRow(id);
    await db.query(`UPDATE students SET token = $2, first_seen_at = NULL, updated_at = now() WHERE id = $1`, [id, auth.newToken()]);
    // AC gets the new link and podcast-link-reset (an automation can email it).
    await automation.pushNewLink(id);
    const ac = automation.acConfigured() ? await automation.processOutbox({ budgetMs: 8000 }) : null;
    return { student: describe(await context(), await loadRow(id), req), ac, target: `student ${id}` };
  },

  async 'student-delete'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const row = await db.one('DELETE FROM students WHERE id = $1 RETURNING email', [id]);
    if (!row) throw userError('student not found', 404);
    return { deleted: id, target: `student ${id} (${row.email})` };
  },

  // CSV with a header row: email (required), name, cohort (a cohort's AC tag, or its name in the selected show).
  // Creates missing students, enrols them; existing students get their name updated and the enrolment added.
  async 'students-import'(input) {
    const show = await getShow(input.show);
    const rows = parseCsv(input.csv);
    if (rows.length < 2) throw userError('the CSV needs a header row and at least one student');
    if (rows.length > 5001) throw userError('at most 5000 students per import');
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (names) => header.findIndex((h) => names.includes(h));
    const ci = { email: col(['email', 'e-mail', '이메일']), name: col(['name', 'first name', 'firstname', '이름']), cohort: col(['cohort', '기수', 'tag', 'ac tag']) };
    if (ci.email < 0) throw userError('no "email" column found in the header row');
    const cohorts = await db.query('SELECT id, show_id, name, ac_tag FROM cohorts');
    const findCohort = (v) => cohorts.find((c) => c.ac_tag.toLowerCase() === v.toLowerCase())
      || cohorts.find((c) => c.show_id === show.id && c.name.toLowerCase() === v.toLowerCase());
    const existing = new Map((await db.query('SELECT id, lower(email) AS email FROM students')).map((r) => [r.email, r.id]));
    const enrolled = new Set((await db.query('SELECT student_id, cohort_id FROM enrollments')).map((r) => `${r.student_id}:${r.cohort_id}`));

    const seen = new Set();
    const report = rows.slice(1).map((r, i) => {
      const out = { line: i + 2, email: (r[ci.email] || '').trim(), name: ci.name >= 0 ? (r[ci.name] || '').trim().slice(0, 100) : undefined, result: '' };
      try { out.email = email(out.email); } catch (_) { out.result = 'error: invalid email'; return out; }
      if (seen.has(out.email)) { out.result = 'error: duplicate in this file'; return out; }
      seen.add(out.email);
      const cohortValue = ci.cohort >= 0 ? (r[ci.cohort] || '').trim() : '';
      if (cohortValue) {
        const c = findCohort(cohortValue);
        if (!c) { out.result = `error: unknown cohort "${cohortValue}"`; return out; }
        out.cohort_id = c.id;
        out.cohort = c.name;
      }
      out.id = existing.get(out.email);
      const parts = [out.id ? 'update' : 'new student'];
      if (out.cohort_id) parts.push(out.id && enrolled.has(`${out.id}:${out.cohort_id}`) ? 'already enrolled' : `enrol in ${out.cohort}`);
      out.result = parts.join(' · ');
      return out;
    });
    const summary = { new: 0, updated: 0, enrolments: 0, errors: 0 };
    report.forEach((r) => {
      if (r.result.startsWith('error')) return summary.errors++;
      if (r.id) summary.updated++; else summary.new++;
      if (/enrol in/.test(r.result)) summary.enrolments++;
    });

    if (!input.dry_run) {
      if (summary.errors) throw userError('fix the errors first (see the preview)');
      const fresh = [];
      for (const r of report) {
        let id = r.id;
        if (!id) id = (await db.one(`INSERT INTO students (email, name, token) VALUES ($1, $2, $3) RETURNING id`, [r.email, r.name || '', auth.newToken()])).id;
        else if (r.name !== undefined && r.name !== '') await db.query('UPDATE students SET name = $2, updated_at = now() WHERE id = $1', [id, r.name]);
        if (r.cohort_id) {
          const en = await db.one(`INSERT INTO enrollments (student_id, cohort_id, source) VALUES ($1, $2, 'import') ON CONFLICT DO NOTHING RETURNING id`, [id, r.cohort_id]);
          if (en) fresh.push([id, cohorts.find((c) => c.id === r.cohort_id).show_id]);
        }
      }
      summary.ac = await notifyNew(fresh, input);
    }
    return {
      dry_run: Boolean(input.dry_run), summary, rows: report.slice(0, 2000).map(({ id, cohort_id, ...r }) => r),
      target: `import (${summary.new} new, ${summary.updated} updated, ${summary.enrolments} enrolments)`,
      log: input.dry_run ? null : { summary }, // never store the CSV (emails) in the activity log
    };
  },

  // For each cohort with an AC tag (this show, or every show with scope "all"): adds the AC contacts that have
  // the tag as students and enrols them; lists students enrolled here who no longer have the tag (for review).
  async 'ac-sync'(input) {
    const shows = input.scope === 'all' ? await db.query('SELECT * FROM shows ORDER BY id') : [await getShow(input.show)];
    const cohorts = await db.query(
      `SELECT c.id, c.name, c.ac_tag, c.show_id, s.title AS show_title FROM cohorts c JOIN shows s ON s.id = c.show_id
        WHERE c.show_id = ANY($1::int[]) AND c.ac_tag <> '' ORDER BY s.id, c.start_date`, [shows.map((s) => s.id)]);
    const report = { cohorts: [], new_students: 0, new_enrolments: 0, already: 0, missing: [] };
    const fresh = [];
    for (const c of cohorts) {
      const line = { id: c.id, name: c.name, show: c.show_title, ac_tag: c.ac_tag, in_ac: 0, added: 0, error: null };
      report.cohorts.push(line);
      let contacts;
      try {
        contacts = await ac.contactsWithTag(c.ac_tag);
      } catch (err) {
        line.error = err.message;
        continue;
      }
      if (contacts === null) { line.error = `the tag "${c.ac_tag}" doesn't exist in ActiveCampaign`; continue; }
      line.in_ac = contacts.length;
      const tagged = new Set(contacts.map((x) => x.email));
      for (const contact of contacts) {
        // The full name is kept in AC's First name (Korean order, e.g. 김지연); Last name only if First name is empty.
        const name = (contact.firstName || contact.lastName || '').trim();
        let student = await db.one('SELECT id, name FROM students WHERE lower(email) = $1', [contact.email]);
        if (!student) {
          student = await db.one(`INSERT INTO students (email, name, token, ac_contact_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id, name`,
            [contact.email, name, auth.newToken(), contact.id]);
          if (!student) student = await db.one('SELECT id, name FROM students WHERE lower(email) = $1', [contact.email]);
          else report.new_students++;
        } else {
          await db.query(`UPDATE students SET ac_contact_id = $2, name = CASE WHEN name = '' THEN $3 ELSE name END WHERE id = $1`, [student.id, contact.id, name]);
        }
        const en = await db.one(`INSERT INTO enrollments (student_id, cohort_id, source) VALUES ($1, $2, 'ac-sync') ON CONFLICT DO NOTHING RETURNING id`, [student.id, c.id]);
        if (en) { line.added++; report.new_enrolments++; fresh.push([student.id, c.show_id]); } else report.already++;
      }
      const enrolledHere = await db.query(
        `SELECT en.id AS enrollment_id, st.id AS student_id, st.email, st.name, en.source FROM enrollments en JOIN students st ON st.id = en.student_id
          WHERE en.cohort_id = $1 AND en.status = 'active' AND st.status = 'active'`, [c.id]);
      for (const x of enrolledHere) if (!tagged.has(x.email.toLowerCase())) report.missing.push({ ...x, cohort: c.name, show: c.show_title });
    }
    report.ac = await notifyNew(fresh, input);
    return {
      ...report,
      target: `${input.scope === 'all' ? 'all shows' : shows[0].slug}: ${report.new_students} new students, ${report.new_enrolments} new enrolments`,
      log: { new_students: report.new_students, new_enrolments: report.new_enrolments, missing: report.missing.length, cohorts: report.cohorts.map((x) => ({ id: x.id, in_ac: x.in_ac, added: x.added, error: x.error })) },
    };
  },
};

// Podcast overview numbers (section home and admin home).
actions['podcast-overview'] = async function podcastOverview() {
  const row = await db.one(
    `SELECT (SELECT count(*)::int FROM shows) AS programs,
            (SELECT count(*)::int FROM episodes WHERE status = 'published') AS episodes,
            (SELECT count(*)::int FROM students) AS students,
            (SELECT count(DISTINCT en.student_id)::int FROM enrollments en JOIN students s ON s.id = en.student_id
              WHERE en.status = 'active' AND s.status = 'active') AS enrolled,
            (SELECT count(*)::int FROM students WHERE first_seen_at IS NOT NULL) AS subscribed,
            (SELECT count(*)::int FROM ac_outbox WHERE status = 'pending') AS ac_pending,
            (SELECT count(*)::int FROM ac_outbox WHERE status = 'failed') AS ac_failed,
            (SELECT max(at) FROM webhook_log) AS last_webhook,
            (SELECT max(at) FROM events WHERE kind = 'download') AS last_download`);
  return { overview: row };
};

const writes = ['student-save', 'students-status', 'students-enroll', 'enrollment-save', 'enrollments-status', 'enrollment-delete',
  'student-reset-link', 'student-delete', 'students-import', 'ac-sync'];

module.exports = { section: 'podcast', actions, writes, parseCsv };
