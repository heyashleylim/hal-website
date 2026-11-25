/*
 * Writes a review form's page and its thank-you page from api/_lib/students/forms.js (questions, hints, page copy):
 *
 *   node tools/students/review-page.js <form key>        e.g. nsmb → site/nsmb/review/ and site/nsmb/review/thanks/
 *
 * Same look and steps as the NSMB waitlist page (css/waitlist-flow.css + js/review-flow.js): name and email, then one
 * question at a time. The header and footer are copied from site/nsmb/waitlist/index.html, so run this again after
 * changing them. GTM and Vercel Analytics are included (public pages); the pages are noindex.
 * tests/students/reviews.test.js checks every page matches its form.
 */
const fs = require('node:fs');
const path = require('node:path');
const { FORMS } = require('../../api/_lib/students/forms.js');

const ROOT = path.join(__dirname, '..', '..');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function head({ title, description, canonical }) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-MK4FNWNV');</script>
<!-- End Google Tag Manager -->
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - Ashley Lim</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="https://www.ashleylim.com/${canonical}">
<meta name="robots" content="noindex">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="icon" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/assets/fonts/gmarket-sans-500.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/pretendard-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/css/fonts.css">
<link rel="stylesheet" href="/assets/css/brand.css">
<link rel="stylesheet" href="/assets/css/header.css">
<link rel="stylesheet" href="/assets/css/footer.css">
<link rel="stylesheet" href="/assets/css/waitlist-flow.css">
<style>
/* Review form (js/review-flow.js), written by tools/students/review-page.js: name and email, then one question at a
   time, like /nsmb/waitlist. Without JS every question shows and the form posts to /api/review as a normal form. */
.wl-page{min-height:calc(100vh - 60px);display:flex;align-items:flex-start;justify-content:center;padding:56px var(--gutter) 72px;background:var(--bg)}
.wl-card{max-width:var(--w-narrow);width:100%;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-xl);padding:44px 40px;box-shadow:0 30px 64px -34px rgba(34,34,34,.25)}
.wl-card__k{font-size:14px;font-weight:700;color:var(--rose);margin-bottom:12px}
.wl-card h1{font-size:28px;line-height:1.4;margin-bottom:12px;word-break:keep-all}
.wl-card__intro{color:var(--ink-2);line-height:1.6;margin-bottom:28px}
.wl-card__intro p+p{margin-top:10px}
.wl-card.is-started .wl-card__intro{display:none}
.wl-card.is-started h1{font-size:20px;margin-bottom:20px}
.wl-card.is-done .wl-card__k,.wl-card.is-done h1{display:none}
.rvf fieldset{border:0;margin:0;padding:0;min-width:0}
.rvf__step+.rvf__step{margin-top:36px}
.rvf.is-flow .rvf__step+.rvf__step{margin-top:0}
.rvf__hint{margin:-6px 0 14px;line-height:1.6;word-break:keep-all}
.rvf textarea{min-height:180px}
.rvf__send{margin-top:28px}
.rvf.is-flow .rvf__send{display:none}
.consent+.consent{margin-top:10px}
.rvf__saved{font-size:12.5px;color:var(--muted);margin-top:8px;min-height:1em}
@media (max-width:767px){.wl-page{padding:28px var(--gutter) 48px}.wl-card{padding:30px 20px}.wl-card h1{font-size:22px}}
</style>
<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>
<script defer src="/_vercel/insights/script.js"></script>
</head>
<body>
<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-MK4FNWNV"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->
<a class="skip" href="#main">본문으로 건너뛰기</a>
`;
}

function chrome() {
  const wl = fs.readFileSync(path.join(ROOT, 'site', 'nsmb', 'waitlist', 'index.html'), 'utf8');
  const header = wl.slice(wl.indexOf('<header class="site-header">'), wl.indexOf('</header>') + 9);
  const footer = wl.slice(wl.indexOf('<footer class="site-footer">'), wl.indexOf('</footer>') + 9);
  if (!header.startsWith('<header') || !footer.startsWith('<footer')) throw new Error('header or footer not found in site/nsmb/waitlist/index.html');
  return { header, footer };
}

function formPage(key, f, { header, footer }) {
  const n = f.questions.length + 1;
  const steps = f.questions.map((q, i) => {
    const hintId = `rv-${q.key}-hint`;
    return `
        <fieldset class="wlf__step rvf__step" data-step="${q.key}">
          <label class="wlf__q" for="rv-${q.key}"><span class="wlf__n">Q${i + 1}${q.required ? '' : ' · 선택'}</span>${esc(q.ko)}</label>` +
      (q.hint ? `
          <p class="wlf__hint rvf__hint" id="${hintId}">${esc(q.hint)}</p>` : '') + `
          <textarea id="rv-${q.key}" name="q_${q.key}" rows="7" maxlength="10000"${q.required ? ' data-required' : ''} aria-describedby="rv-${q.key}-err${q.hint ? ' ' + hintId : ''}"></textarea>
          <p class="err" id="rv-${q.key}-err" aria-live="polite"></p>
          <div class="wlf__nav" hidden><button class="wlf__back" type="button">← 이전</button><button class="btn" type="button" data-next>${i === f.questions.length - 1 ? '후기 보내기' : '다음 →'}</button></div>
        </fieldset>`;
  }).join('');
  return head({ title: f.title_ko, description: f.page.description, canonical: f.page.path }) + `${header}

<main class="wl-page" id="main">
  <div class="wl-card">
    <p class="wl-card__k">${esc(f.title_ko)}</p>
    <h1>${esc(f.page.heading)}</h1>
    <div class="wl-card__intro">
${f.page.intro.map((p) => `      <p>${esc(p)}</p>`).join('\n')}
      <p>질문은 모두 ${f.questions.length}가지예요. 적어 주신 내용은 이 기기에 임시로 저장되니, 천천히 써 주셔도 괜찮아요.</p>
    </div>
    <!-- One review = name, email, then each answer. Posts to /api/review (api/review.js) → the admin's Students section.
         Written by tools/students/review-page.js from api/_lib/students/forms.js (${key}): edit the questions there. -->
    <form class="wlf rvf" data-review-flow data-form="${key}" action="/api/review" method="post" novalidate>
      <input type="hidden" name="form" value="${key}">
      <div class="wlf__progress" hidden aria-hidden="true"><span class="wlf__bar"><i></i></span><span class="wlf__count">1 / ${n}</span></div>

      <fieldset class="wlf__step rvf__step" data-step="contact">
        <legend class="sr-only">보내는 분</legend>
        <div class="hp" aria-hidden="true"><label for="rv-website">웹사이트</label><input id="rv-website" name="website" type="text" tabindex="-1" autocomplete="off"></div>
        <div class="field">
          <label for="rv-name">이름 <span class="req" aria-hidden="true">*</span></label>
          <input id="rv-name" name="name" type="text" autocomplete="name" placeholder="홍길동" required aria-describedby="rv-name-err">
          <p class="err" id="rv-name-err" aria-live="polite"></p>
        </div>
        <div class="field">
          <label for="rv-email">이메일 <span class="req" aria-hidden="true">*</span></label>
          <input id="rv-email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="email@example.com" required aria-describedby="rv-email-err rv-email-hint">
          <p class="wlf__hint" id="rv-email-hint">${esc(f.page.email_hint)}</p>
          <p class="err" id="rv-email-err" aria-live="polite"></p>
        </div>
        <label class="consent"><input type="checkbox" name="consent" value="1" id="rv-consent" required aria-describedby="rv-consent-err"><span>[필수] 후기 수집과 이용에 동의합니다. 자세한 내용은 <a href="/privacy-policy">개인정보처리방침</a>을 확인해 주세요.</span></label>
        <label class="consent"><input type="checkbox" name="share" value="1" id="rv-share"><span>[선택] 제 후기를 이름을 가린 채(예: 김00) 소개하는 데 동의합니다.</span></label>
        <p class="err" id="rv-consent-err" aria-live="polite"></p>
        <div class="wlf__nav" hidden><span></span><button class="btn" type="button" data-next>시작하기 →</button></div>
      </fieldset>
${steps}

      <button class="btn btn--block rvf__send" type="submit">후기 보내기</button>
      <p class="rvf__saved" aria-live="polite"></p>
      <div class="wlf__step wlf__done" data-step="done" hidden tabindex="-1">
        <h2 data-done-title>THANK YOU 💌</h2>
        <p>소중한 후기 잘 받았어요. 함께해 주셔서 고마워요.</p>
      </div>
      <p class="form-msg wlf__msg" role="status" aria-live="polite"></p>
    </form>
  </div>
</main>

${footer}
<script src="/assets/js/review-flow.js" defer></script>
</body>
</html>
`;
}

function thanksPage(f, { header, footer }) {
  return head({ title: f.title_ko, description: f.page.description, canonical: f.page.path + '/thanks' }) + `${header}

<main class="wl-page" id="main">
  <div class="wl-card is-done">
    <div class="wlf__done">
      <h1 style="display:block">THANK YOU 💌</h1>
      <p>소중한 후기 잘 받았어요. 함께해 주셔서 고마워요.</p>
    </div>
  </div>
</main>

${footer}
</body>
</html>
`;
}

const key = process.argv[2];
const f = FORMS[key];
if (!f || !f.page) { console.error(`usage: review-page.js <form key>   (forms: ${Object.keys(FORMS).join(', ')})`); process.exit(1); }
const parts = chrome();
const dir = path.join(ROOT, 'site', f.page.path);
fs.mkdirSync(path.join(dir, 'thanks'), { recursive: true });
fs.writeFileSync(path.join(dir, 'index.html'), formPage(key, f, parts));
fs.writeFileSync(path.join(dir, 'thanks', 'index.html'), thanksPage(f, parts));
console.log(`site/${f.page.path}/index.html and thanks/ written (${f.questions.length} questions)`);
