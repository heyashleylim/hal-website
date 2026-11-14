/*
 * Listening progress in the student area: where each student is in each episode, saved by the player every few
 * seconds (POST /learn/progress). An episode counts as listened ("다 들음") once the student reached 90% of it or the end.
 */
const db = require('../db.js');

const DONE_RATIO = 0.9;
const MAX_PLAYED_PER_SAVE = 120; // seconds; the player saves every 10 s, so more means a clock jump, not listening

// Pure: the new row from the old one and one save. Unit-tested.
function merge(old, { position, played = 0, ended = false, duration = null }, now = new Date()) {
  const pos = Math.max(0, Math.floor(Number(position) || 0));
  const furthest = Math.max(old ? old.furthest_seconds : 0, pos);
  const listened = (old ? old.listened_seconds : 0) + Math.min(MAX_PLAYED_PER_SAVE, Math.max(0, Math.round(Number(played) || 0)));
  const reached = ended || (duration > 0 && furthest >= duration * DONE_RATIO);
  return {
    position_seconds: ended ? 0 : pos,
    furthest_seconds: furthest,
    listened_seconds: listened,
    completed_at: (old && old.completed_at) || (reached ? now : null),
  };
}

async function save(studentId, episode, input, now = new Date()) {
  const old = await db.one('SELECT * FROM listening WHERE student_id = $1 AND episode_id = $2', [studentId, episode.id]);
  const row = merge(old, { ...input, duration: Number(episode.duration_seconds) || null }, now);
  await db.query(
    `INSERT INTO listening (student_id, episode_id, position_seconds, furthest_seconds, listened_seconds, completed_at, started_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
     ON CONFLICT (student_id, episode_id) DO UPDATE SET position_seconds = EXCLUDED.position_seconds,
       furthest_seconds = GREATEST(listening.furthest_seconds, EXCLUDED.furthest_seconds),
       listened_seconds = listening.listened_seconds + (EXCLUDED.listened_seconds - $8),
       completed_at = COALESCE(listening.completed_at, EXCLUDED.completed_at), updated_at = EXCLUDED.updated_at`,
    [studentId, episode.id, row.position_seconds, row.furthest_seconds, row.listened_seconds, row.completed_at, now, old ? old.listened_seconds : 0]);
  return row;
}

// Map(episode id → row) for one student.
async function forStudent(studentId) {
  const rows = await db.query('SELECT * FROM listening WHERE student_id = $1 ORDER BY updated_at DESC', [studentId]);
  return new Map(rows.map((r) => [r.episode_id, r]));
}

module.exports = { merge, save, forStudent, DONE_RATIO };
