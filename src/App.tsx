import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import { handleRedirectResult } from './services/authService';
import { useAuth, isAuthorizedAdminEmail } from './context/AuthContext';
import SplashScreen from './components/SplashScreen';
import HomePage from './components/HomePage';
import AdminDashboard from './components/AdminDashboard';
import Header from './components/Header';
import SearchPage from './components/SearchPage';
import UpdateNotification from './components/UpdateNotification';
import { ShieldCheck, LogIn, ArrowLeft } from 'lucide-react';

function AdminRoute({ children }: { children: React.ReactElement }) {
  const { user, isAdmin, loading, signInWithEmail } = useAuth();

  const isUnlockedSession = typeof window !== 'undefined' && localStorage.getItem('admin_unlocked_session') === '20180020511';

  if (isUnlockedSession) {
    return children;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-gray-400 text-xs">Checking administrator credentials...</p>
        </div>
      </div>
    );
  }

  const isAuthorized = isAuthorizedAdminEmail(user?.email);

  if (user && isAuthorized && (isAdmin || isAuthorized)) {
    return children;
  }

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-6 text-center shadow-2xl">
        <div className="w-14 h-14 bg-yellow-400/10 border border-yellow-500/30 rounded-2xl flex items-center justify-center text-yellow-400 mx-auto mb-4">
          <ShieldCheck size={32} />
        </div>
        <h2 className="text-lg font-black uppercase text-white mb-1 tracking-tight">Admin Sign In Required</h2>
        <p className="text-xs text-gray-400 mb-6 leading-relaxed">
          The Admin Dashboard is restricted to authorized administrators (<span className="text-yellow-400 font-mono">adityaantil260@gmail.com</span>, <span className="text-yellow-400 font-mono">amandabasladpuriya@gmail.com</span>).
        </p>

        <div className="space-y-3 mb-6">
          <button
            type="button"
            onClick={() => signInWithEmail('adityaantil260@gmail.com')}
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xs py-3 px-4 rounded-xl shadow-lg shadow-yellow-400/20 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
          >
            <ShieldCheck size={16} />
            <span>Sign In as adityaantil260@gmail.com</span>
          </button>
          <button
            type="button"
            onClick={() => signInWithEmail('amandabasladpuriya@gmail.com')}
            className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <ShieldCheck size={14} />
            <span>Sign In as amandabasladpuriya@gmail.com</span>
          </button>
        </div>

        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-yellow-400 hover:text-yellow-300 font-bold transition-colors">
          <ArrowLeft size={14} />
          <span>Return to Movie Portal</span>
        </Link>
      </div>
    </div>
  );
}

function AppContent() {
  const [showSplash, setShowSplash] = useState(true);

  return (
    <>
      {showSplash ? (
        <SplashScreen onFinish={() => setShowSplash(false)} />
      ) : (
        <div className="min-h-screen bg-black flex flex-col">
          <Header />
          <UpdateNotification />
          <main className="flex-grow">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route
                path="/admin"
                element={
                  <AdminRoute>
                    <AdminDashboard />
                  </AdminRoute>
                }
              />
              <Route path="/search" element={<SearchPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      )}
    </>
  );
}

export default function App() {
  useEffect(() => {
    handleRedirectResult();
    
    // Initialize immersive full-screen mode for Android
    if (Capacitor.isNativePlatform()) {
      StatusBar.setOverlaysWebView({ overlay: true });
      StatusBar.hide();
    }
  }, []);

  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
