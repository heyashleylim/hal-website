/*
 * POST /api/podcast-ac?key=<webhook key>[&action=revoke&tag=<cohort AC tag>] — ActiveCampaign automation webhooks.
 * The full addresses are on the admin's Automation page (the key is derived from PODCAST_SECRET).
 *
 * action=enroll (default): use in AC automations started by "Tag is added: <cohort tag>". The contact's tags are
 *   read from the webhook (or from AC if missing); the student is created if needed and enrolled in every cohort
 *   whose AC tag the contact has. New enrolments fill their link field and add <prefix>_enrolled (→ welcome email).
 * action=revoke&tag=<cohort tag>[,<tag>…]: use for refunds. Revokes their enrolment in those cohorts.
 *
 * Always answers 200 with a short JSON result once the key is valid (AC doesn't need to retry a logical "no-op");
 * every call is recorded in webhook_log and visible on the Automation page.
 */
const db = require('./_lib/db.js');
const auth = require('./_lib/auth.js');
const ac = require('./_lib/ac.js');
const automation = require('./_lib/automation.js');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let text = '';
  if (typeof req.body === 'string') text = req.body;
  else if (Buffer.isBuffer(req.body)) text = req.body.toString('utf8');
  else {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    text = Buffer.concat(chunks).toString('utf8');
  }
  text = text.trim();
  if (!text) return {};
  if (text.startsWith('{')) return JSON.parse(text);
  return Object.fromEntries(new URLSearchParams(text));
}

// The contact from AC's webhook body (form fields like contact[email], or JSON).
function contactFrom(body) {
  const c = body.contact && typeof body.contact === 'object' ? body.contact : {};
  const get = (k) => body[`contact[${k}]`] ?? c[k];
  const email = String(get('email') || body.email || '').trim().toLowerCase();
  const tagsRaw = get('tags');
  const tags = tagsRaw == null ? null : (Array.isArray(tagsRaw) ? tagsRaw : String(tagsRaw).split(',')).map((t) => String(t).trim()).filter(Boolean);
  return { id: get('id') ? String(get('id')) : null, email, firstName: String(get('first_name') || get('firstName') || '').trim(), tags };
}

async function log(payload, result, studentId) {
  await db.query('INSERT INTO webhook_log (source, payload, result, student_id) VALUES ($1, $2, $3, $4)', ['ac', JSON.stringify(payload), result, studentId || null])
    .catch((err) => console.error('webhook log failed', err.message));
}

async function enroll(contact) {
  const cohorts = await db.query(`SELECT id, show_id, name, ac_tag FROM cohorts WHERE ac_tag <> ''`);
  let has;
  if (contact.tags) {
    const set = new Set(contact.tags.map((t) => t.toLowerCase()));
    has = cohorts.filter((c) => set.has(c.ac_tag.toLowerCase()));
  } else {
    // The webhook didn't include tags: ask AC which cohort tags this contact has.
    const id = contact.id || (await ac.findContactByEmail(contact.email) || {}).id;
    const names = id ? await ac.contactHasTags(id, cohorts.map((c) => c.ac_tag)) : [];
    const set = new Set(names.map((t) => t.toLowerCase()));
    has = cohorts.filter((c) => set.has(c.ac_tag.toLowerCase()));
  }
  if (!has.length) return { result: 'no cohort tag on this contact', studentId: null };

  let student = await db.one('SELECT id, name, status FROM students WHERE lower(email) = $1', [contact.email]);
  if (!student) {
    student = await db.one(`INSERT INTO students (email, name, token, ac_contact_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id, name, status`,
      [contact.email, contact.firstName, auth.newToken(), contact.id]);
    if (!student) student = await db.one('SELECT id, name, status FROM students WHERE lower(email) = $1', [contact.email]);
  } else {
    await db.query(`UPDATE students SET ac_contact_id = COALESCE($2, ac_contact_id), name = CASE WHEN name = '' THEN $3 ELSE name END, updated_at = now() WHERE id = $1`,
      [student.id, contact.id, contact.firstName]);
  }
  const added = [];
  for (const c of has) {
    // New enrolment, or a revoked one bought again: (re)activate it.
    const row = await db.one(
      `INSERT INTO enrollments (student_id, cohort_id, source) VALUES ($1, $2, 'webhook')
       ON CONFLICT (student_id, cohort_id) DO UPDATE SET status = 'active', revoked_at = NULL, updated_at = now()
         WHERE enrollments.status = 'revoked'
       RETURNING id`, [student.id, c.id]);
    if (row) {
      added.push(c.name);
      await automation.notifyEnrolled(student.id, c.show_id);
    }
  }
  if (added.length) await automation.processOutbox({ budgetMs: 6000 });
  return { result: added.length ? `enrolled: ${added.join(', ')}` : `already enrolled (${has.map((c) => c.name).join(', ')})`, studentId: student.id };
}

async function revoke(contact, tagList) {
  const student = await db.one('SELECT id FROM students WHERE lower(email) = $1', [contact.email]);
  if (!student) return { result: 'not a student', studentId: null };
  const wanted = tagList.map((t) => t.toLowerCase());
  const rows = await db.query(
    `UPDATE enrollments en SET status = 'revoked', revoked_at = now(), updated_at = now()
       FROM cohorts c WHERE c.id = en.cohort_id AND en.student_id = $1 AND lower(c.ac_tag) = ANY($2::text[]) AND en.status <> 'revoked'
     RETURNING c.name, c.show_id`, [student.id, wanted]);
  for (const showId of new Set(rows.map((r) => r.show_id))) {
    const show = await db.one('SELECT * FROM shows WHERE id = $1', [showId]);
    await automation.onRevokedByWebhook(student.id, show);
  }
  if (rows.length) await automation.processOutbox({ budgetMs: 4000 });
  return { result: rows.length ? `revoked: ${rows.map((r) => r.name).join(', ')}` : 'nothing to revoke', studentId: student.id };
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://local');
  let expected;
  try {
    expected = auth.webhookKey();
  } catch (err) {
    return send(res, 503, { ok: false, error: 'PODCAST_SECRET is not set' });
  }
  if (!auth.safeEqual(url.searchParams.get('key') || '', expected)) return send(res, 403, { ok: false, error: 'bad key' });
  if (req.method === 'GET') return send(res, 200, { ok: true, message: 'Webhook address is valid. ActiveCampaign must call it with POST.' });
  if (req.method !== 'POST') return send(res, 405, { ok: false });

  const action = url.searchParams.get('action') || 'enroll';
  let body, contact;
  try {
    body = await readBody(req);
    contact = contactFrom(body);
  } catch (err) {
    await log({ action, error: 'unreadable body' }, 'error: unreadable body');
    return send(res, 400, { ok: false, error: 'unreadable body' });
  }
  const summary = { action, email: contact.email, contact_id: contact.id, tags: contact.tags };
  if (!contact.email) {
    await log(summary, 'error: no contact email');
    return send(res, 200, { ok: false, result: 'no contact email in the webhook' });
  }
  try {
    let out;
    if (action === 'revoke') {
      const tagList = (url.searchParams.get('tag') || '').split(',').map((t) => t.trim()).filter(Boolean);
      out = tagList.length ? await revoke(contact, tagList) : { result: 'error: add &tag=<cohort AC tag> to the address', studentId: null };
    } else if (action === 'enroll') {
      out = await enroll(contact);
    } else {
      out = { result: `error: unknown action "${action}"`, studentId: null };
    }
    await log(summary, out.result, out.studentId);
    return send(res, 200, { ok: !out.result.startsWith('error'), result: out.result });
  } catch (err) {
    console.error('podcast-ac', err);
    await log(summary, `error: ${String(err.message).slice(0, 300)}`);
    return send(res, 500, { ok: false, error: 'server error' }); // AC retries failed webhooks
  }
};

module.exports.contactFrom = contactFrom;
