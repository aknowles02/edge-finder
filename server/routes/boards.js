import { Router } from 'express';
import { summarizeTracked } from '../../shared/edge.js';
import { SPORTS } from '../../shared/sports.js';
import { can, canSport } from '../../shared/plans.js';
import { query } from '../db.js';
import { HttpError, requireEntitlement } from '../auth.js';
import { loadBoard, officialRecord, recordsByBoard, toBoard, trackedRows } from '../boards.js';
import { oddsStatus } from '../odds.js';

const router = Router();

const sportParam = (req) => {
  const s = String(req.query.sport || 'nfl').toLowerCase();
  if (!SPORTS[s]) throw new HttpError(400, 'Unknown sport');
  if (req.access && !canSport(req.access, s)) throw new HttpError(402, `${SPORTS[s].label} isn't included in your plan`);
  return s;
};

async function liveBoards(sport) {
  const { rows } = await query(
    `select bd.*, (select count(*)::int from bets b where b.board_id = bd.id and b.qualified_at is not null) as tracked_count
       from boards bd where status = 'published' and kind = 'live' and sport = $1
      order by season desc, week desc`,
    [sport],
  );
  return rows;
}

// Public: the real (non-backtest) track record powers the landing page.
router.get('/stats', async (_req, res) => {
  res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.json({ record: await officialRecord() });
});

router.get('/sports', (_req, res) => {
  res.json({ sports: Object.values(SPORTS).map((s) => ({ id: s.id, label: s.label })) });
});

router.get('/boards', requireEntitlement('board'), async (req, res) => {
  const sport = sportParam(req);
  const [boards, records] = await Promise.all([liveBoards(sport), recordsByBoard('live')]);
  const history = can(req.access, 'history');
  res.json({
    currentId: boards[0]?.id ?? null,
    boards: boards.map((b, i) => ({
      ...toBoard(b),
      trackedCount: b.tracked_count,
      locked: !history && i !== 0,
      record: records.get(String(b.id)) ?? null,
    })),
  });
});

async function sendBoard(req, res, row) {
  if (!row) throw new HttpError(404, 'No board published yet');
  const boards = await liveBoards(row.sport);
  const isCurrent = row.id === boards[0]?.id;
  if (!isCurrent && !can(req.access, 'history')) {
    throw new HttpError(402, 'Past boards are included with Edge Finder Pro', { entitlement: 'history' });
  }
  const [board, odds] = await Promise.all([loadBoard(row, { view: isCurrent ? 'current' : 'history' }), oddsStatus()]);
  res.set('Cache-Control', 'private, no-store');
  res.json({ board: { ...board, isCurrent }, odds });
}

router.get('/boards/current', requireEntitlement('board'), async (req, res) => {
  const sport = sportParam(req);
  const { rows } = await query(
    `select * from boards where status = 'published' and kind = 'live' and sport = $1 order by season desc, week desc limit 1`, [sport]);
  await sendBoard(req, res, rows[0]);
});

router.get('/boards/:season/:week', requireEntitlement('board'), async (req, res) => {
  const sport = sportParam(req);
  const season = Number(req.params.season);
  const week = Number(req.params.week);
  if (!Number.isInteger(season) || !Number.isInteger(week)) throw new HttpError(400, 'Bad season or week');
  const { rows } = await query(
    `select * from boards where status = 'published' and kind = 'live' and sport = $1 and season = $2 and week = $3`,
    [sport, season, week]);
  await sendBoard(req, res, rows[0]);
});

/** Tracked-opportunity reporting. Real results and backtests are computed and returned separately. */
router.get('/reports', requireEntitlement('reports'), async (_req, res) => {
  const build = async (kind) => {
    const rows = await trackedRows(kind);
    const byWeek = new Map();
    const byMarket = new Map();
    for (const r of rows) {
      const wk = `${r.sport}|${r.season}|${r.week}`;
      if (!byWeek.has(wk)) byWeek.set(wk, { sport: r.sport, season: r.season, week: r.week, rows: [] });
      byWeek.get(wk).rows.push(r);
      if (!byMarket.has(r.market)) byMarket.set(r.market, []);
      byMarket.get(r.market).push(r);
    }
    return {
      summary: summarizeTracked(rows),
      byWeek: [...byWeek.values()]
        .sort((a, b) => b.season - a.season || b.week - a.week)
        .map(({ rows: list, ...k }) => ({ ...k, ...summarizeTracked(list) })),
      byMarket: [...byMarket].map(([market, list]) => ({ market, ...summarizeTracked(list) })),
    };
  };
  const [live, backtest] = await Promise.all([build('live'), build('backtest')]);

  const { rows: recent } = await query(
    `select b.id, b.market, b.selection, b.line, b.qualified_at, b.qualified_odds, b.qualified_prob, b.qualified_edge,
            b.closing_odds, b.result, g.label as game, bd.season, bd.week, bd.sport
       from bets b join boards bd on bd.id = b.board_id join games g on g.id = b.game_id
      where bd.kind = 'live' and bd.status = 'published' and b.qualified_at is not null
      order by b.qualified_at desc limit 200`,
  );
  res.json({
    live,
    backtest,
    opportunities: recent.map((r) => ({
      id: r.id, game: r.game, market: r.market, selection: r.selection, line: r.line, sport: r.sport,
      season: r.season, week: r.week, qualifiedAt: r.qualified_at, qualifiedOdds: r.qualified_odds,
      qualifiedProb: r.qualified_prob, qualifiedEdge: r.qualified_edge, closingOdds: r.closing_odds, result: r.result,
    })),
  });
});

export default router;
