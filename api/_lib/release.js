/*
 * Release and access rules for the private podcast. Pure functions, no database: unit-tested in
 * tests/podcast/release.test.js.
 *
 * - An episode is released for a student at: the cohort's override date for that episode, if any;
 *   otherwise (the student's own start date, or else the cohort start) + episode.day_offset days,
 *   at show.release_time in show.timezone. A student with their own start date ignores cohort overrides.
 * - Access ends at: listener.expires_override, or else cohort start + access days (cohort, or else show)
 *   at 00:00 in show.timezone (decision D4: counted from the cohort start).
 * - Late joiners need nothing special: everything already released for their cohort is visible at once (D5).
 */

// 'YYYY-MM-DD' from a string or a Date (the pg driver parses DATE columns as local midnight).
function ymd(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}/.test(value)) throw new Error('bad date: ' + value);
    return value.slice(0, 10);
  }
  const d = value;
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
}

function addDays(day, n) {
  const [y, m, d] = ymd(day).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Offset (ms) of `timeZone` from UTC at instant `date`.
function tzOffset(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The instant when the wall clock in `timeZone` shows `day` at `hhmm`.
function zonedTime(day, hhmm, timeZone) {
  const [y, m, d] = ymd(day).split('-').map(Number);
  const [h, mi] = String(hhmm || '00:00').split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  let t = wall - tzOffset(new Date(wall), timeZone);
  t = wall - tzOffset(new Date(t), timeZone); // second pass settles DST edges
  return new Date(t);
}

function startDay(listener, cohort) {
  if (listener && listener.start_override) return ymd(listener.start_override);
  return cohort ? ymd(cohort.start_date) : null;
}

// When `episode` becomes available to this student, or null (draft, or no cohort/start).
function releaseAt({ show, cohort, listener, episode, override }) {
  if (episode.status !== 'published') return null;
  const ownSchedule = Boolean(listener && listener.start_override);
  if (override && !ownSchedule) return new Date(override);
  const start = startDay(listener, cohort);
  if (!start) return null;
  return zonedTime(addDays(start, episode.day_offset || 0), show.release_time, show.timezone);
}

function expiresAt({ show, cohort, listener }) {
  if (listener && listener.expires_override) return new Date(listener.expires_override);
  if (!cohort) return null;
  const days = cohort.access_days || show.access_days;
  return zonedTime(addDays(cohort.start_date, days), '00:00', show.timezone);
}

// 'active' | 'revoked' | 'no-cohort' | 'expired'
function accessState({ show, cohort, listener, now = new Date() }) {
  if (listener.status === 'revoked') return 'revoked';
  if (!cohort && !listener.start_override) return 'no-cohort';
  const end = expiresAt({ show, cohort, listener });
  if (end && now >= end) return 'expired';
  return 'active';
}

// Every episode with its release date for this student, oldest first. overrides: Map(episodeId → Date).
function schedule({ show, cohort, listener, episodes, overrides = new Map() }) {
  return episodes
    .map((episode) => ({ episode, releaseAt: releaseAt({ show, cohort, listener, episode, override: overrides.get(episode.id) }) }))
    .filter((e) => e.releaseAt)
    .sort((a, b) => a.releaseAt - b.releaseAt || (a.episode.number || 0) - (b.episode.number || 0) || a.episode.id - b.episode.id);
}

// Episodes the student can get right now (empty when access isn't active), plus the next drop.
function released({ show, cohort, listener, episodes, overrides, now = new Date() }) {
  const state = accessState({ show, cohort, listener, now });
  const all = schedule({ show, cohort, listener, episodes, overrides });
  if (state !== 'active') return { state, episodes: [], next: null };
  return {
    state,
    episodes: all.filter((e) => e.releaseAt <= now),
    next: all.find((e) => e.releaseAt > now) || null,
  };
}

module.exports = { ymd, addDays, zonedTime, releaseAt, expiresAt, accessState, schedule, released };
