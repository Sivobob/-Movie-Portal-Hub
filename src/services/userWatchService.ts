import { collection, doc, getDocs, getDoc, setDoc, deleteDoc, addDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

export interface WatchHistoryItem {
  movieId: string;
  title: string;
  posterUrl: string;
  streamingUrl: string;
  progress: number; // 0 to 100 percentage
  duration?: number;
  currentTime?: number;
  displayCategory?: string;
  updatedAt?: any;
  movieData?: any;
}

export interface MyListItem {
  movieId: string;
  title: string;
  posterUrl: string;
  displayCategory?: string;
  addedAt?: any;
  movieData?: any;
}

import {
  isFirestoreWriteAllowed,
  checkAndHandleQuotaError,
  guardedFirestoreWrite,
} from './firestoreQuotaService';

export async function saveWatchProgress(userId: string, movie: any, currentTime: number, duration: number) {
  if (!userId || !movie) return;
  const movieId = movie.id || movie.imdbId || 'unknown';
  const progress = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;
  
  const payload = {
    movieId,
    title: movie.title || 'Untitled',
    posterUrl: movie.posterUrl || movie.backdropUrl || '',
    streamingUrl: movie.streamingUrl || movie.seasons?.[0]?.episodes?.[0]?.streamUrl || '',
    progress,
    currentTime,
    duration,
    displayCategory: movie.displayCategory || movie.originalCategory || 'Movie',
    updatedAt: serverTimestamp(),
    movieData: movie,
  };

  if (isFirestoreWriteAllowed()) {
    const ref = doc(db, 'users', userId, 'watch_history', movieId);
    await guardedFirestoreWrite(() => setDoc(ref, payload, { merge: true }));
  }

  // Also save locally as fallback
  try {
    const localKey = `movie_portal_history_${userId}`;
    const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
    const filtered = existing.filter((item: any) => item.movieId !== movieId);
    filtered.unshift(payload);
    localStorage.setItem(localKey, JSON.stringify(filtered.slice(0, 20)));
  } catch (e) {}
}

export async function fetchWatchHistory(userId: string): Promise<WatchHistoryItem[]> {
  if (!userId) return [];
  if (isFirestoreWriteAllowed()) {
    try {
      const ref = collection(db, 'users', userId, 'watch_history');
      const q = query(ref, orderBy('updatedAt', 'desc'));
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs.map((d) => d.data() as WatchHistoryItem);
      }
    } catch (e) {
      checkAndHandleQuotaError(e);
    }
  }

  // Fallback to local storage
  try {
    const localKey = `movie_portal_history_${userId}`;
    return JSON.parse(localStorage.getItem(localKey) || '[]');
  } catch (e) {
    return [];
  }
}

export async function removeWatchHistoryItem(userId: string, movieId: string) {
  if (!userId || !movieId) return;
  if (isFirestoreWriteAllowed()) {
    const ref = doc(db, 'users', userId, 'watch_history', movieId);
    await guardedFirestoreWrite(() => deleteDoc(ref));
  }

  try {
    const localKey = `movie_portal_history_${userId}`;
    const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
    const filtered = existing.filter((item: any) => item.movieId !== movieId);
    localStorage.setItem(localKey, JSON.stringify(filtered));
  } catch (e) {}
}

export async function addToMyList(userId: string, movie: any) {
  if (!userId || !movie) return;
  const movieId = movie.id || movie.imdbId || 'unknown';
  const payload = {
    movieId,
    title: movie.title || 'Untitled',
    posterUrl: movie.posterUrl || movie.backdropUrl || '',
    displayCategory: movie.displayCategory || movie.originalCategory || 'Movie',
    addedAt: serverTimestamp(),
    movieData: movie,
  };

  if (isFirestoreWriteAllowed()) {
    const ref = doc(db, 'users', userId, 'my_list', movieId);
    await guardedFirestoreWrite(() => setDoc(ref, payload, { merge: true }));
  }

  try {
    const localKey = `movie_portal_mylist_${userId}`;
    const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
    if (!existing.some((item: any) => item.movieId === movieId)) {
      existing.unshift(payload);
      localStorage.setItem(localKey, JSON.stringify(existing));
    }
  } catch (e) {}
}

export async function removeFromMyList(userId: string, movieId: string) {
  if (!userId || !movieId) return;
  if (isFirestoreWriteAllowed()) {
    const ref = doc(db, 'users', userId, 'my_list', movieId);
    await guardedFirestoreWrite(() => deleteDoc(ref));
  }

  try {
    const localKey = `movie_portal_mylist_${userId}`;
    const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
    const filtered = existing.filter((item: any) => item.movieId !== movieId);
    localStorage.setItem(localKey, JSON.stringify(filtered));
  } catch (e) {}
}

export async function fetchMyList(userId: string): Promise<MyListItem[]> {
  if (!userId) return [];
  if (isFirestoreWriteAllowed()) {
    try {
      const ref = collection(db, 'users', userId, 'my_list');
      const snap = await getDocs(ref);
      if (!snap.empty) {
        return snap.docs.map((d) => d.data() as MyListItem);
      }
    } catch (e) {
      checkAndHandleQuotaError(e);
    }
  }

  try {
    const localKey = `movie_portal_mylist_${userId}`;
    return JSON.parse(localStorage.getItem(localKey) || '[]');
  } catch (e) {
    return [];
  }
}

export async function saveUserRating(userId: string, movieId: string, rating: number) {
  if (!userId || !movieId) return;
  const payload = {
    movieId,
    rating,
    updatedAt: serverTimestamp(),
  };

  if (isFirestoreWriteAllowed()) {
    const ref = doc(db, 'users', userId, 'ratings', movieId);
    await guardedFirestoreWrite(() => setDoc(ref, payload, { merge: true }));
  }

  try {
    localStorage.setItem(`movie_rating_${userId}_${movieId}`, String(rating));
  } catch (e) {}
}

export async function getUserRating(userId: string, movieId: string): Promise<number | null> {
  if (!userId || !movieId) return null;
  if (isFirestoreWriteAllowed()) {
    try {
      const ref = doc(db, 'users', userId, 'ratings', movieId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        return (snap.data() as any).rating ?? null;
      }
    } catch (e) {
      checkAndHandleQuotaError(e);
    }
  }

  try {
    const val = localStorage.getItem(`movie_rating_${userId}_${movieId}`);
    return val ? Number(val) : null;
  } catch (e) {
    return null;
  }
}

export async function submitContentReport(
  userId: string,
  reportData: {
    movieId: string;
    movieTitle: string;
    reason: string;
    details?: string;
  }
) {
  const payload = {
    ...reportData,
    userId: userId || 'anonymous',
    createdAt: serverTimestamp(),
    status: 'pending',
  };

  if (isFirestoreWriteAllowed()) {
    await guardedFirestoreWrite(() => addDoc(collection(db, 'reports'), payload));
  }

  try {
    const existing = JSON.parse(localStorage.getItem('movie_portal_reports') || '[]');
    existing.unshift({ ...payload, createdAt: new Date().toISOString() });
    localStorage.setItem('movie_portal_reports', JSON.stringify(existing.slice(0, 30)));
  } catch (e) {}
}

export interface MyLikeItem {
  movieId: string;
  title: string;
  posterUrl: string;
  displayCategory?: string;
  likedAt?: any;
  movieData?: any;
}

export async function addToMyLikes(userId: string, movie: any) {
  if (!userId || !movie) return;
  const movieId = movie.id || movie.imdbId || 'unknown';
  const payload = {
    movieId,
    title: movie.title || 'Untitled',
    posterUrl: movie.posterUrl || movie.backdropUrl || '',
    displayCategory: movie.displayCategory || movie.originalCategory || 'Movie',
    likedAt: serverTimestamp(),
    movieData: movie,
  };

  if (isFirestoreWriteAllowed()) {
    const ref = doc(db, 'users', userId, 'likes', movieId);
    await guardedFirestoreWrite(() => setDoc(ref, payload, { merge: true }));
  }

  try {
    const localKey = `movie_portal_likes_${userId}`;
    const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
    if (!existing.some((item: any) => item.movieId === movieId)) {
      existing.unshift(payload);
      localStorage.setItem(localKey, JSON.stringify(existing));
    }
  } catch (e) {}
}

export async function removeFromMyLikes(userId: string, movieId: string) {
  if (!userId || !movieId) return;
  if (isFirestoreWriteAllowed()) {
    const ref = doc(db, 'users', userId, 'likes', movieId);
    await guardedFirestoreWrite(() => deleteDoc(ref));
  }

  try {
    const localKey = `movie_portal_likes_${userId}`;
    const existing = JSON.parse(localStorage.getItem(localKey) || '[]');
    const filtered = existing.filter((item: any) => item.movieId !== movieId);
    localStorage.setItem(localKey, JSON.stringify(filtered));
  } catch (e) {}
}

export async function fetchMyLikes(userId: string): Promise<MyLikeItem[]> {
  if (!userId) return [];
  if (isFirestoreWriteAllowed()) {
    try {
      const ref = collection(db, 'users', userId, 'likes');
      const snap = await getDocs(ref);
      if (!snap.empty) {
        return snap.docs.map((d) => d.data() as MyLikeItem);
      }
    } catch (e) {
      checkAndHandleQuotaError(e);
    }
  }

  try {
    const localKey = `movie_portal_likes_${userId}`;
    return JSON.parse(localStorage.getItem(localKey) || '[]');
  } catch (e) {
    return [];
  }
}

export async function clearWatchHistory(userId: string) {
  if (!userId) return;
  if (isFirestoreWriteAllowed()) {
    await guardedFirestoreWrite(async () => {
      const ref = collection(db, 'users', userId, 'watch_history');
      const snap = await getDocs(ref);
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    });
  }

  try {
    localStorage.removeItem(`movie_portal_history_${userId}`);
  } catch (e) {}
}
