/*
 * A stand-in for ActiveCampaign's contacts API, for the local dev server (tools/shop/dev-server.js) and
 * tests/contacts/ac-sync.test.js: made-up contacts in the shape GET /contacts, GET /contacts/<id>, /tags, /lists and
 * /fields answer with. Nothing here is real data. remove(id) makes a contact disappear (as if deleted in AC).
 */
function create({ count = 240, now = new Date('2026-11-10T00:00:00Z') } = {}) {
  const tags = [
    { id: '1', tag: 'purchased_nsmb_10_202602' }, { id: '2', tag: 'purchased_eft' }, { id: '3', tag: 'waitlist_nsmb' },
    { id: '4', tag: 'masterclass_2026_10' }, { id: '5', tag: 'podcast_nsmb_enrolled' },
  ];
  const lists = [{ id: '1', name: 'Master Contact List' }, { id: '2', name: 'Newsletter' }];
  const fields = [{ id: '1', title: 'PODCAST_LINK', perstag: 'PODCAST_LINK' }, { id: '2', title: 'Phone country', perstag: 'PHONE_COUNTRY' }];
  const FAMILY = ['Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon'];
  const GIVEN = ['Test A', 'Test B', 'Test C', 'Test D', 'Test E', 'Test F', 'Test G'];
  const contacts = [];
  for (let i = 1; i <= count; i++) {
    const cdate = new Date(now.getTime() - (count - i) * 36e5 * 7).toISOString();
    contacts.push({
      id: String(1000 + i), email: `fake.contact${i}@example.com`, firstName: `${FAMILY[i % FAMILY.length]} ${GIVEN[i % GIVEN.length]}`, lastName: '',
      phone: i % 5 ? '' : `+82 10-0000-${String(i).padStart(4, '0')}`, cdate, udate: cdate,
      _tags: tags.filter((t, k) => (i + k) % (k + 2) === 0).map((t) => t.id),
      _lists: [{ list: '1', status: i % 9 ? '1' : '2' }],
      _fields: i % 3 ? [] : [{ field: '2', value: 'KR' }],
    });
  }
  const gone = new Set();
  const live = () => contacts.filter((c) => !gone.has(c.id));
  const pub = (c) => { const { _tags, _lists, _fields, ...rest } = c; return rest; };
  const notFound = () => { const err = new Error('AC GET → 404'); err.status = 404; throw err; };

  async function request(path) {
    const u = new URL(path, 'https://fake.api-us1.com');
    const limit = Number(u.searchParams.get('limit') || 20), offset = Number(u.searchParams.get('offset') || 0);
    const page = (list, key) => ({ [key]: list.slice(offset, offset + limit), meta: { total: String(list.length) } });
    let m;
    if (u.pathname === '/tags') return page(tags, 'tags');
    if (u.pathname === '/lists') return page(lists, 'lists');
    if (u.pathname === '/fields') return page(fields, 'fields');
    if (u.pathname === '/contacts') {
      let list = live();
      const after = u.searchParams.get('filters[updated_after]');
      if (after) list = list.filter((c) => c.udate.slice(0, 10) >= after);
      return page(list.map(pub), 'contacts');
    }
    if ((m = /^\/contacts\/(\d+)$/.exec(u.pathname))) {
      const c = live().find((x) => x.id === m[1]);
      if (!c) notFound();
      return {
        contact: pub(c),
        contactTags: c._tags.map((t, k) => ({ id: `${c.id}${k}`, contact: c.id, tag: t })),
        contactLists: c._lists.map((l) => ({ contact: c.id, ...l })),
        fieldValues: c._fields.map((f) => ({ contact: c.id, ...f })),
      };
    }
    throw new Error('fake AC: no answer for ' + path);
  }
  return { request, contacts, remove: (id) => gone.add(String(id)), touch: (id, changes) => Object.assign(contacts.find((c) => c.id === String(id)), changes, { udate: new Date().toISOString() }) };
}

module.exports = { create };
