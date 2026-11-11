export const LIVE_BACKEND_URL = 'https://ais-pre-wfl4fkek6sbm6lchwjz2bi-832989141722.asia-southeast1.run.app';


/**
 * Returns the base URL for API requests.
 * When running inside a native Android APK (Capacitor) or on file/localhost webview,
 * relative paths like `/api/...` hit the local app assets and return index.html.
 * Instead, they must point to the live backend server.
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';

  const customServer = localStorage.getItem('movie_portal_backend_url');
  if (customServer && customServer.trim()) {
    return customServer.trim().replace(/\/+$/, '');
  }

  // If directly running on the Cloud Run backend server, relative paths work
  if (window.location.hostname && window.location.hostname.includes('run.app')) {
    return '';
  }

  // In all other environments (Android APK, Capacitor webview, localhost, GitHub Pages, external preview):
  return LIVE_BACKEND_URL;
}

/**
 * Builds a full API URL given an endpoint path like `/api/stream?url=...`
 */
export function buildApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}
