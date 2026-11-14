import React, { useState, useEffect, useRef } from 'react';
import { useAuth, isAuthorizedAdminEmail } from '../context/AuthContext';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Settings, Lock, Eye, EyeOff, X, KeyRound, LogOut, Download, Smartphone } from 'lucide-react';
import { isNativeAndroid, isInstalledPhoneApp, downloadOfficialApk, OFFICIAL_APK_DOWNLOAD_URL } from '../utils/platform';
import { CURRENT_VERSION_NAME } from '../services/appUpdateConfig';

export const MoviePortal3DLogo = React.memo(function MoviePortal3DLogo() {
  return (
    <div className="flex flex-col items-center select-none text-center">
      <span
        style={{
          fontFamily: "'Bangers', cursive, system-ui",
          color: '#FFD700',
          letterSpacing: '0.02em',
          WebkitTextStroke: '2.5px #E60000',
          textShadow: `
            3px 3px 0 #800000,
            0px 0px 15px rgba(255, 215, 0, 0.3)
          `,
          transform: 'scale(1.06) rotate(-1deg)',
        }}
        className="text-3xl sm:text-5xl font-normal uppercase tracking-tight active:scale-95 transition-transform duration-150 drop-shadow-2xl"
      >
        MOVIE PORTAL
      </span>
    </div>
  );
});

export default function Header() {
  const { user, handleLogout } = useAuth();
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
  const isOnHome = location.pathname === '/' && !activeCategory;

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

  const [showTopHeader, setShowTopHeader] = useState(true);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isAndroid) return;
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
  }, [isAndroid]);

  const settingsModal = showSettingsModal ? (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={() => setShowSettingsModal(false)}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-3xl max-w-sm w-full p-5 sm:p-6 shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setShowSettingsModal(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-white p-1.5 rounded-full bg-neutral-800 hover:bg-neutral-700 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X size={16} />
        </button>

        <div className="flex items-center gap-3 mb-5 pr-8">
          <div className="w-11 h-11 rounded-2xl bg-yellow-400/10 border border-yellow-500/30 flex items-center justify-center text-yellow-400 shadow-md flex-shrink-0">
            <KeyRound size={22} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-black text-white uppercase tracking-tight">App Settings</h3>
            <p className="text-[11px] text-gray-400 truncate">Admin Panel Access</p>
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

  const showPromoBar = !isInstalled && isOnHome && (!isAndroid || showTopHeader);
  const showSettingsGear = !isAndroid || !isInstalled;

  if (isOnHome) {
    return (
      <>
        <div
          className={`fixed top-0 left-0 right-0 z-40 pointer-events-none transition-all duration-300 ${
            isAndroid && !showTopHeader ? '-translate-y-full opacity-0' : 'translate-y-0 opacity-100'
          }`}
        >
          {showPromoBar && (
            <div className="pointer-events-auto w-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black px-2.5 sm:px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] flex items-center justify-between gap-2 shadow-lg">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-7 h-7 rounded-lg bg-black text-yellow-400 flex items-center justify-center flex-shrink-0 shadow">
                  <Smartphone size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] sm:text-sm font-black uppercase tracking-tight text-black truncate">
                      Movie Portal App
                    </span>
                    <span className="hidden xs:inline-block sm:inline-block bg-black/20 text-black text-[9px] sm:text-[10px] font-extrabold px-1.5 py-0.5 rounded uppercase flex-shrink-0">
                      v{CURRENT_VERSION_NAME}
                    </span>
                  </div>
                  <p className="text-[10px] sm:text-[11px] font-semibold text-neutral-900 truncate">
                    High-speed streaming on Android!
                  </p>
                </div>
              </div>
              <a
                href={OFFICIAL_APK_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={downloadOfficialApk}
                className="flex-shrink-0 bg-black hover:bg-neutral-900 active:scale-95 text-yellow-400 font-black text-[11px] sm:text-xs px-2.5 sm:px-4 py-1.5 rounded-xl flex items-center gap-1.5 shadow transition-all cursor-pointer uppercase tracking-wider no-underline whitespace-nowrap"
              >
                <Download size={13} className="stroke-[2.5]" />
                <span>Get App</span>
              </a>
            </div>
          )}

          {showSettingsGear && (
            <div
              className={`max-w-7xl mx-auto flex items-center justify-end px-3 sm:px-4 ${
                showPromoBar ? 'pt-2.5' : 'pt-[max(0.75rem,env(safe-area-inset-top))]'
              }`}
            >
              <button
                type="button"
                onClick={handleSettingsClick}
                className="pointer-events-auto p-2.5 rounded-full bg-yellow-400 text-black border border-yellow-500 shadow-[0_0_15px_rgba(250,204,21,0.5)] cursor-pointer active:scale-90 transition-all hover:bg-yellow-300"
                aria-label="Settings"
                title="Settings"
              >
                <Settings size={18} className="transition-transform hover:rotate-90 duration-300" />
              </button>
            </div>
          )}
        </div>
        {settingsModal}
      </>
    );
  }

  return (
    <>
      <header
        className={`w-full z-40 sticky top-0 left-0 bg-black/95 backdrop-blur-md border-b border-neutral-900 px-3 sm:px-4 py-2.5 pt-[max(0.65rem,env(safe-area-inset-top))] transition-all duration-300 ${
          isAndroid && !showTopHeader ? '-translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
        }`}
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between w-full">
          <div className="min-w-0" />
          {showSettingsGear && (
            <button
              type="button"
              onClick={handleSettingsClick}
              className="p-2 rounded-full bg-yellow-400 text-black border border-yellow-500 shadow-[0_0_15px_rgba(250,204,21,0.5)] cursor-pointer active:scale-90 transition-all hover:bg-yellow-300"
              aria-label="Settings"
              title="Settings"
            >
              <Settings size={18} className="transition-transform hover:rotate-90 duration-300" />
            </button>
          )}
        </div>
      </header>
      {settingsModal}
    </>
  );
}
