/*
 * Streams an episode's audio from the private Blob store, passing byte ranges through (Apple Podcasts and
 * browsers need them). Used by the podcast feed's audio route (/a/<token>/…) and the student area (/learn/audio/…).
 * The caller has already checked access.
 */
const { Readable } = require('node:stream');
const blob = require('@vercel/blob');
const { extension } = require('./rss.js');

function filenameFor(episode) {
  const ext = extension(episode.mime_type);
  return episode.kind === 'module' && episode.number ? `module-${String(episode.number).padStart(2, '0')}.${ext}` : `episode.${ext}`;
}

async function streamEpisode(req, res, episode, { cache = 'private, max-age=86400' } = {}) {
  res.setHeader('Content-Type', episode.mime_type || 'audio/mpeg');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', cache);
  res.setHeader('Content-Disposition', `inline; filename="${filenameFor(episode)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (req.method === 'HEAD') {
      const meta = await blob.head(episode.blob_pathname);
      res.statusCode = 200;
      res.setHeader('Content-Length', String(meta.size));
      return res.end();
    }
    const range = req.headers.range;
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
    if (!result || !result.stream) {
      res.statusCode = 404;
      res.removeHeader('Content-Disposition');
      return res.end('Not found');
    }
    const contentRange = result.headers.get('content-range');
    res.statusCode = contentRange ? 206 : 200;
    for (const name of ['content-length', 'content-range', 'etag', 'last-modified']) {
      const value = result.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    const body = Readable.fromWeb(result.stream);
    res.on('close', () => body.destroy());
    body.on('error', (err) => {
      console.error('audio stream', err.message);
      res.destroy(err);
    });
    body.pipe(res);
  } catch (err) {
    console.error('audio', episode.blob_pathname, err);
    if (!res.headersSent) {
      res.statusCode = 502;
      res.removeHeader('Content-Disposition');
      return res.end();
    }
    res.destroy(err);
  }
}

module.exports = { streamEpisode, filenameFor };
