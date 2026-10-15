import crypto from 'node:crypto';
import { Router } from 'express';
import { HttpError } from '../auth.js';
import { runPipeline } from '../pipeline.js';

const router = Router();

// Vercel Cron and the GitHub Actions scheduler both send `Authorization: Bearer $CRON_SECRET`.
function requireCronSecret(req, _res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, 'CRON_SECRET is not set');
  const given = Buffer.from(req.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new HttpError(401, 'Bad cron credentials');
  next();
}

router.get('/cron/refresh-odds', requireCronSecret, async (_req, res) => {
  res.json((await runPipeline()) ?? { skipped: 'ran recently' });
});

export default router;
