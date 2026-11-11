export const LIVE_BACKEND_URL = 'https://ais-dev-wfl4fkek6sbm6lchwjz2bi-832989141722.asia-southeast1.run.app';
export const APP_VERSION = 'v3.5.0-ULTIMATE-FIX';


/**
 * Returns the base URL for API requests.
 * When running inside a native Android APK (Capacitor) or on file/localhost webview,
 * relative paths like `/api/...` hit the local app assets and return index.html.
 * Instead, they must point to the live backend server.
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';

  // 1. User manual override
  const customServer = localStorage.getItem('movie_portal_backend_url');
  if (customServer && customServer.trim()) {
    return customServer.trim().replace(/\/+$/, '');
  }

  // 2. If running on a known cloud domain (Chrome/Web), use relative paths
  if (window.location.hostname && window.location.hostname.includes('run.app')) {
    return '';
  }

  // 3. For Native APK / Localhost, we must use an absolute URL.
  // We prioritize the Dev URL because that's where the user is seeing it work in Chrome.
  return LIVE_BACKEND_URL;
}

/**
 * Builds a full API URL given an endpoint path like `/api/stream?url=...`
 */
export function buildApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  
  // Debug log for app development
  if ((window as any).Capacitor?.isNativePlatform()) {
     console.log('[API] Final URL:', base ? `${base}${cleanPath}` : cleanPath);
  }

  return base ? `${base}${cleanPath}` : cleanPath;
}
