/*
 * Chapters of an episode, read from the ID3 tag at the start of its MP3 (CHAP frames, as written by Podcast Studio's
 * encode.py through ffmpeg: ID3v2.3, titles in TIT2 sub-frames). Pure parsing: unit-tested in tests/learn/chapters.test.js.
 *
 * Stored on the episode as episodes.chapters = [{ start, title }] (start in seconds, sorted, first one at 0 or later).
 * readFromBlob() fetches only the tag (a few KB at the start of the file), never the whole MP3.
 */

function syncsafe(b, i) {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
}

function u32(b, i) {
  return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
}

// Total size of the ID3v2 tag (header included) from its first 10 bytes, or 0 when the file doesn't start with one.
function tagSize(head) {
  if (!head || head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  return 10 + syncsafe(head, 6) + (head[5] & 0x10 ? 10 : 0);
}

function decodeText(buf) {
  if (!buf.length) return '';
  const enc = buf[0];
  let body = buf.subarray(1);
  let text;
  if (enc === 1 || enc === 2) {
    let le = enc === 1;
    if (enc === 1 && body.length >= 2) {
      if (body[0] === 0xff && body[1] === 0xfe) { le = true; body = body.subarray(2); }
      else if (body[0] === 0xfe && body[1] === 0xff) { le = false; body = body.subarray(2); }
    }
    const even = Buffer.from(body.subarray(0, body.length - (body.length % 2)));
    if (!le) even.swap16();
    text = even.toString('utf16le');
  } else {
    text = Buffer.from(body).toString(enc === 3 ? 'utf8' : 'latin1');
  }
  return text.replace(/\u0000[\s\S]*$/, '').trim();
}

// Frames inside [start, end): [{ id, data }].
function frames(b, start, end, major) {
  const out = [];
  let i = start;
  while (i + 10 <= end) {
    const id = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    if (!/^[A-Z0-9]{4}$/.test(id)) break; // padding
    const size = major === 4 ? syncsafe(b, i + 4) : u32(b, i + 4);
    if (size <= 0 || i + 10 + size > end) break;
    out.push({ id, data: b.subarray(i + 10, i + 10 + size) });
    i += 10 + size;
  }
  return out;
}

// [{ start, title }] from the bytes of an ID3v2 tag (the start of the file). Empty when there are none.
function parse(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const size = tagSize(b);
  if (!size) return [];
  const major = b[3];
  if (major !== 3 && major !== 4) return [];
  if (b[5] & 0x80) return []; // unsynchronised tags aren't written by ffmpeg; skip rather than misread
  let start = 10;
  if (b[5] & 0x40) start += major === 4 ? syncsafe(b, 10) : 4 + u32(b, 10);
  const end = Math.min(size, b.length);
  const list = [];
  for (const f of frames(b, start, end, major)) {
    if (f.id !== 'CHAP') continue;
    const zero = f.data.indexOf(0);
    if (zero < 0 || zero + 17 > f.data.length) continue;
    const startMs = u32(f.data, zero + 1);
    const sub = frames(f.data, zero + 17, f.data.length, major);
    const tit2 = sub.find((x) => x.id === 'TIT2');
    list.push({ start: Math.round(startMs / 100) / 10, title: tit2 ? decodeText(tit2.data) : '' });
  }
  return clean(list);
}

// Sorted, deduplicated, titles trimmed; a missing title becomes "챕터 N". Also validates chapters edited by hand.
function clean(list, duration = null) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((c) => ({ start: Math.max(0, Math.round(Number(c && c.start) * 10) / 10), title: String((c && c.title) || '').trim().slice(0, 200) }))
    .filter((c) => Number.isFinite(c.start) && (!duration || c.start < duration))
    .sort((a, b) => a.start - b.start)
    .filter((c) => (seen.has(c.start) ? false : seen.add(c.start)))
    .map((c, i) => ({ start: c.start, title: c.title || `챕터 ${i + 1}` }));
}

// "0:00 Intro\n12:30 Title" (also H:MM:SS) → [{ start, title }]. Lines that don't start with a time are refused.
function fromLines(textValue) {
  const out = [];
  for (const raw of String(textValue || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)\s+(.+)$/.exec(line);
    if (!m) return null;
    out.push({ start: (Number(m[1]) || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]), title: m[4] });
  }
  return out;
}

// Reads the chapters of a file in the private Blob store (only the ID3 tag is downloaded).
async function readFromBlob(pathname, blob = require('@vercel/blob')) {
  const range = async (from, to) => {
    const r = await blob.get(pathname, { access: 'private', headers: { Range: `bytes=${from}-${to}` } });
    if (!r || !r.stream) return Buffer.alloc(0);
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  };
  const head = await range(0, 9);
  const size = tagSize(head);
  if (!size) return [];
  if (size > 4 * 1024 * 1024) return []; // a tag this large carries pictures, not just chapters: not worth reading
  return parse(await range(0, size - 1));
}

module.exports = { parse, clean, fromLines, tagSize, readFromBlob };
