import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, ArrowLeft, Film } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import VideoPlayerModal from './VideoPlayerModal';
import MovieDetailsModal from './MovieDetailsModal';
import MovieCard from './MovieCard';
import { parseDurationToSeconds } from '../utils/duration';
import { saveWatchProgress } from '../services/userWatchService';
import { useAuth } from '../context/AuthContext';
import { useMovies } from '../context/MoviesContext';
import { getAppPreferences, isMatureContent } from '../services/userPreferencesService';
import { getEpisodeDisplayLabel } from '../services/movieStorage';

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
  const [playingMovie, setPlayingMovie] = useState<any | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [activeSeasonIndex, setActiveSeasonIndex] = useState(0);
  const [familyMode, setFamilyMode] = useState<boolean>(() => getAppPreferences().familyMode);
  const navigate = useNavigate();

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

  const openMovieDetails = (movie: any) => {
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
        const epDurationSec =
          (typeof ep.durationSec === 'number' && ep.durationSec > 0 ? ep.durationSec : 0) ||
          parseDurationToSeconds(ep.duration) ||
          movieDurationSec;
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
    await refreshMovies(true);
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-black text-white px-3 sm:px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(5.5rem+env(safe-area-inset-bottom))] select-none">
      <div className="flex items-center gap-2.5 sm:gap-3 bg-neutral-900 border border-neutral-800 px-3 py-2.5 rounded-xl mb-5 shadow-lg sticky top-2 z-20 min-w-0">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="text-yellow-400 cursor-pointer p-1 hover:scale-110 transition-transform flex-shrink-0"
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
          placeholder="Search movies, series, anime..."
          className="bg-transparent flex-grow min-w-0 outline-none text-sm text-white placeholder-gray-500"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="text-gray-400 hover:text-white p-1 flex-shrink-0 cursor-pointer"
            aria-label="Clear search"
          >
            <X size={18} className="text-yellow-400" />
          </button>
        )}
      </div>

      {/* All Genres Visible Immediately */}
      <div className="mb-6">
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

      {/* Search Results */}
      <div className="space-y-4">
        <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
          {isLoading
            ? 'Searching...'
            : results.length > 0
            ? `Results (${results.length})`
            : searchQuery.trim().length >= 1 || selectedGenres.length > 0
            ? 'No results found'
            : 'Type or pick genre to search'}
        </h3>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
          {results.map((movie) => (
            <MovieCard
              key={movie.id}
              movie={movie}
              onClick={() => handleWatchNow(movie)}
            />
          ))}
        </div>

        {!isLoading && results.length === 0 && searchQuery.trim().length < 1 && selectedGenres.length === 0 && (
          <div className="py-16 text-center text-neutral-800 flex flex-col items-center">
            <Film size={56} className="mb-4 opacity-20" />
            <p className="text-xs sm:text-sm font-bold uppercase tracking-widest opacity-40">
              Find your next favorite
            </p>
          </div>
        )}
      </div>

      {/* Filter Actions */}
      <div className="fixed bottom-0 left-0 right-0 w-full px-3 sm:px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-black/90 backdrop-blur-md flex gap-2.5 border-t border-neutral-900 z-30">
        <button
          type="button"
          className="flex-1 bg-neutral-900 text-gray-300 py-3 rounded-xl text-xs font-bold uppercase border border-neutral-800 hover:bg-neutral-800 transition-colors cursor-pointer"
          onClick={() => {
            setSelectedGenres([]);
            setSearchQuery('');
          }}
        >
          Reset All
        </button>
        <button
          type="button"
          className="flex-1 bg-yellow-400 text-black py-3 rounded-xl text-xs font-black uppercase shadow-lg shadow-yellow-400/20 active:scale-95 transition-all cursor-pointer"
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
