const test = require('node:test');
const assert = require('node:assert/strict');
const { closedFeed, extension } = require('../../api/_lib/rss.js');

const base = 'https://www.ashleylim.com';
const show = { slug: 'nsmb', title: '내성만방 & 팟캐스트', author: '애슐리 림', support_email: 'help@b.kr', language: 'ko' };

test('the retired feed: valid, no episodes, tells podcast apps where to listen now', () => {
  const xml = closedFeed({ base, show, now: new Date('2026-11-16T00:00:00Z') });
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<rss version="2.0"/);
  assert.equal((xml.match(/<item>/g) || []).length, 0);
  assert.equal((xml.match(/<enclosure/g) || []).length, 0);
  assert.match(xml, /<title>내성만방 &amp; 팟캐스트 · 내 강의실로 옮겼어요<\/title>/);
  assert.match(xml, /<link>https:\/\/www\.ashleylim\.com\/learn<\/link>/);
  assert.match(xml, /www\.ashleylim\.com\/learn 에 들어가[^<]*문의: help@b\.kr/);
  assert.match(xml, /<itunes:block>Yes<\/itunes:block>/);
});

test('audio file extensions', () => {
  assert.equal(extension('audio/mpeg'), 'mp3');
  assert.equal(extension('audio/x-m4a'), 'm4a');
  assert.equal(extension('weird'), 'mp3');
});
