/*
 * The checkout and thank-you pages, rendered on the server (pure: data in, HTML out), so the product, the
 * prices and the texts are in the page itself and the form works without JavaScript.
 * Styles: site/assets/css/pages/checkout.css. Behaviour: site/assets/js/checkout.js.
 *
 * Every value that isn't written in this file goes through esc(). The two exceptions, both set by the admin
 * only, are the consent line (may contain links: sanitised by consentHtml) and the business details, which
 * are read from the site footer in site/index.html so they always match it.
 */
const fs = require('node:fs');
const path = require('node:path');
const copy = require('./copy.ko.js');
const pricing = require('./pricing.js');
const validate = require('./validate.js');

const GTM_ID = 'GTM-MK4FNWNV'; // the container used on every public page (tools/rebuild/gtm.py)
const SITE = path.join(__dirname, '..', '..', '..', 'site');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// JSON placed inside a <script> element: nothing in it may close the element or start a comment.
const json = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

let chromeCache = null;
// The site's own header and footer, read from the pages that define them (CLAUDE.md: header in
// site/nsmb/index.html, footer in site/index.html), so the checkout always matches the rest of the site.
function siteChrome() {
  if (chromeCache) return chromeCache;
  const read = (file) => { try { return fs.readFileSync(path.join(SITE, file), 'utf8'); } catch (_) { return ''; } };
  chromeCache = {
    header: (read('nsmb/index.html').match(/<header class="site-header">[\s\S]*?<\/header>/) || [''])[0],
    footer: (read('index.html').match(/<footer class="site-footer">[\s\S]*?<\/footer>/) || [''])[0],
  };
  return chromeCache;
}

// The consent line may link to the policies. Only <a href="/site-path"> survives; everything else is text.
function consentHtml(text) {
  const src = String(text || '').trim() || copy.consent;
  let out = '';
  const re = /<a\s+href="(\/[A-Za-z0-9/_-]*)"[^>]*>([^<]*)<\/a>/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index)) + `<a href="${esc(m[1])}" target="_blank" rel="noopener">${esc(m[2])}</a>`;
    last = m.index + m[0].length;
  }
  return out + esc(src.slice(last));
}

const gtmHead = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');</script>
<!-- End Google Tag Manager -->`;
const gtmBody = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;
const analytics = `<script>window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };</script>
<script defer src="/_vercel/insights/script.js"></script>`;

/*
 * layout({ title, body, data, beforeTags, home })
 *   data        JSON for checkout.js (<script type="application/json" id="co-data">)
 *   beforeTags  inline script that must run before GTM (the thank-you page hides the order token from tags)
 */
function layout({ title, body, data = null, beforeTags = '', refresh = null }) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
${beforeTags ? `<script>${beforeTags}</script>\n` : ''}${gtmHead}
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="referrer" content="same-origin">
<meta name="format-detection" content="telephone=no">
${refresh ? `<noscript><meta http-equiv="refresh" content="${esc(refresh)}"></noscript>\n` : ''}<title>${esc(title)}</title>
<link rel="icon" href="/favicon.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="stylesheet" href="/assets/css/fonts.css">
<link rel="stylesheet" href="/assets/css/brand.css">
<link rel="stylesheet" href="/assets/css/header.css">
<link rel="stylesheet" href="/assets/css/footer.css">
<link rel="stylesheet" href="/assets/css/pages/checkout.css">
${analytics}
</head>
<body class="co">
${gtmBody}
<a class="skip" href="#main">${esc(copy.skip)}</a>
${siteChrome().header}
<main id="main" class="co-main">
${body}
</main>
${siteChrome().footer}
${data ? `<script type="application/json" id="co-data">${json(data)}</script>\n` : ''}<script src="/assets/js/checkout.js" defer></script>
</body>
</html>`;
}

const homeOf = (product) => {
  const page = product && product.content && product.content.page;
  return page && /^\/[A-Za-z0-9/_-]*$/.test(page) ? page : '/';
};

function field({ name, label, value = '', error = '', hint = '', type = 'text', attrs = '', wide = false }) {
  const describe = [hint ? `${name}-hint` : '', `${name}-error`].filter(Boolean).join(' ');
  return `<div class="co-field${wide ? ' co-field--wide' : ''}${error ? ' is-invalid' : ''}" data-field="${esc(name)}">
      <label for="co-${esc(name)}">${esc(label)}</label>
      <input id="co-${esc(name)}" name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" aria-describedby="${esc(describe)}"${error ? ' aria-invalid="true"' : ''} ${attrs}>
      ${hint ? `<p class="co-field__hint" id="${esc(name)}-hint">${esc(hint)}</p>` : ''}
      <p class="co-field__error" id="${esc(name)}-error" role="alert">${esc(error)}</p>
    </div>`;
}

const errorText = (errors, name) => (errors && errors[name] ? copy.errors[errors[name]] || copy.problems.invalid : '');

const LOCK = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M7 10V7a5 5 0 0 1 10 0v3h1.5A1.5 1.5 0 0 1 20 11.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-8A1.5 1.5 0 0 1 5.5 10zm2 0h6V7a3 3 0 0 0-6 0z" fill="currentColor"/></svg>';
const TICK = '<svg class="co-tick" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M6.4 11.6 3.2 8.4l1.1-1.1 2.1 2.1 5.3-5.3 1.1 1.1z" fill="currentColor"/></svg>';

// One numbered step of the form.
function step(n, title, inner) {
  return `<fieldset class="co-step">
        <legend><span class="co-step__n" aria-hidden="true">${n}</span>${esc(title)}</legend>
        ${inner}
      </fieldset>`;
}

// Beside the form: what the buyer gets, the guarantee, what others said. All of it comes from the product
// (set in the admin); a part with nothing to show is left out.
function side(product, texts) {
  const c = product.content || {};
  const included = Array.isArray(c.included) ? c.included.filter(Boolean) : [];
  const image = c.image && /^\/[A-Za-z0-9/_.-]+\.(webp|jpg|jpeg|png)$/.test(c.image) ? c.image : '';
  const guarantee = String(c.guarantee || texts.guarantee || '').trim();
  const [gTitle, ...gBody] = guarantee.split('\n').map((x) => x.trim()).filter(Boolean);
  const reviews = Array.isArray(c.testimonials) ? c.testimonials.filter((r) => r && r.text) : [];
  const parts = [];
  if (image || included.length) {
    parts.push(`<section class="co-box" aria-labelledby="co-inc-title">
      ${image ? `<img class="co-box__img" src="${esc(image)}" alt="" width="640" height="360" loading="lazy">` : ''}
      ${included.length ? `<h2 class="co-box__title" id="co-inc-title">${esc(copy.side.included)}</h2>
      <ul class="co-list">${included.map((x) => `<li>${TICK}<span>${esc(x)}</span></li>`).join('')}</ul>` : `<h2 class="sr-only" id="co-inc-title">${esc(product.name)}</h2>`}
    </section>`);
  }
  if (gTitle) {
    parts.push(`<section class="co-box co-box--guarantee" aria-labelledby="co-g-title">
      <h2 class="co-box__title" id="co-g-title">${esc(gTitle)}</h2>
      ${gBody.map((x) => `<p>${esc(x)}</p>`).join('')}
    </section>`);
  }
  if (reviews.length) {
    parts.push(`<section class="co-reviews" aria-labelledby="co-r-title">
      <h2 class="co-box__title" id="co-r-title">${esc(copy.side.reviews)}</h2>
      ${reviews.map((r) => `<figure class="t-card co-review"><blockquote class="t-card__body">${esc(r.text).replace(/\n/g, '<br>')}</blockquote>${r.name ? `<figcaption class="t-card__by">${esc(r.name)}</figcaption>` : ''}</figure>`).join('')}
    </section>`);
  }
  parts.push(`<p class="co-help">${esc(copy.closed.contact)}</p>`);
  return `<aside class="co-side">${parts.join('\n')}</aside>`;
}

/*
 * The checkout page: an order form in the ThriveCart / ClickFunnels manner. One column of numbered steps
 * (who, where, how to pay), the order and its total right above one large button, and beside it what the
 * buyer gets, the guarantee and reviews.
 *   product, offers   the product and its priced offers (orders.offers)
 *   currency          'KRW' | 'USD' being shown
 *   values, errors    what the buyer typed and the problems found (after a failed submit without JavaScript)
 *   problem           a code from copy.problems to show above the form
 *   settings          shop settings (checkout_texts)
 *   query             campaign values to carry through the form
 */
function checkoutPage({ product, offers, currency, values = {}, errors = null, problem = '', settings = {}, query = {} }) {
  const mine = offers.filter((o) => o.currency === currency);
  const offer = mine[0];
  const other = offers.find((o) => o.currency !== currency);
  const texts = (settings && settings.checkout_texts) || {};
  const isUsd = currency === 'USD';
  const price = pricing.formatMoney(offer.dueToday, offer.currency);
  const payLabel = copy.pay(price);
  const v = (name) => (values && values[name] != null ? String(values[name]) : '');
  const source = validate.sourceInput(query);
  const switchUrl = other ? `/checkout/${product.slug}${other.currency === 'USD' ? '?currency=usd' : ''}` : '';
  const c = product.content || {};

  const me = `<div class="co-fields">
          ${field({ name: 'name', label: copy.fields.name, value: v('name'), error: errorText(errors, 'name'), attrs: 'autocomplete="name" maxlength="60" required' })}
          ${field({ name: 'phone', label: copy.fields.phone, value: v('phone'), error: errorText(errors, 'phone'), type: 'tel', attrs: `autocomplete="tel" inputmode="tel" maxlength="20" required${isUsd ? ' placeholder="+1 415 555 0123"' : ' placeholder="010-1234-5678"'}` })}
          ${field({ name: 'email', label: copy.fields.email, value: v('email'), error: errorText(errors, 'email'), hint: copy.fields.emailHint, type: 'email', wide: true, attrs: 'autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254" required' })}
        </div>`;

  const address = `<div class="co-fields">
          ${isUsd
    ? `<div class="co-field${errors && errors.country ? ' is-invalid' : ''}" data-field="country">
      <label for="co-country">${esc(copy.fields.country)}</label>
      <select id="co-country" name="country" autocomplete="country" required aria-describedby="country-error"${errors && errors.country ? ' aria-invalid="true"' : ''}>
        <option value="">${esc(copy.fields.chooseCountry)}</option>
        ${validate.countries().map((x) => `<option value="${esc(x.code)}"${v('country') === x.code ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
      </select>
      <p class="co-field__error" id="country-error" role="alert">${esc(errorText(errors, 'country'))}</p>
    </div>
    ${field({ name: 'postcode', label: copy.fields.postcodeOptional, value: v('postcode'), error: errorText(errors, 'postcode'), attrs: 'autocomplete="postal-code" maxlength="20"' })}
    ${field({ name: 'address1', label: copy.fields.address1, value: v('address1'), error: errorText(errors, 'address1'), wide: true, attrs: 'autocomplete="address-line1" maxlength="200" required' })}
    ${field({ name: 'address2', label: copy.fields.address2, value: v('address2'), error: errorText(errors, 'address2'), hint: copy.fields.address2Hint, wide: true, attrs: 'autocomplete="address-line2" maxlength="100"' })}`
    : `<div class="co-postcode">
      ${field({ name: 'postcode', label: copy.fields.postcode, value: v('postcode'), error: errorText(errors, 'postcode'), attrs: 'autocomplete="postal-code" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" required data-kakao' })}
      <button class="co-search" type="button" id="co-search" hidden>${esc(copy.fields.search)}</button>
    </div>
    <div class="co-kakao" id="co-kakao" hidden>
      <div class="co-kakao__bar"><p id="co-kakao-title">${esc(copy.fields.searchTitle)}</p><button type="button" id="co-kakao-close">${esc(copy.fields.searchClose)}</button></div>
      <div class="co-kakao__frame" id="co-kakao-frame" role="region" aria-labelledby="co-kakao-title"></div>
    </div>
    ${field({ name: 'address1', label: copy.fields.address1, value: v('address1'), error: errorText(errors, 'address1'), wide: true, attrs: 'autocomplete="address-line1" maxlength="200" required data-kakao' })}
    ${field({ name: 'address2', label: copy.fields.address2, value: v('address2'), error: errorText(errors, 'address2'), hint: copy.fields.address2Hint, wide: true, attrs: 'autocomplete="address-line2" maxlength="100"' })}`}
        </div>`;

  const method = `<div class="co-method">
          <input type="radio" name="plan" id="co-plan-full" value="full" checked>
          <label for="co-plan-full">
            <span class="co-method__name">${isUsd ? esc(copy.methods.paypal) : `${esc(copy.methods.card)} · ${esc(copy.methods.cardFull)}`}</span>
            <span class="co-method__price">${esc(price)}</span>
            <span class="co-method__note">${esc(isUsd ? copy.methods.paypalNote : copy.methods.redirectCard)}</span>
            ${isUsd && texts.paypal_instalments ? `<span class="co-method__note">${esc(texts.paypal_instalments)}</span>` : ''}
          </label>
        </div>
        ${other ? `<p class="co-switch"><a href="${esc(switchUrl)}">${esc(other.currency === 'USD' ? copy.methods.toUsd : copy.methods.toKrw)}</a></p>` : ''}`;

  const data = {
    slug: product.slug, currency, plan: offer.plan, payLabel, paying: copy.paying,
    errors: copy.errors, problems: copy.problems, emailTypo: copy.emailTypo('{email}'), emailTypoUse: copy.emailTypoUse,
    search: { open: copy.fields.search, again: copy.fields.searchAgain, failed: copy.fields.searchFailed },
    kakao: !isUsd,
    item: { item_id: product.slug, item_name: product.name, price: offer.currency === 'USD' ? offer.total / 100 : offer.total, quantity: 1 },
    value: offer.currency === 'USD' ? offer.total / 100 : offer.total,
  };

  const body = `<div class="co-wrap">
  <header class="co-hero">
    <p class="co-badge">${LOCK}${esc(copy.secure)}</p>
    <h1 class="co-title">${esc(product.name)}</h1>
    ${c.summary ? `<p class="co-sub">${esc(c.summary)}</p>` : ''}
    <p class="co-price"><strong>${esc(pricing.formatMoney(offer.total, offer.currency))}</strong>${offer.vat > 0 ? `<span>${esc(copy.summary.vat(pricing.formatMoney(offer.vat, offer.currency)))}</span>` : ''}</p>
  </header>
  <div class="co-grid">
    <form class="co-form" id="co-form" method="post" action="/api/shop?action=order" novalidate>
      <p class="co-problem" id="co-problem" role="alert"${problem ? '' : ' hidden'}>${esc(problem ? copy.problems[problem] || copy.problems.server : '')}</p>
      <input type="hidden" name="slug" value="${esc(product.slug)}">
      <input type="hidden" name="currency" value="${esc(currency)}">
      ${Object.entries(source).map(([k, val]) => `<input type="hidden" name="${esc(k)}" value="${esc(val)}">`).join('')}

      ${step(1, copy.sections.me, me)}
      ${step(2, copy.sections.address, address)}
      ${step(3, copy.sections.method, method)}

      <section class="co-order" aria-labelledby="co-order-title">
        <h2 class="co-order__title" id="co-order-title">${esc(copy.summary.title)}</h2>
        <dl>
          <div class="co-order__row"><dt>${esc(product.name)}</dt><dd>${esc(price)}</dd></div>
          <div class="co-order__row co-order__row--total"><dt>${esc(copy.summary.total)}</dt><dd><strong data-total>${esc(pricing.formatMoney(offer.total, offer.currency))}</strong>${offer.vat > 0 ? `<span class="co-order__vat">${esc(copy.summary.vat(pricing.formatMoney(offer.vat, offer.currency)))}</span>` : ''}</dd></div>
        </dl>
      </section>

      <button class="btn btn--block co-pay${isUsd ? ' co-pay--paypal' : ''}" type="submit" id="co-pay">${esc(payLabel)}</button>
      <p class="co-wait" id="co-wait" role="status" aria-live="polite"></p>
      ${texts.secure_note ? `<p class="co-secure">${LOCK}<span>${esc(texts.secure_note)}</span></p>` : ''}
      <p class="co-consent">${consentHtml(texts.consent)}</p>
    </form>
    ${side(product, texts)}
  </div>
</div>`;
  return layout({ title: `${copy.title} · ${product.name}`, body, data });
}

// The product exists but isn't on sale.
function closedPage({ product, reason }) {
  const why = reason === 'not_started' ? copy.closed.notStarted : reason === 'ended' ? copy.closed.ended : copy.closed.closed;
  const home = homeOf(product);
  return layout({
    title: copy.closed.title,
    body: `<section class="co-card co-card--center">
  <h1 class="co-title">${esc(copy.closed.title)}</h1>
  <p class="co-lead">${esc(product.name)}</p>
  <p>${esc(why)}</p>
  <p><a class="btn" href="${esc(home)}">${esc(copy.closed.back)}</a></p>
  <p class="co-quiet">${esc(copy.closed.contact)}</p>
</section>`,
  });
}

function notFoundPage() {
  return layout({
    title: copy.notFound.title,
    body: `<section class="co-card co-card--center">
  <h1 class="co-title">${esc(copy.notFound.title)}</h1>
  <p>${esc(copy.notFound.body)}</p>
  <p><a class="btn" href="/">${esc(copy.notFound.home)}</a></p>
</section>`,
  });
}

function errorPage() {
  return layout({
    title: copy.error.title,
    body: `<section class="co-card co-card--center">
  <h1 class="co-title">${esc(copy.error.title)}</h1>
  <p>${esc(copy.error.body)}</p>
  <p class="co-quiet">${esc(copy.closed.contact)}</p>
</section>`,
  });
}

// Runs before any tag: takes the order token out of the address (tags must never see it) and remembers it
// for this tab, so a reload still finds the order.
const hideToken = `(function(){try{var u=new URL(location.href),o=u.searchParams.get('o');if(o){sessionStorage.setItem('co-order',o);sessionStorage.removeItem('co-restored');history.replaceState(null,'',u.pathname);}}catch(e){}})();`;
// Reloading /checkout/complete (no token in the address any more): go back to the order kept for this tab.
const restoreToken = `(function(){try{if(/[?&]o=/.test(location.search))return;var o=sessionStorage.getItem('co-order');if(o&&/^[A-Za-z0-9_-]{22}$/.test(o)&&!sessionStorage.getItem('co-restored')){sessionStorage.setItem('co-restored','1');location.replace('/checkout/complete?o='+o);}else{sessionStorage.removeItem('co-restored');}}catch(e){}})();`;

function kstDate(value) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(value));
}

/*
 * The page a buyer lands on after the payment page.
 *   order      the order row, or null (unknown token)
 *   product    its product (for the thank-you text and the "pay again" link)
 *   receiptUrl the provider's receipt for the payment, if any
 *   slow       true when the caller already waited and the payment is still unconfirmed (no-JavaScript reloads)
 */
function completePage({ order, product = null, receiptUrl = '', slow = false, tries = 0 }) {
  const c = copy.complete;
  if (!order) {
    return layout({
      title: c.missingTitle, beforeTags: restoreToken,
      body: `<section class="co-card co-card--center">
  <h1 class="co-title">${esc(c.missingTitle)}</h1>
  <p>${esc(c.missingLead)}</p>
</section>`,
    });
  }
  const retryUrl = product ? `/checkout/${product.slug}${order.currency === 'USD' ? '?currency=usd' : ''}` : '/';
  const amount = pricing.formatMoney(order.due_today, order.currency);

  if (order.paid_at && !['refunded'].includes(order.status)) {
    const name = (order.billing || {}).name || '';
    const thanks = (product && product.content && product.content.thanks) || c.thanksDefault;
    const value = order.currency === 'USD' ? order.total / 100 : order.total;
    const vat = pricing.vatSplit(order.total, product ? pricing.vatRule(product, order.currency) : 'taxable').vat;
    const data = {
      complete: 'paid', token: order.token,
      // Sent to GTM once per order (the server remembers when it has been).
      purchase: order.tracked_at ? null : {
        transaction_id: String(order.number), value, tax: order.currency === 'USD' ? vat / 100 : vat, currency: order.currency,
        items: [{ item_id: product ? product.slug : String(order.product_id), item_name: order.product_name, price: value, quantity: 1 }],
      },
    };
    return layout({
      title: c.paidTitle, data, beforeTags: hideToken,
      body: `<section class="co-card co-card--center co-done">
  <p class="co-done__mark" aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48" focusable="false"><circle cx="24" cy="24" r="22" fill="none" stroke="currentColor" stroke-width="3"/><path d="M14 24.5l7 7 13-14" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg></p>
  <h1 class="co-title">${esc(c.paidTitle)}</h1>
  ${name ? `<p class="co-lead">${esc(c.paidLead(name))}</p>` : ''}
  <dl class="co-facts">
    <div><dt>${esc(c.order)}</dt><dd>${esc(order.number)}</dd></div>
    <div><dt>${esc(c.product)}</dt><dd>${esc(order.product_name)}</dd></div>
    <div><dt>${esc(c.amount)}</dt><dd>${esc(amount)}</dd></div>
    <div><dt>${esc(c.date)}</dt><dd>${esc(kstDate(order.paid_at))}</dd></div>
  </dl>
  ${receiptUrl && /^https:\/\//.test(receiptUrl) ? `<p><a class="co-link" href="${esc(receiptUrl)}" target="_blank" rel="noopener noreferrer">${esc(c.receipt)}</a></p>` : ''}
  <p class="co-thanks">${esc(thanks).replace(/\n/g, '<br>')}</p>
  <p class="co-quiet">${esc(c.contact)}</p>
</section>`,
    });
  }

  if (order.status === 'refunded') {
    return layout({
      title: c.refundedTitle, beforeTags: hideToken,
      body: `<section class="co-card co-card--center">
  <h1 class="co-title">${esc(c.refundedTitle)}</h1>
  <p>${esc(c.refundedLead)}</p>
</section>`,
    });
  }

  if (order.status === 'expired' || order.status === 'cancelled') {
    return layout({
      title: c.endedTitle, beforeTags: hideToken, data: { complete: 'ended' },
      body: `<section class="co-card co-card--center">
  <h1 class="co-title">${esc(c.endedTitle)}</h1>
  <p>${esc(c.endedLead)}</p>
  <p><a class="btn" href="${esc(retryUrl)}">${esc(c.again)}</a></p>
  <p class="co-quiet">${esc(c.order)} ${esc(order.number)}</p>
</section>`,
    });
  }

  // Not confirmed yet: the page checks again by itself (checkout.js; a timed reload without JavaScript).
  const next = `/checkout/complete?o=${encodeURIComponent(order.token)}&n=${tries + 1}`;
  return layout({
    title: slow ? c.slowTitle : c.pendingTitle,
    refresh: slow ? null : `4;url=${next}`,
    data: { complete: 'pending', token: order.token, slowTitle: c.slowTitle, slowLead: c.slowLead },
    beforeTags: hideToken,
    body: `<section class="co-card co-card--center co-pending${slow ? ' is-slow' : ''}" id="co-pending">
  <div class="co-spinner" aria-hidden="true"></div>
  <h1 class="co-title" id="co-pending-title" tabindex="-1">${esc(slow ? c.slowTitle : c.pendingTitle)}</h1>
  <p id="co-pending-lead" role="status" aria-live="polite">${esc(slow ? c.slowLead : c.pendingLead)}</p>
  <p class="co-quiet" id="co-pending-keep"${slow ? ' hidden' : ''}>${esc(c.pendingKeep)}</p>
  <p class="co-actions" id="co-pending-actions"${slow ? '' : ' hidden'}>
    <a class="btn" href="/checkout/complete?o=${esc(encodeURIComponent(order.token))}">${esc(c.refresh)}</a>
    <a class="co-link" href="${esc(retryUrl)}">${esc(c.retry)}</a>
  </p>
  <p class="co-quiet">${esc(c.order)} ${esc(order.number)}</p>
</section>`,
  });
}

module.exports = { checkoutPage, closedPage, notFoundPage, errorPage, completePage, consentHtml, esc, json, siteChrome, GTM_ID };
