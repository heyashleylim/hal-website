/*
 * End-to-end checks of the student area (/learn): the real endpoints and database statements, through the local
 * server (tools/shop/dev-server.js), inside a database transaction that is rolled back at the end. No email is sent.
 *
 *   npm run test:learn        (needs .env.local with PODCAST_DATABASE_URL or DATABASE_URL)
 *
 * Exit code 1 if any check fails.
 */
const { start } = require('../shop/dev-server.js');

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  ✓ ${name}`);
  else { failed++; console.log(`  ✖ ${name}${detail ? ' — ' + detail : ''}`); }
}

async function main() {
  const s = await start({ port: Number(process.env.E2E_PORT || 8796), quiet: true });
  const { base, sql, learnMail } = s;
  const one = async (text, params) => (await sql(text, params))[0] || null;
  const origin = { Origin: base };
  let net = 0;
  const from = () => ({ 'x-forwarded-for': `203.0.113.${++net}` });
  const get = (path, cookie = '') => fetch(base + path, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  const form = (path, body, headers = {}) => fetch(base + path, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...origin, ...headers }, body: new URLSearchParams(body).toString() });
  const cookieOf = (r) => (/hal_learn=([^;]*)/.exec(r.headers.get('set-cookie') || '') || [])[1];
  const lastCode = () => (/(\d{6})/.exec(learnMail[0] ? learnMail[0].subject : '') || [])[1];

  try {
    // A program with two released modules (one with chapters) and one coming, a cohort, a student.
    const show = await one(`INSERT INTO shows (slug, title, author, ac_tag_prefix) VALUES ('e2e-learn', 'E2E 프로그램', '애슐리 림', 'podcast_e2e') RETURNING *`);
    const today = new Date().toISOString().slice(0, 10);
    const cohort = await one(`INSERT INTO cohorts (show_id, name, ac_tag, start_date) VALUES ($1, 'E2E기', 'e2e_learn_tag', $2::date - 8) RETURNING *`, [show.id, today]);
    const ep = (n, day, chapters = '[]') => one(`INSERT INTO episodes (show_id, kind, number, title, day_offset, status, blob_pathname, bytes, duration_seconds, chapters) VALUES ($1, 'module', $2, $3, $4, 'published', 'podcast/e2e/none.mp3', 1000, 600, $5) RETURNING *`, [show.id, n, `모듈 ${n} 제목`, day, chapters]);
    const e1 = await ep(1, 0);
    const e2 = await ep(2, 7, JSON.stringify([{ start: 0, title: '들어가며' }, { start: 120, title: '신경계가 먼저인 이유' }]));
    const e3 = await ep(3, 14);
    const student = await one(`INSERT INTO students (email, name, token) VALUES ('e2e.learner@example.com', '지연', 'E2Elearn_tok_000000000') RETURNING *`);
    await sql(`INSERT INTO enrollments (student_id, cohort_id) VALUES ($1, $2)`, [student.id, cohort.id]);
    const other = await one(`INSERT INTO students (email, name, token) VALUES ('e2e.other@example.com', '', 'E2Eother_tok_000000000') RETURNING *`);

    console.log('Signed out');
    let r = await get('/learn');
    check('/learn sends to the sign-in page', r.status === 303 && r.headers.get('location') === '/learn/login');
    r = await get(`/learn/e2e-learn?e=${e2.guid}`);
    check('a program address comes back after sign-in (next=)', r.status === 303 && r.headers.get('location').includes('next=%2Flearn%2Fe2e-learn%3Fe%3D'));
    r = await get(`/learn/audio/${e1.guid}.mp3`);
    check('audio without a session: 404', r.status === 404);
    r = await fetch(base + '/learn/progress', { method: 'POST', headers: { 'Content-Type': 'application/json', ...origin }, body: JSON.stringify({ episode: e1.guid, position: 10 }) });
    check('progress without a session: 401', r.status === 401);

    console.log('Sign-in by code');
    r = await form('/learn/login', { email: 'nobody@example.com' }, from());
    let html = await r.text();
    check('unknown email: same "check your email" page, no email sent', r.status === 200 && html.includes('메일을 확인해 주세요') && learnMail.length === 0);
    r = await form('/learn/login', { email: '  E2E.Learner@Example.com ' }, from());
    html = await r.text();
    check('known email (any case): code page and one email', r.status === 200 && html.includes('메일을 확인해 주세요') && learnMail.length === 1 && learnMail[0].to === 'e2e.learner@example.com');
    const code = lastCode();
    check('the email carries a 6-digit code', /^\d{6}$/.test(code || ''));
    const stored = await one('SELECT * FROM learn_codes WHERE student_id = $1', [student.id]);
    check('only a hash of the code is stored', stored && !stored.code_hash.includes(code) && stored.code_hash.length === 64);
    r = await fetch(base + '/learn/login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' }, body: 'email=e2e.learner%40example.com' });
    check('a form from another site is refused', r.status === 403);
    const wrong = code === '000000' ? '111111' : '000000';
    r = await form('/learn/verify', { email: 'e2e.learner@example.com', code: wrong });
    html = await r.text();
    check('wrong code: refused with a message, no cookie', r.status === 400 && html.includes('코드가 맞지 않아요') && !cookieOf(r));
    r = await form('/learn/verify', { email: 'e2e.other@example.com', code });
    check('the code does not work for another student', r.status === 400 && !cookieOf(r));
    r = await form('/learn/verify', { email: 'e2e.learner@example.com', code: code.slice(0, 3) + ' ' + code.slice(3), next: `/learn/e2e-learn?e=${e2.guid}` });
    const cookie = `hal_learn=${cookieOf(r)}`;
    check('right code (typed with a space): signed in, back to the page asked for', r.status === 303 && r.headers.get('location') === `/learn/e2e-learn?e=${e2.guid}` && cookie.length > 20);
    check('cookie lasts a year, HttpOnly, Secure', /Max-Age=31536000/.test(r.headers.get('set-cookie')) && /HttpOnly/.test(r.headers.get('set-cookie')) && /Secure/.test(r.headers.get('set-cookie')));
    r = await form('/learn/verify', { email: 'e2e.learner@example.com', code });
    check('a code works only once', r.status === 400 && !cookieOf(r));
    r = await form('/learn/verify', { email: 'e2e.learner@example.com', code: 'https://evil.example', next: 'https://evil.example' });
    check('a bad code is refused before anything else', r.status === 400);

    console.log('Pages');
    r = await get('/learn', cookie);
    html = await r.text();
    check('home: greeting and the program', r.status === 200 && html.includes('지연님, 반가워요') && html.includes('E2E 프로그램') && html.includes('href="/learn/e2e-learn"'));
    check('home: private (no-store, noindex), no GTM', /no-store/.test(r.headers.get('cache-control')) && /noindex/.test(r.headers.get('x-robots-tag')) && !html.includes('googletagmanager'));
    r = await get('/learn/e2e-learn', cookie);
    html = await r.text();
    check('program page: player on module 1, two released, module 3 coming', r.status === 200 && html.includes('id="play-title">모듈 1 제목') && html.includes('모듈 3 제목') && html.includes('공개 예정'));
    check('program page: module 3 is not playable', !html.includes(`/learn/audio/${e3.guid}`));
    r = await get(`/learn/e2e-learn?e=${e2.guid}`, cookie);
    html = await r.text();
    check('?e= opens module 2 with its chapters', html.includes('id="play-title">모듈 2 제목') && html.includes('신경계가 먼저인 이유') && html.includes('2:00'));
    r = await get(`/learn/e2e-learn?e=${e3.guid}`, cookie);
    html = await r.text();
    check('?e= of a module not released yet falls back to a released one', html.includes('id="play-title">모듈 1 제목'));
    r = await get('/learn/unknown-program', cookie);
    check('a program the student is not in: 404', r.status === 404);

    console.log('Progress');
    const post = (body, type = 'application/json') => fetch(base + '/learn/progress', { method: 'POST', headers: { 'Content-Type': type, cookie, ...origin }, body: JSON.stringify(body) });
    r = await post({ episode: e1.guid, position: 125, played: 10 });
    check('saved (JSON)', r.status === 200);
    r = await post({ episode: e1.guid, position: 130, played: 5 }, 'text/plain');
    check('saved (sendBeacon text)', r.status === 200);
    let row = await one('SELECT * FROM listening WHERE student_id = $1 AND episode_id = $2', [student.id, e1.id]);
    check('position, furthest and listened time', row && row.position_seconds === 130 && row.furthest_seconds === 130 && row.listened_seconds === 15, JSON.stringify(row));
    r = await post({ episode: e3.guid, position: 10 });
    check('a module not released yet: refused', r.status === 404);
    r = await post({ episode: e1.guid, position: 550, played: 10 });
    check('90% reached: done', (await r.json()).done === true);
    r = await post({ episode: e2.guid, position: 61, played: 10 });
    r = await get('/learn', cookie);
    html = await r.text();
    check('home: continue listening shows module 2 at 1:01', html.includes('이어 듣기') && html.includes(`?e=${e2.guid}`) && html.includes('1:01부터 이어서'));
    r = await get('/learn/e2e-learn', cookie);
    html = await r.text();
    check('program page: module 1 marked done, player opens module 2 (first unfinished)', html.includes('다 들음') && html.includes('id="play-title">모듈 2 제목') && html.includes('1:01부터 이어서 들어요'));

    console.log('Access ends');
    await sql(`UPDATE enrollments SET status = 'revoked' WHERE student_id = $1`, [student.id]);
    r = await get('/learn/e2e-learn', cookie);
    check('enrolment revoked: the program page sends home', r.status === 303);
    r = await post({ episode: e1.guid, position: 1 });
    check('enrolment revoked: progress refused', r.status === 404);
    await sql(`UPDATE enrollments SET status = 'active' WHERE student_id = $1`, [student.id]);
    await sql(`UPDATE students SET status = 'revoked' WHERE id = $1`, [student.id]);
    r = await get('/learn', cookie);
    check('student revoked: signed out at once', r.status === 303 && r.headers.get('location') === '/learn/login');
    r = await form('/learn/login', { email: 'e2e.learner@example.com' }, from());
    check('student revoked: no code is sent', learnMail.length === 1);
    await sql(`UPDATE students SET status = 'active' WHERE id = $1`, [student.id]);

    console.log('Personal link and sign-out');
    r = await get(`/learn/start/${student.token}`);
    const cookie2 = `hal_learn=${cookieOf(r)}`;
    check('/learn/start/<token> signs in', r.status === 303 && cookie2.length > 20);
    r = await get('/learn/start/AAAAAAAAAAAAAAAAAAAAAA');
    check('an unknown token does not', r.status === 404 && !cookieOf(r));
    r = await fetch(base + '/learn/logout', { method: 'POST', redirect: 'manual', headers: { cookie: cookie2, ...origin } });
    check('sign out clears the cookie', r.status === 303 && /Max-Age=0/.test(r.headers.get('set-cookie')));
    r = await get('/learn', cookie2);
    check('that session no longer works', r.status === 303);
    r = await get('/learn', cookie);
    check('the other device stays signed in', r.status === 200);

    console.log('Limits');
    for (let i = 0; i < 6; i++) r = await form('/learn/login', { email: 'e2e.other@example.com' }, from());
    check('6th code within an hour: refused', r.status === 429 && learnMail.filter((m) => m.to === 'e2e.other@example.com').length === 5);
    const ip = { 'x-forwarded-for': '198.18.0.1' };
    for (let i = 0; i < 21; i++) {
      await sql(`INSERT INTO students (email, token) VALUES ($1, $2)`, [`e2e.ip${i}@example.com`, `E2Eip_${String(i).padStart(16, '0')}`]);
      r = await form('/learn/login', { email: `e2e.ip${i}@example.com` }, ip);
    }
    check('21st code from one network within an hour: refused', r.status === 429);
    await sql(`UPDATE learn_codes SET attempts = 0, used_at = NULL, expires_at = now() + interval '10 minutes' WHERE student_id = $1`, [other.id]);
    for (let i = 0; i < 5; i++) await form('/learn/verify', { email: 'e2e.other@example.com', code: '999999' === lastCode() ? '888888' : '999999' });
    const live = await one(`SELECT count(*)::int AS n FROM learn_codes WHERE student_id = $1 AND attempts < 5 AND used_at IS NULL`, [other.id]);
    check('5 wrong tries end every code', live.n === 0);
    const otherCode = learnMail.find((m) => m.to === 'e2e.other@example.com').subject.slice(-6);
    r = await form('/learn/verify', { email: 'e2e.other@example.com', code: otherCode });
    check('…even the right one afterwards', r.status === 400);

    console.log('Real audio (an existing published episode, if the database has one)');
    const real = await one(`SELECT en.student_id, ep.guid FROM episodes ep JOIN cohorts c ON c.show_id = ep.show_id JOIN enrollments en ON en.cohort_id = c.id JOIN students st ON st.id = en.student_id
      WHERE ep.status = 'published' AND ep.blob_pathname NOT LIKE 'podcast/e2e/%' AND ep.day_offset = 0 AND st.status = 'active' AND en.status = 'active' LIMIT 1`);
    if (real && process.env.BLOB_READ_WRITE_TOKEN) {
      const tok = await one('SELECT token FROM students WHERE id = $1', [real.student_id]);
      r = await get(`/learn/start/${tok.token}`);
      const c3 = `hal_learn=${cookieOf(r)}`;
      r = await fetch(`${base}/learn/audio/${real.guid}.mp3`, { headers: { cookie: c3, range: 'bytes=0-1023' } });
      check('streams a byte range (206, audio/mpeg)', r.status === 206 && r.headers.get('content-type') === 'audio/mpeg' && (await r.arrayBuffer()).byteLength === 1024);
    } else console.log('  (skipped: no published episode or no BLOB_READ_WRITE_TOKEN)');
  } finally {
    await s.stop();
  }
  console.log(failed ? `\n${failed} check(s) failed` : '\nAll checks passed (database rolled back)');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
