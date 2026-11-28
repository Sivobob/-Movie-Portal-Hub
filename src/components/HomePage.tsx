import React, { useState, useEffect, useRef, useMemo } from 'react';
import MovieCard from './MovieCard';
import { Play, Film, Plus, Check, Info } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import VideoPlayerModal from './VideoPlayerModal';
import MovieDetailsModal from './MovieDetailsModal';
import { useAuth } from '../context/AuthContext';
import { useMovies } from '../context/MoviesContext';
import {
  addToMyList,
  removeFromMyList,
  fetchMyList,
  saveWatchProgress,
} from '../services/userWatchService';

import {
  getNewEpisodesWithin24h,
  getEpisodeDisplayLabel,
  getMovieReleaseYear,
  getTimestampMs,
  sortMoviesList,
} from '../services/movieStorage';
import PosterImage from './PosterImage';
import { parseDurationToSeconds } from '../utils/duration';
import { resolveEpisodePlaybackDurationSec } from '../utils/playerHelpers';
import { getAppPreferences, isMatureContent } from '../services/userPreferencesService';

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0.35,
  }),
  center: {
    x: 0,
    opacity: 1,
    zIndex: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? '-100%' : '100%',
    opacity: 0.35,
    zIndex: 0,
  }),
};

export default function HomePage() {
  const { user } = useAuth();
  const { movies: rawMovies, isLoading } = useMovies();
  const [familyMode, setFamilyMode] = useState<boolean>(() => getAppPreferences().familyMode);

  useEffect(() => {
    const onPrefs = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail && typeof detail.familyMode === 'boolean') {
        setFamilyMode(detail.familyMode);
      } else {
        setFamilyMode(getAppPreferences().familyMode);
      }
    };
    window.addEventListener('mp_preferences_updated', onPrefs);
    return () => window.removeEventListener('mp_preferences_updated', onPrefs);
  }, []);

  const movies = useMemo(
    () => (familyMode ? rawMovies.filter((m) => !isMatureContent(m)) : rawMovies),
    [rawMovies, familyMode]
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get('category');

  const setCategory = (cat: string | null, replace = false) => {
    if (cat) {
      setSearchParams({ category: cat }, { replace });
    } else {
      setSearchParams({}, { replace });
    }
  };

  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [activeSeasonIndex, setActiveSeasonIndex] = useState(0);
  const [activeEpisodeIndex, setActiveEpisodeIndex] = useState(0);
  const [playingMovie, setPlayingMovie] = useState<any | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // My List state
  const [myListIds, setMyListIds] = useState<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Helper: Strictly verify 2026 release year for Featured slide
  const is2026Release = (m: any): boolean => {
    if (!m) return false;
    return getMovieReleaseYear(m) === 2026;
  };

  const featuredMovies = useMemo(() => {
    const FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;

    // Only 2026 releases stay in the featured slide, and auto-expire from the slide after 2 days (48 hours)
    const brandNew2026 = movies
      .filter((m: any) => {
        if (!m || m.published === false) return false;
        if (!is2026Release(m)) return false;
        const t = getTimestampMs(m.telegramDateMs) || getTimestampMs(m.createdAt) || 0;
        if (t <= 0) return false;
        const ageMs = nowMs - t;
        return ageMs >= -60_000 && ageMs < FORTY_EIGHT_HOURS_MS;
      })
      .sort((a: any, b: any) => {
        const aTime = getTimestampMs(a.telegramDateMs) || getTimestampMs(a.createdAt) || 0;
        const bTime = getTimestampMs(b.telegramDateMs) || getTimestampMs(b.createdAt) || 0;
        return bTime - aTime;
      });

    return brandNew2026.slice(0, 6);
  }, [movies, nowMs]);

  const categoryRef = useRef(category);
  const selectedMovieRef = useRef(selectedMovie);
  const playingMovieRef = useRef(playingMovie);
  const ignoringPopstateRef = useRef(0);
  const ignoreResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    categoryRef.current = category;
  }, [category]);

  useEffect(() => {
    selectedMovieRef.current = selectedMovie;
  }, [selectedMovie]);

  useEffect(() => {
    playingMovieRef.current = playingMovie;
  }, [playingMovie]);

  useEffect(() => {
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.getElementById('root')?.scrollTo({ top: 0, behavior: 'auto' });
    } catch {}
  }, [category]);

  // Load user My List
  const loadUserHistory = () => {
    const uid = user?.uid || 'guest_user';
    fetchMyList(uid).then((list) => {
      const ids = new Set(list.map((item) => item.movieId));
      setMyListIds(ids);
    }).catch(() => {});
  };

  useEffect(() => {
    loadUserHistory();
  }, [user, playingMovie]);

  const popHistoryEntrySilently = () => {
    ignoringPopstateRef.current += 1;
    if (ignoreResetTimerRef.current) clearTimeout(ignoreResetTimerRef.current);
    ignoreResetTimerRef.current = setTimeout(() => {
      ignoringPopstateRef.current = 0;
    }, 500);
    try {
      window.history.back();
    } catch (e) {
      ignoringPopstateRef.current = Math.max(0, ignoringPopstateRef.current - 1);
    }
  };

  const closePlayer = () => {
    if (!playingMovieRef.current) return;
    playingMovieRef.current = null;
    setPlayingMovie(null);
    if (window.history.state?.appModal === 'player') {
      popHistoryEntrySilently();
    }
  };

  const closeMovieDetails = () => {
    if (!selectedMovieRef.current) return;
    selectedMovieRef.current = null;
    setSelectedMovie(null);
    if (window.history.state?.appModal === 'movie_detail') {
      popHistoryEntrySilently();
    }
  };

  // Hardware & browser back button handler (strictly 1 step back per press)
  useEffect(() => {
    const handlePopState = () => {
      if (ignoringPopstateRef.current > 0) {
        ignoringPopstateRef.current -= 1;
        if (ignoringPopstateRef.current === 0 && ignoreResetTimerRef.current) {
          clearTimeout(ignoreResetTimerRef.current);
          ignoreResetTimerRef.current = null;
        }
        return;
      }
      if (playingMovieRef.current) {
        playingMovieRef.current = null;
        setPlayingMovie(null);
        return;
      }
      if (selectedMovieRef.current) {
        selectedMovieRef.current = null;
        setSelectedMovie(null);
        return;
      }
    };

    window.addEventListener('popstate', handlePopState);

    let backListener: any = null;
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app').then(({ App: CapApp }) => {
        backListener = CapApp.addListener('backButton', () => {
          if (typeof window !== 'undefined' && (window as any).__MOVIE_PORTAL_MANDATORY_UPDATE__) {
            return;
          }
          if (playingMovieRef.current) {
            closePlayer();
            return;
          }
          if (selectedMovieRef.current) {
            closeMovieDetails();
            return;
          }
          if (categoryRef.current) {
            setCategory(null, true);
            return;
          }

          try {
            CapApp.exitApp();
          } catch (e) {}
        });
      }).catch(() => {});
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (ignoreResetTimerRef.current) {
        clearTimeout(ignoreResetTimerRef.current);
      }
      if (backListener && typeof backListener.remove === 'function') {
        backListener.remove();
      }
    };
  }, []);

  // Global MoviesProvider keeps rawMovies synced live across all routes and resume events.

  // Open specific movie/series when user taps a push/release notification
  useEffect(() => {
    if (movies.length === 0) return;

    const openMovieById = (rawId: string | null | undefined) => {
      const targetId = String(rawId || '').trim();
      if (!targetId) return;
      const match = movies.find(
        (m) => m.id === targetId || (m.imdbId && m.imdbId === targetId)
      );
      if (match) {
        try {
          sessionStorage.removeItem('mp_pending_open_movie_id');
        } catch {}
        playingMovieRef.current = null;
        setPlayingMovie(null);
        handleMovieClick(match);
      }
    };

    try {
      const pendingId = sessionStorage.getItem('mp_pending_open_movie_id');
      if (pendingId) {
        openMovieById(pendingId);
      }
    } catch {}

    const handleOpenEvent = (e: Event) => {
      const detailId = (e as CustomEvent)?.detail;
      if (detailId) {
        openMovieById(String(detailId));
      }
    };
    window.addEventListener('movie_portal_open_movie', handleOpenEvent);
    return () => {
      window.removeEventListener('movie_portal_open_movie', handleOpenEvent);
    };
  }, [movies]);

  useEffect(() => {
    const onDirectUpsert = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      const title = String(detail?.title || '').trim();
      if (title) {
        showToast(`New Upload Added: ${title}`);
      }
    };
    window.addEventListener('telegram_direct_movie_upsert', onDirectUpsert);
    return () => {
      window.removeEventListener('telegram_direct_movie_upsert', onDirectUpsert);
    };
  }, []);

  const resolvedSelectedMovie = useMemo(() => {
    if (!selectedMovie) return null;
    const live = movies.find(
      (m) => m.id === selectedMovie.id || (selectedMovie.imdbId && m.imdbId === selectedMovie.imdbId)
    );
    if (!live) return selectedMovie;
    return selectedMovie.currentTime
      ? { ...live, currentTime: selectedMovie.currentTime }
      : live;
  }, [selectedMovie, movies]);

  const resolvedPlayingParentMovie = useMemo(() => {
    if (!playingMovie) return undefined;
    const candidate = playingMovie.movie || (playingMovie.seasons ? playingMovie : null);
    if (!candidate) return undefined;
    return (
      movies.find(
        (m) => m.id === candidate.id || (candidate.imdbId && m.imdbId === candidate.imdbId)
      ) || candidate
    );
  }, [playingMovie, movies]);

  useEffect(() => {
    if (featuredMovies.length > 0 && activeSlideIndex >= featuredMovies.length) {
      setActiveSlideIndex(0);
    }
  }, [featuredMovies.length, activeSlideIndex]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3000);
  };

  const [slideDirection, setSlideDirection] = useState<number>(1);
  const [isUserInteracting, setIsUserInteracting] = useState(false);
  const [isSwiping, setIsSwiping] = useState(false);
  const touchStartPosRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isSwipingRef = useRef(false);
  const interactionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleInteractionStart = () => {
    setIsUserInteracting(true);
    if (interactionTimeoutRef.current) {
      clearTimeout(interactionTimeoutRef.current);
    }
  };

  const handleInteractionEnd = () => {
    if (interactionTimeoutRef.current) {
      clearTimeout(interactionTimeoutRef.current);
    }
    interactionTimeoutRef.current = setTimeout(() => {
      setIsUserInteracting(false);
    }, 3000);
  };

  // Automatic hero slider (every 3 seconds)
  useEffect(() => {
    if (category !== null) return;
    if (featuredMovies.length <= 1) return;
    if (isUserInteracting) return;

    const interval = setInterval(() => {
      setSlideDirection(1);
      setActiveSlideIndex((prev) => (prev + 1) % featuredMovies.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [category, featuredMovies.length, isUserInteracting, activeSlideIndex]);

  const folderTabs: { label: string; value: string | null }[] = useMemo(
    () => [
      { label: 'All', value: null },
      { label: 'Bollywood', value: 'Bollywood' },
      { label: 'Hollywood', value: 'Hollywood' },
      { label: 'Series', value: 'Series' },
    ],
    []
  );

  const handleManualSwipe = (direction: 'left' | 'right') => {
    if (featuredMovies.length <= 1) return;
    handleInteractionStart();
    if (direction === 'left') {
      setSlideDirection(1);
      setActiveSlideIndex((prev) => (prev + 1) % featuredMovies.length);
    } else {
      setSlideDirection(-1);
      setActiveSlideIndex((prev) => (prev - 1 + featuredMovies.length) % featuredMovies.length);
    }
    handleInteractionEnd();
  };

  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    touchStartPosRef.current = { x: clientX, y: clientY, time: Date.now() };
    isSwipingRef.current = false;
    setIsSwiping(false);
    handleInteractionStart();
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();
    if (!touchStartPosRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    const diffX = clientX - touchStartPosRef.current.x;
    const diffY = clientY - touchStartPosRef.current.y;

    if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
      isSwipingRef.current = true;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent | React.MouseEvent) => {
    e.stopPropagation();
    if (touchStartPosRef.current) {
      const clientX =
        'changedTouches' in e ? e.changedTouches[0].clientX : (e as React.MouseEvent).clientX;
      const clientY =
        'changedTouches' in e ? e.changedTouches[0].clientY : (e as React.MouseEvent).clientY;
      const diffX = clientX - touchStartPosRef.current.x;
      const diffY = clientY - touchStartPosRef.current.y;
      const elapsedTime = Date.now() - touchStartPosRef.current.time;

      const isHorizontal = Math.abs(diffX) > Math.abs(diffY);
      const isQuickSwipe = elapsedTime < 350 && Math.abs(diffX) >= 20;
      const isLongSwipe = Math.abs(diffX) >= 30;

      if (isHorizontal && (isQuickSwipe || isLongSwipe)) {
        isSwipingRef.current = true;
        setIsSwiping(true);
        if (diffX < 0) {
          handleManualSwipe('left');
        } else {
          handleManualSwipe('right');
        }
      } else if (Math.abs(diffY) > 10 || Math.abs(diffX) > 10) {
        isSwipingRef.current = true;
        setIsSwiping(true);
      }
    }
    touchStartPosRef.current = null;
    handleInteractionEnd();

    setTimeout(() => {
      isSwipingRef.current = false;
      setIsSwiping(false);
    }, 120);
  };

  const currentFeatured = featuredMovies.length > 0
    ? (featuredMovies[activeSlideIndex] || featuredMovies[0])
    : null;

  const categoryMovies = useMemo(() => {
    if (!category) return [];
    const filtered = movies.filter((m) => {
      if (!m || m.published === false) return false;
      if (category === 'Bollywood') {
        return (
          m.displayCategory === 'Bollywood' ||
          m.originalCategory === 'Bollywood Movie' ||
          m.originalCategory === 'South Indian Movie'
        );
      }
      if (category === 'Hollywood') {
        return (
          m.displayCategory === 'Hollywood' ||
          m.originalCategory === 'Hollywood Movie'
        );
      }
      if (category === 'Series') {
        return (
          m.displayCategory === 'Series' ||
          m.displayCategory === 'Anime' ||
          m.originalCategory === 'Anime Series' ||
          m.originalCategory === 'Anime Movie' ||
          m.originalCategory === 'Web Series' ||
          m.originalCategory === 'Anime' ||
          m.contentType === 'anime'
        );
      }
      return m.displayCategory === category;
    });
    return sortMoviesList(filtered);
  }, [category, movies]);

  const handleMovieClick = (movie: any, seasonIndex = 0, episodeIndex = 0) => {
    setActiveSeasonIndex(seasonIndex);
    setActiveEpisodeIndex(episodeIndex);
    selectedMovieRef.current = movie;
    setSelectedMovie(movie);
    if (window.history.state?.appModal !== 'movie_detail') {
      try {
        window.history.pushState({ ...(window.history.state || {}), appModal: 'movie_detail' }, '');
      } catch (e) {}
    }
  };

  const handleWatchNow = (
    movie: any,
    seasonIndex = 0,
    episodeIndex = 0,
    audioLanguage?: string
  ) => {
    const uid = user?.uid || 'guest_user';
    const resumeTime = movie.currentTime || 0;
    const movieDurationSec =
      (typeof movie.duration === 'number' && movie.duration > 0 ? movie.duration : 0) ||
      parseDurationToSeconds(movie.runtime);

    const pushPlayerHistory = () => {
      if (window.history.state?.appModal !== 'player') {
        try {
          window.history.pushState({ ...(window.history.state || {}), appModal: 'player' }, '');
        } catch (e) {}
      }
    };

    if (movie.seasons && movie.seasons.length > 0) {
      let sIdx = Math.max(0, Math.min(seasonIndex, movie.seasons.length - 1));
      let season = movie.seasons[sIdx];
      let episodes = season?.episodes || [];
      let eIdx = Math.max(0, Math.min(episodeIndex, Math.max(0, episodes.length - 1)));
      let ep = episodes[eIdx];

      const getEpStream = (episode: any) =>
        String(
          episode?.streamUrl ||
            episode?.videoQualities?.['720p'] ||
            episode?.videoQualities?.['1080p'] ||
            episode?.videoQualities?.['480p'] ||
            episode?.videoQualities?.['360p'] ||
            ''
        ).trim();

      let epStream = getEpStream(ep);

      if (!epStream) {
        for (let si = 0; si < movie.seasons.length; si++) {
          const eps = movie.seasons[si]?.episodes || [];
          const ei = eps.findIndex((candidate: any) => Boolean(getEpStream(candidate)));
          if (ei >= 0) {
            sIdx = si;
            season = movie.seasons[si];
            eIdx = ei;
            ep = eps[ei];
            epStream = getEpStream(ep);
            break;
          }
        }
      }

      if (ep && epStream) {
        setActiveSeasonIndex(sIdx);
        setActiveEpisodeIndex(eIdx);
        const epDurationSec = resolveEpisodePlaybackDurationSec(ep);
        if (epDurationSec > 0 || resumeTime > 0) {
          saveWatchProgress(uid, movie, resumeTime, epDurationSec).catch(() => {});
        }
        pushPlayerHistory();
        const sLabel = String(season.seasonNumber || sIdx + 1).padStart(2, '0');
        const eLabel = getEpisodeDisplayLabel(ep, eIdx, true);
        const nextPlaying = {
          title: `${movie.title} - S${sLabel}E${eLabel}: ${ep.title}`,
          streamingUrl: epStream,
          videoQualities: ep.videoQualities,
          displayCategory: movie.displayCategory,
          posterUrl: movie.posterUrl,
          movie: movie,
          seasonIndex: sIdx,
          episodeIndex: eIdx,
          language: audioLanguage || movie.language,
          currentTime: resumeTime,
          initialDuration: epDurationSec,
        };
        playingMovieRef.current = nextPlaying;
        setPlayingMovie(nextPlaying);
        return;
      }
    }

    const movieStream = String(
      movie.streamingUrl ||
        movie.videoQualities?.['720p'] ||
        movie.videoQualities?.['1080p'] ||
        movie.videoQualities?.['480p'] ||
        movie.videoQualities?.['360p'] ||
        ''
    ).trim();

    if (movieStream) {
      if (movieDurationSec > 0 || resumeTime > 0) {
        saveWatchProgress(uid, movie, resumeTime, movieDurationSec).catch(() => {});
      }
      pushPlayerHistory();
      const nextPlaying = {
        ...movie,
        streamingUrl: movieStream,
        language: audioLanguage || movie.language,
        currentTime: resumeTime,
        initialDuration: movieDurationSec,
      };
      playingMovieRef.current = nextPlaying;
      setPlayingMovie(nextPlaying);
    } else {
      handleMovieClick(movie);
    }
  };

  const toggleMyList = async (e: React.MouseEvent, movie: any) => {
    e.stopPropagation();
    const uid = user?.uid || 'guest_user';
    const movieId = movie.id || movie.imdbId;
    if (myListIds.has(movieId)) {
      await removeFromMyList(uid, movieId);
      setMyListIds((prev) => {
        const next = new Set(prev);
        next.delete(movieId);
        return next;
      });
      showToast(`Removed "${movie.title}" from My List`);
    } else {
      await addToMyList(uid, movie);
      setMyListIds((prev) => new Set(prev).add(movieId));
      showToast(`Added "${movie.title}" to My List`);
    }
  };

  useEffect(() => {
    const updateClock = () => setNowMs(Date.now());
    const timer = setInterval(updateClock, 30_000);
    window.addEventListener('focus', updateClock);
    document.addEventListener('visibilitychange', updateClock);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', updateClock);
      document.removeEventListener('visibilitychange', updateClock);
    };
  }, []);

  const newEpisodes24h = useMemo(() => {
    return getNewEpisodesWithin24h(movies, nowMs);
  }, [movies, nowMs]);

  const latestMoviesAndSeries = useMemo(() => {
    // Show only 2026 release movies and web series in the Latest row
    return movies.filter((m) => m && m.published !== false && is2026Release(m)).slice(0, 25);
  }, [movies]);

  const {
    suspenseMovies,
    actionMovies,
    comedyMovies,
    romanceMovies,
    thrillerHorrorMovies,
    dramaMovies,
    topSeries,
  } = useMemo(() => {
    const getByGenre = (genreKeyword: string) => {
      const kw = genreKeyword.toLowerCase();
      return movies.filter((m) => {
        const g = String(m.genre || '').toLowerCase();
        const cat = String(m.displayCategory || '').toLowerCase();
        const orig = String(m.originalCategory || '').toLowerCase();
        return g.includes(kw) || cat.includes(kw) || orig.includes(kw);
      });
    };

    const thriller = getByGenre('thriller');
    const horror = getByGenre('horror');

    return {
      suspenseMovies: getByGenre('suspense'),
      actionMovies: getByGenre('action'),
      comedyMovies: getByGenre('comedy'),
      romanceMovies: getByGenre('romance'),
      thrillerHorrorMovies: Array.from(
        new Map([...thriller, ...horror].map((m) => [m.id, m])).values()
      ),
      dramaMovies: getByGenre('drama'),
      topSeries: movies.filter(
        (m) =>
          m.displayCategory === 'Series' ||
          m.displayCategory === 'Anime' ||
          m.originalCategory === 'Anime Series' ||
          m.originalCategory === 'Web Series' ||
          m.contentType === 'anime'
      ),
    };
  }, [movies]);


  const renderFolderTabRow = (overHero: boolean) => (
    <div
      className={
        overHero
          ? 'absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-black via-black/70 to-transparent px-4 sm:px-6 pt-1 pb-5 pointer-events-auto'
          : 'sticky top-0 z-30 bg-black/95 backdrop-blur-md px-4 sm:px-6 py-1.5 border-b border-white/[0.06]'
      }
    >
      <div className="max-w-7xl mx-auto flex items-center gap-6 sm:gap-8 overflow-x-auto scrollbar-none">
        {folderTabs.map((tab) => {
          const isActive = category === tab.value;
          return (
            <button
              key={tab.label}
              type="button"
              onClick={() => setCategory(tab.value)}
              className={`min-h-[40px] relative pb-1 flex items-center cursor-pointer whitespace-nowrap flex-shrink-0 transition-all tracking-tight drop-shadow-[0_1px_6px_rgba(0,0,0,0.85)] ${
                isActive
                  ? 'text-white font-bold text-[17px] sm:text-[18px]'
                  : 'text-[#b4b9c2] hover:text-white font-normal text-[16px] sm:text-[17px]'
              }`}
            >
              <span>{tab.label}</span>
              {isActive && (
                <span className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-red-600 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div
      className="relative flex-1 w-full max-w-full bg-black text-white flex flex-col select-none touch-pan-y pt-0 pb-[calc(5.75rem+env(safe-area-inset-bottom))]"
    >

      {toastMessage && (
        <div className="fixed top-[max(4.25rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[120] bg-neutral-900/95 border border-red-600/50 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-2xl backdrop-blur-md max-w-[90vw] truncate">
          {toastMessage}
        </div>
      )}

      {(category || !currentFeatured) && renderFolderTabRow(false)}

      {category ? (
        <div className="flex-grow pt-3 touch-pan-y">
          <div className="flex items-center justify-between gap-2 px-3 sm:px-4 mb-4">
            <h2 className="text-white font-black text-lg sm:text-xl tracking-wide uppercase truncate">
              {category}
            </h2>
          </div>

          {categoryMovies.length === 0 ? (
            <div className="py-24 px-4 text-center">
              <Film className="mx-auto mb-3 text-neutral-700" size={44} />
              <h3 className="text-2xl font-black text-red-500 tracking-wider uppercase mb-2">
                NO {category.toUpperCase()} FOUND
              </h3>
              <p className="text-xs text-gray-500 max-w-xs mx-auto">
                No {category === 'Series' ? 'series' : `${category.toLowerCase()} movies`} have been uploaded yet.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3 px-2 sm:px-4 pb-8">
                {categoryMovies.map((movie, idx) => (
                  <div key={movie.id} className="relative group">
                    <MovieCard
                      movie={movie}
                      loading={idx < 12 ? 'eager' : 'lazy'}
                      onClick={() => handleMovieClick(movie)}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : movies.length === 0 ? (
        <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center p-6 text-center">
          <Film size={44} className="text-neutral-700 mb-3" />
          <h2 className="text-2xl font-black text-red-500 uppercase tracking-wider mb-2">NO CONTENT FOUND</h2>
          <p className="text-xs text-gray-500 max-w-sm">Please upload movies or series in the Admin panel.</p>
        </div>
      ) : (
        <div className="flex flex-col w-full">
          {currentFeatured ? (
            <>
              {/* Cinematic Hero Banner with Folder Tabs Overlaid on Top Gradient Edge (Matching Reference Screenshot) */}
              <div
                className="relative w-full h-[32dvh] sm:h-[40dvh] flex flex-col justify-end overflow-hidden select-none touch-pan-y"
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onMouseDown={handleTouchStart}
                onMouseMove={handleTouchMove}
                onMouseUp={handleTouchEnd}
              >
                {renderFolderTabRow(true)}
                <AnimatePresence initial={false} custom={slideDirection}>
                  <motion.div
                    key={currentFeatured.id || activeSlideIndex}
                    custom={slideDirection}
                    variants={slideVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{
                      x: { type: 'tween', ease: [0.22, 1, 0.36, 1], duration: 0.35 },
                      opacity: { duration: 0.25 },
                    }}
                    className="absolute inset-0 will-change-transform cursor-pointer touch-pan-y"
                    onClick={() => {
                      if (!isSwiping && !isSwipingRef.current) {
                        handleMovieClick(currentFeatured);
                      }
                    }}
                  >
                    <PosterImage
                      posterUrl={currentFeatured.backdropUrl || currentFeatured.posterUrl}
                      backdropUrl={currentFeatured.posterUrl}
                      title={currentFeatured.title}
                      year={currentFeatured.releaseYear}
                      width={900}
                      alt={currentFeatured.title}
                      loading="eager"
                      className="absolute inset-0 w-full h-full object-cover object-center brightness-105 contrast-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
                  </motion.div>
                </AnimatePresence>

                {/* Hero Banner Overlay Title & Clean Right Layout */}
                <div className="relative z-10 p-3 sm:p-5 pt-12 flex items-end justify-between">
                  <div className="max-w-[70%]">
                    <h1 className="text-2xl sm:text-4xl font-black tracking-tighter uppercase text-white drop-shadow-2xl font-sans line-clamp-1">
                      {currentFeatured.title}
                    </h1>
                  </div>

                  {/* Slider Dots */}
                  {featuredMovies.length > 1 && (
                    <div className="flex items-center gap-1.5 pb-2">
                      {featuredMovies.slice(0, 5).map((_, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSlideDirection(idx > activeSlideIndex ? 1 : -1);
                            setActiveSlideIndex(idx);
                          }}
                          className={`h-1.5 rounded-full transition-all cursor-pointer ${
                            idx === activeSlideIndex ? 'w-5 bg-red-600' : 'w-1.5 bg-white/40'
                          }`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Reference Screenshot Style Mini Preview Card Below Banner */}
              <div className="px-3 sm:px-6 -mt-3 relative z-20">
                <div
                  onClick={() => handleMovieClick(currentFeatured)}
                  className="bg-neutral-900/95 hover:bg-neutral-900 border border-neutral-800 hover:border-red-600/50 rounded-2xl p-2.5 sm:p-3 flex items-center justify-between gap-3 shadow-xl cursor-pointer group transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-14 sm:w-14 sm:h-16 rounded-xl overflow-hidden bg-neutral-950 flex-shrink-0 border border-white/10 shadow">
                      <PosterImage
                        posterUrl={currentFeatured.posterUrl || currentFeatured.backdropUrl}
                        backdropUrl={currentFeatured.backdropUrl}
                        title={currentFeatured.title}
                        width={300}
                        alt={currentFeatured.title}
                        compactFallback
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs sm:text-sm font-black text-white uppercase tracking-tight truncate group-hover:text-red-500 transition-colors">
                        {currentFeatured.title}
                      </h4>
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-400 mt-0.5">
                        <span className="bg-neutral-800 text-gray-300 px-1.5 py-0.2 rounded text-[10px]">
                          {currentFeatured.displayCategory || currentFeatured.originalCategory || 'Movie'}
                        </span>
                        <span>•</span>
                        <span>{currentFeatured.releaseYear || (currentFeatured as any).year || '2026'}</span>
                        <span>•</span>
                        <span className="text-red-400 truncate">{currentFeatured.genre || 'Action'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-emerald-500 hover:bg-emerald-400 text-black flex items-center justify-center flex-shrink-0 shadow-lg shadow-emerald-500/20 group-hover:scale-105 transition-all">
                    <Play size={18} fill="black" className="ml-0.5" />
                  </div>
                </div>
              </div>
            </>
          ) : null}

          {/* NEW EPISODES (Auto-expires from Home after 24h) */}
          {newEpisodes24h.length > 0 && (
            <div className="mt-5 px-3 sm:px-6">
              <div className="flex items-center gap-2 mb-3 min-w-0">
                <span className="w-1.5 h-5 bg-[#E50914] rounded-full flex-shrink-0" />
                <h3 className="text-base sm:text-lg font-bold text-white tracking-wide truncate">
                  New Episodes
                </h3>
              </div>
              <div className="flex items-stretch gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {newEpisodes24h.map((item) => {
                  const epCode = `S${String(item.seasonNumber).padStart(2, '0')} • E${item.episodeLabel || String(item.episodeNumber).padStart(2, '0')}`;
                  return (
                    <div
                      key={item.key}
                      onClick={() => handleMovieClick(item.movie, item.seasonIndex, item.episodeIndex)}
                      className="flex-shrink-0 w-36 sm:w-44 bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-red-600/60 flex flex-col shadow-lg cursor-pointer group transition-colors"
                    >
                      <div className="relative aspect-[3/4] w-full bg-neutral-950 overflow-hidden">
                        <PosterImage
                          posterUrl={item.movie.posterUrl || item.movie.backdropUrl}
                          backdropUrl={item.movie.backdropUrl}
                          title={item.movie.title}
                          year={item.movie.releaseYear}
                          width={400}
                          isSeries
                          alt={`${item.movie.title} ${epCode}`}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/25 to-transparent" />
                        <span className="absolute top-2 left-2 bg-[#E50914] text-white font-black text-[9px] px-2 py-0.5 rounded shadow uppercase tracking-wider">
                          NEW
                        </span>
                        <span className="absolute top-2 right-2 bg-black/80 backdrop-blur-sm text-white font-bold text-[10px] px-1.5 py-0.5 rounded border border-white/15">
                          {epCode}
                        </span>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="w-10 h-10 rounded-full bg-black/55 backdrop-blur-sm border border-white/40 text-white flex items-center justify-center shadow-lg group-hover:bg-[#E50914] group-hover:border-[#E50914] group-hover:scale-110 transition-all">
                            <Play size={16} fill="white" className="ml-0.5" />
                          </div>
                        </div>
                        <div className="absolute bottom-2 left-2 right-2 text-left flex items-end justify-between gap-1.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-extrabold text-white truncate drop-shadow">
                              {item.movie.title}
                            </p>
                            <p className="text-[11px] font-semibold text-red-400 truncate drop-shadow">
                              {item.episodeTitle}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMovieClick(item.movie, item.seasonIndex, item.episodeIndex);
                            }}
                            className="w-6 h-6 rounded-full bg-black/75 border border-white/20 text-gray-200 hover:text-white flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer"
                            title="Series Details"
                            aria-label="Series Details"
                          >
                            <Info size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* LATEST MOVIES & SERIES */}
          {latestMoviesAndSeries.length > 0 && (
            <div className="mt-6 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Latest Movies &amp; Series
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {latestMoviesAndSeries.map((movie) => (
                  <div
                    key={movie.id}
                    onClick={() => handleMovieClick(movie)}
                    className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer"
                  >
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <PosterImage
                        posterUrl={movie.posterUrl}
                        backdropUrl={movie.backdropUrl}
                        title={movie.title}
                        year={movie.releaseYear}
                        width={400}
                        alt={movie.title}
                        loading="eager"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 2. DYNAMIC GENRE ROW: Suspenseful Movies */}
          {suspenseMovies.length > 0 && (
            <div className="mt-6 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Suspenseful Movies
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {suspenseMovies.slice(0, 25).map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <PosterImage
                        posterUrl={movie.posterUrl}
                        backdropUrl={movie.backdropUrl}
                        title={movie.title}
                        year={movie.releaseYear}
                        width={400}
                        alt={movie.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 3. DYNAMIC GENRE ROW: Blockbuster Action & Adventure Movies */}
          {actionMovies.length > 0 && (
            <div className="mt-6 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Blockbuster Action &amp; Adventure Movies
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {actionMovies.slice(0, 25).map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <PosterImage
                        posterUrl={movie.posterUrl}
                        backdropUrl={movie.backdropUrl}
                        title={movie.title}
                        year={movie.releaseYear}
                        width={400}
                        alt={movie.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 4. TOP 10 SERIES SECTION */}
          {topSeries.length > 0 && (
            <div className="mt-6 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Top 10 Series
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {topSeries.slice(0, 10).map((movie, index) => (
                  <div
                    key={movie.id}
                    onClick={() => handleMovieClick(movie)}
                    className="flex-shrink-0 w-28 sm:w-32 cursor-pointer group relative"
                  >
                    <div className="relative aspect-[2/3] w-full bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800/90 shadow-md">
                      <PosterImage
                        posterUrl={movie.posterUrl || movie.backdropUrl}
                        backdropUrl={movie.backdropUrl}
                        title={movie.title}
                        year={movie.releaseYear}
                        width={400}
                        isSeries
                        alt={movie.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <span className="absolute top-1.5 right-1.5 bg-black/85 text-white font-black text-[11px] px-2 py-0.5 rounded border border-white/20">
                        #{index + 1}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5. DYNAMIC GENRE ROW: Comedy Movies */}
          {comedyMovies.length > 0 && (
            <div className="mt-6 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Comedy Movies
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {comedyMovies.slice(0, 25).map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <PosterImage
                        posterUrl={movie.posterUrl}
                        backdropUrl={movie.backdropUrl}
                        title={movie.title}
                        year={movie.releaseYear}
                        width={400}
                        alt={movie.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 6. DYNAMIC GENRE ROW: Romantic Movies */}
          {romanceMovies.length > 0 && (
            <div className="mt-6 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Romantic Movies
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {romanceMovies.slice(0, 25).map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <PosterImage
                        posterUrl={movie.posterUrl}
                        backdropUrl={movie.backdropUrl}
                        title={movie.title}
                        year={movie.releaseYear}
                        width={400}
                        alt={movie.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7. DYNAMIC GENRE ROW: Thriller & Horror Movies */}
          {thrillerHorrorMovies.length > 0 && (
            <div className="mt-6 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Thriller &amp; Horror Movies
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {thrillerHorrorMovies.slice(0, 25).map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <PosterImage
                        posterUrl={movie.posterUrl}
                        backdropUrl={movie.backdropUrl}
                        title={movie.title}
                        year={movie.releaseYear}
                        width={400}
                        alt={movie.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 8. DYNAMIC GENRE ROW: Drama Movies */}
          {dramaMovies.length > 0 && (
            <div className="mt-6 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Drama Movies
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {dramaMovies.slice(0, 25).map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <PosterImage
                        posterUrl={movie.posterUrl}
                        backdropUrl={movie.backdropUrl}
                        title={movie.title}
                        year={movie.releaseYear}
                        width={400}
                        alt={movie.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="h-12" />
        </div>
      )}

      {/* Movie & Series Details Page Matching Reference Screenshot */}
      {resolvedSelectedMovie && !playingMovie && (
        <MovieDetailsModal
          isOpen={Boolean(resolvedSelectedMovie)}
          movie={resolvedSelectedMovie}
          onClose={closeMovieDetails}
          onWatchNow={(m, sIdx, eIdx, lang) => handleWatchNow(m, sIdx, eIdx, lang)}
          allMovies={movies}
          userId={user?.uid || 'guest_user'}
          isSavedInMyList={Boolean(resolvedSelectedMovie && myListIds.has(resolvedSelectedMovie.id || resolvedSelectedMovie.imdbId))}
          onToggleMyList={(m) => toggleMyList({ stopPropagation: () => {} } as any, m)}
          onSelectMovie={(m) => {
            setActiveSeasonIndex(0);
            setActiveEpisodeIndex(0);
            selectedMovieRef.current = m;
            setSelectedMovie(m);
          }}
          initialSeasonIndex={activeSeasonIndex}
          initialEpisodeIndex={activeEpisodeIndex}
        />
      )}

      {/* In-App Video Player Modal */}
      {playingMovie && (
        <VideoPlayerModal
          isOpen={Boolean(playingMovie)}
          onClose={closePlayer}
          manageHistory={false}
          title={playingMovie.title}
          videoUrl={playingMovie.streamingUrl || ''}
          videoQualities={playingMovie.videoQualities}
          category={playingMovie.displayCategory}
          posterUrl={playingMovie.posterUrl}
          movie={resolvedPlayingParentMovie}
          seasonIndex={playingMovie.seasonIndex ?? 0}
          episodeIndex={playingMovie.episodeIndex ?? 0}
          language={playingMovie.language || playingMovie.movie?.language}
          initialDuration={playingMovie.initialDuration || playingMovie.duration || 0}
          initialTime={playingMovie.currentTime || 0}
          onEpisodeChange={(sIdx, eIdx) => {
            setActiveSeasonIndex(sIdx);
            setActiveEpisodeIndex(eIdx);
          }}
          onProgress={(curr, dur) => {
            const uid = user?.uid || 'guest_user';
            const m = playingMovie.movie || playingMovie;
            saveWatchProgress(uid, m, curr, dur).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
