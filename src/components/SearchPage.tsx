import { useState, useEffect } from 'react';
import { Search, Mic, ArrowLeft, Film, Play, Star } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, getDocs, limit } from 'firebase/firestore';
import { db } from '../firebase';
import VideoPlayerModal from './VideoPlayerModal';
import MovieCard from './MovieCard';
import { getLocalMovies } from '../services/movieStorage';

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
    if (searchQuery.trim().length < 2) {
      setResults([]);
      return;
    }

    const delayDebounceFn = setTimeout(() => {
      handleSearch();
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery, selectedGenres]);

  const handleSearch = async () => {
    setIsLoading(true);
    try {
      let list: any[] = [];
      try {
        const q = query(collection(db, 'movies'), limit(100));
        const snapshot = await getDocs(q);
        list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter((m: any) => m.published !== false && !m.id?.startsWith('sample-'));
      } catch (e: any) {
        console.warn('Search falling back to local storage:', e?.message || e);
      }

      if (list.length === 0) {
        list = getLocalMovies().filter((m: any) => m.published !== false && !m.id?.startsWith('sample-'));
      }

      // Filter by title
      if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase();
        list = list.filter((m: any) => 
          m.title.toLowerCase().includes(lowerQuery) || 
          m.originalTitle?.toLowerCase().includes(lowerQuery)
        );
      }

      // Filter by genres
      if (selectedGenres.length > 0) {
        list = list.filter((m: any) => 
          selectedGenres.some(g => m.genre?.includes(g))
        );
      }

      setResults(list);
    } catch (err: any) {
      console.warn('Search error handled:', err?.message || err);
      const fallback = getLocalMovies().filter((m: any) => m.published !== false);
      setResults(fallback);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleGenre = (genre: string) => {
    setSelectedGenres(prev => 
      prev.includes(genre) ? prev.filter(g => g !== genre) : [...prev, genre]
    );
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 pb-24 select-none">
      <div className="flex items-center gap-4 bg-neutral-900 border border-neutral-800 p-3 rounded-xl mb-6 shadow-lg sticky top-0 z-20">
        <ArrowLeft onClick={() => navigate(-1)} className="text-yellow-400 cursor-pointer hover:scale-110 transition-transform" />
        <Search className="text-gray-500" size={20} />
        <input 
          type="text" 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search movies, series, anime..." 
          className="bg-transparent flex-grow outline-none text-sm placeholder-gray-600" 
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="text-gray-500 hover:text-white">
            <Mic size={20} className="text-yellow-400" />
          </button>
        )}
      </div>

      {/* Genre Chips */}
      <div className="flex flex-wrap gap-2 mb-8 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
        {GENRES.map(genre => (
          <button 
            key={genre}
            onClick={() => toggleGenre(genre)}
            className={`px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider transition-all border ${
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
        <h3 className="text-xs font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
          {isLoading ? 'Searching...' : results.length > 0 ? `Results (${results.length})` : searchQuery.length >= 2 ? 'No results found' : 'Type to search'}
        </h3>

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {results.map((movie) => (
            <MovieCard 
              key={movie.id} 
              movie={movie} 
              onClick={() => {
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
                  setPlayingMovie(movie);
                }
              }} 
            />
          ))}
        </div>

        {!isLoading && results.length === 0 && searchQuery.length < 2 && (
          <div className="py-20 text-center text-neutral-800 flex flex-col items-center">
            <Film size={64} className="mb-4 opacity-20" />
            <p className="text-sm font-bold uppercase tracking-widest opacity-30">Find your next favorite</p>
          </div>
        )}
      </div>

      {/* Filter Actions */}
      <div className="fixed bottom-0 left-0 w-full p-4 bg-black/80 backdrop-blur-md flex gap-3 border-t border-neutral-900">
        <button 
          className="flex-1 bg-neutral-900 text-gray-400 py-3 rounded-xl text-xs font-bold uppercase border border-neutral-800 hover:bg-neutral-800 transition-colors" 
          onClick={() => { setSelectedGenres([]); setSearchQuery(''); setResults([]); }}
        >
          Reset All
        </button>
        <button 
          className="flex-1 bg-yellow-400 text-black py-3 rounded-xl text-xs font-black uppercase shadow-lg shadow-yellow-400/20 active:scale-95 transition-all"
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
        />
      )}
    </div>
  );
}
