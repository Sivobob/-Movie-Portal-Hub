import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Box, FolderOpen, RefreshCw, Play, Inbox, Trash2 } from 'lucide-react';
import { useDownloads } from '../hooks/useDownloads';
import DownloadsView from './DownloadsView';
import MovieDetailsModal from './MovieDetailsModal';
import VideoPlayerModal from './VideoPlayerModal';
import { useAuth } from '../context/AuthContext';
import {
  fetchMoviesFromFirestore,
  getLocalMovies,
  sortMoviesList,
} from '../services/movieStorage';
import {
  addToMyList,
  fetchMyList,
  removeFromMyList,
  saveWatchProgress,
} from '../services/userWatchService';
import { getAppPreferences, isMatureContent } from '../services/userPreferencesService';
import { upgradePosterUrl } from '../utils/posterUrl';
import { parseDurationToSeconds } from '../utils/duration';
import { getOfflineVideoPlayableUrl } from '../services/offlineStorage';

type DownloadTab = 'moviebox' | 'local' | 'received';

interface LocalPickedVideo {
  id: string;
  name: string;
  sizeLabel: string;
  objectUrl: string;
}

export default function DownloadsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    downloads,
    activeDownloads,
    removeDownload,
    cancelActiveDownload,
    pauseActiveDownload,
    resumeActiveDownload,
  } = useDownloads();

  const [activeTab, setActiveTab] = useState<DownloadTab>('moviebox');
  const [storageLabel, setStorageLabel] = useState<string>('');
  const [allMovies, setAllMovies] = useState<any[]>(() =>
    sortMoviesList(getLocalMovies().filter((m: any) => m.published !== false))
  );
  const [familyMode, setFamilyMode] = useState<boolean>(() => getAppPreferences().familyMode);
  const [forYouOffset, setForYouOffset] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [localFiles, setLocalFiles] = useState<LocalPickedVideo[]>([]);
  const localFileInputRef = useRef<HTMLInputElement | null>(null);

  const [myListIds, setMyListIds] = useState<Set<string>>(new Set());
  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [playingMovie, setPlayingMovie] = useState<any | null>(null);
  const [activeSeasonIndex, setActiveSeasonIndex] = useState<number>(0);
  const [offlineAlert, setOfflineAlert] = useState<string | null>(null);

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

  useEffect(() => {
    const onPrefs = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail && typeof detail.familyMode === 'boolean') {
        setFamilyMode(detail.familyMode);
      } else {
        setFamilyMode(getAppPreferences().familyMode);
      }
    };
    window.addEventListener('mp_preferences_updated', onPrefs);
    return () => window.removeEventListener('mp_preferences_updated', onPrefs);
  }, []);

  // Load real device storage availability via navigator.storage.estimate()
  useEffect(() => {
    let active = true;
    const loadEstimate = async () => {
      try {
        if (navigator?.storage?.estimate) {
          const est = await navigator.storage.estimate();
          if (!active) return;
          if (typeof est.quota === 'number' && est.quota > 0) {
            const availBytes = Math.max(0, est.quota - (est.usage || 0));
            const availGb = availBytes / (1024 * 1024 * 1024);
            if (availGb >= 0.1) {
              setStorageLabel(`${availGb.toFixed(1)}GB available`);
              return;
            }
          }
        }
      } catch {}

      const usedMb = downloads.reduce((acc, item) => {
        const raw = item.fileSize || '0 MB';
        if (raw.includes('GB')) return acc + (parseFloat(raw) || 0) * 1024;
        return acc + (parseFloat(raw) || 0);
      }, 0);
      if (active) {
        setStorageLabel(
          usedMb > 1024 ? `${(usedMb / 1024).toFixed(1)} GB used` : `${usedMb.toFixed(0)} MB used`
        );
      }
    };
    loadEstimate();
    return () => {
      active = false;
    };
  }, [downloads]);

  // Load live catalog from Firestore & user's My List
  useEffect(() => {
    let mounted = true;
    fetchMoviesFromFirestore()
      .then((list) => {
        if (mounted && Array.isArray(list) && list.length > 0) {
          setAllMovies(sortMoviesList(list.filter((m: any) => m.published !== false)));
        }
      })
      .catch(() => {});

    const uid = user?.uid || 'guest_user';
    fetchMyList(uid)
      .then((items) => {
        if (mounted) {
          setMyListIds(new Set(items.map((i) => i.movieId)));
        }
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [user?.uid]);

  // Cleanup local object URLs on unmount
  useEffect(() => {
    return () => {
      localFiles.forEach((f) => {
        try {
          URL.revokeObjectURL(f.objectUrl);
        } catch {}
      });
    };
  }, []);

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
      import('@capacitor/app')
        .then(({ App: CapApp }) => {
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
            navigate('/');
          });
        })
        .catch(() => {});
    }

    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (ignoreResetTimerRef.current) clearTimeout(ignoreResetTimerRef.current);
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
      const sIdx = Math.max(0, Math.min(seasonIndex, movie.seasons.length - 1));
      const season = movie.seasons[sIdx];
      const episodes = season?.episodes || [];
      const eIdx = Math.max(0, Math.min(episodeIndex, episodes.length - 1));
      const ep = episodes[eIdx];

      const epStream = String(
        ep?.streamUrl || ep?.videoQualities?.['720p'] || ep?.videoQualities?.['1080p'] || ''
      ).trim();

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
        const eLabel = String(ep.episodeNumber || eIdx + 1).padStart(2, '0');
        const nextPlaying = {
          title: `${movie.title} - S${sLabel}E${eLabel}: ${ep.title}`,
          streamingUrl: epStream,
          displayCategory: movie.displayCategory,
          posterUrl: movie.posterUrl,
          movie,
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

    if (movie.streamingUrl) {
      if (movieDurationSec > 0 || resumeTime > 0) {
        saveWatchProgress(uid, movie, resumeTime, movieDurationSec).catch(() => {});
      }
      pushPlayerHistory();
      const nextPlaying = {
        ...movie,
        streamingUrl: movie.streamingUrl.trim(),
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

  const handleToggleMyList = async (movie: any) => {
    const uid = user?.uid || 'guest_user';
    const movieId = movie.id || movie.imdbId;
    if (!movieId) return;
    if (myListIds.has(movieId)) {
      await removeFromMyList(uid, movieId);
      setMyListIds((prev) => {
        const next = new Set(prev);
        next.delete(movieId);
        return next;
      });
    } else {
      await addToMyList(uid, movie);
      setMyListIds((prev) => new Set(prev).add(movieId));
    }
  };

  const filteredPool = useMemo(() => {
    return familyMode ? allMovies.filter((m) => !isMatureContent(m)) : allMovies;
  }, [allMovies, familyMode]);

  const forYouSlice = useMemo(() => {
    if (filteredPool.length === 0) return [];
    const count = Math.min(6, filteredPool.length);
    const result: any[] = [];
    for (let i = 0; i < count; i++) {
      result.push(filteredPool[(forYouOffset + i) % filteredPool.length]);
    }
    return result;
  }, [filteredPool, forYouOffset]);

  const handleRefreshContent = async () => {
    setIsRefreshing(true);
    try {
      const fresh = await fetchMoviesFromFirestore();
      if (Array.isArray(fresh) && fresh.length > 0) {
        setAllMovies(sortMoviesList(fresh.filter((m: any) => m.published !== false)));
      }
    } catch {}
    setForYouOffset((prev) => (filteredPool.length > 0 ? (prev + 3) % filteredPool.length : 0));
    setTimeout(() => setIsRefreshing(false), 350);
  };

  const handlePickLocalFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const added: LocalPickedVideo[] = Array.from(files).map((file, idx) => {
      const mb = file.size / (1024 * 1024);
      const sizeLabel = mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(mb))} MB`;
      return {
        id: `local-${Date.now()}-${idx}`,
        name: file.name.replace(/\.[^/.]+$/, ''),
        sizeLabel,
        objectUrl: URL.createObjectURL(file),
      };
    });
    setLocalFiles((prev) => [...added, ...prev]);
    e.target.value = '';
  };

  const handlePlayOfflineItem = async (item: any) => {
    setOfflineAlert(null);
    const offlineKey = item?.offlineKey || item?.id;
    const offlinePlayableUrl = await getOfflineVideoPlayableUrl(offlineKey, item?.localUri).catch(() => null);

    if (offlinePlayableUrl) {
      handleWatchNow({
        ...item,
        seasons: undefined,
        videoQualities: undefined,
        streamingUrl: offlinePlayableUrl,
      });
      return;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setOfflineAlert(`"${item?.title || 'Video'}" is not cached for offline playback yet. Connect to the internet to re-download or stream.`);
      setTimeout(() => setOfflineAlert(null), 4500);
      return;
    }

    handleWatchNow({
      ...item,
      seasons: undefined,
      streamingUrl: item.videoUrl || item.streamingUrl || '',
    });
  };

  const hasDownloads = activeDownloads.length > 0 || downloads.length > 0;

  return (
    <div className="min-h-[100dvh] w-full bg-[#111317] text-white px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))] select-none">
      {offlineAlert && (
        <div className="fixed top-[max(0.75rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[125] w-[calc(100%-2rem)] max-w-md bg-red-950/95 border border-red-500/40 text-red-200 text-xs font-semibold px-4 py-3 rounded-2xl shadow-2xl">
          {offlineAlert}
        </div>
      )}
      <div className="max-w-2xl mx-auto space-y-5">
        {/* Top Bar: Downloads title ONLY (Transfer button intentionally removed) */}
        <header className="flex items-center justify-between pt-1">
          <h1 className="text-2xl font-bold text-white tracking-tight">Downloads</h1>
        </header>

        {/* Downloaded Subheader & Storage Availability */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white">Downloaded</h2>
            {storageLabel && (
              <span className="text-xs sm:text-sm text-neutral-400 font-medium">{storageLabel}</span>
            )}
          </div>

          {/* Tabs: MovieBox+ | Local files | Received */}
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none pb-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('moviebox')}
              className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'moviebox'
                  ? 'bg-white text-black'
                  : 'bg-[#22262e] text-neutral-300 hover:bg-[#2a2f39]'
              }`}
            >
              MovieBox+
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('local')}
              className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'local'
                  ? 'bg-white text-black'
                  : 'bg-[#22262e] text-neutral-300 hover:bg-[#2a2f39]'
              }`}
            >
              Local files
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('received')}
              className={`px-4 py-1.5 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                activeTab === 'received'
                  ? 'bg-white text-black'
                  : 'bg-[#22262e] text-neutral-300 hover:bg-[#2a2f39]'
              }`}
            >
              Received
            </button>
          </div>

          {/* Tab Body */}
          {activeTab === 'moviebox' && (
            hasDownloads ? (
              <div className="-mx-3 sm:-mx-4 pt-1">
                <DownloadsView
                  activeDownloads={activeDownloads}
                  completedDownloads={downloads}
                  onPlayMovie={(item) => handlePlayOfflineItem(item)}
                  onRemoveCompleted={removeDownload}
                  onCancelActive={cancelActiveDownload}
                  onPauseActive={pauseActiveDownload}
                  onResumeActive={resumeActiveDownload}
                  onBrowseMovies={() => navigate('/')}
                />
              </div>
            ) : (
              <div className="py-10 flex flex-col items-center justify-center text-center">
                <div className="w-20 h-20 rounded-2xl bg-[#191c22] border border-white/[0.06] flex items-center justify-center text-neutral-500 mb-3.5 shadow-inner">
                  <Box size={38} className="stroke-[1.5]" />
                </div>
                <p className="text-xs sm:text-sm text-neutral-400 mb-4">
                  Your downloads will show up here
                </p>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="px-5 py-2.5 rounded-lg bg-[#2a2d35] hover:bg-[#353943] text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer active:scale-95"
                >
                  Find more free sources
                </button>
              </div>
            )
          )}

          {activeTab === 'local' && (
            <div className="space-y-3 py-4">
              <input
                ref={localFileInputRef}
                type="file"
                accept="video/*"
                multiple
                onChange={handlePickLocalFile}
                className="hidden"
              />
              {localFiles.length > 0 ? (
                <div className="space-y-2">
                  {localFiles.map((file) => (
                    <div
                      key={file.id}
                      className="flex items-center justify-between gap-3 bg-[#1a1d24] border border-white/[0.06] rounded-xl p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-white truncate">{file.name}</p>
                        <p className="text-xs text-neutral-400">{file.sizeLabel} • Local device</p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleWatchNow({
                            id: file.id,
                            title: file.name,
                            streamingUrl: file.objectUrl,
                            displayCategory: 'Local File',
                          })
                        }
                        className="px-3.5 py-2 rounded-lg bg-[#00d664] text-black text-xs font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Play size={13} fill="black" />
                        <span>Play</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            URL.revokeObjectURL(file.objectUrl);
                          } catch {}
                          setLocalFiles((prev) => prev.filter((x) => x.id !== file.id));
                        }}
                        className="p-2 rounded-lg bg-[#252932] text-neutral-400 hover:text-red-400 cursor-pointer"
                        aria-label="Remove local file"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => localFileInputRef.current?.click()}
                    className="w-full py-2.5 rounded-lg bg-[#22262e] hover:bg-[#2a2f39] text-neutral-200 text-xs font-semibold cursor-pointer"
                  >
                    + Add another local video
                  </button>
                </div>
              ) : (
                <div className="py-8 flex flex-col items-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-[#191c22] border border-white/[0.06] flex items-center justify-center text-neutral-500 mb-3">
                    <FolderOpen size={30} className="stroke-[1.6]" />
                  </div>
                  <p className="text-xs sm:text-sm text-neutral-400 mb-4">
                    Play MP4 / MKV videos stored on your device
                  </p>
                  <button
                    type="button"
                    onClick={() => localFileInputRef.current?.click()}
                    className="px-5 py-2.5 rounded-lg bg-[#2a2d35] hover:bg-[#353943] text-white text-xs sm:text-sm font-semibold cursor-pointer"
                  >
                    Select video from device
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'received' && (
            <div className="py-8 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#191c22] border border-white/[0.06] flex items-center justify-center text-neutral-500 mb-3">
                <Inbox size={30} className="stroke-[1.6]" />
              </div>
              <p className="text-xs sm:text-sm text-neutral-400 mb-4">
                No received files yet
              </p>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="px-5 py-2.5 rounded-lg bg-[#2a2d35] hover:bg-[#353943] text-white text-xs sm:text-sm font-semibold cursor-pointer"
              >
                Explore Home
              </button>
            </div>
          )}
        </section>

        {/* For You Recommendations Grid (Screenshot 5) */}
        {forYouSlice.length > 0 && (
          <section className="space-y-3 pt-1">
            <h2 className="text-base sm:text-lg font-bold text-white">For You</h2>
            <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
              {forYouSlice.map((item) => {
                const langBadge = item.language
                  ? String(item.language).split(/[,/|]/)[0].trim()
                  : '';
                return (
                  <button
                    key={item.id || item.imdbId}
                    type="button"
                    onClick={() => openMovieDetails(item)}
                    className="text-left group cursor-pointer focus:outline-none"
                  >
                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[#1a1d24] border border-white/[0.06] shadow-md">
                      <img
                        src={upgradePosterUrl(item.posterUrl, 500) || item.posterUrl}
                        alt={item.title}
                        loading="lazy"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      {langBadge && (
                        <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/75 text-white text-[10px] font-semibold backdrop-blur-sm">
                          {langBadge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-200 font-medium truncate mt-1.5">
                      {item.title}
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Refresh new content button */}
            <button
              type="button"
              onClick={handleRefreshContent}
              disabled={isRefreshing}
              className="w-full py-3 rounded-lg bg-[#22262e] hover:bg-[#2a2f39] text-neutral-200 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer active:scale-[0.99]"
            >
              <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
              <span>Refresh new content</span>
            </button>
          </section>
        )}
      </div>

      {/* Movie / Series Details Modal */}
      {selectedMovie && !playingMovie && (
        <MovieDetailsModal
          isOpen={Boolean(selectedMovie)}
          movie={selectedMovie}
          onClose={closeMovieDetails}
          onWatchNow={(m, sIdx, eIdx, lang) => handleWatchNow(m, sIdx, eIdx, lang)}
          allMovies={filteredPool}
          userId={user?.uid || 'guest_user'}
          isSavedInMyList={Boolean(
            selectedMovie && myListIds.has(selectedMovie.id || selectedMovie.imdbId)
          )}
          onToggleMyList={handleToggleMyList}
          onSelectMovie={(m) => {
            setActiveSeasonIndex(0);
            selectedMovieRef.current = m;
            setSelectedMovie(m);
          }}
          initialSeasonIndex={activeSeasonIndex}
        />
      )}

      {/* Video Player Modal */}
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
          movie={playingMovie.movie || playingMovie}
          seasonIndex={playingMovie.seasonIndex ?? 0}
          episodeIndex={playingMovie.episodeIndex ?? 0}
          language={playingMovie.language}
          initialDuration={playingMovie.initialDuration || playingMovie.duration || 0}
          initialTime={playingMovie.currentTime || 0}
          onEpisodeChange={(sIdx) => setActiveSeasonIndex(sIdx)}
          onProgress={(curr, dur) => {
            const uid = user?.uid || 'guest_user';
            const m = playingMovie.movie || playingMovie;
            if (m?.id) saveWatchProgress(uid, m, curr, dur).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
