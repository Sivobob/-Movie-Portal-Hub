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

export const DEFAULT_INITIAL_MOVIES: MovieData[] = [
  {
    id: 'pushpa-2-rule-2024',
    title: 'Pushpa 2: The Rule',
    description: 'The clash continues as Pushpa Raj expands his sandalwood smuggling empire against SP Bhanwar Singh Shekhawat.',
    posterUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?auto=format&fit=crop&w=600&q=80',
    releaseYear: 2024,
    originalCategory: 'Bollywood',
    displayCategory: 'Bollywood',
    language: 'Hindi / Telugu',
    genre: 'Action, Crime, Drama',
    rating: 8.8,
    streamingUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    featured: true,
    published: true,
  },
  {
    id: 'kgf-chapter-2-2022',
    title: 'K.G.F: Chapter 2',
    description: 'In the blood-soaked Kolar Gold Fields, Rocky\'s name strikes fear into his foes while his allies look up to him.',
    posterUrl: 'https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=600&q=80',
    releaseYear: 2022,
    originalCategory: 'Bollywood',
    displayCategory: 'Bollywood',
    language: 'Hindi / Kannada',
    genre: 'Action, Thriller',
    rating: 8.4,
    streamingUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    featured: true,
    published: true,
  },
  {
    id: 'stree-2-2024',
    title: 'Stree 2',
    description: 'The town of Chanderi is haunted once again, this time by a headless entity named Sarkata.',
    posterUrl: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?auto=format&fit=crop&w=600&q=80',
    releaseYear: 2024,
    originalCategory: 'Bollywood',
    displayCategory: 'Bollywood',
    language: 'Hindi',
    genre: 'Comedy, Horror',
    rating: 7.9,
    streamingUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    featured: true,
    published: true,
  },
  {
    id: 'mirzapur-s3-2024',
    title: 'Mirzapur (Season 3)',
    description: 'The battle for the throne of Mirzapur reaches a fever pitch as new contenders challenge Guddu Pandit.',
    posterUrl: 'https://images.unsplash.com/photo-1574375927938-d5a98e8ffe85?auto=format&fit=crop&w=600&q=80',
    releaseYear: 2024,
    originalCategory: 'Web Series',
    displayCategory: 'Series',
    language: 'Hindi',
    genre: 'Crime, Drama, Action',
    rating: 8.5,
    streamingUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    featured: true,
    published: true,
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, title: 'Episode 1: Bhaukaal', streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4' },
          { episodeNumber: 2, title: 'Episode 2: Gaddi', streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' }
        ]
      }
    ]
  }
];

export function getLocalMovies(): MovieData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_INITIAL_MOVIES;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    return DEFAULT_INITIAL_MOVIES;
  } catch (e) {
    return DEFAULT_INITIAL_MOVIES;
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

