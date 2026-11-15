// Saved English translations (api/_lib/emails/translate.js): each email once, again only when its Korean changes.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const lib = (f) => require.resolve(path.join(__dirname, '../../api/_lib', f));

function load(emails) {
  const db = {
    async query(sql, params = []) {
      const s = sql.trim();
      if (/^UPDATE emails SET translate_tries = 0 WHERE/.test(s)) { emails.forEach((e) => { if (e.translate_tries >= 5) e.translate_tries = 0; }); return []; }
      if (/^SELECT id, subject, body_text FROM emails/.test(s)) return emails.filter(pending).filter((e) => e.translate_tries < 5).sort((a, b) => b.sent_at.localeCompare(a.sent_at));
      if (/^UPDATE emails SET subject_en/.test(s)) { Object.assign(emails.find((e) => e.id === params[0]), { subject_en: params[1], body_en: params[2], translated_of: params[3], translate_tries: 0, translate_error: null }); return []; }
      if (/^UPDATE emails SET translate_tries = translate_tries \+ 1/.test(s)) { const e = emails.find((x) => x.id === params[0]); e.translate_tries += 1; e.translate_error = params[1]; return []; }
      throw new Error('unexpected query: ' + sql);
    },
    async one() {
      return { pending: emails.filter(pending).filter((e) => e.translate_tries < 5).length, failed: emails.filter(pending).filter((e) => e.translate_tries >= 5).length, translated: emails.filter((e) => e.translated_of).length };
    },
  };
  require.cache[lib('db.js')] = { id: lib('db.js'), filename: lib('db.js'), loaded: true, exports: db };
  delete require.cache[lib('emails/translate.js')];
  const translate = require('../../api/_lib/emails/translate.js');
  function pending(e) { return (e.subject !== '' || e.body_text !== '') && e.translated_of !== translate.fingerprint(e.subject, e.body_text); }
  return translate;
}
const email = (id, subject, body, extra = {}) => ({ id, subject, body_text: body, sent_at: `2026-01-${String(id).padStart(2, '0')}`, subject_en: '', body_en: '', translated_of: null, translate_tries: 0, translate_error: null, ...extra });
test.after(() => { delete require.cache[lib('db.js')]; delete require.cache[lib('emails/translate.js')]; });
test.beforeEach(() => { delete process.env.AI_GATEWAY_API_KEY; delete process.env.VERCEL_OIDC_TOKEN; });

test('the answer of the model is read as subject and body', () => {
  const t = load([]);
  assert.deepEqual(t.parse('<subject> Hello </subject>\n<body>\nLine 1\n\nLine 2 💝\n</body>'), { subject: 'Hello', body: 'Line 1\n\nLine 2 💝' });
  assert.deepEqual(t.parse('<subject></subject><body>cut off because it was long'), { subject: '', body: 'cut off because it was long' });
  assert.throws(() => t.parse('Sorry, I cannot help with that.'), /unexpected shape/);
});

test('each email is translated once; a changed Korean text is translated again; empty emails are left alone', async () => {
  const emails = [email(1, '제목 1', '본문 1'), email(2, '제목 2', '본문 2'), email(3, '', '')];
  const t = load(emails);
  const seen = [];
  t.setClient(async ({ subject, body }) => { seen.push(subject); return { subject: 'EN ' + subject, body: 'EN ' + body }; });
  assert.deepEqual(await t.run(), { ok: true, translated: 2, failed: 0, left: 0 });
  assert.deepEqual(seen, ['제목 2', '제목 1']);                      // newest first
  assert.equal(emails[0].subject_en, 'EN 제목 1');
  assert.equal(emails[0].body_en, 'EN 본문 1');
  assert.deepEqual(await t.run(), { ok: true, translated: 0, failed: 0, left: 0 });   // nothing is translated twice
  emails[1].body_text = '본문 2 (고침)';
  assert.deepEqual(await t.run(), { ok: true, translated: 1, failed: 0, left: 0 });
  assert.equal(emails[1].body_en, 'EN 본문 2 (고침)');
  assert.equal(seen.length, 3);
});

test('one failing email does not stop the others, and is left alone after 5 tries until asked again', async () => {
  const emails = [email(1, 'ok', 'a'), email(2, 'bad', 'b')];
  const t = load(emails);
  t.setClient(async ({ subject }) => { if (subject === 'bad') throw new Error('the translation came back in an unexpected shape'); return { subject: 'S', body: 'B' }; });
  assert.deepEqual(await t.run({ concurrency: 1 }), { ok: true, translated: 1, failed: 1, left: 1 });
  for (let i = 0; i < 4; i++) await t.run();
  assert.equal(emails[1].translate_tries, 5);
  assert.deepEqual(await t.run(), { ok: true, translated: 0, failed: 0, left: 0 });
  assert.deepEqual(await t.counts(), { pending: 0, failed: 1, translated: 1 });
  assert.equal((await t.run({ retry: true })).failed, 1);            // "Translate now" tries again
  assert.equal(emails[1].translate_tries, 1);
});

test('no credit, a refused key or "slow down" stop the run and say why; the emails stay waiting', async () => {
  const emails = [email(1, 'a', 'a'), email(2, 'b', 'b'), email(3, 'c', 'c')];
  const t = load(emails);
  t.setClient(async () => { const e = new Error('translation service → 402'); e.status = 402; throw e; });
  assert.deepEqual(await t.run({ concurrency: 1 }), { ok: false, translated: 0, failed: 0, left: 3, error: 'the AI Gateway account has no credit left' });
  assert.ok(emails.every((e) => e.translate_tries === 0));
});

test('out of time: what is left waits for the next run', async () => {
  const emails = [email(1, 'a', 'a'), email(2, 'b', 'b')];
  const t = load(emails);
  t.setClient(async () => ({ subject: 'S', body: 'B' }));
  assert.deepEqual(await t.run({ budgetMs: -1 }), { ok: true, translated: 0, failed: 0, left: 2 });
});

test('the real service: key, model and what is sent', async () => {
  const emails = [email(1, '제목', '안녕하세요 {{contact.first_name}}님')];
  const t = load(emails);
  t.setClient(null);
  assert.equal((await t.run()).skipped, true);                        // no key, no token: nothing is called
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => { calls.push({ url, auth: opts.headers.Authorization, body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '<subject>Subject</subject>\n<body>Hello {{contact.first_name}}</body>' } }] }) }; };
  try {
    assert.deepEqual(await t.run({ token: 'oidc-token' }), { ok: true, translated: 1, failed: 0, left: 0 });
    assert.equal(calls[0].url, 'https://ai-gateway.vercel.sh/v1/chat/completions');
    assert.equal(calls[0].auth, 'Bearer oidc-token');
    assert.equal(calls[0].body.model, t.DEFAULT_MODEL);
    assert.match(calls[0].body.messages[1].content, /<subject>제목<\/subject>\n<body>\n안녕하세요 \{\{contact.first_name\}\}님\n<\/body>/);
    assert.equal(emails[0].body_en, 'Hello {{contact.first_name}}');
    process.env.VERCEL_OIDC_TOKEN = 'old-token-from-the-build';      // the request's own token wins over a stored one
    emails[0].body_text += '!';
    await t.run({ token: 'oidc-token' });
    assert.equal(calls[1].auth, 'Bearer oidc-token');
    emails[0].body_text += '!';
    process.env.AI_GATEWAY_API_KEY = ' key ';                         // a key wins over the token
    await t.run({ token: 'oidc-token' });
    assert.equal(calls[2].auth, 'Bearer key');
    // a refusal is reported with what the service said
    global.fetch = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'AI Gateway requires a valid credit card on file' } }) });
    emails[0].body_text += '!';
    assert.equal((await t.run()).error, 'the translation service refused the key (it said: AI Gateway requires a valid credit card on file)');
  } finally { global.fetch = realFetch; }
});
