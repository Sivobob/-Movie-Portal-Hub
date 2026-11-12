import { useState, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import MovieCard from './MovieCard';
import { Search, Play, X, Star, Calendar, Globe, Film, ShieldCheck, LogIn, LogOut, Smartphone, Download } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import VideoPlayerModal from './VideoPlayerModal';
import { useAuth, isAuthorizedAdminEmail } from '../context/AuthContext';
import { loginWithGoogle } from '../services/authService';

import { fetchMoviesFromFirestore, getLocalMovies, saveLocalMovies } from '../services/movieStorage';
import { isNativeAndroid, isInstalledPhoneApp, downloadOfficialApk } from '../utils/platform';
import { useDownloads } from '../hooks/useDownloads';
import DownloadOptionsModal from './DownloadOptionsModal';
import DownloadsView from './DownloadsView';
import AndroidBottomNav from './AndroidBottomNav';

export default function HomePage() {
  const isAndroid = isNativeAndroid();
  const { user, isAdmin, handleLogout, signInWithEmail } = useAuth();
  const { 
    downloads, 
    activeDownloads, 
    startDownload, 
    removeDownload, 
    cancelActiveDownload, 
    pauseActiveDownload, 
    resumeActiveDownload, 
    lastNotification, 
    setLastNotification 
  } = useDownloads();
  const [downloadModalMovie, setDownloadModalMovie] = useState<any | null>(null);
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
  const [announcement, setAnnouncement] = useState<any | null>(null);
  const navigate = useNavigate();

  const isMasterAdmin = Boolean(user && isAuthorizedAdminEmail(user.email) && isAdmin);

  // Synchronized refs to allow hardware back button to read real-time state without stale closures
  const categoryRef = useRef(category);
  const selectedMovieRef = useRef(selectedMovie);
  const playingMovieRef = useRef(playingMovie);
  const downloadModalMovieRef = useRef(downloadModalMovie);

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
    downloadModalMovieRef.current = downloadModalMovie;
  }, [downloadModalMovie]);

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
      if (downloadModalMovieRef.current) {
        setDownloadModalMovie(null);
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
          if (downloadModalMovieRef.current) {
            setDownloadModalMovie(null);
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

  // Load published movies real-time
  useEffect(() => {
    let isMounted = true;
    
    // 1. Initial Fetch
    const fetchInitial = async () => {
      try {
        const q = query(collection(db, 'movies'));
        const snapshot = await getDocs(q);
        if (!isMounted) return;
        setIsLoading(false);
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
        const publishedList = list.filter((m: any) => m.published !== false);
        setMovies(publishedList);
        saveLocalMovies(publishedList);
        setFeaturedMovies(publishedList);
      } catch (e) {
        console.error('Initial fetch failed, relying on cache', e);
      }
    };
    fetchInitial();

    // 2. Real-time Listener
    const q = query(collection(db, 'movies'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        if (!isMounted) return;
        setIsLoading(false);
        const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
        const publishedList = list.filter((m: any) => m.published !== false);
        setMovies(publishedList);
        saveLocalMovies(publishedList);
        setFeaturedMovies(publishedList);
      },
      (err) => {
        if (!isMounted) return;
        setIsLoading(false);
      }
    );
    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // Listen for public content announcements (New Movie / Series Releases)
  useEffect(() => {
    // 1. Check local storage for recent broadcasts
    try {
      const stored = localStorage.getItem('app_latest_announcement');
      if (stored) {
        const parsed = JSON.parse(stored);
        const lastSeen = sessionStorage.getItem('last_seen_announcement');
        if (parsed?.id && parsed.id !== lastSeen) {
          setAnnouncement(parsed);
          sessionStorage.setItem('last_seen_announcement', parsed.id);
          setTimeout(() => setAnnouncement(null), 12000);
        }
      }
    } catch (e) {}

    // 2. Custom window event listener (immediate within same or cross tab)
    const handleReleaseEvent = (event: any) => {
      if (event.detail) {
        setAnnouncement(event.detail);
        sessionStorage.setItem('last_seen_announcement', event.detail.id || `ann-${Date.now()}`);
        setTimeout(() => setAnnouncement(null), 12000);
      }
    };
    window.addEventListener('new_movie_release', handleReleaseEvent);

    // 3. BroadcastChannel for multi-tab sync
    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel('movie_portal_updates');
        bc.onmessage = (msg) => {
          if (msg.data?.type === 'NEW_RELEASE' && msg.data.data) {
            setAnnouncement(msg.data.data);
            setTimeout(() => setAnnouncement(null), 12000);
          }
        };
      } catch (e) {}
    }

    // 4. Firestore real-time collection listener
    const q = query(
      collection(db, 'announcements'),
      where('expiresAt', '>', new Date())
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      if (docs.length > 0) {
        docs.sort((a: any, b: any) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
        const latest = docs[0] as any;
        const lastSeenId = sessionStorage.getItem('last_seen_announcement');
        if (latest.id !== lastSeenId) {
          setAnnouncement(latest);
          sessionStorage.setItem('last_seen_announcement', latest.id);
          
          // Trigger system notification matching rich Android style
          try {
            if (typeof window !== 'undefined' && 'Notification' in window && (window as any).Notification?.permission === 'granted') {
              const isSeries = (latest.category || '').toLowerCase().includes('series');
              new Notification('MOVIE PORTAL', {
                body: `Watch Now : ${latest.title} (${latest.releaseYear || new Date().getFullYear()}) Full ${isSeries ? 'Series' : 'Movie'} available now\nGO STREAM or DOWNLOAD NOW`,
                icon: '/assets/icons/master_icon.jpg',
                image: latest.posterUrl || latest.backdropUrl || '/assets/icons/master_icon.jpg',
                badge: '/assets/icons/master_icon.jpg',
                tag: `movie-${latest.id}`
              } as any);
            }
          } catch (notifErr) {}
          
          setTimeout(() => setAnnouncement(null), 12000);
        }
      }
    }, (err) => {
      console.warn('Firestore announcements listener inactive:', err?.message || err);
    });
    
    return () => {
      unsubscribe();
      window.removeEventListener('new_movie_release', handleReleaseEvent);
      if (bc) bc.close();
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

  const openDownloadModal = (movie: any) => {
    setDownloadModalMovie(movie);
    try {
      window.history.pushState({ appModal: 'download_modal' }, '');
    } catch (e) {}
  };

  const handleDownloadAPK = (e: React.MouseEvent) => {
    e.preventDefault();
    downloadOfficialApk();
  };

  return (
    <div className={`h-full min-h-full w-full bg-black text-white flex flex-col relative pt-0 select-none overflow-x-hidden ${category ? 'pb-20' : 'pb-0 overflow-y-hidden'}`}>
      {/* New Content Announcement Toast */}
      <AnimatePresence>
        {announcement && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className="fixed bottom-20 sm:bottom-6 left-4 right-4 z-[100] flex justify-center pointer-events-none"
          >
            <div 
              onClick={() => {
                const target = movies.find(
                  (m) => m.id === announcement.movieId || (m.title && announcement.title && m.title.toLowerCase() === announcement.title.toLowerCase())
                );
                if (target) {
                  setSelectedMovie(target);
                }
              }}
              className="bg-neutral-900/95 backdrop-blur-md border border-neutral-700/80 rounded-3xl shadow-2xl p-4 max-w-md w-full pointer-events-auto overflow-hidden relative cursor-pointer active:scale-98 transition-all group text-white"
            >
              {/* Header bar: Icon, App Name, Time, Close */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full overflow-hidden border border-yellow-400/50 bg-black flex-shrink-0">
                    <img src="/assets/icons/master_icon.jpg" alt="Movie Portal" className="w-full h-full object-cover" />
                  </div>
                  <span className="text-xs font-bold text-gray-300 tracking-wide">
                    MOVIE PORTAL <span className="text-gray-500 font-normal ml-1">• Just now</span>
                  </span>
                </div>
                
                <button 
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAnnouncement(null);
                  }}
                  className="p-1 hover:bg-white/10 rounded-full transition-colors cursor-pointer text-gray-400 hover:text-white"
                  aria-label="Close notification"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Title & Body */}
              <div className="space-y-0.5 px-0.5">
                <h4 className="text-xs sm:text-sm font-bold text-gray-100 leading-snug">
                  Watch Now : {announcement.title} ({announcement.releaseYear || new Date().getFullYear()}) Full {announcement.category?.toLowerCase().includes('series') ? 'Series' : 'Movie'} available now
                </h4>
                <p className="text-[11px] font-semibold text-gray-400 tracking-wide uppercase">
                  GO STREAM or DOWNLOAD NOW
                </p>
              </div>

              {/* Large Poster / Banner (Big Picture) */}
              <div className="mt-3 rounded-2xl overflow-hidden bg-black/60 border border-neutral-800 shadow-xl max-h-56 relative group">
                <img 
                  src={announcement.posterUrl || announcement.backdropUrl} 
                  alt={announcement.title} 
                  className="w-full h-44 sm:h-52 object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
                <div className="absolute bottom-2.5 right-3 bg-yellow-400 text-black font-black text-[10px] px-3 py-1 rounded-full uppercase tracking-wider flex items-center gap-1 shadow-lg">
                  <Play size={10} fill="black" /> WATCH NOW
                </div>
              </div>

              {/* Progress Bar (Timer) */}
              <motion.div 
                initial={{ width: "100%" }}
                animate={{ width: "0%" }}
                transition={{ duration: 12, ease: "linear" }}
                className="absolute bottom-0 left-0 h-1 bg-yellow-400"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
          ) : category === 'Downloads' ? (
            <DownloadsView
              activeDownloads={activeDownloads}
              completedDownloads={downloads}
              onPlayMovie={(movie) => setPlayingMovie(movie)}
              onRemoveCompleted={removeDownload}
              onCancelActive={cancelActiveDownload}
              onPauseActive={pauseActiveDownload}
              onResumeActive={resumeActiveDownload}
              onBrowseMovies={() => setCategory(null)}
            />
          ) : (
            <div className="grid grid-cols-3 gap-2 px-2">
              {categoryMovies.map((movie) => (
                <MovieCard 
                  key={movie.id} 
                  movie={movie} 
                  onClick={() => handleMovieClick(movie)} 
                  onDownloadClick={() => setDownloadModalMovie(movie)}
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

              {/* Center Play Overlay on Hover */}
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity">
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

                        {/* Direct Episode Download Button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDownloadModalMovie({
                              ...selectedMovie,
                              title: `${selectedMovie.title} - S0${selectedMovie.seasons[activeSeasonIndex].seasonNumber}E0${ep.episodeNumber}: ${ep.title}`,
                              streamingUrl: ep.streamUrl,
                            });
                            setSelectedMovie(null);
                          }}
                          className="w-7 h-7 rounded-full bg-yellow-400/20 hover:bg-yellow-400 text-black flex items-center justify-center flex-shrink-0 transition-colors cursor-pointer"
                          title="Download Episode"
                        >
                          <Download size={13} className="text-yellow-600 hover:text-black stroke-[2.5]" />
                        </button>

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
          onRequestDownload={(m) => setDownloadModalMovie(m)}
        />
      )}

      {/* Download Options & Quality Selector Modal */}
      {downloadModalMovie && (
        <DownloadOptionsModal
          isOpen={Boolean(downloadModalMovie)}
          onClose={() => setDownloadModalMovie(null)}
          movie={downloadModalMovie}
          onConfirmDownload={(opts) => {
            startDownload({
              title: opts.title,
              posterUrl: opts.posterUrl,
              videoUrl: opts.videoUrl,
              quality: opts.quality,
              estimatedSizeMb: opts.estimatedSizeMb,
              originalCategory: downloadModalMovie.displayCategory || 'Movie',
              releaseYear: downloadModalMovie.releaseYear,
            });
          }}
          onViewDownloads={() => {
            setDownloadModalMovie(null);
            setCategory('Downloads');
          }}
        />
      )}

      {/* Floating Download Notification Toast */}
      {lastNotification && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-neutral-900 border border-yellow-400/80 text-white px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300 max-w-[90vw]">
          <div className="w-7 h-7 rounded-full bg-yellow-400 text-black flex items-center justify-center flex-shrink-0 animate-bounce">
            <Download size={14} className="stroke-[2.5]" />
          </div>
          <span className="text-xs font-bold truncate max-w-xs">{lastNotification}</span>
          <button
            type="button"
            onClick={() => {
              setCategory('Downloads');
              setLastNotification(null);
            }}
            className="text-[11px] bg-yellow-400 hover:bg-yellow-500 text-black font-black px-2.5 py-1 rounded-lg uppercase tracking-wider whitespace-nowrap cursor-pointer active:scale-95"
          >
            View
          </button>
        </div>
      )}

      {/* Fixed Bottom Navigation matching design with 4 categories: Bollywood, Hollywood, Series, Downloads */}
      <nav className={`bg-black/95 backdrop-blur-md border-t border-neutral-900 flex items-center fixed bottom-0 left-0 w-full z-40 pb-[env(safe-area-inset-bottom)] ${
        isAndroid ? 'p-3 justify-around' : 'p-3.5 justify-around text-yellow-400 text-xs font-bold uppercase'
      }`}>
        {(['Bollywood', 'Hollywood', 'Series', 'Downloads'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => {
              if (category === cat) {
                setCategory(null);
              } else {
                openCategory(cat);
              }
            }}
            className={`transition-colors rounded cursor-pointer uppercase inline-flex items-center gap-1 ${
              isAndroid
                ? `py-1.5 px-3 text-[13px] sm:text-sm font-black tracking-wide ${
                    category === cat ? 'text-white border-b-2 border-yellow-400' : 'text-yellow-400 hover:text-yellow-300'
                  }`
                : `py-1 px-3 ${
                    category === cat ? 'text-white border-b-2 border-yellow-400 font-extrabold' : 'text-yellow-400 hover:text-yellow-300'
                  }`
            }`}
          >
            <span>{cat}</span>
            {cat === 'Downloads' && activeDownloads.length > 0 && (
              <span className="px-1.5 py-0.2 bg-yellow-400 text-black text-[9px] font-black rounded-full animate-pulse">
                {activeDownloads.length}
              </span>
            )}
          </button>
        ))}

      </nav>
    </div>
  );
}
