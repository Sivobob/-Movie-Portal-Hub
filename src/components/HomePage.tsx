import React, { useState, useEffect, useRef, useMemo } from 'react';
import { collection, query, where, onSnapshot, getDocsFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import MovieCard from './MovieCard';
import { Search, Play, X, Film, Plus, Check, Info, Trash2 } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import VideoPlayerModal from './VideoPlayerModal';
import MovieDetailsModal from './MovieDetailsModal';
import { useAuth } from '../context/AuthContext';
import {
  fetchWatchHistory,
  WatchHistoryItem,
  removeWatchHistoryItem,
  addToMyList,
  removeFromMyList,
  fetchMyList,
  saveWatchProgress,
} from '../services/userWatchService';

import {
  getLocalMovies,
  saveLocalMovies,
  sortMoviesList,
  getNewEpisodesWithin24h,
  NEW_EPISODE_WINDOW_MS,
} from '../services/movieStorage';
import { upgradePosterUrl, normalizeMoviePosters } from '../utils/posterUrl';
import { getVisibleQualityBadge } from '../utils/qualityBadge';
import { parseDurationToSeconds } from '../utils/duration';
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
  const initialLocal = sortMoviesList(getLocalMovies().filter((m: any) => m.published !== false));
  const [rawMovies, setRawMovies] = useState<any[]>(initialLocal);
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

  const featuredMovies = useMemo(() => {
    const featuredOnly = movies.filter((m: any) => m.featured);
    return featuredOnly.length > 0 ? featuredOnly : movies;
  }, [movies]);

  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get('category');

  const setCategory = (cat: string | null, replace = false) => {
    if (cat) {
      setSearchParams({ category: cat }, { replace });
    } else {
      setSearchParams({}, { replace });
    }
  };

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [activeSeasonIndex, setActiveSeasonIndex] = useState(0);
  const [playingMovie, setPlayingMovie] = useState<any | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isFolderSearchOpen, setIsFolderSearchOpen] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const folderSearchInputRef = useRef<HTMLInputElement | null>(null);

  // Recently watched & My List state
  const [recentlyWatched, setRecentlyWatched] = useState<WatchHistoryItem[]>([]);
  const [myListIds, setMyListIds] = useState<Set<string>>(new Set());
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const isFolderSearchSupported =
    category === 'Bollywood' || category === 'Hollywood' || category === 'Series';

  const categoryRef = useRef(category);
  const selectedMovieRef = useRef(selectedMovie);
  const playingMovieRef = useRef(playingMovie);
  const isFolderSearchOpenRef = useRef(isFolderSearchOpen);
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
    isFolderSearchOpenRef.current = isFolderSearchOpen;
  }, [isFolderSearchOpen]);

  useEffect(() => {
    setIsFolderSearchOpen(false);
    setFolderSearchQuery('');
    try {
      window.scrollTo({ top: 0, behavior: 'auto' });
      document.getElementById('root')?.scrollTo({ top: 0, behavior: 'auto' });
    } catch {}
  }, [category]);

  useEffect(() => {
    if (isFolderSearchOpen) {
      const timer = setTimeout(() => {
        folderSearchInputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isFolderSearchOpen]);

  // Load user watch history and My List
  const loadUserHistory = () => {
    const uid = user?.uid || 'guest_user';
    fetchWatchHistory(uid).then((history) => setRecentlyWatched(history)).catch(() => {});
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
      if (isFolderSearchOpenRef.current) {
        isFolderSearchOpenRef.current = false;
        setIsFolderSearchOpen(false);
        setFolderSearchQuery('');
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
          if (isFolderSearchOpenRef.current) {
            isFolderSearchOpenRef.current = false;
            setIsFolderSearchOpen(false);
            setFolderSearchQuery('');
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

  // Load movies from Firestore
  useEffect(() => {
    let isMounted = true;
    const q = query(collection(db, 'movies'), where('published', '==', true));

    const applyMovieList = (rawDocs: any[], fromCache: boolean) => {
      if (!isMounted) return;
      const list = sortMoviesList(
        rawDocs.map((d) => normalizeMoviePosters({ id: d.id, ...d.data() })) as any[]
      );
      if (fromCache && list.length === 0 && getLocalMovies().length > 0) {
        return;
      }
      setIsLoading(false);
      setRawMovies(list);
      saveLocalMovies(list);
    };

    const syncFromServer = async () => {
      try {
        const snap = await getDocsFromServer(q);
        applyMovieList(snap.docs, false);
      } catch {}
    };

    const unsubscribe = onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snapshot) => {
        applyMovieList(snapshot.docs, snapshot.metadata.fromCache);
      },
      (err) => {
        console.error('Real-time sync error:', err);
        if (isMounted) setIsLoading(false);
      }
    );

    syncFromServer();

    const handleMoviesUpdated = () => {
      syncFromServer();
      const local = sortMoviesList(getLocalMovies().filter((m: any) => m.published !== false));
      if (local.length > 0) {
        applyMovieList(local.map((m: any) => ({ id: m.id, data: () => m })), true);
      }
    };
    window.addEventListener('movies_updated', handleMoviesUpdated);

    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel('movie_portal_updates');
        bc.onmessage = (event) => {
          if (event.data?.type === 'MOVIES_UPDATED' || event.data?.type === 'NEW_RELEASE') {
            handleMoviesUpdated();
          }
        };
      } catch {}
    }

    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      syncFromServer();
    };
    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      isMounted = false;
      unsubscribe();
      window.removeEventListener('movies_updated', handleMoviesUpdated);
      if (bc) {
        try { bc.close(); } catch {}
      }
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, []);

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

  useEffect(() => {
    setActiveSeasonIndex(0);
  }, [selectedMovie?.id]);

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
    const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
    touchStartPosRef.current = { x: clientX, y: clientY, time: Date.now() };
    isSwipingRef.current = false;
    setIsSwiping(false);
    handleInteractionStart();
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
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

  const categoryMovies = category
    ? movies.filter((m) => {
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
      })
    : [];

  const trimmedFolderQuery = folderSearchQuery.trim().toLowerCase();
  const filteredCategoryMovies =
    isFolderSearchSupported && trimmedFolderQuery
      ? categoryMovies.filter((m) => {
          const title = String(m.title || '').toLowerCase();
          const genre = String(m.genre || '').toLowerCase();
          return title.includes(trimmedFolderQuery) || genre.includes(trimmedFolderQuery);
        })
      : categoryMovies;

  const handleMovieClick = (movie: any) => {
    setActiveSeasonIndex(0);
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
      const sIdx = Math.max(0, Math.min(seasonIndex, movie.seasons.length - 1));
      const season = movie.seasons[sIdx];
      const episodes = season?.episodes || [];
      const eIdx = Math.max(0, Math.min(episodeIndex, episodes.length - 1));
      const ep = episodes[eIdx];

      if (ep && ep.streamUrl) {
        setActiveSeasonIndex(sIdx);
        const epDurationSec =
          (typeof ep.durationSec === 'number' && ep.durationSec > 0 ? ep.durationSec : 0) ||
          parseDurationToSeconds(ep.duration) ||
          movieDurationSec;
        if (epDurationSec > 0 || resumeTime > 0) {
          saveWatchProgress(uid, movie, resumeTime, epDurationSec).catch(() => {});
        }
        pushPlayerHistory();
        const nextPlaying = {
          title: `${movie.title} - S0${season.seasonNumber || sIdx + 1}E0${ep.episodeNumber || eIdx + 1}: ${ep.title}`,
          streamingUrl: ep.streamUrl.trim(),
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

    if (movie.streamingUrl) {
      if (movieDurationSec > 0 || resumeTime > 0) {
        saveWatchProgress(uid, movie, resumeTime, movieDurationSec).catch(() => {});
      }
      pushPlayerHistory();
      const nextPlaying = {
        ...movie,
        streamingUrl: movie.streamingUrl.trim(),
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

  const handleDeleteHistory = async (e: React.MouseEvent, movieId: string) => {
    e.stopPropagation();
    const uid = user?.uid || 'guest_user';
    await removeWatchHistoryItem(uid, movieId);
    setRecentlyWatched((prev) => prev.filter((item) => item.movieId !== movieId));
    showToast('Removed from Recently Watched');
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

  const formatEpisodeAge = (addedAtMs: number) => {
    const elapsedMs = Math.max(0, nowMs - addedAtMs);
    const elapsedMins = Math.floor(elapsedMs / 60_000);
    const remainingHrs = Math.max(1, Math.ceil((NEW_EPISODE_WINDOW_MS - elapsedMs) / 3_600_000));
    if (elapsedMins < 1) return 'Just added • 24h left';
    if (elapsedMins < 60) return `${elapsedMins}m ago • ${remainingHrs}h left`;
    const elapsedHrs = Math.floor(elapsedMins / 60);
    return `${elapsedHrs}h ago • ${remainingHrs}h left`;
  };

  // Dynamic Genre filtering helpers
  const getMoviesByGenre = (genreKeyword: string) => {
    return movies.filter((m) => {
      const g = String(m.genre || '').toLowerCase();
      const cat = String(m.displayCategory || '').toLowerCase();
      const orig = String(m.originalCategory || '').toLowerCase();
      return (
        g.includes(genreKeyword.toLowerCase()) ||
        cat.includes(genreKeyword.toLowerCase()) ||
        orig.includes(genreKeyword.toLowerCase())
      );
    });
  };

  const suspenseMovies = getMoviesByGenre('suspense');
  const actionMovies = getMoviesByGenre('action');
  const comedyMovies = getMoviesByGenre('comedy');
  const romanceMovies = getMoviesByGenre('romance');
  const thrillerMovies = getMoviesByGenre('thriller');
  const horrorMovies = getMoviesByGenre('horror');
  const dramaMovies = getMoviesByGenre('drama');

  const topSeries = movies.filter((m) => {
    return (
      m.displayCategory === 'Series' ||
      m.displayCategory === 'Anime' ||
      m.originalCategory === 'Anime Series' ||
      m.originalCategory === 'Web Series' ||
      m.contentType === 'anime'
    );
  });

  return (
    <div className={`relative flex-1 w-full max-w-full bg-black text-white flex flex-col select-none touch-pan-y pt-[calc(4.75rem+env(safe-area-inset-top))] pb-[calc(5.75rem+env(safe-area-inset-bottom))]`}>

      {toastMessage && (
        <div className="fixed top-[max(4.25rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[120] bg-neutral-900/95 border border-red-600/50 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-2xl backdrop-blur-md max-w-[90vw] truncate">
          {toastMessage}
        </div>
      )}

      {/* Top Category Tabs Bar: All, Bollywood, Hollywood, Series */}
      <div className="sticky top-[calc(4.25rem+env(safe-area-inset-top))] z-30 bg-black/95 backdrop-blur-md px-3 sm:px-6 py-2.5 border-b border-white/[0.08] shadow-md">
        <div className="flex items-center gap-3 overflow-x-auto scrollbar-none py-1">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-bold tracking-tight transition-all cursor-pointer whitespace-nowrap ${
              !category
                ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                : 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setCategory('Bollywood')}
            className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-bold tracking-tight transition-all cursor-pointer whitespace-nowrap ${
              category === 'Bollywood'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                : 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800'
            }`}
          >
            Bollywood
          </button>
          <button
            type="button"
            onClick={() => setCategory('Hollywood')}
            className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-bold tracking-tight transition-all cursor-pointer whitespace-nowrap ${
              category === 'Hollywood'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                : 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800'
            }`}
          >
            Hollywood
          </button>
          <button
            type="button"
            onClick={() => setCategory('Series')}
            className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-bold tracking-tight transition-all cursor-pointer whitespace-nowrap ${
              category === 'Series'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                : 'bg-neutral-900 text-neutral-400 hover:text-white border border-neutral-800'
            }`}
          >
            Series
          </button>
        </div>
      </div>

      {category ? (
        <div className="flex-grow pt-3 touch-pan-y">
          <div className="flex items-center justify-between gap-2 px-3 sm:px-4 mb-4">
            <h2 className="text-red-500 font-black text-lg sm:text-xl tracking-wide uppercase truncate">
              {category}
            </h2>
          </div>

          {/* Floating Bottom-Right Search Icon & Expandable Bar (ONLY for Bollywood, Hollywood, Series) */}
          {isFolderSearchSupported && !selectedMovie && !playingMovie && (
            !isFolderSearchOpen ? (
              <button
                type="button"
                onClick={() => setIsFolderSearchOpen(true)}
                className="fixed right-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 w-12 h-12 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-[0_6px_24px_rgba(229,9,20,0.55)] border border-white/20 flex items-center justify-center transition-transform active:scale-90 cursor-pointer"
                aria-label={`Search ${category}`}
                title={`Search ${category}`}
              >
                <Search size={21} className="stroke-[2.5]" />
              </button>
            ) : (
              <div className="fixed left-3 right-3 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-40 animate-in fade-in slide-in-from-bottom-2 duration-150">
                <div className="max-w-xl mx-auto flex items-center gap-2.5 bg-neutral-900/95 backdrop-blur-xl border border-red-600 rounded-2xl px-3.5 py-2.5 shadow-2xl shadow-black/80">
                  <Search size={18} className="text-red-500 shrink-0" />
                  <input
                    ref={folderSearchInputRef}
                    type="text"
                    value={folderSearchQuery}
                    onChange={(e) => setFolderSearchQuery(e.target.value)}
                    placeholder={`Search in ${category}...`}
                    className="bg-transparent flex-grow min-w-0 text-sm text-white placeholder-gray-400 outline-none"
                  />
                  {folderSearchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setFolderSearchQuery('');
                        folderSearchInputRef.current?.focus();
                      }}
                      className="min-w-[34px] min-h-[34px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
                      aria-label="Clear search"
                    >
                      <X size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setIsFolderSearchOpen(false);
                      setFolderSearchQuery('');
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-red-400 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    Close
                  </button>
                </div>
              </div>
            )
          )}

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
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3 px-2 sm:px-4">
              {filteredCategoryMovies.map((movie) => {
                return (
                  <div key={movie.id} className="relative group">
                    <MovieCard movie={movie} onClick={() => handleMovieClick(movie)} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : !currentFeatured ? (
        <div className="relative flex-1 min-h-0 flex flex-col items-center justify-center p-6 text-center">
          <Film size={44} className="text-neutral-700 mb-3" />
          <h2 className="text-2xl font-black text-red-500 uppercase tracking-wider mb-2">NO CONTENT FOUND</h2>
          <p className="text-xs text-gray-500 max-w-sm">Please upload movies or series in the Admin panel.</p>
        </div>
      ) : (
        <div className="flex flex-col w-full">
          {/* Cinematic Hero Banner Matching Reference Screenshot */}
          <div
            className="relative w-full h-[28dvh] sm:h-[36dvh] flex flex-col justify-end overflow-hidden select-none touch-pan-y"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onMouseDown={handleTouchStart}
            onMouseMove={handleTouchMove}
            onMouseUp={handleTouchEnd}
          >
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
                <img
                  src={upgradePosterUrl(currentFeatured.backdropUrl || currentFeatured.posterUrl, 1600) || currentFeatured.backdropUrl || currentFeatured.posterUrl}
                  alt={currentFeatured.title}
                  draggable={false}
                  className="absolute inset-0 w-full h-full object-cover object-center brightness-105 contrast-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-transparent" />
              </motion.div>
            </AnimatePresence>

            {/* Hero Banner Overlay Title & Clean Right Layout */}
            <div className="relative z-10 p-3 sm:p-5 flex items-end justify-between">
              <div className="max-w-[70%]">
                <span className="bg-red-600 text-white font-extrabold text-[9px] px-2 py-0.5 rounded uppercase tracking-wider mb-1 inline-block">
                  Featured
                </span>
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
              onClick={() => handleWatchNow(currentFeatured)}
              className="bg-neutral-900/95 hover:bg-neutral-900 border border-neutral-800 hover:border-red-600/50 rounded-2xl p-2.5 sm:p-3 flex items-center justify-between gap-3 shadow-xl cursor-pointer group transition-all"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-14 sm:w-14 sm:h-16 rounded-xl overflow-hidden bg-neutral-950 flex-shrink-0 border border-white/10 shadow">
                  <img
                    src={upgradePosterUrl(currentFeatured.posterUrl || currentFeatured.backdropUrl, 300) || currentFeatured.posterUrl}
                    alt={currentFeatured.title}
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
                    <span>{currentFeatured.year || '2026'}</span>
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

          {/* NEW EPISODES (Last 24 Hours Only) */}
          {newEpisodes24h.length > 0 && (
            <div className="mt-5 px-3 sm:px-6">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-1.5 h-5 bg-[#E50914] rounded-full flex-shrink-0" />
                  <h3 className="text-base sm:text-lg font-bold text-white tracking-wide truncate">
                    New Episodes
                  </h3>
                </div>
                <span className="text-[11px] font-bold text-red-400 whitespace-nowrap flex-shrink-0">
                  {newEpisodes24h.length} • 24h Only
                </span>
              </div>
              <div className="flex items-stretch gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {newEpisodes24h.map((item) => {
                  const epCode = `S${String(item.seasonNumber).padStart(2, '0')} • E${String(item.episodeNumber).padStart(2, '0')}`;
                  return (
                    <div
                      key={item.key}
                      onClick={() => handleWatchNow(item.movie, item.seasonIndex, item.episodeIndex)}
                      className="flex-shrink-0 w-36 sm:w-44 bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 hover:border-red-600/60 flex flex-col shadow-lg cursor-pointer group transition-colors"
                    >
                      <div className="relative aspect-[3/4] w-full bg-neutral-950 overflow-hidden">
                        <img
                          src={upgradePosterUrl(item.movie.posterUrl || item.movie.backdropUrl, 400) || item.movie.posterUrl}
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
                        <div className="absolute bottom-2 left-2 right-2 text-left">
                          <p className="text-xs font-extrabold text-white truncate drop-shadow">
                            {item.movie.title}
                          </p>
                          <p className="text-[11px] font-semibold text-red-400 truncate drop-shadow">
                            {item.episodeTitle}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-1.5 px-2.5 py-2 bg-neutral-900 border-t border-neutral-800/80">
                        <span className="text-[10px] font-semibold text-gray-400 truncate">
                          {formatEpisodeAge(item.addedAtMs)}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMovieClick(item.movie);
                          }}
                          className="w-6 h-6 rounded-full bg-neutral-800 text-gray-300 hover:text-white flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer"
                          title="Series Details"
                          aria-label="Series Details"
                        >
                          <Info size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 1. RECENTLY WATCHED SECTION (Exact Match with Reference Screenshot 2) */}
          {recentlyWatched.length > 0 && (
            <div className="mt-5 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Recently Watched
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {recentlyWatched.map((item) => {
                  const liveMovie = movies.find(
                    (m) => m.id === item.movieId || (m.imdbId && m.imdbId === item.movieId)
                  );
                  const movie = liveMovie
                    ? { ...liveMovie, currentTime: item.currentTime || 0 }
                    : (item.movieData || item);
                  return (
                    <div
                      key={item.movieId}
                      className="flex-shrink-0 w-32 sm:w-36 bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 flex flex-col shadow-lg"
                    >
                      {/* Poster Image with Circular Play Overlay & Red Progress Bar */}
                      <div
                        onClick={() => handleMovieClick(movie)}
                        className="relative aspect-[3/4] w-full bg-neutral-950 overflow-hidden cursor-pointer group"
                      >
                        <img
                          src={upgradePosterUrl(item.posterUrl, 400) || item.posterUrl}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/35 group-hover:bg-black/15 transition-colors">
                          <div className="w-10 h-10 rounded-full bg-white/30 backdrop-blur-sm border border-white/40 text-white flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                            <Play size={16} fill="white" className="ml-0.5" />
                          </div>
                        </div>
                        {/* Red Progress Bar at Bottom of Poster */}
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-neutral-950">
                          <div
                            className="h-full bg-red-600"
                            style={{ width: `${Math.min(100, Math.max(8, item.progress || 0))}%` }}
                          />
                        </div>
                      </div>

                      {/* Bottom Controls Bar: (i) Info Button + Trash Can Button */}
                      <div className="flex items-center justify-around py-2 px-1 bg-neutral-900 border-t border-neutral-800/80">
                        <button
                          type="button"
                          onClick={() => handleMovieClick(movie)}
                          className="w-7 h-7 rounded-full bg-neutral-800 text-gray-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
                          title="Details"
                        >
                          <Info size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleDeleteHistory(e, item.movieId)}
                          className="w-7 h-7 rounded-full bg-neutral-800 text-gray-400 hover:text-red-400 flex items-center justify-center transition-colors cursor-pointer"
                          title="Remove from Recently Watched"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
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
                {suspenseMovies.map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <img
                        src={upgradePosterUrl(movie.posterUrl, 400) || movie.posterUrl}
                        alt={movie.title}
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
                Blockbuster Action & Adventure Movies
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {actionMovies.map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <img
                        src={upgradePosterUrl(movie.posterUrl, 400) || movie.posterUrl}
                        alt={movie.title}
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
                    className="flex-shrink-0 w-28 sm:w-32 bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800/90 cursor-pointer group relative shadow-md"
                  >
                    <div className="relative aspect-[2/3] w-full bg-neutral-950 overflow-hidden">
                      <img
                        src={upgradePosterUrl(movie.posterUrl || movie.backdropUrl, 400) || movie.posterUrl}
                        alt={movie.title}
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
                {comedyMovies.map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <img src={upgradePosterUrl(movie.posterUrl, 400) || movie.posterUrl} alt={movie.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
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
                {romanceMovies.map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <img src={upgradePosterUrl(movie.posterUrl, 400) || movie.posterUrl} alt={movie.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 7. DYNAMIC GENRE ROW: Thriller & Horror Movies */}
          {(thrillerMovies.length > 0 || horrorMovies.length > 0) && (
            <div className="mt-6 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Thriller & Horror Movies
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {[...thrillerMovies, ...horrorMovies].map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <img src={upgradePosterUrl(movie.posterUrl, 400) || movie.posterUrl} alt={movie.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
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
                {dramaMovies.map((movie) => (
                  <div key={movie.id} onClick={() => handleMovieClick(movie)} className="flex-shrink-0 w-28 sm:w-32 relative group cursor-pointer">
                    <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-neutral-950 border border-neutral-800/90 shadow-md">
                      <img src={upgradePosterUrl(movie.posterUrl, 400) || movie.posterUrl} alt={movie.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
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
            selectedMovieRef.current = m;
            setSelectedMovie(m);
          }}
          initialSeasonIndex={activeSeasonIndex}
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
          onEpisodeChange={(sIdx) => setActiveSeasonIndex(sIdx)}
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
