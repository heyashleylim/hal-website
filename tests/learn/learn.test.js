const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const progress = require('../../api/_lib/learn/progress.js');
const learnAuth = require('../../api/_lib/learn/auth.js');
const pages = require('../../api/_lib/learn/pages.js');
const mail = require('../../api/_lib/learn/mail.js');
const { safeNext } = require('../../api/learn.js');

test('progress: furthest point kept, listened time capped per save, done at 90% or the end', () => {
  const now = new Date('2026-11-14T00:00:00Z');
  let row = progress.merge(null, { position: 100, played: 10, duration: 1000 }, now);
  assert.deepEqual(row, { position_seconds: 100, furthest_seconds: 100, listened_seconds: 10, completed_at: null });
  row = progress.merge(row, { position: 40, played: 9999, duration: 1000 }, now); // went back; a clock jump
  assert.equal(row.position_seconds, 40);
  assert.equal(row.furthest_seconds, 100);
  assert.equal(row.listened_seconds, 10 + 120);
  row = progress.merge(row, { position: 905, played: 5, duration: 1000 }, now);
  assert.equal(row.completed_at, now);
  const later = progress.merge(row, { position: 10, played: 5, duration: 1000 }, new Date('2027-01-01'));
  assert.equal(later.completed_at, now, 'done stays done');
  const ended = progress.merge(null, { position: 1, ended: true }, now);
  assert.equal(ended.position_seconds, 0, 'the next play starts from the beginning');
  assert.equal(ended.completed_at, now);
  assert.equal(progress.merge(null, { position: -5, played: -3 }).listened_seconds, 0);
});

test('sign-in input: emails and 6-digit codes are normalised, anything else refused', () => {
  assert.equal(learnAuth.normalizeEmail('  Jiyeon.Kim@Naver.COM '), 'jiyeon.kim@naver.com');
  assert.equal(learnAuth.normalizeEmail('not an email'), null);
  assert.equal(learnAuth.normalizeEmail('a@b'), null);
  assert.equal(learnAuth.normalizeEmail('<a@b.com>'), null);
  assert.equal(learnAuth.normalizeCode('123 456'), '123456');
  assert.equal(learnAuth.normalizeCode('123-456'), '123456');
  assert.equal(learnAuth.normalizeCode('12345'), null);
  assert.equal(learnAuth.normalizeCode('abcdef'), null);
  for (let i = 0; i < 200; i++) assert.match(learnAuth.newCode(), /^\d{6}$/);
});

test('session cookie: HttpOnly, Secure, SameSite=Lax, a year by default (Alex: "at least a week")', () => {
  assert.ok(learnAuth.SESSION_DAYS >= 7);
  const c = learnAuth.cookieHeader('x', learnAuth.SESSION_DAYS * 86400);
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Path=\//);
  assert.match(c, /Max-Age=31536000/);
});

test('after sign-in, only addresses inside the student area are followed', () => {
  assert.equal(safeNext('/learn/nsmb?e=abc'), '/learn/nsmb?e=abc');
  assert.equal(safeNext('/learn'), '/learn');
  assert.equal(safeNext('https://evil.example/learn'), '');
  assert.equal(safeNext('//evil.example'), '');
  assert.equal(safeNext('/learn//evil.example'), '');
  assert.equal(safeNext('/admin'), '');
  assert.equal(safeNext('/learnx'), '');
});

test('sign-in pages: forms work without JavaScript, the code field is a one-time-code field, input escaped', () => {
  const login = pages.loginPage({ email: '"><script>', next: '/learn/nsmb' });
  assert.match(login, /<form class="learn__form" method="post" action="\/learn\/login">/);
  assert.match(login, /autocomplete="email"/);
  assert.ok(!login.includes('"><script>'));
  assert.match(login, /name="next" value="\/learn\/nsmb"/);
  assert.match(login, /noindex/);
  assert.ok(!/googletagmanager|_vercel\/insights/.test(login), 'no GTM or analytics on private pages');
  const code = pages.codePage({ email: 'a@b.com', message: 'wrong' });
  assert.match(code, /action="\/learn\/verify"/);
  assert.match(code, /autocomplete="one-time-code"/);
  assert.match(code, /inputmode="numeric"/);
  assert.match(code, /role="alert"/);
  assert.match(code, /코드 다시 받기/);
});

test('code email: the code in the subject and body, Ashley’s sign-off, names escaped in HTML', () => {
  const e = pages.codeEmail({ code: '042517', name: '<김지연>' });
  assert.equal(e.subject, '내 강의실 로그인 코드: 042517');
  assert.match(e.text, /042517/);
  assert.match(e.text, /Love, 애슐리/);
  assert.ok(e.html.includes('&lt;김지연&gt;'));
});

const show = { slug: 'nsmb', title: '내성만방', artwork_url: '/a/art/nsmb.jpg?v=1' };
const ep = (id, n, extra = {}) => ({ id, guid: `00000000-0000-0000-0000-00000000000${id}`, kind: 'module', number: n, title: `모듈 ${n} 제목`, duration_seconds: 3000, mime_type: 'audio/mpeg', chapters: [], ...extra });

test('program page: player on the first unfinished module, chapters, listened badges, coming modules, data for the script', () => {
  const e1 = ep(1, 1), e2 = ep(2, 2, { chapters: [{ start: 0, title: '들어가며' }, { start: 312.4, title: '<b>신경계</b>' }] }), e3 = ep(3, 3);
  const future = new Date(Date.now() + 7 * 864e5);
  const access = { state: 'active', episodes: [{ episode: e1 }, { episode: e2 }], scheduled: [{ episode: e1, releaseAt: new Date(0) }, { episode: e2, releaseAt: new Date(0) }, { episode: e3, releaseAt: future }], expires: new Date('2027-11-14T15:00:00Z') };
  const prog = new Map([[1, { completed_at: new Date(), position_seconds: 0 }], [2, { completed_at: null, position_seconds: 125 }]]);
  const html = pages.programPage({ show, access, progress: prog, current: null });
  assert.match(html, /<h1 class="play__title" id="play-title">모듈 2 제목<\/h1>/);
  assert.match(html, /src="\/learn\/audio\/00000000-0000-0000-0000-000000000002\.mp3"/);
  assert.match(html, /2:05부터 이어서 들어요/);
  assert.match(html, /다 들음/);
  assert.match(html, /5:12<\/span><span class="learn__chapter-title">&lt;b&gt;신경계&lt;\/b&gt;/);
  assert.match(html, /공개 예정/);
  assert.match(html, /2027년 11월 14일까지/);
  const json = JSON.parse(/<script type="application\/json" id="learn-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(json.current, e2.guid);
  assert.equal(json.tracks.length, 2, 'only released modules are playable');
  assert.ok(!/<\/b>/.test(/id="learn-data">([\s\S]*?)<\/script>/.exec(html)[1]), 'a title cannot close the script tag');
  assert.match(html, /<audio class="play__audio" controls/, 'native controls without JavaScript');
});

test('home page: continue card, one card per program, ended programs explained', () => {
  const html = pages.homePage({
    student: { name: '지연' },
    shows: [
      { show, access: { state: 'active', episodes: [{ episode: ep(1, 1) }], scheduled: [], next: null, expires: null } },
      { show: { slug: 'eft', title: 'EFT' }, access: { state: 'expired', episodes: [], expires: new Date('2026-01-01T15:00:00Z') } },
    ],
    progress: new Map(),
    resume: { show, episode: ep(1, 1), position: 61 },
  });
  assert.match(html, /지연님, 반가워요/);
  assert.match(html, /이어 듣기/);
  assert.match(html, /href="\/learn\/nsmb\?e=00000000-0000-0000-0000-000000000001"/);
  assert.match(html, /1:01부터 이어서/);
  assert.match(html, /수강 기간이 2026년 1월 1일에 끝났어요/);
  assert.match(html, /action="\/learn\/logout"/);
});

test('email through Gmail: a signed service-account token, then one UTF-8 MIME message', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const env = { GOOGLE_SA_EMAIL: 'sender@proj.iam.gserviceaccount.com', GOOGLE_SA_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n'), LEARN_MAIL_FROM: 'hello@ashleylim.com' };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }));
    return new Response('{}');
  };
  await mail.send({ to: 'student@example.com', subject: '내 강의실 로그인 코드: 123456', text: '코드 123456', html: '<p>123456</p>' }, { env, fetchImpl });
  const assertion = new URLSearchParams(calls[0].init.body).get('assertion');
  const [h, c, sig] = assertion.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), publicKey, Buffer.from(sig, 'base64url')), 'signed with the key');
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/gmail.send', 'send only: the key cannot read the mailbox');
  assert.equal(claims.sub, 'hello@ashleylim.com');
  assert.match(calls[1].url, /gmail\/v1\/users\/hello%40ashleylim\.com\/messages\/send$/);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer tok');
  const raw = Buffer.from(JSON.parse(calls[1].init.body).raw, 'base64url').toString();
  assert.match(raw, /^From: =\?UTF-8\?B\?.+\?= <hello@ashleylim\.com>\r\n/);
  assert.match(raw, /To: <student@example\.com>/);
  assert.ok(raw.includes(`Subject: =?UTF-8?B?${Buffer.from('내 강의실 로그인 코드: 123456').toString('base64')}?=`));
  await assert.rejects(mail.send({ to: 'a@b.com\r\nBcc: x@y.com', subject: 's', text: 't', html: 'h' }, { env, fetchImpl }), /bad recipient/);
  assert.equal(mail.configured({}), false);
  await assert.rejects(mail.send({ to: 'a@b.com', subject: 's', text: 't', html: 'h' }, { env: {}, fetchImpl }), /not set up/);
});
