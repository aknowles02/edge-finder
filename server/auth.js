import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';

const COOKIE = 'ef_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.expose = true;
    this.extra = extra;
  }
}

export function isPremium(user) {
  if (!user) return false;
  const active = ['active', 'trialing'].includes(user.subscription_status);
  return active && (!user.current_period_end || new Date(user.current_period_end) > new Date());
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    plan: isPremium(user) ? 'premium' : 'free',
    subscriptionStatus: user.subscription_status,
    currentPeriodEnd: user.current_period_end,
    alertsOptIn: user.alerts_opt_in,
    isAdmin: config.adminEmails().has(String(user.email).toLowerCase()),
    hasBilling: Boolean(user.stripe_customer_id),
  };
}

export function issueSession(res, user) {
  const token = jwt.sign({ sub: String(user.id) }, config.sessionSecret(), { expiresIn: '30d' });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export async function attachUser(req, res, next) {
  const token = req.cookies?.[COOKIE];
  req.user = null;
  if (!token) return next();
  let sub;
  try {
    ({ sub } = jwt.verify(token, config.sessionSecret()));
  } catch {
    clearSession(res);
    return next();
  }
  const { rows } = await query('select * from users where id = $1', [sub]);
  req.user = rows[0] ?? null;
  if (!req.user) clearSession(res);
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Sign in to continue');
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Sign in to continue');
  if (!config.adminEmails().has(String(req.user.email).toLowerCase())) throw new HttpError(403, 'Admins only');
  next();
}

/** CSRF defense in depth on top of SameSite=Lax: mutating requests must come from our own origin. */
export function sameOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // non-browser clients; the cookie still won't be sent cross-site
  const allowed = new Set([config.appUrl(), `${req.protocol}://${req.get('host')}`]);
  if (!allowed.has(origin)) throw new HttpError(403, 'Cross-origin request blocked');
  next();
}
