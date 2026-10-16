import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ENTITLEMENTS, PLANS, TRIAL, TRIAL_DAYS, priceLabel } from '../../shared/plans.js';
import { api, fullDate } from '../lib/api.js';
import { daysLeft, useAuth } from '../lib/auth.jsx';
import { Alert, Spinner } from '../components/ui.jsx';

const pro = PLANS.pro;

/** The subscription decision page: what you get, what it costs, when you're charged. No dark patterns. */
export default function Subscribe() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const inTrial = user?.plan === 'trial';
  const isPro = user?.plan === 'pro';
  const trialOver = user && user.plan === 'none';
  const left = inTrial ? daysLeft(user.trialEndsAt) : 0;
  // Stripe can only defer the first charge if ≥ 48h of trial remain.
  const deferred = inTrial && new Date(user.trialEndsAt).getTime() - Date.now() > 49 * 3600_000;

  async function checkout() {
    setBusy(true); setError('');
    try {
      const { url } = await api.post('/api/billing/checkout', { plan: pro.id });
      window.location.assign(url);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      {params.get('checkout') === 'cancelled' && <div className="mb-4"><Alert tone="info">Checkout cancelled — nothing was charged.</Alert></div>}
      {trialOver && <div className="mb-4"><Alert tone="info">Your {TRIAL_DAYS}-day free trial has ended. Your account and settings are saved — subscribe whenever you're ready.</Alert></div>}

      <h1 className="text-2xl font-bold text-white sm:text-3xl">{isPro ? 'You have Edge Finder Pro' : 'Edge Finder Pro'}</h1>
      <p className="mt-2 text-muted">One plan. Everything included. Cancel anytime.</p>

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="card p-6">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">Free trial</div>
          <div className="mt-1 text-xl font-bold text-white">{TRIAL_DAYS} days · $0</div>
          <p className="mt-1 text-sm text-muted">No card required. Ends on its own — you're never charged unless you subscribe.</p>
          <ul className="mt-4 space-y-2 text-sm">
            {Object.entries(ENTITLEMENTS).map(([k, label]) => (
              <Feature key={k} on={TRIAL.entitlements.includes(k)}>{label}</Feature>
            ))}
          </ul>
          {inTrial && <p className="mt-4 text-sm font-semibold text-win-text">{left} day{left === 1 ? '' : 's'} left · ends {fullDate(user.trialEndsAt)}</p>}
        </div>

        <div className="card border-win/60 p-6 ring-1 ring-win/40">
          <div className="text-xs font-medium uppercase tracking-wide text-win-text">{pro.name}</div>
          <div className="mt-1 text-3xl font-extrabold text-white">{priceLabel(pro).replace('/mo', '')}<span className="text-base font-medium text-muted">/month</span></div>
          <ul className="mt-4 space-y-2 text-sm">
            {pro.entitlements.map((k) => <Feature key={k} on>{ENTITLEMENTS[k]}</Feature>)}
          </ul>

          <div className="mt-5 rounded-xl border border-ink-700 bg-ink-850 p-4 text-sm text-slate-300">
            <p className="font-semibold text-white">What you'll be charged</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-muted">
              {deferred ? (
                <li>$0 today. First charge of {priceLabel(pro)} on <b className="text-slate-200">{fullDate(user.trialEndsAt)}</b>, when your free trial ends.</li>
              ) : (
                <li>{priceLabel(pro)} charged today.</li>
              )}
              <li>Renews automatically every month at {priceLabel(pro)} until you cancel.</li>
              <li>Cancel anytime with one click on your account page. You keep access until the end of the period you paid for.</li>
            </ul>
          </div>

          {error && <div className="mt-4"><Alert>{error}</Alert></div>}
          {!user ? (
            <Link to="/login?next=/subscribe" className="btn-primary mt-5 w-full py-3">Start free trial</Link>
          ) : isPro ? (
            <Link to="/account" className="btn-ghost mt-5 w-full py-3">Manage subscription</Link>
          ) : (
            <button type="button" className="btn-primary mt-5 w-full py-3" disabled={busy} onClick={checkout}>
              {busy ? <Spinner className="h-4 w-4" /> : deferred ? `Subscribe — $0 today, then ${priceLabel(pro)}` : `Subscribe for ${priceLabel(pro)}`}
            </button>
          )}
          <p className="mt-3 text-center text-xs text-muted-dim">Secure checkout by Stripe. By subscribing you agree to the <Link to="/terms" className="underline">Terms</Link>, including automatic monthly renewal until you cancel.</p>
        </div>
      </div>

      <section className="mt-8 space-y-3 text-sm text-muted">
        <h2 className="font-semibold text-white">Before you subscribe</h2>
        <p>Edge Finder shows where historical hit rates exceed the price a sportsbook is offering. Those rates are estimates from past games; they don't guarantee future results, and a positive edge can still lose.</p>
        <p>Our real tracked record — every bet that qualified, graded at the price when it qualified — is shown separately from any backtests, which are hypothetical.</p>
        {inTrial && <p>If you don't subscribe, your trial simply ends on {fullDate(user.trialEndsAt)} and the board locks. Nothing to cancel.</p>}
      </section>
    </div>
  );
}

function Feature({ on, children }) {
  return (
    <li className={`flex gap-2.5 ${on ? 'text-slate-200' : 'text-muted-dim line-through decoration-ink-600'}`}>
      <span aria-hidden="true" className={on ? 'text-win-text' : 'text-muted-dim'}>{on ? '✓' : '—'}</span>
      <span>{children}{!on && <span className="sr-only"> (not included)</span>}</span>
    </li>
  );
}
