import crypto from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError, clearSession, issueSession, publicUser, requireUser } from '../auth.js';
import { sendMagicLink } from '../email.js';
import { track } from '../funnel.js';
import { isBook } from '../../shared/books.js';

const router = Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const TOKEN_TTL_MIN = 15;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in a few minutes.' },
});

router.post('/auth/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, 'Enter a valid email address');

  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `insert into login_tokens (token_hash, email, expires_at) values ($1, $2, now() + make_interval(mins => $3))`,
    [sha256(token), email, TOKEN_TTL_MIN],
  );
  // Opportunistic cleanup; no cron needed.
  query(`delete from login_tokens where expires_at < now() - interval '1 day'`).catch(() => {});

  const next = typeof req.body?.next === 'string' && req.body.next.startsWith('/') && !req.body.next.startsWith('//') ? req.body.next : '';
  const url = `${config.appUrl()}/auth/verify?token=${token}${next ? `&next=${encodeURIComponent(next)}` : ''}`;
  await sendMagicLink(email, url);
  track('signup_start');
  res.json({ ok: true });
});

// The link opens a page that POSTs here, so mail scanners that prefetch GET links can't burn the token.
router.post('/auth/verify', async (req, res) => {
  const token = String(req.body?.token ?? '');
  if (!token) throw new HttpError(400, 'Missing token');
  config.sessionSecret(); // fail before burning the single-use token
  const { rows } = await query(
    `update login_tokens set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning email`,
    [sha256(token)],
  );
  if (!rows[0]) throw new HttpError(400, 'This sign-in link is invalid or expired. Request a new one.');
  const { rows: users } = await query(
    `insert into users (email, last_login_at) values ($1, now())
     on conflict (email) do update set last_login_at = now()
     returning *, (xmax = 0) as created`,
    [rows[0].email],
  );
  if (users[0].created) track('signup');
  issueSession(res, users[0]);
  res.json({ user: publicUser(users[0]) });
});

router.post('/auth/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});

router.patch('/me', requireUser, async (req, res) => {
  const { alertsOptIn, book } = req.body ?? {};
  if (alertsOptIn !== undefined && typeof alertsOptIn !== 'boolean') throw new HttpError(400, 'alertsOptIn must be true or false');
  if (book !== undefined && !isBook(book)) throw new HttpError(400, 'Unknown sportsbook');
  const { rows } = await query(
    'update users set alerts_opt_in = coalesce($1, alerts_opt_in), book = coalesce($2, book) where id = $3 returning *',
    [alertsOptIn ?? null, book ?? null, req.user.id]);
  res.json({ user: publicUser(rows[0]) });
});

/** Self-serve account deletion: ends billing immediately and removes the account and sign-in tokens. */
router.delete('/me', requireUser, async (req, res) => {
  if (String(req.body?.confirm ?? '').trim().toLowerCase() !== 'delete') throw new HttpError(400, 'Type DELETE to confirm');
  const { cancelAllNow } = await import('./billing.js');
  await cancelAllNow(req.user.stripe_customer_id);
  await query('delete from login_tokens where email = $1', [req.user.email]);
  await query('delete from users where id = $1', [req.user.id]);
  clearSession(res);
  res.json({ ok: true });
});

export default router;
