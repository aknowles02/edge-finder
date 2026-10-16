import { Router } from 'express';
import Stripe from 'stripe';
import { DEFAULT_PLAN, PLANS, priceLabel } from '../../shared/plans.js';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError, accessFor, requireUser } from '../auth.js';
import { track } from '../funnel.js';

const router = Router();
let stripe;
const getStripe = () => (stripe ??= new Stripe(config.stripeKey()));

function priceIdFor(plan) {
  const id = process.env[plan.stripePriceEnv];
  if (!id) throw Object.assign(new Error(`Server misconfigured: ${plan.stripePriceEnv} is not set`), { status: 500, expose: true });
  return id;
}

function planForPrice(priceId) {
  return Object.values(PLANS).find((p) => process.env[p.stripePriceEnv] === priceId)?.id ?? DEFAULT_PLAN;
}

async function ensureCustomer(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await getStripe().customers.create({ email: user.email, metadata: { userId: String(user.id) } });
  await query('update users set stripe_customer_id = $1 where id = $2', [customer.id, user.id]);
  return customer.id;
}

const MIN_STRIPE_TRIAL_MS = 49 * 60 * 60 * 1000; // Stripe requires trial_end ≥ 48h out

router.get('/billing/plans', (_req, res) => {
  res.json({ plans: Object.values(PLANS).map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents, interval: p.interval, label: priceLabel(p), entitlements: p.entitlements })) });
});

router.post('/billing/checkout', requireUser, async (req, res) => {
  const plan = PLANS[req.body?.plan || DEFAULT_PLAN];
  if (!plan) throw new HttpError(400, 'Unknown plan');
  if (accessFor(req.user).plan === plan.id) throw new HttpError(409, `You already have ${plan.name}`);

  // Subscribing mid-trial never cuts the trial short: billing starts when the free week ends.
  const trialEnd = req.user.trial_ends_at ? new Date(req.user.trial_ends_at) : null;
  const deferBilling = trialEnd && trialEnd.getTime() - Date.now() > MIN_STRIPE_TRIAL_MS;
  const firstCharge = deferBilling ? trialEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'today';

  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: await ensureCustomer(req.user),
    client_reference_id: String(req.user.id),
    line_items: [{ price: priceIdFor(plan), quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { userId: String(req.user.id), plan: plan.id },
      ...(deferBilling ? { trial_end: Math.floor(trialEnd.getTime() / 1000) } : {}),
    },
    custom_text: {
      submit: {
        message: `${plan.name} is ${priceLabel(plan)}, first charged ${firstCharge}, then renews automatically every ${plan.interval} until you cancel. Cancel anytime from your account page.`,
      },
    },
    success_url: `${config.appUrl()}/account?checkout=success`,
    cancel_url: `${config.appUrl()}/subscribe?checkout=cancelled`,
  });
  res.json({ url: session.url });
});

async function activeSubscriptions(customer) {
  const { data } = await getStripe().subscriptions.list({ customer, status: 'all', limit: 20 });
  return data.filter((x) => ['active', 'trialing', 'past_due', 'unpaid'].includes(x.status));
}

/** In-app cancel: stops renewal at the end of the paid period. No retention maze. */
router.post('/billing/cancel', requireUser, async (req, res) => {
  if (!req.user.stripe_customer_id) throw new HttpError(400, 'No active subscription');
  const subs = await activeSubscriptions(req.user.stripe_customer_id);
  if (!subs.length) throw new HttpError(400, 'No active subscription');
  for (const sub of subs) await syncSubscription(await getStripe().subscriptions.update(sub.id, { cancel_at_period_end: true }));
  track('cancel');
  res.json({ ok: true });
});

router.post('/billing/resume', requireUser, async (req, res) => {
  if (!req.user.stripe_customer_id) throw new HttpError(400, 'No subscription');
  const subs = await activeSubscriptions(req.user.stripe_customer_id);
  for (const sub of subs) await syncSubscription(await getStripe().subscriptions.update(sub.id, { cancel_at_period_end: false }));
  res.json({ ok: true });
});

/** Used by account deletion: end billing immediately. */
export async function cancelAllNow(customer) {
  if (!customer) return;
  for (const sub of await activeSubscriptions(customer)) await getStripe().subscriptions.cancel(sub.id);
}

router.post('/billing/portal', requireUser, async (req, res) => {
  if (!req.user.stripe_customer_id) throw new HttpError(400, 'No billing account yet');
  const session = await getStripe().billingPortal.sessions.create({
    customer: req.user.stripe_customer_id,
    return_url: `${config.appUrl()}/account`,
  });
  res.json({ url: session.url });
});

async function syncSubscription(sub) {
  // current_period_end moved onto subscription items in newer Stripe API versions.
  const item = sub.items?.data?.[0];
  const end = sub.current_period_end ?? item?.current_period_end ?? null;
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  await query(
    `update users set subscription_status = $1, current_period_end = to_timestamp($2),
                      cancel_at_period_end = $3, plan_id = $4
      where stripe_customer_id = $5`,
    [sub.status, end, Boolean(sub.cancel_at_period_end || sub.cancel_at), planForPrice(item?.price?.id), customer],
  );
}

/** Mounted with express.raw() before the JSON parser — signature checks need the exact bytes. */
export async function stripeWebhook(req, res) {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.get('stripe-signature'), config.stripeWebhookSecret());
  } catch (err) {
    return res.status(400).json({ error: `Webhook signature failed: ${err.message}` });
  }
  switch (event.type) {
    case 'checkout.session.completed': {
      const s = event.data.object;
      if (s.mode === 'subscription' && s.subscription) {
        track('subscribe');
        await syncSubscription(await getStripe().subscriptions.retrieve(s.subscription));
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      await syncSubscription(event.data.object);
      break;
    default:
      break;
  }
  res.json({ received: true });
}

export default router;
