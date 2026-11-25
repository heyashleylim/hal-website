/* Shared by the Students section pages (/admin/students): labels and small renderers.
   (The Learning section's students page uses students.js.) Persona names come from the API (the persona sheet),
   never from this public file. */
window.StudentRecords = (function () {
  var esc = Admin.esc;
  var KINDS = {
    sales_call_form: 'Sales call form',
    sales_call: 'Sales call (before buying)',
    onboarding: 'Onboarding questionnaire',
    testimonial: 'Written testimonial',
    video_testimonial: 'Video testimonial (transcript)',
    review: 'Review',
  };
  var SHORT = { sales_call_form: 'Form', sales_call: 'Call', onboarding: 'Onboarding', testimonial: 'Testimonial', video_testimonial: 'Video', review: 'Review' };
  var ROUNDS = { 'v2-2026-07': 'Spreadsheet analysis (Jul 2026)', 'reread-2026-11': 'Second read (Nov 2026)', 'third-read-2026-11': 'Third read (Nov 2026, another model)', 'la-read-2026-11': 'Review read (Nov 2026)' };
  var ROUND_ORDER = Object.keys(ROUNDS);
  // Rounds in the order they were made (unknown ones last, by name).
  function byRound(a, b) {
    var i = ROUND_ORDER.indexOf(a), j = ROUND_ORDER.indexOf(b);
    return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || (a < b ? -1 : a > b ? 1 : 0);
  }
  var PERMISSION = { unknown: 'Not asked', ask: 'Ask first', yes: 'May be used', no: 'Do not use' };
  var CONFIDENCE = { H: 'high', M: 'medium', L: 'low' };

  function round(r) { return ROUNDS[r] || r; }
  function roundShort(r) { return r === 'v2-2026-07' ? 'Sheet' : r === 'reread-2026-11' ? 'Re-read' : r === 'third-read-2026-11' ? '3rd read' : r === 'la-read-2026-11' ? 'Read' : r; }
  function persona(id, labels, long) {
    if (!id) return '<span class="muted">–</span>';
    var l = labels && labels[id];
    return '<span class="persona-tag" title="' + esc(l ? l.en : '') + '">' + esc(id) + '</span>' + (long && l ? ' <span>' + esc(l.en) + '</span>' : '');
  }
  function stars(n) {
    if (n == null) return '<span class="muted">–</span>';
    return '<span class="stars" aria-label="Strength ' + n + ' out of 5">' + '★★★★★'.slice(0, n) + '<span class="stars__off">' + '★★★★★'.slice(n) + '</span></span>';
  }
  function permission(p) {
    var cls = p === 'yes' ? 'badge--ok' : p === 'no' ? 'badge--warn' : p === 'ask' ? 'badge--info' : '';
    return '<span class="badge ' + cls + '">' + esc(PERMISSION[p] || p) + '</span>';
  }
  function name(s) {
    return '<span class="st-name">' + esc(s.name_en || s.name) + '</span>' + (s.name_en ? ' <span class="muted" lang="ko">' + esc(s.name) + '</span>' : '');
  }
  // English next to the Korean original (one under the other on a narrow screen).
  function bilingual(en, ko, opts) {
    opts = opts || {};
    var hasEn = Boolean(en && en.trim());
    return '<div class="bi' + (hasEn ? '' : ' bi--single') + '">' +
      (hasEn ? '<section class="bi__col" aria-label="English translation"><p class="bi__label">English <span class="muted">· translation</span></p><div class="reader__text">' + esc(en) + '</div></section>' : '') +
      '<section class="bi__col" aria-label="Korean original"><p class="bi__label">Korean <span class="muted">· original, word for word</span></p>' +
        '<div class="reader__text st-ko" lang="ko"' + (opts.textId ? ' data-text-id="' + opts.textId + '"' : '') + '>' + esc(ko) + '</div></section>' +
      '</div>' + (hasEn ? '' : '<p class="muted small" style="margin-top:8px">No English translation saved yet for this text.</p>');
  }
  // "Good for" categories of a snippet: chips, the free-text note, and a small editor (ticking saves at once;
  // the page listens for change events on input[data-cat]). cats = { key: label } from the API.
  function goodFor(sn, cats) {
    var chips = (sn.use_cats || []).map(function (c) { return '<span class="cat-chip">' + esc(cats[c] || c) + '</span>'; }).join('');
    return '<div class="snip__good"><span class="snip__good-label">Good for</span>' + (chips || '<span class="muted">no category yet</span>') +
      (sn.use_for ? '<span class="snip__good-note">' + esc(sn.use_for) + '</span>' : '') +
      '<details class="snip__cats"><summary data-tip="Choose what this snippet is good for (used by the “Good for” filter)">Edit</summary><fieldset><legend class="sr-only">Good for</legend>' +
      Object.keys(cats).map(function (c) {
        return '<label><input type="checkbox" data-cat="' + esc(c) + '"' + ((sn.use_cats || []).indexOf(c) >= 0 ? ' checked' : '') + '> ' + esc(cats[c]) + '</label>';
      }).join('') + '</fieldset></details></div>';
  }
  // The categories ticked in a snippet card's editor.
  function catsIn(card) {
    return Array.prototype.map.call(card.querySelectorAll('input[data-cat]:checked'), function (i) { return i.dataset.cat; });
  }
  // "Life Artist", from the API's program list ({ key: { name } } or an array of them).
  function programName(key, programs) {
    var p = programs && (programs[key] || (Array.isArray(programs) ? programs.filter(function (x) { return x.key === key; })[0] : null));
    return p ? p.name : key === 'nsmb' ? 'NSMB' : key;
  }
  // Where a text comes from: "Written testimonial", or "Review · Q2 · The moment she felt she was changing".
  function textLabel(kind, questionKey, program, questions) {
    if (kind !== 'review') return KINDS[kind] || kind;
    var q = questions && questions[program + ':' + questionKey];
    return 'Review · ' + (q ? 'Q' + q.n + ' · ' + q.short : questionKey);
  }
  return { programName: programName, textLabel: textLabel, goodFor: goodFor, catsIn: catsIn, KINDS: KINDS, SHORT: SHORT, ROUNDS: ROUNDS, PERMISSION: PERMISSION, CONFIDENCE: CONFIDENCE, round: round, roundShort: roundShort, byRound: byRound,
    persona: persona, stars: stars, permission: permission, name: name, bilingual: bilingual };
})();
