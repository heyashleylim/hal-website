/*
 * HTML of the student area (/learn), rendered on the server so every page reads and works without JavaScript
 * (the player script only adds skip/speed buttons, chapter jumps, progress saving and auto-next).
 * Pure functions of their data: unit-tested in tests/learn/pages.test.js. Korean copy for students.
 *
 * Header and footer are the site's. No GTM or analytics: these pages are private.
 */
const fs = require('node:fs');
const path = require('node:path');
const { extension } = require('../rss.js');
const { studentLabel } = require('../episodes.js');

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

const episodeLabel = studentLabel;

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
<meta name="referrer" content="same-origin">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="내 강의실">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/learn.webmanifest">
<meta name="theme-color" content="#FFFDF7">
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
  'check-failed': '지금은 확인할 수 없어요. 잠시 후 다시 시도해 주세요.',
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
  <p class="pod__note">비밀번호는 없어요. 한 번 로그인하면 이 기기에서는 30일 동안 로그인 상태가 유지되고, 들어올 때마다 다시 30일로 늘어나요.</p>
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
function homePage({ student, shows, progress, resume, welcome = false }) {
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
    <li><span>공개된 강의</span><strong>${c.released}개${c.total > c.released ? ` / 전체 ${c.total}개` : ''}</strong></li>
    <li><span>다 들은 강의</span><strong>${c.done}개</strong></li>
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
${welcome ? installCard({ first: true }) : ''}
${continueCard}
${cards}
${welcome ? '' : `<p class="learn__install-link"><a href="/learn/help#app">휴대폰 홈 화면에 저장하는 방법</a></p>`}
${signOut()}`,
  });
}

// How to save the student area on a phone or tablet's home screen. Mobile and tablet only (said in the heading).
function installSteps() {
  return `<h3 class="learn__h3">iPhone · iPad (Safari)</h3>
  <ol class="pod__steps">
    <li>Safari에서 이 페이지를 연 채로 <strong>공유 버튼</strong>(네모에 위쪽 화살표)을 눌러요. 화면 아래에 없으면 주소창 옆 <strong>⋯</strong> 버튼을 먼저 눌러요.</li>
    <li>목록을 아래로 내려 <strong>홈 화면에 추가</strong>를 골라요.</li>
    <li>오른쪽 위 <strong>추가</strong>를 누르면 홈 화면에 ‘내 강의실’ 아이콘이 생겨요.</li>
  </ol>
  <h3 class="learn__h3">Android (Chrome)</h3>
  <ol class="pod__steps">
    <li>Chrome에서 이 페이지를 연 채로 오른쪽 위 <strong>⋮</strong> 메뉴를 눌러요.</li>
    <li><strong>홈 화면에 추가</strong> 또는 <strong>앱 설치</strong>를 골라요.</li>
    <li><strong>추가</strong>(또는 설치)를 누르면 홈 화면에 아이콘이 생겨요. 삼성 인터넷은 <strong>≡</strong> 메뉴 › <strong>페이지 추가</strong> › <strong>홈 화면</strong>이에요.</li>
  </ol>
  <p class="pod__note">홈 화면 아이콘으로 처음 열면 로그인을 한 번 더 해 주세요. 그다음부터는 바로 열려요.</p>`;
}

function installCard({ first = false } = {}) {
  return `<section class="pod__card learn__install" aria-labelledby="install-title">
  <p class="pod__eyebrow">휴대폰 · 태블릿 전용 안내</p>
  <h2 class="pod__h2" id="install-title">${first ? '먼저, 내 강의실을 홈 화면에 저장해 주세요' : '홈 화면에 저장하기'}</h2>
  <p>앱처럼 아이콘을 눌러 바로 열 수 있고, 화면을 꺼도 계속 듣고 잠금 화면에서 재생을 조절할 수 있어요. 컴퓨터에서는 따로 저장할 필요 없이 이 주소로 들어오면 돼요.</p>
  ${installSteps()}
</section>`;
}

function signOut() {
  return `<section class="pod__card pod__card--quiet learn__account">
  <p><a href="/learn/help">이용 안내</a> · 문의: <a href="mailto:${SUPPORT}">${SUPPORT}</a></p>
  <form method="post" action="/learn/logout"><button class="learn__link" type="submit">로그아웃</button></form>
</section>`;
}

function chapterList(chapters) {
  if (!chapters.length) return '';
  return chapters.map((c, i) => `<li><button class="learn__chapter" type="button" data-start="${c.start}" data-chapter="${i}"><span class="learn__chapter-time">${esc(clock(c.start))}</span><span class="learn__chapter-title">${esc(c.title)}</span></button></li>`).join('');
}

// /learn/<show>: the player (current episode), its chapters, then every module: released, listened, coming.
// Listening in a podcast app instead (offline): the student's private feed, as on the old personal page.
function feedSection({ show, feedUrl }) {
  if (!feedUrl) return '';
  const host = feedUrl.replace(/^https:\/\//, '');
  return `<details class="pod__card learn__feed">
  <summary class="learn__feed-summary"><span class="pod__h2">팟캐스트 앱으로 듣기</span><span class="learn__muted">인터넷 없이 듣고 싶을 때</span></summary>
  <p>Apple 팟캐스트 같은 앱에 추가하면 미리 내려받아 인터넷 없이도 들을 수 있어요. 진도는 여기 내 강의실과 따로 기록돼요.</p>
  <div class="pod__apps">
    <a class="btn btn--block" href="podcast://${esc(host)}">Apple 팟캐스트에 추가</a>
    <a class="pod__app" href="pktc://subscribe/${esc(host)}">Pocket Casts</a>
    <a class="pod__app" href="overcast://x-callback-url/add?url=${encodeURIComponent(feedUrl)}">Overcast</a>
  </div>
  <label class="pod__label" for="feed-${esc(show.slug)}">나만의 구독 주소</label>
  <div class="pod__copy">
    <input id="feed-${esc(show.slug)}" class="pod__input" type="text" value="${esc(feedUrl)}" readonly>
    <button class="pod__copy-btn" type="button" data-copy="#feed-${esc(show.slug)}" hidden>복사</button>
  </div>
  <p class="pod__note">나만을 위한 주소예요. 다른 사람과 공유하지 말아 주세요. 다른 앱에 추가하는 방법은 <a href="/learn/help#podcast-apps">이용 안내</a>에 있어요.</p>
</details>`;
}

function programPage({ show, access, progress, current, feedUrl = '' }) {
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
  <h1 class="pod__title">아직 공개된 강의가 없어요</h1>
  ${access.next ? `<p>첫 강의는 ${esc(releaseDate(access.next.releaseAt))}에 공개돼요.</p>` : ''}
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
  <h2 class="pod__h2" id="chapters-title">Chapters</h2>
  <ol class="learn__chapter-list" data-chapters>${chapterList(chapters)}</ol>
</section>

<section class="pod__card" aria-labelledby="modules-title">
  <h2 class="pod__h2" id="modules-title">${esc(show.title)}</h2>
  ${show.page_intro ? `<p class="pod__intro learn__intro">${esc(show.page_intro)}</p>` : ''}
  <ol class="learn__list">${items}</ol>
  ${coming ? `<h3 class="learn__h3">공개 예정</h3><ol class="learn__list">${coming}</ol>` : ''}
  ${until}
</section>
${feedSection({ show, feedUrl })}
${signOut()}
<script type="application/json" id="learn-data">${data}</script>`,
  });
}

const APPS = [
  ['apple', 'Apple 팟캐스트', 'iPhone · iPad · Mac', `<h3 class="learn__h3">버튼으로 추가하기</h3><ol class="pod__steps"><li>‘팟캐스트 앱으로 듣기’에서 <strong>Apple 팟캐스트에 추가</strong>를 눌러요.</li><li>앱이 열리면 <strong>팔로우</strong>를 눌러요. <strong>보관함 › 프로그램</strong>에서 언제든 찾을 수 있어요.</li></ol>
  <h3 class="learn__h3">버튼이 안 될 때</h3><ol class="pod__steps"><li>구독 주소를 <strong>복사</strong>해요.</li><li>Apple 팟캐스트의 <strong>보관함</strong>에서 오른쪽 위 <strong>⋯</strong>를 누르고 <strong>URL로 프로그램 팔로우</strong>(Follow a Show by URL)를 골라요.</li><li>주소를 붙여 넣고 <strong>팔로우</strong>를 눌러요.</li></ol>`],
  ['pocketcasts', 'Pocket Casts', 'iPhone · Android', `<ol class="pod__steps"><li><strong>Pocket Casts</strong> 버튼을 누르고, 앱이 열리면 <strong>구독</strong>(Subscribe)을 눌러요.</li><li>버튼이 안 되면 구독 주소를 복사해 Pocket Casts의 <strong>검색</strong> 칸에 붙여 넣어요.</li></ol>`],
  ['overcast', 'Overcast', 'iPhone', `<ol class="pod__steps"><li><strong>Overcast</strong> 버튼을 누르고, 앱이 열리면 <strong>구독</strong>(Subscribe)을 눌러요.</li><li>버튼이 안 되면 주소를 복사해 첫 화면 오른쪽 위 <strong>+</strong> › <strong>Add URL</strong>에 붙여 넣어요.</li></ol>`],
  ['other', '그 밖의 앱', 'Castro · Podcast Addict · AntennaPod', `<ol class="pod__steps"><li>구독 주소를 <strong>복사</strong>해요.</li><li>앱의 팟캐스트 추가 메뉴(보통 <strong>+</strong>)에서 <strong>URL로 추가</strong> 또는 <strong>RSS 피드</strong>를 골라 붙여 넣어요.</li></ol><p>Spotify, YouTube Music처럼 주소로 추가하는 기능이 없는 앱에서는 들을 수 없어요.</p>`],
];

function helpPage() {
  return layout({
    title: '이용 안내 · 내 강의실',
    body: `<p class="learn__back"><a href="/learn">← 내 강의실</a></p>
<section class="pod__card">
  <p class="pod__eyebrow">내 강의실</p>
  <h1 class="pod__title">이용 안내</h1>
  <p class="pod__lead">내 강의실에서 프로그램의 모든 강의를 듣고, 어디까지 들었는지도 자동으로 기억돼요. 휴대폰, 태블릿, 컴퓨터 어디서든 같은 진도로 이어 들을 수 있어요.</p>
  <p class="pod__jump"><a href="#login">로그인</a> · <a href="#app">홈 화면에 저장하기</a> · <a href="#listen">듣기</a> · <a href="#podcast-apps">팟캐스트 앱으로 듣기</a> · <a href="#faq">자주 묻는 질문</a></p>
</section>

<section class="pod__card" aria-labelledby="login">
  <h2 class="pod__h2" id="login">로그인</h2>
  <ol class="pod__steps">
    <li><a href="/learn/login">www.ashleylim.com/learn</a>에서 <strong>프로그램을 신청할 때 쓴 이메일</strong>을 입력해요.</li>
    <li>메일로 온 <strong>6자리 코드</strong>를 입력해요. 코드는 10분 동안 쓸 수 있어요.</li>
    <li>한 번 로그인하면 그 기기에서는 30일 동안 로그인 상태가 유지되고, 들어올 때마다 다시 30일로 늘어나요.</li>
  </ol>
  <p>메일이 오지 않으면 스팸함과 프로모션함을 확인해 주세요. 신청할 때 쓴 이메일이 아니면 코드가 가지 않아요.</p>
</section>

<section class="pod__card" aria-labelledby="app">
  <p class="pod__eyebrow">휴대폰 · 태블릿 전용</p>
  <h2 class="pod__h2" id="app">홈 화면에 저장하기</h2>
  <p>홈 화면에 저장하면 앱처럼 아이콘으로 바로 열리고, 화면을 꺼도 계속 들으면서 잠금 화면에서 재생을 조절할 수 있어요. 컴퓨터에서는 저장할 필요가 없어요.</p>
  ${installSteps()}
</section>

<section class="pod__card" aria-labelledby="listen">
  <h2 class="pod__h2" id="listen">듣기</h2>
  <ul class="pod__steps">
    <li>강의는 기수 일정에 맞춰 공개돼요. 공개 예정인 강의는 날짜와 함께 목록에 보여요.</li>
    <li><strong>Chapters</strong>에서 듣고 싶은 부분을 누르면 바로 그 부분부터 재생돼요.</li>
    <li>−15초, +30초 버튼과 재생 속도(0.75–2배)를 쓸 수 있어요. 한 강의가 끝나면 다음 강의가 이어서 재생돼요.</li>
    <li>90% 넘게 들으면 ‘다 들음’으로 표시돼요.</li>
  </ul>
</section>

<section class="pod__card" aria-labelledby="podcast-apps">
  <h2 class="pod__h2" id="podcast-apps">팟캐스트 앱으로 듣기</h2>
  <p>인터넷 없이 듣고 싶다면 강의 페이지 아래 <strong>‘팟캐스트 앱으로 듣기’</strong>를 열어 앱에 추가해 주세요. 앱에서 들은 진도는 내 강의실에 기록되지 않아요.</p>
  ${APPS.map(([id, name, where, steps]) => `<h3 class="learn__h3" id="app-${id}">${name} <span class="pod__muted">${where}</span></h3>${steps}`).join('\n  ')}
</section>

<section class="pod__card" aria-labelledby="faq">
  <h2 class="pod__h2" id="faq">자주 묻는 질문</h2>
  <h3 class="learn__h3">새 강의가 보이지 않아요.</h3>
  <p>강의는 정해진 날짜와 시간에 공개돼요. 시간이 지났는데 보이지 않으면 페이지를 새로고침해 주세요.</p>
  <h3 class="learn__h3">다른 기기에서도 들을 수 있나요?</h3>
  <p>네. 같은 이메일로 로그인하면 어느 기기에서든 들은 곳부터 이어서 들을 수 있어요.</p>
  <h3 class="learn__h3">언제까지 들을 수 있나요?</h3>
  <p>수강 기간은 내 강의실의 프로그램 카드에 적혀 있어요.</p>
  <h3 class="learn__h3">그 밖의 문의</h3>
  <p><a href="mailto:${SUPPORT}">${SUPPORT}</a>으로 보내 주세요.</p>
</section>`,
  });
}

function messagePage({ title, text, status = '' }) {
  return layout({
    title,
    body: `<section class="pod__card"><h1 class="pod__title">${esc(title)}</h1><p>${esc(text)}</p>${status}
<p><a href="/learn">내 강의실로 가기</a></p></section>`,
  });
}

module.exports = { layout, loginPage, codePage, codeEmail, homePage, programPage, helpPage, installCard, messagePage, clock, minutes, audioUrl, episodeLabel, MESSAGES };
