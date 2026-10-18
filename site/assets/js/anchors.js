/*
 * anchors.js: in-page links (href="#…", e.g. the "지금 신청하기" buttons → #price-section) on generated pages.
 * Scrolls smoothly to the target, leaving room for the sticky header (html scroll-padding-top), then checks the
 * position once scrolling ends and corrects it if the page moved meanwhile (images or the review masonry settling).
 * Respects prefers-reduced-motion (jumps instead of gliding). Without JS, the browser's own anchor jump still works.
 */
(function () {
  'use strict';
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pad() { return parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0; }
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var id = decodeURIComponent(a.getAttribute('href').slice(1));
    var t = id && document.getElementById(id);
    if (!t) return;
    e.preventDefault();
    function y() { return t.getBoundingClientRect().top + window.pageYOffset - pad(); }
    window.scrollTo({ top: y(), behavior: reduce ? 'auto' : 'smooth' });
    if (history.pushState) history.pushState(null, '', '#' + id);
    var done = false;
    function fix() {
      if (done) return; done = true;
      if (Math.abs(t.getBoundingClientRect().top - pad()) > 4) window.scrollTo({ top: y(), behavior: 'auto' });
    }
    if ('onscrollend' in window) window.addEventListener('scrollend', fix, { once: true });
    setTimeout(fix, 1200);   // browsers without scrollend, or no scroll needed
  });
})();
