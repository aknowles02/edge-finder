import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert, Spinner } from '../components/ui.jsx';

export default function Account() {
  const { user, setUser, refresh, logout } = useAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const checkout = params.get('checkout');

  // Stripe webhooks can land a beat after the redirect; poll briefly until the plan flips.
  useEffect(() => {
    if (checkout !== 'success' || user?.plan === 'premium') return;
    let tries = 0;
    const id = setInterval(() => { tries++; refresh(); if (tries >= 10) clearInterval(id); }, 1500);
    return () => clearInterval(id);
  }, [checkout, user?.plan, refresh]);

  async function go(path) {
    setBusy(path); setError('');
    try {
      const { url } = await api.post(path);
      window.location.assign(url);
    } catch (err) {
      setError(err.message); setBusy('');
    }
  }

  async function toggleAlerts() {
    setBusy('alerts'); setError('');
    try {
      const { user: u } = await api.patch('/api/me', { alertsOptIn: !user.alertsOptIn });
      setUser(u);
    } catch (err) { setError(err.message); }
    setBusy('');
  }

  const premium = user.plan === 'premium';

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8 sm:py-12">
      <h1 className="text-2xl font-bold text-white">Account</h1>

      {checkout === 'success' && (
        <Alert tone="success">
          {premium ? 'Welcome to Premium — every week is unlocked.' : <span className="inline-flex items-center gap-2"><Spinner className="h-4 w-4" /> Confirming your payment…</span>}
        </Alert>
      )}
      {checkout === 'cancelled' && <Alert tone="info">Checkout cancelled — you haven't been charged.</Alert>}
      {error && <Alert>{error}</Alert>}

      <section className="card p-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Signed in as</div>
        <div className="mt-1 break-all font-semibold text-white">{user.email}</div>
      </section>

      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Plan</div>
            <div className="mt-1 text-xl font-bold text-white">
              {premium ? <span className="text-win-text">Premium</span> : 'Free'}
              {premium && <span className="ml-2 text-sm font-medium text-muted">$19.99/mo</span>}
            </div>
            <p className="mt-1 text-sm text-muted">
              {premium
                ? user.currentPeriodEnd && `${user.subscriptionStatus === 'active' ? 'Renews' : 'Access until'} ${new Date(user.currentPeriodEnd).toLocaleDateString([], { dateStyle: 'medium' })}`
                : 'Current week only. Upgrade for every historical board and new-board email alerts.'}
            </p>
            {user.subscriptionStatus === 'past_due' && <p className="mt-2 text-sm text-warn">Your last payment failed. Update your card to keep Premium.</p>}
          </div>
          {premium || user.hasBilling ? (
            <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => go('/api/billing/portal')}>
              {busy === '/api/billing/portal' ? <Spinner className="h-4 w-4" /> : 'Manage billing'}
            </button>
          ) : null}
          {!premium && (
            <button type="button" className="btn-primary" disabled={!!busy} onClick={() => go('/api/billing/checkout')}>
              {busy === '/api/billing/checkout' ? <Spinner className="h-4 w-4" /> : 'Upgrade — $19.99/mo'}
            </button>
          )}
        </div>
      </section>

      <section className="card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-white">New board alerts</div>
            <p className="mt-0.5 text-sm text-muted">{premium ? 'Email me as soon as a new week is published.' : 'Premium members get an email when each new board drops.'}</p>
          </div>
          <button
            type="button" role="switch" aria-checked={premium && user.alertsOptIn} aria-label="New board alerts"
            disabled={!premium || busy === 'alerts'} onClick={toggleAlerts}
            className={`relative h-6 w-11 flex-none rounded-full transition disabled:opacity-40 ${premium && user.alertsOptIn ? 'bg-win' : 'bg-ink-600'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${premium && user.alertsOptIn ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>
      </section>

      <button type="button" className="btn-ghost w-full sm:w-auto"
        onClick={async () => { await logout(); setParams({}); navigate('/'); }}>
        Sign out
      </button>
    </div>
  );
}
