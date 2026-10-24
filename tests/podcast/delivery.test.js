const test = require('node:test');
const assert = require('node:assert/strict');
const { isDownloadStart } = require('../../api/podcast-audio.js');
const { appName } = require('../../api/_lib/podcast.js');
const page = require('../../api/podcast-page.js');

test('download counting skips probes and later chunks', () => {
  assert.ok(isDownloadStart(undefined));
  assert.ok(isDownloadStart('bytes=0-'));
  assert.ok(isDownloadStart('bytes=0-1048575'));
  assert.ok(!isDownloadStart('bytes=0-1'));
  assert.ok(!isDownloadStart('bytes=1048576-'));
  assert.ok(!isDownloadStart('bytes=-500'));
});

test('podcast apps are recognised from the user agent', () => {
  assert.equal(appName('Podcasts/1650.3 CFNetwork/1410.0.3 Darwin/22.6.0'), 'Apple Podcasts');
  assert.equal(appName('AppleCoreMedia/1.0.0.21A350 (iPhone; U; CPU OS 17_0 like Mac OS X; ko_kr)'), 'Apple Podcasts');
  assert.equal(appName('Overcast/3.0 (+http://overcast.fm/; iOS podcast app)'), 'Overcast');
  assert.equal(appName('Pocket Casts'), 'Pocket Casts');
  assert.equal(appName('PodcastAddict/v5 - Dalvik/2.1.0'), 'Podcast Addict');
  assert.equal(appName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'Web browser');
  assert.equal(appName('Googlebot/2.1'), 'Bot');
  assert.equal(appName(''), 'Unknown');
});

const show = { title: '내성만방 팟캐스트', support_email: 'hello@ashleylim.com', page_intro: '' };
const listener = { token: 'AAAAAAAAAAAAAAAAAAAAAA', name: '김00' };
const base = 'https://www.ashleylim.com';

test('subscribe page: app links, escaped names, no-JS copy field', () => {
  const html = page.subscribePage({ base, show, cohort: { name: '1기' }, listener: { ...listener, name: '<b>' }, state: 'active', released: [{}, {}], next: { releaseAt: new Date('2026-11-16T00:00:00Z') }, expires: new Date('2027-11-01T15:00:00Z') });
  assert.match(html, /href="podcast:\/\/www\.ashleylim\.com\/f\/AAAAAAAAAAAAAAAAAAAAAA"/);
  assert.match(html, /href="pktc:\/\/subscribe\/www\.ashleylim\.com\/f\/AAAAAAAAAAAAAAAAAAAAAA"/);
  assert.match(html, /overcast:\/\/x-callback-url\/add\?url=https%3A%2F%2Fwww\.ashleylim\.com%2Ff%2FAAAAAAAAAAAAAAAAAAAAAA/);
  assert.match(html, /value="https:\/\/www\.ashleylim\.com\/f\/AAAAAAAAAAAAAAAAAAAAAA" readonly/);
  assert.match(html, /&lt;b&gt;님/);
  assert.doesNotMatch(html, /<b>님/);
  assert.match(html, /11월 16일 \(월\) 오전 9:00/);
  assert.match(html, /2027년 11월 2일까지/);
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.doesNotMatch(html, /googletagmanager|_vercel\/insights/);
});

test('subscribe page: expired state hides the subscribe options', () => {
  const html = page.subscribePage({ base, show, cohort: { name: '1기' }, listener, state: 'expired', released: [], next: null, expires: new Date('2027-11-01T15:00:00Z') });
  assert.match(html, /수강 기간이 2027년 11월 2일에 끝나/);
  assert.doesNotMatch(html, /podcast:\/\//);
});
