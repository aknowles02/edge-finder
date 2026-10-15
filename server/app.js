import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { attachUser, sameOrigin } from './auth.js';
import authRoutes from './routes/auth.js';
import boardRoutes from './routes/boards.js';
import adminRoutes from './routes/admin.js';
import billingRoutes, { stripeWebhook } from './routes/billing.js';
import cronRoutes from './routes/cron.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet());

app.post('/api/billing/webhook', express.raw({ type: 'application/json', limit: '1mb' }), stripeWebhook);

app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());
app.use('/api', sameOrigin, attachUser);
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

app.get('/api/health', (_req, res) => res.json({ ok: true }));
// Public, throttled freshness kick — safe to point any free uptime pinger at it.
app.get('/api/tick', async (_req, res) => {
  const { freshen } = await import('./background.js');
  const { oddsStatus } = await import('./odds.js');
  await freshen({ waitMs: 25_000 });
  const s = await oddsStatus();
  res.set('Cache-Control', 'no-store').json({ ok: true, lastRunAt: s.lastRunAt, lastRunStatus: s.lastRunStatus, lastSuccessAt: s.lastSuccessAt, lastError: s.lastError });
});
app.use('/api', authRoutes, boardRoutes, billingRoutes, adminRoutes, cronRoutes);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl}]`, err);
  const message = err.expose || status < 500 ? err.message : 'Something went wrong. Please try again.';
  res.status(status).json({ error: message, ...(err.extra || {}) });
});

export default app;
