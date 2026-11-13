/* Checkout and thank-you pages (/checkout/…). Vanilla, no dependencies.
   The page works without this file (plain form post, timed reload on the waiting page); this adds:
   instant field checks, phone formatting, the Kakao address search inside the page, the order total following
   the add-ons ticked, a submit that can't be pressed twice, and the dataLayer events for GTM. Texts come from the page (#co-data), written by the server.
   The server (api/_lib/shop/validate.js) re-checks everything: these checks are only for speed. */
(function () {
  'use strict';
  var el = document.getElementById('co-data');
  var data = {};
  try { data = el ? JSON.parse(el.textContent) : {}; } catch (e) { data = {}; }
  window.dataLayer = window.dataLayer || [];

  function store(key, value) { try { sessionStorage.setItem(key, value); } catch (e) { /* private mode */ } }
  function stored(key) { try { return sessionStorage.getItem(key); } catch (e) { return null; } }
  function forget(prefix) {
    try {
      Object.keys(sessionStorage).forEach(function (k) { if (k.indexOf(prefix) === 0) sessionStorage.removeItem(k); });
    } catch (e) { /* private mode */ }
  }
  function post(action, body) {
    return fetch('/api/shop?action=' + action, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  }

  if (data.complete) return complete();
  var form = document.getElementById('co-form');
  if (!form) return;

  // ---------- checkout ----------
  var isUsd = data.currency === 'USD';
  var button = document.getElementById('co-pay');
  var wait = document.getElementById('co-wait');
  var problem = document.getElementById('co-problem');
  var SAVE_KEY = 'co-form:' + data.slug + ':' + data.currency; // a Korean address must not land in the overseas form, or the reverse
  var SAVED = ['name', 'email', 'phone_cc', 'phone', 'postcode', 'address1', 'address2', 'country'];
  var busy = false;

  function input(name) { return form.elements[name]; }
  function value(name) { var f = input(name); return f ? String(f.value || '').replace(/\s+/g, ' ').trim() : ''; }

  // Korean mobile number in any common spelling → 01012345678, or ''.
  function koreanMobile(v) {
    var d = String(v || '').replace(/[^\d+]/g, '');
    if (d.indexOf('+82') === 0) d = '0' + d.slice(3);
    else if (d.indexOf('0082') === 0) d = '0' + d.slice(4);
    else if (d.indexOf('82') === 0 && d.length >= 11) d = '0' + d.slice(2);
    d = d.replace(/\D/g, '');
    if (d.indexOf('00') === 0) d = d.slice(1);
    return /^(010\d{8}|01[16789]\d{7,8})$/.test(d) ? d : '';
  }

  // The country chosen beside the phone number ('KR' by default) and its calling code.
  function phoneCountry() { var f = input('phone_cc'); return f && f.value ? f.value : 'KR'; }
  function dialOf(cc) {
    var f = input('phone_cc'), o = f && f.querySelector('option[value="' + cc + '"]');
    return o ? o.getAttribute('data-dial') : '82';
  }
  // Same rules as validate.phoneInput: '' when the number is fine, else the problem code.
  function phoneProblem(cc, v) {
    if (!v) return 'phone_required';
    var bad = cc === 'KR' ? 'phone_invalid' : 'phone_invalid_intl';
    if (/[^\d+\s().-]/.test(v)) return bad;
    if (/^(\+|00)/.test(v)) {
      var intl = v.replace(/\D/g, '').replace(/^00/, '');
      if (intl.indexOf('82') === 0) return koreanMobile('+' + intl) ? '' : 'phone_invalid';
      return intl.length >= 7 && intl.length <= 15 ? '' : 'phone_invalid_intl';
    }
    if (cc === 'KR') return koreanMobile(v) ? '' : 'phone_invalid';
    var dial = dialOf(cc), n = v.replace(/\D/g, '');
    if (dial === '1' && n.length === 11 && n.charAt(0) === '1') n = n.slice(1);
    if (cc !== 'IT' && cc !== 'SM' && cc !== 'VA' && n.charAt(0) === '0') n = n.slice(1);
    var ok = dial === '1' ? /^[2-9]\d{9}$/.test(n) : cc === 'AU' ? /^\d{9}$/.test(n) : n.length >= 6 && dial.length + n.length <= 15;
    return ok ? '' : 'phone_invalid_intl';
  }

  // Same rules and codes as validate.js.
  var CHECKS = {
    name: function (v) { return !v ? 'name_required' : v.length > 60 ? 'name_long' : ''; },
    email: function (v) {
      if (!v) return 'email_required';
      return v.length <= 254 && /^[^\s@"'<>()\\,;:]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(v) && v.indexOf('..') < 0 ? '' : 'email_invalid';
    },
    phone: function (v) { return phoneProblem(phoneCountry(), v); },
    postcode: function (v) {
      if (isUsd) return v.length > 20 ? 'postcode_long' : '';
      return !v ? 'postcode_required' : /^\d{5}$/.test(v) ? '' : 'postcode_invalid';
    },
    address1: function (v) { return !v ? 'address1_required' : v.length > 200 ? 'address1_long' : ''; },
    address2: function (v) { return v.length > 100 ? 'address2_long' : ''; },
    country: function (v) { return isUsd && !v ? 'country_required' : ''; },
  };

  function show(name, code) {
    var f = input(name);
    if (!f) return;
    var box = f.closest('.co-field'), out = document.getElementById(name + '-error');
    var text = code ? (data.errors && data.errors[code]) || (data.problems && data.problems.invalid) || '' : '';
    if (box) box.classList.toggle('is-invalid', Boolean(code));
    if (code) f.setAttribute('aria-invalid', 'true'); else f.removeAttribute('aria-invalid');
    if (out) out.textContent = text;
  }

  function check(name) {
    if (!input(name) || !CHECKS[name]) return '';
    var code = CHECKS[name](value(name));
    show(name, code);
    return code;
  }

  function say(code) {
    if (!problem) return;
    problem.textContent = code ? (data.problems && (data.problems[code] || data.problems.server)) || '' : '';
    problem.hidden = !code;
  }

  // Typed values survive a reload and the trip to the payment page and back (this tab only).
  function save() {
    var out = {};
    SAVED.forEach(function (n) { if (input(n)) out[n] = input(n).value; });
    store(SAVE_KEY, JSON.stringify(out));
  }
  function restore() {
    var saved;
    try { saved = JSON.parse(stored(SAVE_KEY) || '{}'); } catch (e) { saved = {}; }
    SAVED.forEach(function (n) {
      var f = input(n);
      if (!f || typeof saved[n] !== 'string' || saved[n].length > 254) return;
      // The country list always has a value (Korea): take the saved one only with the saved number.
      if (n === 'phone_cc') { if (!value('phone') && saved.phone && f.querySelector('option[value="' + saved[n].replace(/[^A-Z]/g, '') + '"]')) f.value = saved[n]; return; }
      if (!f.value) f.value = saved[n];
    });
  }

  // 01012345678 → 010-1234-5678 while typing (Korea chosen; any other country is left as typed).
  function formatPhone() {
    var f = input('phone');
    if (!f || phoneCountry() !== 'KR') return;
    var raw = f.value;
    if (/^\s*(\+|00)/.test(raw)) return;
    var d = raw.replace(/\D/g, '').slice(0, 11);
    var out = d.length < 4 ? d : d.length < 8 ? d.slice(0, 3) + '-' + d.slice(3) : d.slice(0, 3) + '-' + d.slice(3, d.length - 4) + '-' + d.slice(d.length - 4);
    if (out !== raw) f.value = out;
  }

  // "gmail.con" → suggests gmail.com.
  var TYPOS = {
    'gmail.con': 'gmail.com', 'gmail.co': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmail.cmo': 'gmail.com', 'gmail.comm': 'gmail.com',
    'naver.con': 'naver.com', 'naver.co': 'naver.com', 'naver.cmo': 'naver.com', 'nvaer.com': 'naver.com', 'naver.comm': 'naver.com', 'navre.com': 'naver.com',
    'hanmail.con': 'hanmail.net', 'hanmail.com': 'hanmail.net', 'hanmial.net': 'hanmail.net', 'daum.con': 'daum.net', 'daum.com': 'daum.net', 'kakao.con': 'kakao.com', 'kakao.co': 'kakao.com',
    'icloud.con': 'icloud.com', 'icloud.co': 'icloud.com', 'hotmail.con': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'outlook.con': 'outlook.com', 'yahoo.con': 'yahoo.com', 'nate.con': 'nate.com',
  };
  function emailTypo() {
    var f = input('email');
    if (!f) return;
    var box = f.closest('.co-field'), old = box.querySelector('.co-typo');
    if (old) old.remove();
    var v = value('email').toLowerCase(), at = v.lastIndexOf('@');
    var fixed = at > 0 ? TYPOS[v.slice(at + 1)] : null;
    if (!fixed) return;
    var suggestion = v.slice(0, at + 1) + fixed;
    var p = document.createElement('p');
    p.className = 'co-typo';
    p.appendChild(document.createTextNode(String(data.emailTypo || '').replace('{email}', suggestion)));
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = data.emailTypoUse || '';
    b.addEventListener('click', function () { f.value = suggestion; p.remove(); check('email'); save(); f.focus(); });
    p.appendChild(b);
    box.appendChild(p);
  }

  Object.keys(CHECKS).forEach(function (name) {
    var f = input(name);
    if (!f) return;
    f.addEventListener('blur', function () { if (f.value || f.getAttribute('aria-invalid')) check(name); if (name === 'email') emailTypo(); save(); });
    f.addEventListener('input', function () { if (name === 'phone') formatPhone(); if (f.getAttribute('aria-invalid')) check(name); });
    f.addEventListener('change', save);
  });

  // ---------- Phone country ----------
  var phoneCountryShown = function () {};
  // Shows the chosen country as "+82" (the select stays the real control, laid invisibly over it).
  // On the overseas form, choosing the address country also picks the phone country, until the buyer
  // picks one themselves.
  (function () {
    var cc = input('phone_cc'), row = form.querySelector('.co-phone'), shown = form.querySelector('.co-phone__shown');
    if (!cc || !row || !shown) return;
    var chosen = false;
    function update() {
      shown.textContent = '+' + dialOf(cc.value);
      var p = input('phone');
      if (p) p.placeholder = cc.value === 'KR' ? '010-1234-5678' : '';
      if (p && p.value) check('phone');
    }
    row.classList.add('is-compact');
    phoneCountryShown = update;
    cc.addEventListener('change', function () { chosen = true; update(); formatPhone(); save(); });
    var country = input('country');
    if (country) country.addEventListener('change', function () {
      if (chosen || !country.value || !cc.querySelector('option[value="' + country.value + '"]')) return;
      cc.value = country.value;
      update();
    });
    update();
  }());

  // ---------- Kakao (Daum) address search, opened inside the page ----------
  // The address exactly as Kakao documents it: the script refuses any extra parameter (it shows an alert).
  // (t1.kakaocdn.net since 2026: Kakao closes the old t1.daumcdn.net address on 2026-11-30.)
  var KAKAO_SRC = 'https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
  var panel = document.getElementById('co-kakao'), frame = document.getElementById('co-kakao-frame'), search = document.getElementById('co-search');
  var kakaoState = 'idle'; // idle → loading → ready | failed
  var waiting = [];

  function lockAddress(lock) {
    ['postcode', 'address1'].forEach(function (n) { var f = input(n); if (f) { if (lock) f.setAttribute('readonly', ''); else f.removeAttribute('readonly'); } });
  }

  function kakaoFailed() {
    kakaoState = 'failed';
    lockAddress(false); // type the address by hand instead
    if (search) search.hidden = true;
    if (panel && frame) {
      panel.hidden = false;
      frame.className = 'co-kakao__frame is-failed';
      frame.textContent = (data.search && data.search.failed) || '';
    }
    var f = input('postcode');
    if (f) f.focus();
  }

  function loadKakao(done) {
    if (kakaoState === 'ready') return done();
    if (kakaoState === 'failed') return;
    waiting.push(done);
    if (kakaoState === 'loading') return;
    kakaoState = 'loading';
    var timer = setTimeout(function () { if (kakaoState === 'loading') kakaoFailed(); }, 8000);
    var s = document.createElement('script');
    s.src = KAKAO_SRC;
    s.async = true;
    s.onerror = function () { clearTimeout(timer); kakaoFailed(); };
    s.onload = function () {
      var ready = function () {
        if (kakaoState !== 'loading') return;
        clearTimeout(timer);
        kakaoState = 'ready';
        waiting.splice(0).forEach(function (fn) { fn(); });
      };
      try {
        if (window.daum && window.daum.Postcode) ready();
        else if (window.daum && window.daum.postcode && window.daum.postcode.load) window.daum.postcode.load(ready);
        else { clearTimeout(timer); kakaoFailed(); }
      } catch (e) { clearTimeout(timer); kakaoFailed(); }
    };
    document.head.appendChild(s);
  }

  function closeSearch(focusNext) {
    if (!panel) return;
    panel.hidden = true;
    frame.innerHTML = '';
    if (focusNext && input(focusNext)) input(focusNext).focus();
  }

  function openSearch() {
    if (!panel || kakaoState === 'failed') return;
    loadKakao(function () {
      panel.hidden = false;
      frame.className = 'co-kakao__frame';
      frame.innerHTML = '';
      new window.daum.Postcode({
        width: '100%', height: '100%',
        oncomplete: function (r) {
          var address = r.roadAddress || r.jibunAddress || r.address || '';
          if (r.buildingName && r.roadAddress) address += ' (' + r.buildingName + ')';
          input('postcode').value = r.zonecode || '';
          input('address1').value = address;
          check('postcode'); check('address1');
          save();
          if (search) search.textContent = (data.search && data.search.again) || search.textContent;
          closeSearch('address2');
        },
      }).embed(frame, { autoClose: false });
      if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }

  if (data.kakao && panel && frame && search) {
    search.hidden = false;
    lockAddress(true);
    search.addEventListener('click', openSearch);
    document.getElementById('co-kakao-close').addEventListener('click', function () { closeSearch('address2'); });
    ['postcode', 'address1'].forEach(function (n) {
      var f = input(n);
      f.addEventListener('click', function () { if (f.hasAttribute('readonly')) openSearch(); });
      f.addEventListener('keydown', function (ev) {
        if (f.hasAttribute('readonly') && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); openSearch(); }
      });
    });
  }

  // ---------- Add-ons: the order, its total and the button follow what is ticked ----------
  // The server prices the order again from the ticked add-ons (addon_<id>); these numbers are only what the buyer sees.
  var ADDONS = data.addons || [];
  function money(n) {
    var abs = Math.abs(n), sign = n < 0 ? '-' : '';
    if (isUsd) {
      var cents = abs % 100;
      return sign + '$' + Math.floor(abs / 100).toLocaleString('en-US') + (cents ? '.' + (cents < 10 ? '0' : '') + cents : '');
    }
    return sign + '₩' + abs.toLocaleString('en-US');
  }
  // Same split as pricing.vatSplit: supply = amount × 10/11 rounded, VAT the rest; once per VAT rule.
  function vatOf(items) {
    var taxable = 0;
    items.forEach(function (x) { if (x.vatRule === 'taxable') taxable += x.amount; });
    return taxable - Math.round(taxable * 100 / 110);
  }
  function addonBox(id) { return form.querySelector('.co-addon__check[data-addon="' + id + '"]'); }
  function chosenAddons() { return ADDONS.filter(function (a) { var b = addonBox(a.id); return b && b.checked; }); }
  function cartItems() { return [data.main ? data.main.item : data.item].concat(chosenAddons().map(function (a) { return a.item; })); }
  function cartValue() {
    var total = (data.main ? data.main.amount : 0) + chosenAddons().reduce(function (sum, a) { return sum + a.amount; }, 0);
    return total;
  }
  function refreshOrder() {
    if (!data.main) return;
    var chosen = chosenAddons(), total = cartValue();
    ADDONS.forEach(function (a) {
      var row = form.querySelector('[data-line="' + a.id + '"]'), box = addonBox(a.id);
      if (row) row.hidden = !(box && box.checked);
    });
    var vat = vatOf([data.main].concat(chosen));
    var totalEl = form.querySelector('[data-total]'), vatEl = form.querySelector('[data-vat]'), due = form.querySelector('[data-due]');
    if (totalEl) totalEl.textContent = money(total);
    if (vatEl) { vatEl.textContent = vat > 0 ? String(data.vatTemplate || '').replace('{price}', money(vat)) : ''; vatEl.hidden = !(vat > 0); }
    if (due) due.textContent = money(total);
    data.payLabel = String(data.payTemplate || data.payLabel).replace('{price}', money(total));
    if (!busy) button.textContent = data.payLabel;
    data.value = isUsd ? total / 100 : total;
  }
  ADDONS.forEach(function (a) {
    var box = addonBox(a.id);
    if (!box) return;
    box.addEventListener('change', function () {
      refreshOrder();
      window.dataLayer.push({ ecommerce: null });
      window.dataLayer.push({ event: box.checked ? 'add_to_cart' : 'remove_from_cart', ecommerce: { currency: data.currency, value: a.item.price, items: [a.item] } });
    });
  });
  Array.prototype.forEach.call(form.querySelectorAll('[data-remove]'), function (b) {
    b.hidden = false;
    b.addEventListener('click', function () {
      var box = addonBox(b.getAttribute('data-remove'));
      if (!box) return;
      box.checked = false;
      box.dispatchEvent(new Event('change', { bubbles: true }));
      box.focus();
    });
  });

  // ---------- submit ----------
  function setBusy(on) {
    busy = on;
    if (on) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
    wait.textContent = on ? data.paying || '' : '';
  }

  function fail(code, fields) {
    setBusy(false);
    var first = null;
    if (fields) Object.keys(fields).forEach(function (n) { show(n, fields[n]); if (!first && input(n)) first = input(n); });
    say(code || 'server');
    if (first && first.hasAttribute('readonly') && search && !search.hidden) search.focus();
    else if (first) first.focus();
    else if (problem) { problem.setAttribute('tabindex', '-1'); problem.focus(); }
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (busy) return;
    var first = null;
    Object.keys(CHECKS).forEach(function (n) { if (check(n) && !first) first = n; });
    if (first) {
      say('invalid');
      if ((first === 'postcode' || first === 'address1') && input(first).hasAttribute('readonly')) search.focus();
      else input(first).focus();
      return;
    }
    say('');
    setBusy(true);
    save();
    var body = {};
    Array.prototype.forEach.call(form.elements, function (f) {
      // An unticked add-on (or unselected radio) is not sent: only what is ticked is bought.
      if (!f.name || f.disabled || ((f.type === 'radio' || f.type === 'checkbox') && !f.checked)) return;
      body[f.name] = f.value;
    });
    window.dataLayer.push({ ecommerce: null });
    window.dataLayer.push({ event: 'add_payment_info', ecommerce: { currency: data.currency, value: data.value, payment_type: isUsd ? 'paypal' : 'card', items: cartItems() } });

    var controller = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 30000);
    fetch('/api/shop?action=order', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (b) {
        clearTimeout(timer);
        if (res.ok && b && typeof b.redirect === 'string' && /^https?:\/\//.test(b.redirect)) { window.location.assign(b.redirect); return; }
        fail((b && b.error) || 'server', b && b.fields);
      });
    }).catch(function () { clearTimeout(timer); fail('network'); });
  });

  // Coming back from the payment page with the browser's Back button: the form must be usable again.
  window.addEventListener('pageshow', function () { setBusy(false); });

  restore();
  phoneCountryShown();
  formatPhone();
  refreshOrder(); // the browser may have kept add-ons ticked across a reload

  window.dataLayer.push({ ecommerce: null });
  window.dataLayer.push({ event: 'begin_checkout', ecommerce: { currency: data.currency, value: data.value, items: cartItems() } });

  // ---------- thank-you / waiting page ----------
  function complete() {
    var token = data.token;
    if (data.complete === 'paid') {
      forget('co-form:');
      if (data.purchase) {
        window.dataLayer.push({ ecommerce: null });
        window.dataLayer.push({ event: 'purchase', ecommerce: data.purchase });
      }
      // Tells the server the purchase event went out (so it is sent once), and lets it finish the ActiveCampaign updates.
      if (token) post('after', { o: token, tracked: Boolean(data.purchase) }).catch(function () {});
      return;
    }
    if (data.complete !== 'pending' || !token) return;

    var tries = 0, MAX = 45; // every 2 seconds, for 90 seconds
    var title = document.getElementById('co-pending-title'), lead = document.getElementById('co-pending-lead');
    function slow() {
      var box = document.getElementById('co-pending');
      if (box) box.classList.add('is-slow');
      if (title) title.textContent = data.slowTitle || title.textContent;
      if (lead) lead.textContent = data.slowLead || lead.textContent;
      var keep = document.getElementById('co-pending-keep'), actions = document.getElementById('co-pending-actions');
      if (keep) keep.hidden = true;
      if (actions) actions.hidden = false;
      if (title) title.focus();
    }
    function ask() {
      tries++;
      fetch('/api/shop?action=status&o=' + encodeURIComponent(token), { credentials: 'same-origin', cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(function (b) {
          if (b.status === 'paid' || b.status === 'ended' || b.status === 'refunded') { window.location.replace('/checkout/complete?o=' + encodeURIComponent(token)); return; }
          next();
        }).catch(next);
    }
    function next() { if (tries >= MAX) slow(); else setTimeout(ask, 2000); }
    if (document.getElementById('co-pending') && !document.getElementById('co-pending').classList.contains('is-slow')) setTimeout(ask, 1500);
  }
})();
