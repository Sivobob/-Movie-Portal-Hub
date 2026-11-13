import React, { useEffect } from 'react';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { DEFAULT_UPDATE_MESSAGE } from '../services/appUpdateConfig';
import { Download, RefreshCw, ShieldAlert, Settings, CheckCircle2 } from 'lucide-react';

export default function UpdateNotification() {
  const {
    isMandatoryUpdate,
    remoteConfig,
    installedVersion,
    installStatus,
    checkingUpdate,
    checkUpdate,
    startUpdateDownload,
    openUnknownSourcesSettings,
    retryInstallDownloadedApk,
  } = useAppUpdate();

  // Lock background page scrolling whenever mandatory update modal is active
  useEffect(() => {
    if (!isMandatoryUpdate) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isMandatoryUpdate]);

  // Block browser-level Escape or context dismissal if mandatory update is shown
  useEffect(() => {
    if (!isMandatoryUpdate) return;
    const blockEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', blockEscape, true);
    return () => window.removeEventListener('keydown', blockEscape, true);
  }, [isMandatoryUpdate]);

  if (!isMandatoryUpdate || !remoteConfig) return null;

  const isDownloading = installStatus.state === 'downloading';
  const isError = installStatus.state === 'error';
  const isPermissionRequired = installStatus.state === 'permission_required';
  const isInstalling = installStatus.state === 'installing';

  const message =
    remoteConfig.updateMessage?.trim() || DEFAULT_UPDATE_MESSAGE;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mandatory-update-heading"
      className="fixed inset-0 z-[99999] bg-black/95 backdrop-blur-md flex items-center justify-center p-5 select-none touch-none"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="w-full max-w-sm bg-neutral-900 border-2 border-yellow-400/90 rounded-3xl p-6 shadow-[0_0_50px_rgba(250,204,21,0.22)] text-center text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-16 h-16 rounded-2xl bg-yellow-400/15 border border-yellow-400/40 flex items-center justify-center text-yellow-400 mx-auto mb-4 shadow-lg">
          {isError ? (
            <ShieldAlert size={30} className="text-red-400" />
          ) : (
            <Download size={30} />
          )}
        </div>

        <h2
          id="mandatory-update-heading"
          className="text-xl font-black text-white tracking-tight mb-2"
        >
          New Update Available
        </h2>

        <p className="text-sm text-gray-300 leading-relaxed mb-4">
          {message}
        </p>

        <div className="bg-neutral-950 border border-neutral-800 rounded-xl px-3.5 py-2.5 mb-5 text-xs flex items-center justify-between text-gray-400">
          <span>
            Installed: <strong className="text-gray-200">v{installedVersion.versionName}</strong>
          </span>
          <span className="text-yellow-400 font-bold">
            Required: v{remoteConfig.minimumRequiredVersion || remoteConfig.latestVersion}
          </span>
        </div>

        {/* Download Progress Indicator */}
        {isDownloading && (
          <div className="mb-4 text-left space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-yellow-400">
              <span>Downloading official APK...</span>
              <span>{Math.max(0, Math.min(100, installStatus.progress))}%</span>
            </div>
            <div className="w-full h-2.5 bg-neutral-950 rounded-full overflow-hidden border border-neutral-800">
              <div
                className="h-full bg-yellow-400 transition-all duration-300"
                style={{ width: `${Math.max(4, Math.min(100, installStatus.progress))}%` }}
              />
            </div>
            {installStatus.message && (
              <p className="text-[11px] text-gray-400 text-center">{installStatus.message}</p>
            )}
          </div>
        )}

        {/* Official PackageInstaller / Permission Guidance */}
        {isPermissionRequired && (
          <div className="mb-4 bg-amber-950/50 border border-amber-500/40 rounded-xl p-3 text-left space-y-2">
            <p className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
              <Settings size={14} className="flex-shrink-0" />
              Install Permission Required
            </p>
            <p className="text-[11px] text-gray-300 leading-relaxed">
              {installStatus.message ||
                'Tap "Allow Install Permission" below, enable "Allow from this source", then tap "Install Update".'}
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={openUnknownSourcesSettings}
                className="w-full bg-amber-400 hover:bg-amber-300 text-black font-black text-xs py-2.5 px-4 rounded-xl transition-all active:scale-95 cursor-pointer uppercase tracking-wider"
              >
                Allow Install Permission
              </button>
              <button
                type="button"
                onClick={retryInstallDownloadedApk}
                className="w-full bg-yellow-400 hover:bg-yellow-300 text-black font-black text-xs py-2.5 px-4 rounded-xl transition-all active:scale-95 cursor-pointer uppercase tracking-wider"
              >
                Install Update
              </button>
            </div>
          </div>
        )}

        {isInstalling && (
          <div className="mb-4 bg-emerald-950/40 border border-emerald-500/40 rounded-xl p-3 text-left space-y-2">
            <p className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 size={14} className="flex-shrink-0" />
              Ready for Android Installer
            </p>
            <p className="text-[11px] text-gray-300 leading-relaxed">
              {installStatus.message ||
                'Android Package Installer has been opened. Tap Install / Update, then reopen Movie Box.'}
            </p>
            <button
              type="button"
              onClick={retryInstallDownloadedApk}
              className="w-full bg-emerald-400 hover:bg-emerald-300 text-black font-black text-xs py-2.5 px-4 rounded-xl transition-all active:scale-95 cursor-pointer uppercase tracking-wider"
            >
              Open Installer Again
            </button>
          </div>
        )}

        {/* Network / Download Error State with Retry */}
        {isError && (
          <div className="mb-4 bg-red-950/60 border border-red-500/40 rounded-xl p-3 text-xs text-red-200 leading-relaxed">
            {installStatus.message ||
              'Download failed or internet is unavailable. Please check your connection and tap Retry.'}
          </div>
        )}

        {/* Primary Prominent Action Button */}
        {!isPermissionRequired && (
          <button
            type="button"
            disabled={isDownloading}
            onClick={startUpdateDownload}
            className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-60 text-black font-black text-sm py-3.5 px-5 rounded-2xl shadow-lg shadow-yellow-400/25 flex items-center justify-center gap-2 transition-all active:scale-95 cursor-pointer uppercase tracking-wider"
          >
            {isDownloading ? (
              <>
                <RefreshCw size={18} className="animate-spin" />
                <span>Downloading...</span>
              </>
            ) : isError ? (
              <>
                <RefreshCw size={18} />
                <span>Retry</span>
              </>
            ) : (
              <>
                <Download size={18} className="stroke-[2.5]" />
                <span>UPDATE NOW</span>
              </>
            )}
          </button>
        )}

        {/* Secondary non-dismissive version re-check button if user just finished installing */}
        {(isInstalling || isPermissionRequired || isError) && (
          <button
            type="button"
            disabled={checkingUpdate}
            onClick={checkUpdate}
            className="mt-3 w-full bg-neutral-800 hover:bg-neutral-700 text-gray-200 font-bold text-xs py-2.5 px-4 rounded-xl border border-neutral-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <RefreshCw size={14} className={checkingUpdate ? 'animate-spin' : ''} />
            <span>{checkingUpdate ? 'Checking Version...' : 'Check Installed Version'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
