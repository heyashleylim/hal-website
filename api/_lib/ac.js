/*
 * ActiveCampaign API v3 client (contacts, tags, custom fields), shared by the private podcast and the NSMB waitlist.
 *
 *   AC_API_URL  e.g. https://youraccount.api-us1.com   (Settings → Developer)
 *   AC_API_KEY  never commit it
 *
 * Every call throws on failure (with the HTTP status) so the outbox can retry it later.
 */

const tagIds = new Map();   // lower(tag name) → id
let fieldCache = null;      // [{ id, perstag, title }] contact custom fields, refreshed every 5 minutes
let fieldCacheAt = 0;

async function ac(path, options = {}) {
  if (!process.env.AC_API_URL || !process.env.AC_API_KEY) throw new Error('AC_API_URL / AC_API_KEY not set');
  const res = await fetch(process.env.AC_API_URL.trim().replace(/\/$/, '') + '/api/3' + path, {
    ...options,
    headers: { 'Api-Token': process.env.AC_API_KEY.trim(), 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`AC ${options.method || 'GET'} ${path.split('?')[0]} → ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

async function findContactByEmail(email) {
  const body = await ac('/contacts?email=' + encodeURIComponent(email));
  return (body.contacts || [])[0] || null;
}

// { id, email, firstName } or null.
async function getContact(id) {
  try {
    const body = await ac('/contacts/' + encodeURIComponent(id));
    const c = body.contact;
    return c ? { id: String(c.id), email: String(c.email || ''), firstName: c.firstName || '' } : null;
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// Tag id by name; created when `create` is true and it doesn't exist yet. Null if missing.
async function tagId(name, { create = false, description = 'Private podcast (hal-website)' } = {}) {
  const key = name.toLowerCase();
  if (tagIds.has(key)) return tagIds.get(key);
  const found = await ac('/tags?search=' + encodeURIComponent(name));
  let match = (found.tags || []).find((t) => t.tag.toLowerCase() === key);
  if (!match && create) {
    match = (await ac('/tags', { method: 'POST', body: JSON.stringify({ tag: { tag: name, tagType: 'contact', description } }) })).tag;
  }
  if (!match) return null;
  tagIds.set(key, match.id);
  return match.id;
}

async function contactTagIds(contactId) {
  const body = await ac(`/contacts/${encodeURIComponent(contactId)}/contactTags`);
  return (body.contactTags || []).map((ct) => ({ id: ct.id, tagId: String(ct.tag) }));
}

// Names (from `candidates`) of the tags this contact has.
async function contactHasTags(contactId, candidates) {
  const have = new Set((await contactTagIds(contactId)).map((ct) => ct.tagId));
  const out = [];
  for (const name of candidates) {
    const id = await tagId(name);
    if (id && have.has(String(id))) out.push(name);
  }
  return out;
}

async function addTag(contactId, name, { description } = {}) {
  const id = await tagId(name, { create: true, ...(description ? { description } : {}) });
  try {
    await ac('/contactTags', { method: 'POST', body: JSON.stringify({ contactTag: { contact: String(contactId), tag: String(id) } }) });
  } catch (err) {
    if (err.status !== 422) throw err; // 422: already tagged
  }
}

async function removeTag(contactId, name) {
  const id = await tagId(name);
  if (!id) return;
  const link = (await contactTagIds(contactId)).find((ct) => ct.tagId === String(id));
  if (link) await ac('/contactTags/' + link.id, { method: 'DELETE' });
}

async function contactFields() {
  if (!fieldCache || Date.now() - fieldCacheAt > 5 * 60 * 1000) {
    const list = [];
    for (let offset = 0; ; offset += 100) {
      const body = await ac(`/fields?limit=100&offset=${offset}`);
      for (const f of body.fields || []) list.push({ id: f.id, perstag: String(f.perstag || ''), title: String(f.title || '') });
      if (!body.fields || body.fields.length < 100) break;
    }
    fieldCache = list;
    fieldCacheAt = Date.now();
  }
  return fieldCache;
}

const norm = (s) => String(s).replace(/%/g, '').replace(/[\s_-]+/g, '').toUpperCase();

// The contact custom field matching a personalization tag (e.g. PODCAST_LINK, with or without %) or a field name:
// { id, perstag, title }. Spaces, dashes and underscores are ignored, so PODCAST_LINK finds %PODCASTLINK%.
async function findField(perstag) {
  return (await fieldOrThrow(perstag));
}

async function fieldId(perstag) {
  return (await fieldOrThrow(perstag)).id;
}

async function fieldOrThrow(perstag) {
  const list = await contactFields();
  const want = norm(perstag);
  const hit = list.find((f) => norm(f.perstag) === want) || list.find((f) => norm(f.title) === want);
  if (!hit) {
    const known = list.map((f) => `%${f.perstag}%`).slice(0, 40).join(', ') || 'none';
    throw new Error(`no contact field ${perstag} in ActiveCampaign (contact fields found: ${known})`);
  }
  return hit;
}

// Creates or updates the contact; `fields` maps perstag → value. Returns the contact id.
async function syncContact({ email, firstName, fields = {} }) {
  const fieldValues = [];
  for (const [perstag, value] of Object.entries(fields)) fieldValues.push({ field: String(await fieldId(perstag)), value: value == null ? '' : String(value) });
  const contact = { email, fieldValues };
  if (firstName) contact.firstName = firstName;
  const body = await ac('/contact/sync', { method: 'POST', body: JSON.stringify({ contact }) });
  return body.contact.id;
}

// Sets custom fields on an existing contact by id (no email needed); `fields` maps perstag → value.
async function updateContactFields(contactId, fields) {
  const fieldValues = [];
  for (const [perstag, value] of Object.entries(fields)) fieldValues.push({ field: String(await fieldId(perstag)), value: value == null ? '' : String(value) });
  if (!fieldValues.length) return;
  await ac('/contacts/' + encodeURIComponent(contactId), { method: 'PUT', body: JSON.stringify({ contact: { fieldValues } }) });
}

// A dropdown/radio field's options, in their AC order: [{ value, label }]. Empty if AC lists none.
const optionCache = new Map(); // field id → { at, list }
async function fieldOptions(perstag) {
  const id = String(await fieldId(perstag));
  const hit = optionCache.get(id);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.list;
  const body = await ac(`/fields/${encodeURIComponent(id)}?include=options`);
  const raw = body.fieldOptions || body.options || [];
  const list = raw
    .filter((o) => String(o.field || id) === id)
    .sort((a, b) => Number(a.orderid || 0) - Number(b.orderid || 0))
    .map((o) => ({ value: String(o.value ?? o.label ?? ''), label: String(o.label ?? o.value ?? '') }));
  optionCache.set(id, { at: Date.now(), list });
  return list;
}

// The list's id by its exact name, or null.
const listIds = new Map();
async function listId(name) {
  if (listIds.has(name)) return listIds.get(name);
  const found = await ac('/lists?limit=100&filters[name]=' + encodeURIComponent(name));
  const match = (found.lists || []).find((l) => l.name === name);
  if (!match) return null;
  listIds.set(name, match.id);
  return match.id;
}

// Subscribes the contact to the list directly (no confirmation email). 422 = already on it.
async function subscribeToList(contactId, name) {
  const id = await listId(name);
  if (!id) throw new Error('list not found: ' + name);
  try {
    await ac('/contactLists', { method: 'POST', body: JSON.stringify({ contactList: { list: String(id), contact: String(contactId), status: 1 } }) });
  } catch (err) {
    if (err.status !== 422) throw err;
  }
}

// Every contact that has the tag `name`: [{ id, email, firstName, lastName }]. Null if the tag doesn't exist in AC.
async function contactsWithTag(name) {
  const id = await tagId(name);
  if (!id) return null;
  const out = [];
  for (let offset = 0; offset < 100000; offset += 100) {
    const body = await ac(`/contacts?tagid=${encodeURIComponent(id)}&status=-1&limit=100&offset=${offset}`);
    const page = body.contacts || [];
    for (const c of page) out.push({ id: String(c.id), email: String(c.email || '').trim().toLowerCase(), firstName: c.firstName || '', lastName: c.lastName || '' });
    if (page.length < 100) break;
  }
  return out.filter((c) => c.email);
}

function resetCaches() {
  tagIds.clear();
  listIds.clear();
  optionCache.clear();
  fieldCache = null;
}

module.exports = { findContactByEmail, getContact, tagId, contactHasTags, contactsWithTag, addTag, removeTag, fieldId, findField, fieldOptions, syncContact, updateContactFields, subscribeToList, resetCaches };
