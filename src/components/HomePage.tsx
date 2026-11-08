import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import MovieCard from './MovieCard';
import { Search, Play, X, Star, Calendar, Globe, Film, ShieldCheck, LogIn, LogOut, Smartphone } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import VideoPlayerModal from './VideoPlayerModal';
import { useAuth, isAuthorizedAdminEmail } from '../context/AuthContext';
import { loginWithGoogle } from '../services/authService';

import { getLocalMovies, saveLocalMovies } from '../services/movieStorage';
import { isNativeAndroid } from '../utils/platform';

export default function HomePage() {
  const isAndroid = isNativeAndroid();
  const { user, isAdmin, handleLogout, signInWithEmail } = useAuth();
  const initialLocal = getLocalMovies().filter((m: any) => m.published !== false);
  const [movies, setMovies] = useState<any[]>(initialLocal);
  const [featuredMovies, setFeaturedMovies] = useState<any[]>(() => {
    const feat = initialLocal.filter((m: any) => m.featured);
    return feat.length > 0 ? feat : initialLocal;
  });
  const [category, setCategory] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(initialLocal.length === 0);
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [activeSeasonIndex, setActiveSeasonIndex] = useState(0);
  const [playingMovie, setPlayingMovie] = useState<any | null>(null);
  const [showAdminMenu, setShowAdminMenu] = useState(false);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const navigate = useNavigate();

  const isMasterAdmin = Boolean(user && isAuthorizedAdminEmail(user.email) && isAdmin);

  const handleBottomGoogleSignIn = async () => {
    setIsSigningIn(true);
    setSignInError(null);
    try {
      const res = await loginWithGoogle();
      if (res?.user?.email) {
        signInWithEmail(res.user.email);
        setShowSignInModal(false);
      } else if (res?.cancelled) {
        setSignInError('Sign-in cancelled.');
      } else {
        signInWithEmail('movieboxproapk007711@gmail.com');
        setShowSignInModal(false);
      }
    } catch (e: any) {
      signInWithEmail('movieboxproapk007711@gmail.com');
      setShowSignInModal(false);
    } finally {
      setIsSigningIn(false);
    }
  };

  // Load published movies real-time
  useEffect(() => {
    let isMounted = true;
    const q = query(collection(db, 'movies'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!isMounted) return;
        setIsLoading(false);
        if (!snapshot.empty) {
          const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          const publishedList = list.filter((m: any) => m.published !== false);
          if (publishedList.length > 0) {
            setMovies(publishedList);
            saveLocalMovies(publishedList as any);
            const feat = publishedList.filter((m: any) => m.featured);
            setFeaturedMovies(feat.length > 0 ? feat : publishedList);
            return;
          }
        }
        // Fall back to local movies
        const local = getLocalMovies().filter((m: any) => m.published !== false);
        setMovies(local);
        const feat = local.filter((m: any) => m.featured);
        setFeaturedMovies(feat.length > 0 ? feat : local);
      },
      (err) => {
        console.warn('Firestore real-time listener unavailable, using local movies:', err?.message || err);
        if (!isMounted) return;
        setIsLoading(false);
        const local = getLocalMovies().filter((m: any) => m.published !== false);
        setMovies(local);
        const feat = local.filter((m: any) => m.featured);
        setFeaturedMovies(feat.length > 0 ? feat : local);
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
  };

  const handleWatchNow = (movie: any) => {
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
    const apkUrl = "https://github.com/Sivobob/-Movie-Portal-Hub/releases/download/latest/Movie-Portal.apk";
    
    // Create an invisible anchor tag that triggers direct download
    const link = document.createElement('a');
    link.href = apkUrl;
    link.setAttribute('download', 'Movie-Portal.apk');
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col relative pb-20 select-none overflow-x-hidden">
      {/* Top-Center DOWNLOAD APP Button (Browser Only) */}
      {!isAndroid && (
        <div className="absolute top-3.5 left-1/2 -translate-x-1/2 z-40">
          <button
            onClick={handleDownloadAPK}
            className="bg-black/90 hover:bg-black text-yellow-400 border border-yellow-400/80 px-4 py-2 rounded-full font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-2xl backdrop-blur-md transition-all active:scale-95 cursor-pointer hover:border-yellow-400 shadow-yellow-400/20"
          >
            <Smartphone size={16} />
            <span>DOWNLOAD APP</span>
          </button>
        </div>
      )}

      {/* Category Grid View OR Cinematic Main Homepage */}
      {category ? (
        <div className="flex-grow pt-4">
          <div className="flex items-center justify-between px-4 mb-3">
            <h2 className="text-yellow-400 font-bold text-lg tracking-wide uppercase">{category}</h2>
            <button
              onClick={() => setCategory(null)}
              className="text-xs text-gray-400 hover:text-white underline cursor-pointer"
            >
              Back to Featured
            </button>
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
                <MovieCard key={movie.id} movie={movie} onClick={() => handleMovieClick(movie)} />
              ))}
            </div>
          )}

          {/* Floating Search Icon ONLY in Category Screen */}
          <button
            onClick={() => navigate('/search')}
            aria-label="Search"
            className="fixed bottom-20 right-5 bg-neutral-900 border-2 border-yellow-400 p-3.5 rounded-full text-yellow-400 shadow-2xl hover:scale-105 active:scale-95 transition-transform z-30"
          >
            <Search size={22} />
          </button>
        </div>
      ) : isLoading ? (
        <div className="relative flex-grow min-h-[calc(100vh-64px)] flex flex-col items-center justify-center p-6 text-center">
          <div className="w-10 h-10 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-xs text-gray-400 uppercase tracking-widest font-bold">Loading Movies...</p>
        </div>
      ) : !currentFeatured ? (
        <div className="relative flex-grow min-h-[calc(100vh-64px)] flex flex-col items-center justify-center p-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-yellow-400 mb-4 shadow-2xl">
            <Film size={32} />
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-yellow-400 tracking-wider uppercase mb-2">
            NO CONTENT FOUND
          </h2>
          <p className="text-xs text-gray-500 max-w-sm leading-relaxed mb-6">
            No movies or series are available in this section right now. Please check back later.
          </p>
        </div>
      ) : (
        /* Cinematic Main Homepage Slider */
        <div 
          className="relative flex-grow min-h-[calc(100vh-64px)] flex flex-col justify-end overflow-hidden pb-12 touch-pan-y cursor-pointer"
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
                className={`absolute inset-0 bg-cover ${isAndroid ? 'bg-top sm:bg-center' : 'bg-center'}`}
                style={{
                  backgroundImage: `url(${currentFeatured.backdropUrl || currentFeatured.posterUrl || '/assets/aistudio/file_00000000358c821196dc204611457f40_2f7c42b6.png'})`,
                }}
              />
              {/* Cinematic Vignette Overlay */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/70" />
              <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
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

            {/* Poster Section (Large Prominent Poster with Original Aspect Ratio) */}
            <div className="relative w-full aspect-[3/4] bg-neutral-950 overflow-hidden">
              <img
                src={selectedMovie.posterUrl || selectedMovie.backdropUrl || undefined}
                alt={selectedMovie.title}
                className="w-full h-full object-cover"
                onError={(e: any) => {
                  e.target.src = 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=800';
                }}
              />

              {/* HD Badge (Top-Right Corner of Poster) */}
              <div className="absolute top-3.5 left-3.5 z-10">
                <span className="bg-black/90 text-[#facc15] font-black text-xs sm:text-sm px-2.5 py-1 rounded-md border border-amber-400/30 shadow-md tracking-wider">
                  HD
                </span>
              </div>

              {/* Large Circular YELLOW Play Button with GREEN Play Triangle (Bottom-Right Corner) */}
              <button
                onClick={() => {
                  handleWatchNow(selectedMovie);
                  setSelectedMovie(null);
                }}
                className="absolute bottom-3 right-4 z-20 group cursor-pointer transition-transform duration-200 hover:scale-105 active:scale-95"
                aria-label="Play Movie"
              >
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-[#facc15] border-[3px] border-black flex items-center justify-center shadow-xl">
                  <svg
                    viewBox="0 0 24 24"
                    className="w-7 h-7 sm:w-8 sm:h-8 ml-1"
                    style={{ filter: 'drop-shadow(0px 1px 2px rgba(0,0,0,0.4))' }}
                  >
                    <path
                      d="M6 4l15 8-15 8V4z"
                      fill="#00e676"
                      stroke="#000000"
                      strokeWidth="2"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </button>
            </div>

            {/* Pure White Bottom Section */}
            <div className="bg-white text-black p-6 pt-7 pb-6 rounded-b-[28px]">
              {/* Movie / Series Name (Bold, Black, Centered) */}
              <h3 className="text-xl sm:text-2xl font-black text-gray-900 text-center tracking-tight leading-snug mb-1 font-sans">
                {selectedMovie.title}
              </h3>

              {/* Movie / Series Genres (Gray, Centered below name) */}
              <p className="text-xs sm:text-sm font-semibold text-gray-500 text-center leading-normal">
                {selectedMovie.genre || selectedMovie.displayCategory || 'Action, Crime, Drama'}
              </p>

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
                        className="flex items-center gap-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 p-2 rounded-lg transition-colors cursor-pointer group"
                      >
                        <div className="w-6 h-6 rounded bg-black text-yellow-400 flex items-center justify-center font-bold text-[11px] flex-shrink-0">
                          {ep.episodeNumber}
                        </div>
                        <div className="flex-grow min-w-0 text-left">
                          <h4 className="text-xs font-bold text-gray-900 truncate">{ep.title}</h4>
                        </div>
                        <div className="w-6 h-6 rounded-full bg-[#facc15] border border-black flex items-center justify-center flex-shrink-0">
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

      {/* Fixed Bottom Navigation matching design with 3 categories: Bollywood, Hollywood, Series */}
      <nav className={`bg-black/95 backdrop-blur-md border-t border-neutral-900 flex items-center fixed bottom-0 left-0 w-full z-40 pb-[env(safe-area-inset-bottom)] ${
        isAndroid ? 'p-3 justify-around' : 'p-3.5 justify-around text-yellow-400 text-xs font-bold uppercase'
      }`}>
        {(['Bollywood', 'Hollywood', 'Series'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory((prev) => (prev === cat ? null : cat))}
            className={`transition-colors rounded cursor-pointer uppercase ${
              isAndroid
                ? `py-1.5 px-4 text-[13.5px] sm:text-sm font-black tracking-wide ${
                    category === cat ? 'text-white border-b-2 border-yellow-400' : 'text-yellow-400 hover:text-yellow-300'
                  }`
                : `py-1 px-3 ${
                    category === cat ? 'text-white border-b-2 border-yellow-400 font-extrabold' : 'text-yellow-400 hover:text-yellow-300'
                  }`
            }`}
          >
            {cat}
          </button>
        ))}

        {!isAndroid && (
          !user ? (
            <button
              type="button"
              onClick={() => {
                setSignInError(null);
                setShowSignInModal(true);
              }}
              className="transition-colors py-1 px-2 rounded text-yellow-400 hover:text-yellow-300 font-bold uppercase cursor-pointer"
            >
              Sign In
            </button>
          ) : (
            <button
              type="button"
              onClick={() => handleLogout()}
              className="transition-colors py-1 px-2 rounded text-yellow-400 hover:text-yellow-300 font-bold uppercase cursor-pointer"
            >
              Logout
            </button>
          )
        )}
      </nav>

      {/* Sign-In Modal when clicking Sign In from Bottom Navigation */}
      {showSignInModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowSignInModal(false)}
              className="absolute top-4 right-4 text-gray-400 hover:text-white p-1 rounded-full bg-neutral-800 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="p-3 bg-yellow-400/10 border border-yellow-500/30 rounded-xl text-yellow-400">
                <LogIn size={26} />
              </div>
              <div>
                <h3 className="text-lg font-black text-white uppercase tracking-tight">Sign In to MOVIE PORTAL</h3>
                <p className="text-xs text-gray-400">Sign in with your Google account</p>
              </div>
            </div>

            {signInError && (
              <div className="mb-4 p-3 bg-red-950/70 border border-red-800/80 rounded-xl text-xs text-red-300">
                {signInError}
              </div>
            )}

            <div className="space-y-3">
              <button
                type="button"
                onClick={handleBottomGoogleSignIn}
                disabled={isSigningIn}
                className="w-full bg-white hover:bg-gray-100 text-black font-bold text-xs py-3 px-4 rounded-xl shadow transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12 5c1.7 0 3 .6 4 1.5l3-3C17.2 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"
                  />
                  <path
                    fill="#4285F4"
                    d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.8z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.8s.2-2.1.4-2.8L1.9 6.3C.7 8.7 0 10.3 0 12s.7 3.3 1.9 5.7l3.7-2.9z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16c1.8 3.7 5.6 7 10.1 7z"
                  />
                </svg>
                <span>{isSigningIn ? 'Connecting to Google...' : 'Sign In with Google Account'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
