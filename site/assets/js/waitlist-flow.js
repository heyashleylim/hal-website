/* NSMB waitlist v2: name/email first, then the three questions one at a time (/nsmb and /waitlist).
 *
 * Markup: <div class="wlf" data-waitlist-flow data-endpoint="/api/waitlist" data-source="nsmb-page"> with one
 * .wlf__step per step (data-step="contact" | "q1" | "q2" | "q3" | "done"). Without JS only the first step shows.
 *
 * - Step 1 saves the contact right away (api/waitlist.js), so she's on the list even if she stops there; the server
 *   answers with her personal code, kept in sessionStorage so a reload carries on where she was.
 * - Each question is saved as soon as she moves on. Q3 completes it.
 * - Personal link (/waitlist?c=CODE): the page's head script moves the code from the URL to sessionStorage before
 *   GTM loads; here we look up her first name, greet her and start at Q1.
 * - ?src=reconfirm|ig-bio|… sets %WL_SOURCE% (the server only accepts known values).
 * - GTM events: waitlist_signup (step 1 saved), waitlist_complete (Q3 saved).
 */
(function () {
  var root = document.querySelector('[data-waitlist-flow]');
  if (!root) return;

  var KEY = 'wl-code';
  var endpoint = root.dataset.endpoint || '/api/waitlist';
  var params = new URLSearchParams(location.search);
  var source = params.get('src') || root.dataset.source || 'waitlist-page';
  var steps = {};
  root.querySelectorAll('.wlf__step').forEach(function (el) { steps[el.dataset.step] = el; });
  var order = ['contact', 'q1', 'q2', 'q3'];
  var progress = root.querySelector('.wlf__progress');
  var bar = root.querySelector('.wlf__bar i');
  var count = root.querySelector('.wlf__count');
  var msg = root.querySelector('.wlf__msg');
  var state = { code: null, name: '', viaLink: false, confirm: false, current: 'contact', startedAt: Date.now(), sent: {} };

  var MSG = {
    limited: '잠시 후 다시 시도해 주세요.',
    fail: '저장하지 못했어요. 잠시 후 다시 시도하거나 hello@ashleylim.com 으로 문의해 주세요.',
    name: '이름을 입력해 주세요.',
    email: '올바른 이메일 주소를 입력해 주세요. 예: name@example.com',
    consent: '안내 수신에 동의해 주셔야 등록할 수 있어요.',
    answer: '한두 문장이라도 괜찮아요. 편하게 적어 주세요.',
    choice: '하나를 골라 주세요.'
  };

  function store(code) {
    try { if (code) sessionStorage.setItem(KEY, code); else sessionStorage.removeItem(KEY); } catch (e) {}
  }
  function stored() {
    try { return sessionStorage.getItem(KEY) || window.__wlCode || null; } catch (e) { return window.__wlCode || null; }
  }
  function track(event) { (window.dataLayer = window.dataLayer || []).push({ event: event, waitlist_source: source }); }

  function post(action, body) {
    return fetch(endpoint + (action ? '?action=' + action : ''), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.status === 429) { var e = new Error('limited'); e.limited = true; throw e; }
        if (!r.ok || !d.ok) { var f = new Error(d.error || 'fail'); f.status = r.status; throw f; }
        return d;
      });
    });
  }

  function setErr(input, msgText) {
    var err = document.getElementById(input.getAttribute('aria-describedby').split(' ')[0]);
    input.setAttribute('aria-invalid', msgText ? 'true' : 'false');
    if (err) err.textContent = msgText || '';
  }

  function stepList() { return state.viaLink ? order.slice(1) : order; }

  function show(name, focus) {
    Object.keys(steps).forEach(function (k) { steps[k].hidden = k !== name; steps[k].classList.remove('is-in'); });
    var el = steps[name];
    if (!el) return;
    void el.offsetWidth; el.classList.add('is-in');
    state.current = name;
    msg.textContent = '';
    root.classList.toggle('is-started', name !== 'contact');
    var card = root.closest('.wl-card');
    if (card) card.classList.toggle('is-started', name !== 'contact');
    var list = stepList();
    var i = list.indexOf(name);
    if (progress) {
      progress.hidden = name === 'done';
      if (i >= 0) {
        count.textContent = (i + 1) + ' / ' + list.length;
        bar.style.setProperty('--p', ((i + 1) / list.length * 100) + '%');
      }
    }
    var back = el.querySelector('.wlf__back');
    if (back) back.hidden = i <= 0;
    if (focus !== false) {
      var target = el.querySelector('textarea, input[type=radio]:checked, input[type=radio], input:not([type=hidden]):not([tabindex="-1"])') || el;
      if (name === 'done') target = el;
      target.focus({ preventScroll: true });
      var top = root.getBoundingClientRect().top;
      if (top < 0 || top > window.innerHeight * 0.6) root.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function busy(form, on, label) {
    var btn = form.querySelector('button[type=submit]');
    if (!btn) return;
    if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || '저장 중…'; btn.disabled = true; }
    else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
  }

  function fail(err) {
    msg.textContent = err && err.limited ? MSG.limited : MSG.fail;
  }

  function greet(name) {
    var hello = steps.q1.querySelector('.wlf__hello');
    var notYou = root.querySelector('.wlf__notyou');
    if (name) {
      hello.textContent = name + '님, 반가워요. 3가지만 여쭤볼게요 🙂';
      hello.hidden = false;
      if (notYou) { notYou.hidden = !state.viaLink; notYou.querySelector('button').textContent = name + '님이 아니신가요?'; }
    } else {
      hello.hidden = true;
      if (notYou) notYou.hidden = true;
    }
  }

  function finish() {
    var done = steps.done;
    var title = done.querySelector('[data-done-title]');
    var text = done.querySelector('[data-done-text]');
    if (state.confirm) {
      title.textContent = '거의 다 됐어요!';
      text.textContent = '방금 보내드린 확인 이메일에서 ‘구독 확인’을 눌러야 대기 리스트 등록이 완료돼요. 메일이 보이지 않으면 스팸함도 확인해 주세요 💌';
    } else {
      title.textContent = (state.name ? state.name + '님, ' : '') + '고마워요 💌';
      text.textContent = '답변 잘 받았어요. 다음 기수 오픈 소식과 대기자 우선 안내를 가장 먼저 보내드릴게요.';
    }
    store(null);
    show('done');
  }

  /* Step 1: name, email, consent */
  var contact = steps.contact;
  contact.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = contact.elements, n = f.namedItem('name'), em = f.namedItem('email'), c = f.namedItem('consent'), first = null;
    if (!n.value.trim()) { setErr(n, MSG.name); first = first || n; } else setErr(n, '');
    if (!/^\S+@\S+\.\S+$/.test(em.value.trim())) { setErr(em, MSG.email); first = first || em; } else setErr(em, '');
    if (!c.checked) { setErr(c, MSG.consent); first = first || c; } else setErr(c, '');
    if (first) { first.focus(); return; }

    var payload = { name: n.value.trim(), email: em.value.trim(), consent: true, source: source, website: f.namedItem('website').value, t: state.startedAt };
    var sig = payload.name + '|' + payload.email.toLowerCase();
    if (state.code && state.sent.contact === sig) { show('q1'); return; } // came back without changing anything
    busy(contact, true, '등록 중…');
    post('', payload).then(function (d) {
      state.name = payload.name;
      state.confirm = !!d.confirm;
      state.sent.contact = sig;
      if (!d.code) { finish(); return; } // honeypot / too fast: nothing was saved, don't ask questions
      state.code = d.code;
      store(d.code);
      track('waitlist_signup');
      greet('');
      show('q1');
    }).catch(fail).finally(function () { busy(contact, false); });
  });

  /* Q1, Q2: open answers */
  ['q1', 'q2'].forEach(function (q) {
    var form = steps[q];
    var ta = form.querySelector('textarea');
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true })); }
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = ta.value.trim();
      if (!v) { setErr(ta, MSG.answer); ta.focus(); return; }
      setErr(ta, '');
      var next = q === 'q1' ? 'q2' : 'q3';
      if (state.sent[q] === v) { show(next); return; }
      var body = { c: state.code }; body[q] = v;
      if (q === 'q1' && state.viaLink) body.source = source;
      busy(form, true);
      post('answers', body).then(function () { state.sent[q] = v; show(next); }).catch(fail).finally(function () { busy(form, false); });
    });
  });

  /* Q3: one choice. A tap (mouse/touch) moves on by itself; keyboard users confirm with the button. */
  var q3 = steps.q3;
  var q3Sending = false;
  var q3Timer = null;
  function submitQ3() {
    clearTimeout(q3Timer);
    if (q3Sending || state.current !== 'q3') return;
    var picked = q3.querySelector('input[name=q3]:checked');
    var first = q3.querySelector('input[name=q3]');
    if (!picked) { setErr(first, MSG.choice); first.focus(); return; }
    setErr(first, '');
    q3Sending = true;
    busy(q3, true);
    post('answers', { c: state.code, q3: picked.value, source: state.viaLink ? source : undefined })
      .then(function () { track('waitlist_complete'); finish(); })
      .catch(fail).finally(function () { q3Sending = false; busy(q3, false); });
  }
  q3.addEventListener('submit', function (e) { e.preventDefault(); submitQ3(); });
  q3.querySelectorAll('.wlf__opt').forEach(function (opt) {
    opt.addEventListener('click', function (e) {
      // A tap on the label also fires a synthetic click on its radio; react to the tap only.
      // Keyboard "clicks" (space) have detail 0: don't jump ahead, she confirms with the button.
      if (e.target.tagName === 'INPUT' || e.detail === 0) return;
      clearTimeout(q3Timer);
      q3Timer = setTimeout(submitQ3, 220);
    });
  });

  /* Back buttons */
  root.querySelectorAll('.wlf__back').forEach(function (b) {
    b.addEventListener('click', function () {
      var list = stepList();
      var i = list.indexOf(state.current);
      if (i > 0) show(list[i - 1]);
    });
  });

  /* "Not you?": forget the code, start from step 1 */
  var notYou = root.querySelector('.wlf__notyou button');
  if (notYou) notYou.addEventListener('click', function () {
    store(null);
    state = { code: null, name: '', viaLink: false, confirm: false, current: 'contact', startedAt: Date.now(), sent: {} };
    greet('');
    show('contact');
  });

  /* Start: personal link or an unfinished visit → greet and go to Q1; otherwise step 1. */
  if (progress) progress.hidden = false;
  show('contact', false);
  var code = stored();
  if (code) {
    root.classList.add('is-loading');
    post('lookup', { c: code }).then(function (d) {
      state.code = code;
      state.name = d.firstName || '';
      state.viaLink = true;
      state.confirm = false;
      greet(state.name);
      show('q1', false);
    }).catch(function () { store(null); })
      .finally(function () { root.classList.remove('is-loading'); });
  }
})();
