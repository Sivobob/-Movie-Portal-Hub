import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import MovieCard from './MovieCard';
import { Search, Play, X, Star, Calendar, Globe, Film, ShieldCheck, LogIn, LogOut, Smartphone, ChevronLeft, ChevronRight } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import VideoPlayerModal from './VideoPlayerModal';
import { useAuth, isAuthorizedAdminEmail } from '../context/AuthContext';
import { loginWithGoogle } from '../services/authService';

import { fetchMoviesFromFirestore, getLocalMovies, saveLocalMovies } from '../services/movieStorage';
import { isNativeAndroid, isInstalledPhoneApp, downloadOfficialApk } from '../utils/platform';
import AndroidBottomNav from './AndroidBottomNav';
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
  const isAndroid = isNativeAndroid();
  const { user, isAdmin, handleLogout, signInWithEmail } = useAuth();
  const [movies, setMovies] = useState<any[]>(getLocalMovies());
  const [featuredMovies, setFeaturedMovies] = useState<any[]>(getLocalMovies());
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
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [isFolderSearchOpen, setIsFolderSearchOpen] = useState(false);
  const [folderSearchQuery, setFolderSearchQuery] = useState('');
  const folderSearchInputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  const isMasterAdmin = Boolean(user && isAuthorizedAdminEmail(user.email) && isAdmin);
  const isFolderSearchSupported =
    category === 'Bollywood' || category === 'Hollywood' || category === 'Series';

  // Synchronized refs to allow hardware back button to read real-time state without stale closures
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

  // Reset folder search whenever switching between folders or returning home
  useEffect(() => {
    setIsFolderSearchOpen(false);
    setFolderSearchQuery('');
  }, [category]);

  // Focus folder search input when opened
  useEffect(() => {
    if (isFolderSearchOpen) {
      const timer = setTimeout(() => {
        folderSearchInputRef.current?.focus();
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isFolderSearchOpen]);

  // Method to open category folder and record in history for hardware back navigation
  const openCategory = (cat: string) => {
    setCategory(cat);
  };

  // Hardware and system phone back button handler (Android APK & mobile Chrome)
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
      }).catch((err) => {
        console.warn('Capacitor App plugin listener setup:', err);
      });
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (backListener && typeof backListener.remove === 'function') {
        backListener.remove();
      }
    };
  }, []);

  // Request system notification permission on app launch
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    }
  }, []);

  // Load and sync published movies in real-time
  useEffect(() => {
    let isMounted = true;
    const q = query(collection(db, 'movies'), where('published', '==', true));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!isMounted) return;
        const list = snapshot.docs.map((d) => normalizeMoviePosters({ id: d.id, ...d.data() })) as any[];
        console.log(`[Sync] Real-time update: Received ${list.length} published movies`);
        
        setIsLoading(false);
        setMovies(list);
        setFeaturedMovies(list.filter(m => m.featured));
        saveLocalMovies(list);
      },
      (err) => {
        console.error('Real-time sync error:', err);
        if (isMounted) setIsLoading(false);
      }
    );
    
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);



  // Slider Animation, Swipe & Auto-slide State (3s auto-slide, instant manual slide)
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
    }, 3000); // Resume auto-sliding after 3s idle
  };

  // Automatic slider timer: exactly 3 seconds, instantly resets on user interaction
  useEffect(() => {
    if (category !== null) return; // Only run on main homepage
    if (featuredMovies.length <= 1) return;
    if (isUserInteracting) return;

    const interval = setInterval(() => {
      setSlideDirection(1);
      setActiveSlideIndex((prev) => (prev + 1) % featuredMovies.length);
    }, 3000);

    return () => clearInterval(interval);
  }, [category, featuredMovies.length, isUserInteracting, activeSlideIndex]);

  // Preload adjacent slide images for zero latency when sliding
  useEffect(() => {
    if (featuredMovies.length <= 1) return;
    const nextItem = featuredMovies[(activeSlideIndex + 1) % featuredMovies.length];
    const prevItem = featuredMovies[(activeSlideIndex - 1 + featuredMovies.length) % featuredMovies.length];
    [nextItem, prevItem].forEach((item) => {
      if (item) {
        const url = upgradePosterUrl(item.posterUrl || item.backdropUrl, 1200) || item.posterUrl || item.backdropUrl;
        if (url) {
          const img = new Image();
          img.src = url;
        }
      }
    });
  }, [activeSlideIndex, featuredMovies]);

  // Instant Manual Swipe / Navigation Handler
  const handleManualSwipe = (direction: 'left' | 'right') => {
    if (featuredMovies.length <= 1) return;
    handleInteractionStart();
    if (direction === 'left') {
      // Swiped left = next slide (entering from right)
      setSlideDirection(1);
      setActiveSlideIndex((prev) => (prev + 1) % featuredMovies.length);
    } else {
      // Swiped right = previous slide (entering from left)
      setSlideDirection(-1);
      setActiveSlideIndex((prev) => (prev - 1 + featuredMovies.length) % featuredMovies.length);
    }
    handleInteractionEnd();
  };

  // Responsive Touch / Mouse Swipe Event Handlers
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
        'changedTouches' in e
          ? e.changedTouches[0].clientX
          : (e as React.MouseEvent).clientX;
      const clientY =
        'changedTouches' in e
          ? e.changedTouches[0].clientY
          : (e as React.MouseEvent).clientY;
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
          handleManualSwipe('left'); // Next
        } else {
          handleManualSwipe('right'); // Prev
        }
      }
    }
    touchStartPosRef.current = null;
    handleInteractionEnd();

    // Reset isSwiping after slight delay to prevent tap-to-play from firing on swipe release
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
        if (category === 'Series') {
          return (
            m.displayCategory === 'Series' ||
            m.displayCategory === 'Anime' ||
            m.originalCategory === 'Anime Series' ||
            m.originalCategory === 'Anime Movie' ||
            m.originalCategory === 'Web Series' ||
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
          const originalTitle = String(m.originalTitle || '').toLowerCase();
          const genre = String(m.genre || '').toLowerCase();
          const year = String(m.releaseYear || '').toLowerCase();
          const language = String(m.language || '').toLowerCase();
          return (
            title.includes(trimmedFolderQuery) ||
            originalTitle.includes(trimmedFolderQuery) ||
            genre.includes(trimmedFolderQuery) ||
            year.includes(trimmedFolderQuery) ||
            language.includes(trimmedFolderQuery)
          );
        })
      : categoryMovies;

  const handleMovieClick = (movie: any) => {
    setSelectedMovie(movie);
    try {
      window.history.pushState({ appModal: 'movie_detail' }, '');
    } catch (e) {}
  };

  const handleWatchNow = (movie: any) => {
    try {
      window.history.pushState({ appModal: 'player' }, '');
    } catch (e) {}

    if (movie.seasons && movie.seasons.length > 0 && movie.seasons[0].episodes?.length > 0 && movie.seasons[0].episodes[0].streamUrl) {
      const ep = movie.seasons[0].episodes[0];
      setPlayingMovie({
        title: `${movie.title} - S01E01: ${ep.title}`,
        streamingUrl: ep.streamUrl.trim(),
        displayCategory: movie.displayCategory,
        posterUrl: movie.posterUrl,
        movie: movie,
        seasonIndex: 0,
        episodeIndex: 0,
      });
    } else if (movie.streamingUrl) {
      setPlayingMovie({
        ...movie,
        streamingUrl: movie.streamingUrl.trim(),
      });
    } else if (movie.trailerUrl) {
      setPlayingMovie({
        ...movie,
        title: `${movie.title} (Official Trailer)`,
        streamingUrl: movie.trailerUrl.trim(),
      });
    } else {
      setSelectedMovie(movie);
    }
  };



  const handleDownloadAPK = (e: React.MouseEvent) => {
    e.preventDefault();
    downloadOfficialApk();
  };

  return (
    <div className={`h-full min-h-full w-full bg-black text-white flex flex-col relative pt-0 select-none overflow-x-hidden ${category ? 'pb-28' : 'pb-0 overflow-y-hidden'}`}>


      {/* Category Grid View OR Cinematic Main Homepage */}
      {category ? (
        <div className="flex-grow pt-4">
          <div className="flex items-center justify-between px-4 mb-3">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-yellow-400 font-bold text-lg tracking-wide uppercase">{category}</h2>
              <span className="text-xs text-gray-400 tabular-nums">
                {trimmedFolderQuery
                  ? `${filteredCategoryMovies.length} of ${categoryMovies.length}`
                  : `${categoryMovies.length} ${category === 'Series' ? 'titles' : 'movies'}`}
              </span>
            </div>
          </div>

          {/* Folder-Scoped Search Bar (Only inside Bollywood, Hollywood, Series folders) */}
          {isFolderSearchSupported && isFolderSearchOpen && (
            <div className="px-3 sm:px-4 mb-4">
              <div className="flex items-center gap-2.5 bg-neutral-900 border border-yellow-400/60 focus-within:border-yellow-400 rounded-2xl px-3.5 py-2.5 shadow-lg shadow-black/40">
                <Search size={18} className="text-yellow-400 shrink-0" />
                <input
                  ref={folderSearchInputRef}
                  type="text"
                  value={folderSearchQuery}
                  onChange={(e) => setFolderSearchQuery(e.target.value)}
                  placeholder={`Search in ${category}...`}
                  aria-label={`Search in ${category}`}
                  className="bg-transparent flex-grow min-w-0 text-sm text-white placeholder-gray-400 outline-none"
                />
                {folderSearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setFolderSearchQuery('');
                      folderSearchInputRef.current?.focus();
                    }}
                    className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-neutral-800 transition-colors cursor-pointer"
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
                  className="px-2.5 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-bold text-yellow-400 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  Close
                </button>
              </div>
              {trimmedFolderQuery && (
                <p className="mt-2 px-1 text-xs text-gray-400 tabular-nums">
                  {filteredCategoryMovies.length} {filteredCategoryMovies.length === 1 ? 'result' : 'results'} in {category}
                </p>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="py-24 text-center">
              <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-gray-400 uppercase tracking-widest font-semibold">Loading {category}...</p>
            </div>
          ) : categoryMovies.length === 0 ? (
            <div className="py-24 px-4 text-center">
              <Film className="mx-auto mb-3 text-neutral-700" size={44} />
              <h3 className="text-2xl font-black text-yellow-400 tracking-wider uppercase mb-2">
                {category === 'Series' ? 'NO SERIES FOUND' : 'NO MOVIES FOUND'}
              </h3>
              <p className="text-xs text-gray-500 max-w-xs mx-auto">
                No {category === 'Series' ? 'series' : `${category.toLowerCase()} movies`} have been uploaded yet.
              </p>
            </div>
          ) : filteredCategoryMovies.length === 0 ? (
            <div className="py-20 px-4 text-center">
              <Search className="mx-auto mb-3 text-yellow-400/50" size={40} />
              <h3 className="text-xl font-black text-yellow-400 tracking-wide uppercase mb-2">
                No {category === 'Series' ? 'Series' : `${category} Movies`} Match
              </h3>
              <p className="text-xs text-gray-400 max-w-xs mx-auto mb-5">
                Nothing in {category} matched &ldquo;{folderSearchQuery.trim()}&rdquo;.
              </p>
              <button
                type="button"
                onClick={() => {
                  setFolderSearchQuery('');
                  folderSearchInputRef.current?.focus();
                }}
                className="px-4 py-2 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold text-xs uppercase tracking-wider cursor-pointer active:scale-95 transition-all"
              >
                Clear Search
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3 px-2 sm:px-4">
              {filteredCategoryMovies.map((movie) => (
                <MovieCard 
                  key={movie.id} 
                  movie={movie} 
                  onClick={() => handleMovieClick(movie)} 
                />
              ))}
            </div>
          )}
          </div>
      ) : !currentFeatured ? (
        <div className="relative flex-grow min-h-[calc(100vh-64px)] flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-yellow-400 mb-4 shadow-2xl">
            <Film size={32} />
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-yellow-400 tracking-wider uppercase mb-2">
            NO MOVIE FOUND
          </h2>
          <p className="text-xs text-gray-500 max-w-sm leading-relaxed mb-6">
            No movies or series have been uploaded yet. Please check back later.
          </p>
        </div>
      ) : (
        /* Cinematic Main Homepage Slider - Fixed Full Screen height */
        <div 
          className="relative flex-grow h-screen flex flex-col justify-end overflow-hidden pb-12 touch-none cursor-pointer select-none"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onMouseDown={handleTouchStart}
          onMouseMove={handleTouchMove}
          onMouseUp={handleTouchEnd}
          onClick={() => {
            if (!isSwiping && !isSwipingRef.current && currentFeatured) {
              handleMovieClick(currentFeatured);
            }
          }}
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
              className="absolute inset-0 will-change-transform"
            >
              <img
                src={upgradePosterUrl(currentFeatured.posterUrl || currentFeatured.backdropUrl, 1200) || currentFeatured.posterUrl || currentFeatured.backdropUrl || 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=1200'}
                alt={currentFeatured.title || 'Featured'}
                decoding="async"
                fetchPriority="high"
                className="absolute inset-0 w-full h-full object-cover object-center pointer-events-none select-none"
                onError={(e: any) => {
                  const img = e.currentTarget;
                  const raw = currentFeatured.posterUrl || currentFeatured.backdropUrl;
                  if (raw && img.src !== raw && !img.dataset.triedRaw) {
                    img.dataset.triedRaw = '1';
                    img.src = raw;
                    return;
                  }
                  img.src = 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=1200';
                }}
              />
              {/* Cinematic Vignette Overlay - Lighter at the top to show poster behind logo */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent pointer-events-none" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent pointer-events-none" />
            </motion.div>
          </AnimatePresence>

          {/* Quick Manual Navigation Arrows (Desktop / Tablet) */}
          {featuredMovies.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleManualSwipe('right');
                }}
                aria-label="Previous Slide"
                className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-black/40 hover:bg-black/75 text-white/80 hover:text-yellow-400 border border-white/10 hover:border-yellow-400/50 backdrop-blur-md items-center justify-center transition-all cursor-pointer active:scale-90"
              >
                <ChevronLeft size={24} />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleManualSwipe('left');
                }}
                aria-label="Next Slide"
                className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-black/40 hover:bg-black/75 text-white/80 hover:text-yellow-400 border border-white/10 hover:border-yellow-400/50 backdrop-blur-md items-center justify-center transition-all cursor-pointer active:scale-90"
              >
                <ChevronRight size={24} />
              </button>
            </>
          )}

          {/* Slider Pagination Dots (Center Aligned Bottom) */}
          {featuredMovies.length > 1 && (
            <div 
              className="relative z-10 flex justify-center gap-2 mt-8 pb-4"
              onClick={(e) => e.stopPropagation()}
            >
              {featuredMovies.map((_, idx) => (
                <button
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (idx === activeSlideIndex) return;
                    setSlideDirection(idx > activeSlideIndex ? 1 : -1);
                    setActiveSlideIndex(idx);
                    handleInteractionStart();
                    handleInteractionEnd();
                  }}
                  className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                    idx === activeSlideIndex ? 'w-10 bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)]' : 'w-3 bg-white/20 hover:bg-white/40'
                  }`}
                  aria-label={`Go to slide ${idx + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Movie Details Modal — Exact Poster Popup UI Redesign */}
      {selectedMovie && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-200"
          onClick={() => setSelectedMovie(null)}
        >
          <div
            className="bg-neutral-900 rounded-[28px] max-w-[340px] sm:max-w-[360px] w-full overflow-hidden shadow-2xl relative my-auto border border-neutral-800/60"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top Close Button (Dismiss Modal) */}
            <button
              onClick={() => setSelectedMovie(null)}
              className="absolute top-3.5 right-3.5 z-30 bg-black/80 hover:bg-black text-white p-2 rounded-full backdrop-blur-md border border-white/20 shadow-lg cursor-pointer transition-transform hover:scale-110"
              aria-label="Close"
            >
              <X size={18} />
            </button>

            {/* Poster Section (Click to Play) */}
            <div 
              onClick={() => {
                handleWatchNow(selectedMovie);
                setSelectedMovie(null);
              }}
              className="relative w-full aspect-[3/4] bg-neutral-950 overflow-hidden cursor-pointer group"
            >
              <img
                src={upgradePosterUrl(selectedMovie.posterUrl || selectedMovie.backdropUrl, 1080) || selectedMovie.posterUrl || selectedMovie.backdropUrl || undefined}
                alt={selectedMovie.title}
                decoding="async"
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                onError={(e: any) => {
                  const img = e.currentTarget;
                  const raw = selectedMovie.posterUrl || selectedMovie.backdropUrl;
                  if (raw && img.src !== raw && !img.dataset.triedRaw) {
                    img.dataset.triedRaw = '1';
                    img.src = raw;
                    return;
                  }
                  img.src = 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=800';
                }}
              />

              {/* Quality Badge (Admin-controlled: HD, HDTC, or hidden) */}
              {getVisibleQualityBadge(selectedMovie) && (
                <div className="absolute top-3.5 left-3.5 z-10">
                  <span className="bg-black/90 text-[#facc15] font-black text-xs sm:text-sm px-2.5 py-1 rounded-md border border-amber-400/30 shadow-md tracking-wider uppercase">
                    {getVisibleQualityBadge(selectedMovie)}
                  </span>
                </div>
              )}

              {/* Bottom-Right Play Overlay */}
              <div className="absolute bottom-4 right-4 z-20">
                 <div className="w-16 h-16 rounded-full bg-yellow-400 flex items-center justify-center shadow-2xl scale-90 group-hover:scale-100 transition-transform">
                    <Play size={24} fill="black" className="ml-1" />
                 </div>
              </div>
            </div>

            {/* Movie Info Section */}
            <div className="bg-white text-black p-6 pt-5 pb-8 rounded-b-[28px]">
              <h3 className="text-xl sm:text-2xl font-black text-gray-900 text-center tracking-tight leading-snug mb-2 font-sans uppercase">
                {selectedMovie.title}
              </h3>

              <p className="text-xs sm:text-sm font-semibold text-gray-500 text-center leading-normal mb-4">
                {selectedMovie.genre || selectedMovie.displayCategory || 'Movie'}
              </p>

              {selectedMovie.description ? (
                <div className="text-xs text-gray-600 text-center leading-relaxed max-h-32 overflow-y-auto px-2 mb-4 scrollbar-thin">
                  {selectedMovie.description}
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center italic mb-4">No description available for this title.</p>
              )}

              <div className="flex flex-col items-center gap-1">
                <div className="h-0.5 w-12 bg-yellow-400 mb-2 rounded-full opacity-50" />
                <p className="text-[9px] font-black text-yellow-600 uppercase tracking-[0.2em] animate-pulse">Tap Poster to Watch</p>
              </div>
            </div>


              {/* Preserved Series Season & Episode Selection */}
              {selectedMovie.seasons && selectedMovie.seasons.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200 space-y-3">
                  {/* Season Selector Tabs */}
                  <div className="flex items-center justify-center gap-1.5 overflow-x-auto pb-1">
                    {selectedMovie.seasons.map((season: any, sIdx: number) => (
                      <button
                        key={sIdx}
                        onClick={() => setActiveSeasonIndex(sIdx)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                          activeSeasonIndex === sIdx
                            ? 'bg-black text-white shadow'
                            : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                      >
                        Season {season.seasonNumber}
                      </button>
                    ))}
                  </div>

                  {/* Episodes List */}
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {selectedMovie.seasons[activeSeasonIndex]?.episodes?.map((ep: any, eIdx: number) => (
                      <div
                        key={eIdx}
                        className="flex items-center gap-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 p-2 rounded-lg transition-colors group"
                      >
                        <div 
                          onClick={() => {
                            if (!ep.streamUrl) {
                              alert('Streaming link for this episode is not available yet.');
                              return;
                            }
                            setPlayingMovie({
                              title: `${selectedMovie.title} - S0${selectedMovie.seasons[activeSeasonIndex].seasonNumber}E0${ep.episodeNumber}: ${ep.title}`,
                              streamingUrl: ep.streamUrl,
                              displayCategory: selectedMovie.displayCategory,
                              posterUrl: selectedMovie.posterUrl,
                              movie: selectedMovie,
                              seasonIndex: activeSeasonIndex,
                              episodeIndex: eIdx,
                            });
                            setSelectedMovie(null);
                          }}
                          className="flex items-center gap-2 flex-grow min-w-0 cursor-pointer"
                        >
                          <div className="w-6 h-6 rounded bg-black text-yellow-400 flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                            {ep.episodeNumber}
                          </div>
                          <div className="flex-grow min-w-0 text-left">
                            <h4 className="text-xs font-bold text-gray-900 truncate">{ep.title}</h4>
                          </div>
                        </div>



                        <div 
                          onClick={() => {
                            if (!ep.streamUrl) {
                              alert('Streaming link for this episode is not available yet.');
                              return;
                            }
                            setPlayingMovie({
                              title: `${selectedMovie.title} - S0${selectedMovie.seasons[activeSeasonIndex].seasonNumber}E0${ep.episodeNumber}: ${ep.title}`,
                              streamingUrl: ep.streamUrl,
                              displayCategory: selectedMovie.displayCategory,
                              posterUrl: selectedMovie.posterUrl,
                              movie: selectedMovie,
                              seasonIndex: activeSeasonIndex,
                              episodeIndex: eIdx,
                            });
                            setSelectedMovie(null);
                          }}
                          className="w-6 h-6 rounded-full bg-[#facc15] border border-black flex items-center justify-center flex-shrink-0 cursor-pointer"
                        >
                          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 ml-0.5">
                            <path d="M6 4l15 8-15 8V4z" fill="#00e676" stroke="#000000" strokeWidth="2" />
                          </svg>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </div>
        </div>
      )}

      {/* In-App Video Player Modal (Direct MP4, HLS, & Telegram Streams) */}
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
          onEpisodeChange={(sIdx, eIdx) => {
            const m = playingMovie.movie || playingMovie;
            if (m?.seasons && m.seasons[sIdx]?.episodes?.[eIdx]) {
              const ep = m.seasons[sIdx].episodes[eIdx];
              setPlayingMovie({
                title: `${m.title} - S0${m.seasons[sIdx].seasonNumber}E0${ep.episodeNumber}: ${ep.title}`,
                streamingUrl: ep.streamUrl,
                displayCategory: m.displayCategory,
                posterUrl: m.posterUrl,
                movie: m,
                seasonIndex: sIdx,
                episodeIndex: eIdx,
              });
            }
          }}
          hasNext={
            Boolean(playingMovie.movie?.seasons) &&
            (playingMovie.seasonIndex < playingMovie.movie.seasons.length - 1 ||
              playingMovie.episodeIndex < playingMovie.movie.seasons[playingMovie.seasonIndex].episodes.length - 1)
          }
          hasPrev={
            Boolean(playingMovie.movie?.seasons) &&
            (playingMovie.seasonIndex > 0 || playingMovie.episodeIndex > 0)
          }
          initialDuration={playingMovie.movie?.duration}
          onNextEpisode={() => {
            const m = playingMovie.movie;
            const sIdx = playingMovie.seasonIndex;
            const eIdx = playingMovie.episodeIndex;
            if (!m?.seasons) return;

            if (eIdx < m.seasons[sIdx].episodes.length - 1) {
              const nextEp = m.seasons[sIdx].episodes[eIdx + 1];
              setPlayingMovie({
                title: `${m.title} - S0${m.seasons[sIdx].seasonNumber}E0${nextEp.episodeNumber}: ${nextEp.title}`,
                streamingUrl: nextEp.streamUrl,
                displayCategory: m.displayCategory,
                posterUrl: m.posterUrl,
                movie: m,
                seasonIndex: sIdx,
                episodeIndex: eIdx + 1,
              });
            } else if (sIdx < m.seasons.length - 1) {
              const nextSeason = m.seasons[sIdx + 1];
              const nextEp = nextSeason.episodes[0];
              setPlayingMovie({
                title: `${m.title} - S0${nextSeason.seasonNumber}E0${nextEp.episodeNumber}: ${nextEp.title}`,
                streamingUrl: nextEp.streamUrl,
                displayCategory: m.displayCategory,
                posterUrl: m.posterUrl,
                movie: m,
                seasonIndex: sIdx + 1,
                episodeIndex: 0,
              });
            }
          }}
          onPrevEpisode={() => {
            const m = playingMovie.movie;
            const sIdx = playingMovie.seasonIndex;
            const eIdx = playingMovie.episodeIndex;
            if (!m?.seasons) return;

            if (eIdx > 0) {
              const prevEp = m.seasons[sIdx].episodes[eIdx - 1];
              setPlayingMovie({
                title: `${m.title} - S0${m.seasons[sIdx].seasonNumber}E0${prevEp.episodeNumber}: ${prevEp.title}`,
                streamingUrl: prevEp.streamUrl,
                displayCategory: m.displayCategory,
                posterUrl: m.posterUrl,
                movie: m,
                seasonIndex: sIdx,
                episodeIndex: eIdx - 1,
              });
            } else if (sIdx > 0) {
              const prevSeason = m.seasons[sIdx - 1];
              const prevEp = prevSeason.episodes[prevSeason.episodes.length - 1];
              setPlayingMovie({
                title: `${m.title} - S0${prevSeason.seasonNumber}E0${prevEp.episodeNumber}: ${prevEp.title}`,
                streamingUrl: prevEp.streamUrl,
                displayCategory: m.displayCategory,
                posterUrl: m.posterUrl,
                movie: m,
                seasonIndex: sIdx - 1,
                episodeIndex: prevSeason.episodes.length - 1,
              });
            }
          }}

        />
      )}

      {/* Floating Bottom-Right Yellow Search Button (ONLY inside Bollywood, Hollywood, and Series folders) */}
      {isFolderSearchSupported && !selectedMovie && !playingMovie && (
        <button
          type="button"
          onClick={() => {
            document.getElementById('root')?.scrollTo({ top: 0, behavior: 'smooth' });
            if (isFolderSearchOpen) {
              if (folderSearchQuery.trim()) {
                folderSearchInputRef.current?.focus();
              } else {
                setIsFolderSearchOpen(false);
              }
            } else {
              setIsFolderSearchOpen(true);
            }
          }}
          aria-label={`Search in ${category}`}
          title={`Search ${category}`}
          className="fixed right-4 sm:right-6 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-40 w-14 h-14 rounded-full bg-yellow-400 hover:bg-yellow-300 text-black border-2 border-yellow-200 shadow-[0_8px_28px_rgba(250,204,21,0.5)] flex items-center justify-center cursor-pointer active:scale-90 transition-transform duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-yellow-300/60"
        >
          <Search size={24} strokeWidth={2.5} />
        </button>
      )}

      {/* Fixed Bottom Navigation with large, beautifully styled category pills for Bollywood, Hollywood, Series */}
      <nav className="bg-black/95 backdrop-blur-xl border-t border-neutral-900 flex items-center justify-around fixed bottom-0 left-0 w-full z-40 py-3 px-4 pb-[env(safe-area-inset-bottom)] shadow-2xl">
        {(['Bollywood', 'Hollywood', 'Series'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => {
              if (category === cat) {
                setCategory(null);
              } else {
                openCategory(cat);
              }
            }}
            className={`flex-1 mx-2 py-3 px-4 rounded-2xl text-center font-black uppercase text-base sm:text-lg tracking-wide transition-all cursor-pointer active:scale-95 shadow-lg flex items-center justify-center gap-2 ${
              category === cat
                ? 'bg-yellow-400 text-black border-2 border-yellow-300 shadow-[0_0_25px_rgba(250,204,21,0.5)] scale-105'
                : 'bg-neutral-900/90 text-yellow-400 hover:bg-neutral-800 border border-neutral-800'
            }`}
          >
            <span className="truncate">{cat}</span>
            {category === cat && <span className="w-2.5 h-2.5 rounded-full bg-black"></span>}
          </button>
        ))}
      </nav>
    </div>
  );
}
