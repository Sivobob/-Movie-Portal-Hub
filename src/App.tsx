import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
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
  const [unlocked, setUnlocked] = useState(() => {
    return typeof window !== 'undefined' && localStorage.getItem('admin_unlocked_session') === '20180020511';
  });
  const [passwordInput, setPasswordInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  if (unlocked) {
    return children;
  }

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput.trim() === '20180020511') {
      localStorage.setItem('admin_unlocked_session', '20180020511');
      setUnlocked(true);
    } else {
      setErrorMsg('Incorrect admin password. Please try again.');
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-neutral-900 border border-neutral-800 rounded-3xl p-6 text-center shadow-2xl">
        <div className="w-14 h-14 bg-yellow-400/10 border border-yellow-500/30 rounded-2xl flex items-center justify-center text-yellow-400 mx-auto mb-4">
          <ShieldCheck size={32} />
        </div>
        <h2 className="text-lg font-black uppercase text-white mb-1 tracking-tight">Admin Authentication</h2>
        <p className="text-xs text-gray-400 mb-5 leading-relaxed">
          Enter the administrator password to access movie management and stream configuration:
        </p>

        <form onSubmit={handleUnlock} className="space-y-3 mb-5">
          <input
            type="password"
            value={passwordInput}
            onChange={(e) => {
              setPasswordInput(e.target.value);
              setErrorMsg('');
            }}
            placeholder="Enter admin password..."
            autoFocus
            className="w-full bg-neutral-950 border border-neutral-700 focus:border-yellow-400 rounded-xl px-3.5 py-3 text-xs text-white placeholder-gray-500 focus:outline-none transition-colors text-center font-mono tracking-widest"
          />

          {errorMsg && (
            <p className="text-[11px] text-red-400 font-semibold">{errorMsg}</p>
          )}

          <button
            type="submit"
            className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xs py-3 px-4 rounded-xl shadow-lg shadow-yellow-400/20 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 uppercase tracking-wider"
          >
            <ShieldCheck size={16} />
            <span>Unlock Dashboard</span>
          </button>
        </form>

        <Link to="/" className="inline-flex items-center gap-1.5 text-xs text-yellow-400 hover:text-yellow-300 font-bold transition-colors">
          <ArrowLeft size={14} />
          <span>Return to Movie Portal</span>
        </Link>
      </div>
    </div>
  );
}

function AppContent() {
  const [showSplash, setShowSplash] = useState(false);

  return (
    <>
      {showSplash ? (
        <SplashScreen onFinish={() => setShowSplash(false)} />
      ) : (
        <div className="h-full min-h-full w-full bg-black flex flex-col select-none overscroll-none">
          <Header />
          <UpdateNotification />
          <main className={`flex-grow ${window.location.pathname === '/' && !new URLSearchParams(window.location.search).get('category') ? 'pb-0' : 'pb-14 sm:pb-0'}`}>
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

import { StatusBar, Style } from '@capacitor/status-bar';

export default function App() {
  useEffect(() => {
    handleRedirectResult().catch(() => {});
    
    // Initialize safe status bar theme for Android WebView
    if (Capacitor.isNativePlatform()) {
      try {
        StatusBar.setBackgroundColor({ color: '#000000' }).catch(() => {});
        StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      } catch (e) {
        console.warn('StatusBar configuration notice:', e);
      }
    }
  }, []);

  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
