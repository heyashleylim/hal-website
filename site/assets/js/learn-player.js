/*
 * Player of the student area (/learn/<program>, api/_lib/learn/pages.js). Progressive enhancement: without this
 * script the page still has the native <audio> controls and links to every module.
 *
 * Adds: −15 s / play / +30 s / speed buttons, lock-screen controls (Media Session API; next/previous move between
 * chapters, then modules), chapters (tap to jump, the current one highlighted and shown on the lock screen),
 * switching modules without reloading, the next module at the end, and progress saved to the student's account
 * (POST /learn/progress every 10 s while playing, on pause, and with sendBeacon when the page is hidden).
 */
(function () {
  var dataEl = document.getElementById('learn-data');
  var audio = document.querySelector('.play__audio');
  if (!dataEl || !audio) return;
  var data = JSON.parse(dataEl.textContent);
  var tracks = data.tracks;
  var SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

  var titleEl = document.querySelector('.play__title');
  var labelEl = document.querySelector('[data-label]');
  var nowChapterEl = document.querySelector('[data-now-chapter]');
  var toggle = document.querySelector('[data-toggle]');
  var speedBtn = document.querySelector('[data-speed]');
  var resumeEl = document.querySelector('.play__resume');
  var chaptersCard = document.querySelector('.learn__chapters');
  var chaptersEl = document.querySelector('[data-chapters]');
  var links = Array.prototype.slice.call(document.querySelectorAll('[data-track]'));
  document.querySelector('.play__controls').hidden = false;

  function pref(k, v) {
    try {
      if (v === undefined) return localStorage.getItem('learn:' + k);
      localStorage.setItem('learn:' + k, String(v));
    } catch (e) { return null; }
  }
  function clock(t) {
    t = Math.max(0, Math.floor(t || 0));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') + m : m) + ':' + (s < 10 ? '0' : '') + s;
  }

  var index = 0;
  var speed = Number(pref('speed')) || 1;
  if (SPEEDS.indexOf(speed) < 0) speed = 1;
  var chapterIndex = -1;

  // ---------- progress ----------
  var played = 0, lastTime = null, lastSave = 0;
  function payload(ended) {
    var t = tracks[index];
    var body = { episode: t.id, position: Math.floor(ended ? 0 : audio.currentTime || 0), played: Math.round(played), ended: Boolean(ended) };
    played = 0;
    lastSave = Date.now();
    t.position = body.position;
    return body;
  }
  function save(ended) {
    var t = tracks[index];
    if (!t || (!ended && !audio.currentTime)) return;
    var body = payload(ended);
    fetch('/learn/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', keepalive: true })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (r) { if (r && r.done) t.done = true; badge(t); })
      .catch(function () {});
  }
  function beacon() {
    var t = tracks[index];
    if (!t || !audio.currentTime || !navigator.sendBeacon) return save(false);
    navigator.sendBeacon('/learn/progress', new Blob([JSON.stringify(payload(false))], { type: 'text/plain' }));
  }
  function badge(t) {
    var el = document.querySelector('[data-state="' + t.id + '"]');
    if (!el) return;
    el.innerHTML = '';
    var span = document.createElement('span');
    span.className = 'learn__badge' + (t.done ? ' learn__badge--done' : '');
    span.textContent = t.done ? '다 들음' : t.position > 5 ? clock(t.position) + '까지 들음' : '';
    if (span.textContent) el.appendChild(span);
  }

  // ---------- chapters ----------
  function renderChapters(t) {
    chaptersEl.innerHTML = '';
    t.chapters.forEach(function (c, i) {
      var li = document.createElement('li');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'learn__chapter';
      b.setAttribute('data-start', c.start);
      b.setAttribute('data-chapter', i);
      var time = document.createElement('span');
      time.className = 'learn__chapter-time';
      time.textContent = clock(c.start);
      var title = document.createElement('span');
      title.className = 'learn__chapter-title';
      title.textContent = c.title;
      b.appendChild(time);
      b.appendChild(title);
      li.appendChild(b);
      chaptersEl.appendChild(li);
    });
    chaptersCard.hidden = !t.chapters.length;
    chapterIndex = -1;
  }
  function currentChapter(time) {
    var cs = tracks[index].chapters, found = -1;
    for (var i = 0; i < cs.length; i++) if (cs[i].start <= time + 0.25) found = i;
    return found;
  }
  function updateChapter() {
    var i = currentChapter(audio.currentTime || 0);
    if (i === chapterIndex) return;
    chapterIndex = i;
    Array.prototype.forEach.call(chaptersEl.querySelectorAll('.learn__chapter'), function (b, j) {
      if (j === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    var c = i >= 0 ? tracks[index].chapters[i] : null;
    nowChapterEl.textContent = c ? c.title : '';
    mediaSession();
  }
  function seek(t) {
    var d = audio.duration || Infinity;
    audio.currentTime = Math.min(Math.max(0, t), d - 0.5);
    lastTime = audio.currentTime;
    updateChapter();
  }
  chaptersEl.addEventListener('click', function (e) {
    var b = e.target.closest('.learn__chapter');
    if (!b) return;
    seek(Number(b.getAttribute('data-start')));
    if (audio.paused) audio.play().catch(function () {});
  });

  // ---------- lock screen ----------
  function mediaSession() {
    if (!('mediaSession' in navigator)) return;
    var t = tracks[index];
    var c = chapterIndex >= 0 ? t.chapters[chapterIndex] : null;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: c ? c.title : t.title,
        artist: c ? t.label + ' · ' + t.title : t.label + ' · ' + data.program,
        album: data.program,
        artwork: data.art ? [{ src: new URL(data.art, location.href).href, sizes: '1400x1400' }] : [],
      });
    } catch (e) {}
  }

  // ---------- tracks ----------
  function load(i, autoplay) {
    if (tracks[index] && i !== index && audio.currentTime) save(false);
    index = i;
    var t = tracks[i];
    audio.src = t.src;
    titleEl.textContent = t.title;
    labelEl.textContent = t.label;
    document.title = t.title + ' · ' + data.program;
    links.forEach(function (a) { if (a.getAttribute('data-track') === t.id) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current'); });
    try { history.replaceState(null, '', '/learn/' + data.show + '?e=' + t.id); } catch (e) {}
    renderChapters(t);
    nowChapterEl.textContent = '';
    var pos = t.position > 5 ? t.position : 0;
    resumeEl.hidden = !pos;
    resumeEl.textContent = pos ? clock(pos) + '부터 이어서 들어요.' : '';
    played = 0;
    lastTime = null;
    audio.addEventListener('loadedmetadata', function once() {
      audio.removeEventListener('loadedmetadata', once);
      if (pos && (!audio.duration || pos < audio.duration - 5)) audio.currentTime = pos;
      audio.playbackRate = speed;
      updateChapter();
    });
    chapterIndex = -1;
    updateChapter();
    if (autoplay) audio.play().catch(function () {});
  }

  function setSpeed(s) {
    speed = s;
    audio.playbackRate = s;
    audio.defaultPlaybackRate = s;
    speedBtn.textContent = s + '×';
    speedBtn.setAttribute('aria-label', '재생 속도 ' + s + '배');
    pref('speed', s);
  }

  function nextChapterOrTrack() {
    var cs = tracks[index].chapters;
    var i = currentChapter(audio.currentTime || 0);
    if (cs.length && i + 1 < cs.length) return seek(cs[i + 1].start);
    if (index + 1 < tracks.length) load(index + 1, true);
  }
  function previousChapterOrTrack() {
    var cs = tracks[index].chapters, now = audio.currentTime || 0;
    var i = currentChapter(now);
    // Back to the start of this chapter; again (within 3 s) to the previous chapter, then the previous module.
    if (cs.length && i >= 0) {
      if (now - cs[i].start > 3) return seek(cs[i].start);
      if (i > 0) return seek(cs[i - 1].start);
    } else if (now > 5) {
      return seek(0);
    }
    if (index > 0) return load(index - 1, true);
    seek(0);
  }

  toggle.addEventListener('click', function () { if (audio.paused) audio.play(); else audio.pause(); });
  document.querySelectorAll('[data-skip]').forEach(function (b) {
    b.addEventListener('click', function () { seek((audio.currentTime || 0) + Number(b.getAttribute('data-skip'))); });
  });
  speedBtn.addEventListener('click', function () { setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]); });
  links.forEach(function (a) {
    a.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      var id = a.getAttribute('data-track');
      for (var i = 0; i < tracks.length; i++) if (tracks[i].id === id) {
        e.preventDefault();
        if (i !== index) load(i, true);
        document.querySelector('.play').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
    });
  });

  audio.addEventListener('play', function () { toggle.textContent = '일시정지'; toggle.setAttribute('aria-label', '일시정지'); audio.playbackRate = speed; lastTime = audio.currentTime; });
  audio.addEventListener('pause', function () { toggle.textContent = '재생'; toggle.setAttribute('aria-label', '재생'); if (!audio.ended) save(false); });
  audio.addEventListener('seeking', function () { lastTime = null; });
  audio.addEventListener('timeupdate', function () {
    var now = audio.currentTime;
    if (lastTime != null && !audio.paused) {
      var d = now - lastTime;
      if (d > 0 && d < 3) played += d / (audio.playbackRate || 1); // real seconds listened, not media seconds
    }
    lastTime = now;
    updateChapter();
    if (!audio.paused && Date.now() - lastSave > 10000) save(false);
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && audio.duration) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: now, playbackRate: audio.playbackRate }); } catch (e) {}
    }
  });
  audio.addEventListener('ended', function () {
    var t = tracks[index];
    t.done = true;
    save(true);
    badge(t);
    if (index + 1 < tracks.length) load(index + 1, true);
  });

  if ('mediaSession' in navigator) {
    var handlers = {
      play: function () { audio.play(); },
      pause: function () { audio.pause(); },
      seekbackward: function (d) { seek((audio.currentTime || 0) - ((d && d.seekOffset) || 15)); },
      seekforward: function (d) { seek((audio.currentTime || 0) + ((d && d.seekOffset) || 30)); },
      seekto: function (d) { if (d && d.seekTime != null) seek(d.seekTime); },
      previoustrack: previousChapterOrTrack,
      nexttrack: nextChapterOrTrack,
    };
    Object.keys(handlers).forEach(function (k) { try { navigator.mediaSession.setActionHandler(k, handlers[k]); } catch (e) {} });
  }

  document.addEventListener('visibilitychange', function () { if (document.hidden && !audio.paused) beacon(); });
  window.addEventListener('pagehide', function () { if (audio.currentTime) beacon(); });

  var start = 0;
  tracks.forEach(function (t, i) { if (t.id === data.current) start = i; });
  setSpeed(speed);
  load(start, false);
})();
