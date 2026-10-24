/* Shared helpers for the private podcast admin pages: API calls, navigation, uploads, formatting. */
window.Admin = (function () {
  var NAV = [
    ['/admin/podcast', 'Dashboard'],
    ['/admin/podcast/episodes', 'Episodes'],
    ['/admin/podcast/cohorts', 'Cohorts'],
    ['/admin/podcast/show', 'Show settings'],
  ];

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

  // Fills <nav class="admin-nav"> and marks the current page.
  function nav() {
    var el = document.querySelector('.admin-nav');
    if (!el) return;
    var here = location.pathname.replace(/\/$/, '');
    el.innerHTML = NAV.map(function (n) {
      return '<a href="' + n[0] + '"' + (here === n[0] ? ' aria-current="page"' : '') + '>' + n[1] + '</a>';
    }).join('');
  }

  // Dates in the show's timezone (Seoul), e.g. "Sun 25 Oct 2026, 09:00".
  function kst(value, withTime) {
    if (!value) return '–';
    var opts = { timeZone: 'Asia/Seoul', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
    if (withTime !== false) { opts.hour = '2-digit'; opts.minute = '2-digit'; opts.hourCycle = 'h23'; }
    return new Intl.DateTimeFormat('en-GB', opts).format(new Date(value));
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
    esc: esc, kst: kst, kstParts: kstParts, size: size, duration: duration, audioDuration: audioDuration, imageSize: imageSize,
    get: function (action, params) {
      var q = new URLSearchParams(Object.assign({ action: action }, params || {}));
      return fetch('/api/podcast-admin?' + q, { credentials: 'same-origin' }).then(handle);
    },
    post: function (action, data) {
      return fetch('/api/podcast-admin?action=' + encodeURIComponent(action), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}),
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
