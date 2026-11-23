import { useEffect, useState, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Download, RefreshCw, ShieldAlert, Smartphone } from 'lucide-react';
import {
  RemoteUpdateConfig,
  InstalledAppVersion,
  fetchRemoteUpdateConfig,
  subscribeRemoteUpdateConfig,
  getInstalledAppVersion,
  isAppUpdateRequired,
  OFFICIAL_APK_DIRECT_URL,
} from '../services/appUpdateConfig';
import { recordApkDownloadClick } from '../services/appStatsService';

interface ApkBridgeStatus {
  state: 'idle' | 'downloading' | 'installing' | 'permission_required' | 'error' | string;
  progress: number;
  message: string;
}
export default function UpdateNotification() {
  const isNative =
    typeof window !== 'undefined' &&
    (Capacitor.isNativePlatform() || Boolean((window as any).AndroidPlayerBridge));
  const [installed, setInstalled] = useState<InstalledAppVersion | null>(null);
  const [remoteConfig, setRemoteConfig] = useState<RemoteUpdateConfig | null>(null);
  const [updateRequired, setUpdateRequired] = useState(false);
  const [apkStatus, setApkStatus] = useState<ApkBridgeStatus>({
    state: 'idle',
    progress: 0,
    message: '',
  });
  const trackedDownloadRef = useRef(false);

  const evaluateUpdateState = (
    inst: InstalledAppVersion | null,
    cfg: RemoteUpdateConfig | null
  ) => {
    if (!isNative || !inst || !cfg) {
      setUpdateRequired(false);
      if (typeof window !== 'undefined') {
        (window as any).__MOVIE_PORTAL_MANDATORY_UPDATE__ = false;
        try {
          (window as any).AndroidPlayerBridge?.setMandatoryUpdateRequired?.(false);
        } catch {}
      }
      return;
    }

    const needed = isAppUpdateRequired(inst, cfg);
    setUpdateRequired(needed);
    if (typeof window !== 'undefined') {
      (window as any).__MOVIE_PORTAL_MANDATORY_UPDATE__ = needed;
      try {
        (window as any).AndroidPlayerBridge?.setMandatoryUpdateRequired?.(needed);
      } catch {}
    }
  };

  useEffect(() => {
    if (!isNative) {
      if (typeof window !== 'undefined') {
        (window as any).__MOVIE_PORTAL_MANDATORY_UPDATE__ = false;
      }
      return;
    }

    let mounted = true;
    let currentInstalled: InstalledAppVersion | null = null;
    let currentRemote: RemoteUpdateConfig | null = null;

    const refreshCheck = async () => {
      try {
        const [inst, remote] = await Promise.all([
          getInstalledAppVersion(),
          fetchRemoteUpdateConfig(),
        ]);
        if (!mounted) return;
        currentInstalled = inst;
        if (remote) {
          currentRemote = remote;
          setRemoteConfig(remote);
        }
        setInstalled(inst);
        evaluateUpdateState(inst, currentRemote);
      } catch {}
    };

    refreshCheck();

    const unsub = subscribeRemoteUpdateConfig((cfg) => {
      if (!mounted) return;
      currentRemote = cfg;
      setRemoteConfig(cfg);
      if (currentInstalled) {
        evaluateUpdateState(currentInstalled, cfg);
      } else {
        getInstalledAppVersion()
          .then((inst) => {
            if (!mounted) return;
            currentInstalled = inst;
            setInstalled(inst);
            evaluateUpdateState(inst, cfg);
          })
          .catch(() => {});
      }
    });

    const handleResumeCheck = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      refreshCheck();
    };

    window.addEventListener('focus', handleResumeCheck);
    document.addEventListener('visibilitychange', handleResumeCheck);

    return () => {
      mounted = false;
      unsub();
      window.removeEventListener('focus', handleResumeCheck);
      document.removeEventListener('visibilitychange', handleResumeCheck);
    };
  }, [isNative]);

  // Poll native APK download/install progress when update dialog is visible
  useEffect(() => {
    if (!isNative || !updateRequired) return;

    const readStatus = () => {
      try {
        const bridge = (window as any).AndroidPlayerBridge;
        if (bridge && typeof bridge.getApkUpdateStatus === 'function') {
          const raw = bridge.getApkUpdateStatus();
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (parsed && typeof parsed.state === 'string') {
            setApkStatus({
              state: parsed.state,
              progress: Number(parsed.progress) || 0,
              message: String(parsed.message || ''),
            });
          }
        }
      } catch {}
    };

    readStatus();
    const timer = setInterval(readStatus, 450);
    return () => clearInterval(timer);
  }, [isNative, updateRequired]);

  if (!isNative || !updateRequired || !remoteConfig) {
    return null;
  }

  const downloadUrl = remoteConfig.apkDownloadUrl || OFFICIAL_APK_DIRECT_URL;
  const isDownloading = apkStatus.state === 'downloading';
  const needsPermission = apkStatus.state === 'permission_required';
  const isInstalling = apkStatus.state === 'installing';
  const hasError = apkStatus.state === 'error';

  const handleStartDownload = async () => {
    if (!trackedDownloadRef.current) {
      trackedDownloadRef.current = true;
      recordApkDownloadClick('in_app_update').catch(() => {});
    }

    setApkStatus({
      state: 'downloading',
      progress: 1,
      message: 'Starting in-app download...',
    });

    try {
      const bridge = (window as any).AndroidPlayerBridge;
      if (bridge && typeof bridge.downloadAndInstallApk === 'function') {
        bridge.downloadAndInstallApk(downloadUrl);
        return;
      }
    } catch (err) {
      console.warn('Native in-app update error:', err);
    }

    setApkStatus({
      state: 'error',
      progress: 0,
      message: 'In-app update service not ready. Please tap Retry In-App Update.',
    });
  };

  const handleOpenPermissionSettings = () => {
    try {
      (window as any).AndroidPlayerBridge?.openUnknownSourcesSettings?.();
    } catch {}
  };

  const handleRetryInstall = () => {
    try {
      const bridge = (window as any).AndroidPlayerBridge;
      if (bridge && typeof bridge.retryInstallDownloadedApk === 'function') {
        bridge.retryInstallDownloadedApk();
        return;
      }
      handleStartDownload();
    } catch {}
  };

  return (
    <div className="fixed inset-0 z-[10000] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-neutral-900 border border-yellow-500/40 rounded-3xl p-6 shadow-2xl text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-yellow-400/15 border border-yellow-400/35 flex items-center justify-center text-yellow-400">
          <Smartphone size={32} />
        </div>

        <h2 className="text-xl font-black text-white tracking-tight uppercase">
          New Update Available
        </h2>
        <p className="text-xs font-bold text-yellow-400 mt-1">
          v{installed?.versionName || 'Old'} → v{remoteConfig.latestVersion}
        </p>

        <p className="text-xs text-gray-300 leading-relaxed mt-3 mb-5">
          {remoteConfig.updateMessage}
        </p>

        {(isDownloading || apkStatus.message) && (
          <div className="mb-4 bg-neutral-950 border border-neutral-800 rounded-2xl p-3 text-left">
            <div className="flex items-center justify-between text-[11px] font-bold mb-1.5">
              <span className={hasError ? 'text-red-400' : 'text-yellow-400'}>
                {isDownloading
                  ? 'Downloading APK...'
                  : needsPermission
                    ? 'Permission Required'
                    : isInstalling
                      ? 'Ready to Install'
                      : hasError
                        ? 'Update Notice'
                        : 'Preparing...'}
              </span>
              {apkStatus.progress > 0 && (
                <span className="text-white font-mono">{apkStatus.progress}%</span>
              )}
            </div>
            {isDownloading && (
              <div className="w-full h-2 bg-neutral-800 rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-yellow-400 transition-all duration-300"
                  style={{ width: `${Math.max(4, Math.min(100, apkStatus.progress))}%` }}
                />
              </div>
            )}
            {apkStatus.message && (
              <p className="text-[11px] text-gray-300 leading-snug">{apkStatus.message}</p>
            )}
          </div>
        )}

        <div className="space-y-2.5">
          {needsPermission ? (
            <button
              type="button"
              onClick={handleOpenPermissionSettings}
              className="w-full bg-amber-400 hover:bg-amber-300 text-black font-black text-xs py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer active:scale-95 transition-all"
            >
              <ShieldAlert size={16} />
              <span>Allow Install Permission</span>
            </button>
          ) : isInstalling ? (
            <button
              type="button"
              onClick={handleRetryInstall}
              className="w-full bg-emerald-400 hover:bg-emerald-300 text-black font-black text-xs py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer active:scale-95 transition-all"
            >
              <RefreshCw size={16} />
              <span>Tap to Install Update</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartDownload}
              disabled={isDownloading}
              className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-black text-xs py-3.5 px-4 rounded-xl flex items-center justify-center gap-2 uppercase tracking-wider cursor-pointer active:scale-95 transition-all shadow-lg shadow-yellow-400/20"
            >
              {isDownloading ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Downloading Update ({apkStatus.progress}%)</span>
                </>
              ) : (
                <>
                  <Download size={16} />
                  <span>{hasError ? 'Retry In-App Update' : 'Update App Now'}</span>
                </>
              )}
            </button>
          )}


          <button
            type="button"
            onClick={() => setUpdateRequired(false)}
            className="w-full bg-transparent hover:bg-neutral-800 text-gray-400 hover:text-white font-medium text-[11px] py-2 px-4 rounded-xl cursor-pointer transition-colors"
          >
            <span>Continue Using App (Remind Later)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
