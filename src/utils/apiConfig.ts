export const CLOUD_RUN_BACKEND_URL = 'https://ais-pre-6ejzhiqpwvhbnrmdodefzr-997472249123.asia-east1.run.app';
export const LIVE_BACKEND_URL = 'https://ais-dev-6ejzhiqpwvhbnrmdodefzr-997472249123.asia-east1.run.app';
export const PRE_BACKEND_URL = 'https://ais-pre-6ejzhiqpwvhbnrmdodefzr-997472249123.asia-east1.run.app';
export const APP_VERSION = 'v3.5.326';

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
  const w = window as any;
  if (w.AndroidPlayerBridge || w.AndroidStreamBridge) return true;
  const cap = w.Capacitor;
  return Boolean(cap && typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : cap?.isNativePlatform);
}

function isLoadedOnRemoteLiveWebOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const { protocol, hostname } = window.location;
    return protocol === 'https:' && !/^(localhost|127\.0\.0\.1)$/i.test(hostname);
  } catch {
    return false;
  }
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

  // 3. For Native APK loaded on a live HTTPS server: use same-origin unless another remote transcode server was resolved
  if (isLoadedOnRemoteLiveWebOrigin()) {
    return (
      resolvedRemoteTranscodeUrl ||
      resolvedNativeBackendUrl ||
      (typeof window !== 'undefined' && window.location?.origin ? window.location.origin.replace(/\/+$/, '') : '') ||
      ''
    );
  }

  // 4. For Native APK loaded from bundled localhost: prefer healthy public backend, else local bridge
  const localBridge = getNativeLocalBridgeUrl();
  return (
    resolvedRemoteTranscodeUrl ||
    localBridge ||
    resolvedNativeBackendUrl ||
    ENV_BACKEND_URL ||
    ''
  );
}

interface HealthCheckResult {
  ok: boolean;
  transcodeSupported: boolean;
  telegramConfigured: boolean;
}

async function checkBackendHealth(baseUrl: string, timeoutMs = 3800): Promise<HealthCheckResult> {
  const target = baseUrl.replace(/\/+$/, '');
  if (!target) return { ok: false, transcodeSupported: false, telegramConfigured: false };
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
      return { ok: false, transcodeSupported: false, telegramConfigured: false };
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!res.ok || !ct.includes('application/json')) {
      return { ok: false, transcodeSupported: false, telegramConfigured: false };
    }

    const data = await res.json().catch(() => null);
    if (!data || data.status !== 'ok') {
      return { ok: false, transcodeSupported: false, telegramConfigured: false };
    }
    const telegramConfigured = data.telegramConfigured !== false;
    const transcodeSupported =
      data.transcodeSupported === true ||
      (data.ffmpegAvailable === true && data.ffprobeAvailable === true && telegramConfigured);
    return { ok: true, transcodeSupported, telegramConfigured };
  } catch {
    return { ok: false, transcodeSupported: false, telegramConfigured: false };
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

    const currentOrigin = isLoadedOnRemoteLiveWebOrigin()
      ? window.location.origin.replace(/\/+$/, '')
      : '';

    const staticCandidates = Array.from(
      new Set([custom, currentOrigin, ENV_BACKEND_URL, PRE_BACKEND_URL, LIVE_BACKEND_URL, CLOUD_RUN_BACKEND_URL].filter(Boolean))
    );

    const checkResults = new Map<string, HealthCheckResult & { candidate: string }>();
    const probeCandidate = async (candidate: string) => {
      const res = await checkBackendHealth(candidate, 1200);
      const entry = { candidate, ...res };
      checkResults.set(candidate, entry);
      return entry;
    };

    // Race static health checks in parallel WITH Firestore backend URL lookup so dead URLs never stall playback
    const firestorePromise = fetchFirestoreConfiguredBackendUrl().then(async (fsUrl) => {
      if (fsUrl && !checkResults.has(fsUrl)) {
        return probeCandidate(fsUrl);
      }
      return null;
    });

    const staticPromises = staticCandidates.map((c) => probeCandidate(c));

    // Return immediately as soon as the first fullHealthy (FFmpeg + Telegram) remote backend responds
    const firstHealthy = await Promise.any(
      [...staticPromises, firestorePromise].map((p) =>
        p.then((res) => {
          if (res && res.ok && res.transcodeSupported && res.telegramConfigured) {
            return res;
          }
          throw new Error('not_full_healthy');
        })
      )
    ).catch(() => null);

    if (firstHealthy) {
      resolvedNativeBackendUrl = firstHealthy.candidate;
      resolvedRemoteTranscodeUrl = firstHealthy.candidate;
      lastProbeTimestamp = Date.now();
      await bridgeInitPromise;
      return firstHealthy.candidate;
    }

    await Promise.allSettled([...staticPromises, firestorePromise]);
    const checks = Array.from(checkResults.values());
    const fullHealthy = checks.find((c) => c.ok && c.transcodeSupported && c.telegramConfigured);
    if (fullHealthy) {
      resolvedNativeBackendUrl = fullHealthy.candidate;
      resolvedRemoteTranscodeUrl = fullHealthy.candidate;
      lastProbeTimestamp = Date.now();
      await bridgeInitPromise;
      return fullHealthy.candidate;
    }

    resolvedRemoteTranscodeUrl = null;

    // On native Android APK: prefer built-in in-app localhost streaming bridge over a remote server that lacks FFmpeg/transcoding
    const localBridgeUrl = await bridgeInitPromise;
    if (localBridgeUrl) {
      resolvedNativeBackendUrl = localBridgeUrl;
      lastProbeTimestamp = Date.now();
      return localBridgeUrl;
    }

    const fallbackRemote = checks.find((c) => c.ok && c.telegramConfigured);
    if (fallbackRemote) {
      resolvedNativeBackendUrl = fallbackRemote.candidate;
      lastProbeTimestamp = Date.now();
      return fallbackRemote.candidate;
    }

    return null;
  })().finally(() => {
    inflightProbePromise = null;
  });

  return inflightProbePromise;
}

export function buildApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${cleanPath}` : cleanPath;
}

/**
 * Guarantees a fully-qualified absolute URL (https://...) suitable for
 * Android Native Java HttpURLConnection download tasks and bridge callers.
 */
export function buildAbsoluteDownloadUrl(pathOrUrl: string): string {
  const clean = String(pathOrUrl || '').trim();
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  const cleanPath = clean.startsWith('/') ? clean : `/${clean}`;

  if (isNativeAppRuntime()) {
    const remote = getRemoteTranscodeBackendUrl();
    if (remote) {
      return `${remote.replace(/\/+$/, '')}${cleanPath}`;
    }
    const local = getNativeLocalBridgeUrl();
    if (local) {
      return `${local.replace(/\/+$/, '')}${cleanPath}`;
    }
  }

  const base = getApiBaseUrl();
  return base ? `${base.replace(/\/+$/, '')}${cleanPath}` : cleanPath;
}

/**
 * When running on the live published HTTPS app (e.g. ais-pre-...run.app),
 * ensure Firestore admins/backend records the live origin so already-installed
 * Android APKs automatically pick up UI & feature updates over-the-air.
 */
export async function syncLiveAppOriginToFirestoreIfPublished(): Promise<void> {
  if (typeof window === 'undefined' || isNativeAppRuntime()) return;
  try {
    const origin = window.location.origin.replace(/\/+$/, '');
    const hostname = window.location.hostname.toLowerCase();
    // Only advertise public non-dev HTTPS origins (ais-dev requires Google Auth cookies)
    if (
      !origin.startsWith('https://') ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('ais-dev-')
    ) {
      return;
    }

    const sessionKey = `mp_live_origin_synced_${origin}`;
    if (sessionStorage.getItem(sessionKey) === '1') return;

    const health = await checkBackendHealth(origin, 2500);
    if (!health.ok) return;

    const [{ doc, getDoc, setDoc }, { db }, quotaMod] = await Promise.all([
      import('firebase/firestore'),
      import('../firebase'),
      import('../services/firestoreQuotaService'),
    ]);

    if (!quotaMod.isFirestoreWriteAllowed()) return;

    const backendRef = doc(db, 'admins', 'backend');
    const snap = await getDoc(backendRef).catch(() => null);
    const data = snap && snap.exists() ? (snap.data() as any) : null;
    if (data?.liveAppUrl === origin && data?.backendUrl === origin) {
      sessionStorage.setItem(sessionKey, '1');
      return;
    }

    const res = await quotaMod.guardedFirestoreWrite(() =>
      setDoc(
        backendRef,
        {
          liveAppUrl: origin,
          webAppUrl: origin,
          backendUrl: origin,
          updatedAt: Date.now(),
        },
        { merge: true }
      )
    );
    if (res.ok) {
      sessionStorage.setItem(sessionKey, '1');
    }
  } catch {
    // Non-critical background sync
  }
}
