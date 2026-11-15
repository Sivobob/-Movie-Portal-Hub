import { collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp, query, orderBy } from 'firebase/firestore';
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

  try {
    const ref = doc(db, 'users', userId, 'watch_history', movieId);
    await setDoc(ref, payload, { merge: true });
  } catch (e) {
    console.warn('Failed to save watch progress to Firestore:', e);
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
  try {
    const ref = collection(db, 'users', userId, 'watch_history');
    const q = query(ref, orderBy('updatedAt', 'desc'));
    const snap = await getDocs(q);
    if (!snap.empty) {
      return snap.docs.map((d) => d.data() as WatchHistoryItem);
    }
  } catch (e) {
    console.warn('Failed to fetch watch history from Firestore:', e);
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
  try {
    const ref = doc(db, 'users', userId, 'watch_history', movieId);
    await deleteDoc(ref);
  } catch (e) {
    console.warn('Failed to delete watch history item from Firestore:', e);
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

  try {
    const ref = doc(db, 'users', userId, 'my_list', movieId);
    await setDoc(ref, payload, { merge: true });
  } catch (e) {
    console.warn('Failed to add to My List in Firestore:', e);
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
  try {
    const ref = doc(db, 'users', userId, 'my_list', movieId);
    await deleteDoc(ref);
  } catch (e) {
    console.warn('Failed to remove from My List in Firestore:', e);
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
  try {
    const ref = collection(db, 'users', userId, 'my_list');
    const snap = await getDocs(ref);
    if (!snap.empty) {
      return snap.docs.map((d) => d.data() as MyListItem);
    }
  } catch (e) {
    console.warn('Failed to fetch My List from Firestore:', e);
  }

  try {
    const localKey = `movie_portal_mylist_${userId}`;
    return JSON.parse(localStorage.getItem(localKey) || '[]');
  } catch (e) {
    return [];
  }
}
