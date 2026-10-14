/*
 * sale.js: timed sale on generated pages (tools/rebuild, "sale" in overrides.json).
 * Markup: a countdown <div data-sale="countdown" data-sale-deadline="2026-10-16T23:59:59+09:00" hidden> with
 * <b data-u="d|h|m|s">, elements to drop at the deadline (data-sale="hide") and the price that changes
 * (data-sale="price" data-sale-after="₩220,000").
 * Before the deadline: shows the countdown and ticks every second. At (or after) the deadline: removes the countdown
 * and the sale elements and shows the regular price, without reloading. tools/rebuild/sale_end.py then makes the
 * same change in the HTML itself (scheduled GitHub Action), for visitors without JS and for search engines.
 * Preview a time with ?sale-now=2026-10-17T00:00:00%2B09:00.
 */
(function () {
  'use strict';
  var cd = document.querySelector('[data-sale="countdown"]');
  if (!cd) return;
  var end = Date.parse(cd.getAttribute('data-sale-deadline'));
  if (isNaN(end)) return;
  var q = /[?&]sale-now=([^&]+)/.exec(location.search);
  var offset = q ? Date.parse(decodeURIComponent(q[1])) - Date.now() : 0;   // test hook only
  function now() { return Date.now() + offset; }

  function finish() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-sale="hide"],[data-sale="countdown"]'), function (e) { e.parentNode.removeChild(e); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-sale="price"]'), function (e) {
      e.textContent = e.getAttribute('data-sale-after'); e.removeAttribute('data-sale');
    });
  }
  if (now() >= end) { finish(); return; }

  var el = {};
  ['d', 'h', 'm', 's'].forEach(function (u) { el[u] = cd.querySelector('[data-u="' + u + '"]'); });
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  var timer;
  function tick() {
    var left = Math.max(0, Math.floor((end - now()) / 1000));
    if (left <= 0) { clearInterval(timer); finish(); return; }
    el.d.textContent = Math.floor(left / 86400);
    el.h.textContent = pad(Math.floor(left % 86400 / 3600));
    el.m.textContent = pad(Math.floor(left % 3600 / 60));
    el.s.textContent = pad(left % 60);
  }
  tick();
  cd.hidden = false;
  timer = setInterval(tick, 1000);
})();
