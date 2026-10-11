/*
 * lv-masonry: balances an image masonry on the generated pages (tools/rebuild, "masonry" in overrides.json).
 *
 * Markup (generated): <div data-lv-masonry> with one cell per image. The page CSS shows it as CSS columns
 * (column count per breakpoint), which is also the layout without JS. CSS columns keep page order, so one tall
 * image can leave a column much shorter than the others. This script reads the column count from that CSS and
 * deals the cells into flex columns, tallest image first into the shortest column (heights from each image's
 * width/height attributes), keeping page order inside each column; the tallest image's column is shown last. It runs again when the column count changes.
 */
(function () {
  'use strict';

  function ratio(cell) {
    var img = cell.querySelector('img');
    var w = img && parseFloat(img.getAttribute('width')), h = img && parseFloat(img.getAttribute('height'));
    return w && h ? h / w : 1;
  }

  function init(box) {
    var cells = Array.prototype.filter.call(box.children, function (c) { return !c.classList.contains('lv-mcol'); });
    var current = 0, currentGap = -1;

    function layout() {
      box.classList.remove('lv-masonry-ready');
      // Put the cells back in page order and drop the old columns.
      cells.forEach(function (c) { c.style.marginBottom = ''; box.appendChild(c); });
      Array.prototype.slice.call(box.querySelectorAll(':scope > .lv-mcol')).forEach(function (col) { box.removeChild(col); });
      var cs = getComputedStyle(box);
      var n = parseInt(cs.columnCount, 10) || 1;
      var gap = parseFloat(cs.columnGap) || 0;
      current = n; currentGap = gap;
      // Same column widths, so a cell's height is proportional to its image ratio (plus the gap under it).
      var sum = [], cols = [];
      for (var k = 0; k < n; k++) { sum.push(0); cols.push([]); }
      cells.map(function (c, idx) { return { c: c, idx: idx, r: ratio(c) }; })
        .sort(function (a, b) { return b.r - a.r || a.idx - b.idx; })
        .forEach(function (it) {
          var k = sum.indexOf(Math.min.apply(null, sum));
          sum[k] += it.r; cols[k].push(it);
        });
      // The first column (the tallest image's) goes last, as Ashley asked: 1-2-3 becomes 2-3-1.
      cols.push(cols.shift());
      // Spacing with margins, not flex gap: some phone browsers (older iOS WebViews) ignore gap in flexbox.
      cols.forEach(function (list, ci) {
        var col = document.createElement('div');
        col.className = 'lv-mcol';
        col.style.cssText = 'flex:1 1 0;min-width:0;display:block;margin-left:' + (ci ? gap : 0) + 'px';
        list.sort(function (a, b) { return a.idx - b.idx; }).forEach(function (it, j) {
          it.c.style.marginBottom = j < list.length - 1 ? gap + 'px' : '0';
          col.appendChild(it.c);
        });
        box.appendChild(col);
      });
      box.classList.add('lv-masonry-ready');
    }

    var rz;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () {
        // Only re-deal when the breakpoint changes the column count or the gap.
        box.classList.remove('lv-masonry-ready');
        var cs = getComputedStyle(box), n = parseInt(cs.columnCount, 10) || 1, g = parseFloat(cs.columnGap) || 0;
        box.classList.add('lv-masonry-ready');
        if (n !== current || g !== currentGap) layout();
      }, 100);
    });
    layout();
  }

  var css = document.createElement('style');
  css.textContent = '[data-lv-masonry].lv-masonry-ready{display:flex!important;align-items:flex-start;columns:auto!important;column-gap:0!important;row-gap:0!important}';
  document.head.appendChild(css);

  function boot() { Array.prototype.forEach.call(document.querySelectorAll('[data-lv-masonry]'), init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
