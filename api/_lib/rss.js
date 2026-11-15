/*
 * The private podcast feed was retired (Alex, 2026-11-15): students listen in the student area (/learn) only.
 * Podcast apps that still follow a student's old feed get this valid feed with no episodes and a notice saying where
 * to listen now, so the app shows a message instead of an error. Pure: unit-tested in tests/podcast/rss.test.js.
 */

const EXT = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const cdata = (s) => '<![CDATA[' + String(s == null ? '' : s).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';

function extension(mimeType) {
  return EXT[mimeType] || 'mp3';
}

const MOVED = '이 팟캐스트는 이제 ‘내 강의실’에서 들을 수 있어요. www.ashleylim.com/learn 에 들어가 신청할 때 쓴 이메일로 로그인해 주세요. 휴대폰 홈 화면에 저장하면 앱처럼 쓸 수 있어요.';

function closedFeed({ base, show, now = new Date() }) {
  const learn = `${base}/learn`;
  const description = show.support_email ? `${MOVED} 문의: ${show.support_email}` : MOVED;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">',
    '<channel>',
    `<title>${esc(show.title)} · 내 강의실로 옮겼어요</title>`,
    `<link>${esc(learn)}</link>`,
    `<language>${esc(show.language || 'ko')}</language>`,
    `<description>${cdata(description)}</description>`,
    `<itunes:summary>${cdata(description)}</itunes:summary>`,
    show.author ? `<itunes:author>${esc(show.author)}</itunes:author>` : '',
    '<itunes:block>Yes</itunes:block>',
    '<podcast:locked>yes</podcast:locked>',
    `<lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
    '</channel>',
    '</rss>',
    '',
  ].filter((l) => l !== '').join('\n') + '\n';
}

module.exports = { closedFeed, extension, MOVED };
