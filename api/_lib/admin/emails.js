/*
 * Emails admin API (/admin/emails): the archive of every email sent, with its performance and score.
 *   emails-overview   counts, last sync, the emails worth sending again
 *   emails-list       search and filters (the score is computed here, on every read: ../emails/score.js)
 *   emails-get        one email with its text
 *   emails-update     "send again?" mark and/or note, for one email or several at once
 *   emails-import     rows read from the spreadsheet by the browser (site/assets/js/admin/xlsx.js), 100 at a time
 *   emails-sync       sync history;  emails-sync-run  copies ActiveCampaign's emails and stats now
 *   emails-translate-run   saves the English translation of the emails that don't have one yet (../emails/translate.js)
 */
const crypto = require('node:crypto');
const db = require('../db.js');
const scoring = require('../emails/score.js');
const acSync = require('../emails/ac-sync.js');
const translate = require('../emails/translate.js');
const { userError, text, int, date } = require('./util.js');

const RESEND = ['', 'yes', 'maybe', 'no', 'done'];
const SORTS = ['newest', 'oldest', 'score', 'open', 'click', 'sent'];
const LEVELS = ['top', 'good', 'low', 'unscored']; // good = top + above

const LIGHT = `id, source, kind, name, subject, subject_en, sent_at, last_sent_at, sent, opened, clicked, unsubscribed, bounced, has_link, resend,
  note, (source = 'ac' AND body_synced_at IS NULL) AS body_pending`;

const rate = (part, whole) => (whole > 0 ? part / whole : null);
const round = (n, digits = 4) => (n == null ? null : Number(n.toFixed(digits)));

// What the pages get for a score: rounded, and nothing but the state when there is no score.
function publicScore(s) {
  if (!s || s.state !== 'scored') return { state: s ? s.state : 'small' };
  const part = (p) => (p ? { usual: round(p.usual), z: round(p.z, 2) } : null);
  return { state: 'scored', score: round(s.score, 2), level: s.level, compared: s.compared, open: part(s.open), click: part(s.click), legacy: round(s.legacy, 2) };
}

function present(e, scores) {
  return { ...e, open_rate: round(rate(e.opened, e.sent)), click_rate: round(rate(e.clicked, e.sent)), score: publicScore(scores.get(e.id)) };
}

// Every email (without its text) and the score of each.
async function loadAll(q = '') {
  const rows = await db.query(
    `SELECT ${LIGHT}, ($1 = '' OR position(lower($1) in lower(name || ' ' || subject || ' ' || subject_en || ' ' || body_text || ' ' || body_en || ' ' || note)) > 0) AS matches
       FROM emails ORDER BY sent_at DESC, id DESC`, [q]);
  return { rows, scores: scoring.score(rows) };
}

// "2026-08-21T08:00" as typed in the spreadsheet (Seoul time) → an instant.
function seoulInstant(value, label) {
  const s = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) || Number.isNaN(Date.parse(s + ':00+09:00'))) throw userError(`${label}: the date is not readable`);
  return new Date(s + ':00+09:00').toISOString();
}

// One spreadsheet row → the columns to store. Throws a message naming the row when something is wrong.
function importRow(r, label) {
  const sentAt = seoulInstant(r.sent_at, label);
  const name = text(r.name, { max: 300, required: true, label: `${label}: campaign name` });
  const count = (v, what) => int(v == null || v === '' ? 0 : Math.round(Number(v)), { min: 0, max: 100000000, label: `${label}: ${what}` });
  const sent = count(r.sent, 'Sent');
  const row = {
    source_ref: crypto.createHash('sha1').update(`${r.sent_at}|${name}`).digest('hex').slice(0, 20),
    name,
    subject: text(r.subject, { max: 1000, label: `${label}: subject` }),
    body_text: String(r.body == null ? '' : r.body).replace(/\r\n?/g, '\n').trim(),
    sent_at: sentAt,
    sent,
    opened: count(r.opened, 'Opened'),
    clicked: count(r.clicked, 'Clicked'),
    unsubscribed: count(r.unsubscribed, 'Unsubscribed'),
  };
  if (row.body_text.length > 200000) throw userError(`${label}: the body is too long`);
  if (row.opened > sent || row.clicked > sent) throw userError(`${label}: more opens or clicks than emails sent`);
  return row;
}

const actions = {
  async 'emails-overview'() {
    const [{ rows, scores }, tr, lastRun, lastOk] = await Promise.all([
      loadAll(),
      translate.counts(),
      db.one(`SELECT started_at, finished_at, trigger, ok, summary, error FROM email_sync_runs ORDER BY id DESC LIMIT 1`),
      db.one(`SELECT finished_at FROM email_sync_runs WHERE ok ORDER BY id DESC LIMIT 1`),
    ]);
    const all = rows.map((e) => present(e, scores));
    const scored = all.filter((e) => e.score.state === 'scored');
    const candidates = scored
      .filter((e) => e.score.score >= scoring.ABOVE && e.resend !== 'no' && e.resend !== 'done')
      .sort((a, b) => b.score.score - a.score.score).slice(0, 12);
    return {
      overview: {
        total: all.length,
        imported: all.filter((e) => e.source === 'import').length,
        ac: all.filter((e) => e.source === 'ac').length,
        automation: all.filter((e) => e.kind === 'automation').length,
        first: all.length ? all[all.length - 1].sent_at : null,
        last: all.length ? all[0].sent_at : null,
        scored: scored.length,
        top: scored.filter((e) => e.score.level === 'top').length,
        above: scored.filter((e) => e.score.level === 'above').length,
        marked: all.filter((e) => e.resend === 'yes' || e.resend === 'maybe').length,
        untranslated: tr.pending + tr.failed,
        resent: all.filter((e) => e.resend === 'done').length,
        body_pending: all.filter((e) => e.body_pending).length,
        ac_connected: acSync.configured(),
        last_run: lastRun,
        last_ok_at: lastOk ? lastOk.finished_at : null,
      },
      candidates,
      rules: { min_sent: scoring.MIN_SENT, neighbours: scoring.NEIGHBOURS, settle_days: scoring.SETTLE_DAYS, top: scoring.TOP, above: scoring.ABOVE },
    };
  },

  async 'emails-list'(input) {
    const q = text(input.q, { max: 100 });
    const source = text(input.source, { max: 10 });
    const kind = text(input.kind, { max: 12 });
    const level = text(input.level, { max: 10 });
    const resend = text(input.resend, { max: 10 });
    const sort = text(input.sort, { max: 10 }) || 'newest';
    if (source && !['import', 'ac'].includes(source)) throw userError('unknown source');
    if (kind && !['campaign', 'automation'].includes(kind)) throw userError('unknown type');
    if (level && !LEVELS.includes(level)) throw userError('unknown performance filter');
    if (resend && ![...RESEND, 'marked', 'none'].includes(resend)) throw userError('unknown "send again" filter');
    if (!SORTS.includes(sort)) throw userError('unknown sort');
    const from = input.from ? new Date(date(input.from, { label: 'from' }) + 'T00:00:00+09:00').getTime() : null;
    const to = input.to ? new Date(date(input.to, { label: 'to' }) + 'T00:00:00+09:00').getTime() + 24 * 60 * 60 * 1000 : null;

    const { rows, scores } = await loadAll(q);
    const list = rows.filter((e) => {
      const at = new Date(e.sent_at).getTime();
      const s = scores.get(e.id);
      const lv = s && s.state === 'scored' ? s.level : null;
      return e.matches
        && (!source || e.source === source)
        && (!kind || e.kind === kind)
        && (from == null || at >= from) && (to == null || at < to)
        && (!level || (level === 'top' ? lv === 'top' : level === 'good' ? lv === 'top' || lv === 'above' : level === 'low' ? lv === 'low' : lv == null))
        && (!resend || (resend === 'marked' ? e.resend === 'yes' || e.resend === 'maybe' : resend === 'none' ? e.resend === '' : e.resend === resend));
    }).map((e) => { const { matches, ...rest } = e; return present(rest, scores); });

    const by = {
      oldest: (a, b) => new Date(a.sent_at) - new Date(b.sent_at),
      score: (a, b) => (b.score.score ?? -Infinity) - (a.score.score ?? -Infinity),
      open: (a, b) => (b.open_rate ?? -1) - (a.open_rate ?? -1),
      click: (a, b) => (b.click_rate ?? -1) - (a.click_rate ?? -1),
      sent: (a, b) => b.sent - a.sent,
    }[sort];
    if (by) list.sort(by);
    return { emails: list, total: rows.length };
  },

  async 'emails-get'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const email = await db.one(
      `SELECT ${LIGHT}, preheader, body_text, body_en, translated_at, (body_html IS NOT NULL AND body_html <> '') AS has_html, stats_at FROM emails WHERE id = $1`, [id]);
    if (!email) throw userError('email not found', 404);
    const { scores } = await loadAll();
    return { email: present(email, scores) };
  },

  // The designed (HTML) version of an ActiveCampaign email, shown by the reader inside a locked-down frame.
  async 'emails-html'(input) {
    const id = int(input.id, { min: 1, max: 2147483647, label: 'id' });
    const row = await db.one(`SELECT body_html FROM emails WHERE id = $1`, [id]);
    if (!row) throw userError('email not found', 404);
    return { html: row.body_html || '' };
  },

  // Sets the "send again?" mark and/or the note of one email (id) or of several at once (ids).
  // Only what is sent is changed: a bulk change of the mark leaves each email's note alone, and the other way round.
  async 'emails-update'(input) {
    const list = Array.isArray(input.ids) ? input.ids : [input.id];
    if (!list.length || list.length > 2000) throw userError('choose between 1 and 2,000 emails');
    const ids = [...new Set(list.map((v) => int(v, { min: 1, max: 2147483647, label: 'id' })))];
    const hasResend = input.resend !== undefined && input.resend !== null;
    const hasNote = input.note !== undefined && input.note !== null;
    if (!hasResend && !hasNote) throw userError('nothing to change');
    const resend = hasResend ? String(input.resend) : null;
    if (hasResend && !RESEND.includes(resend)) throw userError('unknown "send again" value');
    const note = hasNote ? text(input.note, { max: 2000, label: 'note' }) : null;
    const rows = await db.query(
      `UPDATE emails SET resend = COALESCE($2, resend), note = COALESCE($3, note), updated_at = now() WHERE id = ANY($1::int[]) RETURNING id, name, resend, note`,
      [ids, resend, note]);
    if (!rows.length) throw userError('email not found', 404);
    const log = { emails: rows.length };
    if (hasResend) log.resend = resend;
    if (hasNote) log.note = note ? 'set' : 'cleared';
    return { emails: rows, email: rows[0], target: rows.length === 1 ? rows[0].name : `${rows.length} emails`, log };
  },

  // Adds the spreadsheet's emails, or refreshes them when imported again (same send time and campaign name).
  // The sheet's Resend column is not read: "send again" only holds choices made in the admin, and an import never touches them.
  async 'emails-import'(input) {
    const rows = Array.isArray(input.rows) ? input.rows : null;
    if (!rows || !rows.length) throw userError('no rows to import');
    if (rows.length > 100) throw userError('too many rows at once (100 at most)');
    const errors = [];
    const good = new Map();
    for (const r of rows) {
      const label = `Row ${int(r && r.row, { min: 1, max: 1000000, label: 'row number' })}`;
      try {
        const row = importRow(r, label);
        if (good.has(row.source_ref)) errors.push(`${label}: same date and campaign name as an earlier row (skipped)`);
        else good.set(row.source_ref, row);
      } catch (err) {
        if (!err.expose) throw err;
        errors.push(err.message);
      }
    }
    let added = 0;
    if (good.size) {
      const res = await db.query(
        `INSERT INTO emails (source, source_ref, kind, name, subject, body_text, sent_at, sent, opened, clicked, unsubscribed, stats_at)
         SELECT 'import', r.source_ref, 'campaign', r.name, r.subject, r.body_text, r.sent_at, r.sent, r.opened, r.clicked, r.unsubscribed, now()
           FROM jsonb_to_recordset($1::jsonb) AS r(source_ref text, name text, subject text, body_text text, sent_at timestamptz, sent int, opened int, clicked int, unsubscribed int)
         ON CONFLICT (source, source_ref) DO UPDATE SET
           subject = EXCLUDED.subject, body_text = EXCLUDED.body_text, sent = EXCLUDED.sent, opened = EXCLUDED.opened,
           clicked = EXCLUDED.clicked, unsubscribed = EXCLUDED.unsubscribed, stats_at = now(), updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [JSON.stringify([...good.values()])]);
      added = res.filter((x) => x.inserted).length;
    }
    const summary = { rows: rows.length, added, updated: good.size - added, skipped: errors.length };
    return { ...summary, errors, target: 'spreadsheet import', log: summary }; // never the emails themselves in the activity log
  },

  async 'emails-sync'(input, ctx) {
    const [translation, runs, counts] = await Promise.all([
      translate.counts(),
      db.query(`SELECT started_at, finished_at, trigger, ok, summary, error FROM email_sync_runs ORDER BY id DESC LIMIT 15`),
      db.one(`SELECT count(*) FILTER (WHERE source = 'ac')::int AS ac, count(*) FILTER (WHERE source = 'import')::int AS imported,
                     count(*) FILTER (WHERE source = 'ac' AND body_synced_at IS NULL AND ac_message_id IS NOT NULL)::int AS body_pending,
                     max(stats_at) FILTER (WHERE source = 'ac') AS stats_at FROM emails`),
    ]);
    const token = ctx && ctx.req ? ctx.req.headers['x-vercel-oidc-token'] : '';
    const failures = translation.failed ? await db.query(
      `SELECT name, translate_error FROM emails WHERE translate_tries >= $1 ORDER BY sent_at DESC LIMIT 5`, [translate.MAX_TRIES]) : [];
    return { connected: acSync.configured(), runs, counts, translation: { ...translation, ready: translate.configured(token), failures } };
  },

  async 'emails-sync-run'() {
    const result = await acSync.sync({ trigger: 'admin', budgetMs: 45000 });
    if (result.skipped) throw userError(result.error, 409);
    return { result, target: 'ActiveCampaign emails', log: result };
  },

  // Translates the emails still waiting for their English version, for up to 40 seconds: the page calls it again
  // while some are left. Emails that failed five times get another chance.
  async 'emails-translate-run'(input, ctx) {
    const token = ctx && ctx.req ? ctx.req.headers['x-vercel-oidc-token'] : '';
    const result = await translate.run({ budgetMs: 40000, token, retry: Boolean(input.retry) });
    if (result.skipped) throw userError(result.error, 409);
    return { result, target: 'English translations', log: result.translated || result.error ? result : null };
  },
};

module.exports = { section: 'emails', actions, writes: ['emails-update', 'emails-import', 'emails-sync-run', 'emails-translate-run'], importRow, publicScore };
