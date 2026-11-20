import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import {
  Bookmark,
  ThumbsUp,
  History,
  Bell,
  Settings,
  ChevronRight,
  X,
  Play,
  Trash2,
  Film,
  LogOut,
  CheckCircle2,
} from 'lucide-react';
import { collection, doc, getDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { loginWithGoogle } from '../services/authService';
import {
  fetchMyList,
  removeFromMyList,
  addToMyList,
  fetchMyLikes,
  removeFromMyLikes,
  fetchWatchHistory,
  removeWatchHistoryItem,
  clearWatchHistory,
  saveWatchProgress,
  MyListItem,
  MyLikeItem,
  WatchHistoryItem,
} from '../services/userWatchService';
import { getLocalMovies, getTimestampMs, getEpisodeDisplayLabel } from '../services/movieStorage';
import { upgradePosterUrl } from '../utils/posterUrl';
import { parseDurationToSeconds } from '../utils/duration';
import MovieDetailsModal from './MovieDetailsModal';
import VideoPlayerModal from './VideoPlayerModal';

type MeSheet = 'none' | 'my_list' | 'my_likes' | 'messages';

interface MessageEntry {
  id: string;
  movieId?: string;
  title: string;
  body: string;
  posterUrl?: string;
  createdAtMs: number;
}

const MESSAGES_SEEN_AT_KEY = 'mp_messages_last_seen_ms';

export default function MePage() {
  const navigate = useNavigate();
  const { user, handleLogout } = useAuth();
  const uid = user?.uid || 'guest_user';

  const [myList, setMyList] = useState<MyListItem[]>([]);
  const [myLikes, setMyLikes] = useState<MyLikeItem[]>([]);
  const [messages, setMessages] = useState<MessageEntry[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const [activeSheet, setActiveSheet] = useState<MeSheet>('none');
  const [authBusy, setAuthBusy] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [selectedMovie, setSelectedMovie] = useState<any | null>(null);
  const [playingMovie, setPlayingMovie] = useState<any | null>(null);
  const [activeSeasonIndex, setActiveSeasonIndex] = useState(0);

  const selectedMovieRef = useRef(selectedMovie);
  const playingMovieRef = useRef(playingMovie);
  const activeSheetRef = useRef(activeSheet);
  const ignoringPopstateRef = useRef(0);
  const ignoreResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    selectedMovieRef.current = selectedMovie;
  }, [selectedMovie]);

  useEffect(() => {
    playingMovieRef.current = playingMovie;
  }, [playingMovie]);

  useEffect(() => {
    activeSheetRef.current = activeSheet;
  }, [activeSheet]);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2600);
  };

  const refreshUserCollections = async () => {
    const [listRes, likesRes] = await Promise.all([
      fetchMyList(uid).catch(() => []),
      fetchMyLikes(uid).catch(() => []),
    ]);
    setMyList(listRes);
    setMyLikes(likesRes);
  };

  const loadMessages = async () => {
    const entriesMap = new Map<string, MessageEntry>();
    try {
      const mirrorSnap = await getDoc(doc(db, 'admins', 'latest_release_notification'));
      if (mirrorSnap.exists()) {
        const d: any = mirrorSnap.data() || {};
        try {
          const parsed = JSON.parse(String(d.itemsJson || '[]'));
          if (Array.isArray(parsed)) {
            for (const entry of parsed) {
              if (!entry) continue;
              const id = String(entry.id || entry.movieId || entry.createdAtMs || Math.random());
              entriesMap.set(id, {
                id,
                movieId: entry.movieId ? String(entry.movieId) : undefined,
                title: String(entry.title || 'New Release'),
                body: String(entry.message || entry.notificationBody || 'Stream or download now'),
                posterUrl: entry.posterUrl,
                createdAtMs: getTimestampMs(entry.createdAtMs || entry.createdAt) || Date.now(),
              });
            }
          }
        } catch {}
        if (entriesMap.size === 0 && d.title) {
          const id = String(d.latestId || 'latest_release');
          entriesMap.set(id, {
            id,
            movieId: d.movieId ? String(d.movieId) : undefined,
            title: String(d.title),
            body: String(d.message || 'New release available'),
            posterUrl: d.posterUrl,
            createdAtMs: Number(d.createdAtMs) || Date.now(),
          });
        }
      }
    } catch {}

    try {
      const annSnap = await getDocs(collection(db, 'announcements'));
      annSnap.docs.forEach((docSnap) => {
        const data: any = docSnap.data() || {};
        entriesMap.set(docSnap.id, {
          id: docSnap.id,
          movieId: data.movieId ? String(data.movieId) : undefined,
          title: String(data.title || 'Announcement'),
          body: String(data.message || data.notificationBody || 'New release available'),
          posterUrl: data.posterUrl,
          createdAtMs: getTimestampMs(data.createdAtMs || data.createdAt) || Date.now(),
        });
      });
    } catch {}

    const sorted = Array.from(entriesMap.values()).sort((a, b) => b.createdAtMs - a.createdAtMs);
    setMessages(sorted);
    const lastSeen = Number(localStorage.getItem(MESSAGES_SEEN_AT_KEY) || '0');
    setUnreadCount(sorted.filter((m) => m.createdAtMs > lastSeen).length);
  };

  useEffect(() => {
    refreshUserCollections();
    loadMessages();
  }, [uid]);

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
    refreshUserCollections();
    if (window.history.state?.appModal === 'player') {
      popHistoryEntrySilently();
    }
  };

  const closeMovieDetails = () => {
    if (!selectedMovieRef.current) return;
    selectedMovieRef.current = null;
    setSelectedMovie(null);
    refreshUserCollections();
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
      if (activeSheetRef.current !== 'none') {
        setActiveSheet('none');
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
            if (activeSheetRef.current !== 'none') {
              setActiveSheet('none');
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
        const eLabel = getEpisodeDisplayLabel(ep, eIdx, true);
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

  const handleLoginClick = async () => {
    setAuthBusy(true);
    try {
      const res: any = await loginWithGoogle();
      if (res?.cancelled) {
        showToast('Sign-in cancelled');
      } else if (res?.user || res?.sessionUser) {
        showToast('Signed in successfully');
        setTimeout(() => refreshUserCollections(), 300);
      } else if (res?.errorMessage) {
        showToast(res.errorMessage);
      }
    } catch {
      showToast('Could not complete sign-in');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleOpenMessages = () => {
    setActiveSheet('messages');
    const latestMs = messages.length > 0 ? messages[0].createdAtMs : Date.now();
    try {
      localStorage.setItem(MESSAGES_SEEN_AT_KEY, String(Math.max(latestMs, Date.now())));
      window.dispatchEvent(new CustomEvent('mp_messages_read'));
    } catch {}
    setUnreadCount(0);
  };

  const resolveLiveMovie = (item: any) => {
    const localMovies = getLocalMovies();
    const match = localMovies.find(
      (m) => m.id === item.movieId || (m.imdbId && m.imdbId === item.movieId)
    );
    return match || item.movieData || item;
  };

  const allLocalMovies = getLocalMovies().filter((m: any) => m.published !== false);

  return (
    <div className="min-h-[100dvh] w-full bg-[#111317] text-white px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[calc(6rem+env(safe-area-inset-bottom))] select-none">
      {toastMsg && (
        <div className="fixed top-[max(1rem,env(safe-area-inset-top))] left-1/2 -translate-x-1/2 z-[120] bg-[#1e222b] border border-white/15 text-white text-xs font-semibold px-4 py-2 rounded-full shadow-2xl flex items-center gap-2">
          <CheckCircle2 size={14} className="text-[#00d664]" />
          <span>{toastMsg}</span>
        </div>
      )}

      <div className="max-w-lg mx-auto space-y-5 pt-2">
        {/* Top Account Header Card (matching Screenshot 3) */}
        <div className="flex items-center justify-between gap-3 py-2">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-bold text-white truncate">
              {user ? user.displayName || user.email?.split('@')[0] || 'Account' : 'Log in to your account'}
            </h1>
            <div className="mt-1.5 inline-flex items-center px-2 py-0.5 rounded bg-[#23262e] text-[11px] font-medium text-neutral-400 max-w-full truncate">
              ID: {user?.uid || 'Guest'}
            </div>
          </div>

          {user ? (
            <button
              type="button"
              onClick={async () => {
                await handleLogout();
                showToast('Signed out');
              }}
              className="flex-shrink-0 px-4 py-2 rounded-lg bg-[#232730] hover:bg-[#2c313c] border border-white/10 text-neutral-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer active:scale-95"
            >
              <LogOut size={14} />
              <span>Sign out</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLoginClick}
              disabled={authBusy}
              className="flex-shrink-0 px-5 py-2 rounded-lg bg-[#00d664] hover:bg-[#00bf59] disabled:opacity-60 text-black text-sm font-bold cursor-pointer active:scale-95 transition-all"
            >
              {authBusy ? 'Wait...' : 'Log in'}
            </button>
          )}
        </div>

        {/* Menu Group 1: My List, My Likes, Watch History, Messages (Screenshot 3 exact items) */}
        <div className="bg-[#1b1e24] rounded-2xl border border-white/[0.06] divide-y divide-white/[0.06] overflow-hidden shadow-lg">
          <button
            type="button"
            onClick={() => setActiveSheet('my_list')}
            className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3.5">
              <Bookmark size={20} className="text-neutral-200 stroke-[1.9]" />
              <span className="text-sm sm:text-[15px] font-medium text-white">My List</span>
            </div>
            <div className="flex items-center gap-2 text-neutral-400">
              <span className="text-xs sm:text-sm font-medium">{myList.length}</span>
              <ChevronRight size={17} />
            </div>
          </button>

          <button
            type="button"
            onClick={() => setActiveSheet('my_likes')}
            className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3.5">
              <ThumbsUp size={20} className="text-neutral-200 stroke-[1.9]" />
              <span className="text-sm sm:text-[15px] font-medium text-white">My Likes</span>
            </div>
            <div className="flex items-center gap-2 text-neutral-400">
              <span className="text-xs sm:text-sm font-medium">{myLikes.length}</span>
              <ChevronRight size={17} />
            </div>
          </button>



          <button
            type="button"
            onClick={handleOpenMessages}
            className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3.5">
              <Bell size={20} className="text-neutral-200 stroke-[1.9]" />
              <span className="text-sm sm:text-[15px] font-medium text-white">Messages</span>
            </div>
            <div className="flex items-center gap-2 text-neutral-400">
              {unreadCount > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-red-600 text-white text-[11px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
              <ChevronRight size={17} />
            </div>
          </button>
        </div>

        {/* Menu Group 2: Settings ONLY (Community, Posts, My Comments, Study Mode, Feedback removed) */}
        <div className="bg-[#1b1e24] rounded-2xl border border-white/[0.06] overflow-hidden shadow-lg">
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="w-full px-4 py-4 flex items-center justify-between hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors cursor-pointer text-left"
          >
            <div className="flex items-center gap-3.5">
              <Settings size={20} className="text-neutral-200 stroke-[1.9]" />
              <span className="text-sm sm:text-[15px] font-medium text-white">Settings</span>
            </div>
            <ChevronRight size={17} className="text-neutral-400" />
          </button>
        </div>
      </div>

      {/* SHEET MODAL FOR MY LIST / MY LIKES / WATCH HISTORY / MESSAGES */}
      {activeSheet !== 'none' && (
        <div className="fixed inset-0 z-[75] bg-[#111317] flex flex-col overflow-hidden animate-in fade-in duration-150">
          <header className="px-4 py-3.5 pt-[max(0.85rem,env(safe-area-inset-top))] border-b border-white/[0.08] flex items-center justify-between bg-[#16191f]">
            <div className="flex items-center gap-2.5">
              <h2 className="text-base sm:text-lg font-bold text-white">
                {activeSheet === 'my_list'
                  ? 'My List'
                  : activeSheet === 'my_likes'
                  ? 'My Likes'
                  : 'Messages'}
              </h2>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setActiveSheet('none')}
                className="p-2 rounded-full bg-white/10 hover:bg-white/15 text-white cursor-pointer"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
            {/* MY LIST SHEET */}
            {activeSheet === 'my_list' && (
              myList.length === 0 ? (
                <div className="py-20 text-center text-neutral-400">
                  <Film size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">Your list is empty</p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Tap "Add to list" on any movie or series to save it here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
                  {myList.map((item) => {
                    const movieObj = resolveLiveMovie(item);
                    const poster = upgradePosterUrl(movieObj.posterUrl || item.posterUrl, 500) || item.posterUrl;
                    return (
                      <div key={item.movieId} className="space-y-1.5 group">
                        <div
                          onClick={() => openMovieDetails(movieObj)}
                          className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[#1a1d24] border border-white/[0.06] cursor-pointer"
                        >
                          <img src={poster} alt={item.title} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await removeFromMyList(uid, item.movieId);
                              setMyList((prev) => prev.filter((x) => x.movieId !== item.movieId));
                            }}
                            className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/75 text-neutral-300 hover:text-red-400 flex items-center justify-center cursor-pointer"
                            title="Remove"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <p className="text-xs text-neutral-200 font-medium truncate">{item.title}</p>
                      </div>
                    );
                  })}
                </div>
              )
            )}

            {/* MY LIKES SHEET */}
            {activeSheet === 'my_likes' && (
              myLikes.length === 0 ? (
                <div className="py-20 text-center text-neutral-400">
                  <ThumbsUp size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">No liked titles yet</p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Tap "Like" on any movie or series to save it here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-w-2xl mx-auto">
                  {myLikes.map((item) => {
                    const movieObj = resolveLiveMovie(item);
                    const poster = upgradePosterUrl(movieObj.posterUrl || item.posterUrl, 500) || item.posterUrl;
                    return (
                      <div key={item.movieId} className="space-y-1.5">
                        <div
                          onClick={() => openMovieDetails(movieObj)}
                          className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[#1a1d24] border border-white/[0.06] cursor-pointer"
                        >
                          <img src={poster} alt={item.title} className="w-full h-full object-cover" />
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              await removeFromMyLikes(uid, item.movieId);
                              setMyLikes((prev) => prev.filter((x) => x.movieId !== item.movieId));
                            }}
                            className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/75 text-neutral-300 hover:text-red-400 flex items-center justify-center cursor-pointer"
                            title="Unlike"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <p className="text-xs text-neutral-200 font-medium truncate">{item.title}</p>
                      </div>
                    );
                  })}
                </div>
              )
            )}



            {/* MESSAGES SHEET */}
            {activeSheet === 'messages' && (
              messages.length === 0 ? (
                <div className="py-20 text-center text-neutral-400">
                  <Bell size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">No messages right now</p>
                </div>
              ) : (
                <div className="space-y-3 max-w-xl mx-auto">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      onClick={() => {
                        if (!msg.movieId) return;
                        const match = allLocalMovies.find(
                          (m) => m.id === msg.movieId || m.imdbId === msg.movieId
                        );
                        if (match) {
                          openMovieDetails(match);
                        } else {
                          try {
                            sessionStorage.setItem('mp_pending_open_movie_id', msg.movieId);
                          } catch {}
                          navigate('/');
                        }
                      }}
                      className="flex items-center gap-3 bg-[#1a1d24] border border-white/[0.06] rounded-xl p-3 cursor-pointer hover:bg-[#222630]"
                    >
                      {msg.posterUrl ? (
                        <img
                          src={upgradePosterUrl(msg.posterUrl, 300) || msg.posterUrl}
                          alt={msg.title}
                          className="w-12 h-16 rounded-lg object-cover flex-shrink-0 bg-black"
                        />
                      ) : (
                        <div className="w-12 h-16 rounded-lg bg-[#00d664]/15 text-[#00d664] flex items-center justify-center flex-shrink-0">
                          <Bell size={20} />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-white truncate">{msg.title}</h4>
                        <p className="text-xs text-neutral-300 line-clamp-2 mt-0.5">{msg.body}</p>
                        <p className="text-[11px] text-neutral-500 mt-1">
                          {new Date(msg.createdAtMs).toLocaleDateString()}
                        </p>
                      </div>
                      {msg.movieId && <ChevronRight size={16} className="text-neutral-500 flex-shrink-0" />}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Movie Details Modal */}
      {selectedMovie && !playingMovie && (
        <MovieDetailsModal
          isOpen={Boolean(selectedMovie)}
          movie={selectedMovie}
          onClose={closeMovieDetails}
          onWatchNow={(m, sIdx, eIdx, lang) => handleWatchNow(m, sIdx, eIdx, lang)}
          allMovies={allLocalMovies}
          userId={uid}
          isSavedInMyList={Boolean(
            selectedMovie &&
              myList.some((x) => x.movieId === (selectedMovie.id || selectedMovie.imdbId))
          )}
          onToggleMyList={async (m) => {
            const movieId = m.id || m.imdbId;
            if (!movieId) return;
            const exists = myList.some((x) => x.movieId === movieId);
            if (exists) {
              await removeFromMyList(uid, movieId);
            } else {
              await addToMyList(uid, m);
            }
            refreshUserCollections();
          }}
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
            const m = playingMovie.movie || playingMovie;
            if (m?.id) saveWatchProgress(uid, m, curr, dur).catch(() => {});
          }}
        />
      )}
    </div>
  );
}
