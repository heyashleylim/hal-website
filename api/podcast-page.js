/*
 * GET /podcast/<token> → the student's subscribe page (rewrite in vercel.json), server-rendered so it
 * reads correctly without JavaScript. JS only adds the "copy link" button.
 *
 * Header and footer are read from site/nsmb/index.html and site/index.html (vercel.json "includeFiles"),
 * so they stay the same as on every other page. No GTM or Web Analytics: the token is in the URL.
 */
const fs = require('node:fs');
const path = require('node:path');
const podcast = require('./_lib/podcast.js');
const release = require('./_lib/release.js');

const SITE = path.join(__dirname, '..', 'site');
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

function kstDate(date, withTime) {
  const opts = { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' };
  if (withTime) Object.assign(opts, { hour: 'numeric', minute: '2-digit' });
  return new Intl.DateTimeFormat('ko-KR', opts).format(date);
}

function kstFullDate(date) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}

function layout({ title, body }) {
  const { header, footer } = siteChrome();
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<link rel="icon" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/fonts.css">
<link rel="stylesheet" href="/assets/css/brand.css">
<link rel="stylesheet" href="/assets/css/header.css">
<link rel="stylesheet" href="/assets/css/footer.css">
<link rel="stylesheet" href="/assets/css/pages/podcast.css">
</head>
<body>
<a class="skip" href="#main">본문으로 건너뛰기</a>
${header}
<main id="main" class="pod">
${body}
</main>
${footer}
<script src="/assets/js/podcast.js" defer></script>
</body>
</html>`;
}

function notFoundPage() {
  return layout({
    title: '구독 링크를 찾을 수 없어요',
    body: `<section class="pod__card">
  <h1 class="pod__title">구독 링크를 찾을 수 없어요</h1>
  <p>링크가 잘렸거나 바뀌었을 수 있어요. 받은 이메일의 링크를 다시 눌러 주세요.</p>
  <p>계속 열리지 않으면 <a href="mailto:hello@ashleylim.com">hello@ashleylim.com</a>으로 알려 주세요.</p>
</section>`,
  });
}

function subscribePage({ base, show, cohort, listener, state, released, next, expires, query = '' }) {
  const feedUrl = `${base}/f/${listener.token}${query}`;
  const host = feedUrl.replace(/^https:\/\//, '');
  const support = show.support_email || 'hello@ashleylim.com';
  const name = listener.name ? `${esc(listener.name)}님, ` : '';

  if (state !== 'active') {
    const message = {
      expired: `수강 기간이 ${expires ? esc(kstFullDate(expires)) + '에 ' : ''}끝나 이 팟캐스트는 더 이상 들을 수 없어요.`,
      revoked: '이 구독 링크는 더 이상 사용할 수 없어요.',
      'no-cohort': '아직 기수가 배정되지 않았어요. 배정되면 이 페이지에서 구독할 수 있어요.',
    }[state];
    return layout({
      title: show.title,
      body: `<section class="pod__card">
  <p class="pod__eyebrow">비공개 팟캐스트</p>
  <h1 class="pod__title">${esc(show.title)}</h1>
  <p class="pod__notice" role="status">${message}</p>
  <p>궁금한 점은 <a href="mailto:${esc(support)}">${esc(support)}</a>으로 문의해 주세요.</p>
</section>`,
    });
  }

  const status = [];
  if (cohort) status.push(`<li><span>기수</span><strong>${esc(cohort.name)}</strong></li>`);
  status.push(`<li><span>공개된 에피소드</span><strong>${released.length}개</strong></li>`);
  status.push(`<li><span>다음 에피소드</span><strong>${next ? esc(kstDate(next.releaseAt, true)) : '모두 공개되었어요'}</strong></li>`);
  if (expires) status.push(`<li><span>들을 수 있는 기간</span><strong>${esc(kstFullDate(expires))}까지</strong></li>`);

  const intro = show.page_intro ? `<p class="pod__intro">${esc(show.page_intro)}</p>` : '';

  return layout({
    title: `${show.title} · 구독하기`,
    body: `<section class="pod__card">
  <p class="pod__eyebrow">비공개 팟캐스트</p>
  <h1 class="pod__title">${esc(show.title)}</h1>
  <p class="pod__lead">${name}평소 쓰는 팟캐스트 앱에서 바로 들을 수 있어요. 아래에서 앱을 골라 구독해 주세요.</p>
  ${intro}
  <ul class="pod__status">${status.join('')}</ul>
</section>

<section class="pod__card" aria-labelledby="apps-title">
  <h2 id="apps-title" class="pod__h2">휴대폰에서 구독하기</h2>
  <div class="pod__apps">
    <a class="btn btn--block" href="podcast://${esc(host)}">Apple 팟캐스트에 추가</a>
    <a class="pod__app" href="pktc://subscribe/${esc(host)}">Pocket Casts</a>
    <a class="pod__app" href="overcast://x-callback-url/add?url=${encodeURIComponent(feedUrl)}">Overcast</a>
  </div>
  <p class="pod__hint">다른 팟캐스트 앱(Podcast Addict 등)을 쓰신다면 아래 구독 주소를 복사해 앱의 ‘URL로 추가’ 메뉴에 붙여 넣어 주세요. 단계별 안내는 <a href="/podcast/help">구독 방법 안내</a>에 있어요.</p>
  <label class="pod__label" for="feed-url">나만의 구독 주소</label>
  <div class="pod__copy">
    <input id="feed-url" class="pod__input" type="text" value="${esc(feedUrl)}" readonly>
    <button class="pod__copy-btn" type="button" data-copy="#feed-url" hidden>복사</button>
  </div>
  <p class="pod__note">이 주소는 ${listener.name ? esc(listener.name) + '님' : '나'}만을 위한 주소예요. 다른 사람과 공유하지 말아 주세요.</p>
</section>

<section class="pod__card pod__card--quiet">
  <h2 class="pod__h2">Spotify는 지원되지 않아요</h2>
  <p>비공개 팟캐스트는 Spotify에 추가할 수 없어요. iPhone에서는 Apple 팟캐스트, Android에서는 Pocket Casts 같은 팟캐스트 앱을 이용해 주세요.</p>
  <p>문의: <a href="mailto:${esc(support)}">${esc(support)}</a></p>
</section>`,
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    return res.end();
  }

  const token = new URL(req.url, 'http://local').searchParams.get('token') || '';
  let ctx;
  try {
    ctx = await podcast.loadByToken(token);
  } catch (err) {
    console.error('podcast-page', err);
    res.statusCode = 503;
    return res.end(layout({ title: '잠시 후 다시 시도해 주세요', body: '<section class="pod__card"><h1 class="pod__title">잠시 후 다시 시도해 주세요</h1><p>일시적인 문제로 페이지를 불러오지 못했어요.</p></section>' }));
  }
  if (!ctx) {
    res.statusCode = 404;
    return res.end(notFoundPage());
  }

  const now = new Date();
  const { state, episodes, next } = podcast.releasedFor(ctx, now);
  const expires = release.expiresAt(ctx);
  res.statusCode = 200;
  return res.end(subscribePage({ base: podcast.baseUrl(req), show: ctx.show, cohort: ctx.cohort, listener: ctx.listener, state, released: episodes, next, expires, query: podcast.linkQuery() }));
};

module.exports.subscribePage = subscribePage;
module.exports.notFoundPage = notFoundPage;
