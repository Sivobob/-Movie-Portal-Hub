export const LIVE_BACKEND_URL = 'https://ais-dev-6gly7u37gub42qcc23fd3k-828533060153.asia-northeast1.run.app';
export const PRE_BACKEND_URL = 'https://ais-pre-6gly7u37gub42qcc23fd3k-828533060153.asia-northeast1.run.app';
export const APP_VERSION = 'v3.5.220';

const ENV_BACKEND_URL = (
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ||
  ''
)
  .toString()
  .trim()
  .replace(/\/+$/, '');

let resolvedNativeBackendUrl: string | null = null;
let resolvedRemoteTranscodeUrl: string | null = null;
let lastProbeTimestamp = 0;
let inflightProbePromise: Promise<string | null> | null = null;
let bridgeReadyPromise: Promise<void> | null = null;
const PROBE_CACHE_TTL_MS = 60 * 1000;

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

export function hasRemoteTranscodeBackend(): boolean {
  if (!isNativeAppRuntime()) return true;
  return Boolean(resolvedRemoteTranscodeUrl);
}

export function getRemoteTranscodeBackendUrl(): string {
  if (!isNativeAppRuntime()) return '';
  return resolvedRemoteTranscodeUrl || '';
}

export function forceUseLocalNativeBridge(): string {
  const localUrl = getNativeLocalBridgeUrl();
  if (localUrl) {
    resolvedNativeBackendUrl = localUrl;
    lastProbeTimestamp = Date.now();
  }
  return localUrl;
}

export function abortLocalBridgeStreams(): void {
  if (typeof window === 'undefined') return;
  try {
    (window as any).AndroidStreamBridge?.abortAllStreams?.();
  } catch {}
  try {
    (window as any).__tgStreamBridge?.abortAll?.();
  } catch {}
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
        bridgeReadyPromise = null;
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

  // 3. For Native APK: prefer build-time/probed healthy public backend, else built-in Android local bridge
  return resolvedRemoteTranscodeUrl || ENV_BACKEND_URL || resolvedNativeBackendUrl || getNativeLocalBridgeUrl() || '';
}

interface HealthCheckResult {
  ok: boolean;
  transcodeSupported: boolean;
}

async function checkBackendHealth(baseUrl: string, timeoutMs = 2000): Promise<HealthCheckResult> {
  const target = baseUrl.replace(/\/+$/, '');
  if (!target) return { ok: false, transcodeSupported: false };
  const healthUrl = `${target}/api/health`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.redirected && /aistudio\.google\.com|__cookie_check|accounts\.google/i.test(res.url)) {
      return { ok: false, transcodeSupported: false };
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || !ct.includes('application/json')) {
      return { ok: false, transcodeSupported: false };
    }

    const data = await res.json().catch(() => null);
    if (!data || data.status !== 'ok') {
      return { ok: false, transcodeSupported: false };
    }
    const transcodeSupported =
      data.transcodeSupported === true ||
      (data.ffmpegAvailable === true && data.ffprobeAvailable === true && data.telegramConfigured !== false) ||
      (data.ffmpegAvailable === undefined && data.status === 'ok');
    return { ok: true, transcodeSupported };
  } catch {
    return { ok: false, transcodeSupported: false };
  }
}

async function fetchFirestoreConfiguredBackendUrl(): Promise<string> {
  try {
    const [{ doc, getDoc }, { db }] = await Promise.all([
      import('firebase/firestore'),
      import('../firebase'),
    ]);
    const controllerTimeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), 1400));
    const readDoc = Promise.any([
      getDoc(doc(db, 'admins', 'backend')),
      getDoc(doc(db, 'app_config', 'backend')),
    ])
      .then((snap) => {
        if (!snap.exists()) return '';
        const d: any = snap.data();
        const url = String(d?.backendUrl || d?.apiBaseUrl || d?.url || '').trim().replace(/\/+$/, '');
        return /^https?:\/\//i.test(url) ? url : '';
      })
      .catch(() => '');
    return await Promise.race([readDoc, controllerTimeout]);
  } catch {
    return '';
  }
}

export async function probeWorkingBackendUrl(force = false): Promise<string | null> {
  const bridgeInitPromise = ensureAndroidStreamBridge().catch(() => '');

  if (
    !force &&
    resolvedNativeBackendUrl &&
    Date.now() - lastProbeTimestamp < PROBE_CACHE_TTL_MS
  ) {
    await bridgeInitPromise;
    return resolvedNativeBackendUrl;
  }

  if (!force && inflightProbePromise) {
    return inflightProbePromise;
  }

  inflightProbePromise = (async () => {
    let custom = '';
    try {
      custom = (localStorage.getItem('movie_portal_backend_url') || '').trim().replace(/\/+$/, '');
    } catch {}

    const firestoreBackendUrl = await fetchFirestoreConfiguredBackendUrl();

    const remoteCandidates = Array.from(
      new Set([custom, ENV_BACKEND_URL, firestoreBackendUrl, PRE_BACKEND_URL, LIVE_BACKEND_URL].filter(Boolean))
    );

    if (remoteCandidates.length > 0) {
      const checks = await Promise.all(
        remoteCandidates.map(async (candidate) => ({
          candidate,
          ...(await checkBackendHealth(candidate, 2000)),
        }))
      );
      const firstHealthy = checks.find((c) => c.ok);
      if (firstHealthy) {
        resolvedNativeBackendUrl = firstHealthy.candidate;
        resolvedRemoteTranscodeUrl = firstHealthy.transcodeSupported ? firstHealthy.candidate : null;
        lastProbeTimestamp = Date.now();
        await bridgeInitPromise;
        return firstHealthy.candidate;
      }
    }

    resolvedRemoteTranscodeUrl = null;

    // Fallback on native Android APK: use built-in in-app localhost streaming bridge
    const localBridgeUrl = await bridgeInitPromise;
    if (localBridgeUrl) {
      resolvedNativeBackendUrl = localBridgeUrl;
      lastProbeTimestamp = Date.now();
      return localBridgeUrl;
    }

    return null;
  })().finally(() => {
    inflightProbePromise = null;
  });

  return inflightProbePromise;
}

/**
 * Builds a full API URL given an endpoint path like `/api/stream?url=...`
 */
export function buildApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}
