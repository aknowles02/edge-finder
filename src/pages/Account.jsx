import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PLANS, priceLabel } from '../../shared/plans.js';
import { BOOKS, DEFAULT_BOOK } from '../../shared/books.js';
import { api } from '../lib/api.js';
import { daysLeft, useAuth } from '../lib/auth.jsx';
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
    if (checkout !== 'success' || user?.plan === 'pro') return;
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

  const premium = user.plan === 'pro';

  async function post(path, done) {
    setBusy(path); setError('');
    try { await api.post(path); await refresh(); done?.(); } catch (err) { setError(err.message); }
    setBusy('');
  }

  async function deleteAccount() {
    const typed = window.prompt('This permanently deletes your account and immediately ends any subscription. Type DELETE to confirm.');
    if (typed == null) return;
    setBusy('delete'); setError('');
    try {
      await api.del('/api/me', { confirm: typed });
      await logout().catch(() => {});
      navigate('/');
    } catch (err) { setError(err.message); setBusy(''); }
  }
  const fmt = (d) => new Date(d).toLocaleDateString([], { dateStyle: 'medium' });
  const price = priceLabel(PLANS.pro);
  const trialing = user.subscriptionStatus === 'trialing';

  let planLine;
  if (premium && user.cancelAtPeriodEnd) planLine = `Cancelled — access continues until ${fmt(user.currentPeriodEnd)}. You won't be charged again.`;
  else if (premium && trialing) planLine = `Subscribed. First charge of ${price} on ${fmt(user.currentPeriodEnd)}, then monthly until you cancel.`;
  else if (premium) planLine = user.currentPeriodEnd && `Renews ${fmt(user.currentPeriodEnd)} at ${price}. Cancel anytime.`;
  else if (user.plan === 'trial') planLine = `Free trial ends ${fmt(user.trialEndsAt)} (${daysLeft(user.trialEndsAt)} days left). No card on file — nothing will be charged unless you subscribe.`;
  else planLine = 'Your free trial has ended. Subscribe to keep using the Edge Board.';

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8 sm:py-12">
      <h1 className="text-2xl font-bold text-white">Account</h1>

      {checkout === 'success' && (
        <Alert tone="success">
          {premium ? `Welcome to ${PLANS.pro.name}.` : <span className="inline-flex items-center gap-2"><Spinner className="h-4 w-4" /> Confirming your subscription…</span>}
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}

      <section className="card p-6">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">Signed in as</div>
        <div className="mt-1 break-all font-semibold text-white">{user.email}</div>
      </section>

      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wide text-muted">Plan</div>
            <div className="mt-1 text-xl font-bold text-white">
              {premium ? <span className="text-win-text">{PLANS.pro.name}</span> : user.plan === 'trial' ? 'Free trial' : 'No active plan'}
              {premium && <span className="ml-2 text-sm font-medium text-muted">{price}</span>}
            </div>
            <p className="mt-1 text-sm text-muted">{planLine}</p>
            {user.subscriptionStatus === 'past_due' && <p className="mt-2 text-sm text-warn">Your last payment failed. Update your card under "Update card & invoices" to keep Pro.</p>}
          </div>
          <div className="flex flex-col gap-2">
            {!premium && <Link to="/subscribe" className="btn-primary">{user.plan === 'trial' ? 'Subscribe to Pro' : `Get Pro — ${price}`}</Link>}
            {user.hasBilling && (
              <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => go('/api/billing/portal')}>
                {busy === '/api/billing/portal' ? <Spinner className="h-4 w-4" /> : premium ? 'Update card & invoices' : 'Billing history'}
              </button>
            )}
            {premium && user.hasBilling && !user.cancelAtPeriodEnd && (
              <button type="button" className="btn-ghost text-loss-text" disabled={!!busy}
                onClick={() => { if (window.confirm(`Cancel ${PLANS.pro.name}? You keep access until ${user.currentPeriodEnd ? fmt(user.currentPeriodEnd) : 'the end of this period'} and won't be charged again.`)) post('/api/billing/cancel'); }}>
                {busy === '/api/billing/cancel' ? <Spinner className="h-4 w-4" /> : 'Cancel subscription'}
              </button>
            )}
            {premium && user.cancelAtPeriodEnd && (
              <button type="button" className="btn-ghost" disabled={!!busy} onClick={() => post('/api/billing/resume')}>
                {busy === '/api/billing/resume' ? <Spinner className="h-4 w-4" /> : 'Resume subscription'}
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="card p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-semibold text-white">New board alerts</div>
            <p className="mt-0.5 text-sm text-muted">{premium ? 'Email me as soon as a new week is published.' : 'Pro members get an email when each new board drops.'}</p>
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

      <section className="card p-6">
        <label htmlFor="book" className="font-semibold text-white">My sportsbook</label>
        <p className="mt-0.5 text-sm text-muted">The board and results show lines at this book.</p>
        <select id="book" className="input mt-3 max-w-xs" value={user.book || DEFAULT_BOOK} disabled={!!busy}
          onChange={async (e) => { setBusy('book'); try { const { user: u } = await api.patch('/api/me', { book: e.target.value }); setUser(u); } catch (err) { setError(err.message); } setBusy(''); }}>
          {BOOKS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </section>

      <section className="card border-loss/30 p-6">
        <div className="font-semibold text-white">Delete account</div>
        <p className="mt-1 text-sm text-muted">Permanently removes your account and email from Edge Finder and ends any subscription immediately. Stripe keeps payment records it is legally required to keep.</p>
        <button type="button" className="btn-ghost mt-4 text-loss-text" disabled={!!busy} onClick={deleteAccount}>
          {busy === 'delete' ? <Spinner className="h-4 w-4" /> : 'Delete my account'}
        </button>
      </section>

      <button type="button" className="btn-ghost w-full sm:w-auto"
        onClick={async () => { await logout(); setParams({}); navigate('/'); }}>
        Sign out
      </button>
    </div>
  );
}
