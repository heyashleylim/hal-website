/*
 * Shared by the student-facing podcast functions (personal page, feeds, audio): loading a student and their
 * shows by token, computing what they can hear (release.showAccess), recognising podcast apps, logging requests.
 *
 * A student has one personal token. Their page is /podcast/<token>; each show they're enrolled in has its own
 * feed /f/<token>/<show slug>; audio is /a/<token>/<episode guid>.<ext> (the guid identifies the show).
 */
const db = require('./db.js');
const auth = require('./auth.js');
const release = require('./release.js');

const COHORT_JSON = `json_build_object('id', c.id, 'show_id', c.show_id, 'name', c.name, 'start_date', to_char(c.start_date, 'YYYY-MM-DD'), 'access_days', c.access_days)`;

// The student and, for every show they're enrolled in, the show and its enrolments. Null for an unknown token.
async function loadStudent(token) {
  if (!auth.isToken(token)) return null;
  const student = await db.one('SELECT * FROM students WHERE token = $1', [token]);
  if (!student) return null;
  const rows = await db.query(
    `SELECT row_to_json(en) AS enrollment, ${COHORT_JSON} AS cohort, row_to_json(sh) AS show
       FROM enrollments en JOIN cohorts c ON c.id = en.cohort_id JOIN shows sh ON sh.id = c.show_id
      WHERE en.student_id = $1
      ORDER BY sh.id, c.start_date`,
    [student.id],
  );
  const shows = new Map();
  for (const r of rows) {
    if (!shows.has(r.show.id)) shows.set(r.show.id, { show: r.show, enrollments: [] });
    shows.get(r.show.id).enrollments.push({ enrollment: r.enrollment, cohort: r.cohort });
  }
  return { student, shows: [...shows.values()] };
}

// What this student can hear in one show right now: { state, episodes, next, expires, scheduled }.
async function showAccess(student, entry, now = new Date()) {
  const cohortIds = entry.enrollments.map((x) => x.cohort.id);
  const [episodes, overrideRows] = await Promise.all([
    db.query(`SELECT * FROM episodes WHERE show_id = $1 AND status = 'published' AND blob_pathname IS NOT NULL`, [entry.show.id]),
    cohortIds.length ? db.query('SELECT cohort_id, episode_id, release_at FROM cohort_episode_dates WHERE cohort_id = ANY($1::int[])', [cohortIds]) : [],
  ]);
  const byCohort = new Map();
  for (const r of overrideRows) {
    if (!byCohort.has(r.cohort_id)) byCohort.set(r.cohort_id, new Map());
    byCohort.get(r.cohort_id).set(r.episode_id, new Date(r.release_at));
  }
  return release.showAccess({
    show: entry.show, student, enrollments: entry.enrollments, episodes, now,
    overridesFor: (cohort) => byCohort.get(cohort.id) || new Map(),
  });
}

// Servers of podcast apps (they fetch the feed or audio for their own processing) count as "(server)", not as the student.
const APPS = [
  [/WordPress\.com - Audio/i, 'Pocket Casts (server)'],
  [/overcast/i, 'Overcast'],
  [/pocket ?casts/i, 'Pocket Casts'],
  [/castro/i, 'Castro'],
  [/podcastaddict|podcast addict/i, 'Podcast Addict'],
  [/antennapod/i, 'AntennaPod'],
  [/castbox/i, 'Castbox'],
  [/podbbang|팟빵/i, 'Podbbang'],
  [/youtube ?music|com\.google\.android\.apps\.youtube\.music/i, 'YouTube Music'],
  [/spotify/i, 'Spotify'],
  [/^Podcasts\/|AppleCoreMedia|iTMS|Apple ?Podcasts|watchOS/i, 'Apple Podcasts'],
  [/bot|crawler|spider|curl|wget|python|go-http|feedfetcher|Vercel MCP Fetch/i, 'Bot'],
  [/mozilla/i, 'Web browser'],
];

function appName(userAgent) {
  const ua = userAgent || '';
  for (const [re, name] of APPS) if (re.test(ua)) return name;
  return ua ? 'Other' : 'Unknown';
}

function clientInfo(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  return { ua, app: appName(ua), ipHash: auth.ipHash(ip), country: req.headers['x-vercel-ip-country'] || null };
}

// Never let logging break the student's request.
async function logEvent({ studentId, showId, episodeId = null, kind, client }) {
  try {
    await db.query(
      'INSERT INTO events (student_id, show_id, episode_id, kind, app, user_agent, ip_hash, country) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [studentId, showId, episodeId, kind, client.app, client.ua, client.ipHash, client.country],
    );
  } catch (err) {
    console.error('podcast event log failed', err.message);
  }
}

function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

// Preview deployments sit behind Vercel's login, which podcast apps can't pass. There, feed and audio links
// carry the project's "Protection Bypass for Automation" secret (Settings → Deployment Protection).
// Production links never do.
function linkQuery(env = process.env) {
  const secret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return env.VERCEL_ENV === 'preview' && secret ? `?x-vercel-protection-bypass=${encodeURIComponent(secret)}` : '';
}

module.exports = { loadStudent, showAccess, appName, clientInfo, logEvent, baseUrl, linkQuery };
