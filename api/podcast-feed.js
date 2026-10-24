/*
 * GET /f/<token> → this student's private podcast feed (rewrite in vercel.json).
 *
 * Unknown token: 404. Revoked, expired or not yet in a cohort: a valid feed with no episodes and a notice.
 * The CDN keeps each feed for 5 minutes (the URL contains the secret token, so only its owner gets it),
 * which keeps database reads low while podcast apps poll. Releases and revocations show up within 5 minutes.
 * The first request from a podcast app marks the student as subscribed (first_seen_at); feed checks are
 * logged at most once an hour per student.
 */
const crypto = require('node:crypto');
const db = require('./_lib/db.js');
const podcast = require('./_lib/podcast.js');
const { buildFeed } = require('./_lib/rss.js');

const LOG_EVERY_MS = 60 * 60 * 1000;

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }

  const token = new URL(req.url, 'http://local').searchParams.get('token') || '';
  let ctx;
  try {
    ctx = await podcast.loadByToken(token);
  } catch (err) {
    console.error('podcast-feed', err);
    res.statusCode = 503;
    res.setHeader('Retry-After', '300');
    return res.end('Temporarily unavailable');
  }
  if (!ctx) {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'public, s-maxage=300, max-age=0');
    return res.end('Not found');
  }

  const now = new Date();
  const { state, episodes } = podcast.releasedFor(ctx, now);
  const xml = buildFeed({ base: podcast.baseUrl(req), show: ctx.show, listener: ctx.listener, state, items: episodes, now, query: podcast.linkQuery() });

  const client = podcast.clientInfo(req);
  const { listener } = ctx;
  const lastSeen = listener.last_seen_at ? new Date(listener.last_seen_at) : null;
  if (client.app !== 'Bot' && client.app !== 'Web browser') {
    if (!lastSeen || now - lastSeen > LOG_EVERY_MS) {
      await podcast.logEvent(listener.id, 'feed', null, client);
      await db.query('UPDATE listeners SET first_seen_at = COALESCE(first_seen_at, now()), last_seen_at = now() WHERE id = $1', [listener.id]).catch((err) => console.error('podcast-feed seen', err.message));
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
