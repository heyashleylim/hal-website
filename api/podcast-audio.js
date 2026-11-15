/*
 * GET/HEAD /a/art/<show slug>.<jpg|png> → the program's cover image (public, cached): used by the student area and
 * its lock-screen info. The podcast feed's audio links (/a/<token>/<guid>.<ext>) were retired with the feed on
 * 2026-11-15 and now answer 404.
 */
const { Readable } = require('node:stream');
const blob = require('@vercel/blob');
const db = require('./_lib/db.js');

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Cache-Control', 'no-store');
  res.end('Not found');
}

// GET/HEAD /a/art/<show slug>.<jpg|png> → the show's cover image (public: podcast apps fetch it without a token).
async function artwork(req, res, file) {
  const m = /^([a-z0-9-]+)\.(jpg|png)$/.exec(file);
  if (!m) return notFound(res);
  let show;
  try {
    show = await db.one('SELECT settings FROM shows WHERE slug = $1', [m[1]]);
  } catch (err) {
    console.error('podcast-art', err);
    res.statusCode = 503;
    return res.end();
  }
  const pathname = show && show.settings && show.settings.artwork_pathname;
  if (!pathname || !pathname.endsWith('.' + m[2])) return notFound(res);
  try {
    const result = await blob.get(pathname, { access: 'private' });
    if (!result || !result.stream) return notFound(res);
    res.statusCode = 200;
    res.setHeader('Content-Type', result.blob.contentType);
    res.setHeader('Content-Length', String(result.blob.size));
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800'); // URLs carry ?v=, so a new image gets a new URL
    if (req.method === 'HEAD') {
      result.stream.cancel().catch(() => {});
      return res.end();
    }
    Readable.fromWeb(result.stream).pipe(res);
  } catch (err) {
    console.error('podcast-art', pathname, err);
    if (!res.headersSent) {
      res.statusCode = 502;
      return res.end();
    }
    res.destroy(err);
  }
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
  if (params.get('token') === 'art') return artwork(req, res, params.get('file') || '');
  // The podcast feed's audio links (/a/<token>/<guid>.<ext>) were retired with the feed (2026-11-15): students
  // listen in the student area, whose audio is /learn/audio/<guid>.<ext> (checked against the session).
  return notFound(res);
};
