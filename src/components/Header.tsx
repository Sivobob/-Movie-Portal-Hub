import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ShieldCheck, Settings, Lock, Eye, EyeOff, X, KeyRound, LogOut, Download, Smartphone, Search, Share, PlusSquare, Copy, Check, ExternalLink } from 'lucide-react';
import {
  isNativeAndroid,
  isInstalledPhoneApp,
  isIOSDevice,
  isIOSThirdPartyOrInApp,
  getIOSVersionNumber,
  downloadOfficialApk,
  downloadIOSProfile,
  OFFICIAL_APK_DOWNLOAD_URL,
  getIOSProfileDownloadUrl,
} from '../utils/platform';
import { CURRENT_VERSION_NAME } from '../services/appUpdateConfig';

export default function Header() {
  const { handleLogout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isAndroid = isNativeAndroid();
  const isIOS = isIOSDevice();
  const isIOSNonSafari = isIOSThirdPartyOrInApp();
  const iosVersion = getIOSVersionNumber();

  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [showIOSInstallModal, setShowIOSInstallModal] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [showPasswordText, setShowPasswordText] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [isSuccessUnlocked, setIsSuccessUnlocked] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const [isInstalled, setIsInstalled] = useState(() => isInstalledPhoneApp());
  useEffect(() => {
    setIsInstalled(isInstalledPhoneApp());
  }, []);

  const [showTopHeader, setShowTopHeader] = useState(true);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isAndroid) return;
    const rootEl = document.getElementById('root');
    const handleScroll = () => {
      setShowTopHeader(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => {
        const scrollTop = window.scrollY || document.documentElement.scrollTop || (rootEl ? rootEl.scrollTop : 0);
        if (scrollTop > 50) {
          setShowTopHeader(false);
        }
      }, 3500);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    rootEl?.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      rootEl?.removeEventListener('scroll', handleScroll);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isAndroid]);

  const startLogoLongPress = () => {
    if (isInstalled) return;
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      handleSettingsClick();
    }, 650);
  };

  const cancelLogoLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

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

  if (
    location.pathname === '/downloads' ||
    location.pathname === '/me' ||
    location.pathname === '/settings' ||
    location.pathname === '/search' ||
    location.pathname === '/admin'
  ) {
    return (
      <>
        {!isInstalled && settingsModal}
      </>
    );
  }

  return (
    <>
      <header
        className={`sticky top-0 left-0 right-0 z-40 w-full bg-black transition-all duration-300 ${
          isAndroid && !showTopHeader ? '-translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
        }`}
      >
        {showPromoBar && (
          <div className="w-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black px-3 sm:px-4 py-1.5 pt-[max(0.45rem,env(safe-area-inset-top))] flex items-center justify-between gap-2 shadow-lg">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-7 h-7 rounded-lg overflow-hidden bg-[#15191e] flex items-center justify-center flex-shrink-0 shadow">
                <img src="/assets/icons/master_icon.png" alt="Movie Hub" className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[11px] sm:text-sm font-black uppercase tracking-tight text-black truncate">
                    {isIOS ? 'Movie Hub for iPhone' : 'Movie Hub App'}
                  </span>
                  <span className="hidden xs:inline-block sm:inline-block bg-black/20 text-black text-[9px] sm:text-[10px] font-extrabold px-1.5 py-0.5 rounded uppercase flex-shrink-0">
                    {isIOS ? 'All iOS' : `v${CURRENT_VERSION_NAME}`}
                  </span>
                </div>
                <p className="text-[10px] sm:text-[11px] font-semibold text-neutral-900 truncate">
                  {isIOS ? 'Install app directly on any iPhone & iOS!' : 'High-speed streaming on Android!'}
                </p>
              </div>
            </div>
            {isIOS ? (
              <button
                type="button"
                onClick={() => setShowIOSInstallModal(true)}
                className="flex-shrink-0 bg-black hover:bg-neutral-900 active:scale-95 text-yellow-400 font-black text-[11px] sm:text-xs px-2.5 sm:px-4 py-1.5 rounded-xl flex items-center gap-1.5 shadow transition-all cursor-pointer uppercase tracking-wider whitespace-nowrap"
              >
                <Download size={13} className="stroke-[2.5]" />
                <span>Get App</span>
              </button>
            ) : (
              <a
                href={OFFICIAL_APK_DOWNLOAD_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  downloadOfficialApk(e);
                  setShowInstallGuide(true);
                }}
                className="flex-shrink-0 bg-black hover:bg-neutral-900 active:scale-95 text-yellow-400 font-black text-[11px] sm:text-xs px-2.5 sm:px-4 py-1.5 rounded-xl flex items-center gap-1.5 shadow transition-all cursor-pointer uppercase tracking-wider no-underline whitespace-nowrap"
              >
                <Download size={13} className="stroke-[2.5]" />
                <span>Get App</span>
              </a>
            )}
          </div>
        )}

        {/* Top Bar Matching Screenshot: Blue/Cyan Play-Download Icon + Full-Width Charcoal Search Bar with Green Search Text */}
        <div
          className={`max-w-7xl mx-auto flex items-center gap-3 px-3.5 sm:px-6 pb-2 bg-black ${
            showPromoBar ? 'pt-2' : 'pt-[max(0.65rem,env(safe-area-inset-top))]'
          }`}
        >
          <button
            type="button"
            onClick={() => navigate('/')}
            onDoubleClick={() => {
              if (!isInstalled) handleSettingsClick();
            }}
            onTouchStart={startLogoLongPress}
            onTouchEnd={cancelLogoLongPress}
            onTouchCancel={cancelLogoLongPress}
            className="w-10 h-10 flex items-center justify-center flex-shrink-0 cursor-pointer active:scale-95 transition-transform rounded-xl overflow-hidden shadow-lg border border-white/15 bg-[#15191e]"
            aria-label="Movie Hub Home"
          >
            <img
              src="/assets/icons/master_icon.png"
              alt="Movie Hub"
              className="w-full h-full object-cover"
            />
          </button>

          <button
            type="button"
            onClick={() => navigate('/search')}
            aria-label="Search movies and series"
            className="flex-1 flex items-center justify-between gap-2.5 h-[42px] bg-[#2a2d30] hover:bg-[#313538] active:bg-[#35393e] rounded-lg px-3.5 transition-colors min-w-0 cursor-pointer text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Search size={19} className="text-[#c5c9cf] flex-shrink-0 stroke-[2]" />
              <span className="truncate text-[15px] font-normal text-[#c5c9cf]">
                Search movies, series...
              </span>
            </div>
            <span className="text-[#2de38a] font-semibold text-[15px] tracking-tight whitespace-nowrap flex-shrink-0">
              Search
            </span>
          </button>

          {!isInstalled && (
            <button
              type="button"
              onClick={handleSettingsClick}
              className="w-[42px] h-[42px] rounded-lg bg-[#2a2d30] hover:bg-[#313538] text-[#c5c9cf] hover:text-white flex items-center justify-center flex-shrink-0 cursor-pointer active:scale-95 transition-all"
              aria-label="Settings / Admin"
              title="Settings / Admin"
            >
              <Settings size={19} className="transition-transform hover:rotate-90 duration-300" />
            </button>
          )}
        </div>
      </header>

      {!isInstalled && settingsModal}
      {showInstallGuide && !isInstalled && !isIOS && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowInstallGuide(false)}
        >
          <div
            className="w-full max-w-sm bg-neutral-900 border border-yellow-400/50 rounded-2xl p-5 text-white shadow-2xl space-y-3.5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Smartphone size={18} className="text-yellow-400" />
                <h3 className="font-black text-sm uppercase tracking-wide text-yellow-400">
                  APK Downloading...
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowInstallGuide(false)}
                className="p-1 text-gray-400 hover:text-white cursor-pointer"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-xs text-gray-300 leading-relaxed">
              Open <strong className="text-white">Movie-Portal.apk</strong> from Chrome Downloads once complete. If your phone asks for permission:
            </p>
            <ul className="text-xs text-gray-300 space-y-2 bg-neutral-950 border border-neutral-800 rounded-xl p-3">
              <li>
                <strong className="text-yellow-400">1. Xiaomi / Redmi / POCO:</strong> Tap Settings, tick <span className="text-white font-semibold">"I&apos;m aware of the possible risks"</span>, wait 10 sec, tap <span className="text-white font-semibold">OK</span>, then tap <span className="text-white font-semibold">Install</span>.
              </li>
              <li>
                <strong className="text-yellow-400">2. Play Protect warning:</strong> Tap <span className="text-white font-semibold">More details</span> &rarr; <span className="text-white font-semibold">Install anyway</span>.
              </li>
            </ul>
            <button
              type="button"
              onClick={() => setShowInstallGuide(false)}
              className="w-full bg-yellow-400 hover:bg-yellow-300 text-black font-black text-xs py-2.5 rounded-xl uppercase tracking-wider cursor-pointer"
            >
              Got It
            </button>
          </div>
        </div>
      )}

      {showIOSInstallModal && !isInstalled && (
        <div
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setShowIOSInstallModal(false)}
        >
          <div
            className="w-full max-w-md bg-neutral-900 border border-yellow-400/40 rounded-t-3xl sm:rounded-3xl p-5 text-white shadow-2xl space-y-4 max-h-[88dvh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src="/apple-touch-icon.png"
                  alt="Movie Hub"
                  className="w-12 h-12 rounded-2xl object-cover border border-white/15 bg-[#15191e] flex-shrink-0 shadow-md"
                />
                <div className="min-w-0">
                  <h3 className="font-black text-base tracking-tight text-white">
                    Download Movie Hub for iPhone
                  </h3>
                  <p className="text-[11px] text-neutral-400">
                    Works on all iPhones &amp; all iOS versions (iOS 12 &ndash; iOS 18+)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowIOSInstallModal(false)}
                className="p-1.5 rounded-full bg-neutral-800 text-gray-400 hover:text-white cursor-pointer flex-shrink-0"
                aria-label="Close"
              >
                <X size={17} />
              </button>
            </div>

            {isIOSNonSafari && (
              <div className="bg-amber-500/10 border border-amber-400/30 rounded-2xl p-3 space-y-2">
                <p className="text-xs text-amber-200 leading-relaxed">
                  For direct iPhone app installation, open this link in <strong className="text-white">Safari</strong> (or use <strong className="text-white">Share &rarr; Add to Home Screen</strong> on iOS 16.4+).
                </p>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      navigator.clipboard.writeText(window.location.origin);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2500);
                    } catch {}
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-neutral-950 border border-white/15 text-xs font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {copiedLink ? <Check size={14} className="text-[#00d664]" /> : <Copy size={14} className="text-yellow-400" />}
                  <span>{copiedLink ? 'Link Copied! Paste in Safari' : 'Copy Movie Hub Link for Safari'}</span>
                </button>
              </div>
            )}

            {/* Option 1: Direct iPhone App Profile Download (.mobileconfig) */}
            <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-yellow-400">
                  Method 1: Direct iPhone Download
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-yellow-400/15 text-yellow-300">
                  Safari
                </span>
              </div>
              <div className="flex gap-2">
                <a
                  href={getIOSProfileDownloadUrl()}
                  onClick={(e) => downloadIOSProfile(e)}
                  className="flex-1 bg-yellow-400 hover:bg-yellow-300 active:scale-95 text-black font-black text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 uppercase tracking-wider shadow-lg shadow-yellow-400/15 no-underline cursor-pointer"
                >
                  <Download size={15} className="stroke-[2.5]" />
                  <span>Download iPhone App</span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const fullUrl = window.location.origin + getIOSProfileDownloadUrl();
                      navigator.clipboard.writeText(fullUrl);
                      setCopiedLink(true);
                      setTimeout(() => setCopiedLink(false), 2500);
                    } catch {}
                  }}
                  className="px-3.5 py-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-yellow-400 text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                  title="Copy Direct Profile Link"
                >
                  {copiedLink ? <Check size={16} className="text-[#00d664]" /> : <Copy size={16} />}
                </button>
              </div>
              <ol className="text-[11px] text-gray-300 space-y-1 pl-1 leading-relaxed">
                <li>
                  1. Tap <strong className="text-white">Allow</strong> when iPhone asks to download the profile.
                </li>
                <li>
                  2. Open iPhone <strong className="text-white">Settings</strong> &rarr; tap <strong className="text-white">Profile Downloaded</strong> (or <span className="text-white font-semibold">General &rarr; {iosVersion && iosVersion < 15 ? 'Profile' : 'VPN & Device Management'}</span>) &rarr; tap <strong className="text-white">Install</strong>.
                </li>
              </ol>
            </div>

            {/* Option 2: Instant Add to Home Screen (No Settings needed) */}
            <div className="bg-neutral-950 border border-neutral-800 rounded-2xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black uppercase tracking-wider text-[#00d664]">
                  Method 2: Instant 1-Tap Setup
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-[#00d664]/15 text-[#00d664]">
                  All iOS
                </span>
              </div>
              <div className="space-y-2 text-xs text-gray-300">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-neutral-800 flex items-center justify-center text-sky-400 flex-shrink-0">
                    <Share size={15} />
                  </div>
                  <p>
                    1. Tap the <strong className="text-white">Share</strong> icon at the bottom (or top) of Safari.
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-neutral-800 flex items-center justify-center text-[#00d664] flex-shrink-0">
                    <PlusSquare size={15} />
                  </div>
                  <p>
                    2. Scroll down and tap <strong className="text-white">Add to Home Screen</strong>.
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-neutral-800 flex items-center justify-center text-yellow-400 flex-shrink-0">
                    <ExternalLink size={15} />
                  </div>
                  <p>
                    3. Tap <strong className="text-white">Add</strong> &mdash; launch <strong className="text-white">Movie Hub</strong> fullscreen from your Home Screen!
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowIOSInstallModal(false)}
              className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs py-2.5 rounded-xl uppercase tracking-wider cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
