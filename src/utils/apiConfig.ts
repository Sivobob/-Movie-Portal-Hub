export const LIVE_BACKEND_URL = 'https://ais-dev-zazx2gelikm5prxjdf6l6j-755452514312.asia-northeast1.run.app';
export const PRE_BACKEND_URL = 'https://ais-pre-zazx2gelikm5prxjdf6l6j-755452514312.asia-northeast1.run.app';
export const APP_VERSION = 'v3.5.184';

const ENV_BACKEND_URL = (
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ||
  ''
)
  .toString()
  .trim()
  .replace(/\/+$/, '');

let resolvedNativeBackendUrl: string | null = null;

function isNativeAppRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return Boolean(cap && typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : cap?.isNativePlatform);
}

/**
 * Returns the base URL for API requests.
 * - Browser sessions (AI Studio, Render, Cloud Run, localhost web): use relative `/api/...` paths.
 * - Native Android APK (Capacitor https://localhost): resolve live public backend URL.
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';

  // 1. User manual override (e.g. Render / VPS / custom server URL)
  try {
    const customServer = localStorage.getItem('movie_portal_backend_url');
    if (customServer && customServer.trim()) {
      return customServer.trim().replace(/\/+$/, '');
    }
  } catch {}

  // 2. If running in regular web browser (Chrome on AI Studio, Render, Vercel, etc.), use relative paths
  if (!isNativeAppRuntime()) {
    return '';
  }

  // 3. For Native APK: prefer build-time public backend (Render), then probed working backend, then fallback URL
  return ENV_BACKEND_URL || resolvedNativeBackendUrl || LIVE_BACKEND_URL;
}

export type BackendHealthStatus = 'ok' | 'auth_blocked' | 'unreachable';

export async function diagnoseBackendHealth(baseUrl?: string): Promise<BackendHealthStatus> {
  const target = (baseUrl ?? getApiBaseUrl()).replace(/\/+$/, '');
  const healthUrl = target ? `${target}/api/health` : '/api/health';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.redirected && /aistudio\.google\.com|__cookie_check|accounts\.google/i.test(res.url)) {
      return 'auth_blocked';
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok) {
      return res.status === 401 || res.status === 403 ? 'auth_blocked' : 'unreachable';
    }
    if (!ct.includes('application/json')) {
      return 'auth_blocked';
    }

    const data = await res.json().catch(() => null);
    return data && data.status === 'ok' ? 'ok' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

export async function probeWorkingBackendUrl(): Promise<string | null> {
  let custom = '';
  try {
    custom = (localStorage.getItem('movie_portal_backend_url') || '').trim().replace(/\/+$/, '');
  } catch {}

  const candidates = Array.from(
    new Set([custom, ENV_BACKEND_URL, PRE_BACKEND_URL, LIVE_BACKEND_URL].filter(Boolean))
  );

  for (const candidate of candidates) {
    const status = await diagnoseBackendHealth(candidate);
    if (status === 'ok') {
      resolvedNativeBackendUrl = candidate;
      return candidate;
    }
  }
  return null;
}

/**
 * Builds a full API URL given an endpoint path like `/api/stream?url=...`
 */
export function buildApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}

