/*
 * Possible link sharing: signals from one student's last 7 days of podcast activity (pure, unit-tested).
 *
 * Input (from the events table, bots and app servers left out):
 *   networks          distinct networks that downloaded episodes (hashed IPs)
 *   countries         countries those downloads came from
 *   apps              podcast apps seen (downloads and feed checks from the phone)
 *   episode_networks  the most networks that downloaded the same episode
 *
 * Strict limits (Alex, 2026-11-12): one phone can still reach 3 networks a week (home Wi-Fi, mobile data, work) or
 * use two apps while subscribing, so each signal is a reason to look, not proof: the admin opens the student and
 * decides (Reset link or Revoke).
 */
const LIMITS = {
  networks: 2,          // more than 2 networks in 7 days
  countries: 1,         // more than 1 country in 7 days
  apps: 1,              // more than 1 podcast app in 7 days
  episodeNetworks: 1,   // one episode downloaded from more than 1 network in 7 days
  windowDays: 7,
};

function assess(stats = {}) {
  const n = (v) => Number(v) || 0;
  const list = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);
  const countries = list(stats.countries);
  const apps = list(stats.apps);
  const reasons = [];
  if (n(stats.networks) > LIMITS.networks) reasons.push(`${n(stats.networks)} networks in ${LIMITS.windowDays} days`);
  if (countries.length > LIMITS.countries) reasons.push(`${countries.length} countries (${countries.join(', ')})`);
  if (apps.length > LIMITS.apps) reasons.push(`${apps.length} podcast apps (${apps.join(', ')})`);
  if (n(stats.episode_networks) > LIMITS.episodeNetworks) reasons.push(`one episode downloaded from ${n(stats.episode_networks)} networks`);
  return { suspect: reasons.length > 0, reasons, score: reasons.length };
}

// Most suspicious first: more signals, then more networks.
function rank(a, b) {
  return b.sharing.score - a.sharing.score || (Number(b.networks) || 0) - (Number(a.networks) || 0);
}

module.exports = { LIMITS, assess, rank };
