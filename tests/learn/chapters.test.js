const test = require('node:test');
const assert = require('node:assert/strict');
const chapters = require('../../api/_lib/learn/chapters.js');

const be32 = (n) => Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const syncsafe = (n) => Buffer.from([(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]);
const frame = (id, data, v4) => Buffer.concat([Buffer.from(id), v4 ? syncsafe(data.length) : be32(data.length), Buffer.from([0, 0]), data]);
const utf16 = (s) => Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(s, 'utf16le'), Buffer.from([0, 0])]);
const utf8 = (s) => Buffer.concat([Buffer.from([3]), Buffer.from(s, 'utf8'), Buffer.from([0])]);
function chap(id, startMs, endMs, title, v4) {
  const body = Buffer.concat([Buffer.from(id + '\0'), be32(startMs), be32(endMs), be32(0xffffffff), be32(0xffffffff), frame('TIT2', v4 ? utf8(title) : utf16(title), v4)]);
  return frame('CHAP', body, v4);
}
function tag(frames, v4, padding = 64) {
  const body = Buffer.concat([...frames, Buffer.alloc(padding)]);
  return Buffer.concat([Buffer.from('ID3'), Buffer.from([v4 ? 4 : 3, 0, 0]), syncsafe(body.length), body]);
}

test('chapters: ID3v2.3 CHAP frames with UTF-16 titles (what Podcast Studio writes), out of order, then audio', () => {
  const bytes = Buffer.concat([
    tag([frame('TIT2', utf16('모듈 1')), chap('ch1', 312400, 600000, '신경계가 먼저인 이유'), chap('ch0', 0, 312400, '들어가며'), frame('CTOC', Buffer.from('toc\0\x03\x02ch0\0ch1\0'))]),
    Buffer.from([0xff, 0xfb, 0x90, 0x00]),
  ]);
  assert.equal(chapters.tagSize(bytes.subarray(0, 10)), bytes.length - 4);
  assert.deepEqual(chapters.parse(bytes), [{ start: 0, title: '들어가며' }, { start: 312.4, title: '신경계가 먼저인 이유' }]);
});

test('chapters: ID3v2.4 (syncsafe sizes, UTF-8) and big-endian UTF-16 without BOM', () => {
  assert.deepEqual(chapters.parse(tag([chap('a', 0, 1000, '시작', true), chap('b', 65000, 90000, '이번 주 과제', true)], true)),
    [{ start: 0, title: '시작' }, { start: 65, title: '이번 주 과제' }]);
  const be = Buffer.concat([Buffer.from([2]), Buffer.from('Hi', 'utf16le').swap16()]);
  const body = Buffer.concat([Buffer.from('c\0'), be32(1500), be32(2000), be32(0), be32(0), frame('TIT2', be)]);
  assert.deepEqual(chapters.parse(tag([frame('CHAP', body)])), [{ start: 1.5, title: 'Hi' }]);
});

test('chapters: files without a tag, or a tag without chapters, have none; broken frames are skipped', () => {
  assert.deepEqual(chapters.parse(Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4, 5, 6])), []);
  assert.deepEqual(chapters.parse(tag([frame('TIT2', utf16('x'))])), []);
  assert.deepEqual(chapters.parse(Buffer.from('ID3')), []);
  const broken = tag([frame('CHAP', Buffer.from('no-terminator'))]);
  assert.deepEqual(chapters.parse(broken), []);
  assert.equal(chapters.tagSize(Buffer.from('RIFF....WAVE')), 0);
});

test('chapters: a missing title is named, duplicates and times past the end are dropped', () => {
  assert.deepEqual(chapters.clean([{ start: 30, title: ' ' }, { start: 0, title: '처음' }, { start: 30, title: 'dup' }, { start: 999, title: 'late' }], 600),
    [{ start: 0, title: '처음' }, { start: 30, title: '챕터 2' }]);
  assert.deepEqual(chapters.clean('nope'), []);
});

test('chapters typed in the admin: "M:SS Title" and "H:MM:SS Title" lines; anything else is refused', () => {
  assert.deepEqual(chapters.fromLines('0:00 들어가며\n\n 12:30 신경계가 먼저인 이유 \n1:02:03.5 마무리'),
    [{ start: 0, title: '들어가며' }, { start: 750, title: '신경계가 먼저인 이유' }, { start: 3723.5, title: '마무리' }]);
  assert.equal(chapters.fromLines('들어가며'), null);
  assert.deepEqual(chapters.fromLines(''), []);
});

test('chapters from the Blob store: reads the 10-byte header, then only the tag', async () => {
  const file = Buffer.concat([tag([chap('a', 0, 1000, '하나'), chap('b', 5000, 9000, '둘')]), Buffer.alloc(5000, 7)]);
  const asked = [];
  const fakeBlob = {
    async get(pathname, { headers }) {
      const [, from, to] = /bytes=(\d+)-(\d+)/.exec(headers.Range);
      asked.push(headers.Range);
      return { stream: new Blob([file.subarray(Number(from), Number(to) + 1)]).stream() };
    },
  };
  assert.deepEqual(await chapters.readFromBlob('podcast/x.mp3', fakeBlob), [{ start: 0, title: '하나' }, { start: 5, title: '둘' }]);
  assert.equal(asked.length, 2);
  assert.equal(asked[0], 'bytes=0-9');
  assert.ok(Number(/-(\d+)/.exec(asked[1])[1]) < file.length - 4000, 'the audio itself is never downloaded');
});
