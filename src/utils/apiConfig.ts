export const LIVE_BACKEND_URL = 'https://ais-dev-zazx2gelikm5prxjdf6l6j-755452514312.asia-northeast1.run.app';
export const PRE_BACKEND_URL = 'https://ais-pre-zazx2gelikm5prxjdf6l6j-755452514312.asia-northeast1.run.app';
export const APP_VERSION = 'v3.5.185';

const ENV_BACKEND_URL = (
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ||
  ''
)
  .toString()
  .trim()
  .replace(/\/+$/, '');

let resolvedNativeBackendUrl: string | null = null;
let bridgeReadyPromise: Promise<void> | null = null;

function isNativeAppRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as any).Capacitor;
  return Boolean(cap && typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : cap?.isNativePlatform);
}

export function getNativeLocalBridgeUrl(): string {
  if (typeof window === 'undefined') return '';
  try {
    const bridge = (window as any).AndroidStreamBridge;
    if (bridge && typeof bridge.getLocalBaseUrl === 'function') {
      const url = String(bridge.getLocalBaseUrl() || '').trim().replace(/\/+$/, '');
      if (url.startsWith('http://127.0.0.1:')) {
        return url;
      }
    }
  } catch {}
  return '';
}

export function isUsingLocalNativeBridge(): boolean {
  const base = getApiBaseUrl();
  return /^https?:\/\/127\.0\.0\.1:\d+/i.test(base);
}

export async function ensureAndroidStreamBridge(): Promise<string> {
  if (typeof window === 'undefined' || !isNativeAppRuntime()) return '';
  const localUrl = getNativeLocalBridgeUrl();
  if (!localUrl) return '';

  if (!bridgeReadyPromise) {
    bridgeReadyPromise = import('./browserTelegramStream')
      .then((mod) => {
        mod.installAndroidStreamBridge(localUrl);
      })
      .catch((err) => {
        console.warn('[AndroidBridge] Initialization warning:', err);
      });
  }
  await bridgeReadyPromise;
  return localUrl;
}

/**
 * Returns the base URL for API requests.
 * - Browser sessions (Chrome on AI Studio, Render, Cloud Run, localhost web): use relative `/api/...` paths.
 * - Native Android APK (Capacitor https://localhost): resolve live public backend URL,
 *   or built-in localhost Telegram streaming bridge if no public backend is reachable.
 */
export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') return '';

  // 1. User or runtime override (only if explicitly configured)
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

  // 3. For Native APK: prefer build-time public backend, probed reachable backend, or local Android bridge
  return ENV_BACKEND_URL || resolvedNativeBackendUrl || getNativeLocalBridgeUrl() || LIVE_BACKEND_URL;
}

async function isBackendHealthy(baseUrl: string): Promise<boolean> {
  const target = baseUrl.replace(/\/+$/, '');
  const healthUrl = target ? `${target}/api/health` : '/api/health';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.redirected && /aistudio\.google\.com|__cookie_check|accounts\.google/i.test(res.url)) {
      return false;
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || !ct.includes('application/json')) {
      return false;
    }

    const data = await res.json().catch(() => null);
    return Boolean(data && data.status === 'ok');
  } catch {
    return false;
  }
}

export async function probeWorkingBackendUrl(): Promise<string | null> {
  let custom = '';
  try {
    custom = (localStorage.getItem('movie_portal_backend_url') || '').trim().replace(/\/+$/, '');
  } catch {}

  const remoteCandidates = Array.from(
    new Set([custom, ENV_BACKEND_URL, PRE_BACKEND_URL, LIVE_BACKEND_URL].filter(Boolean))
  );

  for (const candidate of remoteCandidates) {
    if (await isBackendHealthy(candidate)) {
      resolvedNativeBackendUrl = candidate;
      return candidate;
    }
  }

  // Fallback on native Android APK: use built-in in-app localhost streaming bridge
  const localBridgeUrl = await ensureAndroidStreamBridge();
  if (localBridgeUrl) {
    resolvedNativeBackendUrl = localBridgeUrl;
    return localBridgeUrl;
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
