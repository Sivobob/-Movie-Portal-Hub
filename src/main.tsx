import React, { Component, ErrorInfo, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './context/AuthContext';

if (typeof window !== 'undefined' && !Capacitor.isNativePlatform()) {
  try {
    // Clean up any stale/uncontrolled service workers that may be serving
    // blank or outdated cached content in the preview iframe.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) {
          const scriptURL = reg.active?.scriptURL || '';
          if (scriptURL.includes('dev-sw.js') || scriptURL.includes('/sw.js')) {
            reg.unregister().catch(() => {});
          }
        }
      }).catch(() => {});
    }

    let refreshing = false;
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    }
    registerSW({
      immediate: true,
      onRegisteredSW(_swUrl, reg) {
        if (reg) {
          reg.update().catch(() => {});
        }
      },
    });
  } catch {}
}

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught startup error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-3xl max-w-sm w-full shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-yellow-400/10 border border-yellow-500/30 flex items-center justify-center text-yellow-400 mx-auto mb-4 font-black text-xl">
              !
            </div>
            <h2 className="text-lg font-black text-white uppercase tracking-tight mb-2">Movie Hub</h2>
            <p className="text-xs text-gray-400 mb-6 leading-relaxed">
              The application encountered a temporary setup notice. Tap below to reload.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xs py-3 px-4 rounded-xl shadow-lg transition-all uppercase tracking-wider cursor-pointer"
            >
              Reload Movie Hub
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
