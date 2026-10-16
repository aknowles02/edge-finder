import { Link, NavLink } from 'react-router-dom';
import { PLANS, priceLabel } from '../../shared/plans.js';
import { daysLeft, useAuth } from '../lib/auth.jsx';
import { Logo } from './ui.jsx';

const navClass = ({ isActive }) =>
  `rounded-lg px-2.5 py-2 text-sm font-medium transition sm:px-3 ${isActive ? 'text-white' : 'text-muted hover:text-slate-200'}`;

function TrialBanner({ user }) {
  if (user?.plan !== 'trial') return null;
  const left = daysLeft(user.trialEndsAt);
  return (
    <div className="border-b border-win/30 bg-win/10">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 text-xs sm:px-6 sm:text-sm">
        <p className="text-slate-200">
          <b className="text-win-text">Free trial: {left} day{left === 1 ? '' : 's'} left.</b>{' '}
          <span className="text-muted">No card on file — it ends on its own. Pro is {priceLabel(PLANS.pro)} if you continue.</span>
        </p>
        <Link to="/subscribe" className="font-semibold text-win-text hover:underline">See what Pro adds →</Link>
      </div>
    </div>
  );
}

export default function Layout({ children }) {
  const { user } = useAuth();
  const has = (e) => user?.entitlements?.includes(e);
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-700/70 bg-ink-900/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:h-16 sm:px-6">
          <Link to="/" aria-label="Edge Finder home"><Logo /></Link>
          <nav className="flex items-center">
            {has('board') && <NavLink to="/board" className={navClass}>Board</NavLink>}
            {user && <NavLink to="/reports" className={navClass}>Results</NavLink>}
            {user?.isAdmin && <NavLink to="/admin" className={`${navClass({})} hidden sm:inline-flex`}>Admin</NavLink>}
            {user ? (
              <NavLink to="/account" className={navClass}>
                {user.plan === 'pro' ? <span className="text-win-text">Pro</span> : 'Account'}
              </NavLink>
            ) : (
              user === null && (
                <>
                  <NavLink to="/login" className={navClass}>Sign in</NavLink>
                  <Link to="/login" className="btn-primary ml-1 hidden sm:inline-flex">Start free trial</Link>
                </>
              )
            )}
          </nav>
        </div>
        <TrialBanner user={user} />
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-ink-700/70 px-4 py-8 text-center text-xs text-muted-dim">
        <p>Edge Finder publishes data, not guarantees. Estimated probabilities come from past games; past results don't predict future outcomes.</p>
        <p className="mt-1">21+. Not a sportsbook; for informational purposes only. Gambling problem? Call or text 1-800-GAMBLER.</p>
        <nav className="mt-3 flex justify-center gap-4 text-muted" aria-label="Legal">
          <Link to="/terms" className="hover:text-slate-200">Terms</Link>
          <Link to="/privacy" className="hover:text-slate-200">Privacy</Link>
          <a href="https://www.ncpgambling.org" target="_blank" rel="noreferrer" className="hover:text-slate-200">Responsible gambling</a>
        </nav>
      </footer>
    </div>
  );
}
