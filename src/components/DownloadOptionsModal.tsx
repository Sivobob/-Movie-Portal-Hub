import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Download, 
  CheckCircle2, 
  Film, 
  Tv, 
  HardDrive, 
  Sparkles, 
  Volume2, 
  ArrowRight,
  ShieldCheck
} from 'lucide-react';

export interface DownloadQualityOption {
  id: string;
  label: string;
  resolution: string;
  sizeLabel: string;
  sizeMb: number;
  badge?: string;
  description: string;
}

export const DEFAULT_QUALITIES: DownloadQualityOption[] = [
  {
    id: '1080p',
    label: '1080p Full HD',
    resolution: '1920x1080',
    sizeLabel: '1.4 GB',
    sizeMb: 1400,
    badge: 'ULTRA HD',
    description: 'Crisp cinema detail, 5.1 surround sound audio',
  },
  {
    id: '720p',
    label: '720p HD',
    resolution: '1280x720',
    sizeLabel: '820 MB',
    sizeMb: 820,
    badge: 'RECOMMENDED',
    description: 'Perfect balance of speed, crispness and phone storage',
  },
  {
    id: '480p',
    label: '480p SD',
    resolution: '854x480',
    sizeLabel: '420 MB',
    sizeMb: 420,
    badge: 'FAST',
    description: 'High-speed download, smooth mobile playback',
  },
  {
    id: '360p',
    label: '360p Data Saver',
    resolution: '640x360',
    sizeLabel: '210 MB',
    sizeMb: 210,
    badge: 'DATA SAVER',
    description: 'Lowest data consumption, quick offline save',
  },
];

interface DownloadOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  movie: any;
  onConfirmDownload: (options: {
    title: string;
    posterUrl: string;
    videoUrl: string;
    quality: string;
    estimatedSizeMb: number;
    seasonEpisodeLabel?: string;
  }) => void;
  onViewDownloads?: () => void;
}

export default function DownloadOptionsModal({
  isOpen,
  onClose,
  movie,
  onConfirmDownload,
  onViewDownloads,
}: DownloadOptionsModalProps) {
  const [selectedQuality, setSelectedQuality] = useState<string>('720p');
  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState<number>(0);
  const [selectedEpisodeIdx, setSelectedEpisodeIdx] = useState<number>(0);
  const [isStarting, setIsStarting] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  if (!isOpen || !movie || (movie.seasons && movie.seasons.length > 0)) return null;

  const isSeries = Boolean(movie.seasons && movie.seasons.length > 0);
  const currentSeason = isSeries ? movie.seasons[selectedSeasonIdx] : null;
  const currentEpisode = currentSeason?.episodes ? currentSeason.episodes[selectedEpisodeIdx] : null;

  // Resolve active title and stream URL
  const downloadTitle = isSeries && currentEpisode
    ? `${movie.title} - S0${currentSeason.seasonNumber}E0${currentEpisode.episodeNumber}: ${currentEpisode.title}`
    : movie.title;

  const targetStreamUrl = isSeries && currentEpisode
    ? currentEpisode.streamUrl || movie.streamingUrl || ''
    : movie.streamingUrl || '';

  const activeQualityObj = DEFAULT_QUALITIES.find((q) => q.id === selectedQuality) || DEFAULT_QUALITIES[1];

  const handleStart = () => {
    setIsStarting(true);
    onConfirmDownload({
      title: downloadTitle,
      posterUrl: movie.posterUrl || movie.backdropUrl || '',
      videoUrl: targetStreamUrl,
      quality: activeQualityObj.label,
      estimatedSizeMb: activeQualityObj.sizeMb,
      seasonEpisodeLabel: isSeries && currentEpisode ? `S0${currentSeason.seasonNumber}E0${currentEpisode.episodeNumber}` : undefined,
    });

    setHasStarted(true);
    setIsStarting(false);
    setTimeout(() => {
      onClose();
      setHasStarted(false);
    }, 1800);
  };

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%', opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-neutral-900 border-t sm:border border-neutral-800 rounded-t-[32px] sm:rounded-[28px] max-w-lg w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl relative"
        >
          {/* Header Bar */}
          <div className="p-4 sm:p-5 border-b border-neutral-800/80 flex items-center justify-between bg-neutral-950/60 sticky top-0 z-10 backdrop-blur-md">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-yellow-400/10 border border-yellow-500/30 flex items-center justify-center text-yellow-400">
                <Download size={18} className="animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-black text-white uppercase tracking-tight flex items-center gap-2">
                  <span>Download Options</span>
                  <span className="text-[10px] bg-yellow-400 text-black font-extrabold px-1.5 py-0.5 rounded">
                    MP4 DIRECT
                  </span>
                </h3>
                <p className="text-[11px] text-gray-400">Select quality & episode for offline viewing</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full bg-neutral-800 hover:bg-neutral-700 text-gray-400 hover:text-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
            {/* Movie / Series Info Card */}
            <div className="flex gap-3.5 bg-neutral-950 p-3.5 rounded-2xl border border-neutral-800/90">
              <div className="w-16 h-24 sm:w-20 sm:h-28 rounded-xl overflow-hidden bg-neutral-900 flex-shrink-0 border border-neutral-800 shadow-md">
                <img
                  src={movie.posterUrl || movie.backdropUrl || ''}
                  alt={movie.title}
                  className="w-full h-full object-cover"
                  onError={(e: any) => {
                    e.target.src = 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=400';
                  }}
                />
              </div>

              <div className="flex flex-col justify-between py-0.5 flex-grow min-w-0">
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-wider bg-yellow-400/10 border border-yellow-400/20 px-2 py-0.5 rounded">
                      {isSeries ? 'Series Episode' : movie.displayCategory || 'Movie'}
                    </span>
                    <span className="text-[11px] text-gray-400">
                      • {movie.releaseYear || 2024}
                    </span>
                  </div>

                  <h4 className="text-sm sm:text-base font-black text-white truncate drop-shadow">
                    {downloadTitle}
                  </h4>

                  <p className="text-[11px] text-gray-400 font-medium truncate mt-0.5">
                    {movie.genre || 'Action, Thriller, Drama'}
                  </p>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-gray-400 pt-1">
                  <span className="flex items-center gap-1 text-gray-300">
                    <Volume2 size={13} className="text-yellow-400" />
                    <span>Hindi / English</span>
                  </span>
                  <span className="flex items-center gap-1 text-gray-300">
                    <HardDrive size={13} className="text-green-400" />
                    <span>{activeQualityObj.sizeLabel}</span>
                  </span>
                </div>
              </div>
            </div>

            {/* If Series: Season & Episode Chooser */}
            {isSeries && movie.seasons && (
              <div className="bg-neutral-950/70 p-3.5 rounded-2xl border border-neutral-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Tv size={14} className="text-yellow-400" />
                    Select Season & Episode
                  </span>
                  <span className="text-[11px] text-yellow-400 font-bold">
                    Season {currentSeason?.seasonNumber}
                  </span>
                </div>

                {/* Season tabs */}
                {movie.seasons.length > 1 && (
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {movie.seasons.map((s: any, idx: number) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setSelectedSeasonIdx(idx);
                          setSelectedEpisodeIdx(0);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                          selectedSeasonIdx === idx
                            ? 'bg-yellow-400 text-black shadow-md'
                            : 'bg-neutral-800 text-gray-300 hover:bg-neutral-700'
                        }`}
                      >
                        Season {s.seasonNumber}
                      </button>
                    ))}
                  </div>
                )}

                {/* Episode pills */}
                <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
                  {currentSeason?.episodes?.map((ep: any, eIdx: number) => (
                    <button
                      key={eIdx}
                      type="button"
                      onClick={() => setSelectedEpisodeIdx(eIdx)}
                      className={`p-2 rounded-xl text-left border transition-all cursor-pointer flex items-center gap-2 ${
                        selectedEpisodeIdx === eIdx
                          ? 'bg-yellow-400/10 border-yellow-400 text-yellow-400 shadow-sm'
                          : 'bg-neutral-900 border-neutral-800 text-gray-300 hover:border-neutral-700'
                      }`}
                    >
                      <span className="w-5 h-5 rounded-md bg-neutral-800 text-[10px] font-black flex items-center justify-center flex-shrink-0">
                        {ep.episodeNumber}
                      </span>
                      <span className="text-xs font-bold truncate flex-grow">
                        {ep.title}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quality Options Section */}
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <label className="text-xs font-black text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles size={14} className="text-yellow-400" />
                  Choose Video Quality
                </label>
                <span className="text-[11px] text-gray-500 font-semibold">
                  Saved directly to Download folder
                </span>
              </div>

              <div className="space-y-2">
                {DEFAULT_QUALITIES.map((q) => {
                  const isSelected = selectedQuality === q.id;
                  return (
                    <div
                      key={q.id}
                      onClick={() => setSelectedQuality(q.id)}
                      className={`p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-yellow-400/15 border-yellow-400/90 shadow-md shadow-yellow-400/10'
                          : 'bg-neutral-950/80 border-neutral-800 hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected
                              ? 'border-yellow-400 bg-yellow-400 text-black'
                              : 'border-neutral-700 bg-transparent'
                          }`}
                        >
                          {isSelected && <CheckCircle2 size={13} className="stroke-[3]" />}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs sm:text-sm font-black text-white">
                              {q.label}
                            </span>
                            {q.badge && (
                              <span
                                className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                                  isSelected
                                    ? 'bg-yellow-400 text-black font-extrabold'
                                    : 'bg-neutral-800 text-gray-400'
                                }`}
                              >
                                {q.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {q.description}
                          </p>
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <span className="text-xs sm:text-sm font-black text-yellow-400 block">
                          {q.sizeLabel}
                        </span>
                        <span className="text-[10px] text-gray-500 font-medium">
                          {q.resolution}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Storage Path Indicator */}
            <div className="p-3 bg-neutral-950 rounded-xl border border-neutral-800 flex items-center justify-between text-[11px] text-gray-400">
              <span className="flex items-center gap-2">
                <HardDrive size={14} className="text-yellow-400 flex-shrink-0" />
                <span>Destination: <strong className="text-gray-200">/Internal Storage/Download/MoviePortal</strong></span>
              </span>
              <span className="text-green-400 font-bold flex items-center gap-1">
                <ShieldCheck size={13} />
                No Ads
              </span>
            </div>
          </div>

          {/* Footer Action Button */}
          <div className="p-4 sm:p-5 border-t border-neutral-800/80 bg-neutral-950 sticky bottom-0 z-10">
            {hasStarted ? (
              <div className="w-full bg-green-500/20 border border-green-500/40 text-green-400 py-3.5 px-4 rounded-2xl flex items-center justify-center gap-2 font-black text-xs sm:text-sm shadow-lg">
                <CheckCircle2 size={18} />
                <span>Download Started! Check Downloads tab for progress.</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleStart}
                disabled={isStarting}
                className="w-full bg-yellow-400 hover:bg-yellow-500 active:scale-98 text-black font-black text-xs sm:text-sm py-3.5 px-5 rounded-2xl shadow-xl shadow-yellow-400/20 transition-all flex items-center justify-center gap-2.5 cursor-pointer uppercase tracking-wider"
              >
                <Download size={18} className="stroke-[2.5]" />
                <span>Download Now ({activeQualityObj.label} • {activeQualityObj.sizeLabel})</span>
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
