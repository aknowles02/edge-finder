// Imports a bundled point-in-time backtest (scripts/backtest.js output) as kind='backtest' boards.
// Backtests are hypothetical: they never appear on the Edge Board or in the public record.
import { readFile } from 'node:fs/promises';
import { tx } from './db.js';

export async function importBacktest(season) {
  const file = new URL(`../data/backtest-${season}.json`, import.meta.url);
  const { rows, summary } = JSON.parse(await readFile(file, 'utf8'));
  const weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b);

  return tx(async (db) => {
    await db.query(`delete from boards where kind = 'backtest' and sport = 'nfl' and season = $1`, [season]);
    for (const week of weeks) {
      const list = rows.filter((r) => r.week === week);
      const { rows: [board] } = await db.query(
        `insert into boards (sport, kind, season, week, status, published_at, source, odds_min, odds_max)
         values ('nfl', 'backtest', $1, $2, 'published', now(), 'auto', -500, -200) returning id`,
        [season, week],
      );
      const games = [...new Map(list.map((r) => [r.game, r])).values()]
        .map((r) => ({ label: r.game, away: r.away, home: r.home, kickoff: r.kickoff }));
      await db.query(
        `insert into games (board_id, label, away, home, commence_time)
         select $1, x.label, x.away, x.home, x.kickoff::timestamptz
           from jsonb_to_recordset($2::jsonb) as x(label text, away text, home text, kickoff text)`,
        [board.id, JSON.stringify(games)],
      );
      await db.query(
        `insert into bets (board_id, game_id, venue, external_ref, external_side, market, selection, line, odds,
                           blended, implied, edge, sample_size, line_status, result, graded_at,
                           qualified_at, qualified_odds, qualified_prob, qualified_edge)
         select $1, g.id, 'kalshi', x.ref, x.side, x.market, x.selection, x.line, x.odds,
                x.prob, x.prob - x.edge, x.edge, x.sample, 'live', x.result, now(),
                x.kickoff::timestamptz - interval '1 hour', x.odds, x.prob, x.edge
           from jsonb_to_recordset($2::jsonb) as x(game text, market text, selection text, line numeric, odds int,
                prob numeric, edge numeric, sample int, ref text, side text, result text, kickoff text)
           join games g on g.board_id = $1 and g.label = x.game`,
        [board.id, JSON.stringify(list)],
      );
    }
    return { season, weeks: weeks.length, bets: rows.length, summary };
  });
}
