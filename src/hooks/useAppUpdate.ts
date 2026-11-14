import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  RemoteUpdateConfig,
  InstalledAppVersion,
  CURRENT_VERSION_NAME,
  CURRENT_VERSION_CODE,
  fetchRemoteUpdateConfig,
  subscribeRemoteUpdateConfig,
  getInstalledAppVersion,
  isAppUpdateRequired,
  pickHigherRemoteUpdateConfig,
  OFFICIAL_APK_DIRECT_URL,
} from '../services/appUpdateConfig';

export interface ApkInstallStatus {
  state: 'idle' | 'downloading' | 'permission_required' | 'installing' | 'error';
  progress: number;
  message: string;
}

export function useAppUpdate() {
  const [remoteConfig, setRemoteConfig] = useState<RemoteUpdateConfig | null>(null);
  const [installedVersion, setInstalledVersion] = useState<InstalledAppVersion>({
    versionName: CURRENT_VERSION_NAME,
    versionCode: CURRENT_VERSION_CODE,
    packageName: 'com.moviebox.stream.app',
    source: 'bundled_fallback',
  });
  const [isMandatoryUpdate, setIsMandatoryUpdate] = useState(false);
  const [installStatus, setInstallStatus] = useState<ApkInstallStatus>({
    state: 'idle',
    progress: 0,
    message: '',
  });
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const remoteConfigRef = useRef<RemoteUpdateConfig | null>(null);
  remoteConfigRef.current = remoteConfig;

  const evaluateUpdateLock = useCallback(
    (installed: InstalledAppVersion, remote: RemoteUpdateConfig | null) => {
      if (!Capacitor.isNativePlatform()) {
        setIsMandatoryUpdate(false);
        return false;
      }
      const required = isAppUpdateRequired(installed, remote);
      setIsMandatoryUpdate(required);
      if (typeof window !== 'undefined') {
        (window as any).__MOVIE_PORTAL_MANDATORY_UPDATE__ = required;
        try {
          (window as any).AndroidPlayerBridge?.setMandatoryUpdateRequired?.(required);
        } catch {}
      }
      return required;
    },
    []
  );

  const checkUpdate = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    setCheckingUpdate(true);
    try {
      const [installed, fetchedRemote] = await Promise.all([
        getInstalledAppVersion(),
        fetchRemoteUpdateConfig(),
      ]);
      setInstalledVersion(installed);
      const effectiveRemote = fetchedRemote || remoteConfigRef.current;
      if (fetchedRemote) {
        setRemoteConfig(fetchedRemote);
      }
      evaluateUpdateLock(installed, effectiveRemote);
    } catch (err) {
      console.warn('Mandatory update check warning:', err);
    } finally {
      setCheckingUpdate(false);
    }
  }, [evaluateUpdateLock]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let isMounted = true;
    checkUpdate();

    // Real-time Firebase Firestore listener for instant enforcement without app restart
    const unsubscribeSnapshot = subscribeRemoteUpdateConfig(
      async (config) => {
        if (!isMounted) return;
        const effectiveConfig =
          pickHigherRemoteUpdateConfig(config, remoteConfigRef.current) || config;
        setRemoteConfig(effectiveConfig);
        const installed = await getInstalledAppVersion();
        if (!isMounted) return;
        setInstalledVersion(installed);
        evaluateUpdateLock(installed, effectiveConfig);
      },
      (err) => {
        console.warn('Firestore remote update listener notice:', err);
      }
    );

    // Re-check installed version & Firebase config when user returns from PackageInstaller or Settings
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        checkUpdate();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', checkUpdate);

    let appStateHandle: any = null;
    let resumeHandle: any = null;
    import('@capacitor/app')
      .then(({ App: CapApp }) => {
        appStateHandle = CapApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive) checkUpdate();
        });
        resumeHandle = CapApp.addListener('resume', () => {
          checkUpdate();
        });
      })
      .catch(() => {});

    const interval = setInterval(checkUpdate, 5 * 60 * 1000);

    return () => {
      isMounted = false;
      unsubscribeSnapshot();
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', checkUpdate);
      clearInterval(interval);
      if (appStateHandle && typeof appStateHandle.remove === 'function') {
        appStateHandle.remove();
      }
      if (resumeHandle && typeof resumeHandle.remove === 'function') {
        resumeHandle.remove();
      }
    };
  }, [checkUpdate, evaluateUpdateLock]);

  // Poll native APK download/install progress when downloading or awaiting permission
  useEffect(() => {
    if (!isMandatoryUpdate || !Capacitor.isNativePlatform()) return;
    const bridge = (window as any).AndroidPlayerBridge;
    if (!bridge || typeof bridge.getApkUpdateStatus !== 'function') return;

    const poll = () => {
      try {
        const raw = bridge.getApkUpdateStatus();
        if (!raw) return;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && parsed.state) {
          setInstallStatus((prev) => {
            if (
              prev.state === parsed.state &&
              prev.progress === Number(parsed.progress || 0) &&
              prev.message === String(parsed.message || '')
            ) {
              return prev;
            }
            return {
              state: parsed.state,
              progress: Number(parsed.progress || 0),
              message: String(parsed.message || ''),
            };
          });
        }
      } catch {}
    };

    const timer = setInterval(poll, 350);
    return () => clearInterval(timer);
  }, [isMandatoryUpdate]);

  const startUpdateDownload = useCallback(async () => {
    const rawUrl = (remoteConfigRef.current?.apkDownloadUrl || OFFICIAL_APK_DIRECT_URL).trim();
    const url = rawUrl || OFFICIAL_APK_DIRECT_URL;
    console.log('[AppUpdate] Starting update download with URL:', url);

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setInstallStatus({
        state: 'error',
        progress: 0,
        message: 'No internet connection. Connect to the internet and tap Retry.',
      });
      return;
    }

    const bridge = typeof window !== 'undefined' ? (window as any).AndroidPlayerBridge : null;

    if (bridge && typeof bridge.downloadAndInstallApk === 'function') {
      setInstallStatus({
        state: 'downloading',
        progress: 0,
        message: 'Starting official APK download...',
      });
      try {
        bridge.downloadAndInstallApk(url);
        return;
      } catch (err) {
        console.warn('Native downloadAndInstallApk error:', err);
      }
    }

    // Secondary fallback for older shells without native APK downloader
    setInstallStatus({
      state: 'installing',
      progress: 100,
      message: 'Opening official APK download. Install the downloaded APK and return to the app.',
    });
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
    } catch {
      try {
        window.open(url, '_system');
      } catch {
        window.location.href = url;
      }
    }
  }, []);

  const openUnknownSourcesSettings = useCallback(() => {
    const bridge = typeof window !== 'undefined' ? (window as any).AndroidPlayerBridge : null;
    if (bridge && typeof bridge.openUnknownSourcesSettings === 'function') {
      bridge.openUnknownSourcesSettings();
    }
  }, []);

  const retryInstallDownloadedApk = useCallback(() => {
    const bridge = typeof window !== 'undefined' ? (window as any).AndroidPlayerBridge : null;
    if (bridge && typeof bridge.retryInstallDownloadedApk === 'function') {
      bridge.retryInstallDownloadedApk();
      return;
    }
    startUpdateDownload();
  }, [startUpdateDownload]);

  return {
    isMandatoryUpdate,
    remoteConfig,
    installedVersion,
    installStatus,
    checkingUpdate,
    checkUpdate,
    startUpdateDownload,
    openUnknownSourcesSettings,
    retryInstallDownloadedApk,
  };
}
