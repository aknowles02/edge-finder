// nflverse weekly player stats (public GitHub release). Only the columns we use are kept in memory.
import { parseDelimited } from '../shared/edge.js';
import { canonTeam } from '../shared/hitrates.js';
import { nameKey } from '../shared/props.js';

const url = (season) => `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${season}.csv`;
const KEEP = ['player_display_name', 'position', 'team', 'season', 'week', 'season_type', 'completions', 'attempts',
  'passing_yards', 'passing_tds', 'passing_interceptions', 'carries', 'rushing_yards', 'rushing_tds',
  'receptions', 'targets', 'receiving_yards', 'receiving_tds', 'special_teams_tds'];
const TTL_MS = 60 * 60 * 1000;
const cache = new Map();

export function parsePlayerStats(csv) {
  const [header, ...rows] = parseDelimited(csv);
  const ix = KEEP.map((k) => header.indexOf(k));
  return rows.map((r) => {
    const o = {};
    KEEP.forEach((k, i) => { o[k] = ix[i] === -1 ? null : r[ix[i]]; });
    o.season = Number(o.season);
    o.week = Number(o.week);
    o.team = canonTeam(o.team);
    o.key = nameKey(o.player_display_name);
    return o;
  });
}

/** Missing season files (e.g. before week 1) are treated as empty, not errors. */
export async function loadPlayerStats(season, { fresh = false } = {}) {
  const hit = cache.get(season);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const res = await fetch(url(season), { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`nflverse player stats ${season}: ${res.status}`);
  const rows = parsePlayerStats(await res.text());
  cache.set(season, { at: Date.now(), rows });
  return rows;
}

/** name key → rows, for one season (optionally only weeks before `beforeWeek`). */
export function indexByPlayer(rows, { beforeWeek } = {}) {
  const map = new Map();
  for (const r of rows) {
    if (r.season_type && r.season_type !== 'REG' && r.season_type !== 'POST') continue;
    if (beforeWeek && r.week >= beforeWeek) continue;
    if (!map.has(r.key)) map.set(r.key, []);
    map.get(r.key).push(r);
  }
  return map;
}
