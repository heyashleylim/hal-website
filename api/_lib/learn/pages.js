/*
 * HTML of the student area (/learn), rendered on the server so every page reads and works without JavaScript
 * (the player script only adds skip/speed buttons, chapter jumps, progress saving and auto-next).
 * Pure functions of their data: unit-tested in tests/learn/pages.test.js. Korean copy for students.
 *
 * Header and footer are the site's (same as /podcast/<token>). No GTM or analytics: these pages are private.
 */
const fs = require('node:fs');
const path = require('node:path');
const { extension } = require('../rss.js');

const SITE = path.join(__dirname, '..', '..', '..', 'site');
let chrome = null;
function siteChrome() {
  if (chrome) return chrome;
  const read = (file) => {
    try {
      return fs.readFileSync(path.join(SITE, file), 'utf8');
    } catch (_) {
      return '';
    }
  };
  const header = (read('nsmb/index.html').match(/<header class="site-header">[\s\S]*?<\/header>/) || [''])[0];
  const footer = (read('index.html').match(/<footer class="site-footer">[\s\S]*?<\/footer>/) || [''])[0];
  chrome = { header, footer };
  return chrome;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function clock(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
}

// "1시간 5분", "42분"
function minutes(seconds) {
  const m = Math.round((Number(seconds) || 0) / 60);
  if (!m) return '';
  return m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`;
}

const kst = (date, opts) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...opts }).format(date);
const releaseDate = (date) => kst(date, { month: 'long', day: 'numeric', weekday: 'short' });
const fullDate = (date) => kst(date, { year: 'numeric', month: 'long', day: 'numeric' });
// Access ends at 00:00 KST the day after the last listening day: show that last day.
const lastDay = (expires) => new Date(expires.getTime() - 1);

function episodeLabel(episode) {
  return episode.kind === 'module' && episode.number ? `모듈 ${episode.number}` : '보너스';
}

function audioUrl(episode) {
  return `/learn/audio/${episode.guid}.${extension(episode.mime_type)}`;
}

function layout({ title, body, script = '', bodyClass = '' }) {
  const { header, footer } = siteChrome();
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="내 강의실">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/fonts.css">
<link rel="stylesheet" href="/assets/css/brand.css">
<link rel="stylesheet" href="/assets/css/header.css">
<link rel="stylesheet" href="/assets/css/footer.css">
<link rel="stylesheet" href="/assets/css/pages/podcast.css">
<link rel="stylesheet" href="/assets/css/pages/learn.css">
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">본문으로 건너뛰기</a>
${header}
<main id="main" class="pod learn">
${body}
</main>
${footer}
${script ? `<script src="${script}" defer></script>` : ''}
</body>
</html>`;
}

const SUPPORT = 'hello@ashleylim.com';

const MESSAGES = {
  'bad-email': '이메일 주소를 다시 확인해 주세요.',
  'bad-code': '6자리 숫자 코드를 입력해 주세요.',
  wrong: '코드가 맞지 않아요. 메일에 있는 6자리 숫자를 다시 확인해 주세요.',
  expired: '코드가 만료되었어요. 새 코드를 받아 주세요.',
  'too-many': '코드를 여러 번 요청하셨어요. 잠시 후 다시 시도해 주세요.',
  'send-failed': '메일을 보내지 못했어요. 잠시 후 다시 시도해 주세요.',
  'signed-out': '로그아웃했어요.',
  'link-invalid': '이 링크로는 로그인할 수 없어요. 이메일로 코드를 받아 로그인해 주세요.',
};

// Step 1: the email form.
function loginPage({ email = '', message = '', next = '' } = {}) {
  const note = message ? `<p class="learn__msg${message === 'signed-out' ? '' : ' learn__msg--error'}" role="${message === 'signed-out' ? 'status' : 'alert'}">${esc(MESSAGES[message] || message)}</p>` : '';
  return layout({
    title: '로그인 · 내 강의실',
    body: `<section class="pod__card learn__login" aria-labelledby="login-title">
  <p class="pod__eyebrow">내 강의실</p>
  <h1 class="pod__title" id="login-title">로그인</h1>
  <p class="pod__lead">수강 신청할 때 쓴 이메일을 입력해 주세요. 로그인 코드를 보내 드릴게요.</p>
  ${note}
  <form class="learn__form" method="post" action="/learn/login">
    <label class="pod__label" for="email">이메일</label>
    <input class="learn__input" id="email" name="email" type="email" autocomplete="email" inputmode="email" required value="${esc(email)}" autocapitalize="off" spellcheck="false">
    ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
    <button class="btn btn--block learn__submit" type="submit">코드 받기</button>
  </form>
  <p class="pod__note">비밀번호는 없어요. 한 번 로그인하면 이 기기에서는 1년 동안 로그인 상태가 유지돼요.</p>
</section>`,
  });
}

// Step 2: the code form. Shown whether or not the email belongs to a student (the page never says which).
function codePage({ email, message = '', next = '' }) {
  const note = message ? `<p class="learn__msg learn__msg--error" role="alert">${esc(MESSAGES[message] || message)}</p>` : '';
  return layout({
    title: '코드 입력 · 내 강의실',
    body: `<section class="pod__card learn__login" aria-labelledby="code-title">
  <p class="pod__eyebrow">내 강의실</p>
  <h1 class="pod__title" id="code-title">메일을 확인해 주세요</h1>
  <p class="pod__lead"><strong>${esc(email)}</strong>(으)로 6자리 로그인 코드를 보냈어요. 코드는 10분 동안 쓸 수 있어요.</p>
  ${note}
  <form class="learn__form" method="post" action="/learn/verify">
    <input type="hidden" name="email" value="${esc(email)}">
    ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
    <label class="pod__label" for="code">로그인 코드</label>
    <input class="learn__input learn__input--code" id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 \\-]{6,7}" maxlength="7" required autofocus>
    <button class="btn btn--block learn__submit" type="submit">로그인</button>
  </form>
  <div class="learn__help">
    <p>메일이 오지 않았나요? 스팸함이나 프로모션함을 확인해 주세요. 수강 신청할 때 쓴 이메일이 맞는지도 확인해 주세요.</p>
    <form method="post" action="/learn/login" class="learn__inline">
      <input type="hidden" name="email" value="${esc(email)}">
      ${next ? `<input type="hidden" name="next" value="${esc(next)}">` : ''}
      <button class="learn__link" type="submit">코드 다시 받기</button>
    </form>
    <span aria-hidden="true">·</span>
    <a href="/learn/login">다른 이메일로 로그인</a>
  </div>
</section>`,
  });
}

function codeEmail({ code, name }) {
  const hello = name ? `${name}님, 안녕하세요.` : '안녕하세요.';
  const text = `${hello}

내 강의실 로그인 코드예요.

${code}

10분 안에 입력해 주세요.
직접 요청하지 않으셨다면 이 메일은 무시하셔도 괜찮아요.

Love, 애슐리`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;font-size:16px;line-height:1.7;color:#222;max-width:480px">
<p>${esc(hello)}</p>
<p>내 강의실 로그인 코드예요.</p>
<p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:24px 0">${esc(code)}</p>
<p>10분 안에 입력해 주세요.<br>직접 요청하지 않으셨다면 이 메일은 무시하셔도 괜찮아요.</p>
<p>Love, 애슐리</p>
</div>`;
  return { subject: `내 강의실 로그인 코드: ${code}`, text, html };
}

// Counts for one program: released modules, listened ones.
function programCounts(access, progress) {
  const released = access.episodes.map((e) => e.episode);
  const done = released.filter((e) => progress.get(e.id) && progress.get(e.id).completed_at).length;
  return { released: released.length, done, total: (access.scheduled || []).length };
}

function statusLine(access) {
  if (access.state === 'expired') return `수강 기간이 ${access.expires ? esc(fullDate(lastDay(access.expires))) + '에 ' : ''}끝났어요.`;
  if (access.state === 'revoked') return '이 프로그램은 더 이상 들을 수 없어요.';
  if (access.state === 'not-enrolled') return '아직 등록된 기수가 없어요.';
  return '';
}

// /learn: continue listening + one card per program.
function homePage({ student, shows, progress, resume }) {
  const greeting = student.name ? `${esc(student.name)}님, 반가워요.` : '반가워요.';
  const continueCard = resume ? `<section class="pod__card learn__resume" aria-labelledby="resume-title">
  <h2 class="pod__h2" id="resume-title">이어 듣기</h2>
  <a class="learn__resume-link" href="/learn/${esc(resume.show.slug)}?e=${esc(resume.episode.guid)}">
    ${resume.show.artwork_url ? `<img class="learn__cover" src="${esc(resume.show.artwork_url)}" alt="" width="64" height="64">` : ''}
    <span class="learn__resume-text">
      <span class="learn__muted">${esc(resume.show.title)} · ${esc(episodeLabel(resume.episode))}</span>
      <strong>${esc(resume.episode.title)}</strong>
      <span class="learn__muted">${esc(clock(resume.position))}부터 이어서</span>
    </span>
  </a>
</section>` : '';

  const cards = shows.map((x) => {
    const c = programCounts(x.access, progress);
    const active = x.access.state === 'active';
    const facts = active ? `<ul class="pod__status">
    <li><span>공개된 모듈</span><strong>${c.released}개${c.total > c.released ? ` / 전체 ${c.total}개` : ''}</strong></li>
    <li><span>다 들은 모듈</span><strong>${c.done}개</strong></li>
    <li><span>다음 공개</span><strong>${x.access.next ? esc(releaseDate(x.access.next.releaseAt)) : '모두 공개되었어요'}</strong></li>
    ${x.access.expires ? `<li><span>수강 기간</span><strong>${esc(fullDate(lastDay(x.access.expires)))}까지</strong></li>` : ''}
  </ul>` : `<p class="pod__notice">${statusLine(x.access)}</p>`;
    return `<section class="pod__card learn__program" aria-labelledby="p-${esc(x.show.slug)}">
  <div class="learn__program-head">
    ${x.show.artwork_url ? `<img class="learn__cover" src="${esc(x.show.artwork_url)}" alt="" width="64" height="64">` : ''}
    <h2 class="pod__h2" id="p-${esc(x.show.slug)}">${esc(x.show.title)}</h2>
  </div>
  ${facts}
  ${active ? `<a class="btn btn--block learn__go" href="/learn/${esc(x.show.slug)}">강의 듣기</a>` : ''}
</section>`;
  }).join('\n');

  return layout({
    title: '내 강의실',
    body: `<section class="pod__card pod__card--intro">
  <h1 class="pod__title">내 강의실</h1>
  <p class="pod__lead">${greeting}</p>
  ${shows.length ? '' : '<p>아직 등록된 프로그램이 없어요. 등록되면 여기에서 바로 들을 수 있어요.</p>'}
</section>
${continueCard}
${cards}
${signOut()}`,
  });
}

function signOut() {
  return `<section class="pod__card pod__card--quiet learn__account">
  <p>문의: <a href="mailto:${SUPPORT}">${SUPPORT}</a></p>
  <form method="post" action="/learn/logout"><button class="learn__link" type="submit">로그아웃</button></form>
</section>`;
}

function chapterList(chapters) {
  if (!chapters.length) return '';
  return chapters.map((c, i) => `<li><button class="learn__chapter" type="button" data-start="${c.start}" data-chapter="${i}"><span class="learn__chapter-time">${esc(clock(c.start))}</span><span class="learn__chapter-title">${esc(c.title)}</span></button></li>`).join('');
}

// /learn/<show>: the player (current episode), its chapters, then every module: released, listened, coming.
function programPage({ show, access, progress, current }) {
  const released = access.episodes.map((e) => e.episode);
  const upcoming = (access.scheduled || []).filter((e) => e.releaseAt > new Date() && !released.some((r) => r.id === e.episode.id));
  const cur = current || released.find((e) => !(progress.get(e.id) && progress.get(e.id).completed_at)) || released[0];

  const tracks = released.map((e) => {
    const p = progress.get(e.id);
    return {
      id: e.guid, src: audioUrl(e), title: e.title, label: episodeLabel(e), duration: Number(e.duration_seconds) || 0,
      position: p ? p.position_seconds : 0, done: Boolean(p && p.completed_at),
      chapters: Array.isArray(e.chapters) ? e.chapters : [],
    };
  });

  const items = released.map((e) => {
    const p = progress.get(e.id);
    const state = p && p.completed_at ? '<span class="learn__badge learn__badge--done">다 들음</span>'
      : p && p.position_seconds > 5 ? `<span class="learn__badge">${esc(clock(p.position_seconds))}까지 들음</span>`
        : '';
    const isCur = cur && e.id === cur.id;
    return `<li><a class="learn__item" href="/learn/${esc(show.slug)}?e=${esc(e.guid)}" data-track="${esc(e.guid)}"${isCur ? ' aria-current="true"' : ''}>
    <span class="learn__item-label">${esc(episodeLabel(e))}</span>
    <span class="learn__item-title">${esc(e.title)}</span>
    <span class="learn__item-meta">${esc(minutes(e.duration_seconds))}<span data-state="${esc(e.guid)}">${state}</span></span>
  </a></li>`;
  }).join('\n');

  const coming = upcoming.map((x) => `<li class="learn__item learn__item--coming">
    <span class="learn__item-label">${esc(episodeLabel(x.episode))}</span>
    <span class="learn__item-title">${esc(x.episode.title)}</span>
    <span class="learn__item-meta">${esc(releaseDate(x.releaseAt))} 공개 예정</span>
  </li>`).join('\n');

  const until = access.expires ? `<p class="pod__note">${esc(fullDate(lastDay(access.expires)))}까지 들을 수 있어요.</p>` : '';

  if (!cur) {
    return layout({
      title: `${show.title} · 내 강의실`,
      body: `<p class="learn__back"><a href="/learn">← 내 강의실</a></p>
<section class="pod__card">
  <p class="pod__eyebrow">${esc(show.title)}</p>
  <h1 class="pod__title">아직 공개된 모듈이 없어요</h1>
  ${access.next ? `<p>첫 모듈은 ${esc(releaseDate(access.next.releaseAt))}에 공개돼요.</p>` : ''}
  ${until}
</section>
${coming ? `<section class="pod__card"><h2 class="pod__h2">공개 예정</h2><ol class="learn__list">${coming}</ol></section>` : ''}
${signOut()}`,
    });
  }

  const curTrack = tracks.find((t) => t.id === cur.guid);
  const chapters = curTrack.chapters;
  const data = JSON.stringify({ show: show.slug, art: show.artwork_url || '', program: show.title, current: cur.guid, tracks }).replace(/</g, '\\u003c');

  return layout({
    title: `${cur.title} · ${show.title}`,
    script: '/assets/js/learn-player.js',
    body: `<p class="learn__back"><a href="/learn">← 내 강의실</a></p>
<section class="pod__card play" aria-labelledby="play-title">
  <div class="play__now">
    ${show.artwork_url ? `<img class="play__art" src="${esc(show.artwork_url)}" alt="" width="88" height="88">` : ''}
    <div class="play__now-text">
      <p class="play__show"><span data-label>${esc(episodeLabel(cur))}</span> · ${esc(show.title)}</p>
      <h1 class="play__title" id="play-title">${esc(cur.title)}</h1>
      <p class="learn__now-chapter" data-now-chapter aria-live="polite"></p>
    </div>
  </div>
  <audio class="play__audio" controls preload="metadata" src="${esc(curTrack.src)}"></audio>
  <div class="play__controls" hidden>
    <button class="play__btn" type="button" data-skip="-15" aria-label="15초 뒤로">−15초</button>
    <button class="play__btn play__btn--main" type="button" data-toggle aria-label="재생">재생</button>
    <button class="play__btn" type="button" data-skip="30" aria-label="30초 앞으로">+30초</button>
    <button class="play__btn play__btn--speed" type="button" data-speed aria-label="재생 속도 1배">1×</button>
  </div>
  <p class="play__resume" role="status"${curTrack.position > 5 ? '' : ' hidden'}>${curTrack.position > 5 ? esc(clock(curTrack.position)) + '부터 이어서 들어요.' : ''}</p>
</section>

<section class="pod__card learn__chapters" aria-labelledby="chapters-title"${chapters.length ? '' : ' hidden'}>
  <h2 class="pod__h2" id="chapters-title">챕터</h2>
  <ol class="learn__chapter-list" data-chapters>${chapterList(chapters)}</ol>
</section>

<section class="pod__card" aria-labelledby="modules-title">
  <h2 class="pod__h2" id="modules-title">${esc(show.title)}</h2>
  <ol class="learn__list">${items}</ol>
  ${coming ? `<h3 class="learn__h3">공개 예정</h3><ol class="learn__list">${coming}</ol>` : ''}
  ${until}
</section>
${signOut()}
<script type="application/json" id="learn-data">${data}</script>`,
  });
}

function messagePage({ title, text, status = '' }) {
  return layout({
    title,
    body: `<section class="pod__card"><h1 class="pod__title">${esc(title)}</h1><p>${esc(text)}</p>${status}
<p><a href="/learn">내 강의실로 가기</a></p></section>`,
  });
}

module.exports = { layout, loginPage, codePage, codeEmail, homePage, programPage, messagePage, clock, minutes, audioUrl, episodeLabel, MESSAGES };
