import React from 'react';
import { 
  Download, 
  Play, 
  Trash2, 
  Pause, 
  PlayCircle, 
  HardDrive, 
  CheckCircle2, 
  ArrowDownCircle, 
  Film,
  Sparkles,
  FolderDown
} from 'lucide-react';
import { ActiveDownload, DownloadedItem } from '../hooks/useDownloads';

interface DownloadsViewProps {
  activeDownloads: ActiveDownload[];
  completedDownloads: DownloadedItem[];
  onPlayMovie: (movie: any) => void;
  onRemoveCompleted: (id: string) => void;
  onCancelActive: (id: string) => void;
  onPauseActive: (id: string) => void;
  onResumeActive: (id: string) => void;
  onBrowseMovies: () => void;
}

export default function DownloadsView({
  activeDownloads,
  completedDownloads,
  onPlayMovie,
  onRemoveCompleted,
  onCancelActive,
  onPauseActive,
  onResumeActive,
  onBrowseMovies,
}: DownloadsViewProps) {
  const hasActive = activeDownloads.length > 0;
  const hasCompleted = completedDownloads.length > 0;

  // Calculate approximate total storage used
  const totalStorageMb = completedDownloads.reduce((acc, item) => {
    const raw = item.fileSize || '500 MB';
    if (raw.includes('GB')) {
      return acc + (parseFloat(raw) || 1) * 1024;
    }
    return acc + (parseFloat(raw) || 500);
  }, 0);

  const formattedTotalStorage = totalStorageMb > 1024
    ? `${(totalStorageMb / 1024).toFixed(1)} GB`
    : `${totalStorageMb.toFixed(0)} MB`;

  if (!hasActive && !hasCompleted) {
    return (
      <div className="py-20 px-4 text-center max-w-sm mx-auto animate-in fade-in duration-300">
        <div className="w-20 h-20 rounded-full bg-neutral-900 border border-yellow-400/20 text-yellow-400 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-yellow-400/5">
          <FolderDown size={36} className="stroke-[1.5]" />
        </div>
        <h3 className="text-xl font-black text-white uppercase tracking-wider mb-2">
          NO DOWNLOADS YET
        </h3>
        <p className="text-xs text-gray-400 leading-relaxed mb-6">
          Download movies & web series in 1080p or 720p HD to watch anytime offline without internet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 px-3 sm:px-4 max-w-5xl mx-auto animate-in fade-in duration-200">
      {/* Top Storage Bar */}
      <div className="bg-neutral-900/90 border border-neutral-800 rounded-2xl p-4 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-400/10 border border-yellow-400/30 flex items-center justify-center text-yellow-400">
            <HardDrive size={20} />
          </div>
          <div>
            <h3 className="text-xs sm:text-sm font-black text-white uppercase tracking-tight">
              Offline Storage
            </h3>
            <p className="text-[11px] text-gray-400">
              {completedDownloads.length} {completedDownloads.length === 1 ? 'Title' : 'Titles'} downloaded • {formattedTotalStorage} used
            </p>
          </div>
        </div>

        <div className="text-right">
          <span className="text-[10px] bg-neutral-800 text-yellow-400 font-bold px-2.5 py-1 rounded-full border border-yellow-400/30">
            SD Card / Download
          </span>
        </div>
      </div>

      {/* ACTIVE DOWNLOADS SECTION */}
      {hasActive && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black text-yellow-400 uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-yellow-400 animate-ping"></span>
              Active Downloads ({activeDownloads.length})
            </h4>
            <span className="text-[10px] text-gray-500">Live Progress</span>
          </div>

          <div className="space-y-2.5">
            {activeDownloads.map((task) => {
              const isPaused = task.status === 'paused';
              const mbReceived = (task.receivedBytes / (1024 * 1024)).toFixed(0);
              const mbTotal = (task.totalBytes / (1024 * 1024)).toFixed(0);

              return (
                <div
                  key={task.id}
                  className="bg-neutral-950 border border-neutral-800/90 rounded-2xl p-3.5 shadow-xl relative overflow-hidden"
                >
                  <div className="flex gap-3">
                    {/* Poster */}
                    <div className="w-14 h-20 rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 flex-shrink-0">
                      <img
                        src={task.posterUrl || ''}
                        alt={task.title}
                        className="w-full h-full object-cover"
                        onError={(e: any) => {
                          e.target.src = 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=400';
                        }}
                      />
                    </div>

                    {/* Progress details */}
                    <div className="flex-grow min-w-0 flex flex-col justify-between py-0.5">
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <h5 className="text-xs sm:text-sm font-black text-white truncate">
                            {task.title}
                          </h5>
                          <span className="text-xs font-black text-yellow-400">
                            {task.progress}%
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                          <span className="bg-neutral-800 text-yellow-400 px-1.5 py-0.2 rounded font-bold">
                            {task.quality}
                          </span>
                          <span>•</span>
                          <span>{mbReceived} MB / {mbTotal} MB</span>
                          <span>•</span>
                          <span className="text-green-400 font-medium">{isPaused ? 'Paused' : task.speed}</span>
                          {!isPaused && (
                            <>
                              <span>•</span>
                              <span>ETA {task.eta}</span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Animated Progress Bar */}
                      <div className="mt-2">
                        <div className="w-full bg-neutral-800 h-2 rounded-full overflow-hidden p-0.5">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isPaused
                                ? 'bg-amber-600'
                                : 'bg-gradient-to-r from-yellow-500 via-yellow-400 to-amber-300'
                            }`}
                            style={{ width: `${Math.max(4, task.progress)}%` }}
                          ></div>
                        </div>
                      </div>

                      {/* Controls */}
                      <div className="flex items-center justify-end gap-2 pt-1.5">
                        {isPaused ? (
                          <button
                            type="button"
                            onClick={() => onResumeActive(task.id)}
                            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-yellow-400 text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <PlayCircle size={14} />
                            <span>Resume</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onPauseActive(task.id)}
                            className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-gray-300 text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Pause size={14} />
                            <span>Pause</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onCancelActive(task.id)}
                          className="p-1.5 rounded-lg bg-neutral-800 hover:bg-red-500/20 text-gray-400 hover:text-red-400 text-xs font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={14} />
                          <span>Cancel</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* COMPLETED DOWNLOADS SECTION */}
      {hasCompleted && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-black text-gray-300 uppercase tracking-wider flex items-center gap-2">
              <CheckCircle2 size={16} className="text-green-400" />
              Downloaded Movies & Series ({completedDownloads.length})
            </h4>
            <span className="text-[10px] text-gray-500">Ready for Offline Play</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {completedDownloads.map((item) => (
              <div
                key={item.id}
                className="bg-neutral-950 border border-neutral-800/90 rounded-2xl p-3 shadow-lg flex gap-3 group hover:border-neutral-700 transition-all"
              >
                <div 
                  className="w-16 h-24 rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 flex-shrink-0 cursor-pointer relative"
                  onClick={() => onPlayMovie({
                    ...item,
                    streamingUrl: item.videoUrl,
                  })}
                >
                  <img
                    src={item.posterUrl || ''}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e: any) => {
                      e.target.src = 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=400';
                    }}
                  />
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="w-8 h-8 rounded-full bg-yellow-400 text-black flex items-center justify-center shadow-lg">
                      <Play size={14} className="ml-0.5 fill-black" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-between flex-grow min-w-0 py-0.5">
                  <div>
                    <h5 className="text-xs sm:text-sm font-black text-white truncate drop-shadow">
                      {item.title}
                    </h5>
                    <div className="flex items-center gap-1.5 text-[10px] text-gray-400 mt-1">
                      <span className="bg-yellow-400/20 text-yellow-400 px-1.5 py-0.5 rounded font-black border border-yellow-400/30">
                        {item.quality || 'HD'}
                      </span>
                      <span>•</span>
                      <span>{item.fileSize || '850 MB'}</span>
                      <span>•</span>
                      <span>{item.releaseYear || 2024}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => onPlayMovie({
                        ...item,
                        streamingUrl: item.videoUrl,
                      })}
                      className="flex-grow bg-yellow-400 hover:bg-yellow-500 active:scale-95 text-black font-black text-[11px] py-1.5 px-2.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <Play size={12} className="fill-black" />
                      <span>Watch</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onRemoveCompleted(item.id)}
                      className="p-1.5 rounded-lg bg-neutral-900 hover:bg-red-500/20 text-gray-400 hover:text-red-400 border border-neutral-800 transition-colors cursor-pointer"
                      title="Delete Download"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
