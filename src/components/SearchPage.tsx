import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, ArrowLeft, Film, ChevronRight, Clock } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import VideoPlayerModal from './VideoPlayerModal';
import MovieDetailsModal from './MovieDetailsModal';
import PosterImage from './PosterImage';
import { parseDurationToSeconds } from '../utils/duration';
import { resolveEpisodePlaybackDurationSec } from '../utils/playerHelpers';
import { saveWatchProgress } from '../services/userWatchService';
import { useAuth } from '../context/AuthContext';
import { useMovies } from '../context/MoviesContext';
import { getAppPreferences, isMatureContent } from '../services/userPreferencesService';
import { getEpisodeDisplayLabel } from '../services/movieStorage';

const RECENT_SEARCHES_STORAGE_KEY = 'movie_portal_recent_searches_v1';

const getInitialRecentSearches = (): any[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const GENRES = [
  "Action", "Adult", "Adventure", "Animation", "Animated Series", "Anime", "Biography", "Ceremony",
  "Comedy", "Concert", "Crime", "Detective", "Documentary", "Drama", "Family", "Fantasy",
  "Film Noir", "Game Show", "History", "Horror", "Kids", "Music", "Musical", "News",
  "Reality TV", "Romance", "Sci-Fi", "Short Film", "Sport", "Talk Show", "Thriller", "War", "Western"
];

export default function SearchPage() {
  const { user } = useAuth();
  const { movies: liveMovies, isLoading: catalogLoading, refreshMovies } = useMovies();
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [recentSearches, setRecentSearches] = useState<any[]>(getInitialRecentSearches);
  const [playingMovie, setPlayingMovie] = useState<any | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [activeSeasonIndex, setActiveSeasonIndex] = useState(0);
  const [familyMode, setFamilyMode] = useState<boolean>(() => getAppPreferences().familyMode);
  const [visibleLimit, setVisibleLimit] = useState<number>(120);
  const navigate = useNavigate();

  useEffect(() => {
    setVisibleLimit(120);
  }, [searchQuery, selectedGenres]);

  useEffect(() => {
    const onPrefs = () => setFamilyMode(getAppPreferences().familyMode);
    window.addEventListener('mp_preferences_updated', onPrefs);
    return () => window.removeEventListener('mp_preferences_updated', onPrefs);
  }, []);

  useEffect(() => {
    const urlQuery = searchParams.get('q') || '';
    if (urlQuery && urlQuery !== searchQuery) {
      setSearchQuery(urlQuery);
    }
  }, [searchParams]);

  const selectedMovieRef = useRef(selectedMovie);
  const playingMovieRef = useRef(playingMovie);
  const ignoringPopstateRef = useRef(0);
  const ignoreResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    selectedMovieRef.current = selectedMovie;
  }, [selectedMovie]);

  useEffect(() => {
    playingMovieRef.current = playingMovie;
  }, [playingMovie]);

  const popHistoryEntrySilently = () => {
    ignoringPopstateRef.current += 1;
    if (ignoreResetTimerRef.current) clearTimeout(ignoreResetTimerRef.current);
    ignoreResetTimerRef.current = setTimeout(() => {
      ignoringPopstateRef.current = 0;
    }, 500);
    try {
      window.history.back();
    } catch {
      ignoringPopstateRef.current = Math.max(0, ignoringPopstateRef.current - 1);
    }
  };

  const addMovieToRecentSearches = (movie: any) => {
    if (!movie || !movie.id) return;
    setRecentSearches((prev) => {
      const filtered = prev.filter(
        (m) => m.id !== movie.id && (!movie.imdbId || m.imdbId !== movie.imdbId)
      );
      const item = {
        id: movie.id,
        title: movie.title,
        releaseYear: movie.releaseYear,
        posterUrl: movie.posterUrl,
        backdropUrl: movie.backdropUrl,
        displayCategory: movie.displayCategory,
        originalCategory: movie.originalCategory,
        genre: movie.genre,
        seasons: movie.seasons,
        imdbId: movie.imdbId,
        timestamp: Date.now(),
      };
      const updated = [item, ...filtered].slice(0, 15);
      try {
        localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleRemoveRecentSearch = (id: string) => {
    setRecentSearches((prev) => {
      const updated = prev.filter((m) => m.id !== id);
      try {
        localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  };

  const handleClearAllRecentSearches = () => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
    } catch {}
  };

  const openMovieDetails = (movie: any) => {
    if (movie) {
      addMovieToRecentSearches(movie);
    }
    setActiveSeasonIndex(0);
    selectedMovieRef.current = movie;
    setSelectedMovie(movie);
    if (window.history.state?.appModal !== 'movie_detail') {
      try {
        window.history.pushState({ ...(window.history.state || {}), appModal: 'movie_detail' }, '');
      } catch {}
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
          navigate(-1);
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
  }, [navigate]);

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
        } catch {}
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
      openMovieDetails(movie);
    }
  };

  const results = useMemo(() => {
    if (searchQuery.trim().length < 1 && selectedGenres.length === 0) {
      return [];
    }
    let list = liveMovies.filter((m: any) => m.published !== false && !m.id?.startsWith('sample-'));

    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.trim().toLowerCase();
      list = list.filter((m: any) =>
        String(m.title || '').toLowerCase().includes(lowerQuery) ||
        String(m.originalTitle || '').toLowerCase().includes(lowerQuery) ||
        String(m.genre || '').toLowerCase().includes(lowerQuery) ||
        String(m.language || '').toLowerCase().includes(lowerQuery)
      );
    }

    if (selectedGenres.length > 0) {
      list = list.filter((m: any) =>
        selectedGenres.some((g) => String(m.genre || '').toLowerCase().includes(g.toLowerCase()))
      );
    }

    if (familyMode) {
      list = list.filter((m: any) => !isMatureContent(m));
    }

    return list;
  }, [liveMovies, searchQuery, selectedGenres, familyMode]);

  const isLoading = catalogLoading && liveMovies.length === 0;

  const resolvedSelectedMovie = useMemo(() => {
    if (!selectedMovie) return null;
    const live = liveMovies.find(
      (m) => m.id === selectedMovie.id || (selectedMovie.imdbId && m.imdbId === selectedMovie.imdbId)
    );
    return live || selectedMovie;
  }, [selectedMovie, liveMovies]);

  const resolvedPlayingParentMovie = useMemo(() => {
    if (!playingMovie) return undefined;
    const candidate = playingMovie.movie || (playingMovie.seasons ? playingMovie : null);
    if (!candidate) return undefined;
    return (
      liveMovies.find(
        (m) => m.id === candidate.id || (candidate.imdbId && m.imdbId === candidate.imdbId)
      ) || candidate
    );
  }, [playingMovie, liveMovies]);

  const handleSearch = async () => {
    if (hasSearchText && results.length > 0) {
      addMovieToRecentSearches(results[0]);
    }
    await refreshMovies(true);
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  const hasSearchText = searchQuery.trim().length > 0;
  const visibleResults = useMemo(() => results.slice(0, visibleLimit), [results, visibleLimit]);

  const resolvedRecentSearches = useMemo(() => {
    return recentSearches.map((item) => {
      const live = liveMovies.find(
        (m) => m.id === item.id || (item.imdbId && m.imdbId === item.imdbId)
      );
      return live || item;
    });
  }, [recentSearches, liveMovies]);

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-black text-white px-3 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(5.25rem+env(safe-area-inset-bottom))] select-none">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-2 sm:gap-3 bg-neutral-900 border border-neutral-800 px-2.5 py-1.5 rounded-xl mb-4 shadow-lg sticky top-2 z-20 min-w-0">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-yellow-400 cursor-pointer min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg hover:bg-white/5 active:scale-95 transition-all flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <Search className="text-gray-500 flex-shrink-0" size={18} />
          <input
            type="text"
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                (e.target as HTMLInputElement).blur();
                if (results.length > 0) {
                  addMovieToRecentSearches(results[0]);
                }
              }
            }}
            placeholder="Search movies, series, anime..."
            className="bg-transparent flex-grow min-w-0 outline-none text-sm text-white placeholder-gray-500 py-1.5"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="text-gray-400 hover:text-white min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg flex-shrink-0 cursor-pointer"
              aria-label="Clear search"
            >
              <X size={18} className="text-yellow-400" />
            </button>
          )}
        </div>

        {/* All Genres — hidden automatically while user is typing a search query */}
        {!hasSearchText && (
          <div className="mb-5">
            <h2 className="text-[11px] font-black text-gray-400 uppercase tracking-widest mb-2.5">
              All Genres
            </h2>
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {GENRES.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  onClick={() => toggleGenre(genre)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider transition-all border cursor-pointer ${
                    selectedGenres.includes(genre)
                      ? 'bg-yellow-400 text-black border-yellow-400 shadow-lg shadow-yellow-400/20'
                      : 'bg-neutral-900 text-gray-300 border-neutral-800 hover:border-gray-600'
                  }`}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recently Searched — displayed right below All Genres */}
        {!hasSearchText && selectedGenres.length === 0 && resolvedRecentSearches.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="text-[11px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5">
                <Clock size={13} className="text-yellow-400" />
                <span>Recently Searched</span>
              </h2>
              <button
                type="button"
                onClick={handleClearAllRecentSearches}
                className="text-[11px] font-bold text-neutral-400 hover:text-yellow-400 transition-colors cursor-pointer px-1 py-0.5"
              >
                Clear All
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4">
              {resolvedRecentSearches.map((movie) => {
                const isSeriesItem = Boolean(
                  (movie?.seasons && movie.seasons.length > 0) ||
                  /series/i.test(String(movie?.displayCategory || movie?.originalCategory || ''))
                );
                const yearText = movie?.releaseYear ? String(movie.releaseYear).trim() : '';
                const typeLabel = isSeriesItem ? 'Series' : 'Movie';

                return (
                  <div
                    key={movie.id}
                    className="group w-full min-h-[72px] flex items-center gap-3 py-2 px-1.5 border-b border-white/[0.06] hover:bg-white/[0.04] active:bg-white/[0.08] rounded-lg transition-colors text-left"
                  >
                    <button
                      type="button"
                      onClick={() => openMovieDetails(movie)}
                      className="flex-1 min-w-0 flex items-center gap-3 text-left cursor-pointer"
                    >
                      <div className="w-11 h-16 rounded-lg overflow-hidden shrink-0 bg-neutral-900 border border-white/[0.08]">
                        <PosterImage
                          posterUrl={movie.posterUrl}
                          backdropUrl={movie.backdropUrl}
                          title={movie.title}
                          year={movie.releaseYear}
                          width={180}
                          alt={movie.title}
                          isSeries={isSeriesItem}
                          compactFallback
                          className="w-full h-full object-cover"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white leading-snug line-clamp-2 group-hover:text-yellow-400 transition-colors">
                          {movie.title}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-neutral-400 tabular-nums truncate">
                          {yearText ? `${yearText} · ${typeLabel}` : typeLabel}
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveRecentSearch(movie.id);
                      }}
                      className="p-2 text-neutral-500 hover:text-red-400 transition-colors cursor-pointer rounded-lg hover:bg-white/5 flex-shrink-0"
                      aria-label="Remove from recent searches"
                      title="Remove"
                    >
                      <X size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Search / Filter Results */}
        {(hasSearchText || selectedGenres.length > 0) && (
          <div className="space-y-3">
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2 tabular-nums">
              {isLoading
                ? 'Searching...'
                : results.length > 0
                ? `Results (${results.length})`
                : 'No results found'}
            </h3>

            {visibleResults.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-4">
                {visibleResults.map((movie) => {
                  const isSeriesItem = Boolean(
                    (movie?.seasons && movie.seasons.length > 0) ||
                    /series/i.test(String(movie?.displayCategory || movie?.originalCategory || ''))
                  );
                  const yearText = movie?.releaseYear ? String(movie.releaseYear).trim() : '';
                  const typeLabel = isSeriesItem ? 'Series' : 'Movie';

                  return (
                    <button
                      key={movie.id}
                      type="button"
                      onClick={() => openMovieDetails(movie)}
                      className="group w-full min-h-[72px] flex items-center gap-3 py-2 px-1.5 border-b border-white/[0.06] hover:bg-white/[0.04] active:bg-white/[0.08] rounded-lg transition-colors text-left cursor-pointer"
                    >
                      <div className="w-11 h-16 rounded-lg overflow-hidden shrink-0 bg-neutral-900 border border-white/[0.08]">
                        <PosterImage
                          posterUrl={movie.posterUrl}
                          backdropUrl={movie.backdropUrl}
                          title={movie.title}
                          year={movie.releaseYear}
                          width={180}
                          alt={movie.title}
                          isSeries={isSeriesItem}
                          compactFallback
                          className="w-full h-full object-cover"
                        />
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white leading-snug line-clamp-2 group-hover:text-yellow-400 transition-colors">
                          {movie.title}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-neutral-400 tabular-nums truncate">
                          {yearText ? `${yearText} · ${typeLabel}` : typeLabel}
                        </p>
                      </div>

                      <ChevronRight
                        size={16}
                        className="text-neutral-600 group-hover:text-yellow-400 flex-shrink-0 transition-colors"
                      />
                    </button>
                  );
                })}
              </div>
            )}

            {results.length > visibleLimit && (
              <div className="pt-2 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((prev) => prev + 120)}
                  className="px-5 py-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-bold text-neutral-200 hover:bg-neutral-800 transition-colors cursor-pointer"
                >
                  Show more ({results.length - visibleLimit} remaining)
                </button>
              </div>
            )}
          </div>
        )}

        {/* Empty state when no search query, no genre selected, and no recent searches */}
        {!isLoading && !hasSearchText && selectedGenres.length === 0 && resolvedRecentSearches.length === 0 && (
          <div className="py-16 text-center text-neutral-800 flex flex-col items-center">
            <Film size={56} className="mb-4 opacity-20" />
            <p className="text-xs sm:text-sm font-bold uppercase tracking-widest opacity-40">
              Find your next favorite
            </p>
          </div>
        )}
      </div>

      {/* Filter Actions */}
      <div className="fixed bottom-0 left-0 right-0 w-full px-3 sm:px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] bg-black/90 backdrop-blur-md flex gap-2.5 border-t border-neutral-900 z-30">
        <button
          type="button"
          className="flex-1 h-11 bg-neutral-900 text-gray-300 rounded-xl text-xs font-bold uppercase border border-neutral-800 hover:bg-neutral-800 transition-colors cursor-pointer"
          onClick={() => {
            setSelectedGenres([]);
            setSearchQuery('');
          }}
        >
          Reset All
        </button>
        <button
          type="button"
          className="flex-1 h-11 bg-yellow-400 text-black rounded-xl text-xs font-black uppercase shadow-lg shadow-yellow-400/20 active:scale-95 transition-all cursor-pointer"
          onClick={handleSearch}
        >
          Apply Filters
        </button>
      </div>

      {resolvedSelectedMovie && !playingMovie && (
        <MovieDetailsModal
          isOpen={Boolean(resolvedSelectedMovie)}
          onClose={closeMovieDetails}
          movie={resolvedSelectedMovie}
          userId={user?.uid || 'guest_user'}
          onWatchNow={(m, sIdx, eIdx, lang) => handleWatchNow(m, sIdx, eIdx, lang)}
          onSelectMovie={(m) => {
            setActiveSeasonIndex(0);
            selectedMovieRef.current = m;
            setSelectedMovie(m);
          }}
          initialSeasonIndex={activeSeasonIndex}
        />
      )}

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
          movie={resolvedPlayingParentMovie || playingMovie.movie || playingMovie}
          seasonIndex={playingMovie.seasonIndex ?? 0}
          episodeIndex={playingMovie.episodeIndex ?? 0}
          language={playingMovie.language}
          initialDuration={playingMovie.initialDuration || playingMovie.duration || 0}
          initialTime={playingMovie.currentTime || 0}
          onEpisodeChange={(sIdx) => setActiveSeasonIndex(sIdx)}
        />
      )}
    </div>
  );
}
