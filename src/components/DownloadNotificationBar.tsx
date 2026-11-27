import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Download,
  Pause,
  Play,
  X,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { useDownloads } from '../hooks/useDownloads';

export default function DownloadNotificationBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    activeDownloads,
    lastNotification,
    setLastNotification,
    pauseActiveDownload,
    resumeActiveDownload,
    cancelActiveDownload,
  } = useDownloads();

  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const visibleActive = activeDownloads.filter((d) => !dismissedIds.has(d.id));
  const primary = visibleActive[0] || null;
  const isDownloadsRoute = location.pathname === '/downloads';

  useEffect(() => {
    if (activeDownloads.length === 0 && dismissedIds.size > 0) {
      setDismissedIds(new Set());
    }
  }, [activeDownloads.length]);

  const openDownloadsFolder = () => {
    setLastNotification(null);
    navigate('/downloads');
    window.dispatchEvent(new CustomEvent('movie_portal_open_downloads'));
  };

  if (!primary && !lastNotification) {
    return null;
  }

  // On /downloads page, active cards are already front-and-center; only show transient completion toast there
  if (isDownloadsRoute && !lastNotification) {
    return null;
  }

  if (primary && !isDownloadsRoute) {
    const isPaused = primary.status === 'paused';
    const isError = primary.status === 'error';
    const mbDone = (primary.receivedBytes / (1024 * 1024)).toFixed(1);
    const mbTotal =
      primary.totalBytes > 0
        ? (primary.totalBytes / (1024 * 1024)).toFixed(1)
        : '';

    return (
      <div className="fixed top-[max(0.6rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[125] w-[calc(100%-1.25rem)] max-w-md pointer-events-auto animate-in fade-in slide-in-from-top-3 duration-200">
        <div
          onClick={openDownloadsFolder}
          className={`rounded-2xl border backdrop-blur-xl shadow-2xl px-3.5 py-2.5 cursor-pointer transition-colors ${
            isError
              ? 'bg-[#201417]/95 border-red-500/45 text-white'
              : 'bg-[#141922]/95 border-[#00d664]/45 text-white'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div
              className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
                isError
                  ? 'bg-red-500/20 text-red-400'
                  : isPaused
                  ? 'bg-amber-400/20 text-amber-300'
                  : 'bg-[#00d664]/20 text-[#00d664]'
              }`}
            >
              {isError ? (
                <AlertCircle size={16} />
              ) : (
                <Download size={16} className={!isPaused ? 'animate-bounce' : ''} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold text-white truncate">
                  {primary.title}
                </p>
                <span
                  className={`text-xs font-black flex-shrink-0 ${
                    isError
                      ? 'text-red-400'
                      : isPaused
                      ? 'text-amber-300'
                      : 'text-[#00d664]'
                  }`}
                >
                  {isError ? 'Failed' : `${primary.progress}%`}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 text-[10px] text-neutral-300 mt-0.5">
                <span className="truncate">
                  {isError
                    ? primary.errorMessage || 'Tap to retry'
                    : isPaused
                    ? `Paused • ${mbDone} MB${mbTotal ? ` / ${mbTotal} MB` : ''}`
                    : `${mbDone} MB${mbTotal ? ` / ${mbTotal} MB` : ''} • ${primary.speed}`}
                </span>
                {visibleActive.length > 1 && (
                  <span className="text-[10px] font-bold text-[#00d664] flex-shrink-0">
                    +{visibleActive.length - 1} more
                  </span>
                )}
              </div>

              {/* Progress Bar */}
              {!isError && (
                <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden mt-1.5">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isPaused ? 'bg-amber-400' : 'bg-[#00d664]'
                    }`}
                    style={{ width: `${Math.max(3, primary.progress)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Quick Inline Controls */}
            <div
              className="flex items-center gap-1 flex-shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              {isError || isPaused ? (
                <button
                  type="button"
                  onClick={() => resumeActiveDownload(primary.id)}
                  className="p-1.5 rounded-lg bg-[#00d664]/20 hover:bg-[#00d664]/30 text-[#00d664] cursor-pointer"
                  aria-label="Resume download"
                  title="Resume"
                >
                  <Play size={13} fill="currentColor" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => pauseActiveDownload(primary.id)}
                  className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                  aria-label="Pause download"
                  title="Pause"
                >
                  <Pause size={13} />
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  if (isError) {
                    cancelActiveDownload(primary.id);
                  } else {
                    setDismissedIds((prev) => new Set(prev).add(primary.id));
                  }
                }}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-neutral-300 hover:text-white cursor-pointer"
                aria-label="Hide notification"
                title={isError ? 'Dismiss failed task' : 'Minimize'}
              >
                <X size={13} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Transient Notification Banner (Completion / Started notice)
  if (lastNotification) {
    return (
      <div className="fixed top-[max(0.6rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[125] w-[calc(100%-1.5rem)] max-w-md pointer-events-auto animate-in fade-in slide-in-from-top-3 duration-200">
        <div
          onClick={openDownloadsFolder}
          className="rounded-2xl border border-[#00d664]/45 bg-[#12171f]/95 backdrop-blur-xl shadow-2xl px-3.5 py-2.5 flex items-center gap-2.5 cursor-pointer"
        >
          <CheckCircle2 size={18} className="text-[#00d664] flex-shrink-0" />
          <p className="text-xs font-semibold text-white flex-1 line-clamp-2">
            {lastNotification}
          </p>
          {!isDownloadsRoute && (
            <ChevronRight size={15} className="text-neutral-400 flex-shrink-0" />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLastNotification(null);
            }}
            className="p-1 rounded-lg text-neutral-400 hover:text-white cursor-pointer flex-shrink-0"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  return null;
}
