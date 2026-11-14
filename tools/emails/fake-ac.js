/*
 * A stand-in for ActiveCampaign's campaigns API, for the local dev server (tools/shop/dev-server.js) and
 * tests/emails/ac-sync.test.js: made-up campaigns in the shape GET /campaigns and GET /messages/<id> answer with.
 * Numbers are strings, as in AC. Nothing here is real data.
 */
function create({ now = new Date('2026-11-10T00:00:00Z'), broadcasts = 36 } = {}) {
  const campaigns = [];
  const messages = new Map();
  const iso = (d) => d.toISOString().replace('.000Z', '-06:00'); // AC answers with the account's UTC offset
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  function add(c, message) {
    const id = String(campaigns.length + 1);
    campaigns.push({ id, type: 'single', automation: null, seriesid: '0', status: '5', message_id: String(100 + campaigns.length), ...c });
    if (message) messages.set(campaigns.at(-1).message_id, message);
  }
  for (let i = 0; i < broadcasts; i++) {
    const sent = 1750 + Math.round(rand() * 120);
    const star = i === 5 || i === 20; // two emails that did clearly better than the others
    const sdate = new Date(now.getTime() - (4 + i * 1.5) * 86400000);
    add({
      name: `Fake broadcast ${broadcasts - i}`, sdate: iso(sdate), ldate: iso(sdate), send_amt: String(sent), total_amt: String(sent),
      uniqueopens: String(Math.round(sent * (star ? 0.36 : 0.2 + rand() * 0.05))), opens: String(sent),
      subscriberclicks: String(i % 4 === 3 ? 0 : Math.round(sent * (star ? 0.045 : 0.008 + rand() * 0.008))), uniquelinkclicks: '0',
      unsubscribes: String(Math.round(rand() * 3)), hardbounces: '1', softbounces: String(Math.round(rand() * 4)),
    }, {
      subject: `가짜 이메일 제목 ${broadcasts - i}`, preheader_text: i % 3 ? '' : '미리보기 문구',
      text: '',
      html: `<html><head><style>p{margin:0}</style></head><body><p>안녕하세요 %FIRSTNAME%님!</p><p>이것은 테스트용 가짜 이메일 ${broadcasts - i}번이에요.</p>` +
        (i % 4 === 3 ? '' : '<p><a href="https://www.ashleylim.com/nsmb">자세히 보기</a></p>') +
        '<p>사랑을 담아,<br>애슐리</p><p><a href="%UNSUBSCRIBELINK%">수신거부</a></p></body></html>',
    });
  }
  add({ name: 'Fake automation: welcome email', automation: '3', seriesid: '3', sdate: iso(new Date(now.getTime() - 200 * 86400000)), ldate: iso(new Date(now.getTime() - 86400000)), send_amt: '412', uniqueopens: '260', subscriberclicks: '88', unsubscribes: '2', hardbounces: '0', softbounces: '1' },
    { subject: '환영합니다', preheader_text: '', text: '환영 이메일 본문\nhttps://www.ashleylim.com/', html: '' });
  add({ name: 'Fake sent two days ago', sdate: iso(new Date(now.getTime() - 2 * 86400000)), ldate: null, send_amt: '1800', uniqueopens: '300', subscriberclicks: '10', unsubscribes: '0', hardbounces: '0', softbounces: '0' },
    { subject: '이틀 전 이메일', preheader_text: '', text: '', html: '<p>아직 집계 중</p>' });
  add({ name: 'Fake draft (never sent)', status: '0', sdate: null, ldate: null, send_amt: '0', uniqueopens: '0', subscriberclicks: '0', unsubscribes: '0', hardbounces: '0', softbounces: '0' });

  const calls = [];
  async function request(path) {
    calls.push(path);
    const url = new URL('http://ac' + path);
    if (url.pathname === '/campaigns') {
      const limit = Number(url.searchParams.get('limit') || 20), offset = Number(url.searchParams.get('offset') || 0);
      const list = [...campaigns].sort((a, b) => String(b.sdate || '').localeCompare(String(a.sdate || '')));
      return { campaigns: list.slice(offset, offset + limit), meta: { total: String(campaigns.length) } };
    }
    const m = /^\/messages\/(\d+)$/.exec(url.pathname);
    if (m && messages.has(m[1])) return { message: { id: m[1], ...messages.get(m[1]) } };
    const err = new Error(`AC GET ${url.pathname} → 404`);
    err.status = 404;
    throw err;
  }
  return { request, campaigns, messages, calls };
}

module.exports = { create };
