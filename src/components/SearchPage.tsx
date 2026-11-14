import { useState, useEffect } from 'react';
import { Search, X, ArrowLeft, Film } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, getDocs, getDocsFromServer } from 'firebase/firestore';
import { db } from '../firebase';
import VideoPlayerModal from './VideoPlayerModal';
import MovieCard from './MovieCard';
import { fetchMoviesFromFirestore, sortMoviesList } from '../services/movieStorage';
import { normalizeMoviePosters } from '../utils/posterUrl';

const GENRES = [
  "Action", "Adult", "Adventure", "Animation", "Animated Series", "Anime", "Biography", "Ceremony",
  "Comedy", "Concert", "Crime", "Detective", "Documentary", "Drama", "Family", "Fantasy",
  "Film Noir", "Game Show", "History", "Horror", "Kids", "Music", "Musical", "News",
  "Reality TV", "Romance", "Sci-Fi", "Short Film", "Sport", "Talk Show", "Thriller", "War", "Western"
];

export default function SearchPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [playingMovie, setPlayingMovie] = useState<any | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (searchQuery.trim().length < 2 && selectedGenres.length === 0) {
      setResults([]);
      return;
    }

    const delayDebounceFn = setTimeout(() => {
      handleSearch();
    }, 350);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, selectedGenres]);

  const handleSearch = async () => {
    setIsLoading(true);
    try {
      let list: any[] = [];
      try {
        let snapshot;
        try {
          snapshot = await getDocsFromServer(collection(db, 'movies'));
        } catch {
          snapshot = await getDocs(collection(db, 'movies'));
        }
        list = sortMoviesList(
          snapshot.docs
            .map((d) => normalizeMoviePosters({ id: d.id, ...d.data() }))
            .filter((m: any) => m.published !== false && !m.id?.startsWith('sample-'))
        );
      } catch (e: any) {
        console.warn('Search falling back to storage service:', e?.message || e);
        list = (await fetchMoviesFromFirestore()).filter((m: any) => m.published !== false);
      }

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

      setResults(list);
    } catch (err: any) {
      console.warn('Search error handled:', err?.message || err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  };

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-black text-white px-3 sm:px-4 pt-3 pb-[calc(5.5rem+env(safe-area-inset-bottom))] select-none">
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

      {/* Genre Chips */}
      <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-6 max-h-32 overflow-y-auto pr-1">
        {GENRES.map((genre) => (
          <button
            key={genre}
            type="button"
            onClick={() => toggleGenre(genre)}
            className={`px-2.5 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border cursor-pointer ${
              selectedGenres.includes(genre)
                ? 'bg-yellow-400 text-black border-yellow-400 shadow-lg shadow-yellow-400/20'
                : 'bg-neutral-900 text-gray-400 border-neutral-800 hover:border-gray-600'
            }`}
          >
            {genre}
          </button>
        ))}
      </div>

      {/* Search Results */}
      <div className="space-y-4">
        <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
          {isLoading
            ? 'Searching...'
            : results.length > 0
            ? `Results (${results.length})`
            : searchQuery.trim().length >= 2 || selectedGenres.length > 0
            ? 'No results found'
            : 'Type or pick genre to search'}
        </h3>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
          {results.map((movie) => (
            <MovieCard
              key={movie.id}
              movie={movie}
              onClick={() => {
                if (
                  movie.seasons &&
                  movie.seasons.length > 0 &&
                  movie.seasons[0].episodes?.length > 0 &&
                  movie.seasons[0].episodes[0].streamUrl
                ) {
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
                  setPlayingMovie(movie);
                }
              }}
            />
          ))}
        </div>

        {!isLoading && results.length === 0 && searchQuery.trim().length < 2 && selectedGenres.length === 0 && (
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
            setResults([]);
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

      {playingMovie && (
        <VideoPlayerModal
          isOpen={Boolean(playingMovie)}
          onClose={() => setPlayingMovie(null)}
          title={playingMovie.title}
          videoUrl={playingMovie.streamingUrl || ''}
          videoQualities={playingMovie.videoQualities}
          category={playingMovie.displayCategory}
          posterUrl={playingMovie.posterUrl}
          movie={playingMovie.movie || playingMovie}
          seasonIndex={playingMovie.seasonIndex ?? 0}
          episodeIndex={playingMovie.episodeIndex ?? 0}
          language={playingMovie.language}
        />
      )}
    </div>
  );
}
