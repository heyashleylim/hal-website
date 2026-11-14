/*
 * Podcast admin API: show settings, artwork and episodes (Podcast section; actions are routed by api/admin.js).
 *
 * Uploads go straight from the browser to the private Blob store, so files of any size skip the
 * 4.5 MB function limit: `upload-url` returns a short-lived signed PUT URL for one new pathname, the
 * browser sends the file there, then `episode-save` / `show-artwork` attach it (after checking it exists).
 */
const chapters = require('../learn/chapters.js');
const crypto = require('node:crypto');
const blob = require('@vercel/blob');
const db = require('../db.js');
const { userError, getShow, text, int, time, email, friendlyUnique } = require('./util.js');

const AUDIO_TYPES = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX_AUDIO = 500 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;
const BLOB_API_VERSION = '12'; // matches @vercel/blob's x-api-version for the pinned version

function showOut(show) {
  return {
    slug: show.slug, title: show.title, description: show.description, author: show.author, owner_email: show.owner_email,
    category: show.category, copyright: show.copyright, release_time: show.release_time, timezone: show.timezone,
    drip_interval_days: show.drip_interval_days, access_days: show.access_days, support_email: show.support_email,
    page_intro: show.page_intro, ac_tag_prefix: show.ac_tag_prefix, artwork_url: show.artwork_url,
  };
}

function episodeOut(e) {
  return {
    id: e.id, guid: e.guid, kind: e.kind, number: e.number, title: e.title, notes: e.notes, day_offset: e.day_offset,
    status: e.status, has_audio: Boolean(e.blob_pathname), bytes: e.bytes == null ? null : Number(e.bytes),
    duration_seconds: e.duration_seconds, mime_type: e.mime_type, updated_at: e.updated_at,
    chapters: Array.isArray(e.chapters) ? e.chapters : [],
  };
}

// The uploaded file must exist in this show's folder; returns its size and type from Blob storage.
async function uploadedFile(show, pathname, kind) {
  const prefix = `${blobRoot()}/${show.slug}/${kind}/`;
  if (typeof pathname !== 'string' || !pathname.startsWith(prefix) || pathname.includes('..')) throw userError('invalid upload');
  let meta;
  try {
    meta = await blob.head(pathname);
  } catch (_) {
    throw userError('the upload was not found; try uploading again');
  }
  return { pathname, size: meta.size, contentType: meta.contentType };
}

// Files uploaded from a preview live under preview/, so a preview never overwrites or deletes production's files
// (both use the same Blob store; a preview database is a copy of production and still points at production's audio).
function blobRoot(env = process.env) {
  return env.VERCEL_ENV === 'preview' ? 'preview/podcast' : 'podcast';
}
function mayDelete(pathname, env = process.env) {
  return env.VERCEL_ENV !== 'preview' || String(pathname).startsWith('preview/');
}

async function deleteQuietly(pathname) {
  if (!pathname || !mayDelete(pathname)) return;
  try {
    await blob.del(pathname);
  } catch (err) {
    console.error('podcast blob delete failed', pathname, err.message);
  }
}

const actions = {
  // All shows, for the show switcher and the Shows page.
  async shows() {
    const rows = await db.query(
      `SELECT s.id, s.slug, s.title, s.artwork_url,
              (SELECT count(*)::int FROM episodes e WHERE e.show_id = s.id) AS episodes,
              (SELECT count(*)::int FROM cohorts c WHERE c.show_id = s.id) AS cohorts,
              (SELECT count(DISTINCT en.student_id)::int FROM enrollments en JOIN cohorts c ON c.id = en.cohort_id WHERE c.show_id = s.id) AS students
         FROM shows s ORDER BY s.id`,
    );
    return { shows: rows };
  },

  // A new show with the default settings; its slug appears in students' feed addresses and can't change later.
  async 'show-create'(input) {
    const title = text(input.title, { max: 200, required: true, label: 'Title' });
    const slug = text(input.slug, { max: 40, required: true, label: 'Short name' }).toLowerCase();
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) throw userError('Short name: lowercase letters, digits and dashes (e.g. eft or switch)');
    const row = await friendlyUnique(
      db.one(`INSERT INTO shows (slug, title, ac_tag_prefix) VALUES ($1, $2, $3) RETURNING *`, [slug, title, `podcast_${slug.replace(/-/g, '_')}`]),
      { shows_slug_key: `a program with the short name "${slug}" already exists` },
    );
    return { show: showOut(row), target: `show ${slug}` };
  },

  // Deletes a program with everything in it: episodes and their audio, cover art, cohorts, enrolments, release dates,
  // listening history and pending AC updates (the database cascades from shows). Students stay (their other programs
  // are untouched). Asks for the short name as confirmation; the last program can't be deleted.
  async 'show-delete'(input) {
    const show = await getShow(input.show);
    if (String(input.confirm || '').trim().toLowerCase() !== show.slug) throw userError(`type the short name "${show.slug}" to confirm`);
    const { n } = await db.one('SELECT count(*)::int AS n FROM shows');
    if (n <= 1) throw userError('this is the only program; create another one before deleting it');
    const counts = await db.one(
      `SELECT (SELECT count(*)::int FROM episodes WHERE show_id = $1) AS episodes,
              (SELECT count(*)::int FROM cohorts WHERE show_id = $1) AS cohorts,
              (SELECT count(*)::int FROM enrollments en JOIN cohorts c ON c.id = en.cohort_id WHERE c.show_id = $1) AS enrollments`,
      [show.id],
    );
    await db.query('DELETE FROM shows WHERE id = $1', [show.id]);
    // Files last: if this fails, the program is already gone and only orphan files remain (logged).
    let files = 0;
    try {
      let cursor;
      do {
        const page = await blob.list({ prefix: `${blobRoot()}/${show.slug}/`, cursor, limit: 1000 });
        if (page.blobs.length) {
          await blob.del(page.blobs.map((b) => b.pathname));
          files += page.blobs.length;
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    } catch (err) {
      console.error('podcast show files delete failed', show.slug, err.message);
    }
    return { deleted: show.slug, counts: { ...counts, files }, target: `show ${show.slug} (${show.title})` };
  },

  async show(input) {
    return { show: showOut(await getShow(input.show)) };
  },

  async 'show-save'(input) {
    const show = await getShow(input.show);
    const v = {
      title: text(input.title, { max: 200, required: true, label: 'Title' }),
      description: text(input.description, { max: 4000, label: 'Description' }),
      author: text(input.author, { max: 200, label: 'Author' }),
      owner_email: email(input.owner_email, { label: 'Owner email', optional: true }),
      category: text(input.category, { max: 100, label: 'Category' }) || 'Education',
      copyright: text(input.copyright, { max: 200, label: 'Copyright' }),
      release_time: time(input.release_time, { label: 'Release time' }),
      drip_interval_days: int(input.drip_interval_days, { min: 0, max: 60, label: 'Days between modules' }),
      access_days: int(input.access_days, { min: 1, max: 3650, label: 'Access length' }),
      support_email: email(input.support_email, { label: 'Support email', optional: true }),
      page_intro: text(input.page_intro, { max: 1000, label: 'Subscribe page intro' }),
      ac_tag_prefix: text(input.ac_tag_prefix, { max: 60, required: true, label: 'AC tag prefix' }),
    };
    if (!/^[a-z0-9_]+$/.test(v.ac_tag_prefix)) throw userError('AC tag prefix: lowercase letters, digits and underscores only (e.g. podcast_nsmb)');
    const keys = Object.keys(v);
    const row = await db.one(
      `UPDATE shows SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
      [show.id, ...keys.map((k) => v[k])],
    );
    return { show: showOut(row), target: `show ${show.slug}` };
  },

  // A signed URL to PUT one new file into the private store (valid 30 minutes, this pathname only).
  async 'upload-url'(input) {
    const show = await getShow(input.show);
    const purpose = input.purpose === 'artwork' ? 'artwork' : 'audio';
    const types = purpose === 'artwork' ? IMAGE_TYPES : AUDIO_TYPES;
    const contentType = String(input.content_type || '');
    if (!types[contentType]) throw userError(purpose === 'artwork' ? 'artwork must be a JPEG or PNG image' : 'audio must be an MP3 or M4A file');
    const size = int(input.size, { min: 1, max: purpose === 'artwork' ? MAX_IMAGE : MAX_AUDIO, label: 'File size' });
    const folder = purpose === 'artwork' ? 'art' : 'audio';
    const pathname = `${blobRoot()}/${show.slug}/${folder}/${crypto.randomUUID()}.${types[contentType]}`;
    const validUntil = Date.now() + 30 * 60 * 1000;
    const token = await blob.issueSignedToken({ pathname, operations: ['put'], validUntil, allowedContentTypes: [contentType], maximumSizeInBytes: size });
    const { presignedUrl } = await blob.presignUrl(token, { operation: 'put', pathname, access: 'private', validUntil, allowedContentTypes: [contentType], maximumSizeInBytes: size });
    return {
      url: presignedUrl,
      pathname,
      headers: {
        'x-api-version': BLOB_API_VERSION,
        'x-vercel-blob-store-id': process.env.BLOB_STORE_ID || '',
        'x-vercel-blob-access': 'private',
        'x-content-type': contentType,
      },
    };
  },

  async 'show-artwork'(input) {
    const show = await getShow(input.show);
    const file = await uploadedFile(show, input.pathname, 'art');
    if (!IMAGE_TYPES[file.contentType]) throw userError('artwork must be a JPEG or PNG image');
    const width = int(input.width, { min: 1, max: 10000, label: 'Width' });
    const height = int(input.height, { min: 1, max: 10000, label: 'Height' });
    if (width !== height || width < 1400 || width > 3000) throw userError('artwork must be square, between 1400×1400 and 3000×3000 pixels (Apple Podcasts requirement)');
    const settings = show.settings || {};
    const old = settings.artwork_pathname;
    const url = `/a/art/${show.slug}.${IMAGE_TYPES[file.contentType]}?v=${Date.now()}`;
    await db.query(`UPDATE shows SET artwork_url = $2, settings = settings || $3::jsonb, updated_at = now() WHERE id = $1`, [show.id, url, JSON.stringify({ artwork_pathname: file.pathname })]);
    if (old && old !== file.pathname) await deleteQuietly(old);
    return { artwork_url: url, target: `show ${show.slug}` };
  },

  async episodes(input) {
    const show = await getShow(input.show);
    const rows = await db.query(`SELECT * FROM episodes WHERE show_id = $1 ORDER BY day_offset, number NULLS LAST, id`, [show.id]);
    return { episodes: rows.map(episodeOut), drip_interval_days: show.drip_interval_days };
  },

  // Creates or updates an episode. `pathname` (from upload-url) attaches new audio and replaces the old file.
  async 'episode-save'(input) {
    const show = await getShow(input.show);
    const id = input.id ? int(input.id, { min: 1, max: 2147483647, label: 'id' }) : null;
    const existing = id ? await db.one('SELECT * FROM episodes WHERE id = $1 AND show_id = $2', [id, show.id]) : null;
    if (id && !existing) throw userError('episode not found', 404);

    const kind = input.kind === 'bonus' ? 'bonus' : 'module';
    const number = kind === 'module' ? int(input.number, { min: 1, max: 999, label: 'Module number' }) : null;
    const title = text(input.title, { max: 300, required: true, label: 'Title' });
    const notes = text(input.notes, { max: 10000, label: 'Show notes' });
    const dayOffset = int(input.day_offset, { min: 0, max: 3650, label: 'Release day' });
    const status = input.status === 'published' ? 'published' : 'draft';

    let audio = null;
    if (input.pathname) {
      audio = await uploadedFile(show, input.pathname, 'audio');
      if (!AUDIO_TYPES[audio.contentType]) throw userError('audio must be an MP3 or M4A file');
    }
    if (status === 'published' && !audio && !(existing && existing.blob_pathname)) throw userError('add the audio file before publishing');
    const duration = input.duration_seconds === '' || input.duration_seconds == null ? null : int(input.duration_seconds, { min: 1, max: 86400, label: 'Duration' });

    const fields = { kind, number, title, notes, day_offset: dayOffset, status };
    if (audio) Object.assign(fields, { blob_pathname: audio.pathname, bytes: audio.size, mime_type: audio.contentType, duration_seconds: duration });
    // Chapters made in Podcast Studio are inside the MP3 (ID3): read them from the new file for the student area.
    if (audio && audio.contentType === 'audio/mpeg') {
      fields.chapters = JSON.stringify(await chapters.readFromBlob(audio.pathname).catch((err) => {
        console.error('podcast chapters', audio.pathname, err.message);
        return [];
      }));
    }
    else if (duration) fields.duration_seconds = duration;

    const keys = Object.keys(fields);
    const values = keys.map((k) => fields[k]);
    const row = await friendlyUnique(
      existing
        ? db.one(`UPDATE episodes SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, [existing.id, ...values])
        : db.one(`INSERT INTO episodes (show_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [show.id, ...values]),
      { episodes_module_number: `module ${number} already exists` },
    );
    if (audio && existing && existing.blob_pathname && existing.blob_pathname !== audio.pathname) await deleteQuietly(existing.blob_pathname);
    return { episode: episodeOut(row), target: `episode ${row.id}` };
  },

  async 'episode-delete'(input) {
    const show = await getShow(input.show);
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const row = await db.one('DELETE FROM episodes WHERE id = $1 AND show_id = $2 RETURNING *', [id, show.id]);
    if (!row) throw userError('episode not found', 404);
    await deleteQuietly(row.blob_pathname);
    return { deleted: id, target: `episode ${id} (${row.title})` };
  },

  // A temporary (1 hour) link to listen to an episode in the admin, whatever its status.
  async 'episode-preview'(input) {
    const show = await getShow(input.show);
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const row = await db.one('SELECT blob_pathname FROM episodes WHERE id = $1 AND show_id = $2', [id, show.id]);
    if (!row || !row.blob_pathname) throw userError('no audio for this episode', 404);
    const validUntil = Date.now() + 60 * 60 * 1000;
    const token = await blob.issueSignedToken({ pathname: row.blob_pathname, operations: ['get'], validUntil });
    const { presignedUrl } = await blob.presignUrl(token, { operation: 'get', pathname: row.blob_pathname, access: 'private', validUntil });
    return { url: presignedUrl };
  },

  // Every MP3 episode of the program without chapters: read them from the file (once, after the update that added
  // chapters; later uploads read them by themselves). Stops after ~40 s; run again to continue.
  async 'episodes-chapters-read'(input) {
    const show = await getShow(input.show);
    const rows = await db.query(`SELECT id, blob_pathname FROM episodes WHERE show_id = $1 AND mime_type = 'audio/mpeg' AND blob_pathname IS NOT NULL AND chapters = '[]'::jsonb ORDER BY id`, [show.id]);
    const started = Date.now();
    let read = 0, found = 0;
    for (const row of rows) {
      if (Date.now() - started > 40000) break;
      const list = await chapters.readFromBlob(row.blob_pathname).catch((err) => {
        console.error('podcast chapters', row.blob_pathname, err.message);
        return [];
      });
      if (list.length) {
        await db.query('UPDATE episodes SET chapters = $2, updated_at = now() WHERE id = $1', [row.id, JSON.stringify(list)]);
        found++;
      }
      read++;
    }
    return { read, found, left: rows.length - read, target: `chapters read for ${found} of ${read} episodes` };
  },

  // An episode's chapters (student area): `reread` reads them again from the MP3's ID3 tag; otherwise `chapters`
  // ([{ start, title }], or "M:SS Title" lines) replaces them, e.g. to fix a title without re-uploading.
  async 'episode-chapters'(input) {
    const show = await getShow(input.show);
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const row = await db.one('SELECT * FROM episodes WHERE id = $1 AND show_id = $2', [id, show.id]);
    if (!row) throw userError('episode not found', 404);
    let list;
    if (input.reread) {
      if (!row.blob_pathname || row.mime_type !== 'audio/mpeg') throw userError('chapters can only be read from an MP3 file');
      list = await chapters.readFromBlob(row.blob_pathname);
    } else {
      list = typeof input.chapters === 'string' ? chapters.fromLines(input.chapters) : input.chapters;
      if (!Array.isArray(list) || list.length > 200) throw userError('chapters: one per line, e.g. "12:30 Title"');
      list = chapters.clean(list, Number(row.duration_seconds) || null);
    }
    const saved = await db.one('UPDATE episodes SET chapters = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, JSON.stringify(list)]);
    return { episode: episodeOut(saved), target: `episode ${id} chapters (${list.length})` };
  },
};

const writes = ['show-create', 'show-save', 'show-delete', 'upload-url', 'show-artwork', 'episode-save', 'episode-delete', 'episode-chapters', 'episodes-chapters-read'];

module.exports = { section: 'podcast', actions, writes, AUDIO_TYPES, IMAGE_TYPES, blobRoot, mayDelete };
