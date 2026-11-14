/*
 * TEST web player for /podcast/<token>/listen (api/podcast-page.js listenPage).
 * One <audio> element (native controls stay as the no-JS fallback), skip and speed buttons, lock-screen controls
 * (Media Session API), resume per episode (saved in this browser only, for the test), next episode at the end,
 * and a test log that shows whether audio kept playing while the page was hidden (screen off, other app).
 */
(function () {
  var dataEl = document.getElementById('play-data');
  var audio = document.querySelector('.play__audio');
  if (!dataEl || !audio) return;
  var data = JSON.parse(dataEl.textContent);
  var tracks = data.tracks;
  var KEY = 'pod-player:' + data.student + ':';
  var SPEEDS = [1, 1.25, 1.5, 1.75, 2, 0.75];

  var titleEl = document.querySelector('.play__title');
  var showEl = document.querySelector('.play__show');
  var artEl = document.querySelector('.play__art');
  var toggle = document.querySelector('[data-toggle]');
  var speedBtn = document.querySelector('[data-speed]');
  var resumeEl = document.querySelector('.play__resume');
  var logCard = document.querySelector('.play__log-card');
  var logEl = document.querySelector('.play__log');
  var items = Array.prototype.slice.call(document.querySelectorAll('.play__item'));
  document.querySelector('.play__controls').hidden = false;
  logCard.hidden = false;

  function store(k, v) { try { if (v == null) localStorage.removeItem(KEY + k); else localStorage.setItem(KEY + k, String(v)); } catch (e) {} }
  function read(k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } }
  function clock(t) {
    t = Math.max(0, Math.floor(t || 0));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    return (h ? h + ':' + (m < 10 ? '0' : '') + m : m) + ':' + (s < 10 ? '0' : '') + s;
  }
  function now() { return new Date().toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit', second: '2-digit' }); }
  function log(text) {
    var li = document.createElement('li');
    li.textContent = now() + ' · ' + text;
    logEl.insertBefore(li, logEl.firstChild);
  }

  var index = 0;
  var speed = Number(read('speed')) || 1;

  function showPositions() {
    tracks.forEach(function (t) {
      var el = document.querySelector('[data-pos="' + t.guid + '"]');
      var pos = Number(read('pos:' + t.guid)) || 0;
      if (el) el.textContent = read('done:' + t.guid) ? ' · 다 들음' : pos > 5 ? ' · ' + clock(pos) + '까지 들음' : '';
    });
  }

  function mediaSession(t) {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: 'Ashley Lim',
      album: t.show,
      artwork: t.art ? [{ src: new URL(t.art, location.href).href, sizes: '1400x1400' }] : [],
    });
  }

  function load(i, autoplay) {
    index = i;
    var t = tracks[i];
    audio.src = t.src;
    titleEl.textContent = t.title;
    showEl.textContent = t.show;
    if (artEl && t.art) artEl.src = t.art;
    items.forEach(function (b, j) { if (j === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    store('last', t.guid);
    var pos = Number(read('pos:' + t.guid)) || 0;
    resumeEl.hidden = !(pos > 5);
    if (pos > 5) resumeEl.textContent = clock(pos) + '부터 이어서 들어요.';
    audio.addEventListener('loadedmetadata', function once() {
      audio.removeEventListener('loadedmetadata', once);
      if (pos > 5 && (!audio.duration || pos < audio.duration - 5)) audio.currentTime = pos;
      audio.playbackRate = speed;
    });
    mediaSession(t);
    if (autoplay) audio.play().catch(function (e) { log('재생 시작 안 됨: ' + e.name); });
  }

  function setSpeed(s) {
    speed = s;
    audio.playbackRate = s;
    audio.defaultPlaybackRate = s;
    speedBtn.textContent = s + '×';
    speedBtn.setAttribute('aria-label', '재생 속도 ' + s + '배');
    store('speed', s);
  }

  function skip(seconds) {
    var d = audio.duration || Infinity;
    audio.currentTime = Math.min(Math.max(0, audio.currentTime + seconds), d - 0.5);
  }

  // Saving the position: every 5 s while playing, and on pause/hide.
  var lastSave = 0;
  function save(force) {
    var t = tracks[index];
    if (!t || !audio.currentTime) return;
    if (!force && Date.now() - lastSave < 5000) return;
    lastSave = Date.now();
    store('pos:' + t.guid, Math.floor(audio.currentTime));
  }

  toggle.addEventListener('click', function () { if (audio.paused) audio.play(); else audio.pause(); });
  document.querySelectorAll('[data-skip]').forEach(function (b) {
    b.addEventListener('click', function () { skip(Number(b.getAttribute('data-skip'))); });
  });
  speedBtn.addEventListener('click', function () { setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]); });
  items.forEach(function (b, i) { b.addEventListener('click', function () { save(true); load(i, true); }); });

  audio.addEventListener('play', function () { toggle.textContent = '일시정지'; toggle.setAttribute('aria-label', '일시정지'); audio.playbackRate = speed; });
  audio.addEventListener('pause', function () { toggle.textContent = '재생'; toggle.setAttribute('aria-label', '재생'); save(true); showPositions(); });
  audio.addEventListener('timeupdate', function () {
    save(false);
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && audio.duration) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: audio.currentTime, playbackRate: audio.playbackRate }); } catch (e) {}
    }
  });
  audio.addEventListener('ended', function () {
    var t = tracks[index];
    store('pos:' + t.guid, null);
    store('done:' + t.guid, 1);
    log('“' + t.title + '” 끝까지 재생됨');
    showPositions();
    if (index + 1 < tracks.length) { log('다음 에피소드 자동 재생'); load(index + 1, true); }
  });
  audio.addEventListener('error', function () { log('오디오 오류 (코드 ' + (audio.error && audio.error.code) + ')'); });
  audio.addEventListener('stalled', function () { log('네트워크 대기 중…'); });

  if ('mediaSession' in navigator) {
    var ms = navigator.mediaSession;
    var handlers = {
      play: function () { audio.play(); },
      pause: function () { audio.pause(); },
      seekbackward: function (d) { skip(-((d && d.seekOffset) || 15)); },
      seekforward: function (d) { skip((d && d.seekOffset) || 30); },
      seekto: function (d) { if (d && d.seekTime != null) audio.currentTime = d.seekTime; },
      previoustrack: function () { if (audio.currentTime > 5 || index === 0) audio.currentTime = 0; else { save(true); load(index - 1, true); } },
      nexttrack: function () { if (index + 1 < tracks.length) { save(true); load(index + 1, true); } },
    };
    Object.keys(handlers).forEach(function (k) { try { ms.setActionHandler(k, handlers[k]); } catch (e) {} });
  }

  // Test log: where playback was when the page was hidden, and where it is when it comes back.
  var hiddenAt = null;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      save(true);
      hiddenAt = { time: Date.now(), pos: audio.currentTime, playing: !audio.paused };
      log('화면 꺼짐 / 다른 앱 (' + (audio.paused ? '멈춤' : '재생 중') + ', ' + clock(audio.currentTime) + ')');
    } else if (hiddenAt) {
      var away = Math.round((Date.now() - hiddenAt.time) / 1000);
      var moved = audio.currentTime - hiddenAt.pos;
      var verdict = !hiddenAt.playing || away < 3 ? '' : moved > Math.min(away, 10) * 0.5 ? ' → 계속 재생됨 ✓' : ' → 재생이 멈췄어요 ✗';
      log('돌아옴: ' + clock(away) + ' 동안 떠나 있었고 ' + clock(Math.max(0, moved)) + ' 재생됨' + verdict + ' (' + clock(audio.currentTime) + ')');
      hiddenAt = null;
    }
  });
  window.addEventListener('pagehide', function () { save(true); });

  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  log('시작: ' + (standalone ? '홈 화면 앱' : '브라우저') + ' · Media Session ' + ('mediaSession' in navigator ? '있음' : '없음'));

  // Start where the student left off last time.
  var last = read('last');
  var start = 0;
  tracks.forEach(function (t, i) { if (t.guid === last) start = i; });
  setSpeed(speed);
  load(start, false);
  showPositions();
})();
