import { doc, increment, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import {
  checkAndHandleQuotaError,
  guardedFirestoreWrite,
  isFirestoreWriteAllowed,
} from './firestoreQuotaService';
import { getLocalMovies, saveLocalMovies } from './movieStorage';

const DEVICE_UUID_KEY = 'mp_device_uuid_v1';
const RECORDED_VIEWS_KEY = 'mp_recorded_movie_views_v1';

const inFlightMovieViews = new Set<string>();

function sanitizeFirestoreId(raw: string): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.slice(0, 120) || 'anon';
}

export function getOrCreateViewerKey(userId?: string | null): string {
  const uid = String(userId || '').trim();
  if (uid && uid !== 'guest_user') {
    return `u_${sanitizeFirestoreId(uid)}`;
  }

  let deviceId = '';
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      deviceId = localStorage.getItem(DEVICE_UUID_KEY) || '';
      if (!deviceId) {
        deviceId = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
        localStorage.setItem(DEVICE_UUID_KEY, deviceId);
      }
    }
  } catch {}

  if (!deviceId) {
    deviceId = 'sess_' + Math.random().toString(36).substring(2, 11);
  }
  return `d_${sanitizeFirestoreId(deviceId)}`;
}

function getRecordedViewsCache(): Record<string, number> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    const raw = localStorage.getItem(RECORDED_VIEWS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function markViewRecordedLocally(cacheKey: string): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const current = getRecordedViewsCache();
    current[cacheKey] = Date.now();
    // Keep cache bounded cleanly to last 500 entries
    const entries = Object.entries(current);
    if (entries.length > 500) {
      entries.sort((a, b) => Number(a[1]) - Number(b[1]));
      const trimmed = Object.fromEntries(entries.slice(entries.length - 400));
      localStorage.setItem(RECORDED_VIEWS_KEY, JSON.stringify(trimmed));
    } else {
      localStorage.setItem(RECORDED_VIEWS_KEY, JSON.stringify(current));
    }
  } catch {}
}

export function getNormalizedViewsCount(movie: any): number {
  const raw = Number(movie?.viewsCount ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw);
}

export function formatCompactViews(count?: number | null): string {
  const n = Math.max(0, Math.floor(Number(count || 0) || 0));
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const k = Math.floor(n / 100) / 10;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  const m = Math.floor(n / 100_000) / 10;
  return `${m % 1 === 0 ? m.toFixed(0) : m.toFixed(1)}M`;
}

/**
 * Records a genuine real view in Firestore once playback actually starts
 * for a given movie/series, deduplicated per real user/device.
 */
export async function recordMovieViewStart(
  movie: any,
  userId?: string | null
): Promise<boolean> {
  const movieId = String(movie?.id || '').trim();
  if (!movieId || movieId === 'unknown' || movieId.startsWith('sample-')) {
    return false;
  }

  const viewerKey = getOrCreateViewerKey(userId);
  const cacheKey = `${viewerKey}::${movieId}`;

  const cached = getRecordedViewsCache();
  if (cached[cacheKey]) {
    return false;
  }

  if (inFlightMovieViews.has(cacheKey)) {
    return false;
  }

  if (!isFirestoreWriteAllowed()) {
    return false;
  }

  inFlightMovieViews.add(cacheKey);
  try {
    const viewerRef = doc(db, 'users', viewerKey, 'watched_movies', movieId);
    const movieRef = doc(db, 'movies', movieId);

    const txRes = await guardedFirestoreWrite(() =>
      runTransaction(db, async (tx) => {
        const viewerSnap = await tx.get(viewerRef);
        if (viewerSnap.exists()) {
          return false;
        }

        const movieSnap = await tx.get(movieRef);
        if (!movieSnap.exists()) {
          return false;
        }

        tx.set(viewerRef, {
          viewerKey,
          movieId,
          startedAt: serverTimestamp(),
        });
        tx.update(movieRef, {
          viewsCount: increment(1),
        });
        return true;
      })
    );
    if (!txRes.ok) {
      if (!txRes.quotaExhausted && txRes.error && isFirestoreWriteAllowed()) {
        handleFirestoreError(
          txRes.error,
          OperationType.WRITE,
          `users/${viewerKey}/watched_movies/${movieId}`,
          false
        );
      }
      return false;
    }
    const newlyCounted = Boolean(txRes.value);

    markViewRecordedLocally(cacheKey);

    if (newlyCounted) {
      // Optimistically bump local cache + notify active UI immediately
      try {
        const local = getLocalMovies();
        const idx = local.findIndex((m) => m.id === movieId);
        if (idx >= 0) {
          const updated = [...local];
          updated[idx] = {
            ...updated[idx],
            viewsCount: getNormalizedViewsCount(updated[idx]) + 1,
          };
          saveLocalMovies(updated);
        }
      } catch {}

      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('movie_view_recorded', { detail: { movieId } })
          );
        }
      } catch {}
    }

    return newlyCounted;
  } catch (err) {
    checkAndHandleQuotaError(err);
    handleFirestoreError(
      err,
      OperationType.WRITE,
      `users/${viewerKey}/watched_movies/${movieId}`,
      false
    );
    return false;
  } finally {
    inFlightMovieViews.delete(cacheKey);
  }
}
