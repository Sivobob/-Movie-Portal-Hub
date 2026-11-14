import React, { useState, useEffect, useRef } from 'react';
import { useAuth, isAuthorizedAdminEmail } from '../context/AuthContext';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Settings, ArrowLeft, Lock, Eye, EyeOff, X, KeyRound, LogOut, Search, Download, Smartphone } from 'lucide-react';
import { isNativeAndroid, isInstalledPhoneApp, downloadOfficialApk, OFFICIAL_APK_DOWNLOAD_URL } from '../utils/platform';
import { CURRENT_VERSION_NAME } from '../services/appUpdateConfig';

export const MoviePortal3DLogo = React.memo(function MoviePortal3DLogo() {
  return (
    <div className="flex flex-col items-center select-none text-center">
      <span
        style={{
          fontFamily: "'Bangers', cursive, system-ui",
          color: '#FFD700', // Gold/Yellow fill
          letterSpacing: '0.02em',
          WebkitTextStroke: '2.5px #E60000', // Thick red outline
          textShadow: `
            3px 3px 0 #800000,
            0px 0px 15px rgba(255, 215, 0, 0.3)
          `,
          transform: 'scale(1.1) rotate(-1deg)', // Bold presence
        }}
        className="text-4xl sm:text-5xl font-normal uppercase tracking-tight active:scale-95 transition-transform duration-150 drop-shadow-2xl"
      >
        MOVIE PORTAL
      </span>
    </div>
  );
});

export default function Header() {
  const { 
    user, 
    isAdmin, 
    loading, 
    signInWithEmail,
    handleLogout 
  } = useAuth();
  
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isAndroid = isNativeAndroid();

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [isSuccessUnlocked, setIsSuccessUnlocked] = useState(false);

  const activeCategory = searchParams.get('category');
  const isUnlockedSession = typeof window !== 'undefined' && localStorage.getItem('admin_unlocked_session') === '20180020511';
  const isAuthorizedAdmin = isAuthorizedAdminEmail(user?.email) || isUnlockedSession;
  const canAccessAdmin = (isAuthorizedAdmin && isAdmin) || isUnlockedSession;
  const isOnAdmin = location.pathname.startsWith('/admin');
  const isOnSearch = location.pathname.startsWith('/search');
  const isOnHome = location.pathname === '/' && !activeCategory;

  const handleAdminClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate('/admin');
  };

  const handleHomeClick = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate('/');
  };

  const handleSettingsClick = () => {
    setPasswordError('');
    setAdminPassword('');
    setShowSettingsModal(true);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (adminPassword.trim() === '20180020511') {
      localStorage.setItem('admin_unlocked_session', '20180020511');
      setIsSuccessUnlocked(true);
      setTimeout(() => {
        setShowSettingsModal(false);
        setIsSuccessUnlocked(false);
        setAdminPassword('');
        navigate('/admin');
      }, 350);
    } else {
      setPasswordError('Invalid admin password. Please try again.');
    }
  };

  const handleLockAdminSession = () => {
    localStorage.removeItem('admin_unlocked_session');
    handleLogout();
    setShowSettingsModal(false);
    navigate('/');
  };

  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    setIsInstalled(isInstalledPhoneApp());
  }, []);

  // -------------------------------------------------------------
  // NATIVE ANDROID APP HEADER
  // -------------------------------------------------------------
  const [showTopHeader, setShowTopHeader] = useState(true);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleScroll = () => {
      setShowTopHeader(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        if (window.scrollY > 50) {
          setShowTopHeader(false);
        }
      }, 3500);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const settingsModal = showSettingsModal ? (
    <div 
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={() => setShowSettingsModal(false)}
    >
      <div 
        className="bg-neutral-900 border border-neutral-800 rounded-3xl max-w-sm w-full p-6 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={() => setShowSettingsModal(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-1.5 rounded-full bg-neutral-800 hover:bg-neutral-700 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-yellow-400/10 border border-yellow-500/30 flex items-center justify-center text-yellow-400 shadow-md">
            <KeyRound size={24} />
          </div>
          <div>
            <h3 className="text-base font-black text-white uppercase tracking-tight">App Settings</h3>
            <p className="text-[11px] text-gray-400">Admin Panel Access</p>
          </div>
        </div>

        {isUnlockedSession ? (
          <div className="space-y-4">
            <div className="p-3 bg-neutral-950 border border-green-500/30 rounded-2xl flex items-center gap-2.5 text-xs text-green-400 font-medium">
              <ShieldCheck size={18} className="text-green-400 flex-shrink-0" />
              <span>Admin mode is currently active.</span>
            </div>

            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setShowSettingsModal(false);
                  navigate('/admin');
                }}
                className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xs py-3 px-4 rounded-xl shadow-lg shadow-yellow-400/20 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 uppercase tracking-wider"
              >
                <ShieldCheck size={16} />
                <span>Open Admin Dashboard</span>
              </button>

              <button
                type="button"
                onClick={handleLockAdminSession}
                className="w-full bg-neutral-800 hover:bg-neutral-700 text-red-400 font-bold text-xs py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut size={14} />
                <span>Lock / Exit Admin Session</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <p className="text-xs text-gray-300 leading-relaxed">
              Enter the administrator password to access movie management, uploads, and edit settings:
            </p>

            <div>
              <label className="block text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                Admin Password
              </label>
              <div className="relative">
                <input
                  type={showPasswordText ? 'text' : 'password'}
                  value={adminPassword}
                  onChange={(e) => {
                    setAdminPassword(e.target.value);
                    setPasswordError('');
                  }}
                  placeholder="Enter password..."
                  autoFocus
                  className="w-full bg-neutral-950 border border-neutral-700 focus:border-yellow-400 rounded-xl px-3.5 py-3 pr-10 text-xs text-white placeholder-gray-500 focus:outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPasswordText(!showPasswordText)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white p-1"
                  tabIndex={-1}
                >
                  {showPasswordText ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {passwordError && (
                <p className="mt-1.5 text-[11px] text-red-400 font-semibold">{passwordError}</p>
              )}
              {isSuccessUnlocked && (
                <p className="mt-1.5 text-[11px] text-green-400 font-semibold">Password verified! Unlocking admin...</p>
              )}
            </div>

            <button
              type="submit"
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xs py-3 px-4 rounded-xl shadow-lg shadow-yellow-400/20 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 uppercase tracking-wider"
            >
              <Lock size={15} />
              <span>Unlock Admin Panel</span>
            </button>
          </form>
        )}
      </div>
    </div>
  ) : null;

  if (isAndroid) {
    return (
      <>
        {/* Prominent Top Bar in Chrome/Browser */}
        {!isInstalled && isOnHome && showTopHeader && (
          <div className="w-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black px-3 py-2 flex items-center justify-between shadow-lg sticky top-0 z-50 transition-all duration-300">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-black text-yellow-400 flex items-center justify-center flex-shrink-0 shadow">
                <Smartphone size={15} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black uppercase tracking-tight text-black truncate">
                    Movie Portal Official App
                  </span>
                  <span className="bg-black/20 text-black text-[9px] font-extrabold px-1.5 py-0.2 rounded uppercase">
                    Android APK
                  </span>
                </div>
                <p className="text-[10px] font-semibold text-neutral-900 truncate">
                  High-speed streaming directly on your phone!
                </p>
              </div>
            </div>
            <a
              href={OFFICIAL_APK_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={downloadOfficialApk}
              className="ml-2 flex-shrink-0 bg-black hover:bg-neutral-900 active:scale-95 text-yellow-400 font-black text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow transition-all cursor-pointer uppercase tracking-wider no-underline"
            >
              <Download size={13} className="stroke-[2.5]" />
              <span>Download App</span>
            </a>
          </div>
        )}

        <header
          className={`w-full z-40 transition-all duration-300 ${
            showTopHeader ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0 pointer-events-none'
          } ${
            isOnHome
              ? `absolute ${!isInstalled && showTopHeader ? 'top-14' : 'top-0'} left-0 bg-transparent pt-3 sm:pt-4 pb-2 px-4`
              : 'sticky top-0 left-0 bg-black/95 backdrop-blur-md border-b border-neutral-900 pt-6 pb-3 px-4'
          }`}
        >
          <div className="max-w-7xl mx-auto flex items-center justify-end relative">
            {/* ONLY Settings Button on Top Right */}
            {!isInstalledPhoneApp() && (
              <div className="flex items-center z-10 mt-2.5">
                <button
                  type="button"
                  onClick={handleSettingsClick}
                  className="p-2.5 rounded-full bg-yellow-400 text-black border border-yellow-500 shadow-[0_0_15px_rgba(250,204,21,0.5)] cursor-pointer active:scale-90 transition-all hover:bg-yellow-300"
                  aria-label="Settings"
                  title="Settings"
                >
                  <Settings size={18} className="transition-transform hover:rotate-90 duration-300" />
                </button>
              </div>
            )}
          </div>
        </header>

        {settingsModal}
      </>
    );
  }

  // -------------------------------------------------------------
  // CHROME / BROWSER WEB VERSION
  // -------------------------------------------------------------
  return (
    <>
      {/* Prominent Top Bar in Chrome/Browser: Only visible when opened in browser, hidden inside installed app */}
      {!isInstalled && isOnHome && (
        <div className="w-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black px-4 py-2 flex items-center justify-between shadow-lg sticky top-0 z-50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-black text-yellow-400 flex items-center justify-center flex-shrink-0 shadow">
              <Smartphone size={16} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs sm:text-sm font-black uppercase tracking-tight text-black truncate">
                  Movie Portal Official Android App
                </span>
                <span className="bg-black/20 text-black text-[10px] font-extrabold px-1.5 py-0.2 rounded uppercase">
                  v{CURRENT_VERSION_NAME} APK (180MB)
                </span>
              </div>
              <p className="text-[11px] font-semibold text-neutral-900 truncate">
                Download app for high-speed streaming on your phone!
              </p>
            </div>
          </div>
          <a
            href={OFFICIAL_APK_DOWNLOAD_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={downloadOfficialApk}
            className="ml-3 flex-shrink-0 bg-black hover:bg-neutral-900 active:scale-95 text-yellow-400 font-black text-xs px-4 py-1.5 rounded-xl flex items-center gap-1.5 shadow-md transition-all cursor-pointer uppercase tracking-wider no-underline"
          >
            <Download size={14} className="stroke-[2.5]" />
            <span>Download App</span>
          </a>
        </div>
      )}

      <header className={`w-full z-40 transition-colors ${
        isOnHome
          ? `absolute ${!isInstalled ? 'top-14' : 'top-0'} left-0 bg-transparent pt-3 pb-2 px-4`
          : 'sticky top-0 left-0 bg-black/95 backdrop-blur-md border-b border-neutral-900 py-3 px-4'
      }`}>
        <div className="max-w-7xl mx-auto flex items-center justify-end relative w-full p-2">
          <div className="flex items-center gap-2 z-10">
            <button
              type="button"
              onClick={handleSettingsClick}
              className="p-2.5 rounded-full bg-yellow-400 text-black border border-yellow-500 shadow-[0_0_15px_rgba(250,204,21,0.5)] cursor-pointer active:scale-90 transition-all hover:bg-yellow-300"
              aria-label="Settings"
              title="Settings"
            >
              <Settings size={18} className="transition-transform hover:rotate-90 duration-300" />
            </button>
          </div>
        </div>
      </header>

      {settingsModal}
    </>
  );
}

