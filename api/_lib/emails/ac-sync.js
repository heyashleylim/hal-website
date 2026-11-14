/*
 * Copies ActiveCampaign's emails and their performance into the `emails` table (read-only on the AC side).
 *
 * Every run (daily job, or "Sync now" in /admin/emails/sync):
 *   1. lists every campaign (GET /campaigns, 100 per page): the list already carries the numbers (sent, people who
 *      opened, people who clicked, unsubscribes, bounces), so stats for ALL emails are refreshed each time;
 *   2. for emails whose subject and body haven't been read yet, fetches the message (GET /messages/<id>), newest
 *      first, until the time budget runs out. What's left is picked up by the next run.
 * Drafts and scheduled campaigns are skipped until they have been sent. Emails deleted in AC stay here.
 */
const db = require('../db.js');
const ac = require('../ac.js');

const PAGE = 100;
const MAX_PAGES = 200;

// Stand-in for tests and the local dev server (tools/shop/dev-server.js); production uses ac.request.
let client = null;
const request = (path) => (client || ac.request)(path);
function setClient(fn) { client = fn; }

function configured() {
  return Boolean(client) || Boolean((process.env.AC_API_URL || '').trim() && (process.env.AC_API_KEY || '').trim());
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

function instant(v) {
  if (!v || /^0000/.test(String(v))) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Emails that go out one contact at a time (automation steps, autoresponders, date-based, RSS) rather than as one broadcast.
const ONGOING = new Set(['responder', 'reminder', 'recurring', 'activerss', 'special', 'automation']);

// An AC campaign → the columns we keep, or null while it hasn't been sent.
function campaignRow(c) {
  const sentAt = instant(c.sdate);
  const sent = num(c.send_amt);
  if (!c || !c.id || !sentAt || !sent) return null;
  const automation = (c.automation && String(c.automation) !== '0') || (c.seriesid && String(c.seriesid) !== '0') || ONGOING.has(String(c.type));
  return {
    source_ref: String(c.id),
    kind: automation ? 'automation' : 'campaign',
    name: String(c.name || '').trim() || `Campaign ${c.id}`,
    ac_message_id: c.message_id && String(c.message_id) !== '0' ? String(c.message_id) : null,
    sent_at: sentAt,
    last_sent_at: instant(c.ldate),
    sent,
    opened: Math.min(num(c.uniqueopens), sent),
    // people who clicked; older accounts only report unique link clicks
    clicked: Math.min(c.subscriberclicks != null ? num(c.subscriberclicks) : num(c.uniquelinkclicks), sent),
    unsubscribed: num(c.unsubscribes),
    bounced: num(c.hardbounces) + num(c.softbounces),
  };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return Object.hasOwn(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}

// The readable text of an HTML email: paragraphs and line breaks kept, tags, styles and hidden preheaders dropped.
function htmlToText(html) {
  const text = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decode(text).replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Does the email offer something to click, other than unsubscribing or managing the subscription?
function linkIn(html, text) {
  const hrefs = [...String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)/gi)].map((m) => m[1]);
  const urls = hrefs.length ? hrefs : String(text || '').match(/https?:\/\/[^\s<>"')]+|%[A-Z_]*LINK[A-Z_]*%/g) || [];
  return urls.some((u) => /^(https?:|%)/i.test(u) && !/unsub|%UPDATELINK%|%FORWARD|%WEBCOPY%|%SENDER-INFO|mailto:/i.test(u));
}

function messageRow(m) {
  const html = String(m.html || '');
  const plain = String(m.text || '').trim();
  return {
    subject: String(m.subject || '').trim(),
    preheader: String(m.preheader_text || '').trim(),
    body_html: html || null,
    body_text: html.trim() ? htmlToText(html) : plain,
    has_link: linkIn(html, plain),
  };
}

async function listCampaigns() {
  const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const body = await request(`/campaigns?limit=${PAGE}&offset=${page * PAGE}&orders[sdate]=DESC`);
    const list = body.campaigns || [];
    out.push(...list);
    if (list.length < PAGE) break;
  }
  return out;
}

const COLUMNS = 'source_ref text, kind text, name text, ac_message_id text, sent_at timestamptz, last_sent_at timestamptz, sent int, opened int, clicked int, unsubscribed int, bounced int';

// Adds new emails and refreshes the numbers of known ones. A changed message means the body is read again.
async function saveCampaigns(rows) {
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await db.query(
      `INSERT INTO emails (source, source_ref, kind, name, ac_message_id, sent_at, last_sent_at, sent, opened, clicked, unsubscribed, bounced, stats_at)
       SELECT 'ac', r.source_ref, r.kind, r.name, r.ac_message_id, r.sent_at, r.last_sent_at, r.sent, r.opened, r.clicked, r.unsubscribed, r.bounced, now()
         FROM jsonb_to_recordset($1::jsonb) AS r(${COLUMNS})
       ON CONFLICT (source, source_ref) DO UPDATE SET
         kind = EXCLUDED.kind, name = EXCLUDED.name, sent_at = EXCLUDED.sent_at, last_sent_at = EXCLUDED.last_sent_at,
         sent = EXCLUDED.sent, opened = EXCLUDED.opened, clicked = EXCLUDED.clicked, unsubscribed = EXCLUDED.unsubscribed,
         bounced = EXCLUDED.bounced, stats_at = now(), updated_at = now(),
         body_synced_at = CASE WHEN emails.ac_message_id IS DISTINCT FROM EXCLUDED.ac_message_id THEN NULL ELSE emails.body_synced_at END,
         ac_message_id = EXCLUDED.ac_message_id
       RETURNING (xmax = 0) AS inserted`,
      [JSON.stringify(rows.slice(i, i + 200))],
    );
    added += res.filter((r) => r.inserted).length;
  }
  return added;
}

// Subject and body of the emails that don't have them yet, newest first, within the time budget.
async function fetchBodies(deadline) {
  const todo = await db.query(
    `SELECT id, ac_message_id FROM emails WHERE source = 'ac' AND body_synced_at IS NULL AND ac_message_id IS NOT NULL ORDER BY sent_at DESC`);
  let done = 0;
  let stopped = null;
  for (const e of todo) {
    if (Date.now() > deadline) { stopped = 'time'; break; }
    let row;
    try {
      row = messageRow((await request('/messages/' + encodeURIComponent(e.ac_message_id))).message || {});
    } catch (err) {
      if (err.status !== 404) { stopped = err.status === 429 ? 'ActiveCampaign asked to slow down' : err.message; break; }
      row = { subject: '', preheader: '', body_html: null, body_text: '', has_link: null }; // the message was deleted in AC
    }
    await db.query(
      `UPDATE emails SET subject = $2, preheader = $3, body_html = $4, body_text = $5, has_link = $6, body_synced_at = now(), updated_at = now() WHERE id = $1`,
      [e.id, row.subject, row.preheader, row.body_html, row.body_text, row.has_link]);
    done++;
  }
  return { done, left: todo.length - done, stopped };
}

/*
 * One sync. Returns { ok, campaigns, emails, added, bodies, bodies_left, note } (or { ok: false, error }) and
 * records it in email_sync_runs. Never throws.
 */
async function sync({ trigger = 'admin', budgetMs = 45000 } = {}) {
  if (!configured()) return { ok: false, skipped: true, error: 'ActiveCampaign is not connected here (AC_API_URL / AC_API_KEY)' };
  const deadline = Date.now() + budgetMs;
  const run = await db.one(`INSERT INTO email_sync_runs (trigger) VALUES ($1) RETURNING id`, [trigger]);
  let summary;
  try {
    const campaigns = await listCampaigns();
    const rows = campaigns.map(campaignRow).filter(Boolean);
    const added = await saveCampaigns(rows);
    const bodies = await fetchBodies(deadline);
    summary = { ok: true, campaigns: campaigns.length, emails: rows.length, added, bodies: bodies.done, bodies_left: bodies.left };
    if (bodies.left) summary.note = bodies.stopped === 'time' ? 'ran out of time: the next sync reads the remaining emails' : `stopped reading emails: ${bodies.stopped}`;
  } catch (err) {
    console.error('emails ac-sync', err);
    summary = { ok: false, error: String(err.message || err).slice(0, 300) };
  }
  await db.query(`UPDATE email_sync_runs SET finished_at = now(), ok = $2, summary = $3, error = $4 WHERE id = $1`,
    [run.id, summary.ok, JSON.stringify(summary), summary.ok ? null : summary.error]);
  return summary;
}

module.exports = { sync, configured, setClient, campaignRow, messageRow, htmlToText, linkIn };
