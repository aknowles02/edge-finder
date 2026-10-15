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

export function RequireAuth({ children, admin = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (admin && !user.isAdmin) return <Navigate to="/board" replace />;
  return children;
}
