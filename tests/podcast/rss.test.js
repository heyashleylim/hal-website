const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFeed, audioPath } = require('../../api/_lib/rss.js');

const base = 'https://www.ashleylim.com';
const show = { title: '내성만방 & 팟캐스트', description: '설명 <b>', author: '애슐리 림', owner_email: 'a@b.kr', support_email: 'help@b.kr', language: 'ko', category: 'Education', artwork_url: '/assets/img/podcast/nsmb.jpg' };
const listener = { token: 'AAAAAAAAAAAAAAAAAAAAAA' };
const ep = (n, extra = {}) => ({ id: n, guid: `00000000-0000-4000-8000-00000000000${n}`, kind: 'module', number: n, title: `모듈 ${n}`, notes: 'x ]]> y', bytes: 1234, duration_seconds: 1800, mime_type: 'audio/mpeg', ...extra });

test('active feed lists released episodes, newest first, with absolute URLs', () => {
  const xml = buildFeed({
    base, show, listener, state: 'active',
    items: [{ episode: ep(1), releaseAt: new Date('2026-11-02T00:00:00Z') }, { episode: ep(2), releaseAt: new Date('2026-11-09T00:00:00Z') }],
    now: new Date('2026-11-10T00:00:00Z'),
  });
  assert.ok(xml.indexOf('모듈 2') < xml.indexOf('모듈 1'));
  assert.match(xml, /<title>내성만방 &amp; 팟캐스트<\/title>/);
  assert.match(xml, /<enclosure url="https:\/\/www\.ashleylim\.com\/a\/AAAAAAAAAAAAAAAAAAAAAA\/00000000-0000-4000-8000-000000000001\.mp3" length="1234" type="audio\/mpeg"\/>/);
  assert.match(xml, /<pubDate>Mon, 02 Nov 2026 00:00:00 GMT<\/pubDate>/);
  assert.match(xml, /<itunes:image href="https:\/\/www\.ashleylim\.com\/assets\/img\/podcast\/nsmb\.jpg"\/>/);
  assert.match(xml, /<itunes:block>Yes<\/itunes:block>/);
  assert.match(xml, /<atom:link href="https:\/\/www\.ashleylim\.com\/f\/AAAAAAAAAAAAAAAAAAAAAA" rel="self"/);
  assert.match(xml, /x ]]]]><!\[CDATA\[> y/); // CDATA terminator escaped
  assert.equal((xml.match(/<item>/g) || []).length, 2);
});

test('expired feed: valid, no episodes, notice with the support email', () => {
  const xml = buildFeed({ base, show, listener, state: 'expired', items: [] });
  assert.equal((xml.match(/<item>/g) || []).length, 0);
  assert.match(xml, /수강 기간이 끝나[^<]*문의: help@b\.kr/);
});

test('bonus episodes and m4a files', () => {
  const xml = buildFeed({ base, show, listener, state: 'active', items: [{ episode: ep(3, { kind: 'bonus', number: null, mime_type: 'audio/x-m4a' }), releaseAt: new Date() }] });
  assert.match(xml, /<itunes:episodeType>bonus<\/itunes:episodeType>/);
  assert.doesNotMatch(xml, /<itunes:episode>/);
  assert.equal(audioPath('T', ep(3, { mime_type: 'audio/x-m4a' })), '/a/T/00000000-0000-4000-8000-000000000003.m4a');
});
