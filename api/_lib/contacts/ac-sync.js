/*
 * Copies ActiveCampaign's contacts into the `contacts` table. READ-ONLY on the AC side: nothing here creates, changes
 * or deletes anything in ActiveCampaign. A contact deleted in AC stays here, marked gone_from_ac_at.
 *
 * Each run (daily job at 09:40 KST, or "Sync now" / "Keep syncing" in /admin/contacts/sync) does, within its time budget:
 *   1. recent changes: contacts created or updated in AC since the last run (GET /contacts?filters[updated_after]=…);
 *   2. the full sweep: every contact, 100 per page (GET /contacts?orders[cdate]=ASC&offset=…), carried on from where the
 *      previous run stopped. When a sweep ends, contacts it didn't see are checked one by one (GET /contacts/<id>):
 *      only a 404 marks them gone. A new sweep starts a week after the last one finished;
 *   3. details: tags, lists and custom fields of contacts that are new, changed, flagged by the "tag added" webhook
 *      (api/podcast-ac.js), or not refreshed for 30 days (GET /contacts/<id>, ~4 per second).
 * Whatever is left is picked up by the next run. Never throws: returns a summary and records it in contact_sync_runs.
 */
const db = require('../db.js');
const ac = require('../ac.js');

const PAGE = 100;
const SWEEP_EVERY_DAYS = 7;
const REFRESH_DAYS = 30;
const PAUSE_MS = 250; // between detail calls: AC allows 5 requests per second for the whole account

// Stand-in for tests and the local dev server; production uses ac.request.
let client = null;
let pause = (ms) => new Promise((r) => setTimeout(r, ms));
const request = (path) => (client || ac.request)(path);
function setClient(fn, { noPause = false } = {}) { client = fn; if (noPause) pause = async () => {}; }

function configured() {
  return Boolean(client) || Boolean((process.env.AC_API_URL || '').trim() && (process.env.AC_API_KEY || '').trim());
}

function instant(v) {
  if (!v || /^0000/.test(String(v))) return null;
  const d = new Date(String(v).replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// An AC contact (list or detail) → the columns kept from it.
function contactRow(c) {
  return {
    ac_id: String(c.id),
    email: String(c.email || '').trim().toLowerCase(),
    first_name: String(c.firstName || '').trim(),
    last_name: String(c.lastName || '').trim(),
    phone: String(c.phone || '').trim(),
    ac_created_at: instant(c.cdate || c.created_timestamp),
    ac_updated_at: instant(c.udate || c.updated_timestamp),
  };
}

const COLUMNS = 'ac_id text, email text, first_name text, last_name text, phone text, ac_created_at timestamptz, ac_updated_at timestamptz';

// Adds new contacts and refreshes known ones; a contact AC changed gets its details read again.
async function saveContacts(rows) {
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await db.query(
      `INSERT INTO contacts (ac_id, email, first_name, last_name, phone, ac_created_at, ac_updated_at, seen_at)
       SELECT r.ac_id, r.email, r.first_name, r.last_name, r.phone, r.ac_created_at, r.ac_updated_at, clock_timestamp()
         FROM jsonb_to_recordset($1::jsonb) AS r(${COLUMNS})
       ON CONFLICT (ac_id) DO UPDATE SET
         email = EXCLUDED.email, first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, phone = EXCLUDED.phone,
         ac_created_at = EXCLUDED.ac_created_at,
         details_wanted = contacts.details_wanted OR contacts.ac_updated_at IS DISTINCT FROM EXCLUDED.ac_updated_at,
         ac_updated_at = EXCLUDED.ac_updated_at, seen_at = clock_timestamp(), gone_from_ac_at = NULL,
         updated_at = CASE WHEN (contacts.email, contacts.first_name, contacts.last_name, contacts.phone, contacts.gone_from_ac_at IS NULL)
                              IS DISTINCT FROM (EXCLUDED.email, EXCLUDED.first_name, EXCLUDED.last_name, EXCLUDED.phone, true)
                           THEN now() ELSE contacts.updated_at END
       RETURNING (xmax = 0) AS inserted`,
      [JSON.stringify(rows.slice(i, i + 200))]);
    added += res.filter((r) => r.inserted).length;
  }
  return added;
}

async function getState() {
  const row = await db.one(`SELECT state FROM contact_sync_state WHERE id = 1`);
  return (row && row.state) || {};
}
async function setState(state) {
  await db.query(`INSERT INTO contact_sync_state (id, state) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state`, [JSON.stringify(state)]);
}

const slowDown = (err) => (err.status === 429 ? 'ActiveCampaign asked to slow down' : String(err.message || err).slice(0, 200));

// 1. Contacts changed since the last run (a day of overlap: AC filters by date).
async function recent(state, deadline) {
  const since = state.updated_after ? new Date(new Date(state.updated_after).getTime() - 86400000).toISOString().slice(0, 10) : null;
  if (!since) return { seen: 0, added: 0, skipped: 'first run: the full sweep reads everyone' };
  const startedAt = new Date().toISOString();
  let seen = 0, added = 0;
  for (let offset = 0; offset < 1000000; offset += PAGE) {
    if (Date.now() > deadline) return { seen, added, stopped: 'time' };
    const body = await request(`/contacts?status=-1&limit=${PAGE}&offset=${offset}&filters[updated_after]=${since}&orders[udate]=ASC`);
    const page = body.contacts || [];
    added += await saveContacts(page.map(contactRow));
    seen += page.length;
    if (page.length < PAGE) break;
  }
  state.updated_after = startedAt;
  return { seen, added };
}

// 2. The full sweep, resumed where the last run stopped.
async function sweep(state, deadline) {
  const now = Date.now();
  if (!state.sweep_started_at) {
    const last = state.sweep_finished_at ? new Date(state.sweep_finished_at).getTime() : 0;
    if (last && now - last < SWEEP_EVERY_DAYS * 86400000) return { done: false, idle: true };
    // the database's clock, the one seen_at is written with (contacts not seen since then are checked at the end)
    state.sweep_started_at = new Date((await db.one(`SELECT clock_timestamp() AS t`)).t).toISOString();
    state.sweep_offset = 0;
  }
  let seen = 0, added = 0;
  while (Date.now() < deadline) {
    const body = await request(`/contacts?status=-1&limit=${PAGE}&offset=${state.sweep_offset}&orders[cdate]=ASC`);
    const page = body.contacts || [];
    added += await saveContacts(page.map(contactRow));
    seen += page.length;
    state.sweep_offset += page.length;
    if (body.meta && body.meta.total != null) state.sweep_total = Number(body.meta.total);
    if (page.length < PAGE) {
      // finished: whoever wasn't seen in this sweep is checked one by one
      const gone = await checkUnseen(state.sweep_started_at, deadline);
      if (gone.left) return { seen, added, done: false, checking: gone };
      state.sweep_finished_at = new Date().toISOString();
      if (!state.updated_after) state.updated_after = state.sweep_started_at;
      delete state.sweep_started_at;
      delete state.sweep_offset;
      return { seen, added, done: true, gone: gone.gone };
    }
  }
  return { seen, added, done: false, offset: state.sweep_offset, total: state.sweep_total || null };
}

// Contacts not seen since `since`: still in AC (seen again) or gone (404).
async function checkUnseen(since, deadline) {
  const todo = await db.query(`SELECT id, ac_id FROM contacts WHERE gone_from_ac_at IS NULL AND (seen_at IS NULL OR seen_at < $1) ORDER BY id`, [since]);
  let gone = 0, checked = 0;
  for (const c of todo) {
    if (Date.now() > deadline) break;
    try {
      const body = await request('/contacts/' + encodeURIComponent(c.ac_id));
      if (body.contact) await saveContacts([contactRow(body.contact)]);
    } catch (err) {
      if (err.status !== 404) throw err;
      await db.query(`UPDATE contacts SET gone_from_ac_at = now(), updated_at = now() WHERE id = $1`, [c.id]);
      gone++;
    }
    checked++;
    await pause(PAUSE_MS);
  }
  return { gone, checked, left: todo.length - checked };
}

// Names of AC's tags, lists and custom fields by id, read once per run.
async function catalog() {
  const all = async (path, key) => {
    const out = [];
    for (let offset = 0; offset < 100000; offset += PAGE) {
      const body = await request(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE}&offset=${offset}`);
      const page = body[key] || [];
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  };
  const [tags, lists, fields] = await Promise.all([all('/tags', 'tags'), all('/lists', 'lists'), all('/fields', 'fields')]);
  return {
    tag: new Map(tags.map((t) => [String(t.id), String(t.tag || '')])),
    list: new Map(lists.map((l) => [String(l.id), String(l.name || '')])),
    field: new Map(fields.map((f) => [String(f.id), String(f.title || f.perstag || '')])),
  };
}

const LIST_STATUS = { 0: 'unconfirmed', 1: 'subscribed', 2: 'unsubscribed', 3: 'bounced' };

// A contact's details (GET /contacts/<id>) → { tags, lists, fields } with names instead of ids.
async function details(acId, names) {
  const body = await request('/contacts/' + encodeURIComponent(acId));
  let links = body.contactTags;
  if (!Array.isArray(links)) links = (await request(`/contacts/${encodeURIComponent(acId)}/contactTags`)).contactTags || [];
  const tags = [...new Set(links.map((ct) => names.tag.get(String(ct.tag))).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const lists = (body.contactLists || []).map((cl) => ({ name: names.list.get(String(cl.list)) || `List ${cl.list}`, status: LIST_STATUS[cl.status] || String(cl.status) }));
  const fields = {};
  for (const fv of body.fieldValues || []) {
    const title = names.field.get(String(fv.field));
    if (title && fv.value != null && String(fv.value).trim() !== '') fields[title] = String(fv.value);
  }
  return { contact: body.contact || null, tags, lists, fields };
}

// 3. Tags, lists and fields of the contacts that need them, most recently changed first.
async function readDetails(deadline) {
  const todo = await db.query(
    `SELECT id, ac_id FROM contacts
      WHERE gone_from_ac_at IS NULL AND (details_wanted OR details_at < now() - make_interval(days => $1))
      ORDER BY details_wanted DESC, details_at NULLS FIRST, ac_updated_at DESC NULLS LAST LIMIT 5000`, [REFRESH_DAYS]);
  if (!todo.length) return { done: 0, left: 0 };
  const names = await catalog();
  let done = 0, stopped = null;
  for (const c of todo) {
    if (Date.now() > deadline) { stopped = 'time'; break; }
    try {
      const d = await details(c.ac_id, names);
      if (d.contact) await saveContacts([contactRow(d.contact)]);
      await db.query(
        `UPDATE contacts SET tags = $2, lists = $3, fields = $4, details_at = now(), details_wanted = false,
                updated_at = CASE WHEN (tags, lists, fields) IS DISTINCT FROM ($2::text[], $3::jsonb, $4::jsonb) THEN now() ELSE updated_at END
          WHERE id = $1`,
        [c.id, d.tags, JSON.stringify(d.lists), JSON.stringify(d.fields)]);
    } catch (err) {
      if (err.status === 404) {
        await db.query(`UPDATE contacts SET gone_from_ac_at = now(), details_wanted = false, updated_at = now() WHERE id = $1`, [c.id]);
      } else { stopped = slowDown(err); break; }
    }
    done++;
    await pause(PAUSE_MS);
  }
  const left = await db.one(
    `SELECT count(*)::int AS n FROM contacts WHERE gone_from_ac_at IS NULL AND (details_wanted OR details_at IS NULL OR details_at < now() - make_interval(days => $1))`, [REFRESH_DAYS]);
  return { done, left: left.n, stopped };
}

/*
 * One sync run. Returns { ok, recent, sweep, details, more } — more: there is work left that "Keep syncing" can continue.
 */
async function sync({ trigger = 'admin', budgetMs = 40000 } = {}) {
  if (!configured()) return { ok: false, skipped: true, error: 'ActiveCampaign is not connected here (AC_API_URL / AC_API_KEY)' };
  const deadline = Date.now() + budgetMs;
  const run = await db.one(`INSERT INTO contact_sync_runs (trigger) VALUES ($1) RETURNING id`, [trigger]);
  const state = await getState();
  let summary;
  try {
    const r = await recent(state, deadline);
    await setState(state);
    const s = await sweep(state, deadline - budgetMs * 0.25); // leave a quarter of the time for details
    await setState(state);
    const d = await readDetails(deadline);
    summary = { ok: true, recent: r, sweep: s, details: d, more: Boolean((!s.done && !s.idle) || d.left) };
    if (d.stopped && d.stopped !== 'time') summary.note = `stopped reading details: ${d.stopped}`;
  } catch (err) {
    console.error('contacts ac-sync', err);
    await setState(state).catch(() => {});
    summary = { ok: false, error: slowDown(err) };
  }
  await db.query(`UPDATE contact_sync_runs SET finished_at = now(), ok = $2, summary = $3, error = $4 WHERE id = $1`,
    [run.id, summary.ok, JSON.stringify(summary), summary.ok ? null : summary.error]);
  return summary;
}

// The "tag added" webhook (api/podcast-ac.js) fires for every tag: the contact's tags are read again at the next sync.
async function flag(acId) {
  if (!acId) return;
  await db.query(`UPDATE contacts SET details_wanted = true WHERE ac_id = $1`, [String(acId)]);
}

module.exports = { sync, configured, setClient, contactRow, details, flag, getState };
