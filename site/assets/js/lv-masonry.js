/*
 * lv-masonry: lays out an image masonry on the generated pages (tools/rebuild, "masonry" in overrides.json).
 *
 * Markup (generated): <div data-lv-masonry> with one cell per image. The page CSS shows it as CSS columns
 * (column count and gap per breakpoint), which is also the layout without JS.
 * With JS: the cells are dealt into flex columns so the columns come out as even as possible (every way of
 * dealing them is tried when there are few images, else tallest first into the shortest column), page order kept
 * inside each column. Then the column widths are nudged so all columns end at the same height: no empty space at
 * the bottom and no cropping (heights come from each image's width/height attributes). The column holding the
 * tallest image is shown last, as Ashley asked. Spacing uses margins, not flex gap. Re-runs on resize.
 */
(function () {
  'use strict';

  function ratio(cell) {
    var img = cell.querySelector('img');
    var w = img && parseFloat(img.getAttribute('width')), h = img && parseFloat(img.getAttribute('height'));
    return w && h ? h / w : 1;
  }

  // Columns: list of arrays of item indexes. Score = spread of the column "heights" at equal widths.
  function spread(sums) { return Math.max.apply(null, sums) - Math.min.apply(null, sums); }

  function deal(items, n, gapRel) {
    var best = null, bestScore = Infinity;
    function colSums(assign) {
      var s = [], c = [];
      for (var k = 0; k < n; k++) { s.push(0); c.push(0); }
      assign.forEach(function (col, j) { s[col] += items[j].r; c[col]++; });
      return s.map(function (v, k) { return v + Math.max(0, c[k] - 1) * gapRel; });
    }
    if (Math.pow(n, items.length) <= 20000) {
      // Try every assignment (each column non-empty) and keep the most even one.
      var assign = items.map(function () { return 0; });
      for (var t = 0, total = Math.pow(n, items.length); t < total; t++) {
        var x = t, used = [];
        for (var j = 0; j < items.length; j++) { assign[j] = x % n; x = Math.floor(x / n); used[assign[j]] = true; }
        if (used.filter(Boolean).length < Math.min(n, items.length)) continue;
        var sc = spread(colSums(assign));
        if (sc < bestScore - 1e-9) { bestScore = sc; best = assign.slice(); }
      }
    } else {
      var sums = []; for (var k = 0; k < n; k++) sums.push(0);
      best = items.map(function () { return 0; });
      items.map(function (it, j) { return j; }).sort(function (a, b) { return items[b].r - items[a].r || a - b; })
        .forEach(function (j) { var k = sums.indexOf(Math.min.apply(null, sums)); best[j] = k; sums[k] += items[j].r + gapRel; });
    }
    var cols = []; for (var k2 = 0; k2 < n; k2++) cols.push([]);
    best.forEach(function (col, j) { cols[col].push(j); });
    return cols.filter(function (c) { return c.length; });
  }

  function init(box) {
    var cells = Array.prototype.filter.call(box.children, function (c) { return !c.classList.contains('lv-mcol'); });
    var items = cells.map(function (c, idx) { return { c: c, idx: idx, r: ratio(c) }; });

    function layout() {
      box.classList.remove('lv-masonry-ready');
      // Put the cells back in page order and drop the old columns.
      cells.forEach(function (c) { c.style.marginBottom = ''; box.appendChild(c); });
      Array.prototype.slice.call(box.querySelectorAll(':scope > .lv-mcol')).forEach(function (col) { box.removeChild(col); });
      var cs = getComputedStyle(box);
      var n = Math.max(1, Math.min(parseInt(cs.columnCount, 10) || 1, items.length));
      var gap = parseFloat(cs.columnGap) || 0;
      var inner = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      var avail = inner - gap * (n - 1);
      var cols = deal(items, n, gap / (avail / n));
      // Column with the tallest image last.
      var tallest = items.reduce(function (a, b) { return b.r > a.r ? b : a; }).idx;
      cols.sort(function (a, b) { return (a.indexOf(tallest) >= 0) - (b.indexOf(tallest) >= 0) || a[0] - b[0]; });
      // Widths so every column ends at the same height H: w_k * R_k + G_k = H, sum w_k = avail.
      var R = cols.map(function (c) { return c.reduce(function (s, j) { return s + items[j].r; }, 0); });
      var G = cols.map(function (c) { return (c.length - 1) * gap; });
      var a = 0, b = 0;
      R.forEach(function (r, k) { a += 1 / r; b += G[k] / r; });
      var H = (avail + b) / a;
      var widths = R.map(function (r, k) { return (H - G[k]) / r; });
      // Keep it subtle: if a column would get much narrower or wider than the others, fall back to equal widths.
      var even = avail / cols.length;
      if (widths.some(function (w) { return w < even * 0.7 || w > even * 1.3; })) widths = cols.map(function () { return even; });
      cols.forEach(function (list, ci) {
        var col = document.createElement('div');
        col.className = 'lv-mcol';
        col.style.cssText = 'flex:0 0 ' + (widths[ci] / inner * 100) + '%;min-width:0;display:block;margin-left:' + (ci ? gap : 0) + 'px';
        list.sort(function (x, y) { return x - y; }).forEach(function (j, pos) {
          items[j].c.style.marginBottom = pos < list.length - 1 ? gap + 'px' : '0';
          col.appendChild(items[j].c);
        });
        box.appendChild(col);
      });
      box.classList.add('lv-masonry-ready');
    }

    var rz, lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () { if (window.innerWidth !== lastW) { lastW = window.innerWidth; layout(); } }, 120);
    });
    layout();
  }

  var css = document.createElement('style');
  css.textContent = '[data-lv-masonry].lv-masonry-ready{display:flex!important;align-items:flex-start;columns:auto!important;column-gap:0!important;row-gap:0!important}';
  document.head.appendChild(css);

  function boot() { Array.prototype.forEach.call(document.querySelectorAll('[data-lv-masonry]'), init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
