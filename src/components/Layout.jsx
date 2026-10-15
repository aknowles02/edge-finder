import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth.jsx';
import { Logo } from './ui.jsx';

const navClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'text-white' : 'text-muted hover:text-slate-200'}`;

export default function Layout({ children }) {
  const { user } = useAuth();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-700/70 bg-ink-900/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link to="/" aria-label="Edge Finder home"><Logo /></Link>
          <nav className="flex items-center gap-1">
            {user && <NavLink to="/board" className={navClass}>Board</NavLink>}
            {user?.isAdmin && <NavLink to="/admin" className={navClass}>Admin</NavLink>}
            {user ? (
              <NavLink to="/account" className={navClass}>
                {user.plan === 'premium' ? <span className="text-win-text">Premium</span> : 'Account'}
              </NavLink>
            ) : (
              user === null && (
                <>
                  <NavLink to="/login" className={navClass}>Sign in</NavLink>
                  <Link to="/login" className="btn-primary ml-1 hidden sm:inline-flex">Get started</Link>
                </>
              )
            )}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-ink-700/70 py-8 text-center text-xs text-muted-dim">
        <p>Edge Finder publishes data, not guarantees. Past results don't predict future outcomes.</p>
        <p className="mt-1">21+. Bet responsibly. Gambling problem? Call 1-800-GAMBLER.</p>
      </footer>
    </div>
  );
}
