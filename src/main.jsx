import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { AuthProvider, RequireAuth, useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import { Spinner } from './components/ui.jsx';

const Board = lazy(() => import('./pages/Board.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Verify = lazy(() => import('./pages/Verify.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));
const Subscribe = lazy(() => import('./pages/Subscribe.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Terms = lazy(() => import('./pages/Legal.jsx').then((m) => ({ default: m.Terms })));
const Privacy = lazy(() => import('./pages/Legal.jsx').then((m) => ({ default: m.Privacy })));

// Signed-in users open straight onto the Edge Board (or the subscribe decision once the trial ends).
function Home() {
  const { user, loading } = useAuth();
  if (loading) return fallback;
  if (!user) return <Landing />;
  return <Navigate to={user.entitlements?.includes('board') ? '/board' : '/subscribe'} replace />;
}

const fallback = <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Layout>
          <Suspense fallback={fallback}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/subscribe" element={<Subscribe />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/login" element={<Login />} />
              <Route path="/auth/verify" element={<Verify />} />
              <Route path="/board" element={<RequireAuth need="board"><Board /></RequireAuth>} />
              <Route path="/board/:season/:week" element={<RequireAuth need="board"><Board /></RequireAuth>} />
              <Route path="/reports" element={<RequireAuth need="reports"><Reports /></RequireAuth>} />
              <Route path="/account" element={<RequireAuth><Account /></RequireAuth>} />
              <Route path="/admin" element={<RequireAuth admin><Admin /></RequireAuth>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Layout>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
