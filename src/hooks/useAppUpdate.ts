import { useState, useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  RemoteUpdateConfig,
  InstalledAppVersion,
  CURRENT_VERSION_NAME,
  CURRENT_VERSION_CODE,
  getInstalledAppVersion,
  fetchRemoteUpdateConfig,
  isAppUpdateRequired,
  OFFICIAL_APK_DIRECT_URL,
} from '../services/appUpdateConfig';
import { recordApkDownloadClick } from '../services/appStatsService';

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
      const mandatory = Boolean(remote && isAppUpdateRequired(installed, remote) && remote.isMandatory !== false);
      setIsMandatoryUpdate(mandatory);
      if (typeof window !== 'undefined') {
        (window as any).__MOVIE_PORTAL_MANDATORY_UPDATE__ = mandatory;
        try {
          (window as any).AndroidPlayerBridge?.setMandatoryUpdateRequired?.(mandatory);
        } catch {}
      }
      return mandatory;
    },
    []
  );

  const checkUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const [inst, remote] = await Promise.all([
        getInstalledAppVersion(),
        fetchRemoteUpdateConfig(),
      ]);
      setInstalledVersion(inst);
      if (remote) setRemoteConfig(remote);
      evaluateUpdateLock(inst, remote);
    } catch {
      evaluateUpdateLock(installedVersion, null);
    } finally {
      setCheckingUpdate(false);
    }
  }, [evaluateUpdateLock, installedVersion]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      if (typeof window !== 'undefined') {
        (window as any).__MOVIE_PORTAL_MANDATORY_UPDATE__ = false;
      }
      return;
    }
    checkUpdate().catch(() => {});
  }, [checkUpdate]);

  const startUpdateDownload = useCallback(async () => {
    const rawUrl = (remoteConfigRef.current?.apkDownloadUrl || OFFICIAL_APK_DIRECT_URL).trim();
    const url = rawUrl || OFFICIAL_APK_DIRECT_URL;
    console.log('[AppUpdate] Starting update download with URL:', url);
    recordApkDownloadClick('in_app_update').catch(() => {});

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
        message: 'Starting official APK download inside app...',
      });
      try {
        bridge.downloadAndInstallApk(url);
      } catch (err) {
        console.warn('Native downloadAndInstallApk error:', err);
        setInstallStatus({
          state: 'error',
          progress: 0,
          message: 'Could not start in-app download. Please tap Retry.',
        });
      }
      return;
    }

    // No external browser fallback: keep update strictly inside the app
    setInstallStatus({
      state: 'error',
      progress: 0,
      message: 'In-app update service is only available in the installed Android app.',
    });
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

  const openBrowserDownloadFallback = useCallback(async () => {
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
    openBrowserDownloadFallback,
  };
}
