import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import MovieCard from './MovieCard';
import { Search, Play, X, Star, Calendar, Globe, Film, ShieldCheck, LogIn, LogOut, Smartphone } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import VideoPlayerModal from './VideoPlayerModal';
import { useAuth, isAuthorizedAdminEmail } from '../context/AuthContext';
import { loginWithGoogle } from '../services/authService';

import { fetchMoviesFromFirestore, getLocalMovies, saveLocalMovies } from '../services/movieStorage';
import { isNativeAndroid, isInstalledPhoneApp, downloadOfficialApk } from '../utils/platform';
import AndroidBottomNav from './AndroidBottomNav';

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
  const navigate = useNavigate();

  const isMasterAdmin = Boolean(user && isAuthorizedAdminEmail(user.email) && isAdmin);

  // Synchronized refs to allow hardware back button to read real-time state without stale closures
  const categoryRef = useRef(category);
  const selectedMovieRef = useRef(selectedMovie);
  const playingMovieRef = useRef(playingMovie);

  useEffect(() => {
    categoryRef.current = category;
  }, [category]);

  useEffect(() => {
    selectedMovieRef.current = selectedMovie;
  }, [selectedMovie]);

  useEffect(() => {
    playingMovieRef.current = playingMovie;
  }, [playingMovie]);

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
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
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



  // Slider Touch & Interaction State
  const [isUserInteracting, setIsUserInteracting] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [touchEndX, setTouchEndX] = useState<number | null>(null);
  const [isSwiping, setIsSwiping] = useState(false);
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
    }, 4000); // Resume auto-sliding after 4s idle
  };

  // Automatic slider timer (every 4s, pauses during user interaction)
  useEffect(() => {
    if (category !== null) return; // Only run on main homepage
    if (featuredMovies.length <= 1) return;
    if (isUserInteracting) return;

    const interval = setInterval(() => {
      setActiveSlideIndex((prev) => (prev + 1) % featuredMovies.length);
    }, 4000);

    return () => clearInterval(interval);
  }, [category, featuredMovies.length, isUserInteracting]);

  const handleManualSwipe = (direction: 'left' | 'right') => {
    if (featuredMovies.length <= 1) return;
    if (direction === 'left') {
      setActiveSlideIndex((prev) => (prev + 1) % featuredMovies.length);
    } else {
      setActiveSlideIndex((prev) => (prev - 1 + featuredMovies.length) % featuredMovies.length);
    }
  };

  // Touch / Mouse Swipe Event Handlers
  const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
    handleInteractionStart();
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    setTouchStartX(clientX);
    setTouchEndX(clientX);
    setIsSwiping(false);
  };

  const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
    if (touchStartX === null) return;
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    setTouchEndX(clientX);
    if (Math.abs(clientX - touchStartX) > 10) {
      setIsSwiping(true);
    }
  };

  const handleTouchEnd = () => {
    if (touchStartX !== null && touchEndX !== null) {
      const distance = touchStartX - touchEndX;
      if (distance > 40) {
        handleManualSwipe('left');
      } else if (distance < -40) {
        handleManualSwipe('right');
      }
    }
    setTouchStartX(null);
    setTouchEndX(null);
    handleInteractionEnd();
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
    <div className={`h-full min-h-full w-full bg-black text-white flex flex-col relative pt-0 select-none overflow-x-hidden ${category ? 'pb-20' : 'pb-0 overflow-y-hidden'}`}>


      {/* Category Grid View OR Cinematic Main Homepage */}
      {category ? (
        <div className="flex-grow pt-4">
          <div className="flex items-center justify-between px-4 mb-3">
            <h2 className="text-yellow-400 font-bold text-lg tracking-wide uppercase">{category}</h2>
          </div>

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
          ) : (
            <div className="grid grid-cols-3 gap-2 px-2">
              {categoryMovies.map((movie) => (
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
          className="relative flex-grow h-screen flex flex-col justify-end overflow-hidden pb-12 touch-pan-y cursor-pointer will-change-transform transform-gpu"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onMouseDown={handleTouchStart}
          onMouseMove={handleTouchMove}
          onMouseUp={handleTouchEnd}
          onClick={() => {
            if (!isSwiping && currentFeatured) {
              handleMovieClick(currentFeatured);
            }
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={currentFeatured.id || activeSlideIndex}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1 }}
              className="absolute inset-0"
            >
              <div 
                className="absolute inset-0 bg-cover bg-center w-full h-full"
                style={{
                  backgroundImage: `url(${currentFeatured.posterUrl || currentFeatured.backdropUrl || 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=1200'})`,
                }}
              />
              {/* Cinematic Vignette Overlay - Lighter at the top to show poster behind logo */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-transparent" />
            </motion.div>
          </AnimatePresence>
 
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
                    setActiveSlideIndex(idx);
                    handleInteractionStart();
                    handleInteractionEnd();
                  }}
                  className={`h-1 rounded-full transition-all duration-500 ${
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
                src={selectedMovie.posterUrl || selectedMovie.backdropUrl || undefined}
                alt={selectedMovie.title}
                className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                onError={(e: any) => {
                  e.target.src = 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=800';
                }}
              />

              {/* HD Badge */}
              <div className="absolute top-3.5 left-3.5 z-10">
                <span className="bg-black/90 text-[#facc15] font-black text-xs sm:text-sm px-2.5 py-1 rounded-md border border-amber-400/30 shadow-md tracking-wider">
                  HD
                </span>
              </div>

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
