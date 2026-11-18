/*
 * Gives every NSMB waitlist contact a personal link code in %WL_LINK_CODE%, so an AC email can link to
 * https://www.ashleylim.com/nsmb/waitlist?c=%WL_LINK_CODE%&src=reconfirm (she lands straight on Q1, greeted by name).
 * New sign-ups get their code automatically (api/waitlist.js); run this once for the people already on the list.
 *
 *   node --env-file=.env.local tools/waitlist/link-codes.js            # dry run: counts, writes nothing
 *   node --env-file=.env.local tools/waitlist/link-codes.js --write    # writes the codes
 *   … --tag some_other_tag                                             # default: AC_TAG or signup_waitlist_nsmb
 *
 * Needs AC_API_URL, AC_API_KEY and WAITLIST_SECRET — the SAME secret as in Vercel Production, or the links won't open.
 * Safe to run again: contacts whose field already holds the right code are skipped.
 */

const ac = require('../../api/_lib/ac.js');
const wl = require('../../api/_lib/waitlist.js');

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const tagArg = args.indexOf('--tag');
  const tag = tagArg >= 0 ? args[tagArg + 1] : wl.TAGS.signup;
  for (const v of ['AC_API_URL', 'AC_API_KEY', 'WAITLIST_SECRET']) {
    if (!process.env[v]) throw new Error(`${v} is not set (put it in .env.local)`);
  }

  const contacts = await ac.contactsWithTag(tag);
  if (!contacts) throw new Error(`tag "${tag}" not found in ActiveCampaign`);
  const field = await ac.findField(wl.FIELDS.code);
  console.log(`${contacts.length} contacts tagged ${tag}. Field: %${field.perstag}%. ${write ? 'Writing.' : 'Dry run (add --write to save).'}`);

  let written = 0, skipped = 0, failed = 0;
  for (const c of contacts) {
    const code = wl.linkCode(c.id);
    try {
      const current = await currentValue(c.id, field.id);
      if (current === code) { skipped++; continue; }
      if (write) await ac.updateContactFields(c.id, { [wl.FIELDS.code]: code });
      written++;
    } catch (err) {
      failed++;
      console.error(`  contact ${c.id}: ${err.message}`);
    }
    if ((written + skipped + failed) % 50 === 0) console.log(`  … ${written + skipped + failed}/${contacts.length}`);
    await new Promise((r) => setTimeout(r, 120)); // stay under AC's 5 requests/second
  }
  console.log(`${write ? 'Written' : 'Would write'}: ${written} · already right: ${skipped} · failed: ${failed}`);
  if (failed) process.exitCode = 1;
}

async function currentValue(contactId, fieldId) {
  const res = await fetch(`${process.env.AC_API_URL.trim().replace(/\/$/, '')}/api/3/contacts/${contactId}/fieldValues`, {
    headers: { 'Api-Token': process.env.AC_API_KEY.trim(), Accept: 'application/json' },
  });
  if (!res.ok) throw new Error('fieldValues ' + res.status);
  const body = await res.json();
  const hit = (body.fieldValues || []).find((fv) => String(fv.field) === String(fieldId));
  return hit ? String(hit.value || '') : '';
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
