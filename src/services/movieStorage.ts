import { db } from '../firebase';
import { collection, getDocs, doc, setDoc, deleteDoc, query, orderBy } from 'firebase/firestore';

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
  createdAt?: any;
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

export async function fetchMoviesFromFirestore(): Promise<MovieData[]> {
  try {
    const q = query(collection(db, COLLECTION_NAME), orderBy('releaseYear', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MovieData));
  } catch (e) {
    console.error('Error fetching movies from Firestore', e);
    return [];
  }
}

export async function saveMovieToFirestore(movie: MovieData): Promise<void> {
  try {
    await setDoc(doc(db, COLLECTION_NAME, movie.id), movie);
  } catch (e) {
    console.error('Error saving movie to Firestore', e);
    throw e;
  }
}

export async function deleteMovieFromFirestore(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTION_NAME, id));
  } catch (e) {
    console.error('Error deleting movie from Firestore', e);
    throw e;
  }
}


const STORAGE_KEY = 'movie_portal_movies_v2';

export const DEFAULT_INITIAL_MOVIES: MovieData[] = [];

export function getLocalMovies(): MovieData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // Filter out any legacy dummy/sample movies if present in local storage
      const clean = parsed.filter((m: any) => m && m.id && !['m1', 'm2', 'm3', 'm4', 'default-1', 'default-2'].includes(m.id));
      return clean;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export function saveLocalMovies(movies: MovieData[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(movies));
  } catch (e) {
    console.warn('Failed to save movies to localStorage', e);
  }
}

export function saveMovieLocally(movie: MovieData): MovieData[] {
  const current = getLocalMovies();
  const existingIdx = current.findIndex(m => m.id === movie.id);
  let updated: MovieData[];
  if (existingIdx >= 0) {
    updated = [...current];
    updated[existingIdx] = movie;
  } else {
    updated = [movie, ...current];
  }
  saveLocalMovies(updated);
  return updated;
}

export function deleteMovieLocally(id: string): MovieData[] {
  const current = getLocalMovies();
  const updated = current.filter(m => m.id !== id);
  saveLocalMovies(updated);
  return updated;
}

export function togglePublishLocally(id: string): MovieData[] {
  const current = getLocalMovies();
  const updated = current.map(m => m.id === id ? { ...m, published: !m.published } : m);
  saveLocalMovies(updated);
  return updated;
}

export function toggleFeaturedLocally(id: string): MovieData[] {
  const current = getLocalMovies();
  const updated = current.map(m => m.id === id ? { ...m, featured: !m.featured } : m);
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

