/*
 * HTML of "내 주문" (/my), rendered on the server: reads and works without JavaScript. Same layout as the student
 * area (api/_lib/learn/pages.js: site header and footer, no GTM or analytics). Every string is in copy.ko.js (`my`).
 * Pure: unit-tested in tests/shop/my.test.js.
 */
const { layout } = require('../learn/pages.js');
const pricing = require('./pricing.js');
const copy = require('./copy.ko.js');

const c = copy.my;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const kst = (date, opts) => new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', ...opts }).format(new Date(date));
// A moment (timestamp) → "2026년 11월 20일"; a Seoul date 'YYYY-MM-DD' → the same, without time-zone shifts.
const day = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (m) return `${+m[1]}년 ${+m[2]}월 ${+m[3]}일`;
  return value ? kst(value, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
};

function facts(rows) {
  return `<ul class="pod__status">${rows.filter((r) => r && r[1] !== '' && r[1] != null).map(([k, v]) => `<li><span>${k}</span><strong>${v}</strong></li>`).join('')}</ul>`;
}

// The card at the top when an instalment was missed: one button per instalment, to its payment link.
function missedCard(missed) {
  if (!missed.length) return '';
  const rows = missed.map((m) => {
    const money = pricing.formatMoney(m.amount, m.currency);
    return `<li class="my__missed-item">
    <p><strong>${esc(m.name)}</strong> · ${esc(copy.payLink.turnOf(m.number, m.count))}<br><span class="my__muted">${esc(c.missedLine(day(m.due), money))}</span></p>
    <form method="post" action="/my/pay">
      <input type="hidden" name="order" value="${m.order}">
      <input type="hidden" name="i" value="${m.number}">
      <button class="btn btn--block" type="submit">${esc(c.payNow(money))}</button>
    </form>
  </li>`;
  }).join('');
  return `<section class="pod__card my__missed" aria-labelledby="missed-title">
  <h2 class="pod__h2" id="missed-title">${c.missedTitle}</h2>
  <p>${c.missedLead}</p>
  <ul class="my__missed-list">${rows}</ul>
</section>`;
}

function table(caption, head, rows) {
  return `<div class="my__scroll"><table class="my__table">
    <caption>${caption}</caption>
    <thead><tr>${head.map((h, i) => `<th scope="col"${i === head.length - 1 || h.num ? ' class="num"' : ''}>${h.label || h}</th>`).join('')}</tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table></div>`;
}

function orderCard(o) {
  const money = (n) => pricing.formatMoney(n, o.currency);
  const status = c.status[o.status] || '';
  const title = esc(o.name) + (o.option ? ` · ${esc(o.option)}` : '');
  const method = o.plan === 'instalment' && o.schedule ? c.plan(o.schedule.length) : c.full;
  let html = `<section class="pod__card my__order" aria-labelledby="o-${o.number}">
  <div class="my__order-head">
    <h2 class="pod__h2" id="o-${o.number}">${title}</h2>
    ${status ? `<span class="my__badge my__badge--${esc(o.status)}">${status}</span>` : ''}
  </div>
  ${facts([
    [c.order, esc(o.number)],
    [c.placed, esc(day(o.placed))],
    [c.method, method],
    o.discount ? [c.discount, `-${money(o.discount)}${o.coupon ? ` (${esc(o.coupon)})` : ''}`] : null,
    [c.total, money(o.total)],
    o.plan === 'instalment' ? [c.paid, money(o.paid)] : null,
    o.refunded ? [c.refunded, `-${money(o.refunded)}`] : null,
  ])}`;
  if (o.items.length) {
    html += `<h3 class="pod__h3">${c.items}</h3>${facts(o.items.map((i) => [esc(i.name), money(i.amount)]))}`;
  }
  if (o.planInfo && o.schedule) {
    const p = o.planInfo;
    html += `<h3 class="pod__h3">${c.schedule}${c.planStatus[p.status] ? ` <span class="my__muted">· ${c.planStatus[p.status]}</span>` : ''}</h3>`;
    if (p.next) html += `<p class="my__next"><span>${c.next}</span> <strong>${esc(c.nextLine(day(p.next.due), money(p.next.amount)))}</strong></p>`;
    if (p.next && p.card) html += `<p class="pod__note">${esc(c.card(p.card))}</p>`;
    html += table(c.schedule, [c.turn, c.due, { label: c.amount, num: true }, c.state], o.schedule.map((r) => `<tr${r.payable ? ' class="my__row--missed"' : ''}>
      <td>${r.number}</td><td>${esc(day(r.due))}</td><td class="num">${money(r.amount)}</td><td class="num">${c.rowStatus[r.status] || esc(r.status)}</td></tr>`));
    if (p.left && ['active', 'overdue', 'paused'].includes(p.status)) html += facts([[c.left, money(p.left)]]);
  }
  const lines = o.payments.map((p) => ({ at: p.at, html: `<tr><td>${esc(day(p.at))}</td><td>${p.number && o.schedule ? esc(copy.payLink.turnOf(p.number, o.schedule.length)) : c.status.paid}</td><td class="num">${money(p.amount)}</td><td class="num">${p.receipt ? `<a href="${esc(p.receipt)}" target="_blank" rel="noopener noreferrer">${c.receipt}<span class="sr-only"> (${esc(day(p.at))})</span></a>` : ''}</td></tr>` }))
    .concat(o.refunds.map((r) => ({ at: r.at, html: `<tr><td>${esc(day(r.at))}</td><td>${c.refund}</td><td class="num">-${money(r.amount)}</td><td></td></tr>` })))
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  if (lines.length) {
    html += `<h3 class="pod__h3">${c.payments}</h3>` + table(c.payments, [c.when, '', { label: c.amount, num: true }, { label: `<span class="sr-only">${c.receipt}</span>`, num: true }], lines.map((l) => l.html));
  }
  return html + '\n</section>';
}

// The account card at the bottom: help, the student area, sign out.
function account() {
  return `<section class="pod__card pod__card--quiet learn__account">
  <p>${esc(c.help)}</p>
  <p><a href="/learn">${c.toLearn}</a> · <a href="/learn/help">이용 안내</a></p>
  <form method="post" action="/learn/logout"><button class="learn__link" type="submit">로그아웃</button></form>
</section>`;
}

// /my → the whole page. data: { student (signed in), orders: [my.view], missed: [my.missed], problem? }
function myPage({ student, orders, missed, problem = '' }) {
  const note = problem === 'pay' ? `<p class="learn__msg learn__msg--error" role="alert">${esc(c.payGone)}</p>` : '';
  return layout({
    title: `${c.title} · 애슐리 림`,
    body: `<section class="pod__card pod__card--intro">
  <h1 class="pod__title">${c.title}</h1>
  <p class="pod__lead">${esc(c.lead(student && student.name))}</p>
  ${note}
  ${orders.length ? '' : `<p>${c.empty}</p><p class="pod__note">${c.emptyHint}</p>`}
</section>
${missedCard(missed)}
${orders.map(orderCard).join('\n')}
${account()}`,
  }).replace('<link rel="stylesheet" href="/assets/css/pages/learn.css">', '<link rel="stylesheet" href="/assets/css/pages/learn.css">\n<link rel="stylesheet" href="/assets/css/pages/my.css">');
}

module.exports = { myPage, day };
