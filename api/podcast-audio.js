/*
 * GET/HEAD /a/<token>/<episode guid>.<ext> → the episode's audio, streamed from the private Blob store
 * (rewrite in vercel.json).
 *
 * Access is checked on every request: the student must be active and the episode released for them,
 * otherwise 404. Byte ranges are passed through to Blob storage (Apple Podcasts requires them).
 * A download is logged when a request starts at byte 0 and isn't a tiny probe (apps first ask for
 * a couple of bytes to read the file size); counting rules are applied later in analytics.
 *
 * Also serves the show artwork at /a/art/<slug>.<ext> (public, cached).
 */
const { Readable } = require('node:stream');
const blob = require('@vercel/blob');
const db = require('./_lib/db.js');
const podcast = require('./_lib/podcast.js');
const { extension } = require('./_lib/rss.js');

const PROBE_BYTES = 64 * 1024;

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Cache-Control', 'no-store');
  res.end('Not found');
}

// Should this request count as a download? (no Range, or a Range from 0 that asks for more than a probe)
function isDownloadStart(range) {
  if (!range) return true;
  const m = /^bytes=(\d+)-(\d*)$/.exec(range.trim());
  if (!m || m[1] !== '0') return false;
  return m[2] === '' || Number(m[2]) + 1 >= PROBE_BYTES;
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
  const token = params.get('token') || '';
  if (token === 'art') return artwork(req, res, params.get('file') || '');
  const m = /^([0-9a-f-]{36})\.([a-z0-9]{2,4})$/.exec(params.get('file') || '');
  if (!m) return notFound(res);

  let ctx;
  try {
    ctx = await podcast.loadByToken(token);
  } catch (err) {
    console.error('podcast-audio', err);
    res.statusCode = 503;
    res.setHeader('Retry-After', '60');
    return res.end();
  }
  if (!ctx) return notFound(res);
  const { state, episodes } = podcast.releasedFor(ctx);
  const item = state === 'active' && episodes.find((e) => e.episode.guid === m[1]);
  if (!item) return notFound(res);
  const episode = item.episode;
  if (extension(episode.mime_type) !== m[2]) return notFound(res);

  const filename = episode.kind === 'module' && episode.number ? `module-${String(episode.number).padStart(2, '0')}.${m[2]}` : `episode.${m[2]}`;
  res.setHeader('Content-Type', episode.mime_type || 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  try {
    if (req.method === 'HEAD') {
      const meta = await blob.head(episode.blob_pathname);
      res.statusCode = 200;
      res.setHeader('Content-Length', String(meta.size));
      return res.end();
    }

    const range = req.headers.range;
    if (isDownloadStart(range)) await podcast.logEvent(ctx.listener.id, 'download', episode.id, podcast.clientInfo(req));

    let result;
    try {
      result = await blob.get(episode.blob_pathname, { access: 'private', headers: range ? { Range: range } : {} });
    } catch (err) {
      if (/\b416\b/.test(err.message)) {
        res.statusCode = 416;
        if (episode.bytes) res.setHeader('Content-Range', `bytes */${episode.bytes}`);
        return res.end();
      }
      throw err;
    }
    if (!result || !result.stream) return notFound(res);

    const contentRange = result.headers.get('content-range');
    res.statusCode = contentRange ? 206 : 200;
    for (const name of ['content-length', 'content-range', 'etag', 'last-modified']) {
      const value = result.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    const body = Readable.fromWeb(result.stream);
    res.on('close', () => body.destroy());
    body.on('error', (err) => {
      console.error('podcast-audio stream', err.message);
      res.destroy(err);
    });
    body.pipe(res);
  } catch (err) {
    console.error('podcast-audio', episode.blob_pathname, err);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.removeHeader('Content-Disposition');
      return res.end();
    }
    res.destroy(err);
  }
};

module.exports.isDownloadStart = isDownloadStart;
