/* Podcast Studio UI: file list, uploads, waveform player, chapter editor, transcript, export. */
(function () {
  'use strict';
  var TOKEN = document.querySelector('meta[name="studio-token"]').content;
  var $ = function (id) { return document.getElementById(id); };

  var state = { projects: [], tools: {}, selected: new Set(), currentId: null, project: null, uploads: [] };
  var audio = $('audio'), canvas = $('wave'), ctx = canvas.getContext('2d');
  var chapters = [];          // editing copy: [{start, title}]
  var saveTimer = null;
  var segments = [];

  // ---------- helpers ----------
  function api(method, path, body) {
    return fetch('/api/' + path, {
      method: method,
      headers: Object.assign({ 'X-Studio-Token': TOKEN }, body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok) throw new Error(data.error || 'HTTP ' + r.status);
        return data;
      });
    });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  // 75.3 → "1:15.3"; 3725 → "1:02:05.0"
  function fmt(t, decimals) {
    if (t == null || isNaN(t)) return '–';
    var d = decimals === undefined ? 1 : decimals;
    var neg = t < 0; t = Math.abs(t);
    var h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    var ss = d ? s.toFixed(d).padStart(d + 3, '0') : String(Math.floor(s)).padStart(2, '0');
    return (neg ? '-' : '') + (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + ss;
  }

  function parseTime(text) {
    var parts = String(text).trim().split(':');
    if (!parts.length || parts.length > 3 || parts.some(function (p) { return p === '' || isNaN(Number(p)); })) return null;
    return parts.reduce(function (acc, p) { return acc * 60 + Number(p); }, 0);
  }

  function setStatus(text, isError) {
    $('status').textContent = text || '';
    $('status').classList.toggle('is-error', Boolean(isError));
  }

  // ---------- file list ----------
  function chips(p) {
    var out = [];
    if (p.duration) out.push(fmt(p.duration, 0));
    var a = p.analysis || {}, t = p.transcript || {}, e = p.export || {};
    if (a.state === 'queued' || a.state === 'running') out.push('<span class="chip chip--run">Analysing…</span>');
    if (a.state === 'error') out.push('<span class="chip chip--bad">Analysis failed</span>');
    if (t.state === 'queued') out.push('<span class="chip chip--run">Transcription queued</span>');
    if (t.state === 'running') out.push('<span class="chip chip--run">Transcribing ' + (t.progress || 0) + '%</span>');
    if (t.state === 'error') out.push('<span class="chip chip--bad">Transcription failed</span>');
    if (a.state === 'done') out.push('<span class="chip">' + p.chapters + ' chapter' + (p.chapters === 1 ? '' : 's') + (p.suggested ? ' (suggested)' : '') + '</span>');
    if (e.state === 'queued') out.push('<span class="chip chip--run">Export queued</span>');
    if (e.state === 'running') out.push('<span class="chip chip--run">Exporting ' + (e.progress || 0) + '%</span>');
    if (e.state === 'done') out.push('<span class="chip chip--ok">Exported ✓</span>');
    if (e.state === 'error') out.push('<span class="chip chip--bad">Export failed</span>');
    return out.join('');
  }

  function progressOf(p) {
    var t = p.transcript || {}, e = p.export || {};
    if (e.state === 'running') return e.progress || 0;
    if (t.state === 'running') return t.progress || 0;
    return null;
  }

  function renderList() {
    var list = $('list');
    var html = state.uploads.map(function (u) {
      return '<li class="file"><span></span><span class="file__name">' + esc(u.name) + '</span><span></span>' +
        '<span class="file__info"><span class="chip chip--run">' + (u.error ? 'Upload failed: ' + esc(u.error) : 'Adding… ' + u.progress + '%') + '</span></span>' +
        '<span class="bar"><span style="width:' + u.progress + '%"></span></span></li>';
    }).join('');
    html += state.projects.map(function (p) {
      var prog = progressOf(p);
      return '<li class="file' + (p.id === state.currentId ? ' is-current' : '') + '" data-id="' + p.id + '">' +
        '<input type="checkbox" aria-label="Select ' + esc(p.name) + ' for export" data-select' + (state.selected.has(p.id) ? ' checked' : '') + '>' +
        '<span class="file__name" title="' + esc(p.name) + '">' + esc(p.name) + '</span>' +
        '<button class="file__remove" type="button" data-remove aria-label="Remove ' + esc(p.name) + '">✕</button>' +
        '<span class="file__info">' + chips(p) + '</span>' +
        (prog !== null ? '<span class="bar"><span style="width:' + prog + '%"></span></span>' : '') + '</li>';
    }).join('');
    list.innerHTML = html;
    var n = state.selected.size;
    $('export').disabled = !n;
    $('export').textContent = n ? 'Export selected (' + n + ')' : 'Export selected';
    $('all').checked = state.projects.length > 0 && n === state.projects.length;
  }

  $('list').addEventListener('click', function (ev) {
    var li = ev.target.closest('li[data-id]');
    if (!li) return;
    var id = li.dataset.id;
    if (ev.target.closest('[data-select]')) {
      if (ev.target.checked) state.selected.add(id); else state.selected.delete(id);
      return renderList();
    }
    if (ev.target.closest('[data-remove]')) {
      var p = state.projects.find(function (x) { return x.id === id; });
      if (!confirm('Remove "' + p.name + '" from the studio? Its chapters and transcript are deleted. Exported files stay in the export folder.')) return;
      return api('DELETE', 'projects/' + id).then(function () {
        state.selected.delete(id);
        if (state.currentId === id) closeEditor();
        return refresh();
      });
    }
    openProject(id);
  });

  $('all').addEventListener('change', function () {
    state.selected = new Set($('all').checked ? state.projects.map(function (p) { return p.id; }) : []);
    renderList();
  });

  $('export').addEventListener('click', function () { exportIds(Array.from(state.selected)); });
  $('export-one').addEventListener('click', function () { if (state.currentId) exportIds([state.currentId]); });

  function exportIds(ids) {
    flushSave().then(function () {
      return api('POST', 'export', { ids: ids, bitrate: 96 });
    }).then(refresh).catch(function (err) { alert(err.message); });
  }

  // ---------- uploads ----------
  function addFiles(files) {
    Array.from(files).forEach(function (file) {
      var u = { name: file.name, progress: 0 };
      state.uploads.push(u);
      renderList();
      var xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('X-Studio-Token', TOKEN);
      xhr.setRequestHeader('X-Filename', encodeURIComponent(file.name));
      xhr.upload.onprogress = function (e) { if (e.lengthComputable) { u.progress = Math.round(e.loaded / e.total * 100); renderList(); } };
      xhr.onload = function () {
        var data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) {
          state.uploads.splice(state.uploads.indexOf(u), 1);
          refresh().then(function () { if (!state.currentId) openProject(data.id); });
        } else {
          u.error = data.error || 'HTTP ' + xhr.status;
          renderList();
          setTimeout(function () { state.uploads.splice(state.uploads.indexOf(u), 1); renderList(); }, 8000);
        }
      };
      xhr.onerror = function () { u.error = 'network error'; renderList(); };
      xhr.send(file);
    });
  }

  $('pick').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); if (t === 'drop' || e.target === document.documentElement) drop.classList.remove('is-over'); }); });
  document.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

  // ---------- polling ----------
  function refresh() {
    return api('GET', 'state').then(function (s) {
      state.projects = s.projects;
      state.tools = s.tools;
      state.appDir = s.app_dir;
      Array.from(state.selected).forEach(function (id) { if (!s.projects.some(function (p) { return p.id === id; })) state.selected.delete(id); });
      $('out-dir').textContent = 'Exports → ' + s.out_dir;
      $('tools').textContent = s.tools.whisper && s.tools.model ? 'Transcription: Whisper on this Mac (Korean).' : 'Transcription unavailable: Whisper is not installed (ask Claude to set up Podcast Studio). Chapters are suggested from pauses only.';
      renderList();
      if (state.currentId) syncCurrent();
    }).catch(function (err) {
      if (/bad token/.test(err.message)) return location.reload(); // the studio was restarted: get the new session token
      $('tools').textContent = 'Studio server not reachable: ' + err.message + '. Start it again (Podcast Studio.command) and reload.';
    });
  }
  setInterval(refresh, 1500);

  // When the open file's analysis/transcription finishes, reload it (unless chapters are being edited).
  var lastSeen = {};
  function syncCurrent() {
    var p = state.projects.find(function (x) { return x.id === state.currentId; });
    if (!p) return closeEditor();
    var key = [(p.analysis || {}).state, (p.transcript || {}).state, p.suggested, p.chapters_rev].join('|');
    var prev = lastSeen[p.id];
    lastSeen[p.id] = key;
    if (prev && prev !== key && !saveTimer) loadProject(p.id, true);
    renderHead(p);
  }

  // ---------- editor ----------
  function closeEditor() {
    state.currentId = null; state.project = null;
    audio.pause(); audio.removeAttribute('src'); audio.load();
    $('work').hidden = true; $('empty').hidden = false;
    renderList();
  }

  function openProject(id) {
    if (state.currentId === id) return;
    flushSave().then(function () {
      state.currentId = id;
      renderList();
      loadProject(id, false);
    });
  }

  function loadProject(id, keepPosition) {
    return api('GET', 'projects/' + id).then(function (p) {
      if (state.currentId !== id) return;
      var pos = keepPosition ? audio.currentTime : 0;
      state.project = p;
      chapters = (p.chapters || []).map(function (c) { return { start: c.start, title: c.title }; });
      segments = p.segments || [];
      $('empty').hidden = true; $('work').hidden = false;
      $('title').textContent = p.name;
      $('claude-prompt').textContent = claudePrompt();
      var src = '/api/projects/' + id + '/audio?t=' + encodeURIComponent(TOKEN);
      if (audio.dataset.src !== src) {
        audio.dataset.src = src;
        audio.src = src;
        audio.playbackRate = Number($('speed').value);
      } else if (keepPosition) {
        audio.currentTime = pos;
      }
      renderHead(state.projects.find(function (x) { return x.id === id; }) || p);
      renderChapters();
      renderTranscript();
      draw();
    }).catch(function (err) { setStatus(err.message, true); });
  }

  function renderHead(p) {
    if (!p) return;
    var a = p.analysis || {}, t = p.transcript || {}, e = p.export || {};
    var full = state.project || {};
    $('meta').textContent = (p.duration ? fmt(p.duration, 0) : 'Analysing…') + (full.ext ? ' · ' + full.ext.slice(1).toUpperCase() + ' source' : '');
    $('total').textContent = fmt(p.duration || 0, 0);
    var canTranscribe = state.tools.whisper && state.tools.model && a.state === 'done' && !/queued|running/.test(t.state || '');
    $('transcribe').hidden = !(state.tools.whisper && state.tools.model);
    $('transcribe').disabled = !canTranscribe;
    $('transcribe').textContent = t.state === 'done' ? 'Transcribe again' : 'Transcribe';
    $('suggest').disabled = a.state !== 'done';
    $('ask-claude').disabled = t.state !== 'done';
    $('ask-claude').title = t.state === 'done' ? '' : 'Available once the file is transcribed';
    $('export-one').disabled = a.state !== 'done' || /queued|running/.test(e.state || '');
    var msg = '', err = false;
    if (a.state === 'error') { msg = 'Analysis failed: ' + a.error; err = true; }
    else if (a.state !== 'done') msg = 'Analysing the audio (waveform and pauses)…';
    else if (t.state === 'running') msg = 'Transcribing on this Mac… ' + (t.progress || 0) + '%. Chapters will be re-suggested from the transcript unless you edit them first.';
    else if (t.state === 'queued') msg = 'Transcription queued (one file at a time).';
    else if (t.state === 'error') { msg = 'Transcription failed: ' + t.error; err = true; }
    if (e.state === 'running') msg = 'Exporting… ' + (e.progress || 0) + '%';
    else if (e.state === 'queued') msg = 'Export queued.';
    else if (e.state === 'error') { msg = 'Export failed: ' + e.error; err = true; }
    else if (e.state === 'done' && e.result && !msg) {
      var r = e.result;
      $('status').innerHTML = 'Exported: <strong>' + esc(r.path.split('/').pop()) + '</strong> — ' + (r.bytes / 1048576).toFixed(1) + ' MB, ' + r.bitrate +
        ' kbps mono, ' + r.loudness_after.toFixed(1) + ' LUFS, peak ' + r.peak_after.toFixed(1) + ' dB, ' + r.chapters + ' chapters. ' +
        '<button class="btn btn--sm" type="button" id="reveal">Show in Finder</button> <a class="btn btn--sm" href="/api/projects/' + p.id + '/output?t=' + encodeURIComponent(TOKEN) + '">Download</a>' +
        (r.chapters !== r.chapters_expected ? ' <strong class="is-error">Not all chapters were written.</strong>' : '');
      $('status').classList.remove('is-error');
      return;
    }
    setStatus(msg, err);
  }

  $('status').addEventListener('click', function (ev) {
    if (ev.target.id === 'reveal') api('POST', 'projects/' + state.currentId + '/reveal').catch(function (err) { alert(err.message); });
  });

  function claudePrompt() {
    return 'In Podcast Studio (' + (state.appDir || '~/Podcast-Studio') + '), suggest chapters for "' + (state.project ? state.project.name : '') + '"';
  }

  $('ask-claude').addEventListener('click', function () {
    var box = $('claude-box'), open = box.hidden;
    box.hidden = !open;
    this.setAttribute('aria-expanded', String(open));
    $('claude-prompt').textContent = claudePrompt();
  });

  $('copy-prompt').addEventListener('click', function () {
    var btn = this;
    navigator.clipboard.writeText(claudePrompt()).then(function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy'; }, 1500);
    });
  });

  $('transcribe').addEventListener('click', function () {
    api('POST', 'projects/' + state.currentId + '/transcribe').then(refresh).catch(function (err) { setStatus(err.message, true); });
  });

  $('suggest').addEventListener('click', function () {
    if (chapters.length && !confirm('Replace the current chapters with new suggestions?')) return;
    clearTimeout(saveTimer); saveTimer = null;
    api('POST', 'projects/' + state.currentId + '/suggest').then(function (r) {
      chapters = r.chapters; renderChapters(); draw(); refresh();
    }).catch(function (err) { setStatus(err.message, true); });
  });

  // ---------- chapters ----------
  function sortChapters() { chapters.sort(function (a, b) { return a.start - b.start; }); }

  function activeIndex(t) {
    var idx = -1;
    chapters.forEach(function (c, i) { if (c.start <= t + 0.05) idx = i; });
    return idx;
  }

  function renderChapters() {
    var dur = (state.project && state.project.duration) || 0;
    var times = {};
    var warn = [];
    if (chapters.length && chapters[0].start > 0.05) warn.push('The first chapter should start at 0:00.0 (some apps skip the beginning otherwise).');
    $('chapters').innerHTML = chapters.map(function (c, i) {
      var key = c.start.toFixed(1);
      var bad = times[key] || c.start >= dur;
      times[key] = true;
      if (bad) warn.push('Chapter ' + (i + 1) + ' has the same time as another, or starts after the end.');
      return '<li class="ch" data-i="' + i + '">' +
        '<span class="ch__n">' + (i + 1) + '</span>' +
        '<button class="btn btn--sm" type="button" data-go aria-label="Play from chapter ' + (i + 1) + '">▶</button>' +
        '<input class="ch__time' + (bad ? ' is-bad' : '') + '" value="' + fmt(c.start) + '" aria-label="Start time of chapter ' + (i + 1) + '" data-time>' +
        '<span class="ch__nudge"><button class="btn btn--sm" type="button" data-nudge="-1" aria-label="1 second earlier">−1s</button>' +
        '<button class="btn btn--sm" type="button" data-nudge="1" aria-label="1 second later">+1s</button>' +
        '<button class="btn btn--sm" type="button" data-here title="Set to the playhead position">⤓ here</button></span>' +
        '<input class="ch__title" value="' + esc(c.title) + '" maxlength="200" aria-label="Title of chapter ' + (i + 1) + '" data-title>' +
        '<button class="ch__del" type="button" data-del aria-label="Delete chapter ' + (i + 1) + '">✕</button></li>';
    }).join('');
    if (!chapters.length) $('chapters').innerHTML = '<li class="muted">No chapters. Press <kbd>M</kbd> or “+ Add at playhead”.</li>';
    var by = state.project && state.project.chapters_by;
    $('ch-note').textContent = warn.length ? warn.join(' ') :
      by === 'claude' ? 'Suggested by Claude — listen to each start and adjust if needed.' :
      state.project && state.project.suggested ? 'Suggested from pauses' + (segments.length ? ' and the transcript' : '') + ' — check each start and rewrite the titles.' : '';
    $('ch-note').classList.toggle('is-warn', warn.length > 0);
    highlightChapter();
  }

  function highlightChapter() {
    var idx = activeIndex(audio.currentTime);
    document.querySelectorAll('.ch').forEach(function (li) { li.classList.toggle('is-active', Number(li.dataset.i) === idx); });
  }

  function changed(rerender) {
    if (state.project && (state.project.suggested || state.project.chapters_by === 'claude')) { state.project.suggested = false; state.project.chapters_by = 'you'; rerender = true; }
    if (rerender) { sortChapters(); renderChapters(); }
    draw();
    $('saved').textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 600);
  }

  function save() {
    saveTimer = null;
    var id = state.currentId;
    return api('PUT', 'projects/' + id + '/chapters', { chapters: chapters }).then(function () {
      if (state.currentId === id) $('saved').textContent = 'All changes saved.';
      if (state.project) state.project.suggested = false;
    }).catch(function (err) { $('saved').textContent = 'Not saved: ' + err.message; });
  }

  function flushSave() {
    if (!saveTimer) return Promise.resolve();
    clearTimeout(saveTimer);
    return save();
  }

  function addChapterAt(t, title) {
    t = Math.max(0, Math.round(t * 10) / 10);
    chapters.push({ start: t, title: title || 'Chapter ' + (chapters.length + 1) });
    changed(true);
    var i = chapters.findIndex(function (c) { return c.start === t; });
    var input = document.querySelector('.ch[data-i="' + i + '"] [data-title]');
    if (input) { input.focus(); input.select(); }
  }

  $('add-chapter').addEventListener('click', function () { addChapterAt(audio.currentTime); });

  $('chapters').addEventListener('click', function (ev) {
    var li = ev.target.closest('.ch');
    if (!li) return;
    var i = Number(li.dataset.i), c = chapters[i];
    if (ev.target.closest('[data-go]')) { seek(c.start); audio.play(); }
    else if (ev.target.closest('[data-nudge]')) { c.start = Math.max(0, Math.round((c.start + Number(ev.target.dataset.nudge)) * 10) / 10); seek(c.start); changed(true); }
    else if (ev.target.closest('[data-here]')) { c.start = Math.round(audio.currentTime * 10) / 10; changed(true); }
    else if (ev.target.closest('[data-del]')) { chapters.splice(i, 1); changed(true); }
  });

  $('chapters').addEventListener('input', function (ev) {
    var li = ev.target.closest('.ch');
    if (li && ev.target.matches('[data-title]')) { chapters[Number(li.dataset.i)].title = ev.target.value; changed(false); }
  });

  $('chapters').addEventListener('change', function (ev) {
    var li = ev.target.closest('.ch');
    if (!li || !ev.target.matches('[data-time]')) return;
    var t = parseTime(ev.target.value);
    if (t === null) { ev.target.classList.add('is-bad'); return; }
    chapters[Number(li.dataset.i)].start = Math.round(t * 10) / 10;
    changed(true);
  });

  $('chapters').addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && ev.target.matches('[data-time]')) ev.target.blur();
  });

  // ---------- transcript ----------
  function renderTranscript() {
    var t = (state.project && state.project.transcript) || {};
    if (!segments.length) {
      $('transcript').innerHTML = '<p class="tr-empty">' + (t.state === 'running' || t.state === 'queued' ? 'Transcribing… the text appears here when it’s done.' :
        state.tools.whisper && state.tools.model ? 'No transcript yet. Click “Transcribe”.' : 'Transcription isn’t available on this Mac.') + '</p>';
      return;
    }
    $('transcript').innerHTML = segments.map(function (s, i) {
      return '<div class="seg" data-i="' + i + '"><button class="seg__time" type="button" data-seek>' + fmt(s.start, 0) + '</button>' +
        '<span class="seg__text">' + esc(s.text) + '</span>' +
        '<button class="btn btn--sm seg__add" type="button" data-chapter title="Start a chapter here">+ Chapter</button></div>';
    }).join('');
  }

  $('transcript').addEventListener('click', function (ev) {
    var row = ev.target.closest('.seg');
    if (!row) return;
    var s = segments[Number(row.dataset.i)];
    if (ev.target.closest('[data-chapter]')) addChapterAt(s.start, s.text.replace(/\s+/g, ' ').slice(0, 40));
    else { seek(s.start); if (ev.target.closest('[data-seek]')) audio.play(); }
  });

  var lastSeg = -1;
  function followTranscript() {
    if (!segments.length) return;
    var t = audio.currentTime, idx = -1;
    for (var i = 0; i < segments.length; i++) { if (segments[i].start <= t) idx = i; else break; }
    if (idx === lastSeg) return;
    var prev = document.querySelector('.seg.is-current');
    if (prev) prev.classList.remove('is-current');
    var row = document.querySelector('.seg[data-i="' + idx + '"]');
    if (row) {
      row.classList.add('is-current');
      if ($('follow').checked && !audio.paused) {
        var box = $('transcript');
        box.scrollTop = row.offsetTop - box.offsetTop - box.clientHeight / 3;
      }
    }
    lastSeg = idx;
  }

  // ---------- player + waveform ----------
  function duration() { return (state.project && state.project.duration) || audio.duration || 0; }

  function seek(t) {
    audio.currentTime = Math.max(0, Math.min(duration(), t));
    tick();
  }

  function view() {
    var dur = duration(), span = Number($('zoom').value) || dur;
    if (span >= dur) return { from: 0, to: dur || 1 };
    var from = Math.max(0, Math.min(dur - span, audio.currentTime - span / 2));
    return { from: from, to: from + span };
  }

  function draw() {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var p = state.project;
    if (!p) return;
    var peaks = p.peaks || [], pps = p.peaks_per_second || 10, v = view(), span = v.to - v.from;
    var css = getComputedStyle(document.documentElement);
    var mid = h / 2, now = audio.currentTime;
    for (var x = 0; x < w; x++) {
      var t0 = v.from + span * x / w, t1 = v.from + span * (x + 1) / w;
      var i0 = Math.floor(t0 * pps), i1 = Math.max(i0 + 1, Math.ceil(t1 * pps)), peak = 0;
      for (var i = i0; i < i1 && i < peaks.length; i++) if (peaks[i] > peak) peak = peaks[i];
      var bar = Math.max(1, peak / 255 * (h / 2 - 4));
      ctx.fillStyle = t0 < now ? css.getPropertyValue('--wave-played') : css.getPropertyValue('--wave');
      ctx.fillRect(x, mid - bar, 1, bar * 2);
    }
    ctx.font = '600 11px -apple-system, sans-serif';
    chapters.forEach(function (c, i) {
      if (c.start < v.from || c.start > v.to) return;
      var x = (c.start - v.from) / span * w;
      ctx.fillStyle = css.getPropertyValue('--marker');
      ctx.fillRect(x, 0, 2, h);
      var label = String(i + 1);
      ctx.fillRect(x, 0, ctx.measureText(label).width + 8, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + 4, 12);
    });
    if (now >= v.from && now <= v.to) {
      ctx.fillStyle = css.getPropertyValue('--ink');
      ctx.fillRect((now - v.from) / span * w - 1, 0, 2, h);
    }
  }

  function timeAt(ev) {
    var r = canvas.getBoundingClientRect(), v = view();
    return v.from + (v.to - v.from) * Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
  }

  canvas.addEventListener('click', function (ev) { seek(timeAt(ev)); });
  canvas.addEventListener('mousemove', function (ev) {
    var tip = $('tip');
    tip.hidden = false;
    tip.textContent = fmt(timeAt(ev));
    tip.style.left = (ev.clientX - canvas.getBoundingClientRect().left) + 'px';
  });
  canvas.addEventListener('mouseleave', function () { $('tip').hidden = true; });
  window.addEventListener('resize', draw);
  $('zoom').addEventListener('change', draw);
  $('speed').addEventListener('change', function () { audio.playbackRate = Number(this.value); });

  $('play').addEventListener('click', function () { if (audio.paused) audio.play(); else audio.pause(); });
  document.querySelectorAll('[data-skip]').forEach(function (b) {
    b.addEventListener('click', function () { seek(audio.currentTime + Number(b.dataset.skip)); });
  });
  audio.addEventListener('play', function () { $('play').textContent = '❚❚'; $('play').setAttribute('aria-label', 'Pause'); });
  audio.addEventListener('pause', function () { $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play'); });
  audio.addEventListener('loadedmetadata', draw);

  function tick() {
    $('now').textContent = fmt(audio.currentTime);
    draw();
    highlightChapter();
    followTranscript();
  }
  audio.addEventListener('timeupdate', tick);
  (function loop() { if (!audio.paused) tick(); requestAnimationFrame(loop); })();

  document.addEventListener('keydown', function (ev) {
    if (!state.project || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    var typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== 'checkbox';
    if (typing) return;
    if (ev.key === ' ') { ev.preventDefault(); if (audio.paused) audio.play(); else audio.pause(); }
    else if (ev.key === 'm' || ev.key === 'M') { ev.preventDefault(); addChapterAt(audio.currentTime); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); seek(audio.currentTime - 2); }
    else if (ev.key === 'ArrowRight') { ev.preventDefault(); seek(audio.currentTime + 2); }
  });

  window.addEventListener('beforeunload', function (ev) {
    if (saveTimer) { flushSave(); ev.preventDefault(); }
  });

  refresh();
})();
