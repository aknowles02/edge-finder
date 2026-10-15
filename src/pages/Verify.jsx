import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { Alert, Spinner } from '../components/ui.jsx';

export default function Verify() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [error, setError] = useState('');
  const once = useRef(false);

  useEffect(() => {
    if (once.current) return; // StrictMode double-invokes effects; tokens are single-use
    once.current = true;
    const token = params.get('token');
    const next = params.get('next');
    const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/board';
    if (!token) { setError('This link is missing its token.'); return; }
    api.post('/api/auth/verify', { token })
      .then(({ user }) => { setUser(user); navigate(dest, { replace: true }); })
      .catch((err) => setError(err.message));
  }, [params, navigate, setUser]);

  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4">
      {error ? (
        <div className="w-full space-y-4 text-center">
          <Alert>{error}</Alert>
          <Link to="/login" className="btn-primary">Send a new link</Link>
        </div>
      ) : (
        <div className="flex items-center gap-3 text-muted"><Spinner /> Signing you in…</div>
      )}
    </div>
  );
}
