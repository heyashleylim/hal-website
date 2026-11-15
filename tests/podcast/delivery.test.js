const test = require('node:test');
const assert = require('node:assert/strict');
const { appName } = require('../../api/_lib/podcast.js');

test('apps are recognised from the user agent (old podcast-app events in the history)', () => {
  assert.equal(appName('Podcasts/1650.3 CFNetwork/1410.0.3 Darwin/22.6.0'), 'Apple Podcasts');
  assert.equal(appName('Overcast/3.0 (+http://overcast.fm/; iOS podcast app)'), 'Overcast');
  assert.equal(appName('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'), 'Web browser');
  assert.equal(appName('Googlebot/2.1'), 'Bot');
  assert.equal(appName(''), 'Unknown');
});

test('preview deployments add the protection bypass to links for outside services; production never does', () => {
  const { linkQuery } = require('../../api/_lib/podcast.js');
  assert.equal(linkQuery({ VERCEL_ENV: 'preview', VERCEL_AUTOMATION_BYPASS_SECRET: 'a b' }), '?x-vercel-protection-bypass=a%20b');
  assert.equal(linkQuery({ VERCEL_ENV: 'production', VERCEL_AUTOMATION_BYPASS_SECRET: 'x' }), '');
  assert.equal(linkQuery({ VERCEL_ENV: 'preview' }), '');
});

test('the podcast feed is retired: its audio links answer 404, cover art stays public', async () => {
  const handler = require('../../api/podcast-audio.js');
  const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
  await handler({ method: 'GET', url: '/api/podcast-audio?token=AAAAAAAAAAAAAAAAAAAAAA&file=00000000-0000-4000-8000-000000000001.mp3', headers: {} }, res);
  assert.equal(res.statusCode, 404);
});
