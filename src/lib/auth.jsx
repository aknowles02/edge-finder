import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { Spinner } from '../components/ui.jsx';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading

  const refresh = useCallback(async () => {
    try {
      const { user } = await api.get('/api/me');
      setUser(user);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout');
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, setUser, refresh, logout, loading: user === undefined }), [user, refresh, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** `need`: an entitlement from shared/plans.js. Without it, send the user to the subscribe decision page. */
export function RequireAuth({ children, admin = false, need }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (admin && !user.isAdmin) return <Navigate to="/board" replace />;
  if (need && !user.entitlements?.includes(need)) return <Navigate to={`/subscribe?need=${need}`} replace />;
  return children;
}

export const daysLeft = (iso) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
