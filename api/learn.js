/*
 * The student area, "내 강의실" (docs/student-area-plan.md, step 1a). Rewrites in vercel.json send /learn and
 * /learn/<path> here (?path=…):
 *
 *   GET  /learn                    home: continue listening, one card per program (sign-in required)
 *   GET  /learn/login, POST        sign-in step 1: email → a 6-digit code by email (api/_lib/learn/auth.js, mail.js)
 *   POST /learn/verify             sign-in step 2: the code → session cookie (1 year from the last visit)
 *   GET  /learn/start/<token>      the personal podcast link signs in too (same token as /podcast/<token>)
 *   POST /learn/logout
 *   GET  /learn/<program>[?e=<guid>]  the player, chapters and modules of one program
 *   GET  /learn/audio/<guid>.<ext> the audio, checked against the session on every request (revoked/expired = 404)
 *   POST /learn/progress           the player saves where the student is (JSON or sendBeacon text)
 *
 * Pages are rendered on the server (api/_lib/learn/pages.js) and work without JavaScript. No GTM / analytics.
 */
const db = require('./_lib/db.js');
const podcast = require('./_lib/podcast.js');
const learnAuth = require('./_lib/learn/auth.js');
const mail = require('./_lib/learn/mail.js');
const progress = require('./_lib/learn/progress.js');
const pages = require('./_lib/learn/pages.js');
const { streamEpisode } = require('./_lib/audio-stream.js');
const { extension } = require('./_lib/rss.js');
const { readBody, sendJson, sendHtml, redirect, sameOrigin } = require('./_lib/shop/http.js');

const IP_CODES_PER_HOUR = 20;

// Only paths inside the student area, never another site.
function safeNext(value) {
  const v = String(value || '');
  return /^\/learn(\/[A-Za-z0-9_\-/?=&.%]*)?$/.test(v) && !v.includes('//') ? v : '';
}

function loginRedirect(res, next) {
  return redirect(res, 303, '/learn/login' + (next && next !== '/learn' ? `?next=${encodeURIComponent(next)}` : ''));
}

// The student's programs with their access right now.
async function programs(student) {
  const data = await podcast.loadStudent(student.token);
  if (!data) return [];
  const now = new Date();
  return Promise.all(data.shows.map(async (entry) => ({ ...entry, access: await podcast.showAccess(data.student, entry, now) })));
}

async function sendCode(req, res, data) {
  const next = safeNext(data.next);
  const email = learnAuth.normalizeEmail(data.email);
  if (!email) return sendHtml(res, 400, pages.loginPage({ email: data.email || '', message: 'bad-email', next }));
  const ipHash = podcast.clientInfo(req).ipHash;
  if (ipHash) {
    const fromIp = await db.one(`SELECT count(*)::int AS n FROM learn_codes WHERE ip_hash = $1 AND created_at > now() - interval '1 hour'`, [ipHash]);
    if (fromIp.n >= IP_CODES_PER_HOUR) return sendHtml(res, 429, pages.loginPage({ email, message: 'too-many', next }));
  }
  const result = await learnAuth.createCode(email, { ipHash });
  if (result.error === 'too-many') return sendHtml(res, 429, pages.codePage({ email, message: 'too-many', next }));
  if (result.code) {
    try {
      await mail.send({ to: result.student.email, ...pages.codeEmail({ code: result.code, name: result.student.name }) });
    } catch (err) {
      console.error('learn code email', err.message);
      return sendHtml(res, 502, pages.loginPage({ email, message: 'send-failed', next }));
    }
  }
  // Same page whether or not the email is a student's: the page never tells who is enrolled.
  return sendHtml(res, 200, pages.codePage({ email, next }));
}

async function verify(req, res, data) {
  const next = safeNext(data.next) || '/learn';
  const email = learnAuth.normalizeEmail(data.email);
  if (!email) return sendHtml(res, 400, pages.loginPage({ message: 'bad-email' }));
  const code = learnAuth.normalizeCode(data.code);
  if (!code) return sendHtml(res, 400, pages.codePage({ email, message: 'bad-code', next: safeNext(data.next) }));
  const result = await learnAuth.checkCode(email, code);
  if (result.error) return sendHtml(res, 400, pages.codePage({ email, message: result.error, next: safeNext(data.next) }));
  await learnAuth.startSession(res, result.student.id, { via: 'code', userAgent: req.headers['user-agent'] });
  return redirect(res, 303, next);
}

async function home(req, res, student) {
  const shows = await programs(student);
  const prog = await progress.forStudent(student.id);
  // Continue: the most recent episode not finished that the student can still hear.
  let resume = null;
  for (const row of prog.values()) {
    if (row.completed_at || row.position_seconds < 5) continue;
    for (const x of shows) {
      const hit = x.access.state === 'active' && x.access.episodes.find((e) => e.episode.id === row.episode_id);
      if (hit) { resume = { show: x.show, episode: hit.episode, position: row.position_seconds }; break; }
    }
    if (resume) break;
  }
  return sendHtml(res, 200, pages.homePage({ student, shows, progress: prog, resume }));
}

async function program(req, res, student, slug, params) {
  const shows = await programs(student);
  const x = shows.find((s) => s.show.slug === slug);
  if (!x) return sendHtml(res, 404, pages.messagePage({ title: '프로그램을 찾을 수 없어요', text: '주소를 다시 확인하거나 내 강의실에서 프로그램을 골라 주세요.' }));
  if (x.access.state !== 'active') return redirect(res, 303, '/learn');
  const prog = await progress.forStudent(student.id);
  const wanted = params.get('e');
  const current = wanted ? (x.access.episodes.find((e) => e.episode.guid === wanted) || {}).episode : null;
  return sendHtml(res, 200, pages.programPage({ show: x.show, access: x.access, progress: prog, current }));
}

// The episode a signed-in student may hear right now, or null.
async function audibleEpisode(student, guid) {
  const episode = await db.one('SELECT * FROM episodes WHERE guid = $1', [guid]);
  if (!episode) return null;
  const data = await podcast.loadStudent(student.token);
  const entry = data && data.shows.find((s) => s.show.id === episode.show_id);
  if (!entry) return null;
  const access = await podcast.showAccess(data.student, entry);
  return access.state === 'active' && access.episodes.some((e) => e.episode.id === episode.id) ? episode : null;
}

async function audio(req, res, student, file) {
  const m = /^([0-9a-f-]{36})\.([a-z0-9]{2,4})$/.exec(file);
  const episode = m && student ? await audibleEpisode(student, m[1]) : null;
  if (!episode || extension(episode.mime_type) !== m[2]) {
    res.statusCode = 404;
    res.setHeader('Cache-Control', 'no-store');
    return res.end('Not found');
  }
  // Short private cache: a revoked student loses access within the hour even if the browser kept a copy.
  return streamEpisode(req, res, episode, { cache: 'private, max-age=3600' });
}

async function saveProgress(req, res, student, data) {
  if (!student) return sendJson(res, 401, { error: 'signed-out' });
  const guid = String(data.episode || '');
  if (!/^[0-9a-f-]{36}$/.test(guid)) return sendJson(res, 400, { error: 'episode' });
  const episode = await audibleEpisode(student, guid);
  if (!episode) return sendJson(res, 404, { error: 'not-available' });
  const row = await progress.save(student.id, episode, { position: data.position, played: data.played, ended: data.ended === true || data.ended === 'true' });
  return sendJson(res, 200, { ok: true, done: Boolean(row.completed_at) });
}

module.exports = async function handler(req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'same-origin');
  const params = new URL(req.url, 'http://local').searchParams;
  const route = String(params.get('path') || '').replace(/^\/+|\/+$/g, '');
  const method = req.method;

  try {
    if (method === 'POST' && !sameOrigin(req)) return sendJson(res, 403, { error: 'origin' });
    // Read a POST body before any database call: once the request has fully arrived it can't be read later.
    const body = method === 'POST' ? (await readBody(req)).data : {};

    if (route === 'login') {
      if (method === 'POST') return sendCode(req, res, body);
      if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'method' });
      if (await learnAuth.studentFromRequest(req, res)) return redirect(res, 303, safeNext(params.get('next')) || '/learn');
      return sendHtml(res, 200, pages.loginPage({ next: safeNext(params.get('next')), message: params.get('m') === 'signed-out' ? 'signed-out' : '' }));
    }
    if (route === 'verify' && method === 'POST') return verify(req, res, body);
    if (route === 'logout' && method === 'POST') {
      await learnAuth.endSession(req, res);
      return redirect(res, 303, '/learn/login?m=signed-out');
    }
    const start = /^start\/([A-Za-z0-9_-]{22})$/.exec(route);
    if (start && method === 'GET') {
      const student = await db.one(`SELECT id FROM students WHERE token = $1 AND status = 'active'`, [start[1]]);
      if (!student) return sendHtml(res, 404, pages.loginPage({ message: 'link-invalid' }));
      await learnAuth.startSession(res, student.id, { via: 'link', userAgent: req.headers['user-agent'] });
      return redirect(res, 303, '/learn');
    }

    const student = await learnAuth.studentFromRequest(req, res);
    if (route === 'progress' && method === 'POST') return saveProgress(req, res, student, body);
    const audioMatch = /^audio\/([^/]+)$/.exec(route);
    if (audioMatch && (method === 'GET' || method === 'HEAD')) return audio(req, res, student, audioMatch[1]);

    if (method !== 'GET' && method !== 'HEAD') return sendJson(res, 405, { error: 'method' });
    const here = '/learn' + (route ? `/${route}` : '') + (params.get('e') ? `?e=${params.get('e')}` : '');
    if (!student) return loginRedirect(res, safeNext(here));
    if (!route) return home(req, res, student);
    if (/^[a-z0-9-]+$/.test(route)) return program(req, res, student, route, params);
    return sendHtml(res, 404, pages.messagePage({ title: '페이지를 찾을 수 없어요', text: '주소를 다시 확인해 주세요.' }));
  } catch (err) {
    console.error('learn', route, err);
    if (res.headersSent) return res.end();
    if (err.status === 413) return sendJson(res, 413, { error: 'too-large' });
    return sendHtml(res, 503, pages.messagePage({ title: '잠시 후 다시 시도해 주세요', text: '일시적인 문제로 페이지를 불러오지 못했어요.' }));
  }
};

module.exports.safeNext = safeNext;
