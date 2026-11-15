import React, { useState, useEffect, useRef } from 'react';
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

import { getLocalMovies, saveLocalMovies, sortMoviesList } from '../services/movieStorage';
import { upgradePosterUrl, normalizeMoviePosters } from '../utils/posterUrl';
import { getVisibleQualityBadge } from '../utils/qualityBadge';

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
  const initialFeatured = initialLocal.filter((m: any) => m.featured);
  const [movies, setMovies] = useState<any[]>(initialLocal);
  const [featuredMovies, setFeaturedMovies] = useState<any[]>(initialFeatured.length > 0 ? initialFeatured : initialLocal);
  const [searchParams, setSearchParams] = useSearchParams();
  const category = searchParams.get('category');

  const setCategory = (cat: string | null) => {
    if (cat) {
      setSearchParams({ category: cat });
    } else {
      setSearchParams({});
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

  const isFolderSearchSupported =
    category === 'Bollywood' || category === 'Hollywood' || category === 'Series';

  const categoryRef = useRef(category);
  const selectedMovieRef = useRef(selectedMovie);
  const playingMovieRef = useRef(playingMovie);
  const isFolderSearchOpenRef = useRef(isFolderSearchOpen);

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

  // Hardware back button handler
  useEffect(() => {
    const handlePopState = () => {
      if (playingMovieRef.current) {
        setPlayingMovie(null);
        return;
      }
      if (selectedMovieRef.current) {
        setSelectedMovie(null);
        return;
      }
      if (isFolderSearchOpenRef.current) {
        setIsFolderSearchOpen(false);
        setFolderSearchQuery('');
        return;
      }
      if (categoryRef.current) {
        setCategory(null);
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
            setPlayingMovie(null);
            try { window.history.back(); } catch (e) {}
            return;
          }
          if (selectedMovieRef.current) {
            setSelectedMovie(null);
            try { window.history.back(); } catch (e) {}
            return;
          }
          if (isFolderSearchOpenRef.current) {
            setIsFolderSearchOpen(false);
            setFolderSearchQuery('');
            return;
          }
          if (categoryRef.current) {
            setCategory(null);
            try { window.history.back(); } catch (e) {}
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
      setMovies(list);
      const featuredOnly = list.filter((m) => m.featured);
      setFeaturedMovies(featuredOnly.length > 0 ? featuredOnly : list);
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
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

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

    if (Math.abs(diffX) > 8 && Math.abs(diffX) > Math.abs(diffY)) {
      isSwipingRef.current = true;
      setIsSwiping(true);
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
    setSelectedMovie(movie);
    try {
      window.history.pushState({ appModal: 'movie_detail' }, '');
    } catch (e) {}
  };

  const handleWatchNow = (
    movie: any,
    seasonIndex = 0,
    episodeIndex = 0,
    audioLanguage?: string
  ) => {
    try {
      window.history.pushState({ appModal: 'player' }, '');
    } catch (e) {}

    const uid = user?.uid || 'guest_user';
    const resumeTime = movie.currentTime || 0;
    saveWatchProgress(uid, movie, resumeTime, movie.duration || 100).catch(() => {});

    if (movie.seasons && movie.seasons.length > 0) {
      const sIdx = Math.max(0, Math.min(seasonIndex, movie.seasons.length - 1));
      const season = movie.seasons[sIdx];
      const episodes = season?.episodes || [];
      const eIdx = Math.max(0, Math.min(episodeIndex, episodes.length - 1));
      const ep = episodes[eIdx];

      if (ep && ep.streamUrl) {
        setPlayingMovie({
          title: `${movie.title} - S0${season.seasonNumber || sIdx + 1}E0${ep.episodeNumber || eIdx + 1}: ${ep.title}`,
          streamingUrl: ep.streamUrl.trim(),
          displayCategory: movie.displayCategory,
          posterUrl: movie.posterUrl,
          movie: movie,
          seasonIndex: sIdx,
          episodeIndex: eIdx,
          language: audioLanguage || movie.language,
          currentTime: resumeTime,
        });
        setSelectedMovie(null);
        return;
      }
    }

    if (movie.streamingUrl) {
      setPlayingMovie({
        ...movie,
        streamingUrl: movie.streamingUrl.trim(),
        language: audioLanguage || movie.language,
        currentTime: resumeTime,
      });
      setSelectedMovie(null);
    } else {
      setSelectedMovie(movie);
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

  // Check if movie was recently added (within last 14 days)
  const isRecentlyAdded = (movie: any) => {
    if (!movie.updatedAt) return false;
    try {
      const timeMs = movie.updatedAt?.toMillis ? movie.updatedAt.toMillis() : new Date(movie.updatedAt).getTime();
      const diffDays = (Date.now() - timeMs) / (1000 * 60 * 60 * 24);
      return diffDays <= 14;
    } catch (e) {
      return false;
    }
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
    <div className={`relative flex-1 w-full max-w-full bg-black text-white flex flex-col select-none touch-pan-y ${category ? 'pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-0' : 'pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-0'}`}>

      {toastMessage && (
        <div className="fixed top-[max(4.25rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[120] bg-neutral-900/95 border border-red-600/50 text-white text-xs font-bold px-4 py-2.5 rounded-full shadow-2xl backdrop-blur-md max-w-[90vw] truncate">
          {toastMessage}
        </div>
      )}

      {category ? (
        <div className="flex-grow pt-[max(4.75rem,calc(env(safe-area-inset-top)+4rem))] touch-pan-y">
          <div className="flex items-center justify-between gap-2 px-3 sm:px-4 mb-4">
            <h2 className="text-red-500 font-black text-lg sm:text-xl tracking-wide uppercase truncate">
              {category}
            </h2>
            <div className="flex items-center gap-1.5 bg-neutral-900/95 border border-red-600/40 px-3 py-1.5 rounded-xl shadow-md shrink-0">
              <Film size={13} className="text-red-500 shrink-0" />
              <span className="text-xs font-extrabold text-white tabular-nums whitespace-nowrap">
                {trimmedFolderQuery
                  ? `${filteredCategoryMovies.length} / ${categoryMovies.length} Uploaded`
                  : `Total Uploaded: ${categoryMovies.length} ${category === 'Series' ? 'Series' : 'Movies'}`}
              </span>
            </div>
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
                    {isRecentlyAdded(movie) && (
                      <span className="absolute bottom-2 left-2 z-10 bg-[#E50914] text-white font-bold text-[9px] px-2 py-0.5 rounded shadow tracking-tight">
                        Recently added
                      </span>
                    )}
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
          {/* Cinematic Hero Banner Matching First Screenshot */}
          <div
            className="relative w-full h-[62dvh] sm:h-[68dvh] flex flex-col justify-end overflow-hidden select-none touch-pan-y"
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
                  src={upgradePosterUrl(currentFeatured.posterUrl || currentFeatured.backdropUrl, 1200) || currentFeatured.posterUrl || currentFeatured.backdropUrl}
                  alt={currentFeatured.title}
                  draggable={false}
                  className="absolute inset-0 w-full h-full object-cover object-center"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/35 to-black/45" />
              </motion.div>
            </AnimatePresence>

            {/* Hero Banner Overlay Content (Title, Genre bullet tags, Play & My List Buttons) */}
            <div className="relative z-10 p-4 sm:p-6 text-center pb-6 flex flex-col items-center">
              <h1 className="text-2xl sm:text-4xl font-black tracking-tight uppercase text-white drop-shadow-xl mb-1.5 font-sans">
                {currentFeatured.title}
              </h1>

              {/* Tagline / Subtitle bullet tags */}
              <p className="text-xs sm:text-sm font-semibold text-gray-200 mb-4 drop-shadow flex items-center justify-center gap-1.5 flex-wrap">
                {String(currentFeatured.genre || currentFeatured.displayCategory || 'Movie')
                  .split(/[,/•|]+/)
                  .map((t, idx, arr) => (
                    <React.Fragment key={idx}>
                      <span>{t.trim()}</span>
                      {idx < arr.length - 1 && <span className="text-neutral-500">•</span>}
                    </React.Fragment>
                  ))}
              </p>

              {/* Action Buttons: Play + My List */}
              <div className="flex items-center gap-3 w-full max-w-xs justify-center">
                <button
                  type="button"
                  onClick={() => handleWatchNow(currentFeatured)}
                  className="flex-1 bg-white hover:bg-neutral-200 text-black font-black text-xs sm:text-sm py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-2xl transition-all active:scale-95 cursor-pointer uppercase tracking-wider"
                >
                  <Play size={16} fill="black" />
                  <span>Play</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => toggleMyList(e, currentFeatured)}
                  className="flex-1 bg-neutral-900/85 hover:bg-neutral-800 text-white border border-neutral-700/80 font-bold text-xs sm:text-sm py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-2xl transition-all active:scale-95 cursor-pointer uppercase tracking-wider backdrop-blur-sm"
                >
                  {myListIds.has(currentFeatured.id || currentFeatured.imdbId) ? (
                    <>
                      <Check size={16} className="text-red-500 stroke-[3]" />
                      <span>My List</span>
                    </>
                  ) : (
                    <>
                      <Plus size={16} />
                      <span>My List</span>
                    </>
                  )}
                </button>
              </div>

              {/* Slider Dots */}
              {featuredMovies.length > 1 && (
                <div className="flex items-center justify-center gap-1.5 mt-3.5">
                  {featuredMovies.slice(0, 6).map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSlideDirection(idx > activeSlideIndex ? 1 : -1);
                        setActiveSlideIndex(idx);
                      }}
                      className={`h-1.5 rounded-full transition-all cursor-pointer ${
                        idx === activeSlideIndex ? 'w-6 bg-red-600' : 'w-2 bg-white/30'
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 1. RECENTLY WATCHED SECTION (Exact Match with Reference Screenshot 2) */}
          {recentlyWatched.length > 0 && (
            <div className="mt-5 px-3 sm:px-6">
              <h3 className="text-base sm:text-lg font-bold text-white tracking-wide mb-3">
                Recently Watched
              </h3>
              <div className="flex items-center gap-3 overflow-x-auto pb-2 scrollbar-none touch-pan-x touch-pan-y">
                {recentlyWatched.map((item) => {
                  const movie = item.movieData || item;
                  return (
                    <div
                      key={item.movieId}
                      className="flex-shrink-0 w-32 sm:w-36 bg-neutral-900 rounded-xl overflow-hidden border border-neutral-800 flex flex-col shadow-lg"
                    >
                      {/* Poster Image with Circular Play Overlay & Red Progress Bar */}
                      <div
                        onClick={() => handleWatchNow(movie)}
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
                      {isRecentlyAdded(movie) && (
                        <span className="absolute bottom-2 left-2 bg-[#E50914] text-white font-bold text-[9px] px-2 py-0.5 rounded shadow tracking-tight">
                          Recently added
                        </span>
                      )}
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
                      {isRecentlyAdded(movie) && (
                        <span className="absolute bottom-2 left-2 bg-[#E50914] text-white font-bold text-[9px] px-2 py-0.5 rounded shadow tracking-tight">
                          Recently added
                        </span>
                      )}
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
                      {isRecentlyAdded(movie) && (
                        <span className="absolute bottom-2 left-2 bg-[#E50914] text-white font-bold text-[9px] px-2 py-0.5 rounded shadow tracking-tight">
                          Recently added
                        </span>
                      )}
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
                      {isRecentlyAdded(movie) && (
                        <span className="absolute bottom-2 left-2 bg-[#E50914] text-white font-bold text-[9px] px-2 py-0.5 rounded shadow tracking-tight">
                          Recently added
                        </span>
                      )}
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
                      {isRecentlyAdded(movie) && (
                        <span className="absolute bottom-2 left-2 bg-[#E50914] text-white font-bold text-[9px] px-2 py-0.5 rounded shadow tracking-tight">
                          Recently added
                        </span>
                      )}
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
                      {isRecentlyAdded(movie) && (
                        <span className="absolute bottom-2 left-2 bg-[#E50914] text-white font-bold text-[9px] px-2 py-0.5 rounded shadow tracking-tight">
                          Recently added
                        </span>
                      )}
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
                      {isRecentlyAdded(movie) && (
                        <span className="absolute bottom-2 left-2 bg-[#E50914] text-white font-bold text-[9px] px-2 py-0.5 rounded shadow tracking-tight">
                          Recently added
                        </span>
                      )}
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
      {selectedMovie && (
        <MovieDetailsModal
          isOpen={Boolean(selectedMovie)}
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
          onWatchNow={(m, sIdx, eIdx, lang) => handleWatchNow(m, sIdx, eIdx, lang)}
          allMovies={movies}
          userId={user?.uid || 'guest_user'}
          isSavedInMyList={Boolean(selectedMovie && myListIds.has(selectedMovie.id || selectedMovie.imdbId))}
          onToggleMyList={(m) => toggleMyList({ stopPropagation: () => {} } as any, m)}
          onSelectMovie={(m) => setSelectedMovie(m)}
        />
      )}

      {/* In-App Video Player Modal */}
      {playingMovie && (
        <VideoPlayerModal
          isOpen={Boolean(playingMovie)}
          onClose={() => setPlayingMovie(null)}
          title={playingMovie.title}
          videoUrl={playingMovie.streamingUrl || ''}
          videoQualities={playingMovie.videoQualities}
          category={playingMovie.displayCategory}
          posterUrl={playingMovie.posterUrl}
          movie={playingMovie.movie || (playingMovie.seasons ? playingMovie : undefined)}
          seasonIndex={playingMovie.seasonIndex ?? 0}
          episodeIndex={playingMovie.episodeIndex ?? 0}
          language={playingMovie.language || playingMovie.movie?.language}
          initialTime={playingMovie.currentTime || 0}
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
