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
  assert.equal(appName('WordPress.com - Audio/1.0'), 'Pocket Casts (server)');
  assert.equal(appName('PocketCasts/1.0 (Pocket Casts Feed Parser; +http://pocketcasts.com/)'), 'Pocket Casts');
  assert.equal(appName(''), 'Unknown');
});

const show = { title: '내성만방 팟캐스트', support_email: 'hello@ashleylim.com', page_intro: '' };
const listener = { token: 'AAAAAAAAAAAAAAAAAAAAAA', name: '김00' };
const base = 'https://www.ashleylim.com';

const showA = { slug: 'nsmb', title: '내성만방 팟캐스트', support_email: 'hello@ashleylim.com', page_intro: '' };
const showB = { slug: 'eft', title: 'EFT 팟캐스트', support_email: '', page_intro: '' };
const enrollments = [{ enrollment: { status: 'active' }, cohort: { name: '1기' } }];
const activeAccess = { state: 'active', episodes: [{}, {}], next: { releaseAt: new Date('2026-11-16T00:00:00Z') }, expires: new Date('2027-11-01T15:00:00Z') };

test('personal page: one card per show, per-show feed links, escaped names, no-JS copy field', () => {
  const html = page.personalPage({ base, token: listener.token, student: { name: '<b>' }, shows: [
    { show: showA, enrollments, access: activeAccess },
    { show: showB, enrollments, access: { state: 'expired', episodes: [], next: null, expires: new Date('2027-11-01T15:00:00Z') } },
  ] });
  assert.match(html, /<h1 class="pod__title">나의 팟캐스트<\/h1>/);
  assert.match(html, /href="podcast:\/\/www\.ashleylim\.com\/f\/AAAAAAAAAAAAAAAAAAAAAA\/nsmb"/);
  assert.match(html, /href="pktc:\/\/subscribe\/www\.ashleylim\.com\/f\/AAAAAAAAAAAAAAAAAAAAAA\/nsmb"/);
  assert.match(html, /overcast:\/\/x-callback-url\/add\?url=https%3A%2F%2Fwww\.ashleylim\.com%2Ff%2FAAAAAAAAAAAAAAAAAAAAAA%2Fnsmb/);
  assert.match(html, /id="feed-nsmb" class="pod__input" type="text" value="https:\/\/www\.ashleylim\.com\/f\/AAAAAAAAAAAAAAAAAAAAAA\/nsmb" readonly/);
  assert.doesNotMatch(html, /\/f\/AAAAAAAAAAAAAAAAAAAAAA\/eft/); // expired show: no subscribe buttons
  assert.match(html, /수강 기간이 2027년 11월 1일에 끝나/);
  assert.match(html, /&lt;b&gt;님/);
  assert.doesNotMatch(html, /<b>님/);
  assert.match(html, /11월 16일 \(월\) 오전 9:00/);
  assert.match(html, /2027년 11월 1일까지/); // last listening day (access ends 2 Nov 00:00 KST)
  assert.match(html, /<meta name="robots" content="noindex/);
  assert.doesNotMatch(html, /googletagmanager|_vercel\/insights/);
});

test('personal page: a single show uses its title; no shows yet', () => {
  const one = page.personalPage({ base, token: listener.token, student: { name: '' }, shows: [{ show: showA, enrollments, access: activeAccess }] });
  assert.match(one, /<h1 class="pod__title">내성만방 팟캐스트<\/h1>/);
  const none = page.personalPage({ base, token: listener.token, student: { name: '' }, shows: [] });
  assert.match(none, /아직 등록된 프로그램이 없어요/);
  assert.doesNotMatch(none, /podcast:\/\//);
});

test('preview deployments add the protection bypass to app links; production never does', () => {
  const { linkQuery } = require('../../api/_lib/podcast.js');
  assert.equal(linkQuery({ VERCEL_ENV: 'preview', VERCEL_AUTOMATION_BYPASS_SECRET: 'a b' }), '?x-vercel-protection-bypass=a%20b');
  assert.equal(linkQuery({ VERCEL_ENV: 'production', VERCEL_AUTOMATION_BYPASS_SECRET: 'x' }), '');
  assert.equal(linkQuery({ VERCEL_ENV: 'preview' }), '');
  const { buildFeed } = require('../../api/_lib/rss.js');
  const xml = buildFeed({ base, show: { ...show, slug: 'nsmb' }, token: listener.token, state: 'active', query: '?x-vercel-protection-bypass=s', items: [{ episode: { id: 1, guid: 'g', kind: 'module', number: 1, title: 't', bytes: 1, mime_type: 'audio/mpeg' }, releaseAt: new Date() }] });
  assert.match(xml, /\/a\/AAAAAAAAAAAAAAAAAAAAAA\/g\.mp3\?x-vercel-protection-bypass=s"/);
  assert.match(xml, /\/f\/AAAAAAAAAAAAAAAAAAAAAA\/nsmb\?x-vercel-protection-bypass=s" rel="self"/);
});
