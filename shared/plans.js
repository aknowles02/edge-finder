// Single source of truth for what each tier unlocks. Used by the API (enforcement) and the UI (copy).
//
// Adding a tier later (e.g. "NBA Pro" or "Elite"): add an entry here with its own Stripe price env var,
// entitlements and sports, create the price in Stripe, and set the env var. Webhooks map the
// subscription's price back to the plan id, so nothing else needs to change.

export const TRIAL_DAYS = 7;

export const ENTITLEMENTS = {
  board: 'Live Edge Board (current slate)',
  history: 'Every past board',
  reports: 'Tracked results, closing line value and ROI reports',
  alerts: 'Email alert when a new board drops',
};

/** What a free trial includes: the core board only, no history or reports. */
export const TRIAL = {
  id: 'trial',
  name: 'Free trial',
  entitlements: ['board'],
  sports: '*',
};

export const PLANS = {
  pro: {
    id: 'pro',
    name: 'Edge Finder Pro',
    priceCents: 1999,
    interval: 'month',
    stripePriceEnv: 'STRIPE_PRICE_ID',
    entitlements: ['board', 'history', 'reports', 'alerts'],
    sports: '*',
  },
};

export const DEFAULT_PLAN = 'pro';

export function priceLabel(plan) {
  return `$${(plan.priceCents / 100).toFixed(2)}/${plan.interval === 'year' ? 'yr' : 'mo'}`;
}

const ACTIVE = ['active', 'trialing', 'past_due'];

/**
 * Resolve what a user can do right now.
 * `past_due` keeps access while Stripe retries the card (Stripe's own dunning decides when it ends).
 */
export function resolveAccess(user, now = new Date()) {
  if (!user) return { plan: 'none', entitlements: [], sports: [] };
  const plan = PLANS[user.plan_id || DEFAULT_PLAN];
  const periodOk = !user.current_period_end || new Date(user.current_period_end) > now;
  if (plan && ACTIVE.includes(user.subscription_status) && periodOk) {
    return { plan: plan.id, entitlements: plan.entitlements, sports: plan.sports };
  }
  const trialEnds = user.trial_ends_at ? new Date(user.trial_ends_at) : null;
  if (trialEnds && trialEnds > now) {
    return { plan: 'trial', entitlements: TRIAL.entitlements, sports: TRIAL.sports, trialEndsAt: trialEnds };
  }
  return { plan: 'none', entitlements: [], sports: [] };
}

export const can = (access, entitlement) => access.entitlements.includes(entitlement);
export const canSport = (access, sport) => access.sports === '*' || access.sports.includes(sport);
