/* Review form (/lifeartist/review): name and email first, then one question at a time, like the NSMB waitlist
 * (same look: css/waitlist-flow.css).
 *
 * Markup: <form class="wlf rvf" data-review-flow data-form="lifeartist-2026" action="/api/review" method="post"> with one
 * fieldset.rvf__step per step (data-step="contact", then each question key) and a .wlf__done step. Without JS every
 * question shows and the form posts normally (api/review.js answers with a redirect to /lifeartist/review/thanks).
 *
 * - Everything she types is kept in this browser (localStorage) until the review is sent, so a reload, a closed tab
 *   or a dropped connection loses nothing. Answers are sent all at once at the end.
 * - GTM event: review_submitted (with the form key). Never the answers or her email.
 */
(function () {
  var root = document.querySelector('[data-review-flow]');
  if (!root || !window.fetch || !window.JSON) return;

  var formKey = root.dataset.form;
  var KEY = 'review-draft:' + formKey;
  var steps = Array.prototype.slice.call(root.querySelectorAll('.rvf__step'));
  var order = steps.map(function (el) { return el.dataset.step; });
  var done = root.querySelector('[data-step="done"]');
  var progress = root.querySelector('.wlf__progress');
  var bar = root.querySelector('.wlf__bar i');
  var count = root.querySelector('.wlf__count');
  var msg = root.querySelector('.wlf__msg');
  var saved = root.querySelector('.rvf__saved');
  var card = root.closest('.wl-card');
  var startedAt = Date.now();
  var current = 0;

  var MSG = {
    name: '이름을 입력해 주세요.',
    email: '올바른 이메일 주소를 입력해 주세요. 예: name@example.com',
    consent: '후기를 보내시려면 동의가 필요해요.',
    answer: '한두 문장이라도 괜찮아요. 편하게 적어 주세요.',
    limited: '잠시 후 다시 시도해 주세요.',
    fail: '보내지 못했어요. 적어 주신 내용은 이 기기에 그대로 있어요. 잠시 후 다시 시도하거나 hello@ashleylim.com 으로 문의해 주세요.'
  };

  function field(name) { return root.elements.namedItem(name); }
  function setErr(input, text) {
    var id = (input.getAttribute('aria-describedby') || '').split(' ')[0];
    var err = id && document.getElementById(id);
    input.setAttribute('aria-invalid', text ? 'true' : 'false');
    if (err) err.textContent = text || '';
  }

  /* Draft in this browser */
  function collect() {
    var d = { name: field('name').value, email: field('email').value, share: field('share').checked, step: current, answers: {} };
    order.slice(1).forEach(function (k) { d.answers[k] = field('q_' + k).value; });
    return d;
  }
  var saveTimer = null;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(collect())); if (saved) saved.textContent = '이 기기에 임시 저장됐어요.'; } catch (e) {}
    }, 400);
  }
  function loadDraft() {
    try {
      var d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!d) return 0;
      field('name').value = d.name || '';
      field('email').value = d.email || '';
      field('share').checked = !!d.share;
      Object.keys(d.answers || {}).forEach(function (k) { var t = field('q_' + k); if (t) t.value = d.answers[k]; });
      return Math.min(Math.max(0, d.step | 0), order.length - 1);
    } catch (e) { return 0; }
  }
  function clearDraft() { try { localStorage.removeItem(KEY); } catch (e) {} }

  /* Steps */
  function show(i, focus) {
    current = i;
    steps.forEach(function (el, k) { el.hidden = k !== i; el.classList.remove('is-in'); });
    done.hidden = true;
    var el = steps[i];
    void el.offsetWidth; el.classList.add('is-in');
    msg.textContent = '';
    progress.hidden = false;
    count.textContent = (i + 1) + ' / ' + steps.length;
    bar.style.setProperty('--p', ((i + 1) / steps.length * 100) + '%');
    var back = el.querySelector('.wlf__back');
    if (back) back.hidden = i === 0;
    if (card) card.classList.toggle('is-started', i > 0);
    if (focus !== false) {
      saveDraft();   // remember the step she's on (not on page load: nothing typed yet)
      var target = el.querySelector('textarea, input:not([type=hidden]):not([tabindex="-1"])') || el;
      target.focus({ preventScroll: true });
      var top = root.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) root.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function valid(i) {
    var key = order[i];
    if (key === 'contact') {
      var n = field('name'), em = field('email'), c = field('consent'), first = null;
      if (!n.value.trim()) { setErr(n, MSG.name); first = first || n; } else setErr(n, '');
      if (!/^\S+@\S+\.\S+$/.test(em.value.trim())) { setErr(em, MSG.email); first = first || em; } else setErr(em, '');
      if (!c.checked) { setErr(c, MSG.consent); first = first || c; } else setErr(c, '');
      if (first) { first.focus(); return false; }
      return true;
    }
    var t = field('q_' + key);
    if (t.hasAttribute('data-required') && !t.value.trim()) { setErr(t, MSG.answer); t.focus(); return false; }
    setErr(t, '');
    return true;
  }

  function send() {
    var d = collect();
    var btn = steps[steps.length - 1].querySelector('[data-next]');
    btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = '보내는 중…';
    msg.textContent = '';
    fetch(root.getAttribute('action'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form: formKey, name: d.name.trim(), email: d.email.trim(), consent: true, share: d.share, answers: d.answers,
        website: field('website').value, t: startedAt })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (res) {
        if (r.status === 429) throw new Error('limited');
        if (!r.ok || !res.ok) {
          // the server names what's missing: go back to that step
          var at = (res.fields || []).map(function (f) { return order.indexOf(f === 'name' || f === 'email' || f === 'consent' ? 'contact' : f); }).filter(function (k) { return k >= 0; })[0];
          if (at != null) { show(at); valid(at); }
          throw new Error('fail');
        }
      });
    }).then(function () {
      clearDraft();
      (window.dataLayer = window.dataLayer || []).push({ event: 'review_submitted', review_form: formKey });
      steps.forEach(function (el) { el.hidden = true; });
      progress.hidden = true;
      if (saved) saved.textContent = '';
      if (card) { card.classList.add('is-done'); card.classList.add('is-started'); }
      done.hidden = false;
      done.focus();
    }).catch(function (err) {
      msg.textContent = err && err.message === 'limited' ? MSG.limited : MSG.fail;
    }).then(function () { btn.disabled = false; btn.textContent = btn.dataset.label || btn.textContent; });
  }

  /* Wire up */
  root.classList.add('is-flow');
  root.querySelectorAll('.wlf__nav').forEach(function (nav) { nav.hidden = false; });
  root.addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.hasAttribute('data-next')) {
      e.preventDefault();
      if (!valid(current)) return;
      if (current === steps.length - 1) send(); else show(current + 1);
    } else if (b.classList.contains('wlf__back')) {
      e.preventDefault();
      if (current > 0) show(current - 1);
    }
  });
  root.addEventListener('submit', function (e) { e.preventDefault(); });
  // Enter in a single-line field moves on (in a textarea it's a line break)
  root.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox') {
      e.preventDefault();
      if (valid(current)) show(current + 1);
    }
  });
  root.addEventListener('input', saveDraft);
  root.addEventListener('change', saveDraft);

  show(loadDraft(), false);
})();
