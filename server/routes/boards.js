import { Router } from 'express';
import { query } from '../db.js';
import { HttpError, isPremium, requireUser } from '../auth.js';
import { loadBoard, officialRecord, recordsByBoard, toBoard } from '../boards.js';

const router = Router();

async function publishedBoards() {
  const { rows } = await query(
    `select bd.*, (select count(*)::int from bets b where b.board_id = bd.id and b.edge > 0) as bet_count
       from boards bd where status = 'published'
      order by season desc, week desc`,
  );
  return rows;
}

// Public: the season track record powers the landing page.
router.get('/stats', async (_req, res) => {
  res.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.json({ record: await officialRecord() });
});

router.get('/boards', requireUser, async (req, res) => {
  const [boards, records] = await Promise.all([publishedBoards(), recordsByBoard()]);
  const premium = isPremium(req.user);
  const currentId = boards[0]?.id;
  res.json({
    currentId,
    boards: boards.map((b) => ({
      ...toBoard(b),
      betCount: b.bet_count,
      locked: !premium && b.id !== currentId,
      record: records.get(String(b.id)) ?? null,
    })),
  });
});

async function sendBoard(req, res, row) {
  if (!row) throw new HttpError(404, 'No board published yet');
  const boards = await publishedBoards();
  if (!isPremium(req.user) && row.id !== boards[0]?.id) {
    throw new HttpError(402, 'Past weeks are a Premium feature', { season: row.season, week: row.week });
  }
  res.set('Cache-Control', 'private, no-store');
  res.json({ board: await loadBoard(row) });
}

router.get('/boards/current', requireUser, async (req, res) => {
  const { rows } = await query(`select * from boards where status = 'published' order by season desc, week desc limit 1`);
  await sendBoard(req, res, rows[0]);
});

router.get('/boards/:season/:week', requireUser, async (req, res) => {
  const season = Number(req.params.season);
  const week = Number(req.params.week);
  if (!Number.isInteger(season) || !Number.isInteger(week)) throw new HttpError(400, 'Bad season or week');
  const { rows } = await query(`select * from boards where status = 'published' and season = $1 and week = $2`, [season, week]);
  await sendBoard(req, res, rows[0]);
});

export default router;
