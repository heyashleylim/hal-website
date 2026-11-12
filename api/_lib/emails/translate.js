/*
 * English translations of the emails, made once and saved (emails.subject_en / body_en), so the admin never
 * translates while someone is reading. An email is translated again only when its Korean subject or body changes.
 *
 * The translation is written by a language model reached through Vercel AI Gateway (plain fetch, no package):
 *   AI_GATEWAY_API_KEY          an AI Gateway key (Vercel → AI Gateway → API keys), or
 *   VERCEL_OIDC_TOKEN           what Vercel gives a deployment by itself (also sent as the x-vercel-oidc-token header)
 *   EMAILS_TRANSLATE_MODEL      optional: another model id from https://ai-gateway.vercel.sh/v1/models
 * Only the email's subject and text are sent, never anything about subscribers.
 *
 * run() works through the emails still to translate, newest first, a few at a time, within a time budget;
 * what's left is picked up by the next run (daily job, after an import or a sync, or "Translate now").
 */
const crypto = require('node:crypto');
const db = require('../db.js');

const ENDPOINT = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-5.5';
const MAX_TRIES = 5;
const MAX_CHARS = 40000; // longer emails are translated up to here

const SYSTEM = `You translate Korean marketing emails written by Ashley Lim (애슐리 림), a Korean growth coach, into English.
The reader is a colleague who does not read Korean and wants to understand exactly what each email says and how it says it.

Rules:
- Translate faithfully and completely into natural English. Do not summarise, shorten, explain or add anything.
- Keep the tone: warm, personal, conversational. Keep every emoji where it is.
- Keep the line breaks and blank lines of the original, so the English can be read next to the Korean.
- Leave merge tags exactly as written, for example {{contact.first_name}} or %FIRSTNAME%. Leave links and prices unchanged.
- Program names: write 내성만방 as "NSMB (내성만방)" the first time and "NSMB" after that. Keep other product names as they are usually written in English (EFT Tapping Masterclass, SWITCH Masterclass, ELEVATE, CHOSEN, Life Artist).
- Text that is already in English stays as it is.

Answer with exactly this, and nothing else:
<subject>the subject in English</subject>
<body>the email in English</body>`;

// Stand-in for tests and the local dev server: fn({ subject, body }) → { subject, body }.
let client = null;
function setClient(fn) { client = fn; }

const credential = (token) => (process.env.AI_GATEWAY_API_KEY || '').trim() || (process.env.VERCEL_OIDC_TOKEN || '').trim() || String(token || '').trim();
const configured = (token) => Boolean(client) || Boolean(credential(token));

// The fingerprint of what was translated (the same expression is used in SQL: md5(subject || E'\n' || body_text)).
const fingerprint = (subject, body) => crypto.createHash('md5').update(`${subject}\n${body}`).digest('hex');

function parse(answer) {
  const subject = /<subject>([\s\S]*?)<\/subject>/.exec(answer);
  const body = /<body>([\s\S]*?)(?:<\/body>|$)/.exec(answer);
  if (!subject || !body) throw new Error('the translation came back in an unexpected shape');
  return { subject: subject[1].trim(), body: body[1].replace(/^\n+|\s+$/g, '') };
}

async function ask({ subject, body }, token) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${credential(token)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: (process.env.EMAILS_TRANSLATE_MODEL || '').trim() || DEFAULT_MODEL,
      max_tokens: 16000,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `<subject>${subject}</subject>\n<body>\n${body.slice(0, MAX_CHARS)}\n</body>` },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`translation service → ${res.status}${data.error && data.error.message ? `: ${String(data.error.message).slice(0, 200)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof answer !== 'string') throw new Error('the translation service answered without text');
  return parse(answer);
}

const translateOne = (email, token) => (client ? client(email) : ask(email, token));

// These stop the whole run: the next email would fail the same way (no access, no credit, too many requests).
const STOPS = { 401: 'the translation service refused the key', 402: 'the AI Gateway account has no credit left', 403: 'the translation service refused the key', 429: 'the translation service asked to slow down' };

const PENDING = `(subject <> '' OR body_text <> '') AND translated_of IS DISTINCT FROM md5(subject || E'\\n' || body_text)`;

async function counts() {
  return db.one(
    `SELECT count(*) FILTER (WHERE ${PENDING} AND translate_tries < ${MAX_TRIES})::int AS pending,
            count(*) FILTER (WHERE ${PENDING} AND translate_tries >= ${MAX_TRIES})::int AS failed,
            count(*) FILTER (WHERE translated_of IS NOT NULL)::int AS translated FROM emails`);
}

/*
 * Translates what is waiting, within the budget. → { ok, translated, failed, left, error? } and never throws.
 * `retry` gives the emails that failed 5 times another chance ("Translate now").
 */
async function run({ budgetMs = 40000, token = '', concurrency = 4, retry = false } = {}) {
  if (!configured(token)) return { ok: false, skipped: true, translated: 0, failed: 0, error: 'Translation is not set up here (AI_GATEWAY_API_KEY)' };
  const deadline = Date.now() + budgetMs;
  if (retry) await db.query(`UPDATE emails SET translate_tries = 0 WHERE translate_tries >= ${MAX_TRIES}`);
  const todo = await db.query(
    `SELECT id, subject, body_text FROM emails WHERE ${PENDING} AND translate_tries < ${MAX_TRIES} ORDER BY sent_at DESC LIMIT 400`);
  let translated = 0, failed = 0, stop = null, next = 0;
  async function worker() {
    while (!stop && next < todo.length && Date.now() < deadline) {
      const e = todo[next++];
      try {
        const en = await translateOne({ subject: e.subject, body: e.body_text }, token);
        await db.query(
          `UPDATE emails SET subject_en = $2, body_en = $3, translated_of = $4, translated_at = now(), translate_tries = 0, translate_error = NULL WHERE id = $1`,
          [e.id, en.subject, en.body, fingerprint(e.subject, e.body_text)]);
        translated++;
      } catch (err) {
        if (STOPS[err.status]) { stop = STOPS[err.status]; break; }
        failed++;
        await db.query(`UPDATE emails SET translate_tries = translate_tries + 1, translate_error = $2 WHERE id = $1`, [e.id, String(err.message || err).slice(0, 300)]);
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, todo.length)) }, worker));
    const c = await counts();
    const out = { ok: !stop, translated, failed, left: c.pending };
    if (stop) out.error = stop;
    return out;
  } catch (err) {
    console.error('emails translate', err);
    return { ok: false, translated, failed, error: String(err.message || err).slice(0, 300) };
  }
}

module.exports = { run, counts, configured, setClient, parse, fingerprint, DEFAULT_MODEL, MAX_TRIES };
