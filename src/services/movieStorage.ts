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
    }>;
  }>;
}

export const INITIAL_SAMPLE_MOVIES: MovieData[] = [
  {
    id: 'featured-series-1',
    title: 'Cyberpunk Chronicles',
    originalTitle: 'Cyberpunk Chronicles: Season 1',
    description: 'In a dystopian future, an underground crew fights against mega-corporations to reclaim freedom and humanity in the neon-lit city.',
    posterUrl: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?q=80&w=800',
    backdropUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?q=80&w=1400',
    releaseYear: 2024,
    originalCategory: 'Web Series',
    displayCategory: 'Series',
    language: 'Hindi / English',
    genre: 'Sci-Fi / Action',
    rating: 8.8,
    featured: true,
    published: true,
    streamingUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          {
            episodeNumber: 1,
            title: 'Episode 1: The Resistance Awakens',
            streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
          },
          {
            episodeNumber: 2,
            title: 'Episode 2: Neon Shadows',
            streamUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
          },
        ],
      },
    ],
  },
  {
    id: 'featured-holly-1',
    title: 'Tears of Steel',
    originalTitle: 'Tears of Steel: Retribution',
    description: 'A group of warriors and scientists in a dystopian future attempt to stage a crucial event to save mankind from destructive cyborgs.',
    posterUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=800',
    backdropUrl: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?q=80&w=1400',
    releaseYear: 2023,
    originalCategory: 'Hollywood Movie',
    displayCategory: 'Hollywood',
    language: 'English',
    genre: 'Action / Sci-Fi',
    rating: 8.4,
    featured: true,
    published: true,
    streamingUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
  },
  {
    id: 'featured-bolly-1',
    title: 'Pathaan: The Undercover Agent',
    originalTitle: 'Pathaan',
    description: 'An Indian RAW agent teams up with an ex-ISI agent to stop a ruthless former colleague from unleashing a deadly synthetic weapon.',
    posterUrl: 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=800',
    backdropUrl: 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?q=80&w=1400',
    releaseYear: 2023,
    originalCategory: 'Bollywood Movie',
    displayCategory: 'Bollywood',
    language: 'Hindi',
    genre: 'Action / Thriller',
    rating: 8.7,
    featured: true,
    published: true,
    streamingUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
  },
];

const STORAGE_KEY = 'movie_portal_movies_v2';

export function getLocalMovies(): MovieData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SAMPLE_MOVIES));
      return INITIAL_SAMPLE_MOVIES;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
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
