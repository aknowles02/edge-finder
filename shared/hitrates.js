// Historical hit rates from completed games — the "est. prob" behind every automated board.
// Pure functions (no I/O) so they're easy to test and reuse.

/** Normalize team codes across feeds (nflverse uses LA/JAX, Kalshi uses LAR/JAC). */
const ALIASES = { LA: 'LAR', JAC: 'JAX', WSH: 'WAS', LVR: 'LV', OAK: 'LV', SD: 'LAC', STL: 'LAR', GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB' };
export const canonTeam = (code) => {
  const c = String(code).trim().toUpperCase();
  return ALIASES[c] ?? c;
};

/** Per-team game logs for one season: margin (team − opponent) and combined total. */
export function teamLogs(games, season, { before } = {}) {
  const logs = new Map();
  const add = (team, entry) => {
    if (!logs.has(team)) logs.set(team, []);
    logs.get(team).push(entry);
  };
  for (const g of games) {
    if (g.season !== season || g.awayScore == null || g.homeScore == null) continue;
    if (before && g.gameday >= before) continue;
    const total = g.awayScore + g.homeScore;
    add(g.away, { margin: g.awayScore - g.homeScore, total, week: g.week, qb: g.awayQb });
    add(g.home, { margin: g.homeScore - g.awayScore, total, week: g.week, qb: g.homeQb });
  }
  return logs;
}

/**
 * Bet: `team` with spread `line` (team covers when margin + line > 0).
 * Pools both teams' logs: the team covering that number, plus the opponent failing to cover the mirror.
 */
export function spreadHitRate(logs, team, opponent, line) {
  const t = logs.get(team) ?? [];
  const o = logs.get(opponent) ?? [];
  const hits = t.filter((g) => g.margin + line > 0).length + o.filter((g) => g.margin - line < 0).length;
  const n = t.length + o.length;
  return n ? { rate: hits / n, n } : { rate: null, n: 0 };
}

/** Totals: pool both teams' games and count how often the combined score cleared the line. */
export function totalHitRate(logs, teamA, teamB, line, side) {
  const all = [...(logs.get(teamA) ?? []), ...(logs.get(teamB) ?? [])];
  const hits = all.filter((g) => (side === 'Over' ? g.total > line : g.total < line)).length;
  return all.length ? { rate: hits / all.length, n: all.length } : { rate: null, n: 0 };
}

/**
 * Flag a likely starting-QB change: the most recent starter isn't the one who started most of the season.
 * The model assumes the same QB, so these games deserve a warning.
 */
export function qbChangeFlag(logs, team) {
  const games = [...(logs.get(team) ?? [])].sort((a, b) => a.week - b.week);
  if (games.length < 2) return null;
  const counts = new Map();
  for (const g of games) if (g.qb) counts.set(g.qb, (counts.get(g.qb) ?? 0) + 1);
  const [usual] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  const latest = games.at(-1).qb;
  return latest && usual && latest !== usual ? `${team} QB change: ${latest} (usual: ${usual})` : null;
}
