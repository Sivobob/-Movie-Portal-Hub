import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  MovieData,
  getLocalMovies,
  getCatalogFromIdb,
  fetchSeedCatalogJson,
  fetchMergedMoviesCatalog,
  getTimestampMs,
  saveLocalMovies,
  sortMoviesList,
} from '../services/movieStorage';
import { normalizeMoviePosters } from '../utils/posterUrl';
import { buildApiUrl } from '../utils/apiConfig';
import { hasPlayableContent, isSeriesComplete } from '../utils/seriesCompleteness';

interface MoviesContextValue {
  movies: MovieData[];
  isLoading: boolean;
  refreshMovies: (forceResubscribe?: boolean) => Promise<void>;
}

const MoviesContext = createContext<MoviesContextValue>({
  movies: [],
  isLoading: false,
  refreshMovies: async () => {},
});

const FOREGROUND_HEARTBEAT_MS = 8000;
const MIN_SERVER_SYNC_GAP_MS = 2000;

function hasRealPosterUrl(url?: string | null): boolean {
  const s = String(url || '').trim();
  return Boolean(s && s !== 'N/A' && (/^https?:\/\//i.test(s) || s.startsWith('/posters/')));
}

function countMovieEpisodes(movie?: MovieData | null): number {
  if (!movie || !Array.isArray(movie.seasons)) return 0;
  return movie.seasons.reduce((acc, s) => acc + (Array.isArray(s?.episodes) ? s.episodes.length : 0), 0);
}

function mergeMovieRecord(existing: MovieData | undefined, incoming: MovieData, preferIncoming: boolean): MovieData {
  if (!existing) return incoming;
  const existingUpdated = getTimestampMs(existing.updatedAt) || getTimestampMs(existing.createdAt) || 0;
  const incomingUpdated = getTimestampMs(incoming.updatedAt) || getTimestampMs(incoming.createdAt) || 0;
  const existingEpCount = countMovieEpisodes(existing);
  const incomingEpCount = countMovieEpisodes(incoming);
  const incomingHasMoreContent = incomingEpCount > existingEpCount;

  const incomingTgDate = getTimestampMs(incoming.telegramDateMs);
  const existingTgDate = getTimestampMs(existing.telegramDateMs);
  const preservedTgDate =
    incomingTgDate > 0 && existingTgDate > 0
      ? Math.min(incomingTgDate, existingTgDate)
      : incomingTgDate || existingTgDate || undefined;

  const incomingHasAuthenticSeedDate = incomingTgDate > 0 && existingTgDate <= 0;

  const existingBadge = String(existing.qualityBadge || '').trim().toUpperCase();
  const incomingBadge = String(incoming.qualityBadge || '').trim().toUpperCase();
  const incomingUpgradedFromPrint = existingBadge === 'HDTC' && incomingBadge === 'HD';

  const base = incomingUpgradedFromPrint
    ? incoming
    : preferIncoming
    ? existingUpdated > incomingUpdated &&
      !incomingHasMoreContent &&
      !incomingHasAuthenticSeedDate &&
      hasRealPosterUrl(existing.posterUrl)
      ? existing
      : incoming
    : incomingHasMoreContent || incomingUpdated > existingUpdated || incomingHasAuthenticSeedDate
    ? incoming
    : existing;

  const bestPoster = hasRealPosterUrl(base.posterUrl)
    ? base.posterUrl
    : hasRealPosterUrl(incoming.posterUrl)
    ? incoming.posterUrl
    : hasRealPosterUrl(existing.posterUrl)
    ? existing.posterUrl
    : base.posterUrl || incoming.posterUrl || existing.posterUrl || '';

  const bestBackdrop = hasRealPosterUrl(base.backdropUrl)
    ? base.backdropUrl
    : hasRealPosterUrl(incoming.backdropUrl)
    ? incoming.backdropUrl
    : hasRealPosterUrl(existing.backdropUrl)
    ? existing.backdropUrl
    : bestPoster;

  const resolvedBadge = incomingUpgradedFromPrint
    ? incoming.qualityBadge
    : incomingBadge && incomingBadge !== 'NONE'
    ? (incomingUpdated >= existingUpdated || !existingBadge || existingBadge === 'NONE'
        ? incoming.qualityBadge
        : existing.qualityBadge)
    : existingBadge && existingBadge !== 'NONE'
    ? existing.qualityBadge
    : base.qualityBadge;

  return {
    ...base,
    ...(preservedTgDate ? { telegramDateMs: preservedTgDate } : {}),
    ...(resolvedBadge ? { qualityBadge: resolvedBadge } : {}),
    posterUrl: bestPoster,
    backdropUrl: bestBackdrop,
  };
}

export function MoviesProvider({ children }: { children: React.ReactNode }) {
  const initialLocal = sortMoviesList(
    getLocalMovies().filter((m: any) => m && m.published !== false && hasPlayableContent(m) && isSeriesComplete(m))
  );

  const [movies, setMovies] = useState<MovieData[]>(initialLocal);
  const [isLoading, setIsLoading] = useState<boolean>(initialLocal.length === 0);
  const lastCatalogMetaSigRef = useRef<string>('');

  // Hydrate full catalog from IndexedDB + pre-bundled seed catalog + live SSE push updates
  useEffect(() => {
    let active = true;
    let sse: EventSource | null = null;
    let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let sseRetryMs = 1500;

    const mergeIntoState = (incoming: MovieData[], preferIncoming: boolean) => {
      if (!active || incoming.length === 0) return;
      const normalized = sortMoviesList(
        incoming
          .filter((m: any) => m && m.id && m.published !== false && hasPlayableContent(m) && isSeriesComplete(m))
          .map((m: any) => normalizeMoviePosters(m) as MovieData)
      );
      setMovies((prev) => {
        const prevById = new Map<string, MovieData>();
        prev.forEach((p) => prevById.set(p.id, p));

        const map = new Map<string, MovieData>();
        if (preferIncoming) {
          normalized.forEach((m) => {
            map.set(m.id, mergeMovieRecord(prevById.get(m.id), m, true));
          });
          const incomingIds = new Set(normalized.map((m) => m.id));
          prev.forEach((m) => {
            if (
              !incomingIds.has(m.id) &&
              !String(m.id).startsWith('tg_') &&
              hasPlayableContent(m) &&
              !String(m.posterUrl || '').startsWith('data:image/svg+xml')
            ) {
              map.set(m.id, m);
            }
          });
        } else {
          prev.forEach((m) => map.set(m.id, m));
          normalized.forEach((m) => {
            map.set(m.id, mergeMovieRecord(map.get(m.id), m, false));
          });
        }
        const combined = sortMoviesList(Array.from(map.values()));
        saveLocalMovies(combined);
        return combined;
      });
      setIsLoading(false);
    };

    fetchMergedMoviesCatalog()
      .then((merged) => {
        if (active && merged.length > 0) {
          mergeIntoState(merged, true);
        }
      })
      .catch(() => {});

    getCatalogFromIdb()
      .then((idbItems) => {
        if (active && idbItems.length > 0) {
          mergeIntoState(idbItems, false);
        }
      })
      .catch(() => {});

    const loadSeedCatalog = async () => {
      const seedData = await fetchSeedCatalogJson();
      if (active && seedData.length > 0) {
        mergeIntoState(seedData, true);
      }
    };

    const checkCatalogMetaAndReload = async () => {
      try {
        const metaResp = await fetch(buildApiUrl(`/api/movies/catalog-meta?t=${Date.now()}`), { cache: 'no-store' });
        if (!metaResp.ok) return;
        const meta = await metaResp.json();
        const sig = `${Number(meta?.count) || 0}:${Number(meta?.mtimeMs) || 0}:${Number(meta?.size) || 0}`;
        if (!lastCatalogMetaSigRef.current) {
          lastCatalogMetaSigRef.current = sig;
        } else if (sig !== lastCatalogMetaSigRef.current && Number(meta?.count) > 0) {
          lastCatalogMetaSigRef.current = sig;
          await loadSeedCatalog();
          await syncFromServer(true);
        }
      } catch {}
    };

    const connectLiveCatalogSse = () => {
      if (!active || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
      if (sse) {
        try {
          sse.close();
        } catch {}
        sse = null;
      }
      try {
        const url = buildApiUrl('/api/telegram/live-events');
        sse = new EventSource(url);
        sse.onopen = () => {
          sseRetryMs = 1500;
        };
        sse.addEventListener('catalog_updated', () => {
          if (!active) return;
          void loadSeedCatalog();
          void checkCatalogMetaAndReload();
        });
        sse.onerror = () => {
          if (sse) {
            try {
              sse.close();
            } catch {}
            sse = null;
          }
          if (!active) return;
          if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
          const wait = sseRetryMs;
          sseRetryMs = Math.min(15000, sseRetryMs * 2);
          sseReconnectTimer = setTimeout(connectLiveCatalogSse, wait);
        };
      } catch {}
    };

    void loadSeedCatalog().then(() => checkCatalogMetaAndReload());
    connectLiveCatalogSse();
    const interval = setInterval(checkCatalogMetaAndReload, 4000);
    window.addEventListener('focus', checkCatalogMetaAndReload);
    document.addEventListener('visibilitychange', checkCatalogMetaAndReload);
    return () => {
      active = false;
      clearInterval(interval);
      if (sseReconnectTimer) clearTimeout(sseReconnectTimer);
      if (sse) {
        try {
          sse.close();
        } catch {}
      }
      window.removeEventListener('focus', checkCatalogMetaAndReload);
      document.removeEventListener('visibilitychange', checkCatalogMetaAndReload);
    };
  }, []);

  const isMountedRef = useRef(true);
  const lastServerSyncMsRef = useRef<number>(0);
  const lastSeenCatalogMarkerRef = useRef<number>(0);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const resubscribeTriggerRef = useRef<() => void>(() => {});

  const applyMovieList = useCallback((rawList: MovieData[], _fromCache: boolean) => {
    if (!isMountedRef.current) return;
    const publishedOnly = sortMoviesList<MovieData>(
      rawList
        .filter((m: any) => m && m.id && m.published !== false && hasPlayableContent(m) && isSeriesComplete(m))
        .map((m) => normalizeMoviePosters(m) as MovieData)
    );

    // Merge incoming Firestore updates with existing seed catalog without overwriting valid posters with empty/SVG
    setMovies((currentMovies) => {
      const mergedMap = new Map<string, MovieData>();
      currentMovies.forEach((m) => mergedMap.set(m.id, m));
      publishedOnly.forEach((m) => {
        mergedMap.set(m.id, mergeMovieRecord(mergedMap.get(m.id), m, true));
      });
      const combined = sortMoviesList(Array.from(mergedMap.values()));
      saveLocalMovies(combined);
      return combined;
    });

    setIsLoading(false);
  }, []);

  const syncFromServer = useCallback(
    async (force = false) => {
      if (!isMountedRef.current) return;
      const now = Date.now();
      if (!force && now - lastServerSyncMsRef.current < MIN_SERVER_SYNC_GAP_MS) {
        return;
      }
      if (syncInFlightRef.current) {
        return syncInFlightRef.current;
      }

      const publishedQuery = query(collection(db, 'movies'), where('published', '==', true));

      const task = (async () => {
        try {
          lastServerSyncMsRef.current = Date.now();
          const snap = await getDocsFromServer(publishedQuery);
          const docsList = snap.docs.map(
            (d) => ({ id: d.id, ...d.data() } as MovieData)
          );
          applyMovieList(docsList, false);
        } catch (err) {
          handleFirestoreError(err, OperationType.LIST, 'movies', false);
        } finally {
          syncInFlightRef.current = null;
        }
      })();

      syncInFlightRef.current = task;
      return task;
    },
    [applyMovieList]
  );

  const refreshMovies = useCallback(
    async (forceResubscribe = false) => {
      await syncFromServer(true);
      if (forceResubscribe) {
        resubscribeTriggerRef.current();
      }
    },
    [syncFromServer]
  );

  useEffect(() => {
    isMountedRef.current = true;
    let unsubMovies: (() => void) | null = null;
    let unsubSyncMarker: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let bc: BroadcastChannel | null = null;

    const publishedQuery = query(collection(db, 'movies'), where('published', '==', true));

    const attachMoviesSnapshot = () => {
      if (!isMountedRef.current) return;
      if (unsubMovies) {
        try {
          unsubMovies();
        } catch {}
        unsubMovies = null;
      }

      unsubMovies = onSnapshot(
        publishedQuery,
        { includeMetadataChanges: true },
        (snapshot) => {
          if (!isMountedRef.current) return;
          if (!snapshot.metadata.fromCache) {
            lastServerSyncMsRef.current = Date.now();
          }
          const docsList = snapshot.docs.map(
            (d) => ({ id: d.id, ...d.data() } as MovieData)
          );
          applyMovieList(docsList, snapshot.metadata.fromCache);
        },
        (err) => {
          handleFirestoreError(err, OperationType.LIST, 'movies', false);
          if (isMountedRef.current) {
            setIsLoading(false);
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => {
              attachMoviesSnapshot();
              syncFromServer(true);
            }, 3000);
          }
        }
      );
    };

    resubscribeTriggerRef.current = attachMoviesSnapshot;

    // 1. Primary real-time listener on movies collection
    attachMoviesSnapshot();
    // 2. Immediate fresh server fetch on boot
    syncFromServer(true);

    // 3. Secondary real-time listener on lightweight 1-doc sync marker (app_config/catalog_sync)
    unsubSyncMarker = onSnapshot(
      doc(db, 'app_config', 'catalog_sync'),
      { includeMetadataChanges: false },
      (snap) => {
        if (!isMountedRef.current || !snap.exists()) return;
        const updatedAt = Number(snap.data()?.updatedAt || 0);
        if (updatedAt > lastSeenCatalogMarkerRef.current) {
          const hadPreviousMarker = lastSeenCatalogMarkerRef.current > 0;
          lastSeenCatalogMarkerRef.current = updatedAt;
          if (hadPreviousMarker) {
            syncFromServer(true);
          }
        }
      },
      () => {}
    );

    // 4. Lightweight 1-doc heartbeat check for mobile Safari/PWA/WebView where long-poll can pause
    const checkCatalogMarkerFromServer = async (reattachOnChange = false) => {
      if (!isMountedRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      try {
        const markerSnap = await getDocFromServer(doc(db, 'app_config', 'catalog_sync'));
        if (markerSnap.exists()) {
          const updatedAt = Number(markerSnap.data()?.updatedAt || 0);
          if (updatedAt > lastSeenCatalogMarkerRef.current) {
            lastSeenCatalogMarkerRef.current = updatedAt;
            await syncFromServer(true);
            if (reattachOnChange) {
              attachMoviesSnapshot();
            }
          }
        } else if (reattachOnChange) {
          await syncFromServer(false);
        }
      } catch {
        // Fallback silently if offline
      }
    };

    heartbeatTimer = setInterval(() => {
      checkCatalogMarkerFromServer(true);
    }, FOREGROUND_HEARTBEAT_MS);

    // 5. Same-device & cross-tab instant updates
    const handleLocalMoviesUpdated = () => {
      const local = sortMoviesList(
        getLocalMovies().filter((m: any) => m && m.published !== false && hasPlayableContent(m) && isSeriesComplete(m))
      );
      if (local.length > 0 || getLocalMovies().length === 0) {
        applyMovieList(local, true);
      }
      syncFromServer(true);
    };
    window.addEventListener('movies_updated', handleLocalMoviesUpdated);

    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel('movie_portal_updates');
        bc.onmessage = (event) => {
          if (event.data?.type === 'MOVIES_UPDATED' || event.data?.type === 'NEW_RELEASE') {
            handleLocalMoviesUpdated();
          }
        };
      } catch {}
    }

    // 6. Resume listeners for iOS Safari / PWA WebClip / Android WebView
    const handleResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      checkCatalogMarkerFromServer(true);
      syncFromServer(false);
    };

    const handleOnline = () => {
      attachMoviesSnapshot();
      syncFromServer(true);
    };

    const handleMovieViewRecorded = (event: Event) => {
      const targetId = String((event as CustomEvent)?.detail?.movieId || '').trim();
      if (!targetId || !isMountedRef.current) return;
      setMovies((prev) =>
        prev.map((m) =>
          m.id === targetId
            ? { ...m, viewsCount: Math.max(0, Math.floor(Number(m.viewsCount || 0) || 0)) + 1 }
            : m
        )
      );
    };
    window.addEventListener('movie_view_recorded', handleMovieViewRecorded);

    window.addEventListener('focus', handleResume);
    window.addEventListener('pageshow', handleResume);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleResume);

    return () => {
      isMountedRef.current = false;
      if (unsubMovies) {
        try {
          unsubMovies();
        } catch {}
      }
      if (unsubSyncMarker) {
        try {
          unsubSyncMarker();
        } catch {}
      }
      if (retryTimer) clearTimeout(retryTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (bc) {
        try {
          bc.close();
        } catch {}
      }
      window.removeEventListener('movies_updated', handleLocalMoviesUpdated);
      window.removeEventListener('movie_view_recorded', handleMovieViewRecorded);
      window.removeEventListener('focus', handleResume);
      window.removeEventListener('pageshow', handleResume);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleResume);
    };
  }, [applyMovieList, syncFromServer]);

  return (
    <MoviesContext.Provider value={{ movies, isLoading, refreshMovies }}>
      {children}
    </MoviesContext.Provider>
  );
}

export function useMovies() {
  return useContext(MoviesContext);
}
