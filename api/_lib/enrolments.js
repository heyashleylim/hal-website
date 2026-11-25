/*
 * Podcast enrolments that end because a purchase was refunded. Used by ActiveCampaign's revoke webhook
 * (api/podcast-ac.js, action=revoke) and by the shop when an order is fully refunded (api/_lib/shop/refunds.js).
 */
const db = require('./db.js');
const automation = require('./automation.js');

// Revokes the student `email`'s enrolments in the cohorts whose ActiveCampaign tag is one of `tagList`.
// → { result, studentId, revoked: [cohort names] }
async function revokeByTags(email, tagList) {
  const student = await db.one('SELECT id FROM students WHERE lower(email) = $1', [String(email || '').trim().toLowerCase()]);
  if (!student) return { result: 'not a student', studentId: null, revoked: [] };
  const wanted = [...new Set(tagList.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
  if (!wanted.length) return { result: 'nothing to revoke', studentId: student.id, revoked: [] };
  const rows = await db.query(
    `UPDATE enrollments en SET status = 'revoked', revoked_at = now(), updated_at = now()
       FROM cohorts c WHERE c.id = en.cohort_id AND en.student_id = $1 AND lower(c.ac_tag) = ANY($2::text[]) AND en.status <> 'revoked'
     RETURNING c.name, c.show_id`, [student.id, wanted]);
  for (const showId of new Set(rows.map((r) => r.show_id))) {
    const show = await db.one('SELECT * FROM shows WHERE id = $1', [showId]);
    await automation.onRevokedByWebhook(student.id, show);
  }
  if (rows.length) await automation.processOutbox({ budgetMs: 4000 });
  return { result: rows.length ? `revoked: ${rows.map((r) => r.name).join(', ')}` : 'nothing to revoke', studentId: student.id, revoked: rows.map((r) => r.name) };
}

module.exports = { revokeByTags };
