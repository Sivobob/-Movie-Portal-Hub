import React, { useEffect, useState } from 'react';
import { X, Bookmark, Film, Trash2, Play } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchMyList, removeFromMyList, MyListItem } from '../services/userWatchService';
import { upgradePosterUrl } from '../utils/posterUrl';
import { getLocalMovies } from '../services/movieStorage';

interface MyListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMovie?: (movie: any) => void;
  onPlayMovie: (movie: any) => void;
}

export default function MyListModal({ isOpen, onClose, onPlayMovie }: MyListModalProps) {
  const { user } = useAuth();
  const [listItems, setListItems] = useState<MyListItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const loadList = async () => {
      setLoading(true);
      try {
        const uid = user?.uid || 'guest_user';
        const items = await fetchMyList(uid);
        setListItems(items);
      } catch (e) {
        console.error('Failed to load My List:', e);
      } finally {
        setLoading(false);
      }
    };
    loadList();
  }, [isOpen, user]);

  if (!isOpen) return null;

  const handleRemove = async (e: React.MouseEvent, movieId: string) => {
    e.stopPropagation();
    const uid = user?.uid || 'guest_user';
    await removeFromMyList(uid, movieId);
    setListItems((prev) => prev.filter((item) => item.movieId !== movieId));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-3xl max-w-2xl w-full max-h-[85dvh] flex flex-col overflow-hidden shadow-2xl relative text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-600/20 border border-red-600/40 flex items-center justify-center text-red-500">
              <Bookmark size={20} />
            </div>
            <h2 className="text-lg font-black uppercase tracking-tight">My List</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-white p-2 rounded-full bg-neutral-800 hover:bg-neutral-700 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 scrollbar-thin">
          {loading ? (
            <div className="py-20 text-center">
              <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-gray-400 uppercase tracking-widest">Loading My List...</p>
            </div>
          ) : listItems.length === 0 ? (
            <div className="py-20 text-center">
              <Film className="mx-auto mb-3 text-neutral-700" size={44} />
              <h3 className="text-lg font-black text-gray-400 uppercase tracking-wider mb-1">Your List is Empty</h3>
              <p className="text-xs text-gray-500 max-w-xs mx-auto">
                Tap &ldquo;My List&rdquo; on any movie or series to save it here for later viewing.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 sm:gap-4">
              {listItems.map((item) => {
                const liveMovies = getLocalMovies();
                const liveMatch = liveMovies.find(
                  (m) => m.id === item.movieId || (m.imdbId && m.imdbId === item.movieId)
                );
                const movie = liveMatch || item.movieData || item;
                const poster = upgradePosterUrl(movie.posterUrl || item.posterUrl, 600) || item.posterUrl;
                return (
                  <div
                    key={item.movieId}
                    onClick={() => {
                      onPlayMovie(movie);
                      onClose();
                    }}
                    className="group relative bg-neutral-950 rounded-xl overflow-hidden border border-neutral-800 hover:border-red-600/60 transition-all cursor-pointer flex flex-col shadow-lg"
                  >
                    <div className="relative aspect-[2/3] w-full bg-neutral-900 overflow-hidden">
                      <img
                        src={poster || 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=600'}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-2.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPlayMovie(movie);
                            onClose();
                          }}
                          className="w-9 h-9 rounded-full bg-red-600 text-white flex items-center justify-center shadow-md hover:scale-110 transition-transform cursor-pointer"
                          title="Play"
                        >
                          <Play size={16} fill="white" className="ml-0.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => handleRemove(e, item.movieId)}
                          className="w-9 h-9 rounded-full bg-black/70 text-red-400 border border-red-500/30 flex items-center justify-center shadow-md hover:bg-red-600 hover:text-white transition-colors cursor-pointer"
                          title="Remove from My List"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <div className="p-2.5 bg-neutral-900/90 flex-1 flex flex-col justify-between">
                      <h4 className="text-xs font-bold text-white truncate">{item.title}</h4>
                      <div className="flex items-center justify-between gap-2 mt-1">
                        <span className="text-[10px] text-gray-400 uppercase truncate">{item.displayCategory || 'Movie'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
