import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert, Spinner } from '../components/ui.jsx';

export default function Login() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const next = params.get('next') || '/board';
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  if (user) return <Navigate to={next} replace />;

  async function submit(e) {
    e.preventDefault();
    setStatus('sending');
    setError('');
    try {
      await api.post('/api/auth/login', { email, next });
      setStatus('sent');
    } catch (err) {
      setError(err.message);
      setStatus('idle');
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:py-24">
      <div className="card p-6 sm:p-8">
        {status === 'sent' ? (
          <div className="text-center">
            <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-win/20 text-win-text">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></svg>
            </div>
            <h1 className="text-xl font-bold text-white">Check your inbox</h1>
            <p className="mt-2 text-sm text-muted">We sent a sign-in link to <span className="text-slate-200">{email}</span>. It expires in 15 minutes.</p>
            <button type="button" className="btn-ghost mt-6" onClick={() => setStatus('idle')}>Use a different email</button>
          </div>
        ) : (
          <form onSubmit={submit} noValidate>
            <h1 className="text-xl font-bold text-white">Sign in to Edge Finder</h1>
            <p className="mt-1.5 text-sm text-muted">No password. We'll email you a one-time link.</p>
            <label htmlFor="email" className="label mt-6">Email</label>
            <input
              id="email" type="email" autoComplete="email" inputMode="email" required autoFocus
              className="input" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)}
            />
            {error && <div className="mt-4"><Alert>{error}</Alert></div>}
            <button type="submit" className="btn-primary mt-6 w-full py-3" disabled={status === 'sending' || !email}>
              {status === 'sending' ? <Spinner className="h-4 w-4" /> : 'Email me a link'}
            </button>
            <p className="mt-4 text-center text-xs text-muted-dim">By continuing you confirm you're 21+ and agree to bet responsibly.</p>
          </form>
        )}
      </div>
    </div>
  );
}
