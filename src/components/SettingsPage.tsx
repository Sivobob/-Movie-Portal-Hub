import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import {
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  Bell,
  Download,
  RefreshCw,
  Trash2,
  Shield,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { loginWithGoogle } from '../services/authService';
import {
  AppPreferences,
  getAppPreferences,
  saveAppPreferences,
} from '../services/userPreferencesService';
import { clearWatchHistory } from '../services/userWatchService';
import {
  CURRENT_VERSION_NAME,
  fetchRemoteUpdateConfig,
  getInstalledAppVersion,
  isAppUpdateRequired,
  OFFICIAL_APK_DIRECT_URL,
  RemoteUpdateConfig,
  InstalledAppVersion,
} from '../services/appUpdateConfig';
import { isNativeAndroid } from '../utils/platform';

type SettingsModal =
  | 'none'
  | 'notifications'
  | 'language'
  | 'watch_options'
  | 'privacy'
  | 'check_update'
  | 'about'
  | 'privacy_policy';

const LANGUAGE_OPTIONS = [
  'Hindi',
  'English',
  'Tamil',
  'Telugu',
  'Spanish',
  'French',
  'German',
  'Japanese',
  'Korean',
];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, handleLogout } = useAuth();
  const uid = user?.uid || 'guest_user';

  const [prefs, setPrefs] = useState<AppPreferences>(() => getAppPreferences());
  const [activeModal, setActiveModal] = useState<SettingsModal>('none');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [notifPermGranted, setNotifPermGranted] = useState<boolean>(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installedVer, setInstalledVer] = useState<InstalledAppVersion | null>(null);
  const [remoteConfig, setRemoteConfig] = useState<RemoteUpdateConfig | null>(null);

  useEffect(() => {
    const refreshNotifState = () => {
      if (isNativeAndroid()) {
        try {
          const bridge = (window as any).AndroidPlayerBridge;
          if (bridge && typeof bridge.hasNotificationPermission === 'function') {
            setNotifPermGranted(Boolean(bridge.hasNotificationPermission()));
            return;
          }
        } catch {}
      }
      if (typeof window !== 'undefined' && 'Notification' in window) {
        setNotifPermGranted(Notification.permission === 'granted');
      }
    };
    refreshNotifState();
    window.addEventListener('focus', refreshNotifState);
    return () => window.removeEventListener('focus', refreshNotifState);
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let listener: any = null;
    import('@capacitor/app')
      .then(({ App: CapApp }) => {
        listener = CapApp.addListener('backButton', () => {
          if (activeModal !== 'none') {
            setActiveModal('none');
          } else {
            navigate('/me');
          }
        });
      })
      .catch(() => {});
    return () => {
      if (listener && typeof listener.remove === 'function') listener.remove();
    };
  }, [activeModal, navigate]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2600);
  };

  const updatePrefs = async (partial: Partial<AppPreferences>) => {
    const next = await saveAppPreferences(partial, user?.uid);
    setPrefs(next);
  };

  const handleToggleFamilyMode = async () => {
    const nextVal = !prefs.familyMode;
    await updatePrefs({ familyMode: nextVal });
    showToast(nextVal ? 'Family Mode enabled' : 'Family Mode disabled');
  };

  const handleRequestNotifications = async () => {
    if (isNativeAndroid()) {
      try {
        const bridge = (window as any).AndroidPlayerBridge;
        if (bridge && typeof bridge.requestNotificationPermission === 'function') {
          bridge.requestNotificationPermission();
        }
      } catch {}
    } else if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const perm = await Notification.requestPermission();
        setNotifPermGranted(perm === 'granted');
      } catch {}
    }
    const next = !prefs.notificationsEnabled;
    await updatePrefs({ notificationsEnabled: next });
    showToast(next ? 'Notifications enabled' : 'Notifications paused');
  };

  const handleOpenCheckUpdate = async () => {
    setActiveModal('check_update');
    setCheckingUpdate(true);
    try {
      const [inst, remote] = await Promise.all([
        getInstalledAppVersion(),
        fetchRemoteUpdateConfig(),
      ]);
      setInstalledVer(inst);
      setRemoteConfig(remote);
    } catch {}
    setCheckingUpdate(false);
  };

  const handleTriggerApkUpdate = () => {
    const url = remoteConfig?.apkDownloadUrl || OFFICIAL_APK_DIRECT_URL;
    if (isNativeAndroid()) {
      try {
        const bridge = (window as any).AndroidPlayerBridge;
        if (bridge && typeof bridge.downloadAndInstallApk === 'function') {
          bridge.downloadAndInstallApk(url);
          showToast('Starting APK download...');
          return;
        }
        if (bridge && typeof bridge.openApkDownloadInBrowser === 'function') {
          bridge.openApkDownloadInBrowser(url);
          return;
        }
      } catch {}
    }
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      if (document.body.contains(a)) document.body.removeChild(a);
    }, 300);
  };

  const handleAuthAction = async () => {
    if (user) {
      await handleLogout();
      showToast('Signed out');
      return;
    }
    setAuthBusy(true);
    try {
      const res: any = await loginWithGoogle();
      if (res?.cancelled) {
        showToast('Sign-in cancelled');
      } else if (res?.user || res?.sessionUser) {
        showToast('Signed in successfully');
      }
    } catch {
      showToast('Could not complete sign-in');
    } finally {
      setAuthBusy(false);
    }
  };

  const hasNewerVersion =
    installedVer && remoteConfig ? isAppUpdateRequired(installedVer, remoteConfig) : false;

  return (
    <div className="min-h-[100dvh] w-full bg-[#111317] text-white flex flex-col select-none">
      {toastMsg && (
        <div className="fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[120] bg-[#1e222b] border border-white/15 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-2xl flex items-center gap-2">
          <CheckCircle2 size={14} className="text-[#00d664]" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header matching Screenshot 4 */}
      <header className="px-4 py-3.5 pt-[max(0.9rem,env(safe-area-inset-top))] flex items-center justify-between sticky top-0 z-20 bg-[#111317]/95 backdrop-blur-md">
        <button
          type="button"
          onClick={() => navigate('/me')}
          className="p-1.5 -ml-1.5 text-white hover:text-neutral-300 cursor-pointer"
          aria-label="Back"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="text-lg font-bold text-white tracking-tight">Settings</h1>
        <div className="w-8" />
      </header>

      {/* Main Content */}
      <div className="flex-1 px-4 pb-28 max-w-lg w-full mx-auto space-y-5 pt-1">
        {/* Section 1: Your app and preferences */}
        <div>
          <h2 className="text-xs sm:text-sm font-medium text-neutral-400 mb-2 px-1">
            Your app and preferences
          </h2>
          <div className="bg-[#1b1e24] rounded-2xl border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden">
            {/* Notifications */}
            <button
              type="button"
              onClick={() => setActiveModal('notifications')}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] cursor-pointer text-left"
            >
              <span className="text-sm sm:text-[15px] font-medium text-white">Notifications</span>
              <ChevronRight size={17} className="text-neutral-400" />
            </button>

            {/* Language */}
            <button
              type="button"
              onClick={() => setActiveModal('language')}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] cursor-pointer text-left"
            >
              <span className="text-sm sm:text-[15px] font-medium text-white">Language</span>
              <div className="flex items-center gap-1.5 text-neutral-400">
                <span className="text-xs sm:text-sm">{prefs.preferredLanguage}</span>
                <ChevronRight size={17} />
              </div>
            </button>

            {/* Watch Options */}
            <button
              type="button"
              onClick={() => setActiveModal('watch_options')}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] cursor-pointer text-left"
            >
              <span className="text-sm sm:text-[15px] font-medium text-white">Watch Options</span>
              <div className="flex items-center gap-1.5 text-neutral-400">
                <span className="text-xs sm:text-sm">{prefs.watchOption}</span>
                <ChevronRight size={17} />
              </div>
            </button>

            {/* Family Mode (Toggle + helper text matching Screenshot 4) */}
            <div className="px-4 py-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm sm:text-[15px] font-medium text-white">Family Mode</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={prefs.familyMode}
                  onClick={handleToggleFamilyMode}
                  className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer flex-shrink-0 ${
                    prefs.familyMode ? 'bg-[#00d664]' : 'bg-[#353944]'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                      prefs.familyMode ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>
              <p className="text-xs text-neutral-400 leading-relaxed">
                This helps hide potentially mature videos. No filter is 100% accurate.
              </p>
            </div>

            {/* Privacy Settings */}
            <button
              type="button"
              onClick={() => setActiveModal('privacy')}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] cursor-pointer text-left"
            >
              <span className="text-sm sm:text-[15px] font-medium text-white">Privacy Settings</span>
              <ChevronRight size={17} className="text-neutral-400" />
            </button>
          </div>
        </div>

        {/* Section 2: More info and support */}
        <div>
          <h2 className="text-xs sm:text-sm font-medium text-neutral-400 mb-2 px-1">
            More info and support
          </h2>
          <div className="bg-[#1b1e24] rounded-2xl border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden">
            <button
              type="button"
              onClick={handleOpenCheckUpdate}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] cursor-pointer text-left"
            >
              <span className="text-sm sm:text-[15px] font-medium text-white">Check update</span>
              <ChevronRight size={17} className="text-neutral-400" />
            </button>

            <button
              type="button"
              onClick={() => setActiveModal('about')}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] cursor-pointer text-left"
            >
              <span className="text-sm sm:text-[15px] font-medium text-white">About us</span>
              <ChevronRight size={17} className="text-neutral-400" />
            </button>

            <button
              type="button"
              onClick={() => setActiveModal('privacy_policy')}
              className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] cursor-pointer text-left"
            >
              <span className="text-sm sm:text-[15px] font-medium text-white">Privacy Policy</span>
              <ChevronRight size={17} className="text-neutral-400" />
            </button>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Emerald CTA (Screenshot 4) */}
      <div className="fixed bottom-0 left-0 right-0 z-20 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-[#111317] via-[#111317] to-transparent">
        <div className="max-w-lg mx-auto">
          <button
            type="button"
            onClick={handleAuthAction}
            disabled={authBusy}
            className="w-full py-3.5 px-6 rounded-xl bg-[#00d664] hover:bg-[#00bf59] disabled:opacity-60 active:scale-[0.99] text-black font-bold text-sm sm:text-base transition-all cursor-pointer shadow-lg"
          >
            {authBusy
              ? 'Please wait...'
              : user
              ? `Sign out (${user.email || user.displayName || 'User'})`
              : 'Log in/Sign up'}
          </button>
        </div>
      </div>

      {/* MODALS FOR EACH WORKING SETTING */}
      {activeModal !== 'none' && (
        <div
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => setActiveModal('none')}
        >
          <div
            className="w-full max-w-md bg-[#191d24] border border-white/15 rounded-t-3xl sm:rounded-2xl p-5 space-y-4 max-h-[82dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                {activeModal === 'notifications' && 'Notifications'}
                {activeModal === 'language' && 'Preferred Audio Language'}
                {activeModal === 'watch_options' && 'Watch Options'}
                {activeModal === 'privacy' && 'Privacy Settings'}
                {activeModal === 'check_update' && 'Check Update'}
                {activeModal === 'about' && 'About Movie Hub'}
                {activeModal === 'privacy_policy' && 'Privacy Policy'}
              </h3>
              <button
                type="button"
                onClick={() => setActiveModal('none')}
                className="p-1.5 rounded-full bg-white/10 text-neutral-300 hover:text-white cursor-pointer"
              >
                <X size={17} />
              </button>
            </div>

            {activeModal === 'notifications' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between bg-[#111317] border border-white/10 rounded-xl p-3.5">
                  <div className="flex items-center gap-3">
                    <Bell size={18} className="text-[#00d664]" />
                    <div>
                      <p className="text-sm font-semibold text-white">Release Alerts</p>
                      <p className="text-xs text-neutral-400">
                        Device permission: {notifPermGranted ? 'Granted' : 'Not granted yet'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleRequestNotifications}
                    className={`relative w-12 h-7 rounded-full transition-colors cursor-pointer ${
                      prefs.notificationsEnabled ? 'bg-[#00d664]' : 'bg-[#353944]'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                        prefs.notificationsEnabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                {!notifPermGranted && (
                  <button
                    type="button"
                    onClick={handleRequestNotifications}
                    className="w-full py-2.5 rounded-xl bg-[#00d664] text-black font-bold text-xs cursor-pointer"
                  >
                    Allow Device Notifications
                  </button>
                )}
              </div>
            )}

            {activeModal === 'language' && (
              <div className="space-y-1.5">
                {LANGUAGE_OPTIONS.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={async () => {
                      await updatePrefs({ preferredLanguage: lang });
                      setActiveModal('none');
                      showToast(`Preferred language: ${lang}`);
                    }}
                    className={`w-full px-3.5 py-3 rounded-xl flex items-center justify-between text-sm font-medium cursor-pointer ${
                      prefs.preferredLanguage === lang
                        ? 'bg-[#00d664]/15 text-[#00d664] border border-[#00d664]/40'
                        : 'bg-[#111317] text-neutral-200 hover:bg-white/5'
                    }`}
                  >
                    <span>{lang}</span>
                    {prefs.preferredLanguage === lang && <Check size={16} />}
                  </button>
                ))}
              </div>
            )}

            {activeModal === 'watch_options' && (
              <div className="space-y-2.5">
                {(['Streaming', 'Data Saver'] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={async () => {
                      await updatePrefs({ watchOption: opt });
                      setActiveModal('none');
                      showToast(`Watch mode set to ${opt}`);
                    }}
                    className={`w-full p-3.5 rounded-xl text-left border cursor-pointer flex items-center justify-between ${
                      prefs.watchOption === opt
                        ? 'bg-[#00d664]/15 border-[#00d664]/50 text-white'
                        : 'bg-[#111317] border-white/10 text-neutral-300'
                    }`}
                  >
                    <div>
                      <p className="text-sm font-bold">{opt}</p>
                      <p className="text-xs text-neutral-400 mt-0.5">
                        {opt === 'Streaming'
                          ? 'Default HD playback quality when available'
                          : 'Lower bandwidth preset to reduce mobile data usage'}
                      </p>
                    </div>
                    {prefs.watchOption === opt && <Check size={17} className="text-[#00d664]" />}
                  </button>
                ))}
              </div>
            )}

            {activeModal === 'privacy' && (
              <div className="space-y-3">
                <div className="bg-[#111317] border border-white/10 rounded-xl p-3.5 flex items-start gap-3">
                  <Shield size={18} className="text-[#00d664] mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    Your Watch History, My List, Likes, and Preferences sync securely to your account or stay stored locally on your device.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await clearWatchHistory(uid);
                    showToast('Watch history cleared');
                    setActiveModal('none');
                  }}
                  className="w-full py-3 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Trash2 size={15} />
                  <span>Clear Watch History</span>
                </button>
              </div>
            )}

            {activeModal === 'check_update' && (
              <div className="space-y-4">
                {checkingUpdate ? (
                  <div className="py-8 flex flex-col items-center gap-2 text-neutral-400 text-xs">
                    <RefreshCw size={22} className="animate-spin text-[#00d664]" />
                    <span>Checking for latest release...</span>
                  </div>
                ) : (
                  <>
                    <div className="bg-[#111317] border border-white/10 rounded-xl p-4 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Installed Version</span>
                        <span className="text-white font-bold">
                          v{installedVer?.versionName || CURRENT_VERSION_NAME}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-400">Latest Available</span>
                        <span className="text-[#00d664] font-bold">
                          v{remoteConfig?.latestVersion || CURRENT_VERSION_NAME}
                        </span>
                      </div>
                    </div>

                    {hasNewerVersion ? (
                      <button
                        type="button"
                        onClick={handleTriggerApkUpdate}
                        className="w-full py-3 rounded-xl bg-[#00d664] text-black text-xs font-black flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Download size={15} />
                        <span>Download Update (v{remoteConfig?.latestVersion})</span>
                      </button>
                    ) : (
                      <div className="p-3 rounded-xl bg-[#00d664]/10 border border-[#00d664]/30 text-[#00d664] text-xs font-semibold text-center">
                        You are on the latest version.
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeModal === 'about' && (
              <div className="flex flex-col items-center text-center space-y-3 py-2">
                <img
                  src="/assets/icons/master_icon.png"
                  alt="Movie Hub"
                  className="w-20 h-20 rounded-2xl object-cover border border-white/15 shadow-lg bg-[#15191e]"
                />
                <div>
                  <h4 className="text-base font-bold text-white">Movie Hub</h4>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Version {installedVer?.versionName || CURRENT_VERSION_NAME}
                  </p>
                </div>
                <p className="text-xs text-neutral-300 leading-relaxed">
                  Watch your favorite movies and series with seamless multi-audio playback, watchlist sync, and offline support.
                </p>
              </div>
            )}

            {activeModal === 'privacy_policy' && (
              <div className="space-y-2.5 text-xs text-neutral-300 leading-relaxed">
                <p>
                  Movie Hub respects your privacy. We store only essential account identifiers (when you choose to sign in), your saved My List, My Likes, Watch History, and app preferences.
                </p>
                <p>
                  You can clear your Watch History at any time under Privacy Settings. Offline downloads stay on your local device storage under your control.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
