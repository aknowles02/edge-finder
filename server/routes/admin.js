import { Router } from 'express';
import { gradeBet, parseBoardInput } from '../../shared/edge.js';
import { config } from '../config.js';
import { query, tx } from '../db.js';
import { HttpError, requireAdmin } from '../auth.js';
import { loadBoard, toBoard } from '../boards.js';
import { sendBoardAlert } from '../email.js';

const router = Router();
router.use('/admin', requireAdmin);

const int = (v, name, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Invalid ${name}`);
  return n;
};

async function boardById(id) {
  const { rows } = await query('select * from boards where id = $1', [int(id, 'board id')]);
  if (!rows[0]) throw new HttpError(404, 'Board not found');
  return rows[0];
}

router.get('/admin/boards', async (_req, res) => {
  const { rows } = await query(
    `select bd.*,
            count(b.*) filter (where b.edge > 0)::int as bet_count,
            count(b.*) filter (where b.edge > 0 and b.result is null)::int as ungraded
       from boards bd left join bets b on b.board_id = bd.id
      group by bd.id order by season desc, week desc`,
  );
  res.json({ boards: rows.map((r) => ({ ...toBoard(r), betCount: r.bet_count, ungraded: r.ungraded })) });
});

router.get('/admin/boards/:id', async (req, res) => {
  res.json({ board: await loadBoard(await boardById(req.params.id)) });
});

/** Paste odds for a week. Creates the board (as draft) or replaces/appends its bets. */
router.post('/admin/boards', async (req, res) => {
  const season = int(req.body?.season, 'season', { min: 2020, max: 2100 });
  const week = int(req.body?.week, 'week', { min: 1, max: 22 });
  const oddsMin = int(req.body?.oddsMin ?? -500, 'min odds', { min: -100000, max: 100000 });
  const oddsMax = int(req.body?.oddsMax ?? -200, 'max odds', { min: -100000, max: 100000 });
  if (oddsMin > oddsMax) throw new HttpError(400, 'Min odds must be ≤ max odds (e.g. −500 to −200)');
  const mode = req.body?.mode === 'append' ? 'append' : 'replace';

  const { rows, errors } = parseBoardInput(String(req.body?.csv ?? ''));
  if (errors.length) throw new HttpError(400, `Fix ${errors.length} row(s) and re-paste`, { errors });
  const positive = rows.filter((r) => r.edge > 0);

  const boardId = await tx(async (db) => {
    const { rows: [board] } = await db.query(
      `insert into boards (season, week, odds_min, odds_max) values ($1, $2, $3, $4)
       on conflict (season, week) do update set odds_min = excluded.odds_min, odds_max = excluded.odds_max
       returning id`,
      [season, week, oddsMin, oddsMax],
    );
    if (mode === 'replace') await db.query('delete from bets where board_id = $1', [board.id]);

    const gameIds = new Map();
    for (const r of positive) {
      if (gameIds.has(r.game)) continue;
      const { rows: [g] } = await db.query(
        `insert into games (board_id, label, away, home) values ($1, $2, $3, $4)
         on conflict (board_id, label) do update set away = excluded.away
         returning id`,
        [board.id, r.game, r.away, r.home],
      );
      gameIds.set(r.game, g.id);
    }
    for (const r of positive) {
      await db.query(
        `insert into bets (board_id, game_id, market, selection, line, odds, hit_2025, n_2025, hit_2026, n_2026,
                           blended, implied, edge, sample_size)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [board.id, gameIds.get(r.game), r.market, r.selection, r.line, r.odds, r.hit2025, r.n2025,
          r.hit2026, r.n2026, r.blended, r.implied, r.edge, r.sampleSize],
      );
    }
    if (mode === 'replace') {
      await db.query('delete from games g where board_id = $1 and not exists (select 1 from bets b where b.game_id = g.id)', [board.id]);
    }
    return board.id;
  });

  res.status(201).json({ boardId, parsed: rows.length, inserted: positive.length, skippedNonPositive: rows.length - positive.length });
});

router.post('/admin/boards/:id/publish', async (req, res) => {
  const board = await boardById(req.params.id);
  const { rows: [updated] } = await query(
    `update boards set status = 'published', published_at = coalesce(published_at, now()) where id = $1 returning *`,
    [board.id],
  );

  let alerted = 0;
  if (req.body?.notify && !updated.alerted_at) {
    const { rows: recipients } = await query(
      `select email from users
        where alerts_opt_in and subscription_status in ('active', 'trialing')
          and (current_period_end is null or current_period_end > now())`,
    );
    const { rows: [{ count }] } = await query('select count(*)::int as count from bets where board_id = $1 and edge > 0', [board.id]);
    await sendBoardAlert(recipients.map((r) => r.email), {
      season: updated.season, week: updated.week, count,
      url: `${config.appUrl()}/board/${updated.season}/${updated.week}`,
    });
    await query('update boards set alerted_at = now() where id = $1', [board.id]);
    alerted = recipients.length;
  }
  res.json({ board: toBoard(updated), alerted });
});

router.post('/admin/boards/:id/unpublish', async (req, res) => {
  const { rows: [b] } = await query(`update boards set status = 'draft' where id = $1 returning *`, [int(req.params.id, 'board id')]);
  if (!b) throw new HttpError(404, 'Board not found');
  res.json({ board: toBoard(b) });
});

router.delete('/admin/boards/:id', async (req, res) => {
  await query('delete from boards where id = $1', [int(req.params.id, 'board id')]);
  res.status(204).end();
});

/** Enter final scores; spreads and totals on those games grade themselves. */
router.post('/admin/boards/:id/scores', async (req, res) => {
  const board = await boardById(req.params.id);
  const scores = Array.isArray(req.body?.games) ? req.body.games : [];
  let graded = 0;
  await tx(async (db) => {
    for (const s of scores) {
      const clear = s.awayScore === '' || s.awayScore == null || s.homeScore === '' || s.homeScore == null;
      const away = clear ? null : int(s.awayScore, 'score', { min: 0, max: 200 });
      const home = clear ? null : int(s.homeScore, 'score', { min: 0, max: 200 });
      const { rows: [game] } = await db.query(
        `update games set away_score = $1, home_score = $2 where id = $3 and board_id = $4 returning *`,
        [away, home, int(s.id, 'game id'), board.id],
      );
      if (!game) continue;
      const { rows: bets } = await db.query(`select * from bets where game_id = $1 and market <> 'prop'`, [game.id]);
      for (const b of bets) {
        const result = gradeBet(b, { away: game.away, home: game.home, awayScore: away, homeScore: home });
        await db.query('update bets set result = $1, graded_at = case when $1::char is null then null else now() end where id = $2', [result, b.id]);
        if (result) graded++;
      }
    }
  });
  res.json({ graded, board: await loadBoard(board) });
});

/** Manual grade / override — used for props. */
router.patch('/admin/bets/:id', async (req, res) => {
  const result = req.body?.result ?? null;
  if (result !== null && !['W', 'L', 'P'].includes(result)) throw new HttpError(400, 'Result must be W, L, P or null');
  const { rowCount } = await query(
    `update bets set result = $1, graded_at = case when $1::char is null then null else now() end where id = $2`,
    [result, int(req.params.id, 'bet id')],
  );
  if (!rowCount) throw new HttpError(404, 'Bet not found');
  res.json({ ok: true });
});

export default router;
