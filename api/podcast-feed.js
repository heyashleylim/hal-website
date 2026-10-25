/*
 * GET /f/<token>/<show slug> → a student's private feed for one show (rewrite in vercel.json).
 * GET /f/<token> (older links): the student's only show; 404 if they have several.
 *
 * Unknown token or show the student isn't enrolled in: 404. Revoked or expired: a valid feed with no episodes
 * and a notice. The CDN keeps each feed for 5 minutes (the URL contains the secret token, so only its owner
 * gets it), which keeps database reads low while podcast apps poll; releases and revocations show up within
 * 5 minutes. The first request from a podcast app marks the student as subscribed; feed checks are logged at
 * most once an hour per student and show.
 */
const crypto = require('node:crypto');
const db = require('./_lib/db.js');
const podcast = require('./_lib/podcast.js');
const automation = require('./_lib/automation.js');
const { buildFeed } = require('./_lib/rss.js');

const LOG_EVERY_MS = 60 * 60 * 1000;

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=0');
  res.end('Not found');
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }

  const params = new URL(req.url, 'http://local').searchParams;
  const token = params.get('token') || '';
  const slug = params.get('show') || '';
  let data, entry, access;
  const now = new Date();
  try {
    data = await podcast.loadStudent(token);
    if (!data) return notFound(res);
    entry = slug ? data.shows.find((x) => x.show.slug === slug) : data.shows.length === 1 ? data.shows[0] : null;
    if (!entry) return notFound(res);
    access = await podcast.showAccess(data.student, entry, now);
  } catch (err) {
    console.error('podcast-feed', err);
    res.statusCode = 503;
    res.setHeader('Retry-After', '300');
    return res.end('Temporarily unavailable');
  }

  const xml = buildFeed({ base: podcast.baseUrl(req), show: entry.show, token, state: access.state, items: access.episodes, now, query: podcast.linkQuery() });

  const client = podcast.clientInfo(req);
  const { student } = data;
  if (client.app !== 'Bot' && client.app !== 'Web browser') {
    try {
      const last = await db.one(`SELECT max(at) AS at FROM events WHERE student_id = $1 AND show_id = $2 AND kind = 'feed'`, [student.id, entry.show.id]);
      if (!last.at || now - new Date(last.at) > LOG_EVERY_MS) {
        if (!last.at) await automation.onFirstFeed(student.id, entry.show); // queued for AC: <prefix>_subscribed
        await podcast.logEvent({ studentId: student.id, showId: entry.show.id, kind: 'feed', client });
        await db.query('UPDATE students SET first_seen_at = COALESCE(first_seen_at, now()), last_seen_at = now() WHERE id = $1', [student.id]);
      }
    } catch (err) {
      console.error('podcast-feed log', err.message);
    }
  }

  const etag = '"' + crypto.createHash('sha1').update(xml.replace(/<lastBuildDate>.*<\/lastBuildDate>/, '')).digest('base64url') + '"';
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=0, must-revalidate');
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    return res.end();
  }
  res.statusCode = 200;
  return res.end(req.method === 'HEAD' ? undefined : xml);
};
