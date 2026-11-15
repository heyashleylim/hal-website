/*
 * Email performance score: which emails did clearly better (or worse) than usual? Pure functions, unit-tested
 * (tests/emails/score.test.js). Nothing here is stored: the admin computes it on every read.
 *
 * Each email is compared with "similar sends": the 30 broadcast emails closest to it in time whose audience was
 * between half and double its size. That keeps the comparison fair when the list grows, when an email goes to a
 * small engaged segment, or when the sending platform changes.
 *
 *   opens  z = (open rate  − usual open rate)  / usual spread
 *   clicks z = (click rate − usual click rate) / usual spread      only for emails with something to click,
 *                                                                   compared with other emails that had a link
 *   score    = the average of the two (opens only when the email has no link)
 *
 * "Usual" is the median of the similar sends; "spread" is their median absolute deviation (×1.4826, so it reads
 * like a standard deviation), never smaller than what pure chance gives for this audience size. A score of +2
 * means "two spreads above usual": about 1 email in 20 gets there by luck.
 *
 * Not scored: automation emails, sends to fewer than 300 people (too noisy), and emails younger than 3 days
 * (opens and clicks are still coming in).
 *
 * legacy() is the formula from Alex's spreadsheet (column "Perf"), kept so both can be compared.
 */
const MIN_SENT = 300;      // smaller sends are not scored
const NEIGHBOURS = 30;     // how many similar sends make "usual"
const BAND = 2;            // similar audience: between 1/2 and 2× this email's
const MIN_BASELINE = 10;   // fewer similar sends than this → compare with all scored emails instead
const MIN_POOL = 5;        // fewer comparable emails than this → no score
const SETTLE_DAYS = 3;
const TOP = 2;             // score ≥ 2: outlier
const ABOVE = 1;           // score ≥ 1: above usual
const LOW = -2;            // score ≤ −2: clearly below usual

const DAY = 24 * 60 * 60 * 1000;

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

// Robust spread: median absolute deviation, scaled to read like a standard deviation.
function spread(values, centre) {
  return 1.4826 * median(values.map((x) => Math.abs(x - centre)));
}

// What chance alone does to a rate measured on n people.
const chance = (rate, n) => Math.sqrt(Math.max(rate * (1 - rate), 0) / n);

const hasLink = (e) => (e.has_link == null ? e.clicked > 0 : Boolean(e.has_link));

function level(score) {
  if (score >= TOP) return 'top';
  if (score >= ABOVE) return 'above';
  if (score <= LOW) return 'low';
  return 'typical';
}

// The spreadsheet's formula: 0.7 × click rate / median click rate + 0.3 × open rate / median open rate
// (open rate / median only, when nobody clicked), medians over every email sent to 300+ people.
function legacy(pool) {
  const out = new Map();
  if (!pool.length) return out;
  const open = median(pool.map((e) => e.openRate));
  const clickers = pool.filter((e) => e.clickRate > 0);
  const click = clickers.length ? median(clickers.map((e) => e.clickRate)) : null;
  for (const e of pool) {
    if (!open) continue;
    out.set(e.id, e.clickRate === 0 || !click ? e.openRate / open : 0.7 * e.clickRate / click + 0.3 * e.openRate / open);
  }
  return out;
}

/*
 * emails: [{ id, kind, sent_at, sent, opened, clicked, has_link }] → Map(id → result)
 *   result.state   'scored' | 'automation' | 'small' | 'recent' | 'alone' (too few emails to compare with)
 *   scored only:   score, level ('top' | 'above' | 'typical' | 'low'), compared (how many similar sends),
 *                  open  { rate, usual, z },  click { rate, usual, z } or null (no link), legacy
 */
function score(emails, now = new Date()) {
  const out = new Map();
  const pool = [];
  for (const e of emails) {
    const at = new Date(e.sent_at).getTime();
    if (e.kind === 'automation') out.set(e.id, { state: 'automation' });
    else if (!(e.sent >= MIN_SENT)) out.set(e.id, { state: 'small' });
    else if (now.getTime() - at < SETTLE_DAYS * DAY) out.set(e.id, { state: 'recent' });
    else pool.push({ id: e.id, at, sent: e.sent, openRate: e.opened / e.sent, clickRate: e.clicked / e.sent, link: hasLink(e) });
  }
  const old = legacy(pool);
  for (const e of pool) {
    const others = pool.filter((x) => x !== e);
    let similar = others.filter((x) => x.sent >= e.sent / BAND && x.sent <= e.sent * BAND);
    if (similar.length < MIN_BASELINE) similar = others;
    if (similar.length < MIN_POOL) { out.set(e.id, { state: 'alone' }); continue; }
    similar = similar.sort((a, b) => Math.abs(a.at - e.at) - Math.abs(b.at - e.at)).slice(0, NEIGHBOURS);

    const usualOpen = median(similar.map((x) => x.openRate));
    const openSpread = Math.max(spread(similar.map((x) => x.openRate), usualOpen), chance(usualOpen, e.sent));
    const open = { rate: e.openRate, usual: usualOpen, z: openSpread ? (e.openRate - usualOpen) / openSpread : 0 };

    let click = null;
    const linked = similar.filter((x) => x.link);
    if (e.link && linked.length >= MIN_POOL) {
      const usual = median(linked.map((x) => x.clickRate));
      const s = Math.max(spread(linked.map((x) => x.clickRate), usual), chance(usual, e.sent));
      click = { rate: e.clickRate, usual, z: s ? (e.clickRate - usual) / s : 0 };
    }
    const value = click ? (open.z + click.z) / 2 : open.z;
    out.set(e.id, { state: 'scored', score: value, level: level(value), compared: similar.length, open, click, legacy: old.has(e.id) ? old.get(e.id) : null });
  }
  return out;
}

module.exports = { score, legacy, median, spread, level, MIN_SENT, NEIGHBOURS, SETTLE_DAYS, TOP, ABOVE, LOW };
