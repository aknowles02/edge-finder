import { Router } from 'express';
import Stripe from 'stripe';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError, isPremium, requireUser } from '../auth.js';

const router = Router();
let stripe;
const getStripe = () => (stripe ??= new Stripe(config.stripeKey()));

async function ensureCustomer(user) {
  if (user.stripe_customer_id) return user.stripe_customer_id;
  const customer = await getStripe().customers.create({ email: user.email, metadata: { userId: String(user.id) } });
  await query('update users set stripe_customer_id = $1 where id = $2', [customer.id, user.id]);
  return customer.id;
}

router.post('/billing/checkout', requireUser, async (req, res) => {
  if (isPremium(req.user)) throw new HttpError(409, 'You already have Premium');
  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    customer: await ensureCustomer(req.user),
    client_reference_id: String(req.user.id),
    line_items: [{ price: config.stripePrice(), quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${config.appUrl()}/account?checkout=success`,
    cancel_url: `${config.appUrl()}/account?checkout=cancelled`,
  });
  res.json({ url: session.url });
});

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
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  await query(
    `update users set subscription_status = $1, current_period_end = to_timestamp($2) where stripe_customer_id = $3`,
    [sub.status, end, customer],
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
