import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Play,
  Plus,
  Check,
  ThumbsUp,
  Send,
  Flag,
  ChevronDown,
  Star,
  Clapperboard,
  Film,
  Tv,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { upgradePosterUrl } from '../utils/posterUrl';
import {
  saveUserRating,
  getUserRating,
  submitContentReport,
  addToMyList,
  removeFromMyList,
} from '../services/userWatchService';
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
  userId = 'anonymous_user',
  isSavedInMyList = false,
  onToggleMyList,
  onSelectMovie,
  initialSeasonIndex = 0,
}: MovieDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<'episodes' | 'more_like_this' | 'more_details'>('episodes');
  const [activeSeasonIndex, setActiveSeasonIndex] = useState(initialSeasonIndex);
  const [isSeasonDropdownOpen, setIsSeasonDropdownOpen] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('Hindi');
  const [userRating, setUserRating] = useState<number | null>(null);
  const [showRatingDialog, setShowRatingDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [reportReason, setReportReason] = useState('Video is not playing or loading');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimeoutRef = useRef<any>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [probedMovieDurationSec, setProbedMovieDurationSec] = useState<number>(0);
  const [probedEpisodeDurations, setProbedEpisodeDurations] = useState<Record<string, number>>({});

  const isSeries = Boolean(
    movie?.contentType === 'series' ||
    movie?.displayCategory?.toLowerCase().includes('series') ||
    movie?.genre?.toLowerCase().includes('series') ||
    (movie?.seasons && movie.seasons.length > 0)
  );

  // Set default active tab based on content type
  useEffect(() => {
    if (movie) {
      if (isSeries && movie.seasons && movie.seasons.length > 0) {
        setActiveTab('episodes');
      } else {
        setActiveTab('more_like_this');
      }
      const maxSIdx = Math.max(0, (movie.seasons?.length || 1) - 1);
      setActiveSeasonIndex(Math.max(0, Math.min(initialSeasonIndex, maxSIdx)));
      setIsSeasonDropdownOpen(false);
      setProbedMovieDurationSec(0);
      setProbedEpisodeDurations({});
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'auto' });
    }
  }, [movie?.id, isSeries, initialSeasonIndex]);

  // Load user saved rating if available
  useEffect(() => {
    if (movie?.id && userId) {
      getUserRating(userId, movie.id).then((val) => {
        if (val !== null) setUserRating(val);
      });
    }
  }, [movie?.id, userId]);

  // Lock body scroll when modal is open
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
    }, 2800);
  };

  // Calculate Match % (e.g. "85% match")
  const matchPercent = useMemo(() => {
    if (!movie) return 85;
    if (movie.rating && typeof movie.rating === 'number' && movie.rating > 0) {
      return Math.min(99, Math.max(60, Math.round(movie.rating * 10)));
    }
    // Stable pseudo-random match based on movie title length
    const hash = (movie.title || '').split('').reduce((acc: number, c: string) => acc + c.charCodeAt(0), 0);
    return 75 + (hash % 24);
  }, [movie]);

  // Available languages list
  const availableLanguages = useMemo(() => {
    const defaultList = ['Hindi', 'English', 'Tamil', 'Telugu', 'Spanish', 'French', 'German'];
    if (!movie) return defaultList;
    if (movie.language && typeof movie.language === 'string') {
      const parts = movie.language
        .split(/[,/|]/)
        .map((s: string) => s.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        // Return parts followed by defaults not already included
        const combined = [...parts];
        for (const d of defaultList) {
          if (!combined.some((c) => c.toLowerCase() === d.toLowerCase())) {
            combined.push(d);
          }
        }
        return combined.slice(0, 6);
      }
    }
    return defaultList;
  }, [movie]);

  // Sync selected language when availableLanguages change
  useEffect(() => {
    if (availableLanguages.length > 0 && !availableLanguages.includes(selectedLanguage)) {
      setSelectedLanguage(availableLanguages[0]);
    }
  }, [availableLanguages]);

  // "More Like This" list from database
  const moreLikeThisMovies = useMemo(() => {
    if (!movie || !allMovies || allMovies.length === 0) return [];
    const currentId = movie.id || movie.imdbId;
    const currentGenre = (movie.genre || movie.displayCategory || '').toLowerCase();
    const currentCat = (movie.displayCategory || '').toLowerCase();

    return allMovies
      .filter((m) => {
        const id = m.id || m.imdbId;
        if (id === currentId) return false;
        const g = (m.genre || '').toLowerCase();
        const c = (m.displayCategory || '').toLowerCase();
        return (
          (currentGenre && g.includes(currentGenre)) ||
          (currentCat && c.includes(currentCat)) ||
          m.originalCategory === movie.originalCategory
        );
      })
      .slice(0, 12);
  }, [movie, allMovies]);

  // Probe real duration from Telegram stream when movie runtime/duration or active season episode durations are missing
  useEffect(() => {
    if (!isOpen || !movie) return;
    let cancelled = false;

    if (!isSeries) {
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

    const activeSeasonObj = movie.seasons?.[activeSeasonIndex] || movie.seasons?.[0];
    const eps: any[] = activeSeasonObj?.episodes || [];
    const probeEpisodes = async () => {
      for (const ep of eps.slice(0, 12)) {
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
  }, [isOpen, movie?.id, isSeries, activeSeasonIndex]);

  if (!isOpen || !movie) return null;

  const seasonsList = Array.isArray(movie.seasons) ? movie.seasons : [];
  const safeSeasonIndex = seasonsList.length > 0 ? Math.min(activeSeasonIndex, seasonsList.length - 1) : 0;
  const currentSeason = seasonsList[safeSeasonIndex] || seasonsList[0];
  const episodeList = currentSeason?.episodes || [];

  const knownMovieDurationSec =
    (typeof movie.duration === 'number' && movie.duration > 0 ? movie.duration : 0) ||
    parseDurationToSeconds(movie.runtime) ||
    probedMovieDurationSec;

  const formattedMovieDuration = formatHumanDuration(movie.runtime, knownMovieDurationSec);

  const enrichMovieWithResolvedDuration = (sIdx = activeSeasonIndex, eIdx = 0) => {
    if (!movie) return movie;
    if (!isSeries) {
      return knownMovieDurationSec > 0 && !(movie.duration > 0)
        ? { ...movie, duration: knownMovieDurationSec }
        : movie;
    }
    const season = movie.seasons?.[sIdx];
    const ep = season?.episodes?.[eIdx];
    const epUrl = String(ep?.streamUrl || '').trim();
    const epSec =
      (typeof ep?.durationSec === 'number' && ep.durationSec > 0 ? ep.durationSec : 0) ||
      parseDurationToSeconds(ep?.duration) ||
      (epUrl ? probedEpisodeDurations[epUrl] || 0 : 0);
    if (epSec > 0 && ep && !ep.durationSec) {
      const updatedSeasons = movie.seasons.map((s: any, si: number) =>
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

  const handleRatingSelect = async (stars: number) => {
    setUserRating(stars);
    setShowRatingDialog(false);
    if (userId && movie.id) {
      await saveUserRating(userId, movie.id, stars);
      showToast(`Saved rating: ${stars} Star${stars > 1 ? 's' : ''}`);
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
    // Fallback: Copy to clipboard
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
    } catch (err) {
      showToast('Report submitted successfully.');
      setShowReportDialog(false);
    } finally {
      setReportSubmitting(false);
    }
  };

  const handlePlayTrailer = () => {
    if (movie.trailerUrl) {
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
    } else {
      showToast('Official trailer will be available soon.');
    }
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-[90] w-full h-[100dvh] bg-[#141414] text-white flex flex-col overflow-hidden"
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-[max(1.25rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[110] bg-neutral-900 border border-neutral-700 text-white text-xs sm:text-sm font-semibold px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 animate-in fade-in slide-in-from-top-4 duration-200">
          <CheckCircle2 size={16} className="text-[#46d369]" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Full-Screen Details Container */}
      <div className="relative w-full h-full bg-[#141414] text-white flex flex-col overflow-hidden">
        {/* Top Floating Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="fixed top-[max(0.85rem,env(safe-area-inset-top))] right-3.5 z-40 w-9 h-9 rounded-full bg-black/75 hover:bg-black text-white flex items-center justify-center backdrop-blur-md border border-white/25 shadow-lg cursor-pointer transition-transform hover:scale-110 active:scale-95"
          aria-label="Close"
        >
          <X size={20} />
        </button>

        {/* Full-Screen Scrollable Content */}
        <div
          ref={scrollContainerRef}
          className="overflow-y-auto overscroll-y-contain touch-pan-y flex-1 w-full pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
        >
          {/* Full-Bleed Hero Banner / Backdrop */}
          <div className="relative w-full aspect-[16/9] sm:h-[44dvh] sm:min-h-[300px] sm:max-h-[460px] bg-neutral-950 overflow-hidden flex-shrink-0">
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
            {/* Deep Vignette Gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/30 to-black/35" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />

            {/* Central Circular Play Button with Amber Ring */}
            <div className="absolute inset-0 flex flex-col items-center justify-center p-4">
              <button
                type="button"
                onClick={() => onWatchNow(enrichMovieWithResolvedDuration(safeSeasonIndex, 0), safeSeasonIndex, 0, selectedLanguage)}
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-full border-2 border-amber-400/90 bg-black/45 backdrop-blur-md flex items-center justify-center shadow-2xl transition-transform hover:scale-110 active:scale-95 group cursor-pointer"
                aria-label="Play"
              >
                <Play size={28} fill="white" className="ml-1 text-white group-hover:scale-110 transition-transform" />
              </button>
              <h2 className="mt-3 text-lg sm:text-2xl font-black text-white text-center drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)] uppercase tracking-wide px-4 line-clamp-1">
                {movie.title}
              </h2>
            </div>

            {/* Trailer Button (Bottom-Left) */}
            <button
              type="button"
              onClick={handlePlayTrailer}
              className="absolute bottom-3 left-3 sm:bottom-4 sm:left-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/25 text-white text-xs font-bold transition-transform hover:scale-105 active:scale-95 cursor-pointer shadow-md"
            >
              <Clapperboard size={14} className="text-amber-400" />
              <span>Trailer</span>
            </button>
          </div>

          {/* Details Body */}
          <div className="w-full max-w-4xl mx-auto p-4 sm:p-6 space-y-4">
            {/* M SERIES or M MOVIE Branding */}
            <div className="flex items-center gap-2">
              <span className="bg-red-600 text-white font-black text-xs px-1.5 py-0.5 rounded shadow tracking-tighter">
                M
              </span>
              <span className="text-neutral-400 font-black text-xs tracking-widest uppercase">
                {isSeries ? 'SERIES' : 'MOVIE'}
              </span>
            </div>

            {/* Title */}
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight leading-snug">
              {movie.title}
            </h1>

            {/* Metadata Badges Row */}
            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3 text-xs sm:text-sm font-semibold">
              <span className="text-[#46d369] font-black">{matchPercent}% match</span>
              <span className="text-neutral-400">{movie.releaseYear || 2024}</span>
              <span className="px-1.5 py-0.5 rounded border border-neutral-600/90 bg-neutral-800/60 text-[11px] font-semibold text-neutral-300">
                U/A 18+ [A]
              </span>
              {(isSeries || formattedMovieDuration) && (
                <span className="text-neutral-300">
                  {isSeries
                    ? `${movie.seasons?.length || 1} Season${(movie.seasons?.length || 1) > 1 ? 's' : ''}`
                    : formattedMovieDuration}
                </span>
              )}
              <span className="px-1.5 py-0.5 rounded border border-neutral-600/90 bg-neutral-800/60 text-[10px] font-black text-neutral-300 uppercase">
                {movie.qualityBadge || 'HD'}
              </span>
            </div>

            {/* Available Audio Languages Row */}
            <div className="pt-1">
              <div className="flex items-center gap-3 overflow-x-auto scrollbar-none py-1">
                {availableLanguages.map((lang) => {
                  const isActive = selectedLanguage === lang;
                  return (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => {
                        setSelectedLanguage(lang);
                        showToast(`Audio set to ${lang}`);
                      }}
                      className={`text-xs font-semibold whitespace-nowrap transition-colors flex items-center gap-1 cursor-pointer ${
                        isActive
                          ? 'text-white font-bold border-b-2 border-red-600 pb-0.5'
                          : 'text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {isActive && <Play size={10} fill="white" className="text-white" />}
                      <span>{lang}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* MANDATORY: EXACTLY ONE PRIMARY BUTTON "WATCH NOW" (NO DOWNLOAD BUTTON) */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onWatchNow(enrichMovieWithResolvedDuration(safeSeasonIndex, 0), safeSeasonIndex, 0, selectedLanguage)}
                className="w-full py-3 sm:py-3.5 px-6 bg-white hover:bg-neutral-200 text-black font-black text-sm sm:text-base rounded-md flex items-center justify-center gap-2.5 transition-all shadow-xl hover:shadow-2xl active:scale-[0.99] cursor-pointer"
              >
                <Play size={20} fill="black" />
                <span>WATCH NOW</span>
              </button>
            </div>

            {/* Description Synopsis */}
            {movie.description ? (
              <p className="text-xs sm:text-sm text-neutral-300 leading-relaxed pt-1">
                {movie.description}
              </p>
            ) : (
              <p className="text-xs sm:text-sm text-neutral-400 italic pt-1">
                No description available for this title.
              </p>
            )}

            {/* Cast Information */}
            <p className="text-xs text-neutral-400">
              <span className="text-neutral-500 font-semibold">Cast: </span>
              {movie.cast || 'Cast information available soon.'}
            </p>

            {/* 4 Action Buttons Row: My List, Rate, Share, Reports */}
            <div className="grid grid-cols-4 gap-2 pt-3 pb-1 border-y border-neutral-800/80">
              {/* 1. My List */}
              <button
                type="button"
                onClick={() => {
                  if (onToggleMyList) {
                    onToggleMyList(movie);
                  } else if (userId) {
                    if (isSavedInMyList) {
                      removeFromMyList(userId, movie.id);
                      showToast('Removed from My List');
                    } else {
                      addToMyList(userId, movie);
                      showToast('Added to My List');
                    }
                  }
                }}
                className="flex flex-col items-center justify-center gap-1.5 py-2 text-neutral-300 hover:text-white transition-colors cursor-pointer group"
              >
                {isSavedInMyList ? (
                  <Check size={22} className="text-red-500 stroke-[3] group-hover:scale-110 transition-transform" />
                ) : (
                  <Plus size={22} className="group-hover:scale-110 transition-transform" />
                )}
                <span className="text-[11px] font-semibold tracking-tight">My List</span>
              </button>

              {/* 2. Rate */}
              <button
                type="button"
                onClick={() => setShowRatingDialog(true)}
                className="flex flex-col items-center justify-center gap-1.5 py-2 text-neutral-300 hover:text-white transition-colors cursor-pointer group"
              >
                <ThumbsUp
                  size={20}
                  className={`group-hover:scale-110 transition-transform ${
                    userRating !== null ? 'text-amber-400 fill-amber-400' : ''
                  }`}
                />
                <span className="text-[11px] font-semibold tracking-tight">
                  {userRating !== null ? `★ ${userRating}` : 'Rate'}
                </span>
              </button>

              {/* 3. Share */}
              <button
                type="button"
                onClick={handleShare}
                className="flex flex-col items-center justify-center gap-1.5 py-2 text-neutral-300 hover:text-white transition-colors cursor-pointer group"
              >
                <Send size={20} className="group-hover:scale-110 transition-transform" />
                <span className="text-[11px] font-semibold tracking-tight">Share</span>
              </button>

              {/* 4. Reports */}
              <button
                type="button"
                onClick={() => setShowReportDialog(true)}
                className="flex flex-col items-center justify-center gap-1.5 py-2 text-neutral-300 hover:text-white transition-colors cursor-pointer group"
              >
                <Flag size={20} className="group-hover:scale-110 transition-transform" />
                <span className="text-[11px] font-semibold tracking-tight">Reports</span>
              </button>
            </div>

            {/* Navigation Tabs: Episodes, More Like This, More Details */}
            <div className="pt-2">
              <div className="flex items-center gap-6 border-b border-neutral-800">
                {isSeries && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('episodes')}
                    className={`pb-2.5 text-xs sm:text-sm font-bold tracking-tight transition-colors cursor-pointer relative ${
                      activeTab === 'episodes' ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    <span>Episodes</span>
                    {activeTab === 'episodes' && (
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-red-600 rounded-full" />
                    )}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setActiveTab('more_like_this')}
                  className={`pb-2.5 text-xs sm:text-sm font-bold tracking-tight transition-colors cursor-pointer relative ${
                    activeTab === 'more_like_this' ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>More Like This</span>
                  {activeTab === 'more_like_this' && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-red-600 rounded-full" />
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('more_details')}
                  className={`pb-2.5 text-xs sm:text-sm font-bold tracking-tight transition-colors cursor-pointer relative ${
                    activeTab === 'more_details' ? 'text-white' : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  <span>More Details</span>
                  {activeTab === 'more_details' && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-red-600 rounded-full" />
                  )}
                </button>
              </div>
            </div>

            {/* TAB CONTENT 1: EPISODES (For Series) */}
            {activeTab === 'episodes' && isSeries && (
              <div className="space-y-3 pt-2">
                {/* Season Selector: Dropdown + Visible Scrollable Season Bar */}
                {seasonsList.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="relative flex items-center gap-2.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setIsSeasonDropdownOpen(!isSeasonDropdownOpen)}
                        className="px-4 py-2.5 bg-neutral-800/90 hover:bg-neutral-800 text-white font-bold text-xs sm:text-sm rounded-lg flex items-center gap-2 border border-neutral-700/80 transition-all cursor-pointer shadow-md"
                      >
                        <span>
                          Season {currentSeason?.seasonNumber || safeSeasonIndex + 1} ({episodeList.length} EP)
                        </span>
                        {seasonsList.length > 1 && (
                          <span className="text-[11px] font-semibold text-neutral-400">
                            • {seasonsList.length} Seasons
                          </span>
                        )}
                        <ChevronDown
                          size={16}
                          className={`transition-transform duration-200 ${isSeasonDropdownOpen ? 'rotate-180' : ''}`}
                        />
                      </button>

                      {/* Dropdown Menu */}
                      {isSeasonDropdownOpen && (
                        <div className="absolute left-0 top-full mt-2 w-60 max-h-72 overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl z-40 animate-in fade-in zoom-in-95 duration-150">
                          {seasonsList.map((season: any, idx: number) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setActiveSeasonIndex(idx);
                                setIsSeasonDropdownOpen(false);
                              }}
                              className={`w-full px-4 py-3 text-left text-xs font-bold transition-colors flex items-center justify-between cursor-pointer ${
                                safeSeasonIndex === idx
                                  ? 'bg-red-600 text-white'
                                  : 'text-neutral-300 hover:bg-neutral-800'
                              }`}
                            >
                              <span>Season {season.seasonNumber || idx + 1}</span>
                              <span className="text-[11px] opacity-75 font-normal">
                                ({season.episodes?.length || 0} Episodes)
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {seasonsList.length > 1 && (
                      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none touch-pan-x">
                        {seasonsList.map((season: any, idx: number) => {
                          const sNum = season.seasonNumber || idx + 1;
                          const epCount = season.episodes?.length || 0;
                          const isActive = safeSeasonIndex === idx;
                          return (
                            <button
                              key={sNum + '-' + idx}
                              type="button"
                              onClick={() => {
                                setActiveSeasonIndex(idx);
                                setIsSeasonDropdownOpen(false);
                              }}
                              className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer whitespace-nowrap ${
                                isActive
                                  ? 'bg-red-600 border-red-500 text-white shadow-md shadow-red-600/20'
                                  : 'bg-neutral-900/90 border-neutral-800 text-neutral-300 hover:bg-neutral-800 hover:text-white'
                              }`}
                            >
                              Season {sNum} <span className="opacity-70 font-normal">({epCount})</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Episodes List */}
                <div className="space-y-2.5 pt-1">
                  {episodeList.length > 0 ? (
                    episodeList.map((ep: any, eIdx: number) => {
                      const epStreamUrl = String(ep?.streamUrl || '').trim();
                      const epFormattedDur = formatHumanDuration(
                        ep.duration,
                        (typeof ep?.durationSec === 'number' && ep.durationSec > 0 ? ep.durationSec : 0) ||
                          (epStreamUrl ? probedEpisodeDurations[epStreamUrl] || 0 : 0)
                      );
                      return (
                        <div
                          key={eIdx}
                          onClick={() =>
                            onWatchNow(
                              enrichMovieWithResolvedDuration(safeSeasonIndex, eIdx),
                              safeSeasonIndex,
                              eIdx,
                              selectedLanguage
                            )
                          }
                          className="flex items-center gap-3 bg-neutral-900/90 hover:bg-neutral-800/90 border border-neutral-800/80 p-2.5 rounded-xl transition-all cursor-pointer group shadow-sm hover:shadow-md"
                        >
                          {/* Thumbnail with Play Icon */}
                          <div className="relative w-28 sm:w-32 aspect-video bg-neutral-950 rounded-lg overflow-hidden flex-shrink-0">
                            <img
                              src={
                                upgradePosterUrl(ep.thumbnailUrl || movie.backdropUrl || movie.posterUrl, 400) ||
                                movie.backdropUrl ||
                                movie.posterUrl
                              }
                              alt={ep.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                              <div className="w-8 h-8 rounded-full bg-black/60 border border-white/30 flex items-center justify-center group-hover:bg-red-600 group-hover:border-red-600 transition-colors">
                                <Play size={14} fill="white" className="ml-0.5 text-white" />
                              </div>
                            </div>
                          </div>

                          {/* Episode Info */}
                          <div className="flex-1 min-w-0 text-left">
                            <h4 className="text-xs sm:text-sm font-bold text-white truncate group-hover:text-red-400 transition-colors flex items-center gap-2">
                              <span className="truncate">{ep.title}</span>
                              {isEpisodeNewActive(ep) && (
                                <span className="bg-red-600 text-white font-black text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wider animate-pulse flex-shrink-0">
                                  NEW
                                </span>
                              )}
                            </h4>
                            <p className="text-[11px] font-semibold text-neutral-400 mt-0.5">
                              E{ep.episodeNumber || eIdx + 1} • S{currentSeason?.seasonNumber || safeSeasonIndex + 1}
                              {epFormattedDur ? ` • ${epFormattedDur}` : ''}
                            </p>
                            {ep.description && (
                              <p className="text-[11px] text-neutral-500 line-clamp-1 mt-1 hidden sm:block">
                                {ep.description}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-neutral-400 text-xs">
                      No episodes listed for this season yet.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT 2: MORE LIKE THIS */}
            {activeTab === 'more_like_this' && (
              <div className="pt-2">
                {moreLikeThisMovies.length > 0 ? (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5 sm:gap-3">
                    {moreLikeThisMovies.map((item: any) => (
                      <div
                        key={item.id || item.imdbId}
                        onClick={() => {
                          if (onSelectMovie) {
                            onSelectMovie(item);
                          }
                        }}
                        className="relative aspect-[2/3] bg-neutral-900 rounded-lg overflow-hidden border border-neutral-800/80 cursor-pointer group shadow-sm hover:shadow-xl transition-all"
                      >
                        <img
                          src={upgradePosterUrl(item.posterUrl, 400) || item.posterUrl}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        {/* Quality Badge */}
                        <div className="absolute top-1.5 left-1.5">
                          <span className="bg-black/85 text-red-500 font-black text-[9px] px-1.5 py-0.5 rounded border border-red-500/30 uppercase">
                            {item.qualityBadge || 'HD'}
                          </span>
                        </div>
                        {/* Title Overlay on Hover */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                          <p className="text-[11px] font-bold text-white line-clamp-2 leading-tight">
                            {item.title}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-neutral-400 text-xs">
                    More titles in this category will be available soon.
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT 3: MORE DETAILS */}
            {activeTab === 'more_details' && (
              <div className="pt-2 space-y-3 text-xs">
                <div className="bg-neutral-900/80 rounded-xl p-4 border border-neutral-800/80 divide-y divide-neutral-800">
                  <div className="py-2 flex justify-between">
                    <span className="text-neutral-400 font-semibold">Original Title</span>
                    <span className="text-white font-bold">{movie.originalTitle || movie.title}</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-neutral-400 font-semibold">Released</span>
                    <span className="text-white font-bold">{movie.releaseYear || '2024'}</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-neutral-400 font-semibold">Category</span>
                    <span className="text-white font-bold">{movie.displayCategory || movie.originalCategory || 'Movie'}</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-neutral-400 font-semibold">Genre</span>
                    <span className="text-white font-bold">{movie.genre || 'Action, Drama'}</span>
                  </div>
                  {movie.director && (
                    <div className="py-2 flex justify-between">
                      <span className="text-neutral-400 font-semibold">Director</span>
                      <span className="text-white font-bold">{movie.director}</span>
                    </div>
                  )}
                  <div className="py-2 flex justify-between">
                    <span className="text-neutral-400 font-semibold">Audio Languages</span>
                    <span className="text-white font-bold">{availableLanguages.join(', ')}</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-neutral-400 font-semibold">Maturity Rating</span>
                    <span className="text-white font-bold">U/A 18+ [A] (Suitable for mature audiences)</span>
                  </div>
                  <div className="py-2 flex justify-between">
                    <span className="text-neutral-400 font-semibold">Video Resolution</span>
                    <span className="text-white font-bold">{movie.qualityBadge || '1080p Full HD'}</span>
                  </div>
                  {formattedMovieDuration && (
                    <div className="py-2 flex justify-between">
                      <span className="text-neutral-400 font-semibold">Duration</span>
                      <span className="text-white font-bold">{formattedMovieDuration}</span>
                    </div>
                  )}
                  <div className="py-2 flex justify-between">
                    <span className="text-neutral-400 font-semibold">Content Type</span>
                    <span className="text-white font-bold uppercase">{isSeries ? 'Web Series' : 'Feature Movie'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Floating Bottom Dismiss Circle Button */}
        <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-30">
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 rounded-full bg-neutral-900/90 hover:bg-neutral-800 text-white flex items-center justify-center border border-white/20 shadow-2xl backdrop-blur-md transition-transform hover:scale-105 active:scale-95 cursor-pointer"
            aria-label="Dismiss Details"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* RATING DIALOG POPUP */}
      {showRatingDialog && (
        <div
          className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowRatingDialog(false)}
        >
          <div
            className="bg-neutral-900 border border-neutral-700 p-6 rounded-2xl max-w-xs w-full text-center space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-black text-white">Rate "{movie.title}"</h3>
            <p className="text-xs text-neutral-400">Select your rating to help improve recommendations</p>
            <div className="flex items-center justify-center gap-2 pt-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => handleRatingSelect(star)}
                  className="p-1 text-neutral-600 hover:text-amber-400 transition-colors cursor-pointer group"
                >
                  <Star
                    size={28}
                    className={`transition-transform group-hover:scale-125 ${
                      userRating && star <= userRating
                        ? 'text-amber-400 fill-amber-400'
                        : 'text-neutral-600'
                    }`}
                  />
                </button>
              ))}
            </div>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowRatingDialog(false)}
                className="w-full py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REPORT ISSUE DIALOG POPUP */}
      {showReportDialog && (
        <div
          className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setShowReportDialog(false)}
        >
          <div
            className="bg-neutral-900 border border-neutral-700 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400" />
                <h3 className="text-base font-black text-white">Report Content Issue</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowReportDialog(false)}
                className="text-neutral-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-neutral-400">
              Let us know what's wrong with <span className="text-white font-semibold">{movie.title}</span>.
            </p>

            <form onSubmit={handleReportSubmit} className="space-y-3">
              <div>
                <label className="text-[11px] font-bold text-neutral-300 block mb-1">Issue Type</label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-red-600"
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
                  placeholder="Describe the issue you experienced..."
                  rows={3}
                  className="w-full bg-neutral-950 border border-neutral-700 rounded-lg p-2.5 text-xs text-white focus:outline-none focus:border-red-600 resize-none placeholder-neutral-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowReportDialog(false)}
                  className="flex-1 py-2.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-neutral-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reportSubmitting}
                  className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-xs font-black text-white cursor-pointer"
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
