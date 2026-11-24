import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Play,
  Download,
  Share2,
  Bookmark,
  Clapperboard,
  Check,
  CheckCircle2,
  Loader2,
  ChevronDown,
  Film,
  Tv,
  Volume2,
} from 'lucide-react';
import DownloadOptionsModal from './DownloadOptionsModal';
import { buildApiUrl } from '../utils/apiConfig';
import { useDownloads } from '../hooks/useDownloads';
import { upgradePosterUrl } from '../utils/posterUrl';
import { addToMyList, removeFromMyList } from '../services/userWatchService';
import { getAppPreferences } from '../services/userPreferencesService';
import {
  formatHumanDuration,
  parseDurationToSeconds,
  prewarmTelegramStream,
  probeTelegramDurationSec,
} from '../utils/duration';
import { isEpisodeNewActive, getEpisodeDisplayLabel } from '../services/movieStorage';

interface MovieDetailsModalProps {
  movie: any | null;
  isOpen: boolean;
  onClose: () => void;
  onWatchNow: (movie: any, seasonIndex?: number, episodeIndex?: number, audioLanguage?: string) => void;
  allMovies?: any[];
  userId?: string;
  isSavedInMyList?: boolean;
  onToggleMyList?: (movie: any) => void;
  onSelectMovie?: (movie: any) => void;
  initialSeasonIndex?: number;
  initialEpisodeIndex?: number;
}

export default function MovieDetailsModal({
  movie,
  isOpen,
  onClose,
  onWatchNow,
  allMovies = [],
  userId = 'guest_user',
  isSavedInMyList = false,
  onToggleMyList,
  onSelectMovie,
  initialSeasonIndex = 0,
  initialEpisodeIndex = 0,
}: MovieDetailsModalProps) {
  const [activeSeasonIndex, setActiveSeasonIndex] = useState(initialSeasonIndex);
  const [selectedEpisodeIdx, setSelectedEpisodeIdx] = useState<number>(initialEpisodeIndex);
  const [isSeasonDropdownOpen, setIsSeasonDropdownOpen] = useState(false);
  const [isAudioDropdownOpen, setIsAudioDropdownOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    () => getAppPreferences().preferredLanguage || 'Hindi'
  );
  const [localSavedInList, setLocalSavedInList] = useState<boolean>(isSavedInMyList);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [probedMovieDurationSec, setProbedMovieDurationSec] = useState<number>(0);
  const [probedEpisodeDurations, setProbedEpisodeDurations] = useState<Record<string, number>>({});
  const [showDownloadModal, setShowDownloadModal] = useState(false);

  const { activeDownloads, downloads, startDownload, getDownloadMatch } = useDownloads();

  const seasonsList = Array.isArray(movie?.seasons) ? movie.seasons : [];
  const isSeries = Boolean(
    seasonsList.length > 0 ||
      movie?.contentType === 'series' ||
      String(movie?.displayCategory || '').toLowerCase().includes('series') ||
      String(movie?.originalCategory || '').toLowerCase().includes('series')
  );
  const hasRealSeasons = isSeries && seasonsList.length > 0;

  useEffect(() => {
    setLocalSavedInList(isSavedInMyList);
  }, [isSavedInMyList, movie?.id]);

  // Reset state on movie change
  useEffect(() => {
    if (movie) {
      const maxSIdx = Math.max(0, (movie.seasons?.length || 1) - 1);
      const clampedSeasonIdx = Math.max(0, Math.min(initialSeasonIndex, maxSIdx));
      const targetSeason = movie.seasons?.[clampedSeasonIdx];
      const maxEIdx = Math.max(0, (targetSeason?.episodes?.length || 1) - 1);
      const clampedEpIdx = Math.max(0, Math.min(initialEpisodeIndex, maxEIdx));
      setActiveSeasonIndex(clampedSeasonIdx);
      setSelectedEpisodeIdx(clampedEpIdx);
      setIsSeasonDropdownOpen(false);
      setIsAudioDropdownOpen(false);
      setProbedMovieDurationSec(0);
      setProbedEpisodeDurations({});
      setShowDownloadModal(false);
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [movie?.id, initialSeasonIndex, initialEpisodeIndex]);

  // Lock body scroll while open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  const showToast = (msg: string) => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToastMessage(msg);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2600);
  };

  // Real available languages from movie metadata
  const availableLanguages = useMemo(() => {
    const fallback = ['Original Audio'];
    if (!movie) return fallback;
    if (movie.language && typeof movie.language === 'string') {
      const parts = movie.language
        .split(/[,/|]/)
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (parts.length > 0) return parts;
    }
    return fallback;
  }, [movie]);

  useEffect(() => {
    if (availableLanguages.length === 0) return;
    const prefLang = getAppPreferences().preferredLanguage;
    const matchedPref = availableLanguages.find(
      (l) => l.toLowerCase() === String(prefLang || '').toLowerCase()
    );
    if (matchedPref) {
      setSelectedLanguage(matchedPref);
    } else if (!availableLanguages.includes(selectedLanguage)) {
      setSelectedLanguage(availableLanguages[0]);
    }
  }, [availableLanguages]);

  // Related titles ("More Like This")
  const relatedMovies = useMemo(() => {
    if (!movie || !allMovies || allMovies.length === 0) return [];
    const currentId = movie.id || movie.imdbId;
    const currentGenre = String(movie.genre || movie.displayCategory || '').toLowerCase();
    const currentCat = String(movie.displayCategory || '').toLowerCase();

    const matched = allMovies.filter((m) => {
      const id = m.id || m.imdbId;
      if (id === currentId) return false;
      const g = String(m.genre || '').toLowerCase();
      const c = String(m.displayCategory || '').toLowerCase();
      return (
        (currentGenre && g.includes(currentGenre)) ||
        (currentCat && c.includes(currentCat)) ||
        (movie.originalCategory && m.originalCategory === movie.originalCategory)
      );
    });

    if (matched.length >= 6) return matched.slice(0, 9);

    const seen = new Set(matched.map((m) => m.id || m.imdbId));
    seen.add(currentId);
    const extras = allMovies.filter((m) => !seen.has(m.id || m.imdbId));
    return [...matched, ...extras].slice(0, 9);
  }, [movie, allMovies]);

  // Probe real Telegram duration when metadata duration is missing
  useEffect(() => {
    if (!isOpen || !movie) return;
    let cancelled = false;

    if (!hasRealSeasons) {
      const existingSec =
        (typeof movie.duration === 'number' && movie.duration > 0 ? movie.duration : 0) ||
        parseDurationToSeconds(movie.runtime);
      if (existingSec <= 0) {
        const candidateUrl =
          movie.streamingUrl ||
          movie.videoQualities?.['1080p'] ||
          movie.videoQualities?.['720p'] ||
          movie.videoQualities?.['480p'] ||
          '';
        if (candidateUrl) {
          probeTelegramDurationSec(candidateUrl).then((sec) => {
            if (!cancelled && sec > 0) {
              setProbedMovieDurationSec(sec);
            }
          });
        }
      }
      return () => {
        cancelled = true;
      };
    }

    const activeSeasonObj = seasonsList[activeSeasonIndex] || seasonsList[0];
    const eps: any[] = activeSeasonObj?.episodes || [];
    const probeEpisodes = async () => {
      for (const ep of eps.slice(0, 16)) {
        if (cancelled) break;
        const epSec =
          (typeof ep?.durationSec === 'number' && ep.durationSec > 0 ? ep.durationSec : 0) ||
          parseDurationToSeconds(ep?.duration);
        if (epSec > 0 || !ep?.streamUrl) continue;
        const url = String(ep.streamUrl).trim();
        if (!/t\.me|telegram\.me/i.test(url)) continue;
        const sec = await probeTelegramDurationSec(url);
        if (!cancelled && sec > 0) {
          setProbedEpisodeDurations((prev) => (prev[url] === sec ? prev : { ...prev, [url]: sec }));
        }
      }
    };
    probeEpisodes();

    return () => {
      cancelled = true;
    };
  }, [isOpen, movie?.id, hasRealSeasons, activeSeasonIndex]);

  // Pre-warm stream bridge & metadata for the currently selected movie or episode so Watch Now starts instantly
  useEffect(() => {
    if (!isOpen || !movie) return;
    const sIdx = seasonsList.length > 0 ? Math.min(activeSeasonIndex, seasonsList.length - 1) : 0;
    const curS = seasonsList[sIdx] || seasonsList[0];
    const eps: any[] = Array.isArray(curS?.episodes) ? curS.episodes : [];
    const epObj = hasRealSeasons ? (eps[selectedEpisodeIdx] || eps[0]) : null;
    const candidate = hasRealSeasons
      ? String(epObj?.streamUrl || epObj?.videoQualities?.['720p'] || epObj?.videoQualities?.['1080p'] || '').trim()
      : String(movie.streamingUrl || movie.videoQualities?.['720p'] || movie.videoQualities?.['1080p'] || '').trim();
    if (candidate && /t\.me|telegram\.me/i.test(candidate)) {
      prewarmTelegramStream(candidate);
    }
  }, [isOpen, movie?.id, hasRealSeasons, activeSeasonIndex, selectedEpisodeIdx]);

  if (!isOpen || !movie) return null;

  const safeSeasonIndex =
    seasonsList.length > 0 ? Math.min(activeSeasonIndex, seasonsList.length - 1) : 0;
  const currentSeason = seasonsList[safeSeasonIndex] || seasonsList[0];
  const episodeList: any[] = Array.isArray(currentSeason?.episodes) ? currentSeason.episodes : [];

  const primaryEpIdx =
    hasRealSeasons && episodeList[selectedEpisodeIdx] ? selectedEpisodeIdx : 0;
  const currentEpisodeObj = hasRealSeasons ? episodeList[primaryEpIdx] : null;

  const knownMovieDurationSec =
    (typeof movie.duration === 'number' && movie.duration > 0 ? movie.duration : 0) ||
    parseDurationToSeconds(movie.runtime) ||
    probedMovieDurationSec;
  const formattedMovieDuration = formatHumanDuration(movie.runtime, knownMovieDurationSec);

  const enrichMovieWithResolvedDuration = (sIdx = safeSeasonIndex, eIdx = 0) => {
    if (!movie) return movie;
    if (!hasRealSeasons) {
      return knownMovieDurationSec > 0 && !(movie.duration > 0)
        ? { ...movie, duration: knownMovieDurationSec }
        : movie;
    }
    const season = seasonsList[sIdx];
    const ep = season?.episodes?.[eIdx];
    const epUrl = String(ep?.streamUrl || '').trim();
    const epSec =
      (typeof ep?.durationSec === 'number' && ep.durationSec > 0 ? ep.durationSec : 0) ||
      parseDurationToSeconds(ep?.duration) ||
      (epUrl ? probedEpisodeDurations[epUrl] || 0 : 0);
    if (epSec > 0 && ep && !ep.durationSec) {
      const updatedSeasons = seasonsList.map((s: any, si: number) =>
        si !== sIdx
          ? s
          : {
              ...s,
              episodes: (s.episodes || []).map((eItem: any, ei: number) =>
                ei === eIdx ? { ...eItem, durationSec: epSec } : eItem
              ),
            }
      );
      return { ...movie, seasons: updatedSeasons };
    }
    return movie;
  };

  const handleToggleList = async () => {
    const movieId = movie.id || movie.imdbId;
    if (onToggleMyList) {
      onToggleMyList(movie);
      setLocalSavedInList((prev) => !prev);
      return;
    }
    if (!userId || !movieId) return;
    if (localSavedInList) {
      await removeFromMyList(userId, movieId);
      setLocalSavedInList(false);
      showToast('Removed from Watchlist');
    } else {
      await addToMyList(userId, movie);
      setLocalSavedInList(true);
      showToast('Added to Watchlist');
    }
  };

  const handleShare = async () => {
    const shareUrl = window.location.href;
    const shareText = `Watch "${movie.title}" on Movie Hub!`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: movie.title,
          text: shareText,
          url: shareUrl,
        });
        showToast('Shared successfully!');
        return;
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('Share error:', err);
        }
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
      showToast('Link copied to clipboard!');
    } catch {
      showToast('Share link ready!');
    }
  };

  const handlePlayTrailer = () => {
    if (!movie.trailerUrl || !String(movie.trailerUrl).trim()) {
      showToast('Trailer not available for this title');
      return;
    }
    onWatchNow(
      {
        ...movie,
        title: `${movie.title} - Official Trailer`,
        streamingUrl: movie.trailerUrl,
      },
      0,
      0,
      selectedLanguage
    );
  };

  const startPlayback = (sIdx = safeSeasonIndex, eIdx = primaryEpIdx) => {
    const enriched = enrichMovieWithResolvedDuration(sIdx, eIdx);
    onWatchNow(
      {
        ...enriched,
        ...(!hasRealSeasons && !enriched?.streamingUrl && rawStreamUrl
          ? { streamingUrl: rawStreamUrl }
          : {}),
      },
      sIdx,
      eIdx,
      selectedLanguage
    );
  };

  const rawBadge = String(movie.qualityBadge || '').trim();
  const badgeText =
    rawBadge && rawBadge.toUpperCase() !== 'NONE' ? rawBadge.toUpperCase() : '';
  const realYear = movie.releaseYear ? String(movie.releaseYear) : '';
  const metaLineItems = [
    badgeText,
    realYear,
    hasRealSeasons
      ? `${seasonsList.length} Season${seasonsList.length > 1 ? 's' : ''}`
      : !badgeText && formattedMovieDuration
      ? formattedMovieDuration
      : '',
  ].filter(Boolean);

  const languageLine =
    movie.language && String(movie.language).trim()
      ? availableLanguages.join(' | ')
      : '';

  const genreLine = movie.genre
    ? String(movie.genre)
        .split(/[,/|]/)
        .map((g: string) => g.trim())
        .filter(Boolean)
        .join(' | ')
    : movie.displayCategory || movie.originalCategory || '';

  const currentMovieId = movie.id || movie.imdbId;
  const currentSeasonNumber = hasRealSeasons
    ? Number(currentSeason?.seasonNumber || safeSeasonIndex + 1)
    : undefined;
  const currentEpisodeNumber =
    hasRealSeasons && currentEpisodeObj
      ? Number(currentEpisodeObj.episodeNumber || primaryEpIdx + 1)
      : undefined;

  const rawStreamUrl = hasRealSeasons
    ? String(
        currentEpisodeObj?.streamUrl ||
          currentEpisodeObj?.videoQualities?.['720p'] ||
          currentEpisodeObj?.videoQualities?.['1080p'] ||
          ''
      ).trim()
    : String(
        movie.streamingUrl ||
          movie.videoQualities?.['720p'] ||
          movie.videoQualities?.['1080p'] ||
          ''
      ).trim();

  const primaryDownloadUrl = rawStreamUrl
    ? rawStreamUrl.startsWith('http') && !rawStreamUrl.includes('/api/stream')
      ? buildApiUrl(`/api/stream?url=${encodeURIComponent(rawStreamUrl)}&ext=.mp4`)
      : rawStreamUrl
    : '';

  const currentDownloadMatch = getDownloadMatch(
    currentMovieId,
    primaryDownloadUrl,
    currentSeasonNumber,
    currentEpisodeNumber
  );
  const activeDownloadForTitle = hasRealSeasons
    ? activeDownloads.find((d) => d.movieId === currentMovieId && d.status !== 'error')
    : currentDownloadMatch.active;
  const completedCountForTitle = hasRealSeasons
    ? downloads.filter((d) => d.movieId === currentMovieId).length
    : currentDownloadMatch.completed
    ? 1
    : 0;

  const rawBanner = movie.backdropUrl || movie.posterUrl || '';
  const hdBanner = upgradePosterUrl(rawBanner, 1280) || rawBanner;
  const fallbackPoster = upgradePosterUrl(movie.posterUrl, 800) || movie.posterUrl || '';

  const selectedSeasonLabel = `Season ${String(
    currentSeason?.seasonNumber || safeSeasonIndex + 1
  ).padStart(2, '0')}`;
  const selectedEpLabel = currentEpisodeObj
    ? getEpisodeDisplayLabel(currentEpisodeObj, primaryEpIdx, true)
    : '01';

  const modalContent = (
    <div
      className="fixed inset-0 z-[90] w-full h-[100dvh] bg-black text-white flex flex-col overflow-hidden select-none"
      onClick={() => {
        if (isSeasonDropdownOpen) setIsSeasonDropdownOpen(false);
        if (isAudioDropdownOpen) setIsAudioDropdownOpen(false);
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-[max(1.25rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[120] bg-[#1a1a1a] border border-white/15 text-white text-xs sm:text-sm font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2">
          <CheckCircle2 size={16} className="text-[#00d664]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Scrollable Content */}
      <div
        ref={scrollContainerRef}
        className="overflow-y-auto overscroll-y-contain touch-pan-y flex-1 w-full pb-[calc(2.5rem+env(safe-area-inset-bottom))]"
      >
        <div className="w-full max-w-2xl mx-auto">
          {/* Top Rounded Hero Artwork Card with Top-Right X Close Button */}
          <div className="px-3 sm:px-5 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <div className="relative w-full aspect-[16/10] sm:aspect-[16/9] max-h-[380px] rounded-2xl sm:rounded-3xl overflow-hidden bg-neutral-950 shadow-2xl border border-white/[0.06]">
              {hdBanner ? (
                <img
                  src={hdBanner}
                  alt={movie.title}
                  draggable={false}
                  className="w-full h-full object-cover object-center"
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (fallbackPoster && img.src !== fallbackPoster && !img.dataset.triedFallback) {
                      img.dataset.triedFallback = '1';
                      img.src = fallbackPoster;
                      return;
                    }
                    img.src =
                      'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=1200';
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-neutral-700">
                  {hasRealSeasons ? <Tv size={48} /> : <Film size={48} />}
                </div>
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-black/25 pointer-events-none" />

              {/* Top-Right Circular Close Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="absolute top-3 right-3 sm:top-4 sm:right-4 z-30 w-9 h-9 rounded-full bg-black/55 hover:bg-black/80 text-white flex items-center justify-center backdrop-blur-md border border-white/15 shadow-lg cursor-pointer transition-transform active:scale-90"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Centered Title, Metadata, Watch Now CTA & Genre */}
          <div className="px-4 sm:px-6 pt-5 text-center">
            <h1 className="text-2xl sm:text-3xl font-extrabold uppercase tracking-wider text-white leading-tight">
              {movie.title}
            </h1>

            {metaLineItems.length > 0 && (
              <p className="mt-2.5 text-[13px] sm:text-sm text-neutral-300 font-medium tracking-wide">
                {metaLineItems.join(' | ')}
              </p>
            )}

            {languageLine && (
              <p className="mt-1.5 text-[13px] sm:text-sm text-neutral-300 font-medium tracking-wide">
                {languageLine}
              </p>
            )}

            {/* Full-Width White Watch Now Button */}
            <div className="mt-5">
              <button
                type="button"
                onClick={() => startPlayback(safeSeasonIndex, primaryEpIdx)}
                className="w-full bg-white hover:bg-neutral-200 active:scale-[0.985] text-black font-bold text-sm sm:text-base py-3.5 px-6 rounded-xl flex items-center justify-center gap-2.5 shadow-lg transition-all cursor-pointer"
              >
                <Play size={16} className="fill-black text-black" />
                <span>
                  {hasRealSeasons
                    ? `Watch Now • S${String(
                        currentSeason?.seasonNumber || safeSeasonIndex + 1
                      ).padStart(2, '0')} E${selectedEpLabel}`
                    : 'Watch Now'}
                </span>
              </button>
            </div>

            {genreLine && (
              <p className="mt-5 text-[13px] sm:text-sm font-bold text-white tracking-wide">
                {genreLine}
              </p>
            )}
          </div>

          {/* 4-Icon Action Bar (Trailer, Download, Share, Watchlist — NO Note Box & NO Telegram) */}
          <div className="px-4 sm:px-6 pt-5">
            <div className="grid grid-cols-4 gap-2 py-2 border-t border-white/[0.06]">
              {/* Trailer */}
              <button
                type="button"
                onClick={handlePlayTrailer}
                className="flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-xl hover:bg-white/[0.05] active:scale-95 transition-all cursor-pointer"
              >
                <Clapperboard size={22} className="text-white stroke-[1.8]" />
                <span className="text-[11px] sm:text-xs font-medium text-neutral-300">
                  Trailer
                </span>
              </button>

              {/* Download */}
              <button
                type="button"
                onClick={() => setShowDownloadModal(true)}
                className="flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-xl hover:bg-white/[0.05] active:scale-95 transition-all cursor-pointer"
              >
                {activeDownloadForTitle ? (
                  <Loader2 size={22} className="text-amber-400 animate-spin" />
                ) : completedCountForTitle > 0 ? (
                  <Check size={22} className="text-[#00d664] stroke-[2.3]" />
                ) : (
                  <Download size={22} className="text-white stroke-[1.8]" />
                )}
                <span
                  className={`text-[11px] sm:text-xs font-medium ${
                    activeDownloadForTitle
                      ? 'text-amber-400'
                      : completedCountForTitle > 0
                      ? 'text-[#00d664]'
                      : 'text-neutral-300'
                  }`}
                >
                  {activeDownloadForTitle
                    ? `${activeDownloadForTitle.progress}%`
                    : completedCountForTitle > 0
                    ? hasRealSeasons
                      ? `Saved (${completedCountForTitle})`
                      : 'Downloaded'
                    : 'Download'}
                </span>
              </button>

              {/* Share */}
              <button
                type="button"
                onClick={handleShare}
                className="flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-xl hover:bg-white/[0.05] active:scale-95 transition-all cursor-pointer"
              >
                <Share2 size={22} className="text-white stroke-[1.8]" />
                <span className="text-[11px] sm:text-xs font-medium text-neutral-300">
                  Share
                </span>
              </button>

              {/* Watchlist */}
              <button
                type="button"
                onClick={handleToggleList}
                className="flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-xl hover:bg-white/[0.05] active:scale-95 transition-all cursor-pointer"
              >
                <Bookmark
                  size={22}
                  className={
                    localSavedInList
                      ? 'text-white fill-white stroke-[1.8]'
                      : 'text-white stroke-[1.8]'
                  }
                />
                <span
                  className={`text-[11px] sm:text-xs font-medium ${
                    localSavedInList ? 'text-white font-semibold' : 'text-neutral-300'
                  }`}
                >
                  {localSavedInList ? 'Watchlisted' : 'Watchlist'}
                </span>
              </button>
            </div>
          </div>

          {/* SERIES SECTION: Season & Episode Selector */}
          {isSeries && (
            <div className="px-4 sm:px-6 pt-4 space-y-3.5">
              <div className="border-t border-white/[0.08] pt-4 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <Tv size={17} className="text-white" />
                  <h2 className="text-sm sm:text-base font-bold text-white tracking-tight">
                    Select Season &amp; Episode
                  </h2>
                </div>

                {hasRealSeasons && (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    {/* Audio Language Picker (if multiple languages exist) */}
                    {availableLanguages.length > 1 && (
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => {
                            setIsAudioDropdownOpen((prev) => !prev);
                            setIsSeasonDropdownOpen(false);
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141414] hover:bg-[#1f1f1f] border border-white/15 text-xs font-semibold text-white cursor-pointer"
                        >
                          <Volume2 size={13} className="text-neutral-400" />
                          <span>{selectedLanguage}</span>
                          <ChevronDown
                            size={14}
                            className={`text-neutral-400 transition-transform ${
                              isAudioDropdownOpen ? 'rotate-180' : ''
                            }`}
                          />
                        </button>

                        {isAudioDropdownOpen && (
                          <div className="absolute right-0 top-full mt-1.5 w-40 max-h-56 overflow-y-auto bg-[#161616] border border-white/15 rounded-xl shadow-2xl z-40 py-1">
                            {availableLanguages.map((lang) => (
                              <button
                                key={lang}
                                type="button"
                                onClick={() => {
                                  setSelectedLanguage(lang);
                                  setIsAudioDropdownOpen(false);
                                  showToast(`Audio set to ${lang}`);
                                }}
                                className={`w-full px-3 py-2 text-left text-xs font-semibold flex items-center justify-between cursor-pointer ${
                                  selectedLanguage === lang
                                    ? 'bg-white/10 text-white'
                                    : 'text-neutral-300 hover:bg-white/5'
                                }`}
                              >
                                <span>{lang}</span>
                                {selectedLanguage === lang && <Check size={13} />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Season Dropdown */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => {
                          setIsSeasonDropdownOpen((prev) => !prev);
                          setIsAudioDropdownOpen(false);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#141414] hover:bg-[#1f1f1f] border border-white/15 text-xs font-semibold text-white cursor-pointer"
                      >
                        <span>{selectedSeasonLabel}</span>
                        <ChevronDown
                          size={14}
                          className={`text-neutral-400 transition-transform ${
                            isSeasonDropdownOpen ? 'rotate-180' : ''
                          }`}
                        />
                      </button>

                      {isSeasonDropdownOpen && (
                        <div className="absolute right-0 top-full mt-1.5 w-48 max-h-64 overflow-y-auto bg-[#161616] border border-white/15 rounded-xl shadow-2xl z-40 py-1">
                          {seasonsList.map((season: any, idx: number) => {
                            const sNum = season.seasonNumber || idx + 1;
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  setActiveSeasonIndex(idx);
                                  setSelectedEpisodeIdx(0);
                                  setIsSeasonDropdownOpen(false);
                                }}
                                className={`w-full px-3.5 py-2.5 text-left text-xs font-semibold flex items-center justify-between cursor-pointer ${
                                  safeSeasonIndex === idx
                                    ? 'bg-white/10 text-white'
                                    : 'text-neutral-300 hover:bg-white/5'
                                }`}
                              >
                                <span>Season {String(sNum).padStart(2, '0')}</span>
                                <span className="text-[11px] text-neutral-400">
                                  {season.episodes?.length || 0} EP
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Quick Horizontal Season Pills */}
              {hasRealSeasons && seasonsList.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-1">
                  {seasonsList.map((season: any, idx: number) => {
                    const sNum = season.seasonNumber || idx + 1;
                    const isActive = safeSeasonIndex === idx;
                    return (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setActiveSeasonIndex(idx);
                          setSelectedEpisodeIdx(0);
                        }}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap border transition-colors cursor-pointer ${
                          isActive
                            ? 'bg-white text-black border-white'
                            : 'bg-[#141414] text-neutral-300 border-white/10 hover:border-white/25'
                        }`}
                      >
                        Season {sNum}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Episode Selection List */}
              {hasRealSeasons ? (
                episodeList.length > 0 ? (
                  <div className="space-y-2">
                    {episodeList.map((ep: any, eIdx: number) => {
                      const epNumLabel = getEpisodeDisplayLabel(ep, eIdx, true);
                      const isSelected = primaryEpIdx === eIdx;
                      const epUrl = String(ep?.streamUrl || '').trim();
                      const epDurationSec =
                        (typeof ep?.durationSec === 'number' && ep.durationSec > 0
                          ? ep.durationSec
                          : 0) ||
                        parseDurationToSeconds(ep?.duration) ||
                        (epUrl ? probedEpisodeDurations[epUrl] || 0 : 0);
                      const epHumanDuration = formatHumanDuration(ep?.duration, epDurationSec);
                      const isNew = isEpisodeNewActive(ep);

                      return (
                        <div
                          key={eIdx}
                          onClick={() => setSelectedEpisodeIdx(eIdx)}
                          className={`w-full rounded-xl p-3 border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-[#1a1a1a] border-white/50 shadow-md'
                              : 'bg-[#0f0f0f] border-white/[0.08] hover:border-white/25'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div
                              className={`min-w-[42px] h-10 px-2 rounded-lg text-xs font-extrabold flex items-center justify-center flex-shrink-0 ${
                                isSelected
                                  ? 'bg-white text-black'
                                  : 'bg-[#1c1c1c] text-neutral-300 border border-white/10'
                              }`}
                            >
                              E{epNumLabel}
                            </div>

                            <div className="min-w-0 flex-1 text-left">
                              <div className="flex items-center gap-2">
                                <p className="text-xs sm:text-sm font-bold text-white truncate">
                                  {ep?.title?.trim() || `Episode ${epNumLabel}`}
                                </p>
                                {isNew && (
                                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-red-600 text-white flex-shrink-0">
                                    NEW
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5 text-[11px] text-neutral-400">
                                <span>
                                  S{String(currentSeason?.seasonNumber || safeSeasonIndex + 1).padStart(2, '0')} • E{epNumLabel}
                                </span>
                                {epHumanDuration && (
                                  <>
                                    <span>•</span>
                                    <span>{epHumanDuration}</span>
                                  </>
                                )}
                                {isSelected && (
                                  <>
                                    <span>•</span>
                                    <span className="text-white font-semibold">Selected</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEpisodeIdx(eIdx);
                              startPlayback(safeSeasonIndex, eIdx);
                            }}
                            className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-transform active:scale-90 cursor-pointer ${
                              isSelected
                                ? 'bg-white text-black'
                                : 'bg-white/10 hover:bg-white/20 text-white'
                            }`}
                            aria-label={`Play Episode ${epNumLabel}`}
                          >
                            <Play size={15} className="fill-current ml-0.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-6 bg-[#0f0f0f] border border-white/[0.06] rounded-xl text-neutral-400 text-xs">
                    No episodes listed for this season yet.
                  </div>
                )
              ) : (
                <div className="text-center py-6 bg-[#0f0f0f] border border-white/[0.06] rounded-xl text-neutral-400 text-xs">
                  Seasons &amp; episodes have not been added for this series yet.
                </div>
              )}
            </div>
          )}

          {/* Storyline & Details Section */}
          {(movie.description || movie.cast || movie.director) && (
            <div className="px-4 sm:px-6 pt-5">
              <div className="border-t border-white/[0.08] pt-4 space-y-2.5 text-left">
                {movie.description && (
                  <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed">
                    {movie.description}
                  </p>
                )}
                {movie.cast && (
                  <p className="text-xs text-neutral-400">
                    <span className="text-neutral-200 font-semibold">Cast: </span>
                    {movie.cast}
                  </p>
                )}
                {movie.director && (
                  <p className="text-xs text-neutral-400">
                    <span className="text-neutral-200 font-semibold">Director: </span>
                    {movie.director}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Related Movies / Series ("More Like This") */}
          {relatedMovies.length > 0 && (
            <div className="px-4 sm:px-6 pt-6">
              <div className="border-t border-white/[0.08] pt-4 space-y-3">
                <h3 className="text-sm sm:text-base font-bold text-white">More Like This</h3>
                <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                  {relatedMovies.map((item: any) => (
                    <button
                      key={item.id || item.imdbId}
                      type="button"
                      onClick={() => {
                        if (onSelectMovie) {
                          onSelectMovie(item);
                        }
                      }}
                      className="text-left group cursor-pointer focus:outline-none"
                    >
                      <div className="relative aspect-[2/3] bg-[#121212] rounded-xl overflow-hidden border border-white/[0.08]">
                        <img
                          src={upgradePosterUrl(item.posterUrl, 400) || item.posterUrl}
                          alt={item.title}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-neutral-200 font-medium truncate">
                        {item.title}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Download Options Modal */}
      <DownloadOptionsModal
        isOpen={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
        movie={movie}
        initialSeasonIndex={safeSeasonIndex}
        initialEpisodeIndex={primaryEpIdx}
        audioLanguage={selectedLanguage}
        onConfirmDownload={(opts) => startDownload(opts)}
        onViewDownloads={() => {
          setShowDownloadModal(false);
          onClose();
          window.dispatchEvent(new CustomEvent('movie_portal_open_downloads'));
        }}
      />
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
