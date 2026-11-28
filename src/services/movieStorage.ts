import { db } from '../firebase';
import { collection, getDocs, getDocsFromServer, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { normalizeMoviePosters } from '../utils/posterUrl';
import {
  checkAndHandleQuotaError,
  guardedFirestoreWrite,
  isFirestoreWriteAllowed,
} from './firestoreQuotaService';
import { buildApiUrl } from '../utils/apiConfig';
import { hasPlayableContent, normalizeSeriesSeasons } from '../utils/seriesCompleteness';

export interface MovieData {
  id: string;
  title: string;
  originalTitle?: string;
  description?: string;
  posterUrl: string;
  backdropUrl?: string;
  releaseYear: number;
  originalCategory: string;
  displayCategory: string;
  language?: string;
  genre?: string;
  director?: string;
  cast?: string;
  runtime?: string;
  rating?: number;
  imdbId?: string;
  trailerUrl?: string;
  streamingUrl?: string;
  videoQualities?: Record<string, string>;
  featured?: boolean;
  published: boolean;
  qualityBadge?: 'HD' | 'HDTC' | 'NONE' | string;
  sourceFileName?: string;
  sourceCaption?: string;
  duration?: number;
  telegramMsgId?: number;
  telegramChannelId?: string;
  sourceMsgIds?: number[];
  createdAt?: any;
  updatedAt?: any;
  telegramDateMs?: number;
  viewsCount?: number;
  contentType?: string | null;
  seasons?: Array<{
    seasonNumber: number;
    episodes: Array<{
      episodeNumber: number;
      episodeLabel?: string;
      title: string;
      streamUrl: string;
      quality?: string;
      videoQualities?: Record<string, string>;
      duration?: string;
      durationSec?: number;
      createdAt?: any;
      addedAt?: any;
      showInNewEpisodes?: boolean;
      newEpisodeEnabledAt?: number;
    }>;
  }>;
}

export function extractEpisodeRangeFromText(text?: string | null): string {
  const clean = String(text || '').trim();
  if (!clean) return '';
  const explicitMatch = clean.match(
    /(?:^|\b(?:episodes?|eps?|e)\s*)(\d{1,3})\s*(?:-|–|—|\bto\b)\s*(?:e\s*)?(\d{1,3})(?:\b|$)/i
  );
  if (explicitMatch) {
    const startNum = parseInt(explicitMatch[1], 10);
    const endNum = parseInt(explicitMatch[2], 10);
    if (
      Number.isFinite(startNum) &&
      Number.isFinite(endNum) &&
      endNum > startNum &&
      startNum >= 1 &&
      endNum <= 999
    ) {
      return `${startNum}-${endNum}`;
    }
  }
  return '';
}

export function getEpisodeDisplayLabel(
  ep: { episodeNumber?: number | null; episodeLabel?: string | null; title?: string | null } | null | undefined,
  fallbackIndex = 0,
  padSingle = true
): string {
  const explicitLabel = String(ep?.episodeLabel || '').trim();
  if (explicitLabel) {
    if (/^\d+$/.test(explicitLabel)) {
      return padSingle ? explicitLabel.padStart(2, '0') : explicitLabel;
    }
    return explicitLabel.replace(/\s*[-–—]\s*/g, '-');
  }

  const inferredRange = extractEpisodeRangeFromText(ep?.title);
  if (inferredRange) {
    return inferredRange;
  }

  const num = Number(ep?.episodeNumber || fallbackIndex + 1);
  const str = String(Number.isFinite(num) && num > 0 ? num : fallbackIndex + 1);
  return padSingle ? str.padStart(2, '0') : str;
}

export const NEW_EPISODE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isEpisodeNewActive(
  ep: { showInNewEpisodes?: boolean; newEpisodeEnabledAt?: any } | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (!ep || ep.showInNewEpisodes !== true) return false;
  const enabledAtMs = getTimestampMs(ep.newEpisodeEnabledAt);
  if (enabledAtMs <= 0) return false;
  const ageMs = nowMs - enabledAtMs;
  return ageMs >= -60_000 && ageMs < NEW_EPISODE_WINDOW_MS;
}

export interface RecentEpisodeItem {
  key: string;
  movie: MovieData;
  seasonIndex: number;
  episodeIndex: number;
  seasonNumber: number;
  episodeNumber: number;
  episodeLabel?: string;
  episodeTitle: string;
  duration?: string;
  addedAtMs: number;
}

const COLLECTION_NAME = 'movies';

export function getTimestampMs(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const num = Number(val);
    if (Number.isFinite(num) && num > 0 && /^\d+$/.test(val.trim())) return num;
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof val?.toMillis === 'function') {
    try {
      return val.toMillis();
    } catch {
      return 0;
    }
  }
  if (typeof val?.seconds === 'number') {
    return val.seconds * 1000;
  }
  return 0;
}

export function getNewEpisodesWithin24h(
  moviesList: MovieData[],
  nowMs: number = Date.now()
): RecentEpisodeItem[] {
  const items: RecentEpisodeItem[] = [];

  for (const movie of moviesList) {
    if (!movie || movie.published === false) continue;
    if (!Array.isArray(movie.seasons) || movie.seasons.length === 0) continue;

    movie.seasons.forEach((season, sIdx) => {
      if (!season || !Array.isArray(season.episodes)) return;
      const seasonNum = Number(season.seasonNumber) || sIdx + 1;

      season.episodes.forEach((ep, eIdx) => {
        if (!ep || !ep.streamUrl || !String(ep.streamUrl).trim()) return;
        if (!isEpisodeNewActive(ep, nowMs)) return;

        const enabledAtMs = getTimestampMs(ep.newEpisodeEnabledAt);
        const epNum = Number(ep.episodeNumber) || eIdx + 1;
        const resolvedLabel = getEpisodeDisplayLabel(ep, eIdx, true);
        items.push({
          key: `${movie.id}_s${seasonNum}_e${epNum}_${eIdx}`,
          movie,
          seasonIndex: sIdx,
          episodeIndex: eIdx,
          seasonNumber: seasonNum,
          episodeNumber: epNum,
          ...(ep.episodeLabel || extractEpisodeRangeFromText(ep.title) ? { episodeLabel: resolvedLabel } : {}),
          episodeTitle: ep.title?.trim() || `Episode ${resolvedLabel}`,
          duration: ep.duration,
          addedAtMs: enabledAtMs,
        });
      });
    });
  }

  return items.sort((a, b) => {
    if (b.addedAtMs !== a.addedAtMs) return b.addedAtMs - a.addedAtMs;
    if (b.seasonNumber !== a.seasonNumber) return b.seasonNumber - a.seasonNumber;
    return b.episodeNumber - a.episodeNumber;
  });
}

export function getMovieReleaseYear(movie: Partial<MovieData> & Record<string, any> | null | undefined): number {
  if (!movie) return 0;
  const currentYear = new Date().getFullYear();
  const candidates = [movie.releaseYear, (movie as any).year, (movie as any).releaseDate];
  for (const val of candidates) {
    if (typeof val === 'number' && Number.isFinite(val) && val >= 1900 && val <= currentYear + 1) {
      return Math.floor(val);
    }
    if (typeof val === 'string') {
      const m = val.match(/\b(19\d\d|20\d\d)\b/);
      if (m) {
        const y = parseInt(m[1], 10);
        if (y >= 1900 && y <= currentYear + 1) return y;
      }
      const n = parseInt(val.trim(), 10);
      if (Number.isFinite(n) && n >= 1900 && n <= currentYear + 1) return n;
    }
  }
  const titleYear = String(movie.title || '').match(/\b(19\d\d|20\d\d)\b/);
  if (titleYear) {
    const y = parseInt(titleYear[1], 10);
    if (y >= 1900 && y <= currentYear + 1) return y;
  }
  return 0;
}

export function sortMoviesList<T extends Partial<MovieData>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const yearDiff = getMovieReleaseYear(b as any) - getMovieReleaseYear(a as any);
    if (yearDiff !== 0) return yearDiff;
    const aTime = getTimestampMs(a.telegramDateMs) || getTimestampMs(a.createdAt) || getTimestampMs(a.updatedAt) || 0;
    const bTime = getTimestampMs(b.telegramDateMs) || getTimestampMs(b.createdAt) || getTimestampMs(b.updatedAt) || 0;
    if (bTime !== aTime) return bTime - aTime;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

const IDB_NAME = 'mp_catalog_cache_v1';
const IDB_STORE = 'catalog';
const IDB_KEY = 'movies_v4';

const DELETED_MOVIES_KEY = 'movie_portal_deleted_ids_v2';

export function getDeletedMovieIds(): Set<string> {
  const set = new Set<string>();
  if (typeof window === 'undefined') return set;
  try {
    const raw = localStorage.getItem(DELETED_MOVIES_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.forEach((id) => {
          if (id) set.add(String(id));
        });
      }
    }
  } catch {}
  return set;
}

export function isMovieDeleted(id?: string | null, title?: string | null, origTitle?: string | null): boolean {
  const t = (String(title || '') + ' ' + String(origTitle || '')).toLowerCase();
  // Permanently suppress Mushoku Tensei across all clients, seeds, and caches
  if (t.includes('mushoku') || t.includes('jobless reincarnation') || t.includes('jobless reincarnat')) {
    return true;
  }
  if (!id) return false;
  return getDeletedMovieIds().has(String(id));
}

export function markMovieAsDeleted(id: string, title?: string): void {
  if (!id) return;
  if (typeof window !== 'undefined') {
    try {
      const set = getDeletedMovieIds();
      set.add(String(id));
      localStorage.setItem(DELETED_MOVIES_KEY, JSON.stringify(Array.from(set)));
    } catch {}
  }

  // Also notify server backend
  try {
    fetch(buildApiUrl('/api/movies/delete'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, title }),
    }).catch(() => {});
  } catch {}
}

function openCatalogDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          const dbInst = req.result;
          if (!dbInst.objectStoreNames.contains(IDB_STORE)) {
            dbInst.createObjectStore(IDB_STORE);
          }
        } catch {}
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getCatalogFromIdb(): Promise<MovieData[]> {
  try {
    const idb = await openCatalogDb();
    if (!idb) return [];
    return await new Promise((resolve) => {
      try {
        const tx = idb.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const getReq = store.get(IDB_KEY);
        getReq.onsuccess = () => {
          const val = getReq.result;
          if (Array.isArray(val)) {
            resolve(
              sortMoviesList(
                val
                  .map((m: any) => normalizeSeriesSeasons(normalizeMoviePosters(m) as MovieData))
                  .filter(
                    (m: any) =>
                      m &&
                      m.id &&
                      m.published !== false &&
                      hasPlayableContent(m) &&
                      !isMovieDeleted(m.id, m.title, m.originalTitle)
                  )
              )
            );
          } else {
            resolve([]);
          }
        };
        getReq.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  } catch {
    return [];
  }
}

export async function saveCatalogToIdb(movies: MovieData[]): Promise<void> {
  try {
    if (!Array.isArray(movies)) return;
    const cleaned = movies.filter((m) => !isMovieDeleted(m.id, m.title, m.originalTitle));
    const idb = await openCatalogDb();
    if (!idb) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = idb.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.put(cleaned, IDB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } catch {}
}

import { BUNDLED_SEED_CATALOG } from './seedCatalog';

export async function fetchSeedCatalogJson(): Promise<MovieData[]> {
  const bundled = Array.isArray(BUNDLED_SEED_CATALOG)
    ? BUNDLED_SEED_CATALOG
        .map((m: any) => normalizeSeriesSeasons(normalizeMoviePosters(m) as MovieData))
        .filter(
          (m: any) =>
            m &&
            m.id &&
            m.published !== false &&
            hasPlayableContent(m) &&
            !isMovieDeleted(m.id, m.title, m.originalTitle)
        )
    : [];

  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const bust = Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const urls = [
      buildApiUrl(`/api/movies/catalog?v=${bust}`),
      buildApiUrl(`/movies-seed.json?v=${bust}`),
      `/movies-seed.json?v=${bust}`,
      origin ? `${origin}/movies-seed.json?v=${bust}` : '',
      `/api/movies/catalog?v=${bust}`,
    ].filter(Boolean);

    for (const url of urls) {
      try {
        const resp = await fetch(url, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
          },
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          const parsed = data
            .map((m: any) => normalizeSeriesSeasons(normalizeMoviePosters(m) as MovieData))
            .filter(
              (m: any) =>
                m &&
                m.id &&
                m.published !== false &&
                hasPlayableContent(m) &&
                !isMovieDeleted(m.id, m.title, m.originalTitle)
            );
          if (parsed.length > 0) {
            return parsed;
          }
        }
      } catch {}
    }
  } catch {}

  return bundled;
}

export async function fetchMergedMoviesCatalog(): Promise<MovieData[]> {
  const [seedList, firestoreList, idbList] = await Promise.all([
    fetchSeedCatalogJson(),
    (async () => {
      try {
        let snapshot;
        try {
          snapshot = await getDocsFromServer(collection(db, COLLECTION_NAME));
        } catch {
          snapshot = await getDocs(collection(db, COLLECTION_NAME));
        }
        return snapshot.docs
          .map(
            (d) =>
              normalizeSeriesSeasons(
                normalizeMoviePosters({ id: d.id, ...d.data() } as MovieData) as MovieData
              )
          )
          .filter(
            (m) =>
              m &&
              m.id &&
              hasPlayableContent(m) &&
              !isMovieDeleted(m.id, m.title, m.originalTitle)
          );
      } catch {
        return [] as MovieData[];
      }
    })(),
    getCatalogFromIdb(),
  ]);

  const merged = new Map<string, MovieData>();
  seedList
    .filter((m) => hasPlayableContent(m) && !isMovieDeleted(m.id, m.title, m.originalTitle))
    .forEach((m) => merged.set(m.id, m));
  idbList
    .filter((m) => hasPlayableContent(m) && !isMovieDeleted(m.id, m.title, m.originalTitle))
    .forEach((m) => merged.set(m.id, mergeFreshMovieRecords(merged.get(m.id), m)));
  firestoreList
    .filter((m) => hasPlayableContent(m) && !isMovieDeleted(m.id, m.title, m.originalTitle))
    .forEach((m) => merged.set(m.id, mergeFreshMovieRecords(merged.get(m.id), m)));

  const sorted = sortMoviesList<MovieData>(
    Array.from(merged.values()).filter((m) => !isMovieDeleted(m.id, m.title, m.originalTitle))
  );
  if (sorted.length > 0) {
    saveLocalMovies(sorted);
    return sorted;
  }
  return sortMoviesList(getLocalMovies());
}

export async function fetchMoviesFromFirestore(): Promise<MovieData[]> {
  try {
    let snapshot;
    try {
      snapshot = await getDocsFromServer(collection(db, COLLECTION_NAME));
    } catch {
      snapshot = await getDocs(collection(db, COLLECTION_NAME));
    }
    const rawMovies: MovieData[] = snapshot.docs
      .map(
        (d) =>
          normalizeSeriesSeasons(
            normalizeMoviePosters({ id: d.id, ...d.data() } as MovieData) as MovieData
          )
      )
      .filter(
        (m) =>
          m.published !== false &&
          hasPlayableContent(m) &&
          !isMovieDeleted(m.id, m.title, m.originalTitle)
      );
    const movies = sortMoviesList<MovieData>(rawMovies);
    saveLocalMovies(movies);
    return movies;
  } catch (e) {
    console.error('Error fetching movies from Firestore', e);
    const idbList = await getCatalogFromIdb();
    if (idbList.length > 0) return idbList;
    return sortMoviesList(getLocalMovies());
  }
}

function notifyMoviesUpdated(movie?: MovieData): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent('movies_updated', { detail: movie }));
  } catch {}
  try {
    const bc = new BroadcastChannel('movie_portal_updates');
    bc.postMessage({ type: 'MOVIES_UPDATED', movieId: movie?.id });
    setTimeout(() => bc.close(), 200);
  } catch {}
}

export function broadcastDirectMovieUpsert(movie: MovieData): void {
  if (typeof window === 'undefined' || !movie || !movie.id) return;
  const normalized = normalizeSeriesSeasons(normalizeMoviePosters(movie) as MovieData);
  try {
    window.dispatchEvent(new CustomEvent('telegram_direct_movie_upsert', { detail: normalized }));
  } catch {}
  try {
    const bc = new BroadcastChannel('movie_portal_updates');
    bc.postMessage({ type: 'DIRECT_MOVIE_UPSERT', movie: normalized });
    setTimeout(() => bc.close(), 200);
  } catch {}
}

export async function touchCatalogSyncMarker(movieId = '', action = 'update'): Promise<void> {
  if (!isFirestoreWriteAllowed()) return;
  await guardedFirestoreWrite(() =>
    setDoc(
      doc(db, 'app_config', 'catalog_sync'),
      {
        updatedAt: Date.now(),
        movieId: String(movieId || ''),
        action: String(action || 'update'),
      },
      { merge: true }
    )
  );
}

export async function saveMovieToFirestore(movie: MovieData): Promise<void> {
  const normalized = normalizeSeriesSeasons(normalizeMoviePosters(movie) as MovieData);
  try {
    if (isFirestoreWriteAllowed()) {
      const res = await guardedFirestoreWrite(() =>
        setDoc(doc(db, COLLECTION_NAME, normalized.id), normalized)
      );
      if (res.ok) {
        touchCatalogSyncMarker(normalized.id, 'save').catch(() => {});
      }
    }
    saveMovieLocally(normalized);
    notifyMoviesUpdated(normalized);
  } catch (e) {
    checkAndHandleQuotaError(e);
    saveMovieLocally(normalized);
    notifyMoviesUpdated(normalized);
  }
}

export async function deleteMovieFromFirestore(id: string, title?: string): Promise<void> {
  markMovieAsDeleted(id, title);
  deleteMovieLocally(id, title);
  notifyMoviesUpdated();

  try {
    // Direct attempt without quota blockage first
    await deleteDoc(doc(db, COLLECTION_NAME, id)).catch(async () => {
      if (isFirestoreWriteAllowed()) {
        const res = await guardedFirestoreWrite(() => deleteDoc(doc(db, COLLECTION_NAME, id)));
        if (res.ok) {
          touchCatalogSyncMarker(id, 'delete').catch(() => {});
        }
      }
    });
    touchCatalogSyncMarker(id, 'delete').catch(() => {});
  } catch (e) {
    checkAndHandleQuotaError(e);
  }
}

const STORAGE_KEY = 'movie_portal_movies_v5';

// Immediate startup purge of deleted items or suppressed series (like Mushoku Tensei)
if (typeof window !== 'undefined') {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((m: any) => m && !isMovieDeleted(m.id, m.title, m.originalTitle));
        if (cleaned.length !== parsed.length) {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
          void saveCatalogToIdb(cleaned);
        }
      }
    }
  } catch {}
}

export const DEFAULT_INITIAL_MOVIES: MovieData[] = [];

function hasRealPoster(url?: string | null): boolean {
  const s = String(url || '').trim();
  return Boolean(s && s !== 'N/A' && !s.startsWith('data:image/svg+xml'));
}

function countEpisodesTotal(m?: Partial<MovieData> | null): number {
  if (!m || !Array.isArray(m.seasons)) return 0;
  return m.seasons.reduce((acc, s) => acc + (Array.isArray(s?.episodes) ? s.episodes.length : 0), 0);
}

function countQualitiesTotal(m?: Partial<MovieData> | null): number {
  if (!m || !m.videoQualities || typeof m.videoQualities !== 'object') return 0;
  return Object.values(m.videoQualities).filter((u) => Boolean(String(u || '').trim())).length;
}

export function mergeFreshMovieRecords(existing: MovieData | undefined, incoming: MovieData): MovieData {
  if (!existing) return incoming;
  const existingUpdated = getTimestampMs(existing.updatedAt) || getTimestampMs(existing.createdAt) || 0;
  const incomingUpdated = getTimestampMs(incoming.updatedAt) || getTimestampMs(incoming.createdAt) || 0;
  const existingEps = countEpisodesTotal(existing);
  const incomingEps = countEpisodesTotal(incoming);
  const existingQuals = countQualitiesTotal(existing);
  const incomingQuals = countQualitiesTotal(incoming);
  const incomingUpgradedHd =
    String(existing.qualityBadge || '').toUpperCase() === 'HDTC' &&
    String(incoming.qualityBadge || '').toUpperCase() === 'HD';

  const pickIncoming =
    incomingUpgradedHd ||
    incomingEps > existingEps ||
    incomingQuals > existingQuals ||
    incomingUpdated > existingUpdated ||
    (!hasRealPoster(existing.posterUrl) && hasRealPoster(incoming.posterUrl));

  const base = pickIncoming ? incoming : existing;
  const other = pickIncoming ? existing : incoming;

  const bestPoster = hasRealPoster(base.posterUrl)
    ? base.posterUrl
    : hasRealPoster(other.posterUrl)
    ? other.posterUrl
    : base.posterUrl || other.posterUrl || '';
  const bestBackdrop = hasRealPoster(base.backdropUrl)
    ? base.backdropUrl
    : hasRealPoster(other.backdropUrl)
    ? other.backdropUrl
    : bestPoster;

  const tgDates = [getTimestampMs(existing.telegramDateMs), getTimestampMs(incoming.telegramDateMs)].filter((d) => d > 0);
  const preservedTgDate = tgDates.length > 0 ? Math.min(...tgDates) : undefined;
  const bestUpdated = Math.max(existingUpdated, incomingUpdated);

  const mergedQualities = {
    ...(other.videoQualities && typeof other.videoQualities === 'object' ? other.videoQualities : {}),
    ...(base.videoQualities && typeof base.videoQualities === 'object' ? base.videoQualities : {}),
  };

  return {
    ...base,
    posterUrl: bestPoster,
    backdropUrl: bestBackdrop,
    ...(base.imdbId || other.imdbId ? { imdbId: base.imdbId || other.imdbId } : {}),
    ...(base.description || other.description ? { description: base.description || other.description } : {}),
    ...(Object.keys(mergedQualities).length > 0 ? { videoQualities: mergedQualities } : {}),
    ...(preservedTgDate ? { telegramDateMs: preservedTgDate } : {}),
    ...(bestUpdated > 0 ? { updatedAt: bestUpdated } : {}),
  };
}

export function getLocalMovies(): MovieData[] {
  try {
    const seedItems = Array.isArray(BUNDLED_SEED_CATALOG)
      ? BUNDLED_SEED_CATALOG
          .map((m: any) => normalizeSeriesSeasons(normalizeMoviePosters(m) as MovieData))
          .filter(
            (m: any) =>
              m &&
              m.id &&
              m.published !== false &&
              hasPlayableContent(m) &&
              !isMovieDeleted(m.id, m.title, m.originalTitle)
          )
      : [];

    if (typeof window === 'undefined') return seedItems;

    const raw = localStorage.getItem(STORAGE_KEY);
    let cached: MovieData[] = [];
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          cached = parsed
            .map((m: any) => normalizeSeriesSeasons(normalizeMoviePosters(m) as MovieData))
            .filter(
              (m: any) =>
                m &&
                m.id &&
                m.published !== false &&
                hasPlayableContent(m) &&
                !isMovieDeleted(m.id, m.title, m.originalTitle)
            );
        }
      } catch {}
    }

    const map = new Map<string, MovieData>();
    seedItems.forEach((m) => {
      if (!isMovieDeleted(m.id, m.title, m.originalTitle)) {
        map.set(m.id, m);
      }
    });
    cached.forEach((m) => {
      if (isMovieDeleted(m.id, m.title, m.originalTitle)) return;
      map.set(m.id, mergeFreshMovieRecords(map.get(m.id), m));
    });

    const combined = sortMoviesList(
      Array.from(map.values()).filter((m) => !isMovieDeleted(m.id, m.title, m.originalTitle))
    );
    try {
      const json = JSON.stringify(combined);
      if (json.length <= 2_200_000) {
        localStorage.setItem(STORAGE_KEY, json);
      }
    } catch {}
    return combined.length > 0 ? combined : seedItems;
  } catch {
    return Array.isArray(BUNDLED_SEED_CATALOG)
      ? (BUNDLED_SEED_CATALOG as MovieData[]).filter(
          (m) => hasPlayableContent(m) && !isMovieDeleted(m.id, m.title, m.originalTitle)
        )
      : [];
  }
}

export function saveLocalMovies(movies: MovieData[]): void {
  try {
    if (typeof window === 'undefined') return;
    if (!Array.isArray(movies)) return;
    const cleanList = movies.filter((m) => !isMovieDeleted(m.id, m.title, m.originalTitle));
    void saveCatalogToIdb(cleanList);

    try {
      const json = JSON.stringify(cleanList);
      if (json.length <= 2_200_000) {
        localStorage.setItem(STORAGE_KEY, json);
        return;
      }
      // Prioritize recently uploaded/updated items while compacting older descriptions
      const compactedAll = [...cleanList]
        .sort((a, b) => {
          const bRecency = Math.max(getTimestampMs(b.updatedAt), getTimestampMs(b.telegramDateMs), getTimestampMs(b.createdAt));
          const aRecency = Math.max(getTimestampMs(a.updatedAt), getTimestampMs(a.telegramDateMs), getTimestampMs(a.createdAt));
          return bRecency - aRecency;
        })
        .map((m, idx) => ({
          ...m,
          description: idx < 40 && m.description ? String(m.description).slice(0, 140) : '',
          cast: idx < 40 ? m.cast : '',
          director: idx < 40 ? m.director : '',
        }));
      const compactJson = JSON.stringify(compactedAll);
      if (compactJson.length <= 2_600_000) {
        localStorage.setItem(STORAGE_KEY, compactJson);
        return;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(compactedAll.slice(0, 320)));
    } catch {
      try {
        const subset = [...cleanList]
          .sort((a, b) => {
            const bRecency = Math.max(getTimestampMs(b.updatedAt), getTimestampMs(b.telegramDateMs), getTimestampMs(b.createdAt));
            const aRecency = Math.max(getTimestampMs(a.updatedAt), getTimestampMs(a.telegramDateMs), getTimestampMs(a.createdAt));
            return bRecency - aRecency;
          })
          .slice(0, 150)
          .map((m) => ({
            id: m.id,
            title: m.title,
            posterUrl: m.posterUrl,
            backdropUrl: m.backdropUrl,
            releaseYear: m.releaseYear,
            originalCategory: m.originalCategory,
            displayCategory: m.displayCategory,
            genre: m.genre,
            published: m.published,
            featured: m.featured,
            streamingUrl: m.streamingUrl,
            seasons: m.seasons,
            videoQualities: m.videoQualities,
            telegramDateMs: m.telegramDateMs,
            updatedAt: m.updatedAt,
          }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(subset));
      } catch (innerErr) {
        console.warn('Failed to save compacted movies to localStorage', innerErr);
      }
    }
  } catch (e) {
    console.warn('Failed to save movies to localStorage', e);
  }
}

export function saveMovieLocally(movie: MovieData): MovieData[] {
  const current = getLocalMovies();
  const existingIdx = current.findIndex((m) => m.id === movie.id);
  let updated: MovieData[];
  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = movie;
  } else {
    updated = [movie, ...current];
  }
  const sorted = sortMoviesList(updated);
  saveLocalMovies(sorted);
  notifyMoviesUpdated(movie);
  return sorted;
}

export function deleteMovieLocally(id: string, title?: string): MovieData[] {
  markMovieAsDeleted(id, title);
  const current = getLocalMovies();
  const updated = current.filter((m) => m.id !== id && !isMovieDeleted(m.id, m.title, m.originalTitle));
  saveLocalMovies(updated);
  notifyMoviesUpdated();
  return updated;
}

export function togglePublishLocally(id: string): MovieData[] {
  const current = getLocalMovies();
  const updated = current.map((m) => (m.id === id ? { ...m, published: !m.published } : m));
  saveLocalMovies(updated);
  notifyMoviesUpdated();
  return updated;
}

export function toggleFeaturedLocally(id: string): MovieData[] {
  const current = getLocalMovies();
  const updated = current.map((m) => (m.id === id ? { ...m, featured: !m.featured } : m));
  saveLocalMovies(updated);
  notifyMoviesUpdated();
  return updated;
}

export function clearAllMoviesLocally(): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
      localStorage.removeItem('movie_portal_movies');
      void saveCatalogToIdb([]);
      notifyMoviesUpdated();
    }
  } catch (e) {
    console.warn('Failed to clear movies from localStorage', e);
  }
}
