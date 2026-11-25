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
  saveLocalMovies,
  sortMoviesList,
} from '../services/movieStorage';
import { normalizeMoviePosters } from '../utils/posterUrl';

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

export function MoviesProvider({ children }: { children: React.ReactNode }) {
  // Fallback to pre-bundled seed catalog on fresh install / app reinstall
  let baseLocal = getLocalMovies();
  if (baseLocal.length === 0) {
    try {
      // Synchronous localStorage seed load fallback
      if (typeof window !== 'undefined') {
        const cachedSeed = localStorage.getItem('movie_portal_seed_loaded_v1');
        if (!cachedSeed) {
          // We can fetch seed synchronously or pre-populate localStorage on first render
        }
      }
    } catch {}
  }

  const initialLocal = sortMoviesList(
    baseLocal.filter((m: any) => m && m.published !== false)
  );

  const [movies, setMovies] = useState<MovieData[]>(initialLocal);
  const [isLoading, setIsLoading] = useState<boolean>(initialLocal.length === 0);

  // Load and merge pre-bundled seed catalog on boot and periodically
  useEffect(() => {
    let active = true;
    const loadSeedCatalog = () => {
      fetch('/movies-seed.json?v=' + Date.now())
        .then((r) => r.json())
        .then((seedData) => {
          if (!active) return;
          if (Array.isArray(seedData) && seedData.length > 0) {
            const normalized = sortMoviesList(
              seedData
                .filter((m: any) => m && m.id && m.published !== false)
                .map((m: any) => normalizeMoviePosters(m))
            );
            setMovies((prev) => {
              const map = new Map<string, MovieData>();
              normalized.forEach((m) => map.set(m.id, m));
              prev.forEach((m) => map.set(m.id, m));
              const combined = sortMoviesList(Array.from(map.values()));
              saveLocalMovies(combined);
              return combined;
            });
            setIsLoading(false);
          }
        })
        .catch(() => {});
    };

    loadSeedCatalog();
    const interval = setInterval(loadSeedCatalog, 12000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const isMountedRef = useRef(true);
  const lastServerSyncMsRef = useRef<number>(0);
  const lastSeenCatalogMarkerRef = useRef<number>(0);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const resubscribeTriggerRef = useRef<() => void>(() => {});

  const applyMovieList = useCallback((rawList: MovieData[], fromCache: boolean) => {
    if (!isMountedRef.current) return;
    const publishedOnly = sortMoviesList<MovieData>(
      rawList
        .filter((m: any) => m && m.id && m.published !== false)
        .map((m) => normalizeMoviePosters(m) as MovieData)
    );

    // Merge incoming Firestore updates with existing seed catalog
    setMovies((currentMovies) => {
      const mergedMap = new Map<string, MovieData>();
      currentMovies.forEach((m) => mergedMap.set(m.id, m));
      publishedOnly.forEach((m) => mergedMap.set(m.id, m));
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
        getLocalMovies().filter((m: any) => m && m.published !== false)
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
