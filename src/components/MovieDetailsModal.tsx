import React, { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import Hls from 'hls.js';
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
  Download,
  Loader2,
  Maximize,
  Volume2,
  VolumeX,
} from 'lucide-react';
import DownloadOptionsModal from './DownloadOptionsModal';
import { buildApiUrl } from '../utils/apiConfig';
import { useDownloads } from '../hooks/useDownloads';
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
import { isEpisodeNewActive, getEpisodeDisplayLabel } from '../services/movieStorage';
import { recordMovieViewStart } from '../services/movieViewsService';

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
  const [activeTab, setActiveTab] = useState<'for_you' | 'more_details'>('for_you');
  const [activeSeasonIndex, setActiveSeasonIndex] = useState(initialSeasonIndex);
  const [selectedEpisodeIdx, setSelectedEpisodeIdx] = useState<number>(initialEpisodeIndex);
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
  const episodeStripRef = useRef<HTMLDivElement | null>(null);
  const [probedMovieDurationSec, setProbedMovieDurationSec] = useState<number>(0);
  const [probedEpisodeDurations, setProbedEpisodeDurations] = useState<Record<string, number>>({});
  const [showDownloadModal, setShowDownloadModal] = useState(false);

  const { activeDownloads, downloads, startDownload, getDownloadMatch } = useDownloads();

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

  // Keep selected episode tile visible horizontally inside the strip
  useEffect(() => {
    if (!isOpen || !hasRealSeasons) return;
    const rafId = requestAnimationFrame(() => {
      const strip = episodeStripRef.current;
      if (!strip) return;
      const btn = strip.children[selectedEpisodeIdx] as HTMLElement | undefined;
      if (!btn) return;
      const targetLeft = Math.max(0, btn.offsetLeft - strip.clientWidth / 2 + btn.clientWidth / 2);
      strip.scrollLeft = targetLeft;
    });
    return () => cancelAnimationFrame(rafId);
  }, [isOpen, movie?.id, activeSeasonIndex, selectedEpisodeIdx, hasRealSeasons]);

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

  const currentMovieId = movie.id || movie.imdbId;
  const currentSeasonNumber = hasRealSeasons
    ? Number(currentSeason?.seasonNumber || safeSeasonIndex + 1)
    : undefined;
  const currentEpisodeObj = hasRealSeasons ? episodeList[primaryEpIdx] : null;
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
    ? (rawStreamUrl.startsWith('http') && !rawStreamUrl.includes('/api/stream')
        ? buildApiUrl(`/api/stream?url=${encodeURIComponent(rawStreamUrl)}&ext=.mp4`)
        : rawStreamUrl)
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

  const inlineEpisodeResumeKey = hasRealSeasons && currentEpisodeObj
    ? `${movie.title} - S${String(currentSeason?.seasonNumber || safeSeasonIndex + 1).padStart(2, '0')}E${getEpisodeDisplayLabel(currentEpisodeObj, primaryEpIdx, true)}: ${currentEpisodeObj.title}`
    : String(movie.title || '').replace(/\s*\(Official Trailer\)/i, '');

  const isIosRuntime = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    return (
      /iPhone|iPad|iPod/i.test(ua) ||
      ((navigator.platform === 'MacIntel' || /Macintosh/i.test(ua)) && (navigator.maxTouchPoints || 0) > 1)
    );
  }, []);

  const inlineVideoRef = useRef<HTMLVideoElement | null>(null);
  const [inlineLoaded, setInlineLoaded] = useState(false);
  const [inlineMuted, setInlineMuted] = useState(() => isIosRuntime);
  const [inlineNeedsTapToPlay, setInlineNeedsTapToPlay] = useState(false);
  const [inlineRetryNonce, setInlineRetryNonce] = useState(0);
  const [inlineTimedOut, setInlineTimedOut] = useState(false);
  const mutedByAutoplayRef = useRef(isIosRuntime);
  const inlineLastTapRef = useRef<{ time: number; side: 'left' | 'right' | null }>({ time: 0, side: null });
  const inlineSeekBurstRef = useRef<{ time: number; side: 'left' | 'right' | null; total: number }>({ time: 0, side: null, total: 0 });
  const inlineSingleTapTimerRef = useRef<any>(null);
  const [inlineSeekFeedback, setInlineSeekFeedback] = useState<{ side: 'left' | 'right'; label: string } | null>(null);
  const inlineSeekFeedbackTimerRef = useRef<any>(null);

  const handleInlineSkip = (seconds: number, burstDelta?: number) => {
    if (!inlineVideoRef.current) return;
    const current = inlineVideoRef.current.currentTime || 0;
    const dur = (inlineVideoRef.current.duration && isFinite(inlineVideoRef.current.duration))
      ? inlineVideoRef.current.duration
      : 999999;
    const nextTime = Math.max(0, Math.min(dur, current + seconds));
    inlineVideoRef.current.currentTime = nextTime;
    if (inlineEpisodeResumeKey && nextTime > 2) {
      try {
        localStorage.setItem(`resume_pos_${inlineEpisodeResumeKey}`, String(nextTime));
      } catch {}
    }
    const isFwd = seconds > 0;
    const displayAbs = Math.abs(burstDelta ?? seconds);
    setInlineSeekFeedback({ side: isFwd ? 'right' : 'left', label: isFwd ? `+${displayAbs}s` : `-${displayAbs}s` });
    if (inlineSeekFeedbackTimerRef.current) clearTimeout(inlineSeekFeedbackTimerRef.current);
    inlineSeekFeedbackTimerRef.current = setTimeout(() => setInlineSeekFeedback(null), 700);
  };

  useEffect(() => {
    const videoEl = inlineVideoRef.current;
    if (!videoEl || !primaryDownloadUrl) return;

    let cancelled = false;
    let hlsInstance: Hls | null = null;
    const isHls = primaryDownloadUrl.includes('.m3u8');
    const isIosBrowser = isIosRuntime;
    const isTelegramSource = /t\.me|telegram\.me/i.test(rawStreamUrl);
    let currentInlineStage: 'direct' | 'remux_hls' | 'transcode_hls' = isHls ? 'remux_hls' : 'direct';
    let knownDurHint = knownMovieDurationSec > 0 ? Math.round(knownMovieDurationSec) : 0;
    let directStallTimer: any = null;
    let remuxStallTimer: any = null;
    let globalStallTimer: any = null;
    let hasPlayedAnyFrame = false;

    try {
      videoEl.setAttribute('webkit-playsinline', 'true');
      videoEl.setAttribute('x-webkit-playsinline', 'true');
    } catch {}

    let savedResumeSec = 0;
    if (inlineEpisodeResumeKey) {
      try {
        const parsed = parseFloat(localStorage.getItem(`resume_pos_${inlineEpisodeResumeKey}`) || '0');
        if (!isNaN(parsed) && parsed > 2) {
          savedResumeSec = parsed;
        }
      } catch {}
    }
    let pendingResumeSec: number | null = savedResumeSec > 2 ? savedResumeSec : null;
    let resumeAttempts = 0;

    const tryApplyInlineResume = () => {
      if (cancelled || pendingResumeSec === null || !videoEl) return;
      const vidDur = videoEl.duration && isFinite(videoEl.duration) ? videoEl.duration : 0;
      if (vidDur > 0 && pendingResumeSec >= vidDur - 15) {
        pendingResumeSec = null;
        return;
      }
      if (Math.abs(videoEl.currentTime - pendingResumeSec) <= 1.2) {
        pendingResumeSec = null;
        return;
      }
      if (resumeAttempts < 5) {
        resumeAttempts += 1;
        try {
          videoEl.currentTime = pendingResumeSec;
        } catch {}
      } else {
        pendingResumeSec = null;
      }
    };

    let hlsNativeFallbackTried = false;

    const loadInlineSrc = (urlToLoad: string, forceNative = false) => {
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }
      try {
        videoEl.removeAttribute('src');
        videoEl.querySelectorAll('source').forEach((s) => s.remove());
      } catch {}

      const nextIsHls = urlToLoad.includes('.m3u8');
      if (nextIsHls && !forceNative && Hls.isSupported()) {
        try {
          (videoEl as any).disableRemotePlayback = true;
        } catch {}
        hlsInstance = new Hls({
          enableWorker: !isIosBrowser,
          lowLatencyMode: false,
          preferManagedMediaSource: true,
          startPosition: pendingResumeSec !== null ? pendingResumeSec : -1,
          manifestLoadingTimeOut: 15000,
          fragLoadingTimeOut: 30000,
          xhrSetup: (xhr, reqUrl) => {
            try {
              if (new URL(reqUrl, window.location.href).origin === window.location.origin) {
                xhr.withCredentials = true;
              }
            } catch {}
          },
        });
        let hlsRecovered = false;
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          tryApplyInlineResume();
          startPlayback();
        });
        hlsInstance.on(Hls.Events.ERROR, (_ev, data) => {
          if (!data?.fatal || cancelled) return;
          if (!hlsRecovered) {
            hlsRecovered = true;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hlsInstance?.startLoad();
              return;
            }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hlsInstance?.recoverMediaError();
              return;
            }
          }
          if (
            isIosBrowser &&
            !hlsNativeFallbackTried &&
            videoEl.canPlayType('application/vnd.apple.mpegurl')
          ) {
            hlsNativeFallbackTried = true;
            loadInlineSrc(urlToLoad, true);
            try {
              videoEl.load();
            } catch {}
            startPlayback();
            return;
          }
          if (currentInlineStage === 'remux_hls') {
            escalateInlineToHls('transcode');
          } else {
            setInlineTimedOut(true);
            setInlineLoaded(true);
          }
        });
        hlsInstance.loadSource(urlToLoad);
        hlsInstance.attachMedia(videoEl);
      } else {
        try {
          (videoEl as any).disableRemotePlayback = false;
        } catch {}
        if (videoEl.getAttribute('src') !== urlToLoad) {
          videoEl.src = urlToLoad;
        }
      }
    };

    const startMutedOnInit = isIosBrowser;
    videoEl.muted = startMutedOnInit;
    videoEl.defaultMuted = startMutedOnInit;
    mutedByAutoplayRef.current = startMutedOnInit;
    setInlineMuted(startMutedOnInit);
    setInlineNeedsTapToPlay(false);
    setInlineTimedOut(false);
    setInlineLoaded(false);

    let playInFlight = false;
    let autoplayHardBlocked = false;

    const startPlayback = () => {
      if (cancelled || playInFlight || autoplayHardBlocked) return;
      if (!videoEl.getAttribute('src') && !hlsInstance) return;
      tryApplyInlineResume();
      playInFlight = true;
      const attempt = videoEl.play();
      if (attempt && typeof attempt.then === 'function') {
        attempt
          .then(() => {
            playInFlight = false;
            if (cancelled) return;
            setInlineNeedsTapToPlay(false);
            setInlineMuted(videoEl.muted);
          })
          .catch((err: any) => {
            playInFlight = false;
            if (cancelled) return;
            if (err?.name === 'AbortError') return;
            if (!videoEl.muted) {
              videoEl.muted = true;
              videoEl.defaultMuted = true;
              mutedByAutoplayRef.current = true;
              setInlineMuted(true);
              videoEl
                .play()
                .then(() => {
                  if (!cancelled) setInlineNeedsTapToPlay(false);
                })
                .catch((mutedErr: any) => {
                  if (cancelled || mutedErr?.name === 'AbortError') return;
                  // iOS Low Power Mode or strict autoplay block: reveal Tap-to-Play instead of infinite Loading...
                  autoplayHardBlocked = true;
                  setInlineNeedsTapToPlay(true);
                  setInlineLoaded(true);
                });
            } else {
              autoplayHardBlocked = true;
              setInlineNeedsTapToPlay(true);
              setInlineLoaded(true);
            }
          });
      } else {
        playInFlight = false;
      }
    };

    const armStallWatchdogs = () => {
      if (directStallTimer) clearTimeout(directStallTimer);
      if (remuxStallTimer) clearTimeout(remuxStallTimer);
      if (globalStallTimer) clearTimeout(globalStallTimer);

      if ((isIosBrowser || isTelegramSource) && currentInlineStage === 'direct') {
        directStallTimer = setTimeout(() => {
          if (cancelled || hasPlayedAnyFrame || autoplayHardBlocked) return;
          if (videoEl.readyState < 3 || videoEl.currentTime < 0.1) {
            escalateInlineToHls('remux');
          }
        }, 6500);
      }
      if ((isIosBrowser || isTelegramSource) && currentInlineStage === 'remux_hls') {
        remuxStallTimer = setTimeout(() => {
          if (cancelled || hasPlayedAnyFrame || autoplayHardBlocked) return;
          if (videoEl.readyState < 3 || videoEl.currentTime < 0.1) {
            escalateInlineToHls('transcode');
          }
        }, 12000);
      }
      if (!globalStallTimer) {
        globalStallTimer = setTimeout(() => {
          if (cancelled || hasPlayedAnyFrame || autoplayHardBlocked) return;
          if (videoEl.readyState < 2) {
            setInlineTimedOut(true);
            setInlineLoaded(true);
          }
        }, 28000);
      }
    };

    const escalateInlineToHls = (targetMode: 'remux' | 'transcode') => {
      if (cancelled) return;
      if (!isTelegramSource && !isIosBrowser) return;
      const nextStage = targetMode === 'transcode' ? 'transcode_hls' : 'remux_hls';
      if (currentInlineStage === nextStage) return;
      if (currentInlineStage === 'transcode_hls') return;
      currentInlineStage = nextStage;
      const sourceForHls = rawStreamUrl || primaryDownloadUrl;
      const hlsUrl = buildApiUrl(
        `/api/telegram/hls/playlist.m3u8?url=${encodeURIComponent(sourceForHls)}&mode=${targetMode}${
          knownDurHint > 0 ? `&dur=${knownDurHint}` : ''
        }`
      );
      setInlineLoaded(false);
      setInlineTimedOut(false);
      loadInlineSrc(hlsUrl);
      if (!hlsInstance && typeof videoEl.load === 'function') {
        try {
          videoEl.load();
        } catch {}
      }
      armStallWatchdogs();
      if (!hlsInstance) {
        startPlayback();
      }
    };

    // On iOS Safari/PWA, pre-check codec/container BEFORE touching /api/stream and route
    // Telegram videos directly into Apple HLS / ManagedMediaSource so playback starts reliably with cookies.
    if (isIosBrowser && isTelegramSource && !isHls) {
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 16000);
      fetch(buildApiUrl(`/api/telegram/stream-info?url=${encodeURIComponent(rawStreamUrl)}`), {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null)
        .then((info) => {
          clearTimeout(abortTimer);
          if (cancelled) return;
          if (info && info.status === 'ok') {
            if (typeof info.durationSec === 'number' && info.durationSec > 0) {
              knownDurHint = Math.round(info.durationSec);
            }
            const vCodec = String(info.videoCodec || '').toLowerCase();
            const cont = String(info.container || '').toLowerCase();
            const hlsMode =
              cont.includes('webm') || vCodec === 'vp8' || vCodec === 'vp9' || info.recommendedMode === 'transcode'
                ? 'transcode'
                : 'remux';
            escalateInlineToHls(hlsMode);
            return;
          }
          escalateInlineToHls('remux');
        });
    } else {
      loadInlineSrc(primaryDownloadUrl);
      armStallWatchdogs();
      startPlayback();
    }

    const handleLoadedMetadata = () => {
      tryApplyInlineResume();
      if (!autoplayHardBlocked) startPlayback();
    };

    const handleCanPlay = () => {
      tryApplyInlineResume();
      if (videoEl.readyState >= 3 || !videoEl.paused || autoplayHardBlocked) {
        setInlineLoaded(true);
      }
      if (!autoplayHardBlocked && videoEl.paused) startPlayback();
    };

    const handlePlaying = () => {
      hasPlayedAnyFrame = true;
      autoplayHardBlocked = false;
      if (directStallTimer) clearTimeout(directStallTimer);
      if (remuxStallTimer) clearTimeout(remuxStallTimer);
      if (globalStallTimer) clearTimeout(globalStallTimer);
      tryApplyInlineResume();
      setInlineNeedsTapToPlay(false);
      setInlineTimedOut(false);
      setInlineLoaded(true);
      setInlineMuted(videoEl.muted);
      if (movie) {
        recordMovieViewStart(movie, userId).catch(() => {});
      }
    };

    const handleWaiting = () => {
      if (!cancelled && !autoplayHardBlocked && !inlineTimedOut) {
        setInlineLoaded(false);
      }
    };

    const handleError = () => {
      if (cancelled) return;
      const errCode = videoEl.error?.code;
      if (errCode === 1) return;
      if (!isTelegramSource && !isIosBrowser) {
        setInlineTimedOut(true);
        setInlineLoaded(true);
        return;
      }
      if (currentInlineStage === 'direct') {
        escalateInlineToHls('remux');
      } else if (currentInlineStage === 'remux_hls') {
        escalateInlineToHls('transcode');
      } else {
        setInlineTimedOut(true);
        setInlineLoaded(true);
      }
    };

    const handleTimeUpdate = () => {
      if (cancelled) return;
      const cur = videoEl.currentTime || 0;
      if (cur > 0.15) {
        hasPlayedAnyFrame = true;
        setInlineLoaded(true);
        setInlineNeedsTapToPlay(false);
        setInlineTimedOut(false);
      }
      if (cur > 2 && inlineEpisodeResumeKey && pendingResumeSec === null) {
        try {
          localStorage.setItem(`resume_pos_${inlineEpisodeResumeKey}`, String(cur));
        } catch {}
      }
    };

    videoEl.addEventListener('loadedmetadata', handleLoadedMetadata);
    videoEl.addEventListener('loadeddata', handleCanPlay);
    videoEl.addEventListener('canplay', handleCanPlay);
    videoEl.addEventListener('playing', handlePlaying);
    videoEl.addEventListener('waiting', handleWaiting);
    videoEl.addEventListener('error', handleError);
    videoEl.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      cancelled = true;
      if (directStallTimer) clearTimeout(directStallTimer);
      if (remuxStallTimer) clearTimeout(remuxStallTimer);
      if (globalStallTimer) clearTimeout(globalStallTimer);
      if (inlineSingleTapTimerRef.current) clearTimeout(inlineSingleTapTimerRef.current);
      if (inlineSeekFeedbackTimerRef.current) clearTimeout(inlineSeekFeedbackTimerRef.current);
      if (hlsInstance) {
        hlsInstance.destroy();
      }
      if (videoEl) {
        videoEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
        videoEl.removeEventListener('loadeddata', handleCanPlay);
        videoEl.removeEventListener('canplay', handleCanPlay);
        videoEl.removeEventListener('playing', handlePlaying);
        videoEl.removeEventListener('waiting', handleWaiting);
        videoEl.removeEventListener('error', handleError);
        videoEl.removeEventListener('timeupdate', handleTimeUpdate);
        videoEl.pause();
        videoEl.removeAttribute('src');
        try {
          videoEl.querySelectorAll('source').forEach((s) => s.remove());
          videoEl.load();
        } catch {}
      }
    };
  }, [primaryDownloadUrl, rawStreamUrl, inlineEpisodeResumeKey, isIosRuntime, inlineRetryNonce]);

  const modalContent = (
    <div
      className="fixed inset-0 z-[90] w-full h-[100dvh] bg-[#111317] text-white flex flex-col overflow-hidden select-none"
      onPointerDown={() => {
        if (mutedByAutoplayRef.current && inlineVideoRef.current && !inlineVideoRef.current.paused) {
          inlineVideoRef.current.muted = false;
          mutedByAutoplayRef.current = false;
          setInlineMuted(false);
        }
      }}
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
          {/* Top 16:9 Inline Video Playback Area */}
          <div className="relative w-full aspect-[16/9] sm:h-[42dvh] sm:min-h-[260px] sm:max-h-[420px] bg-black overflow-hidden flex-shrink-0 group touch-manipulation">
            <video
              ref={inlineVideoRef}
              playsInline
              autoPlay
              preload="auto"
              muted={inlineMuted}
              className="w-full h-full object-cover cursor-pointer touch-manipulation"
              onPlaying={() => {
                setInlineLoaded(true);
                setInlineNeedsTapToPlay(false);
                setInlineTimedOut(false);
                if (inlineVideoRef.current) setInlineMuted(inlineVideoRef.current.muted);
              }}
              onClick={(e) => {
                const now = Date.now();
                const rect = e.currentTarget.getBoundingClientRect();
                const tapSide: 'left' | 'right' = (e.clientX - rect.left) > rect.width / 2 ? 'right' : 'left';
                const delta = tapSide === 'right' ? 10 : -10;

                // Continuation burst tap (triple/quadruple tap)
                if (now - inlineSeekBurstRef.current.time < 550 && inlineSeekBurstRef.current.side === tapSide) {
                  if (inlineSingleTapTimerRef.current) clearTimeout(inlineSingleTapTimerRef.current);
                  const nextTotal = inlineSeekBurstRef.current.total + delta;
                  inlineSeekBurstRef.current = { time: now, side: tapSide, total: nextTotal };
                  inlineLastTapRef.current = { time: 0, side: null };
                  handleInlineSkip(delta, nextTotal);
                  return;
                }

                // Double-click / double-tap within 340ms -> +10s / -10s
                if (now - inlineLastTapRef.current.time < 340 && inlineLastTapRef.current.side === tapSide) {
                  if (inlineSingleTapTimerRef.current) clearTimeout(inlineSingleTapTimerRef.current);
                  inlineLastTapRef.current = { time: 0, side: null };
                  inlineSeekBurstRef.current = { time: now, side: tapSide, total: delta };
                  handleInlineSkip(delta, delta);
                  return;
                }

                inlineLastTapRef.current = { time: now, side: tapSide };
                if (inlineSingleTapTimerRef.current) clearTimeout(inlineSingleTapTimerRef.current);
                inlineSingleTapTimerRef.current = setTimeout(() => {
                  const vid = inlineVideoRef.current;
                  if (!vid) return;
                  if (vid.paused) {
                    if (vid.muted) {
                      vid.muted = false;
                      mutedByAutoplayRef.current = false;
                      setInlineMuted(false);
                    }
                    setInlineNeedsTapToPlay(false);
                    vid.play().catch(() => {
                      vid.muted = true;
                      mutedByAutoplayRef.current = true;
                      setInlineMuted(true);
                      vid.play().catch(() => {});
                    });
                  } else if (vid.muted) {
                    vid.muted = false;
                    mutedByAutoplayRef.current = false;
                    setInlineMuted(false);
                  } else {
                    vid.pause();
                  }
                }, 355);
              }}
            />

            {/* Double-Tap / Double-Click Seek Ripple Feedback on Inline Banner (+10s / -10s) */}
            {inlineSeekFeedback && (
              <div
                className={`absolute top-1/2 -translate-y-1/2 z-45 flex flex-col items-center justify-center pointer-events-none animate-in fade-in zoom-in-75 duration-150 ${
                  inlineSeekFeedback.side === 'right' ? 'right-8 sm:right-16' : 'left-8 sm:left-16'
                }`}
              >
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/70 border border-white/20 backdrop-blur-md flex flex-col items-center justify-center text-white shadow-2xl">
                  <span className="text-xs sm:text-sm font-black text-[#00d664]">{inlineSeekFeedback.label}</span>
                </div>
              </div>
            )}

            {/* Clean White Loading Spinner & Text while buffering */}
            {!inlineLoaded && !inlineNeedsTapToPlay && !inlineTimedOut && (
              <div
                className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-2.5 z-20 pointer-events-none"
              >
                <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                <span className="text-white text-xs font-semibold tracking-wide">Loading...</span>
              </div>
            )}

            {/* Tap-to-Play fallback when iOS Low Power Mode / Safari blocks autoplay */}
            {inlineNeedsTapToPlay && !inlineTimedOut && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const vid = inlineVideoRef.current;
                  if (!vid) return;
                  vid.muted = false;
                  mutedByAutoplayRef.current = false;
                  setInlineMuted(false);
                  setInlineNeedsTapToPlay(false);
                  setInlineLoaded(false);
                  vid.play().catch(() => {
                    vid.muted = true;
                    mutedByAutoplayRef.current = true;
                    setInlineMuted(true);
                    vid.play().catch(() => {
                      setInlineNeedsTapToPlay(true);
                      setInlineLoaded(true);
                    });
                  });
                }}
                className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-black/75 hover:bg-black/90 border border-white/30 text-white flex items-center justify-center z-25 shadow-2xl backdrop-blur-md cursor-pointer active:scale-90 transition-transform"
                aria-label="Play video"
              >
                <Play size={26} className="fill-white ml-0.5" />
              </button>
            )}

            {/* Retry fallback if stream timed out */}
            {inlineTimedOut && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setInlineTimedOut(false);
                  setInlineLoaded(false);
                  setInlineRetryNonce((n) => n + 1);
                }}
                className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2 z-25 cursor-pointer"
              >
                <div className="w-11 h-11 rounded-full bg-white/15 border border-white/30 flex items-center justify-center text-white">
                  <Play size={20} className="fill-white ml-0.5" />
                </div>
                <span className="text-white text-xs font-semibold">Tap to Retry</span>
              </button>
            )}

            <div className="absolute inset-0 bg-gradient-to-t from-[#111317] via-transparent to-black/40 pointer-events-none" />

            {/* Top-Left Back Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="fixed top-[max(0.85rem,env(safe-area-inset-top))] left-3 z-40 w-9 h-9 rounded-full bg-black/60 hover:bg-black/85 text-white flex items-center justify-center backdrop-blur-md border border-white/15 shadow-lg cursor-pointer transition-transform active:scale-90"
              aria-label="Back"
            >
              <ArrowLeft size={20} />
            </button>

            {/* Bottom Left Sound Toggle Button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (inlineVideoRef.current) {
                  const nextMuted = !inlineVideoRef.current.muted;
                  inlineVideoRef.current.muted = nextMuted;
                  mutedByAutoplayRef.current = false;
                  setInlineMuted(nextMuted);
                  if (inlineVideoRef.current.paused) {
                    setInlineNeedsTapToPlay(false);
                    inlineVideoRef.current.play().catch(() => {});
                  }
                }
              }}
              className="absolute bottom-3 left-3 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/75 hover:bg-black/90 text-white backdrop-blur-md border border-white/20 shadow-lg cursor-pointer transition-transform active:scale-95"
              aria-label={inlineMuted ? "Unmute audio" : "Mute audio"}
            >
              {inlineMuted ? (
                <>
                  <VolumeX size={15} className="text-red-400" />
                  <span className="text-[11px] font-semibold text-gray-200">Sound Off</span>
                </>
              ) : (
                <>
                  <Volume2 size={15} className="text-[#00d664]" />
                  <span className="text-[11px] font-semibold text-gray-200">Audio On</span>
                </>
              )}
            </button>

            {/* Bottom Right Expand / Fullscreen button */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (inlineSingleTapTimerRef.current) clearTimeout(inlineSingleTapTimerRef.current);
                const exactSec = inlineVideoRef.current
                  ? Math.max(0, Number((inlineVideoRef.current.currentTime || 0).toFixed(2)))
                  : 0;
                if (inlineEpisodeResumeKey && exactSec > 0.3) {
                  try {
                    localStorage.setItem(`resume_pos_${inlineEpisodeResumeKey}`, String(exactSec));
                  } catch {}
                }
                if (inlineVideoRef.current) {
                  inlineVideoRef.current.pause();
                  inlineVideoRef.current.removeAttribute('src');
                  try {
                    inlineVideoRef.current.load();
                  } catch {}
                }
                const enriched = enrichMovieWithResolvedDuration(safeSeasonIndex, primaryEpIdx);
                onWatchNow(
                  {
                    ...enriched,
                    ...(!hasRealSeasons && !enriched?.streamingUrl && rawStreamUrl ? { streamingUrl: rawStreamUrl } : {}),
                    currentTime: exactSec,
                  },
                  safeSeasonIndex,
                  primaryEpIdx,
                  selectedLanguage
                );
              }}
              className="absolute bottom-3 right-3 z-30 w-10 h-10 rounded-full bg-black/75 hover:bg-black/95 text-white flex items-center justify-center backdrop-blur-md border border-white/25 shadow-lg cursor-pointer transition-transform active:scale-90"
              aria-label="Expand Fullscreen"
            >
              <Maximize size={17} />
            </button>
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

            {/* Action Pills Row (Download FIRST before Add to list, Share, Like, Rate, Report) */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5">
              <button
                type="button"
                onClick={() => setShowDownloadModal(true)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors cursor-pointer active:scale-95 ${
                  activeDownloadForTitle
                    ? 'bg-amber-400/15 border-amber-400/60 text-amber-300'
                    : completedCountForTitle > 0
                    ? 'bg-[#00d664]/15 border-[#00d664]/60 text-[#00d664]'
                    : 'bg-[#1e222b] hover:bg-[#262b36] border-white/10 text-neutral-100'
                }`}
              >
                {activeDownloadForTitle ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>{activeDownloadForTitle.progress}%</span>
                  </>
                ) : completedCountForTitle > 0 ? (
                  <>
                    <Check size={14} className="stroke-[2.5]" />
                    <span>
                      {hasRealSeasons
                        ? `Download (${completedCountForTitle})`
                        : 'Downloaded'}
                    </span>
                  </>
                ) : (
                  <>
                    <Download size={14} />
                    <span>Download</span>
                  </>
                )}
              </button>

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
                    {episodeList.length === 1 && /\d+\s*-\s*\d+/.test(getEpisodeDisplayLabel(episodeList[0], 0, false))
                      ? `${getEpisodeDisplayLabel(episodeList[0], 0, false)} Episodes`
                      : `${episodeList.length} Episode${episodeList.length === 1 ? '' : 's'}`}
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
                                {season.episodes?.length === 1 && /\d+\s*-\s*\d+/.test(getEpisodeDisplayLabel(season.episodes[0], 0, false))
                                  ? `${getEpisodeDisplayLabel(season.episodes[0], 0, false)} EP`
                                  : `${season.episodes?.length || 0} EP`}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Episode Number Tiles Strip (01, 02, 03... or Combined 1-6) */}
                {episodeList.length > 0 ? (
                  <div className="space-y-1.5">
                    <div
                      ref={episodeStripRef}
                      className="flex items-center gap-2 overflow-x-auto scrollbar-none py-1 touch-pan-x"
                    >
                      {episodeList.map((ep: any, eIdx: number) => {
                        const epNumLabel = getEpisodeDisplayLabel(ep, eIdx, true);
                        const isSelected = selectedEpisodeIdx === eIdx;
                        return (
                          <button
                            key={eIdx}
                            type="button"
                            onClick={() => {
                              setSelectedEpisodeIdx(eIdx);
                            }}
                            className={`relative flex-shrink-0 min-w-[48px] h-11 px-3 rounded-lg text-xs font-bold border transition-colors cursor-pointer flex items-center justify-center ${
                              isSelected
                                ? 'bg-[#0c3b28] border-[#00d664]/60 text-[#00d664]'
                                : 'bg-[#1e222b] border-white/10 text-neutral-300 hover:bg-[#262b36]'
                            }`}
                          >
                            <span>{epNumLabel}</span>
                            {isEpisodeNewActive(ep) && (
                              <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#00d664]" />
                            )}
                          </button>
                        );
                      })}
                      {episodeList.length === 1 && /\d+\s*-\s*\d+/.test(getEpisodeDisplayLabel(episodeList[0], 0, true)) && (
                        <span className="text-xs text-neutral-300 font-medium whitespace-nowrap pl-1">
                          All Episodes ({getEpisodeDisplayLabel(episodeList[0], 0, true)}) in 1 Video
                        </span>
                      )}
                    </div>
                    {currentEpisodeObj && /\d+\s*-\s*\d+/.test(getEpisodeDisplayLabel(currentEpisodeObj, primaryEpIdx, true)) && episodeList.length > 1 && (
                      <p className="text-[11px] text-[#00d664]/90 font-medium">
                        Selected: Episodes {getEpisodeDisplayLabel(currentEpisodeObj, primaryEpIdx, true)} combined in 1 video
                      </p>
                    )}
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
                        <p className="mt-1.5 text-xs text-neutral-200 font-medium truncate">
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
      {/* DOWNLOAD OPTIONS MODAL (Movies & Series Episodes, z-[110]) */}
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
