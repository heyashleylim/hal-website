// Copying ActiveCampaign's emails (api/_lib/emails/ac-sync.js), with a made-up AC and a stand-in database.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fakeAc = require('../../tools/emails/fake-ac.js');

const lib = (f) => require.resolve(path.join(__dirname, '../../api/_lib', f));

// A fresh ac-sync.js on an in-memory `emails` table.
function load() {
  const emails = [];
  const runs = [];
  const db = {
    async query(sql, params = []) {
      if (/^INSERT INTO emails/.test(sql.trim())) {
        return JSON.parse(params[0]).map((r) => {
          const known = emails.find((e) => e.source_ref === r.source_ref);
          if (!known) { emails.push({ id: emails.length + 1, source: 'ac', body_synced_at: null, subject: '', ...r }); return { inserted: true }; }
          if (known.ac_message_id !== r.ac_message_id) known.body_synced_at = null;
          Object.assign(known, r);
          return { inserted: false };
        });
      }
      if (/^SELECT id, ac_message_id FROM emails/.test(sql.trim())) return emails.filter((e) => !e.body_synced_at && e.ac_message_id).sort((a, b) => b.sent_at.localeCompare(a.sent_at));
      if (/^UPDATE emails SET subject/.test(sql.trim())) {
        const [id, subject, preheader, body_html, body_text, has_link] = params;
        Object.assign(emails.find((e) => e.id === id), { subject, preheader, body_html, body_text, has_link, body_synced_at: 'now' });
        return [];
      }
      if (/^UPDATE email_sync_runs/.test(sql.trim())) { Object.assign(runs.find((r) => r.id === params[0]), { ok: params[1], summary: JSON.parse(params[2]), error: params[3] }); return []; }
      throw new Error('unexpected query: ' + sql);
    },
    async one(sql, params) {
      if (/INSERT INTO email_sync_runs/.test(sql)) { runs.push({ id: runs.length + 1, trigger: params[0] }); return { id: runs.length }; }
      throw new Error('unexpected query: ' + sql);
    },
  };
  require.cache[lib('db.js')] = { id: lib('db.js'), filename: lib('db.js'), loaded: true, exports: db };
  delete require.cache[lib('emails/ac-sync.js')];
  const sync = require('../../api/_lib/emails/ac-sync.js');
  return { sync, emails, runs };
}
test.after(() => { delete require.cache[lib('db.js')]; delete require.cache[lib('emails/ac-sync.js')]; });

test('a campaign becomes an email only once it was sent; numbers count people', () => {
  const { sync } = load();
  const c = { id: '9', type: 'single', name: ' Launch 1 ', sdate: '2026-10-01T08:00:00-05:00', ldate: null, send_amt: '1500', uniqueopens: '330', opens: '900', subscriberclicks: '21', uniquelinkclicks: '40', unsubscribes: '2', hardbounces: '1', softbounces: '3', message_id: '77', automation: null, seriesid: '0' };
  assert.deepEqual(sync.campaignRow(c), {
    source_ref: '9', kind: 'campaign', name: 'Launch 1', ac_message_id: '77', sent_at: '2026-10-01T13:00:00.000Z', last_sent_at: null,
    sent: 1500, opened: 330, clicked: 21, unsubscribed: 2, bounced: 4,
  });
  assert.equal(sync.campaignRow({ ...c, sdate: null }), null);            // draft or scheduled
  assert.equal(sync.campaignRow({ ...c, send_amt: '0' }), null);
  assert.equal(sync.campaignRow({ ...c, seriesid: '4' }).kind, 'automation');
  assert.equal(sync.campaignRow({ ...c, automation: '4' }).kind, 'automation');
  assert.equal(sync.campaignRow({ ...c, type: 'responder' }).kind, 'automation');
  const { subscriberclicks, ...older } = c;
  assert.equal(sync.campaignRow(older).clicked, 40);                      // no "people who clicked" → unique link clicks
});

test('an HTML email becomes readable text, and its links are noticed', () => {
  const { sync } = load();
  const html = '<html><head><title>x</title><style>p{color:red}</style></head><body><!-- hidden --><p>안녕하세요&nbsp;님!</p><div>첫 줄<br>둘째 줄 &amp; 끝</div><p><a href="https://www.ashleylim.com/nsmb">신청하기</a></p><p><a href="%UNSUBSCRIBELINK%">수신거부</a></p><script>alert(1)</script></body></html>';
  assert.equal(sync.htmlToText(html), '안녕하세요 님!\n첫 줄\n둘째 줄 & 끝\n신청하기\n수신거부');
  assert.equal(sync.linkIn(html, ''), true);
  assert.equal(sync.linkIn('<p>이야기만</p><a href="%UNSUBSCRIBELINK%">수신거부</a>', ''), false);
  assert.equal(sync.linkIn('', '자세히: https://www.ashleylim.com/eft'), true);
  assert.equal(sync.linkIn('', '링크 없는 글'), false);
  const m = sync.messageRow({ subject: ' 제목 ', preheader_text: '미리보기', html: '', text: '본문\nhttps://x.kr' });
  assert.deepEqual(m, { subject: '제목', preheader: '미리보기', body_html: null, body_text: '본문\nhttps://x.kr', has_link: true });
});

test('a sync adds the sent emails, reads their text, and a second sync only refreshes numbers', async () => {
  const { sync, emails, runs } = load();
  const ac = fakeAc.create({ broadcasts: 130 });   // more than one page of 100
  sync.setClient(ac.request);
  const first = await sync.sync({ trigger: 'cron' });
  assert.deepEqual(first, { ok: true, campaigns: 133, emails: 132, added: 132, bodies: 132, bodies_left: 0 });
  assert.equal(ac.calls.filter((p) => p.startsWith('/campaigns')).length, 2);
  assert.equal(emails.filter((e) => e.kind === 'automation').length, 1);
  assert.ok(!emails.some((e) => /draft/.test(e.name)));
  const one = emails.find((e) => e.name === 'Fake broadcast 130');
  assert.equal(one.subject, '가짜 이메일 제목 130');
  assert.match(one.body_text, /^안녕하세요 %FIRSTNAME%님!\n이것은 테스트용 가짜 이메일 130번이에요\./);
  assert.equal(one.has_link, true);
  assert.equal(emails.find((e) => e.name === 'Fake broadcast 127').has_link, false); // only the unsubscribe link
  assert.deepEqual(runs[0], { id: 1, trigger: 'cron', ok: true, summary: first, error: null });

  // the numbers move in AC: the next sync picks them up without reading the texts again
  ac.campaigns.find((c) => c.name === 'Fake broadcast 130').uniqueopens = '999';
  ac.calls.length = 0;
  const second = await sync.sync();
  assert.deepEqual(second, { ok: true, campaigns: 133, emails: 132, added: 0, bodies: 0, bodies_left: 0 });
  assert.equal(one.opened, 999);
  assert.equal(ac.calls.filter((p) => p.startsWith('/messages')).length, 0);
});

test('out of time: the texts left are read by the next sync; an AC failure is recorded, never thrown', async () => {
  const { sync, emails, runs } = load();
  const ac = fakeAc.create({ broadcasts: 6 });
  sync.setClient(ac.request);
  const short = await sync.sync({ budgetMs: -1 });
  assert.equal(short.ok, true);
  assert.equal(short.bodies, 0);
  assert.equal(short.bodies_left, 8);
  assert.match(short.note, /next sync/);
  assert.equal((await sync.sync()).bodies, 8);

  // a message deleted in AC is not asked for again and again
  ac.messages.clear();
  emails[0].ac_message_id = '999';
  emails[0].body_synced_at = null;
  assert.equal((await sync.sync()).bodies_left, 0);

  sync.setClient(async () => { const e = new Error('AC GET /campaigns → 503'); e.status = 503; throw e; });
  const failed = await sync.sync();
  assert.deepEqual(failed, { ok: false, error: 'AC GET /campaigns → 503' });
  assert.equal(runs.at(-1).ok, false);
  assert.equal(runs.at(-1).error, 'AC GET /campaigns → 503');
});

test('without ActiveCampaign keys nothing runs', async () => {
  const { sync } = load();
  delete process.env.AC_API_URL;
  delete process.env.AC_API_KEY;
  const r = await sync.sync();
  assert.equal(r.skipped, true);
});
