// Personal bet tracker: users log their own bets; they grade themselves and get compared to the sharp close.
import { Router } from 'express';
import { impliedProbability, payout } from '../../shared/edge.js';
import { isBook } from '../../shared/books.js';
import { query } from '../db.js';
import { HttpError, requireEntitlement } from '../auth.js';

const router = Router();
const need = requireEntitlement('board');

const toBet = (r) => ({
  id: r.id, betId: r.bet_id, book: r.book, game: r.game_label, market: r.market, selection: r.selection,
  line: r.line, odds: r.odds, stake: Number(r.stake), result: r.result, notes: r.notes, placedAt: r.placed_at,
  kickoff: r.commence_time, closingFair: r.closing_fair,
  // Sharp CLV: how much better your price was than the fair price at kickoff.
  clv: r.closing_fair != null ? Number(r.closing_fair) - impliedProbability(r.odds) : null,
});

function summarize(list) {
  let w = 0, l = 0, p = 0, risked = 0, profit = 0;
  const clvs = [];
  for (const b of list) {
    if (b.clv != null) clvs.push(b.clv);
    if (b.result === 'W') { w++; risked += b.stake; profit += b.stake * payout(b.odds); }
    else if (b.result === 'L') { l++; risked += b.stake; profit -= b.stake; }
    else if (b.result === 'P') p++;
  }
  return {
    bets: list.length, wins: w, losses: l, pushes: p, pending: list.length - w - l - p,
    units: profit, roi: risked ? profit / risked : null, winRate: w + l ? w / (w + l) : null,
    avgClv: clvs.length ? clvs.reduce((s, v) => s + v, 0) / clvs.length : null, clvCount: clvs.length,
    beatClose: clvs.length ? clvs.filter((v) => v > 0).length / clvs.length : null,
  };
}

router.get('/my-bets', need, async (req, res) => {
  const { rows } = await query(
    `select ub.*, g.commence_time from user_bets ub left join games g on g.id = ub.game_id
      where ub.user_id = $1 order by ub.placed_at desc limit 500`, [req.user.id]);
  const bets = rows.map(toBet);
  res.json({ bets, summary: summarize(bets) });
});

/** Track a board line in one tap ({ betId, odds?, stake? }) or log a bet manually. */
router.post('/my-bets', need, async (req, res) => {
  const b = req.body ?? {};
  const stake = b.stake == null ? 1 : Number(b.stake);
  if (!(stake > 0 && stake <= 100000)) throw new HttpError(400, 'Stake must be a positive number');
  let row;
  if (b.betId) {
    const { rows: [src] } = await query(
      `select bt.*, g.label from bets bt join games g on g.id = bt.game_id where bt.id = $1 and bt.model = 'fair'`, [b.betId]);
    if (!src) throw new HttpError(404, 'That line is no longer available');
    const odds = b.odds != null ? Number(b.odds) : src.odds; // the price you actually got
    if (!Number.isInteger(odds) || Math.abs(odds) < 100) throw new HttpError(400, 'Odds must be American odds like -150 or +120');
    ({ rows: [row] } = await query(
      `insert into user_bets (user_id, bet_id, game_id, book, game_label, market, selection, line, odds, stake, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [req.user.id, src.id, src.game_id, src.venue, src.label, src.market, src.selection, src.line, odds, stake, b.notes ?? null]));
  } else {
    const odds = Number(b.odds);
    if (!Number.isInteger(odds) || Math.abs(odds) < 100) throw new HttpError(400, 'Odds must be American odds like -150 or +120');
    if (!['spread', 'total', 'prop'].includes(b.market)) throw new HttpError(400, 'Pick a market');
    if (!isBook(b.book)) throw new HttpError(400, 'Pick a sportsbook');
    if (!String(b.selection ?? '').trim()) throw new HttpError(400, 'Describe the bet');
    let game = null;
    if (b.gameId) ({ rows: [game] } = await query('select * from games where id = $1', [b.gameId]));
    ({ rows: [row] } = await query(
      `insert into user_bets (user_id, game_id, book, game_label, market, selection, line, odds, stake, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [req.user.id, game?.id ?? null, b.book, game?.label ?? String(b.game ?? 'Other').slice(0, 60), b.market,
        String(b.selection).trim().slice(0, 80), b.line === '' || b.line == null ? null : Number(b.line), odds, stake, b.notes ?? null]));
  }
  res.status(201).json({ bet: toBet(row) });
});

router.patch('/my-bets/:id', need, async (req, res) => {
  const { result, stake, notes } = req.body ?? {};
  if (result !== undefined && result !== null && !['W', 'L', 'P'].includes(result)) throw new HttpError(400, 'Result must be W, L, P or empty');
  const { rows: [row] } = await query(
    `update user_bets set result = case when $2::boolean then $3 else result end,
            graded_at = case when $2::boolean then now() else graded_at end,
            stake = coalesce($4, stake), notes = coalesce($5, notes)
      where id = $1 and user_id = $6 returning *`,
    [Number(req.params.id), result !== undefined, result ?? null, stake ?? null, notes ?? null, req.user.id]);
  if (!row) throw new HttpError(404, 'Bet not found');
  res.json({ bet: toBet(row) });
});

router.delete('/my-bets/:id', need, async (req, res) => {
  await query('delete from user_bets where id = $1 and user_id = $2', [Number(req.params.id), req.user.id]);
  res.status(204).end();
});

/** Line shopping: the same bet at every book, best price first, each compared to the fair price. */
router.get('/lines/:betId', need, async (req, res) => {
  const { rows: [src] } = await query('select game_id, market, selection, line from bets where id = $1', [Number(req.params.betId)]);
  if (!src) throw new HttpError(404, 'Line not found');
  const { rows } = await query(
    `select id, venue, odds, blended, edge, odds_updated_at from bets
      where game_id = $1 and model = 'fair' and market = $2 and selection = $3 and line is not distinct from $4
        and line_status = 'live'
      order by odds desc`,
    [src.game_id, src.market, src.selection, src.line]);
  res.json({
    lines: rows.map((r) => ({ id: r.id, book: r.venue, odds: r.odds, fair: r.blended, edge: r.edge, updatedAt: r.odds_updated_at })),
  });
});

export default router;
