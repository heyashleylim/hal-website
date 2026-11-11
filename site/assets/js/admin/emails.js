/* Shared by the Emails pages (/admin/emails): how rates, scores and "send again" marks are shown. */
window.AdminEmails = (function () {
  var esc = Admin.esc;
  var RESEND = { '': '–', yes: 'Yes', maybe: 'Maybe', no: 'No', done: 'Sent again' };
  var RESEND_TONE = { yes: 'badge--ok', maybe: 'badge--info', done: 'badge--info', no: '' };
  var LEVEL = { top: ['Outlier', 'badge--ok'], above: ['Above usual', 'badge--info'], typical: ['Usual', ''], low: ['Low', 'badge--warn'] };
  var WHY = {
    small: 'Not scored: sent to fewer than 300 people, too few to compare fairly.',
    recent: 'Not scored yet: sent less than 3 days ago, opens and clicks are still coming in.',
    automation: 'Not scored: this email is sent one person at a time by an ActiveCampaign automation.',
    alone: 'Not scored: there are not enough other emails to compare it with yet.',
  };

  // "9 Nov 2026" in Seoul time (the lists; the reader shows the weekday and the time).
  function day(value) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
  }
  function pct(rate, digits) {
    return rate == null ? '–' : (rate * 100).toFixed(digits == null ? 1 : digits) + '%';
  }
  function signed(n) {
    return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1);
  }
  // The score as a badge ("Outlier +2.7"), or a dash with the reason when there is none.
  function score(s) {
    if (!s || s.state !== 'scored') return '<span class="muted" title="' + esc(WHY[s && s.state] || '') + '">–</span>';
    var l = LEVEL[s.level];
    return '<span class="score"><span class="badge ' + l[1] + '">' + l[0] + '</span><span class="num">' + signed(s.score) + '</span></span>';
  }
  // A rate with what is usual for similar sends underneath.
  function versus(rate, part) {
    return pct(rate) + (part ? '<span class="vs">usual ' + pct(part.usual) + '</span>' : '');
  }
  function resend(value) {
    return value ? '<span class="badge ' + (RESEND_TONE[value] || '') + '">' + RESEND[value] + '</span>' : '<span class="muted">–</span>';
  }
  function source(e) {
    return (e.source === 'ac' ? 'ActiveCampaign' : 'Spreadsheet') + (e.kind === 'automation' ? ' · automation' : '');
  }
  // The sentence explaining a score in the reader.
  function why(e) {
    var s = e.score;
    if (s.state !== 'scored') return esc(WHY[s.state] || '');
    var parts = ['Opens <strong>' + pct(e.open_rate) + '</strong> vs ' + pct(s.open.usual) + ' usual (' + signed(s.open.z) + ')'];
    parts.push(s.click ? 'clicks <strong>' + pct(e.click_rate) + '</strong> vs ' + pct(s.click.usual) + ' usual (' + signed(s.click.z) + ')' : 'no link to click, so opens only');
    return score(s) + ' &nbsp;' + parts.join(' · ') + '. Compared with the ' + s.compared + ' closest sends to a similar audience.' +
      (s.legacy != null ? ' <span class="muted">Spreadsheet formula (Perf): ' + s.legacy.toFixed(2) + '</span>' : '');
  }
  return { RESEND: RESEND, day: day, pct: pct, signed: signed, score: score, versus: versus, resend: resend, source: source, why: why };
})();
