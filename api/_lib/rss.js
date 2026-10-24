/*
 * Builds one student's private podcast feed (RSS 2.0 + Apple Podcasts tags). Pure: unit-tested in
 * tests/podcast/rss.test.js. Apple's requirements: https://podcasters.apple.com/support/823-podcast-requirements
 *
 * The show is kept out of directories (itunes:block, podcast:locked). Episodes are those already released
 * for this student (release.js); when access isn't active the feed stays valid but has no episodes and the
 * description explains why, so podcast apps show a message instead of an error.
 */

const NOTICES = {
  expired: '수강 기간이 끝나 이 팟캐스트를 더 이상 들을 수 없어요.',
  revoked: '이 구독 링크는 더 이상 사용할 수 없어요.',
  'no-cohort': '아직 기수가 배정되지 않았어요. 배정되면 이 피드에 에피소드가 나타나요.',
};

const EXT = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const cdata = (s) => '<![CDATA[' + String(s == null ? '' : s).replace(/]]>/g, ']]]]><![CDATA[>') + ']]>';

function extension(mimeType) {
  return EXT[mimeType] || 'mp3';
}

function audioPath(token, episode) {
  return `/a/${token}/${episode.guid}.${extension(episode.mime_type)}`;
}

function artworkUrl(base, url, query) {
  if (/^https?:/.test(url)) return url;
  const extra = query ? (url.includes('?') ? '&' + query.slice(1) : query) : '';
  return base + url + extra;
}

function notice(state, show) {
  const text = NOTICES[state];
  if (!text) return '';
  return show.support_email ? `${text} 문의: ${show.support_email}` : text;
}

function buildFeed({ base, show, listener, state, items, now = new Date(), query = '' }) {
  const pageUrl = `${base}/podcast/${listener.token}`;
  const feedUrl = `${base}/f/${listener.token}${query}`;
  const description = [notice(state, show), show.description].filter(Boolean).join('\n\n') || show.title;

  const episodes = [...items].sort((a, b) => b.releaseAt - a.releaseAt).map(({ episode, releaseAt }) => {
    const lines = [
      '<item>',
      `<title>${esc(episode.title)}</title>`,
      `<description>${cdata(episode.notes || episode.title)}</description>`,
      `<guid isPermaLink="false">${esc(episode.guid)}</guid>`,
      `<pubDate>${releaseAt.toUTCString()}</pubDate>`,
      `<enclosure url="${esc(base + audioPath(listener.token, episode) + query)}" length="${Number(episode.bytes) || 0}" type="${esc(episode.mime_type || 'audio/mpeg')}"/>`,
    ];
    if (episode.duration_seconds) lines.push(`<itunes:duration>${Number(episode.duration_seconds)}</itunes:duration>`);
    if (episode.kind === 'module' && episode.number) lines.push(`<itunes:episode>${Number(episode.number)}</itunes:episode>`);
    lines.push(`<itunes:episodeType>${episode.kind === 'bonus' ? 'bonus' : 'full'}</itunes:episodeType>`, '</item>');
    return lines.join('\n');
  });

  const channel = [
    `<title>${esc(show.title)}</title>`,
    `<link>${esc(pageUrl)}</link>`,
    `<atom:link href="${esc(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    `<language>${esc(show.language || 'ko')}</language>`,
    show.copyright ? `<copyright>${esc(show.copyright)}</copyright>` : '',
    `<description>${cdata(description)}</description>`,
    `<itunes:summary>${cdata(description)}</itunes:summary>`,
    show.author ? `<itunes:author>${esc(show.author)}</itunes:author>` : '',
    show.owner_email ? `<itunes:owner><itunes:name>${esc(show.author || show.title)}</itunes:name><itunes:email>${esc(show.owner_email)}</itunes:email></itunes:owner>` : '',
    show.artwork_url ? `<itunes:image href="${esc(artworkUrl(base, show.artwork_url, query))}"/>` : '',
    `<itunes:category text="${esc(show.category || 'Education')}"/>`,
    '<itunes:explicit>false</itunes:explicit>',
    '<itunes:type>serial</itunes:type>',
    '<itunes:block>Yes</itunes:block>',
    '<podcast:locked>yes</podcast:locked>',
    `<lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
  ].filter(Boolean);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    ...channel,
    ...episodes,
    '</channel>',
    '</rss>',
    '',
  ].join('\n');
}

module.exports = { buildFeed, audioPath, extension, NOTICES };
