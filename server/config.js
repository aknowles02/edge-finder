const env = process.env;

function required(name) {
  const v = env[name];
  if (!v) throw Object.assign(new Error(`Server misconfigured: ${name} is not set`), { status: 500, expose: false });
  return v;
}

export const config = {
  isProd: env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production',
  appUrl: () => (env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
  databaseUrl: () => required('DATABASE_URL'),
  sessionSecret: () => {
    const s = required('SESSION_SECRET');
    if (s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
    return s;
  },
  adminEmails: () => new Set((env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)),
  resendKey: () => env.RESEND_API_KEY || null,
  emailFrom: () => env.EMAIL_FROM || 'Edge Finder <onboarding@resend.dev>',
  stripeKey: () => required('STRIPE_SECRET_KEY'),
  stripePrice: () => required('STRIPE_PRICE_ID'),
  stripeWebhookSecret: () => required('STRIPE_WEBHOOK_SECRET'),
};
