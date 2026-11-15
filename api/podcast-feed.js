/*
 * GET /f/<token>/<show slug> and /f/<token> (rewrites in vercel.json): the private podcast feed, retired on
 * 2026-11-15 (Alex: students listen in the student area only, no offline listening). A podcast app that still follows
 * a student's feed gets a valid feed with no episodes and a notice pointing to /learn (api/_lib/rss.js closedFeed).
 * Unknown tokens: 404. Nothing is logged and nothing is sent to ActiveCampaign.
 */
const podcast = require('./_lib/podcast.js');
const { closedFeed } = require('./_lib/rss.js');

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }
  const params = new URL(req.url, 'http://local').searchParams;
  let data;
  try {
    data = await podcast.loadStudent(params.get('token') || '');
  } catch (err) {
    console.error('podcast-feed', err);
    res.statusCode = 503;
    res.setHeader('Retry-After', '300');
    return res.end('Temporarily unavailable');
  }
  const slug = params.get('show') || '';
  const entry = data && (slug ? data.shows.find((x) => x.show.slug === slug) : data.shows[0]);
  if (!entry) {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=0');
    return res.end('Not found');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, max-age=0');
  return res.end(req.method === 'HEAD' ? undefined : closedFeed({ base: podcast.baseUrl(req), show: entry.show }));
};
