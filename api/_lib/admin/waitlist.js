/*
 * Admin API, NSMB waitlist: gives the people already on the waitlist their personal link code (%WL_LINK_CODE%),
 * from a button on /admin, so nobody has to run a script. Same work as tools/waitlist/link-codes.js.
 *
 * Works in batches (the button calls it again with the next `offset` until `next` is null), so a long list never
 * hits the function time limit. Safe to run again: the code is the same each time.
 */
const ac = require('../ac.js');
const wl = require('../waitlist.js');
const { int } = require('./util.js');

const BATCH = 80;

const actions = {
  // Is the waitlist configured? Names of missing env vars only.
  async 'waitlist-status'() {
    const missing = ['WAITLIST_SECRET', 'WAITLIST_MANYCHAT_KEY', 'AC_API_URL', 'AC_API_KEY'].filter((n) => !String(process.env[n] || '').trim());
    return { missingEnv: missing, doubleOptIn: wl.doubleOptInConfigured(), tag: wl.TAGS.signup };
  },

  // One batch of link codes for everyone tagged signup_waitlist_nsmb. ← { total, done, next }
  async 'waitlist-link-codes'(input) {
    if (String(process.env.WAITLIST_SECRET || '').trim().length < 16) {
      const err = new Error('WAITLIST_SECRET is missing in Vercel: add it first, then redeploy.');
      err.status = 409; err.expose = true; throw err;
    }
    const offset = int(input.offset || 0, { min: 0, max: 1000000, label: 'offset' });
    const contacts = await ac.contactsWithTag(wl.TAGS.signup);
    if (!contacts) {
      const err = new Error(`The tag ${wl.TAGS.signup} doesn't exist in ActiveCampaign.`);
      err.status = 404; err.expose = true; throw err;
    }
    contacts.sort((a, b) => Number(a.id) - Number(b.id));
    const slice = contacts.slice(offset, offset + BATCH);
    let failed = 0;
    for (const c of slice) {
      try {
        await ac.updateContactFields(c.id, { [wl.FIELDS.code]: wl.linkCode(c.id) });
      } catch (err) {
        failed++;
        console.error('waitlist-link-codes', c.id, err.message);
      }
      await new Promise((r) => setTimeout(r, 150)); // stay under AC's 5 requests/second
    }
    const done = offset + slice.length;
    const next = done < contacts.length ? done : null;
    // Log once, at the end of the run.
    return { total: contacts.length, done, failed, next, log: next === null ? { total: contacts.length } : null, target: 'waitlist link codes' };
  },
};

module.exports = { section: 'waitlist', actions, writes: ['waitlist-link-codes'] };
