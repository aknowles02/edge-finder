import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import { AuthProvider, RequireAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import Landing from './pages/Landing.jsx';
import { Spinner } from './components/ui.jsx';

const Board = lazy(() => import('./pages/Board.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Verify = lazy(() => import('./pages/Verify.jsx'));
const Account = lazy(() => import('./pages/Account.jsx'));
const Admin = lazy(() => import('./pages/Admin.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));

const fallback = <div className="grid min-h-[50vh] place-items-center"><Spinner /></div>;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Layout>
          <Suspense fallback={fallback}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route path="/auth/verify" element={<Verify />} />
              <Route path="/board" element={<RequireAuth><Board /></RequireAuth>} />
              <Route path="/board/:season/:week" element={<RequireAuth><Board /></RequireAuth>} />
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
