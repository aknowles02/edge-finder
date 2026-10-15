import { summarize } from '../shared/edge.js';
import { query } from './db.js';

export function toBoard(r) {
  return {
    id: r.id, season: r.season, week: r.week, status: r.status,
    oddsMin: r.odds_min, oddsMax: r.odds_max,
    publishedAt: r.published_at, alertedAt: r.alerted_at,
  };
}

function toBet(r) {
  return {
    id: r.id, gameId: r.game_id, game: r.game_label, away: r.away, home: r.home,
    market: r.market, selection: r.selection, line: r.line, odds: r.odds,
    hit2025: r.hit_2025, n2025: r.n_2025, hit2026: r.hit_2026, n2026: r.n_2026,
    blended: r.blended, implied: r.implied, edge: r.edge, sampleSize: r.sample_size,
    result: r.result,
  };
}

export async function loadBoard(boardRow) {
  const [{ rows: bets }, { rows: games }] = await Promise.all([
    query(
      `select b.*, g.label as game_label, g.away, g.home
         from bets b join games g on g.id = b.game_id
        where b.board_id = $1 and b.edge > 0
        order by b.edge desc`,
      [boardRow.id],
    ),
    query('select * from games where board_id = $1 order by id', [boardRow.id]),
  ]);
  return {
    ...toBoard(boardRow),
    games: games.map((g) => ({
      id: g.id, label: g.label, away: g.away, home: g.home,
      awayScore: g.away_score, homeScore: g.home_score,
    })),
    bets: bets.map(toBet),
  };
}

/** Official record: positive-edge bets inside each board's own odds window. */
export async function officialRecord({ boardId } = {}) {
  const { rows } = await query(
    `select b.odds, b.result, bd.id as board_id
       from bets b join boards bd on bd.id = b.board_id
      where bd.status = 'published' and b.edge > 0
        and b.odds between bd.odds_min and bd.odds_max
        and ($1::bigint is null or bd.id = $1)`,
    [boardId ?? null],
  );
  return summarize(rows);
}

export async function recordsByBoard() {
  const { rows } = await query(
    `select b.odds, b.result, bd.id as board_id
       from bets b join boards bd on bd.id = b.board_id
      where bd.status = 'published' and b.edge > 0
        and b.odds between bd.odds_min and bd.odds_max`,
  );
  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.board_id)) grouped.set(r.board_id, []);
    grouped.get(r.board_id).push(r);
  }
  return new Map([...grouped].map(([id, list]) => [String(id), summarize(list)]));
}
