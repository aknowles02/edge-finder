import { summarize, summarizeTracked } from '../shared/edge.js';
import { query } from './db.js';
import { refreshIntervalMs } from './odds.js';

export function toBoard(r) {
  return {
    id: r.id, sport: r.sport, kind: r.kind, season: r.season, week: r.week, status: r.status,
    oddsMin: r.odds_min, oddsMax: r.odds_max,
    publishedAt: r.published_at, alertedAt: r.alerted_at,
  };
}

/** A price is stale when it hasn't been confirmed recently: 20 min for Kalshi, 2× the cadence for DraftKings. */
function staleness(row, now = Date.now()) {
  if (row.line_status === 'manual') return { tracked: false, stale: false };
  const start = row.commence_time ? new Date(row.commence_time).getTime() : null;
  if (start && start <= now) return { tracked: true, stale: false, started: true };
  const checked = row.odds_updated_at ? new Date(row.odds_updated_at).getTime() : 0;
  const limit = row.venue === 'kalshi' ? 20 * 60 * 1000 : 2 * refreshIntervalMs(start, now) + 5 * 60 * 1000;
  return { tracked: true, stale: now - checked > limit };
}

function toBet(r) {
  const s = staleness(r);
  return {
    id: r.id, gameId: r.game_id, game: r.game_label, away: r.away, home: r.home,
    commenceTime: r.commence_time, started: Boolean(s.started),
    market: r.market, selection: r.selection, line: r.line, odds: r.odds,
    hit2025: r.hit_2025, n2025: r.n_2025, hit2026: r.hit_2026, n2026: r.n_2026,
    blended: r.blended, implied: r.implied, edge: r.edge, sampleSize: r.sample_size,
    oddsUpdatedAt: r.odds_updated_at ?? r.created_at, lineMovedAt: r.line_moved_at,
    lineStatus: r.line_status, liveTracked: s.tracked, stale: s.stale, venue: r.venue, flags: r.flags,
    qualifiedAt: r.qualified_at, qualifiedOdds: r.qualified_odds, qualifiedProb: r.qualified_prob, qualifiedEdge: r.qualified_edge,
    closingOdds: r.closing_odds, result: r.result,
  };
}

const BET_SELECT = `
  select b.*, g.label as game_label, g.away, g.home, g.commence_time, g.external_event_id, g.odds_checked_at, g.flags
    from bets b join games g on g.id = b.game_id`;

/**
 * `current`: the live slate — bets with positive edge right now.
 * `history`: every bet that ever qualified, graded at its locked price.
 */
export async function loadBoard(boardRow, { view = 'current' } = {}) {
  const filter = view === 'all' ? 'true' : view === 'history' ? 'b.qualified_at is not null' : 'b.edge > 0';
  const [{ rows: bets }, { rows: games }] = await Promise.all([
    query(`${BET_SELECT} where b.board_id = $1 and ${filter} order by b.edge desc`, [boardRow.id]),
    query('select * from games where board_id = $1 order by commence_time nulls last, id', [boardRow.id]),
  ]);
  return {
    ...toBoard(boardRow),
    view,
    games: games.map((g) => ({
      id: g.id, label: g.label, away: g.away, home: g.home, commenceTime: g.commence_time,
      awayScore: g.away_score, homeScore: g.home_score, liveTracked: Boolean(g.external_event_id), oddsCheckedAt: g.odds_checked_at, flags: g.flags,
    })),
    bets: bets.map(toBet),
  };
}

/** Snapshot every bet that newly meets the bar (edge > 0, inside the board's odds window). */
export async function qualifyBets(db, boardId) {
  const { rowCount } = await db.query(
    `update bets b set qualified_at = now(), qualified_odds = b.odds, qualified_prob = b.blended, qualified_edge = b.edge
       from boards bd
      where bd.id = b.board_id and bd.id = $1 and bd.status = 'published' and b.qualified_at is null
        and b.edge > 0 and b.odds between bd.odds_min and bd.odds_max`,
    [boardId],
  );
  return rowCount;
}

async function trackedRows(kind, { boardId } = {}) {
  const { rows } = await query(
    `select b.qualified_odds, b.odds, b.result, b.closing_odds, b.market, bd.id as board_id, bd.week, bd.season, bd.sport
       from bets b join boards bd on bd.id = b.board_id
      where bd.status = 'published' and bd.kind = $1 and b.qualified_at is not null
        and ($2::bigint is null or bd.id = $2)`,
    [kind, boardId ?? null],
  );
  return rows.map((r) => ({ ...r, qualifiedOdds: r.qualified_odds, closingOdds: r.closing_odds }));
}

/** Official (real, not backtest) record, graded at locked prices. Public on the landing page. */
export async function officialRecord() {
  return summarizeTracked(await trackedRows('live'));
}

export async function recordsByBoard(kind = 'live') {
  const grouped = new Map();
  for (const r of await trackedRows(kind)) {
    const k = String(r.board_id);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(r);
  }
  return new Map([...grouped].map(([id, list]) => [id, summarize(list.map((r) => ({ odds: r.qualifiedOdds, result: r.result })))]));
}

export { trackedRows };
