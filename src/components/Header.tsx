import React, { useState, useEffect } from 'react';
import { useAuth, isAuthorizedAdminEmail } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { ShieldCheck, Settings, ArrowLeft, Lock, Eye, EyeOff, X, KeyRound, LogOut, Search, Download, Smartphone } from 'lucide-react';
import { isNativeAndroid, isInstalledPhoneApp, downloadOfficialApk } from '../utils/platform';

export function MoviePortal3DLogo() {
  return (
    <div className="flex flex-col items-center select-none text-center">
      <span
        style={{
          fontFamily: "'Impact', 'Arial Black', -apple-system, sans-serif",
          color: '#FFE200',
          letterSpacing: '0.04em',
          textShadow: `
            -2px -2px 0 #D60000,
             2px -2px 0 #D60000,
            -2px  2px 0 #D60000,
             2px  2px 0 #D60000,
             0px  3px 0 #9E0000,
             0px  4.5px 0 #600000,
             0px  7px 16px rgba(0, 0, 0, 0.95)
          `,
        }}
        className="text-2xl sm:text-3xl font-black uppercase tracking-wider active:scale-95 transition-transform duration-150 drop-shadow-lg"
      >
        MOVIE PORTAL
      </span>
    </div>
  );
}

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
  const isAndroid = isNativeAndroid();

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [isSuccessUnlocked, setIsSuccessUnlocked] = useState(false);

  const isUnlockedSession = typeof window !== 'undefined' && localStorage.getItem('admin_unlocked_session') === '20180020511';
  const isAuthorizedAdmin = isAuthorizedAdminEmail(user?.email) || isUnlockedSession;
  const canAccessAdmin = (isAuthorizedAdmin && isAdmin) || isUnlockedSession;
  const isOnAdmin = location.pathname.startsWith('/admin');
  const isOnSearch = location.pathname.startsWith('/search');
  const isOnHome = location.pathname === '/';

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
      signInWithEmail('adityaantil260@gmail.com');
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
  if (isAndroid) {
    return (
      <>
        {/* Prominent Top Bar in Chrome/Browser: Only visible when opened in browser, hidden inside installed app */}
        {!isInstalled && (
          <div className="w-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black px-3 py-2 flex items-center justify-between shadow-lg sticky top-0 z-50">
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
                  High-speed streaming & direct phone downloads!
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={downloadOfficialApk}
              className="ml-2 flex-shrink-0 bg-black hover:bg-neutral-900 active:scale-95 text-yellow-400 font-black text-xs px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 shadow transition-all cursor-pointer uppercase tracking-wider"
            >
              <Download size={13} className="stroke-[2.5]" />
              <span>Download App</span>
            </button>
          </div>
        )}

        <header
          className={`w-full z-40 transition-colors ${
            isOnHome
              ? 'absolute top-0 left-0 bg-gradient-to-b from-black/85 via-black/45 to-transparent pt-3 pb-4 px-4'
              : 'sticky top-0 left-0 bg-black/95 backdrop-blur-md border-b border-neutral-900 py-3.5 px-4'
          } ${!isInstalled ? 'mt-0' : ''}`}
        >
          <div className="max-w-7xl mx-auto flex items-center justify-between relative">
            {/* Left Spacer so 3D Logo stays perfectly centered without UI back or search buttons */}
            <div className="w-10 flex items-center justify-start z-10 pointer-events-none" />

            {/* Top-Center 3D MOVIE PORTAL Logo shifted downward ~18px while keeping centered */}
            <div 
              onClick={handleHomeClick}
              className="absolute left-1/2 -translate-x-1/2 translate-y-[18px] cursor-pointer flex flex-col items-center z-10"
            >
              <MoviePortal3DLogo />
            </div>

            {/* Right Action: Direct Download App Button (Browser Only) + Settings ⚙️ */}
            <div className="flex items-center gap-2 z-10">
              {!isInstalled && (
                <button
                  type="button"
                  onClick={downloadOfficialApk}
                  className="p-2 rounded-full bg-yellow-400 hover:bg-yellow-300 text-black font-black border border-yellow-500 backdrop-blur-md cursor-pointer active:scale-90 transition-transform shadow-md flex items-center gap-1 text-[10px]"
                  title="Direct Download Movie Portal APK"
                >
                  <Download size={15} className="stroke-[2.5]" />
                  <span className="hidden xs:inline uppercase font-extrabold">App</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleSettingsClick}
                className={`p-1.5 rounded-full border backdrop-blur-md cursor-pointer active:scale-90 transition-all ${
                  isUnlockedSession
                    ? 'bg-yellow-400/20 text-yellow-400 border-yellow-400/70 shadow-lg shadow-yellow-400/20'
                    : 'bg-black/60 text-yellow-400 border-yellow-400/30 hover:border-yellow-400/60'
                }`}
                aria-label="Settings"
                title="Settings"
              >
                <Settings size={15} className="transition-transform hover:rotate-90 duration-300" />
              </button>
            </div>
          </div>
        </header>

        {/* Android App Settings & Admin Password Modal */}
        {showSettingsModal && (
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
        )}
      </>
    );
  }

  // -------------------------------------------------------------
  // CHROME / BROWSER WEB VERSION
  // -------------------------------------------------------------
  return (
    <>
      {/* Prominent Top Bar in Chrome/Browser: Only visible when opened in browser, hidden inside installed app */}
      {!isInstalled && (
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
                  v2.5.0 APK
                </span>
              </div>
              <p className="text-[11px] font-semibold text-neutral-900 truncate">
                Download app for high-speed streaming & direct phone downloads!
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={downloadOfficialApk}
            className="ml-3 flex-shrink-0 bg-black hover:bg-neutral-900 active:scale-95 text-yellow-400 font-black text-xs px-4 py-1.5 rounded-xl flex items-center gap-1.5 shadow-md transition-all cursor-pointer uppercase tracking-wider"
          >
            <Download size={14} className="stroke-[2.5]" />
            <span>Download App</span>
          </button>
        </div>
      )}

      <header className="sticky top-0 left-0 w-full p-4 flex justify-between items-center z-40 bg-black/90 backdrop-blur-md border-b border-neutral-900">
        <div 
          onClick={handleHomeClick}
          className="cursor-pointer flex flex-col items-start select-none"
        >
          <h1 className="text-yellow-400 font-extrabold text-sm sm:text-base tracking-widest uppercase flex items-center gap-1.5">
            <span>MOVIE PORTAL</span>
            <span className="text-[9px] bg-yellow-400/20 text-yellow-400 font-mono font-bold px-1.5 py-0.2 rounded border border-yellow-400/30">PRO</span>
          </h1>
          <span className="text-[9px] text-gray-500 tracking-wider">THE ULTIMATE MOVIE HUB</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {!isInstalled && (
            <button
              type="button"
              onClick={downloadOfficialApk}
              className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-black px-3.5 py-2 rounded-xl shadow-lg shadow-yellow-400/20 active:scale-95 transition-all cursor-pointer uppercase tracking-wider"
              title="Direct Download Movie Portal Android App"
            >
              <Smartphone size={14} />
              <Download size={14} className="stroke-[2.5]" />
              <span>Download App</span>
            </button>
          )}
          {loading ? (
            <span className="text-xs text-gray-500 animate-pulse">Loading...</span>
          ) : user ? (
            <div className="flex gap-2 items-center">
              {/* User Identity Pill */}
              <div className="hidden sm:flex items-center gap-1.5 bg-neutral-900/90 border border-neutral-800 rounded-full py-1 px-2.5 text-[11px] text-gray-300">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                <span className="max-w-[160px] truncate font-medium text-gray-200">
                  {user.email || user.displayName || 'User'}
                </span>
                {canAccessAdmin && (
                  <span className="bg-yellow-400/20 text-yellow-400 text-[9px] font-black px-1.5 py-0.2 rounded border border-yellow-400/30 uppercase">
                    Admin
                  </span>
                )}
              </div>

              {canAccessAdmin && (
                <button
                  type="button"
                  onClick={handleAdminClick}
                  className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all border flex items-center gap-1.5 cursor-pointer ${
                    isOnAdmin
                      ? 'bg-yellow-400 text-black border-yellow-400 shadow-md shadow-yellow-500/20'
                      : 'text-yellow-400 border-yellow-500/50 hover:bg-yellow-400/10'
                  }`}
                >
                  <ShieldCheck size={14} />
                  <span>Admin Panel</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => handleLogout()}
                className="px-2.5 py-1.5 rounded-lg text-xs text-gray-300 hover:text-white bg-neutral-900 border border-neutral-800 hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </header>
    </>
  );
}

