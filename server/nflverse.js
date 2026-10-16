// nflverse schedule + results (public CSV on GitHub). Cached per serverless instance.
import { parseDelimited } from '../shared/edge.js';
import { canonTeam } from '../shared/hitrates.js';

const GAMES_URL = 'https://github.com/nflverse/nfldata/raw/master/data/games.csv';
const TTL_MS = 20 * 60 * 1000;
let cache = null;

/** "2026-10-18" + "13:00" (US Eastern) → ISO UTC string. */
export function easternToUtc(day, time) {
  if (!day) return null;
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = (time || '13:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  // Find New York's UTC offset at that moment (handles DST).
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(guess)).reduce((o, p) => ({ ...o, [p.type]: p.value }), {});
  const asNy = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return new Date(guess + (guess - asNy)).toISOString();
}

export function parseGames(csv) {
  const [header, ...rows] = parseDelimited(csv);
  const ix = Object.fromEntries(header.map((h, i) => [h, i]));
  const num = (v) => (v === '' || v == null || v === 'NA' ? null : Number(v));
  return rows.map((r) => ({
    id: r[ix.game_id],
    season: Number(r[ix.season]),
    type: r[ix.game_type],
    week: Number(r[ix.week]),
    gameday: r[ix.gameday],
    kickoff: easternToUtc(r[ix.gameday], r[ix.gametime]),
    away: canonTeam(r[ix.away_team]),
    home: canonTeam(r[ix.home_team]),
    awayScore: num(r[ix.away_score]),
    homeScore: num(r[ix.home_score]),
    spreadLine: num(r[ix.spread_line]), // closing expected home margin
    totalLine: num(r[ix.total_line]),
    awayQb: r[ix.away_qb_name] || null,
    homeQb: r[ix.home_qb_name] || null,
  }));
}

export async function loadGames({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.games;
  const res = await fetch(GAMES_URL, { signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`nflverse games.csv ${res.status}`);
  const games = parseGames(await res.text());
  cache = { at: Date.now(), games };
  return games;
}

/** The regular-season week to build: the earliest week of `season` that still has unplayed games. */
export function currentWeek(games, season) {
  const open = games.filter((g) => g.season === season && g.type === 'REG' && g.awayScore == null);
  return open.length ? Math.min(...open.map((g) => g.week)) : null;
}
