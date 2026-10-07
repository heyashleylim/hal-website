/*
 * lv-carousel: the image carousel from ashleylim.com (Elementor "image-carousel", built on Swiper),
 * rebuilt without dependencies for the generated pages (tools/rebuild marks it up).
 *
 * Markup (generated):
 *   <div data-lv-carousel='{Elementor widget settings}'> … <div class="lv-viewport"><div class="lv-track">
 *     <div class="lv-slide">…</div> …
 * Settings used, with Elementor's defaults: slides_to_show (desktop, tablet 2, mobile 1), slides_to_scroll,
 * image_spacing_custom (gap), autoplay + autoplay_speed, speed, infinite (loop), pause_on_hover,
 * pause_on_interaction, navigation (arrows / dots / both).
 * Breakpoints match Swiper's on the live page: ≥1024px desktop, ≥767px tablet, below that mobile.
 * Without JS the first slides simply show in a row. Respects prefers-reduced-motion (no autoplay, no sliding).
 */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.4 4.6 8 12l7.4 7.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function num(v, d) { var n = parseInt(v, 10); return isNaN(n) ? d : n; }
  function size(o, d) { return o && o.size !== '' && o.size != null ? num(o.size, d) : d; }

  function init(root) {
    var s = {};
    try { s = JSON.parse(root.getAttribute('data-lv-carousel')) || {}; } catch (e) {}
    var vp = root.querySelector('.lv-viewport'), track = root.querySelector('.lv-track');
    if (!vp || !track) return;
    var real = Array.prototype.slice.call(track.children);
    var n = real.length;
    if (n < 2) return;

    var loop = s.infinite !== 'no';
    var nav = s.navigation || 'both';
    var speed = num(s.speed, 500), delay = num(s.autoplay_speed, 5000);
    var gapD = size(s.image_spacing_custom, 20);

    function cfg() {
      var w = window.innerWidth;
      if (w >= 1024) return { per: num(s.slides_to_show, 3), group: num(s.slides_to_scroll, 1), gap: gapD };
      if (w >= 767) return { per: num(s.slides_to_show_tablet, 2), group: num(s.slides_to_scroll_tablet, 1), gap: size(s.image_spacing_custom_tablet, gapD) };
      return { per: num(s.slides_to_show_mobile, 1), group: num(s.slides_to_scroll_mobile, 1), gap: size(s.image_spacing_custom_mobile, gapD) };
    }

    // Loop: a full set of clones on each side, so moving by a whole group never runs out of slides.
    if (loop) {
      real.forEach(function (sl) { var c = sl.cloneNode(true); c.setAttribute('aria-hidden', 'true'); c.classList.add('lv-clone'); track.appendChild(c); });
      real.slice().reverse().forEach(function (sl) { var c = sl.cloneNode(true); c.setAttribute('aria-hidden', 'true'); c.classList.add('lv-clone'); track.insertBefore(c, track.firstChild); });
    }
    var all = Array.prototype.slice.call(track.children);
    var offset = loop ? n : 0;
    var r = 0; // index of the first visible real slide
    var c = cfg(), step = 0;

    root.classList.add('lv-carousel', 'lv-ready');
    root.setAttribute('role', 'region');
    root.setAttribute('aria-roledescription', 'carousel');
    if (!root.hasAttribute('aria-label')) root.setAttribute('aria-label', '후기');
    vp.style.overflow = 'hidden';
    track.style.display = 'flex';
    track.style.willChange = 'transform';

    function layout() {
      c = cfg();
      var w = vp.clientWidth;
      var sw = (w - c.gap * (c.per - 1)) / c.per;
      step = sw + c.gap;
      all.forEach(function (sl) { sl.style.width = sw + 'px'; sl.style.flex = '0 0 ' + sw + 'px'; sl.style.marginRight = c.gap + 'px'; });
      place(false);
      buildDots();
      placeArrows();
    }
    function maxStart() { return Math.max(0, n - c.per); }
    function place(animate) {
      track.style.transition = animate && !reduce ? 'transform ' + speed + 'ms ease' : 'none';
      track.style.transform = 'translate3d(' + (-(offset + r) * step) + 'px,0,0)';
      updateDots();
      real.forEach(function (sl, k) {
        var vis = loop ? ((k - mod(r, n) + n) % n) < c.per : (k >= r && k < r + c.per);
        sl.setAttribute('aria-hidden', vis ? 'false' : 'true');
      });
    }
    function mod(a, b) { return ((a % b) + b) % b; }
    var settleTimer;
    function go(target) {
      if (loop) { r = target; }
      else { r = Math.max(0, Math.min(maxStart(), target)); }
      place(true);
      clearTimeout(settleTimer);
      if (loop) settleTimer = setTimeout(function () { var nr = mod(r, n); if (nr !== r) { r = nr; place(false); } }, reduce ? 0 : speed + 20);
    }
    function next() { if (!loop && r >= maxStart()) go(0); else go(r + c.group); }
    function prev() { if (!loop && r <= 0) go(maxStart()); else go(r - c.group); }

    // Arrows
    var bPrev, bNext;
    if (nav === 'both' || nav === 'arrows') {
      bPrev = document.createElement('button'); bPrev.type = 'button'; bPrev.className = 'lv-arrow lv-arrow--prev'; bPrev.setAttribute('aria-label', '이전 슬라이드'); bPrev.innerHTML = CHEVRON;
      bNext = document.createElement('button'); bNext.type = 'button'; bNext.className = 'lv-arrow lv-arrow--next'; bNext.setAttribute('aria-label', '다음 슬라이드'); bNext.innerHTML = CHEVRON;
      root.appendChild(bPrev); root.appendChild(bNext);
      bPrev.addEventListener('click', function () { interact(); prev(); });
      bNext.addEventListener('click', function () { interact(); next(); });
    }
    function placeArrows() {
      if (!bPrev) return;
      // Live: centred on the widget's content box (its inner wrapper's bottom padding holds the dots).
      var inner = root.firstElementChild, pb = inner ? parseFloat(getComputedStyle(inner).paddingBottom) || 0 : 0;
      var top = (root.offsetHeight - pb) / 2;
      bPrev.style.top = bNext.style.top = top + 'px';
    }

    // Dots: one per group ("page"), like Swiper's bullets.
    var dotsEl = null, dots = [];
    function pages() { return Math.ceil(n / c.group); }
    function buildDots() {
      if (!(nav === 'both' || nav === 'dots')) return;
      if (!dotsEl) { dotsEl = document.createElement('div'); dotsEl.className = 'lv-dots'; root.appendChild(dotsEl); }
      if (dots.length === pages()) { updateDots(); return; }
      dotsEl.innerHTML = ''; dots = [];
      for (var k = 0; k < pages(); k++) {
        var d = document.createElement('button');
        d.type = 'button'; d.className = 'lv-dot'; d.setAttribute('aria-label', (k + 1) + '번 슬라이드로 이동');
        (function (k) { d.addEventListener('click', function () { interact(); go(loop ? r - mod(r, n) + k * c.group : k * c.group); }); })(k);
        dotsEl.appendChild(d); dots.push(d);
      }
      updateDots();
    }
    function updateDots() {
      if (!dots.length) return;
      var a = Math.floor(mod(r, n) / c.group) % dots.length;
      dots.forEach(function (d, k) { d.classList.toggle('is-active', k === a); if (k === a) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    }

    // Autoplay: pauses on hover, stops for good once the visitor uses the controls (pause_on_interaction).
    var timer = null, hovering = false, stopped = reduce || s.autoplay !== 'yes';
    function tick() { if (!hovering && !document.hidden) next(); }
    function start() { if (!stopped && !timer) timer = setInterval(tick, delay + speed); }
    function stop() { clearInterval(timer); timer = null; }
    function interact() { if (s.pause_on_interaction === 'yes') { stopped = true; stop(); } }
    if (s.pause_on_hover === 'yes') {
      root.addEventListener('mouseenter', function () { hovering = true; });
      root.addEventListener('mouseleave', function () { hovering = false; });
    }
    root.addEventListener('focusin', function () { hovering = true; });
    root.addEventListener('focusout', function () { hovering = false; });

    // Swipe
    var x0 = null;
    vp.addEventListener('pointerdown', function (e) { x0 = e.clientX; });
    vp.addEventListener('pointerup', function (e) {
      if (x0 === null) return; var dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) { interact(); if (dx < 0) next(); else prev(); }
    });
    vp.addEventListener('pointercancel', function () { x0 = null; });

    var rz;
    window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(layout, 100); });
    layout();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeArrows);
    window.addEventListener('load', placeArrows);
    start();
  }

  function boot() { Array.prototype.forEach.call(document.querySelectorAll('[data-lv-carousel]'), init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
