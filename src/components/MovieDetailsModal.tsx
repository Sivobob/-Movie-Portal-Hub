import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  Play,
  Plus,
  Check,
  Share2,
  Heart,
  Star,
  Flag,
  Clapperboard,
  Film,
  Tv,
  CheckCircle2,
  AlertTriangle,
  X,
} from 'lucide-react';
import { upgradePosterUrl } from '../utils/posterUrl';
import {
  saveUserRating,
  getUserRating,
  submitContentReport,
  addToMyList,
  removeFromMyList,
  addToMyLikes,
  removeFromMyLikes,
  fetchMyLikes,
} from '../services/userWatchService';
import { getAppPreferences } from '../services/userPreferencesService';
import {
  formatHumanDuration,
  parseDurationToSeconds,
  probeTelegramDurationSec,
} from '../utils/duration';
import { isEpisodeNewActive } from '../services/movieStorage';

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
}: MovieDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'for_you' | 'more_details'>('for_you');
  const [activeSeasonIndex, setActiveSeasonIndex] = useState(initialSeasonIndex);
  const [selectedEpisodeIdx, setSelectedEpisodeIdx] = useState<number>(0);
  const [isSeasonDropdownOpen, setIsSeasonDropdownOpen] = useState(false);
  const [isAudioDropdownOpen, setIsAudioDropdownOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() => getAppPreferences().preferredLanguage || 'Hindi');
  const [localSavedInList, setLocalSavedInList] = useState<boolean>(isSavedInMyList);
  const [isLiked, setIsLiked] = useState<boolean>(false);
  const [userRating, setUserRating] = useState<number | null>(null);
  const [showRatingDialog, setShowRatingDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState('Video is not playing or loading');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const tabsSectionRef = useRef<HTMLDivElement | null>(null);
  const [probedMovieDurationSec, setProbedMovieDurationSec] = useState<number>(0);
  const [probedEpisodeDurations, setProbedEpisodeDurations] = useState<Record<string, number>>({});

  const seasonsList = Array.isArray(movie?.seasons) ? movie.seasons : [];
  const isSeries = Boolean(
    seasonsList.length > 0 ||
      movie?.contentType === 'series' ||
      movie?.displayCategory?.toLowerCase().includes('series') ||
      movie?.originalCategory?.toLowerCase().includes('series')
  );
  const hasRealSeasons = isSeries && seasonsList.length > 0;

  useEffect(() => {
    setLocalSavedInList(isSavedInMyList);
  }, [isSavedInMyList, movie?.id]);

  // Reset state on movie change
  useEffect(() => {
    if (movie) {
      setActiveTab('for_you');
      const maxSIdx = Math.max(0, (movie.seasons?.length || 1) - 1);
      setActiveSeasonIndex(Math.max(0, Math.min(initialSeasonIndex, maxSIdx)));
      setSelectedEpisodeIdx(0);
      setIsSeasonDropdownOpen(false);
      setIsAudioDropdownOpen(false);
      setProbedMovieDurationSec(0);
      setProbedEpisodeDurations({});
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [movie?.id, initialSeasonIndex]);

  // Load user rating and like state
  useEffect(() => {
    const movieId = movie?.id || movie?.imdbId;
    if (!movieId || !userId) return;

    let active = true;
    getUserRating(userId, movieId).then((val) => {
      if (active) setUserRating(val);
    }).catch(() => {});

    fetchMyLikes(userId).then((likes) => {
      if (!active) return;
      setIsLiked(likes.some((l) => l.movieId === movieId));
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [movie?.id, movie?.imdbId, userId]);

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

  // Related titles ("For you") from database only
  const forYouMovies = useMemo(() => {
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

    if (matched.length >= 6) return matched.slice(0, 12);

    const seen = new Set(matched.map((m) => m.id || m.imdbId));
    seen.add(currentId);
    const extras = allMovies.filter((m) => !seen.has(m.id || m.imdbId));
    return [...matched, ...extras].slice(0, 12);
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

  if (!isOpen || !movie) return null;

  const safeSeasonIndex = seasonsList.length > 0 ? Math.min(activeSeasonIndex, seasonsList.length - 1) : 0;
  const currentSeason = seasonsList[safeSeasonIndex] || seasonsList[0];
  const episodeList: any[] = Array.isArray(currentSeason?.episodes) ? currentSeason.episodes : [];

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
      showToast('Removed from My List');
    } else {
      await addToMyList(userId, movie);
      setLocalSavedInList(true);
      showToast('Added to My List');
    }
  };

  const handleToggleLike = async () => {
    const movieId = movie.id || movie.imdbId;
    if (!userId || !movieId) return;
    if (isLiked) {
      await removeFromMyLikes(userId, movieId);
      setIsLiked(false);
      showToast('Removed from My Likes');
    } else {
      await addToMyLikes(userId, movie);
      setIsLiked(true);
      showToast('Added to My Likes');
    }
  };

  const handleRatingSelect = async (stars: number) => {
    setUserRating(stars);
    setShowRatingDialog(false);
    const movieId = movie.id || movie.imdbId;
    if (userId && movieId) {
      await saveUserRating(userId, movieId, stars);
      showToast(`Rated ${stars} Star${stars > 1 ? 's' : ''}`);
    }
  };

  const handleShare = async () => {
    const shareUrl = window.location.href;
    const shareText = `Watch "${movie.title}" on Movie Portal!`;
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

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportReason) return;
    setReportSubmitting(true);
    try {
      await submitContentReport(userId, {
        movieId: movie.id || movie.imdbId || 'unknown',
        movieTitle: movie.title || 'Untitled',
        reason: reportReason,
        details: reportDetails.trim(),
      });
      setShowReportDialog(false);
      setReportDetails('');
      showToast('Thank you! Issue reported to admin.');
    } catch {
      showToast('Report submitted successfully.');
      setShowReportDialog(false);
    } finally {
      setReportSubmitting(false);
    }
  };

  const handlePlayTrailer = () => {
    if (!movie.trailerUrl) return;
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

  // Real inline metadata items (never fabricate rating/country/year)
  const numericRating = Number(movie.rating);
  const hasRealRating = Number.isFinite(numericRating) && numericRating > 0;
  const realYear = movie.releaseYear ? String(movie.releaseYear) : '';
  const realCountry = movie.country ? String(movie.country).trim() : '';
  const realGenre = movie.genre ? String(movie.genre).split(',')[0].trim() : '';
  const seasonsCountLabel = hasRealSeasons
    ? `${seasonsList.length} season${seasonsList.length > 1 ? 's' : ''}`
    : formattedMovieDuration || '';

  const primaryEpIdx =
    hasRealSeasons && episodeList[selectedEpisodeIdx]
      ? selectedEpisodeIdx
      : 0;

  const modalContent = (
    <div
      className="fixed inset-0 z-[90] w-full h-[100dvh] bg-[#111317] text-white flex flex-col overflow-hidden select-none"
      onClick={() => {
        if (isSeasonDropdownOpen) setIsSeasonDropdownOpen(false);
        if (isAudioDropdownOpen) setIsAudioDropdownOpen(false);
      }}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-[max(1.25rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[120] bg-[#1d2027] border border-white/15 text-white text-xs sm:text-sm font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-200">
          <CheckCircle2 size={16} className="text-[#00d664]" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="relative w-full h-full bg-[#111317] text-white flex flex-col overflow-hidden">
        {/* Scrollable Content */}
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto overscroll-y-contain touch-pan-y flex-1 w-full pb-[calc(2rem+env(safe-area-inset-bottom))]"
        >
          {/* Top 16:9 Backdrop / Video Preview Area */}
          <div className="relative w-full aspect-[16/9] sm:h-[42dvh] sm:min-h-[260px] sm:max-h-[420px] bg-black overflow-hidden flex-shrink-0">
            <img
              src={
                upgradePosterUrl(movie.backdropUrl || movie.posterUrl, 1280) ||
                movie.backdropUrl ||
                movie.posterUrl
              }
              alt={movie.title}
              draggable={false}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111317] via-black/20 to-black/45" />

            {/* Top-Left Back Button */}
            <button
              type="button"
              onClick={onClose}
              className="fixed top-[max(0.85rem,env(safe-area-inset-top))] left-3 z-40 w-9 h-9 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center backdrop-blur-md border border-white/15 shadow-lg cursor-pointer transition-transform active:scale-90"
              aria-label="Back"
            >
              <ArrowLeft size={20} />
            </button>

            {/* Center Play Button */}
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                type="button"
                onClick={() =>
                  onWatchNow(
                    enrichMovieWithResolvedDuration(safeSeasonIndex, primaryEpIdx),
                    safeSeasonIndex,
                    primaryEpIdx,
                    selectedLanguage
                  )
                }
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/55 hover:bg-black/75 border-2 border-[#00d664] backdrop-blur-md flex items-center justify-center shadow-2xl transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                aria-label="Play"
              >
                <Play size={26} fill="white" className="ml-0.5 text-white" />
              </button>
            </div>

            {/* Trailer pill (only if real trailerUrl exists) */}
            {movie.trailerUrl && (
              <button
                type="button"
                onClick={handlePlayTrailer}
                className="absolute bottom-3 left-3.5 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/65 hover:bg-black/85 backdrop-blur-md border border-white/20 text-white text-xs font-semibold cursor-pointer active:scale-95"
              >
                <Clapperboard size={13} className="text-[#00d664]" />
                <span>Trailer</span>
              </button>
            )}
          </div>

          {/* Main Details Body */}
          <div className="w-full max-w-3xl mx-auto px-4 pt-3 pb-4 space-y-4">
            {/* Title + Info > Row */}
            <div>
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-snug line-clamp-2 flex-1">
                  {movie.title}
                </h1>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('more_details');
                    setTimeout(() => {
                      tabsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 40);
                  }}
                  className="flex items-center gap-0.5 text-xs sm:text-sm font-medium text-neutral-400 hover:text-white pt-1 flex-shrink-0 cursor-pointer"
                >
                  <span>Info</span>
                  <ChevronRight size={15} />
                </button>
              </div>

              {/* Clean Unboxed Inline Metadata Row (matching Screenshot 2) */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-[13px] text-neutral-300 mt-1.5">
                <span className="text-neutral-400 inline-flex items-center">
                  {hasRealSeasons ? <Tv size={13} /> : <Film size={13} />}
                </span>

                {hasRealRating && (
                  <>
                    <span className="text-neutral-600">|</span>
                    <span className="inline-flex items-center gap-1 font-bold text-amber-400">
                      <Star size={12} className="fill-amber-400 text-amber-400" />
                      <span>{numericRating.toFixed(1)}</span>
                    </span>
                  </>
                )}

                {realYear && (
                  <>
                    <span className="text-neutral-600">|</span>
                    <span>{realYear}</span>
                  </>
                )}

                {realCountry && (
                  <>
                    <span className="text-neutral-600">|</span>
                    <span>{realCountry}</span>
                  </>
                )}

                {realGenre && (
                  <>
                    <span className="text-neutral-600">|</span>
                    <span>{realGenre}</span>
                  </>
                )}

                {seasonsCountLabel && (
                  <>
                    <span className="text-neutral-600">|</span>
                    <span>{seasonsCountLabel}</span>
                  </>
                )}
              </div>
            </div>

            {/* Action Pills Row (NO Download button — Add to list, Share, Like, Rate, Report) */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5">
              <button
                type="button"
                onClick={handleToggleList}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors cursor-pointer active:scale-95 ${
                  localSavedInList
                    ? 'bg-[#00d664]/15 border-[#00d664]/60 text-[#00d664]'
                    : 'bg-[#1e222b] hover:bg-[#262b36] border-white/10 text-neutral-100'
                }`}
              >
                {localSavedInList ? <Check size={14} className="stroke-[2.5]" /> : <Plus size={14} />}
                <span>{localSavedInList ? 'In My List' : 'Add to list'}</span>
              </button>

              <button
                type="button"
                onClick={handleShare}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#1e222b] hover:bg-[#262b36] border border-white/10 text-neutral-100 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer active:scale-95"
              >
                <Share2 size={14} />
                <span>Share</span>
              </button>

              <button
                type="button"
                onClick={handleToggleLike}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors cursor-pointer active:scale-95 ${
                  isLiked
                    ? 'bg-rose-500/15 border-rose-500/50 text-rose-400'
                    : 'bg-[#1e222b] hover:bg-[#262b36] border-white/10 text-neutral-100'
                }`}
              >
                <Heart size={14} className={isLiked ? 'fill-rose-400 text-rose-400' : ''} />
                <span>{isLiked ? 'Liked' : 'Like'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowRatingDialog(true)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors cursor-pointer active:scale-95 ${
                  userRating !== null
                    ? 'bg-amber-400/15 border-amber-400/50 text-amber-400'
                    : 'bg-[#1e222b] hover:bg-[#262b36] border-white/10 text-neutral-100'
                }`}
              >
                <Star size={14} className={userRating !== null ? 'fill-amber-400 text-amber-400' : ''} />
                <span>{userRating !== null ? `${userRating}★` : 'Rate'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowReportDialog(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-[#1e222b] hover:bg-[#262b36] border border-white/10 text-neutral-100 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer active:scale-95"
              >
                <Flag size={14} />
                <span>Report</span>
              </button>
            </div>

            {/* SERIES SECTION ONLY: Resources -> Audio + Season Dropdown + Episode Numbers + Episode List */}
            {hasRealSeasons && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white tracking-tight">Resources</h2>
                  <span className="text-xs text-neutral-400">
                    {episodeList.length} Episode{episodeList.length === 1 ? '' : 's'}
                  </span>
                </div>

                {/* Audio & Season Selector Row */}
                <div className="flex items-center gap-2.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                  {/* Audio Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAudioDropdownOpen((prev) => !prev);
                        setIsSeasonDropdownOpen(false);
                      }}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#1e222b] hover:bg-[#262b36] border border-white/10 text-xs sm:text-sm font-medium text-white cursor-pointer"
                    >
                      <span>{selectedLanguage}</span>
                      <ChevronDown
                        size={15}
                        className={`text-neutral-400 transition-transform ${isAudioDropdownOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isAudioDropdownOpen && (
                      <div className="absolute left-0 top-full mt-1.5 w-44 max-h-60 overflow-y-auto bg-[#1b1f27] border border-white/15 rounded-xl shadow-2xl z-40 py-1">
                        {availableLanguages.map((lang) => (
                          <button
                            key={lang}
                            type="button"
                            onClick={() => {
                              setSelectedLanguage(lang);
                              setIsAudioDropdownOpen(false);
                              showToast(`Audio set to ${lang}`);
                            }}
                            className={`w-full px-3.5 py-2.5 text-left text-xs font-semibold flex items-center justify-between cursor-pointer ${
                              selectedLanguage === lang
                                ? 'bg-[#00d664]/15 text-[#00d664]'
                                : 'text-neutral-200 hover:bg-white/5'
                            }`}
                          >
                            <span>{lang}</span>
                            {selectedLanguage === lang && <Check size={14} />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Season Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setIsSeasonDropdownOpen((prev) => !prev);
                        setIsAudioDropdownOpen(false);
                      }}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#1e222b] hover:bg-[#262b36] border border-white/10 text-xs sm:text-sm font-medium text-white cursor-pointer"
                    >
                      <span>
                        Season {String(currentSeason?.seasonNumber || safeSeasonIndex + 1).padStart(2, '0')}
                      </span>
                      <ChevronDown
                        size={15}
                        className={`text-neutral-400 transition-transform ${isSeasonDropdownOpen ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {isSeasonDropdownOpen && (
                      <div className="absolute left-0 top-full mt-1.5 w-52 max-h-72 overflow-y-auto bg-[#1b1f27] border border-white/15 rounded-xl shadow-2xl z-40 py-1">
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
                                  ? 'bg-[#00d664]/15 text-[#00d664]'
                                  : 'text-neutral-200 hover:bg-white/5'
                              }`}
                            >
                              <span>Season {String(sNum).padStart(2, '0')}</span>
                              <span className="text-[11px] opacity-75">
                                {season.episodes?.length || 0} EP
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Episode Number Tiles Strip (01, 02, 03...) */}
                {episodeList.length > 0 ? (
                  <div className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1 touch-pan-x">
                    {episodeList.map((ep: any, eIdx: number) => {
                      const epNumLabel = String(ep.episodeNumber || eIdx + 1).padStart(2, '0');
                      const isSelected = selectedEpisodeIdx === eIdx;
                      return (
                        <button
                          key={eIdx}
                          type="button"
                          onClick={() => {
                            setSelectedEpisodeIdx(eIdx);
                            onWatchNow(
                              enrichMovieWithResolvedDuration(safeSeasonIndex, eIdx),
                              safeSeasonIndex,
                              eIdx,
                              selectedLanguage
                            );
                          }}
                          className={`relative flex-shrink-0 min-w-[48px] h-11 px-3 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-[#0c3b28] border-[#00d664]/60 text-[#00d664]'
                              : 'bg-[#1e222b] border-white/10 text-neutral-300 hover:bg-[#262b36]'
                          }`}
                        >
                          {epNumLabel}
                          {isEpisodeNewActive(ep) && (
                            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#00d664]" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-4 text-neutral-400 text-xs">
                    No episodes listed for this season yet.
                  </div>
                )}
              </div>
            )}

            {/* Tabs: For you & More Details */}
            <div ref={tabsSectionRef} className="pt-2">
              <div className="flex items-center gap-6 border-b border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => setActiveTab('for_you')}
                  className={`pb-2.5 text-sm font-bold tracking-tight transition-colors cursor-pointer relative ${
                    activeTab === 'for_you' ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>For you</span>
                  {activeTab === 'for_you' && (
                    <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white rounded-full" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('more_details')}
                  className={`pb-2.5 text-sm font-bold tracking-tight transition-colors cursor-pointer relative ${
                    activeTab === 'more_details' ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>More Details</span>
                  {activeTab === 'more_details' && (
                    <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white rounded-full" />
                  )}
                </button>
              </div>
            </div>

            {/* Tab 1: For you (3-column poster grid) */}
            {activeTab === 'for_you' && (
              <div className="pt-1">
                {forYouMovies.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 sm:gap-3">
                    {forYouMovies.map((item: any) => (
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
                        <div className="relative aspect-[2/3] bg-[#1a1d24] rounded-lg overflow-hidden border border-white/[0.06] shadow-sm">
                          <img
                            src={upgradePosterUrl(item.posterUrl, 400) || item.posterUrl}
                            alt={item.title}
                            loading="lazy"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                        <p className="text-xs text-neutral-200 font-medium truncate mt-1.5">
                          {item.title}
                        </p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-neutral-400 text-xs">
                    No related titles available right now.
                  </div>
                )}
              </div>
            )}

            {/* Tab 2: More Details */}
            {activeTab === 'more_details' && (
              <div className="pt-1 space-y-3 text-xs">
                {movie.description && (
                  <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed bg-[#191d24] border border-white/[0.06] rounded-xl p-3.5">
                    {movie.description}
                  </p>
                )}

                <div className="bg-[#191d24] rounded-xl p-4 border border-white/[0.06] divide-y divide-white/[0.06]">
                  <div className="py-2 flex justify-between gap-4">
                    <span className="text-neutral-400">Title</span>
                    <span className="text-white font-semibold text-right">{movie.originalTitle || movie.title}</span>
                  </div>
                  {realYear && (
                    <div className="py-2 flex justify-between gap-4">
                      <span className="text-neutral-400">Released</span>
                      <span className="text-white font-semibold text-right">{realYear}</span>
                    </div>
                  )}
                  {realCountry && (
                    <div className="py-2 flex justify-between gap-4">
                      <span className="text-neutral-400">Country</span>
                      <span className="text-white font-semibold text-right">{realCountry}</span>
                    </div>
                  )}
                  {(movie.displayCategory || movie.originalCategory) && (
                    <div className="py-2 flex justify-between gap-4">
                      <span className="text-neutral-400">Category</span>
                      <span className="text-white font-semibold text-right">
                        {movie.displayCategory || movie.originalCategory}
                      </span>
                    </div>
                  )}
                  {movie.genre && (
                    <div className="py-2 flex justify-between gap-4">
                      <span className="text-neutral-400">Genre</span>
                      <span className="text-white font-semibold text-right">{movie.genre}</span>
                    </div>
                  )}
                  {movie.cast && (
                    <div className="py-2 flex justify-between gap-4">
                      <span className="text-neutral-400">Cast</span>
                      <span className="text-white font-semibold text-right">{movie.cast}</span>
                    </div>
                  )}
                  {movie.director && (
                    <div className="py-2 flex justify-between gap-4">
                      <span className="text-neutral-400">Director</span>
                      <span className="text-white font-semibold text-right">{movie.director}</span>
                    </div>
                  )}
                  {movie.language && (
                    <div className="py-2 flex justify-between gap-4">
                      <span className="text-neutral-400">Audio</span>
                      <span className="text-white font-semibold text-right">{movie.language}</span>
                    </div>
                  )}
                  {formattedMovieDuration && !hasRealSeasons && (
                    <div className="py-2 flex justify-between gap-4">
                      <span className="text-neutral-400">Duration</span>
                      <span className="text-white font-semibold text-right">{formattedMovieDuration}</span>
                    </div>
                  )}
                  {hasRealSeasons && (
                    <div className="py-2 flex justify-between gap-4">
                      <span className="text-neutral-400">Seasons</span>
                      <span className="text-white font-semibold text-right">{seasonsList.length}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* RATING DIALOG POPUP (z-[110]) */}
      {showRatingDialog && (
        <div
          className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowRatingDialog(false)}
        >
          <div
            className="bg-[#191d24] border border-white/15 p-6 rounded-2xl max-w-xs w-full text-center space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-bold text-white">Rate "{movie.title}"</h3>
            <p className="text-xs text-neutral-400">Select your rating</p>
            <div className="flex items-center justify-center gap-2 pt-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => handleRatingSelect(star)}
                  className="p-1 text-neutral-600 hover:text-amber-400 transition-colors cursor-pointer"
                >
                  <Star
                    size={28}
                    className={
                      userRating && star <= userRating
                        ? 'text-amber-400 fill-amber-400'
                        : 'text-neutral-600'
                    }
                  />
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowRatingDialog(false)}
              className="w-full py-2 rounded-lg bg-[#252a34] hover:bg-[#2f3542] text-xs font-bold text-neutral-300 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* REPORT ISSUE DIALOG POPUP (z-[110]) */}
      {showReportDialog && (
        <div
          className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowReportDialog(false)}
        >
          <div
            className="bg-[#191d24] border border-white/15 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400" />
                <h3 className="text-base font-bold text-white">Report Issue</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowReportDialog(false)}
                className="text-neutral-400 hover:text-white cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-neutral-400">
              Report a problem with <span className="text-white font-semibold">{movie.title}</span>.
            </p>

            <form onSubmit={handleReportSubmit} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-neutral-300 block mb-1">Issue Type</label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full bg-[#111317] border border-white/15 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-[#00d664]"
                >
                  <option value="Video is not playing or loading">Video is not playing or loading</option>
                  <option value="Audio is missing or out of sync">Audio is missing or out of sync</option>
                  <option value="Buffering or slow streaming speed">Buffering or slow streaming speed</option>
                  <option value="Wrong movie or incorrect episode">Wrong movie or incorrect episode</option>
                  <option value="Subtitle or language issue">Subtitle or language issue</option>
                  <option value="Other technical problem">Other technical problem</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-bold text-neutral-300 block mb-1">
                  Additional Details (Optional)
                </label>
                <textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Describe the issue..."
                  rows={3}
                  className="w-full bg-[#111317] border border-white/15 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-[#00d664] resize-none placeholder-neutral-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowReportDialog(false)}
                  className="flex-1 py-2.5 rounded-lg bg-[#252a34] hover:bg-[#2f3542] text-xs font-bold text-neutral-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reportSubmitting}
                  className="flex-1 py-2.5 rounded-lg bg-[#00d664] hover:bg-[#00bf59] disabled:opacity-50 text-xs font-black text-black cursor-pointer"
                >
                  {reportSubmitting ? 'Submitting...' : 'Submit Report'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}
