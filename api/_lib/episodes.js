/*
 * Episode types (Alex, 2026-11-15) and their labels. A week number can be shared by several episodes
 * (e.g. Week 2, its Q&A and its live session). Only "week" episodes drive the ActiveCampaign week tags
 * (<prefix>_epNN_released / _downloaded / _completed), as modules did before.
 */
const KINDS = ['week', 'qa', 'live', 'bonus'];
const ADMIN = { week: 'Week', qa: 'Q&A', live: 'Live', bonus: 'Bonus' };
const STUDENT = { week: 'Week', qa: 'Q&A', live: '라이브', bonus: '보너스' };

const kindOf = (value) => (KINDS.includes(value) ? value : value === 'module' ? 'week' : 'week');

// "Week 2", "Week 2 · Q&A", "Q&A", "Bonus"
function label(episode, names = ADMIN) {
  const kind = kindOf(episode.kind);
  const n = episode.number ? `Week ${episode.number}` : '';
  if (kind === 'week') return n || names.week;
  return n ? `${n} · ${names[kind]}` : names[kind];
}

const studentLabel = (episode) => label(episode, STUDENT);

module.exports = { KINDS, ADMIN, kindOf, label, studentLabel };
