import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Download,
  CheckCircle2,
  Tv,
  HardDrive,
  Sparkles,
  Volume2,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  Loader2,
  Check,
  Layers,
} from 'lucide-react';
import { upgradePosterUrl } from '../utils/posterUrl';
import { isEpisodeNewActive } from '../services/movieStorage';
import { StartDownloadParams, useDownloads } from '../hooks/useDownloads';

export interface DownloadQualityOption {
  id: string;
  label: string;
  resolution: string;
  sizeLabel: string;
  sizeMb: number;
  badge?: string;
  description: string;
  url: string;
}

const QUALITY_PRESETS: Record<
  string,
  { label: string; resolution: string; sizeLabel: string; sizeMb: number; badge: string; description: string }
> = {
  '2160p': {
    label: '4K Ultra HD',
    resolution: '3840×2160',
    sizeLabel: '~2.8 GB',
    sizeMb: 2800,
    badge: '4K UHD',
    description: 'Maximum clarity master stream for large screens',
  },
  '1080p': {
    label: '1080p Full HD',
    resolution: '1920×1080',
    sizeLabel: '~1.4 GB',
    sizeMb: 1400,
    badge: 'FULL HD',
    description: 'Crisp cinema detail, high-bitrate audio',
  },
  '720p': {
    label: '720p HD',
    resolution: '1280×720',
    sizeLabel: '~820 MB',
    sizeMb: 820,
    badge: 'RECOMMENDED',
    description: 'Balanced speed, sharpness and offline storage',
  },
  '480p': {
    label: '480p SD',
    resolution: '854×480',
    sizeLabel: '~420 MB',
    sizeMb: 420,
    badge: 'FAST',
    description: 'Fast download, smooth mobile playback',
  },
  '360p': {
    label: '360p Data Saver',
    resolution: '640×360',
    sizeLabel: '~220 MB',
    sizeMb: 220,
    badge: 'DATA SAVER',
    description: 'Smallest file size for low mobile data',
  },
};

interface DownloadOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  movie: any;
  initialSeasonIndex?: number;
  initialEpisodeIndex?: number;
  audioLanguage?: string;
  onConfirmDownload: (options: StartDownloadParams) => void | Promise<any>;
  onViewDownloads?: () => void;
}

export default function DownloadOptionsModal({
  isOpen,
  onClose,
  movie,
  initialSeasonIndex = 0,
  initialEpisodeIndex = 0,
  audioLanguage,
  onConfirmDownload,
  onViewDownloads,
}: DownloadOptionsModalProps) {
  const { getDownloadMatch } = useDownloads();
  const seasonsList: any[] = Array.isArray(movie?.seasons) ? movie.seasons : [];
  const isSeries = seasonsList.length > 0;

  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState<number>(initialSeasonIndex);
  const [selectedEpisodeIdx, setSelectedEpisodeIdx] = useState<number>(initialEpisodeIndex);
  const [selectedQualityId, setSelectedQualityId] = useState<string>('auto');
  const [isStarting, setIsStarting] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [startedBatchCount, setStartedBatchCount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !movie) return;
    const maxS = Math.max(0, seasonsList.length - 1);
    const safeS = Math.max(0, Math.min(initialSeasonIndex, maxS));
    const eps = Array.isArray(seasonsList[safeS]?.episodes) ? seasonsList[safeS].episodes : [];
    const maxE = Math.max(0, eps.length - 1);
    setSelectedSeasonIdx(safeS);
    setSelectedEpisodeIdx(Math.max(0, Math.min(initialEpisodeIndex, maxE)));
    setHasStarted(false);
    setStartedBatchCount(0);
    setErrorMsg(null);
    setIsStarting(false);
  }, [isOpen, movie?.id, initialSeasonIndex, initialEpisodeIndex]);

  const safeSeasonIdx = isSeries ? Math.max(0, Math.min(selectedSeasonIdx, seasonsList.length - 1)) : 0;
  const currentSeason = isSeries ? seasonsList[safeSeasonIdx] : null;
  const episodes: any[] = Array.isArray(currentSeason?.episodes) ? currentSeason.episodes : [];
  const safeEpisodeIdx = episodes.length > 0 ? Math.max(0, Math.min(selectedEpisodeIdx, episodes.length - 1)) : 0;
  const currentEpisode = episodes[safeEpisodeIdx] || null;

  const currentSeasonNumber = Number(currentSeason?.seasonNumber || safeSeasonIdx + 1);
  const currentEpisodeNumber = Number(currentEpisode?.episodeNumber || safeEpisodeIdx + 1);
  const seasonEpisodeLabel =
    isSeries && currentEpisode
      ? `S${String(currentSeasonNumber).padStart(2, '0')}E${String(currentEpisodeNumber).padStart(2, '0')}`
      : undefined;

  const downloadTitle = useMemo(() => {
    if (!movie) return '';
    if (isSeries && currentEpisode) {
      const epTitle = currentEpisode.title ? `: ${currentEpisode.title}` : '';
      return `${movie.title} - ${seasonEpisodeLabel}${epTitle}`;
    }
    return movie.title || 'Untitled';
  }, [movie, isSeries, currentEpisode, seasonEpisodeLabel]);

  // Build dynamic quality list strictly backed by real URLs from episode or movie
  const qualityOptions = useMemo<DownloadQualityOption[]>(() => {
    if (!movie) return [];
    const list: DownloadQualityOption[] = [];
    const rawQualities: Record<string, string> =
      (isSeries ? currentEpisode?.videoQualities : movie.videoQualities) || {};

    const orderedKeys = ['2160p', '4k', '1080p', '720p', '480p', '360p'];
    const seenUrls = new Set<string>();

    for (const key of orderedKeys) {
      const matchedKey = Object.keys(rawQualities).find(
        (k) => k.toLowerCase() === key.toLowerCase()
      );
      const urlVal = matchedKey ? String(rawQualities[matchedKey] || '').trim() : '';
      if (!urlVal) continue;
      seenUrls.add(urlVal);
      const preset = QUALITY_PRESETS[key === '4k' ? '2160p' : key] || {
        label: `${key.toUpperCase()} HD`,
        resolution: key.toUpperCase(),
        sizeLabel: '~850 MB',
        sizeMb: 850,
        badge: 'HD',
        description: 'Direct MP4 download for offline viewing',
      };
      list.push({
        id: key,
        ...preset,
        url: urlVal,
      });
    }

    // Any extra custom quality keys
    for (const [k, v] of Object.entries(rawQualities)) {
      const urlVal = String(v || '').trim();
      if (!urlVal || seenUrls.has(urlVal)) continue;
      seenUrls.add(urlVal);
      list.push({
        id: k,
        label: `${k} Stream`,
        resolution: k,
        sizeLabel: '~750 MB',
        sizeMb: 750,
        badge: 'DIRECT',
        description: 'Direct offline download stream',
        url: urlVal,
      });
    }

    // Always include the main real streaming URL if not already represented
    const primaryUrl = String(
      (isSeries ? currentEpisode?.streamUrl : movie.streamingUrl) ||
        movie.streamingUrl ||
        ''
    ).trim();

    if (primaryUrl && !seenUrls.has(primaryUrl)) {
      const badgeText = String(movie.qualityBadge || 'HD').toUpperCase();
      list.unshift({
        id: 'primary',
        label: `${badgeText} Direct MP4`,
        resolution: badgeText.includes('1080')
          ? '1920×1080'
          : badgeText.includes('4K')
          ? '3840×2160'
          : '720p–1080p',
        sizeLabel: isSeries ? '~450 MB' : '~850 MB',
        sizeMb: isSeries ? 450 : 850,
        badge: 'ORIGINAL',
        description: 'Direct original source saved for zero-network playback',
        url: primaryUrl,
      });
    }

    return list;
  }, [movie, isSeries, currentEpisode]);

  useEffect(() => {
    if (qualityOptions.length === 0) return;
    const stillValid = qualityOptions.some((q) => q.id === selectedQualityId);
    if (!stillValid) {
      const rec =
        qualityOptions.find((q) => q.id === '720p') ||
        qualityOptions.find((q) => q.id === 'primary') ||
        qualityOptions[0];
      if (rec) setSelectedQualityId(rec.id);
    }
  }, [qualityOptions, selectedQualityId]);

  if (!isOpen || !movie) return null;

  const activeQualityObj =
    qualityOptions.find((q) => q.id === selectedQualityId) || qualityOptions[0] || null;

  const movieId = movie.id || movie.imdbId;
  const currentMatch = getDownloadMatch(
    movieId,
    activeQualityObj?.url,
    isSeries ? currentSeasonNumber : undefined,
    isSeries ? currentEpisodeNumber : undefined
  );

  const posterSrc =
    upgradePosterUrl(movie.posterUrl || movie.backdropUrl, 700) ||
    movie.posterUrl ||
    movie.backdropUrl ||
    '';

  const handleStartSingle = async () => {
    setErrorMsg(null);
    if (!activeQualityObj || !activeQualityObj.url) {
      setErrorMsg(
        isSeries
          ? 'No downloadable video link found for this episode.'
          : 'No downloadable video link found for this movie.'
      );
      return;
    }

    setIsStarting(true);
    try {
      await onConfirmDownload({
        movieId,
        title: downloadTitle,
        posterUrl: posterSrc,
        videoUrl: activeQualityObj.url,
        quality: activeQualityObj.label,
        releaseYear: Number(movie.releaseYear) || new Date().getFullYear(),
        originalCategory: movie.displayCategory || movie.originalCategory || (isSeries ? 'Series' : 'Movies'),
        estimatedSizeMb: activeQualityObj.sizeMb,
        seasonNumber: isSeries ? currentSeasonNumber : undefined,
        episodeNumber: isSeries ? currentEpisodeNumber : undefined,
        seasonEpisodeLabel,
      });
      setStartedBatchCount(1);
      setHasStarted(true);
      setTimeout(() => {
        setHasStarted(false);
        onClose();
      }, 1500);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Could not start download.');
    } finally {
      setIsStarting(false);
    }
  };

  const handleDownloadEntireSeason = async () => {
    if (!isSeries || episodes.length === 0) return;
    setErrorMsg(null);
    const downloadable = episodes.filter((ep) => {
      const url = String(
        ep?.streamUrl ||
          ep?.videoQualities?.['720p'] ||
          ep?.videoQualities?.['1080p'] ||
          ep?.videoQualities?.['480p'] ||
          ''
      ).trim();
      if (!url) return false;
      const epNum = Number(ep?.episodeNumber || 0);
      const match = getDownloadMatch(movieId, url, currentSeasonNumber, epNum);
      return !match.active && !match.completed;
    });

    if (downloadable.length === 0) {
      setErrorMsg('All episodes in this season are already downloaded or queued.');
      return;
    }

    setIsStarting(true);
    try {
      let queued = 0;
      for (let i = 0; i < episodes.length; i++) {
        const ep = episodes[i];
        const epNum = Number(ep?.episodeNumber || i + 1);
        const url = String(
          ep?.streamUrl ||
            ep?.videoQualities?.['720p'] ||
            ep?.videoQualities?.['1080p'] ||
            ep?.videoQualities?.['480p'] ||
            ''
        ).trim();
        if (!url) continue;
        const match = getDownloadMatch(movieId, url, currentSeasonNumber, epNum);
        if (match.active || match.completed) continue;

        const seLabel = `S${String(currentSeasonNumber).padStart(2, '0')}E${String(epNum).padStart(2, '0')}`;
        const epTitle = ep?.title ? `: ${ep.title}` : '';
        await onConfirmDownload({
          movieId,
          title: `${movie.title} - ${seLabel}${epTitle}`,
          posterUrl: posterSrc,
          videoUrl: url,
          quality: activeQualityObj?.label || 'HD MP4',
          releaseYear: Number(movie.releaseYear) || new Date().getFullYear(),
          originalCategory: movie.displayCategory || movie.originalCategory || 'Series',
          estimatedSizeMb: activeQualityObj?.sizeMb || 450,
          seasonNumber: currentSeasonNumber,
          episodeNumber: epNum,
          seasonEpisodeLabel: seLabel,
        });
        queued++;
      }
      setStartedBatchCount(queued);
      setHasStarted(true);
      setTimeout(() => {
        setHasStarted(false);
        onClose();
      }, 1600);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to queue season download.');
    } finally {
      setIsStarting(false);
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[110] bg-black/85 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#14171d] border-t sm:border border-white/15 rounded-t-[28px] sm:rounded-[24px] max-w-lg w-full max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl relative animate-in fade-in slide-in-from-bottom-4 duration-200"
      >
        {/* Header Bar */}
        <div className="p-4 sm:p-5 border-b border-white/[0.08] flex items-center justify-between bg-[#0f1116] sticky top-0 z-10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#00d664]/15 border border-[#00d664]/40 flex items-center justify-center text-[#00d664] flex-shrink-0">
              <Download size={18} />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-black text-white tracking-tight flex items-center gap-2">
                <span>{isSeries ? 'Download Episodes' : 'Download Movie'}</span>
                <span className="text-[10px] bg-[#00d664] text-black font-extrabold px-1.5 py-0.5 rounded">
                  OFFLINE MP4
                </span>
              </h3>
              <p className="text-[11px] text-neutral-400 truncate">
                {isSeries
                  ? 'Select season & episode to watch without internet'
                  : 'Save video to watch anytime without internet'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-white/[0.08] hover:bg-white/[0.15] text-neutral-300 hover:text-white transition-colors cursor-pointer flex-shrink-0"
            aria-label="Close download options"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-4 sm:p-5 overflow-y-auto space-y-4">
          {/* Movie / Series Summary Card */}
          <div className="flex gap-3.5 bg-[#0f1116] p-3 rounded-2xl border border-white/[0.08]">
            <div className="w-16 h-24 rounded-xl overflow-hidden bg-neutral-900 flex-shrink-0 border border-white/10 shadow-md">
              {posterSrc ? (
                <img
                  src={posterSrc}
                  alt={movie.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-600 text-xs font-bold">
                  MP4
                </div>
              )}
            </div>

            <div className="flex flex-col justify-between py-0.5 flex-grow min-w-0">
              <div>
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span className="text-[10px] font-bold text-[#00d664] uppercase tracking-wider bg-[#00d664]/10 border border-[#00d664]/25 px-2 py-0.5 rounded">
                    {isSeries ? `Series • ${seasonEpisodeLabel || 'Episode'}` : movie.displayCategory || 'Movie'}
                  </span>
                  {movie.releaseYear && (
                    <span className="text-[11px] text-neutral-400">• {movie.releaseYear}</span>
                  )}
                </div>

                <h4 className="text-sm sm:text-base font-black text-white truncate">
                  {downloadTitle}
                </h4>

                <p className="text-[11px] text-neutral-400 truncate mt-0.5">
                  {movie.genre || 'HD Video'}
                </p>
              </div>

              <div className="flex items-center gap-3 text-[11px] text-neutral-300 pt-1">
                <span className="flex items-center gap-1">
                  <Volume2 size={13} className="text-[#00d664]" />
                  <span>{audioLanguage || movie.language || 'Original Audio'}</span>
                </span>
                {activeQualityObj && (
                  <span className="flex items-center gap-1">
                    <HardDrive size={13} className="text-amber-400" />
                    <span>{activeQualityObj.sizeLabel}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Series Season & Episode Picker */}
          {isSeries && (
            <div className="bg-[#0f1116] p-3.5 rounded-2xl border border-white/[0.08] space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-black text-white uppercase tracking-wider flex items-center gap-1.5">
                  <Tv size={14} className="text-[#00d664]" />
                  <span>Select Season & Episode</span>
                </span>
                {episodes.length > 1 && (
                  <button
                    type="button"
                    disabled={isStarting}
                    onClick={handleDownloadEntireSeason}
                    className="text-[11px] font-bold text-[#00d664] hover:text-[#00ef70] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <Layers size={12} />
                    <span>Download All ({episodes.length})</span>
                  </button>
                )}
              </div>

              {/* Season Tabs */}
              {seasonsList.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {seasonsList.map((s: any, idx: number) => {
                    const sNum = s.seasonNumber || idx + 1;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setSelectedSeasonIdx(idx);
                          setSelectedEpisodeIdx(0);
                          setErrorMsg(null);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                          safeSeasonIdx === idx
                            ? 'bg-[#00d664] text-black shadow-md'
                            : 'bg-[#1e222b] text-neutral-300 hover:bg-[#272c37]'
                        }`}
                      >
                        Season {String(sNum).padStart(2, '0')}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Episode List Grid */}
              {episodes.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                  {episodes.map((ep: any, eIdx: number) => {
                    const epNum = Number(ep.episodeNumber || eIdx + 1);
                    const epNumLabel = String(epNum).padStart(2, '0');
                    const epStreamUrl = String(
                      ep?.streamUrl ||
                        ep?.videoQualities?.['720p'] ||
                        ep?.videoQualities?.['1080p'] ||
                        ep?.videoQualities?.['480p'] ||
                        ''
                    ).trim();
                    const epMatch = getDownloadMatch(movieId, epStreamUrl, currentSeasonNumber, epNum);
                    const isSelected = safeEpisodeIdx === eIdx;
                    const isNew = isEpisodeNewActive(ep);

                    return (
                      <button
                        key={eIdx}
                        type="button"
                        onClick={() => {
                          setSelectedEpisodeIdx(eIdx);
                          setErrorMsg(null);
                        }}
                        className={`relative p-2.5 rounded-xl text-left border transition-all cursor-pointer flex items-center gap-2.5 ${
                          isSelected
                            ? 'bg-[#00d664]/15 border-[#00d664] text-white shadow-sm'
                            : 'bg-[#181c23] border-white/[0.08] text-neutral-300 hover:border-white/20'
                        }`}
                      >
                        <span
                          className={`w-7 h-7 rounded-lg text-[11px] font-black flex items-center justify-center flex-shrink-0 ${
                            isSelected ? 'bg-[#00d664] text-black' : 'bg-[#232833] text-neutral-200'
                          }`}
                        >
                          {epNumLabel}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold truncate">
                              {ep.title || `Episode ${epNumLabel}`}
                            </span>
                            {isNew && (
                              <span className="text-[9px] font-extrabold px-1 py-0.2 rounded bg-[#00d664] text-black flex-shrink-0">
                                NEW
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-neutral-400 block truncate">
                            {epMatch.completed
                              ? '✓ Downloaded Offline'
                              : epMatch.active
                              ? `Downloading ${epMatch.active.progress}%`
                              : epStreamUrl
                              ? 'Tap to select'
                              : 'No link'}
                          </span>
                        </div>
                        {epMatch.completed && (
                          <Check size={14} className="text-[#00d664] flex-shrink-0" />
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-neutral-400 py-3 text-center">
                  No episodes found in this season.
                </p>
              )}
            </div>
          )}

          {/* Quality Options */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-black text-neutral-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={14} className="text-[#00d664]" />
                <span>Video Source & Quality</span>
              </label>
              <span className="text-[11px] text-neutral-400">Saved in Downloads</span>
            </div>

            {qualityOptions.length > 0 ? (
              <div className="space-y-2">
                {qualityOptions.map((q) => {
                  const isSelected = activeQualityObj?.id === q.id;
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => setSelectedQualityId(q.id)}
                      className={`w-full text-left p-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-[#00d664]/12 border-[#00d664] shadow-md'
                          : 'bg-[#0f1116] border-white/[0.08] hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                            isSelected
                              ? 'border-[#00d664] bg-[#00d664] text-black'
                              : 'border-neutral-600 bg-transparent'
                          }`}
                        >
                          {isSelected && <Check size={12} className="stroke-[3]" />}
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs sm:text-sm font-black text-white">
                              {q.label}
                            </span>
                            {q.badge && (
                              <span
                                className={`text-[9px] font-black px-1.5 py-0.5 rounded ${
                                  isSelected
                                    ? 'bg-[#00d664] text-black'
                                    : 'bg-white/10 text-neutral-300'
                                }`}
                              >
                                {q.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-400 mt-0.5 truncate">
                            {q.description}
                          </p>
                        </div>
                      </div>

                      <div className="text-right flex-shrink-0">
                        <span className="text-xs sm:text-sm font-black text-[#00d664] block">
                          {q.sizeLabel}
                        </span>
                        <span className="text-[10px] text-neutral-500 font-medium">
                          {q.resolution}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
                <AlertCircle size={16} className="flex-shrink-0" />
                <span>No playable download link configured for this item yet.</span>
              </div>
            )}
          </div>

          {/* Offline Vault Info */}
          <div className="p-3 bg-[#0f1116] rounded-xl border border-white/[0.08] flex items-center justify-between text-[11px] text-neutral-400">
            <span className="flex items-center gap-2 min-w-0">
              <HardDrive size={14} className="text-[#00d664] flex-shrink-0" />
              <span className="truncate">Saved inside app Downloads folder for offline play</span>
            </span>
            <span className="text-[#00d664] font-bold flex items-center gap-1 flex-shrink-0 ml-2">
              <ShieldCheck size={13} />
              Offline Ready
            </span>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/40 text-xs text-red-300 flex items-center gap-2">
              <AlertCircle size={15} className="flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>

        {/* Footer Button */}
        <div className="p-4 sm:p-5 border-t border-white/[0.08] bg-[#0f1116] sticky bottom-0 z-10 space-y-2">
          {hasStarted ? (
            <div className="space-y-2">
              <div className="w-full bg-[#00d664]/15 border border-[#00d664]/45 text-[#00d664] py-3 px-4 rounded-xl flex items-center justify-center gap-2 font-black text-xs sm:text-sm">
                <CheckCircle2 size={18} />
                <span>
                  {startedBatchCount > 1
                    ? `${startedBatchCount} episodes download started!`
                    : 'Download started! Live % visible in notification bar & Downloads.'}
                </span>
              </div>
              {onViewDownloads && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onViewDownloads();
                  }}
                  className="w-full py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>Go to Downloads Folder</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>
          ) : currentMatch.active ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onViewDownloads?.();
              }}
              className="w-full bg-amber-400 hover:bg-amber-300 text-black font-black text-xs sm:text-sm py-3.5 px-5 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Loader2 size={17} className="animate-spin" />
              <span>Downloading ({currentMatch.active.progress}%) • View in Downloads</span>
            </button>
          ) : currentMatch.completed ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onViewDownloads?.();
              }}
              className="w-full bg-[#00d664] hover:bg-[#00bf59] text-black font-black text-xs sm:text-sm py-3.5 px-5 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle2 size={17} />
              <span>Already Downloaded • Watch Offline in Downloads</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStartSingle}
              disabled={isStarting || !activeQualityObj?.url}
              className="w-full bg-[#00d664] hover:bg-[#00bf59] active:scale-[0.99] disabled:opacity-50 text-black font-black text-xs sm:text-sm py-3.5 px-5 rounded-xl shadow-lg shadow-[#00d664]/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isStarting ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <Download size={17} className="stroke-[2.5]" />
              )}
              <span>
                {isSeries && seasonEpisodeLabel
                  ? `Download ${seasonEpisodeLabel} (${activeQualityObj?.label || 'MP4'})`
                  : `Download Now (${activeQualityObj?.label || 'MP4'})`}
              </span>
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
