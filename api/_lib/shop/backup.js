/*
 * Monthly copy of the tax ledger in the private Blob store (docs/commerce-plan.md 3.7 "Backups", section 15).
 * One CSV per Seoul month, `shop-ledger/YYYY-MM.csv` (previews: `preview/shop-ledger/…`, so a preview never touches
 * production's files). The daily job writes every finished month that has no file yet; "Back up now" in Reports
 * rewrites them all (e.g. after exchange rates were typed). Neon's point-in-time restore stays the main backup;
 * these files are a copy anyone can open in Excel, outside the database.
 */
const ledger = require('./ledger.js');

const pad = (n) => String(n).padStart(2, '0');

function root(env = process.env) {
  return env.VERCEL_ENV === 'preview' ? 'preview/shop-ledger' : 'shop-ledger';
}

// The finished Seoul months from the first ledger line's month up to (not including) the current month.
function months(firstAt, now = new Date()) {
  if (!firstAt) return [];
  const a = ledger.seoul(firstAt), b = ledger.seoul(now);
  const out = [];
  let y = a.year, m = a.month;
  while (y < b.year || (y === b.year && m < b.month)) {
    out.push(`${y}-${pad(m)}`);
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const pathOf = (month, env) => `${root(env)}/${month}.csv`;

/*
 * Writes the monthly files. replace = false: only months without a file (the daily job); true: every month.
 * Off Vercel (the local server, the tests) there is no store: nothing is written.
 * → { written: ['2026-10', …], kept, skipped? }
 */
async function run({ replace = false, budgetMs = 30000 } = {}) {
  if (!process.env.VERCEL_ENV) return { written: [], kept: 0, skipped: 'not on Vercel: no Blob store here' };
  const blob = require('@vercel/blob');
  const db = require('../db.js');
  const reports = require('./reports.js');
  const { CSV, linesOf } = require('../admin/shop-reports.js');
  const first = await db.one('SELECT min(at) AS at FROM shop_ledger');
  const wanted = months(first && first.at);
  const existing = new Set();
  if (!replace) {
    let cursor;
    do {
      const page = await blob.list({ prefix: `${root()}/`, cursor, limit: 1000 });
      page.blobs.forEach((b) => existing.add(b.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  const started = Date.now();
  const written = [];
  let kept = 0;
  for (const month of wanted) {
    if (existing.has(pathOf(month))) { kept += 1; continue; }
    if (Date.now() - started > budgetMs) break;
    const lines = await linesOf(reports.period(month));
    await blob.put(pathOf(month), reports.csv(CSV.lines, lines), {
      access: 'private', contentType: 'text/csv; charset=utf-8', addRandomSuffix: false, allowOverwrite: true,
    });
    written.push(month);
  }
  return { written, kept, left: wanted.length - kept - written.length };
}

// The monthly files, newest first, each with a download link valid one hour.
async function list() {
  if (!process.env.VERCEL_ENV) return { files: [], skipped: 'not on Vercel: no Blob store here' };
  const blob = require('@vercel/blob');
  const files = [];
  let cursor;
  do {
    const page = await blob.list({ prefix: `${root()}/`, cursor, limit: 1000 });
    files.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  const validUntil = Date.now() + 60 * 60 * 1000;
  const out = [];
  for (const f of files.sort((x, y) => y.pathname.localeCompare(x.pathname))) {
    const token = await blob.issueSignedToken({ pathname: f.pathname, operations: ['get'], validUntil });
    const { presignedUrl } = await blob.presignUrl(token, { operation: 'get', pathname: f.pathname, access: 'private', validUntil });
    out.push({ month: f.pathname.split('/').pop().replace(/\.csv$/, ''), size: f.size, uploaded_at: f.uploadedAt, url: presignedUrl });
  }
  return { files: out };
}

module.exports = { root, months, pathOf, run, list };
