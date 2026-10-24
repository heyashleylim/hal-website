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
 * data-lv-masonry-limit="5" (overrides.json "mobile_limit"): in one column (phones), only the first 5 cells show; the
 * next one fades out under a blur with a "더 보기" button that reveals the rest. Cells with data-lv-mobile-first go on
 * top of that single column (overrides.json masonry add: "mobile_first": true).
 */
(function () {
  'use strict';

  // Height / width of a cell: a cell can hold several images stacked (e.g. two messages that belong together).
  function ratio(cell) {
    var r = 0;
    Array.prototype.forEach.call(cell.querySelectorAll('img'), function (img, k) {
      var w = parseFloat(img.getAttribute('width')), h = parseFloat(img.getAttribute('height'));
      r += (w && h ? h / w : 1) + (k ? 0.02 : 0);   // + the small gap between stacked images
    });
    return r || 1;
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
    if (Math.pow(n, items.length) <= 2000000) {   // up to ~2M tries (e.g. 3 columns × 13 images); beyond that, quick deal + improvement
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
      // Then improve it: keep moving one image, or swapping two, between columns while that evens the columns out.
      bestScore = spread(colSums(best));
      for (var improved = true, rounds = 0; improved && rounds < 200; rounds++) {
        improved = false;
        for (var a = 0; a < items.length && !improved; a++) {
          for (var c = 0; c < n && !improved; c++) {   // move a to column c
            if (c === best[a]) continue;
            var keep = best[a]; best[a] = c;
            var sc1 = spread(colSums(best));
            if (sc1 < bestScore - 1e-9 && best.indexOf(keep) >= 0) { bestScore = sc1; improved = true; } else best[a] = keep;
          }
          for (var b = a + 1; b < items.length && !improved; b++) {   // swap a and b
            if (best[a] === best[b]) continue;
            var ta = best[a]; best[a] = best[b]; best[b] = ta;
            var sc2 = spread(colSums(best));
            if (sc2 < bestScore - 1e-9) { bestScore = sc2; improved = true; } else { best[b] = best[a]; best[a] = ta; }
          }
        }
      }
    }
    var cols = []; for (var k2 = 0; k2 < n; k2++) cols.push([]);
    if (!best) best = items.map(function (it, j) { return j % n; });   // safety net: never leave cells unplaced
    best.forEach(function (col, j) { cols[col].push(j); });
    return cols.filter(function (c) { return c.length; });
  }

  function init(box) {
    var cells = Array.prototype.filter.call(box.children, function (c) { return !c.classList.contains('lv-mcol'); });
    var items = cells.map(function (c, idx) { return { c: c, idx: idx, r: ratio(c), first: c.hasAttribute('data-lv-mobile-first') }; });
    var limit = parseInt(box.getAttribute('data-lv-masonry-limit'), 10) || 0, expanded = false, more = null;

    // One column (phones) with a limit: show the first cells, fade the next one under a blur, and a "더 보기" button.
    function collapse() {
      var colsNow = box.querySelectorAll(':scope > .lv-mcol');
      if (expanded || !limit || items.length <= limit || colsNow.length !== 1) {
        if (more) { more.parentNode.removeChild(more); more = null; }
        box.style.maxHeight = ''; box.style.overflow = '';
        return;
      }
      // Cut below the limit-th cell as shown (cell positions don't depend on the clipping, so the box is never
      // un-clipped while measuring: the page height stays steady, e.g. during a smooth scroll to an anchor).
      var cell = colsNow[0].children[limit - 1], top = box.getBoundingClientRect().top;
      var peek = 140;   // part of the next cell shows through the blur
      box.style.maxHeight = Math.round(cell.getBoundingClientRect().bottom - top + peek) + 'px';
      box.style.overflow = 'hidden';
      if (more) return;   // overlay already in place
      var bg = 'rgb(255, 255, 255)';
      for (var e = box; e; e = e.parentElement) {
        var c = getComputedStyle(e).backgroundColor;
        if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') { bg = c; break; }
      }
      more = document.createElement('div');
      more.className = 'lv-more';
      more.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:' + (peek + 60) + 'px;display:flex;align-items:flex-end;justify-content:center;' +
        'padding-bottom:16px;background:linear-gradient(to bottom,' + bg.replace('rgb(', 'rgba(').replace(')', ', 0)') + ' 0%,' + bg + ' 85%);z-index:2';
      var blur = document.createElement('div');
      blur.setAttribute('aria-hidden', 'true');
      blur.style.cssText = 'position:absolute;inset:0;-webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);' +
        '-webkit-mask-image:linear-gradient(to bottom,transparent,#000 60%);mask-image:linear-gradient(to bottom,transparent,#000 60%)';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lv-more__btn';
      btn.textContent = '더 보기';
      btn.setAttribute('aria-expanded', 'false');
      btn.style.cssText = 'position:relative;font:inherit;font-size:15px;font-weight:700;line-height:1.4;color:#fff;background:#DB4A2B;border:0;' +
        'border-radius:30px;padding:11px 28px;min-height:44px;cursor:pointer';
      btn.addEventListener('click', function () { expanded = true; collapse(); });
      more.appendChild(blur); more.appendChild(btn);
      box.appendChild(more);
    }

    function layout() {
      box.classList.remove('lv-masonry-ready');
      // Put the cells back in page order and drop the old columns.
      if (more) { more.parentNode.removeChild(more); more = null; }
      cells.forEach(function (c) { c.style.marginBottom = ''; c.style.marginTop = ''; box.appendChild(c); });
      Array.prototype.slice.call(box.querySelectorAll(':scope > .lv-mcol')).forEach(function (col) { box.removeChild(col); });
      var cs = getComputedStyle(box);
      var n = Math.max(1, Math.min(parseInt(cs.columnCount, 10) || 1, items.length));
      var gap = parseFloat(cs.columnGap) || 0;
      var inner = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      var avail = inner - gap * (n - 1);
      if (!(avail > 0)) { box.classList.remove('lv-masonry-ready'); return; }   // no width yet (hidden frame, prerender): keep the CSS columns, retry on resize
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
        list.sort(function (x, y) { return x - y; });
        if (cols.length === 1) {   // one column (phones): cells marked data-lv-mobile-first go on top
          list = list.filter(function (j) { return items[j].first; }).concat(list.filter(function (j) { return !items[j].first; }));
        }
        list.forEach(function (j, pos) {
          items[j].c.style.marginTop = '0';
          items[j].c.style.marginBottom = pos < list.length - 1 ? gap + 'px' : '0';
          col.appendChild(items[j].c);
        });
        box.appendChild(col);
      });
      box.classList.add('lv-masonry-ready');
      collapse();
    }

    var rz, lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () { if (window.innerWidth !== lastW) { lastW = window.innerWidth; layout(); } }, 120);
    });
    layout();
    // The cut-off depends on image heights: measure again once images and fonts have loaded.
    if (limit) {
      window.addEventListener('load', function () { if (!expanded) collapse(); });
      Array.prototype.forEach.call(box.querySelectorAll('img'), function (img) {
        if (!img.complete) img.addEventListener('load', function () { if (!expanded) collapse(); });
      });
    }
  }

  var css = document.createElement('style');
  css.textContent = '[data-lv-masonry].lv-masonry-ready{display:flex!important;align-items:flex-start;columns:auto!important;column-gap:0!important;row-gap:0!important}';
  document.head.appendChild(css);

  function boot() { Array.prototype.forEach.call(document.querySelectorAll('[data-lv-masonry]'), init); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
