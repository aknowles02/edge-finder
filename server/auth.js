import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query } from './db.js';
import { DEFAULT_PLAN, ENTITLEMENTS, PLANS, can, resolveAccess } from '../shared/plans.js';

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

export const isAdmin = (user) => Boolean(user) && config.adminEmails().has(String(user.email).toLowerCase());

/** Admins get every entitlement so they can see what subscribers see. */
export function accessFor(user) {
  if (isAdmin(user)) return { ...resolveAccess(user), entitlements: Object.keys(ENTITLEMENTS), sports: '*' };
  return resolveAccess(user);
}

export function publicUser(user) {
  const access = accessFor(user);
  const plan = PLANS[user.plan_id || DEFAULT_PLAN];
  return {
    id: user.id,
    email: user.email,
    plan: access.plan, // 'pro' | 'trial' | 'none'
    planName: access.plan === 'trial' ? 'Free trial' : plan?.name,
    entitlements: access.entitlements,
    trialEndsAt: user.trial_ends_at,
    subscriptionStatus: user.subscription_status,
    currentPeriodEnd: user.current_period_end,
    cancelAtPeriodEnd: user.cancel_at_period_end,
    alertsOptIn: user.alerts_opt_in,
    book: user.book,
    isAdmin: isAdmin(user),
    hasBilling: Boolean(user.stripe_customer_id),
  };
}

export function requireEntitlement(entitlement) {
  return (req, _res, next) => {
    if (!req.user) throw new HttpError(401, 'Sign in to continue');
    const access = accessFor(req.user);
    if (!can(access, entitlement)) {
      const trialOver = access.plan === 'none';
      throw new HttpError(402, trialOver ? 'Your free trial has ended. Subscribe to Edge Finder Pro to keep using the board.'
        : `${ENTITLEMENTS[entitlement]} is included with Edge Finder Pro.`, { entitlement, plan: access.plan });
    }
    req.access = access;
    next();
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
