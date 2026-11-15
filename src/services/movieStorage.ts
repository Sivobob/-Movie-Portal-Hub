import { db } from '../firebase';
import { collection, getDocs, getDocsFromServer, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { normalizeMoviePosters } from '../utils/posterUrl';

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
  featured?: boolean;
  published: boolean;
  qualityBadge?: 'HD' | 'HDTC' | 'NONE' | string;
  createdAt?: any;
  updatedAt?: any;
  contentType?: string | null;
  seasons?: Array<{
    seasonNumber: number;
    episodes: Array<{
      episodeNumber: number;
      title: string;
      streamUrl: string;
      duration?: string;
    }>;
  }>;
}

const COLLECTION_NAME = 'movies';

export function getTimestampMs(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
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

export function sortMoviesList<T extends Partial<MovieData>>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const aTime = getTimestampMs(a.createdAt) || getTimestampMs(a.updatedAt);
    const bTime = getTimestampMs(b.createdAt) || getTimestampMs(b.updatedAt);
    if (bTime !== aTime) return bTime - aTime;
    const yearDiff = (Number(b.releaseYear) || 0) - (Number(a.releaseYear) || 0);
    if (yearDiff !== 0) return yearDiff;
    return String(a.title || '').localeCompare(String(b.title || ''));
  });
}

export async function fetchMoviesFromFirestore(): Promise<MovieData[]> {
  try {
    let snapshot;
    try {
      snapshot = await getDocsFromServer(collection(db, COLLECTION_NAME));
    } catch {
      snapshot = await getDocs(collection(db, COLLECTION_NAME));
    }
    const rawMovies: MovieData[] = snapshot.docs.map(
      (d) => normalizeMoviePosters({ id: d.id, ...d.data() } as MovieData) as MovieData
    );
    const movies = sortMoviesList<MovieData>(rawMovies);
    saveLocalMovies(movies);
    return movies;
  } catch (e) {
    console.error('Error fetching movies from Firestore', e);
    return sortMoviesList(getLocalMovies());
  }
}

export async function saveMovieToFirestore(movie: MovieData): Promise<void> {
  try {
    const normalized = normalizeMoviePosters(movie);
    await setDoc(doc(db, COLLECTION_NAME, normalized.id), normalized);
    saveMovieLocally(normalized);
  } catch (e) {
    console.error('Error saving movie to Firestore', e);
    throw e;
  }
}

export async function deleteMovieFromFirestore(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
    deleteMovieLocally(id);
  } catch (e) {
    console.error('Error deleting movie from Firestore', e);
    throw e;
  }
}

const STORAGE_KEY = 'movie_portal_movies_v2';

export const DEFAULT_INITIAL_MOVIES: MovieData[] = [];

export function getLocalMovies(): MovieData[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return sortMoviesList(
        parsed.filter((m: any) => m && m.id).map((m: any) => normalizeMoviePosters(m))
      );
    }
    return [];
  } catch {
    return [];
  }
}

export function saveLocalMovies(movies: MovieData[]): void {
  try {
    if (typeof window === 'undefined') return;
    if (!Array.isArray(movies)) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(movies));
    } catch {
      // QuotaExceededError safety: store compact metadata without long descriptions so NO movies are dropped
      try {
        const compacted = movies.map((m) => ({
          ...m,
          description: m.description ? String(m.description).slice(0, 180) : '',
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(compacted));
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
  return sorted;
}

export function deleteMovieLocally(id: string): MovieData[] {
  const current = getLocalMovies();
  const updated = current.filter((m) => m.id !== id);
  saveLocalMovies(updated);
  return updated;
}

export function togglePublishLocally(id: string): MovieData[] {
  const current = getLocalMovies();
  const updated = current.map((m) => (m.id === id ? { ...m, published: !m.published } : m));
  saveLocalMovies(updated);
  return updated;
}

export function toggleFeaturedLocally(id: string): MovieData[] {
  const current = getLocalMovies();
  const updated = current.map((m) => (m.id === id ? { ...m, featured: !m.featured } : m));
  saveLocalMovies(updated);
  return updated;
}

export function clearAllMoviesLocally(): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
      localStorage.removeItem('movie_portal_movies');
    }
  } catch (e) {
    console.warn('Failed to clear movies from localStorage', e);
  }
}
