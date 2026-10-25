/*
 * ActiveCampaign API v3 client for the private podcast (contacts, tags, custom fields).
 * api/waitlist.js keeps its own small client for now.
 *
 *   AC_API_URL  e.g. https://youraccount.api-us1.com   (Settings → Developer)
 *   AC_API_KEY  never commit it
 *
 * Every call throws on failure (with the HTTP status) so the outbox can retry it later.
 */

const tagIds = new Map();   // lower(tag name) → id
let fieldIds = null;        // upper(perstag) → id

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

// Tag id by name; created when `create` is true and it doesn't exist yet. Null if missing.
async function tagId(name, { create = false } = {}) {
  const key = name.toLowerCase();
  if (tagIds.has(key)) return tagIds.get(key);
  const found = await ac('/tags?search=' + encodeURIComponent(name));
  let match = (found.tags || []).find((t) => t.tag.toLowerCase() === key);
  if (!match && create) {
    match = (await ac('/tags', { method: 'POST', body: JSON.stringify({ tag: { tag: name, tagType: 'contact', description: 'Private podcast (hal-website)' } }) })).tag;
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

async function addTag(contactId, name) {
  const id = await tagId(name, { create: true });
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

// Custom field id by personalization tag (e.g. PODCAST_NSMB_LINK, without the %).
async function fieldId(perstag) {
  if (!fieldIds) {
    fieldIds = new Map();
    for (let offset = 0; ; offset += 100) {
      const body = await ac(`/fields?limit=100&offset=${offset}`);
      for (const f of body.fields || []) fieldIds.set(String(f.perstag).toUpperCase(), f.id);
      if (!body.fields || body.fields.length < 100) break;
    }
  }
  const id = fieldIds.get(perstag.replace(/%/g, '').toUpperCase());
  if (!id) throw new Error(`AC custom field ${perstag} not found: create it in AC → Contacts → Fields`);
  return id;
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
  fieldIds = null;
}

module.exports = { findContactByEmail, tagId, contactHasTags, contactsWithTag, addTag, removeTag, fieldId, syncContact, resetCaches };
