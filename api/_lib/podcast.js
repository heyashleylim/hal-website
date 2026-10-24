/*
 * Shared by the student-facing podcast functions (feed, audio, subscribe page):
 * loading a student's show/cohort/episodes by token, recognising podcast apps, and logging requests.
 */
const db = require('./db.js');
const auth = require('./auth.js');
const release = require('./release.js');

// Everything needed to answer one student's request, or null for an unknown token.
async function loadByToken(token) {
  if (!auth.isToken(token)) return null;
  const row = await db.one(
    `SELECT row_to_json(l) AS listener, row_to_json(s) AS show, row_to_json(c) AS cohort
       FROM listeners l
       JOIN shows s ON s.id = l.show_id
       LEFT JOIN cohorts c ON c.id = l.cohort_id
      WHERE l.token = $1`,
    [token],
  );
  if (!row) return null;
  const { listener, show, cohort } = row;
  const [episodes, overrideRows] = await Promise.all([
    db.query(`SELECT * FROM episodes WHERE show_id = $1 AND status = 'published' AND blob_pathname IS NOT NULL`, [show.id]),
    cohort ? db.query('SELECT episode_id, release_at FROM cohort_episode_dates WHERE cohort_id = $1', [cohort.id]) : [],
  ]);
  const overrides = new Map(overrideRows.map((r) => [r.episode_id, new Date(r.release_at)]));
  return { listener, show, cohort, episodes, overrides };
}

function releasedFor(ctx, now = new Date()) {
  return release.released({ ...ctx, now });
}

const APPS = [
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
  [/bot|crawler|spider|curl|wget|python|go-http|feedfetcher/i, 'Bot'],
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
async function logEvent(listenerId, kind, episodeId, client) {
  try {
    await db.query(
      'INSERT INTO events (listener_id, episode_id, kind, app, user_agent, ip_hash, country) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [listenerId, episodeId, kind, client.app, client.ua, client.ipHash, client.country],
    );
  } catch (err) {
    console.error('podcast event log failed', err.message);
  }
}

function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}

module.exports = { loadByToken, releasedFor, appName, clientInfo, logEvent, baseUrl };
