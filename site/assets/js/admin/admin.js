/* Shared code for every admin page (/admin): the left navigation (icon rail + collapsible section menu + program
   switcher), API calls to /api/admin, uploads and formatting.

   Adding a section (e.g. e-commerce): add it to SECTIONS (icon, groups of pages; add its icon to ICONS); its pages use
   <body class="admin" data-section="<key>"> and an empty <header class="admin-bar"></header>. */
window.Admin = (function () {
  // Left navigation: an icon rail (always visible) + the current section's menu (collapsible).
  // A page belongs to a section with <body class="admin" data-section="podcast">.
  var ICONS = {
    menu: '<path d="M4 5h16v14H4z" fill="none" stroke="currentColor" stroke-width="1.8" rx="2"/><path d="M9 5v14" stroke="currentColor" stroke-width="1.8"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6h-6v6H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    podcast: '<rect x="9" y="3" width="6" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    activity: '<path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    logout: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  var SECTIONS = [
    { key: 'podcast', label: 'Podcast', icon: 'podcast', home: '/admin/podcast', groups: [
      { items: [['/admin/podcast', 'Overview']] },
      { title: 'Manage', items: [
        ['/admin/podcast/episodes', 'Episodes'],
        ['/admin/podcast/cohorts', 'Cohorts'],
        ['/admin/podcast/students', 'Students'],
        ['/admin/podcast/programs', 'Programs'],
      ] },
      { title: 'Automation', items: [['/admin/podcast/automation', 'ActiveCampaign']] },
    ] },
  ];
  var COLLAPSE_KEY = 'admin-menu-collapsed';

  // The podcast program being edited (Episodes, Cohorts, Programs pages, imports, the AC sync), remembered on this browser.
  var SHOW_KEY = 'podcast-admin-show';
  function currentShow() {
    try { return localStorage.getItem(SHOW_KEY) || ''; } catch (e) { return ''; }
  }
  function setShow(slug) {
    try { localStorage.setItem(SHOW_KEY, slug); } catch (e) { /* private mode: falls back to the first show */ }
  }

  function handle(res) {
    if (res.status === 401) {
      location.href = '/admin/login?next=' + encodeURIComponent(location.pathname);
      return new Promise(function () {});
    }
    return res.json().catch(function () {
      throw new Error('The admin API did not answer (HTTP ' + res.status + '). It only runs on Vercel deployments, not on the local preview server.');
    }).then(function (body) {
      if (!res.ok) throw new Error(body.error || 'HTTP ' + res.status);
      return body;
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">' + ICONS[name] + '</svg>';
  }

  function stored(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function store(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* private mode */ } }

  // Draws the left navigation into <header class="admin-bar">.
  function nav() {
    var bar = document.querySelector('.admin-bar');
    if (!bar || bar.dataset.ready) return;
    bar.dataset.ready = '1';
    var here = location.pathname.replace(/\/$/, '') || '/admin';
    var key = document.body.dataset.section || '';
    var section = SECTIONS.find(function (x) { return x.key === key; });
    var small = window.matchMedia('(max-width: 720px)').matches;
    var collapsed = small || stored(COLLAPSE_KEY) === '1';

    function rail(href, label, name, current) {
      return '<a class="rail__item" href="' + href + '" data-label="' + esc(label) + '"' + (current ? ' aria-current="page"' : '') + '>' + icon(name) + '<span class="sr-only">' + esc(label) + '</span></a>';
    }
    var menu = section ? '<nav class="subnav" id="subnav" aria-label="' + esc(section.label) + '">' +
      '<div class="subnav__head"><p class="subnav__title">' + esc(section.label) + '</p></div>' +
      '<div class="subnav__slot"></div>' +
      section.groups.map(function (g) {
        return (g.title ? '<p class="subnav__group">' + esc(g.title) + '</p>' : '') + '<ul>' +
          g.items.map(function (it) { return '<li><a href="' + it[0] + '"' + (here === it[0] ? ' aria-current="page"' : '') + '>' + esc(it[1]) + '</a></li>'; }).join('') + '</ul>';
      }).join('') + '</nav>' : '';

    bar.innerHTML =
      '<div class="rail">' +
        (section ? '<button class="rail__item rail__toggle" type="button" data-label="' + (collapsed ? 'Show menu' : 'Hide menu') + '" aria-controls="subnav" aria-expanded="' + String(!collapsed) + '">' + icon('menu') + '<span class="sr-only">Menu</span></button>' : '') +
        rail('/admin', 'Home', 'home', here === '/admin') +
        SECTIONS.map(function (x) { return rail(x.home, x.label, x.icon, x === section); }).join('') +
        '<span class="rail__spacer"></span>' +
        rail('/admin/activity', 'Activity', 'activity', here === '/admin/activity') +
        rail('/admin/logout', 'Log out', 'logout', false) +
      '</div>' + menu;
    document.body.classList.toggle('has-subnav', Boolean(section));
    document.body.classList.toggle('subnav-collapsed', Boolean(section) && collapsed);

    var toggle = bar.querySelector('.rail__toggle');
    if (toggle) toggle.addEventListener('click', function () {
      var nowCollapsed = !document.body.classList.contains('subnav-collapsed');
      document.body.classList.toggle('subnav-collapsed', nowCollapsed);
      toggle.setAttribute('aria-expanded', String(!nowCollapsed));
      toggle.dataset.label = nowCollapsed ? 'Show menu' : 'Hide menu';
      if (!window.matchMedia('(max-width: 720px)').matches) store(COLLAPSE_KEY, nowCollapsed ? '1' : '0');
    });
    // Phones: the menu is a drawer over the page; tapping outside it or Escape closes it.
    function closeDrawer() {
      if (!toggle || !window.matchMedia('(max-width: 720px)').matches || document.body.classList.contains('subnav-collapsed')) return;
      document.body.classList.add('subnav-collapsed');
      toggle.setAttribute('aria-expanded', 'false');
    }
    document.addEventListener('click', function (ev) { if (!ev.target.closest('.admin-bar')) closeDrawer(); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeDrawer(); });
    if (key === 'podcast') programSwitcher(bar.querySelector('.subnav__slot'));
  }

  // Podcast pages: which program they work on.
  function programSwitcher(row) {
    var label = document.createElement('label');
    label.className = 'show-switch';
    label.innerHTML = '<span>Program</span><select id="show-switch" aria-label="Program you are working on"><option>…</option></select>';
    row.appendChild(label);
    api.get('shows').then(function (r) {
      var sel = document.getElementById('show-switch');
      var cur = currentShow();
      if (!r.shows.some(function (x) { return x.slug === cur; }) && r.shows.length) { cur = r.shows[0].slug; setShow(cur); }
      sel.innerHTML = r.shows.map(function (x) { return '<option value="' + esc(x.slug) + '"' + (x.slug === cur ? ' selected' : '') + '>' + esc(x.title) + '</option>'; }).join('') || '<option value="">No program yet</option>';
      sel.addEventListener('change', function () { setShow(sel.value); location.reload(); });
      var curShow = r.shows.find(function (x) { return x.slug === cur; });
      document.querySelectorAll('[data-show-title]').forEach(function (n) { n.textContent = curShow ? curShow.title : ''; });
      document.dispatchEvent(new CustomEvent('admin:shows', { detail: { shows: r.shows, current: cur } }));
    }).catch(function () { label.hidden = true; });
  }

  // Dates in the show's timezone (Seoul), e.g. "Sun 25 Oct 2026, 09:00".
  function kst(value, withTime) {
    if (!value) return '–';
    var opts = { timeZone: 'Asia/Seoul', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    if (withTime !== false) { opts.hour = '2-digit'; opts.minute = '2-digit'; opts.hourCycle = 'h23'; }
    return new Intl.DateTimeFormat('en-GB', opts).format(new Date(value));
  }

  // Last day of access (access ends at 00:00 the next day), e.g. "Sun 10 Oct 2027".
  function lastDay(value) {
    return value ? kst(new Date(new Date(value).getTime() - 1), false) : '–';
  }

  // "YYYY-MM-DD" and "HH:MM" of an instant in Seoul time (for date/time inputs).
  function kstParts(value) {
    var p = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(value)).forEach(function (x) { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
  }

  function size(bytes) {
    if (bytes == null) return '–';
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  function duration(seconds) {
    if (!seconds) return '–';
    var h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  }

  function audioDuration(file) {
    return new Promise(function (resolve) {
      var a = document.createElement('audio');
      a.preload = 'metadata';
      a.onloadedmetadata = function () { resolve(isFinite(a.duration) ? Math.round(a.duration) : null); URL.revokeObjectURL(a.src); };
      a.onerror = function () { resolve(null); };
      a.src = URL.createObjectURL(file);
    });
  }

  function imageSize(file) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(img.src); };
      img.onerror = function () { reject(new Error('This file is not a readable image.')); };
      img.src = URL.createObjectURL(file);
    });
  }

  function contentType(file) {
    if (file.type) return file.type === 'audio/mp3' ? 'audio/mpeg' : file.type;
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    return { mp3: 'audio/mpeg', m4a: 'audio/x-m4a', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }[ext] || '';
  }

  var api = {
    esc: esc, kst: kst, kstParts: kstParts, lastDay: lastDay, size: size, duration: duration, audioDuration: audioDuration, imageSize: imageSize,
    get: function (action, params) {
      var q = new URLSearchParams(Object.assign({ action: action, show: currentShow() }, params || {}));
      return fetch('/api/admin?' + q, { credentials: 'same-origin' }).then(handle);
    },
    post: function (action, data) {
      return fetch('/api/admin?action=' + encodeURIComponent(action), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({ show: currentShow() }, data || {})),
      }).then(handle);
    },
    // Uploads a file straight to the private store. onProgress(0–100). Resolves with the stored pathname.
    upload: function (file, purpose, onProgress) {
      var type = contentType(file);
      return api.post('upload-url', { purpose: purpose, content_type: type, size: file.size }).then(function (target) {
        return new Promise(function (resolve, reject) {
          var xhr = new XMLHttpRequest();
          xhr.open('PUT', target.url);
          Object.keys(target.headers).forEach(function (k) { if (target.headers[k]) xhr.setRequestHeader(k, target.headers[k]); });
          xhr.upload.onprogress = function (e) { if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100)); };
          xhr.onload = function () {
            if (xhr.status >= 200 && xhr.status < 300) resolve(target.pathname);
            else reject(new Error('Upload failed (HTTP ' + xhr.status + '). ' + (xhr.responseText || '').slice(0, 200)));
          };
          xhr.onerror = function () { reject(new Error('Upload failed: network error.')); };
          xhr.send(file);
        });
      });
    },
    contentType: contentType,
    currentShow: currentShow,
    setShow: setShow,
    // Shows a message in a role=status element.
    say: function (el, message, isError) {
      el.textContent = message || '';
      el.classList.toggle('is-error', Boolean(isError));
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', nav);
  else nav();
  return api;
})();
