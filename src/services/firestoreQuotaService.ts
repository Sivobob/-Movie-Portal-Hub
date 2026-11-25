import { buildApiUrl } from '../utils/apiConfig';

/**
 * Firestore Quota & Write-Protection Service
 *
 * Protects the app when the Firebase free-tier quota (e.g. Free daily write units per project)
 * is exceeded by caching the quota state across server & client, hydrating before writes,
 * timing out backoff-stalled writes cleanly, and switching to local-first storage without
 * crashing or logging repetitive SDK backoff loops.
 */

export const QUOTA_EXCEEDED_KEY = 'mp_firestore_write_quota_exceeded_until_v1';

let memExhaustedUntilMs = 0;
let hydratedOnce = false;
let hydratePromise: Promise<boolean> | null = null;
let serverNotifiedThisSession = false;

function computeDefaultExpiryMs(): number {
  const now = new Date();
  // Firestore free daily quotas reset at UTC midnight (00:00 UTC); add 1h buffer.
  const nextUtcMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    1,
    0,
    0
  );
  return Math.max(Date.now() + 12 * 3600 * 1000, nextUtcMidnight);
}

export function isQuotaErrorLike(err: any): boolean {
  const code = String(err?.code || '').toLowerCase();
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    code.includes('resource-exhausted') ||
    code === '429' ||
    msg.includes('resource-exhausted') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('exhausted') ||
    msg.includes('daily write units')
  );
}

export function isFirestoreWriteAllowed(): boolean {
  try {
    if (memExhaustedUntilMs > Date.now()) {
      return false;
    }
    if (typeof window === 'undefined' || !window.localStorage) return true;

    const until = localStorage.getItem(QUOTA_EXCEEDED_KEY);
    if (!until) return true;
    const expiryTime = Number(until);
    if (isNaN(expiryTime) || Date.now() > expiryTime) {
      localStorage.removeItem(QUOTA_EXCEEDED_KEY);
      memExhaustedUntilMs = 0;
      return true;
    }
    memExhaustedUntilMs = expiryTime;
    return false;
  } catch {
    return memExhaustedUntilMs <= Date.now();
  }
}

export function markFirestoreQuotaExhausted(
  err?: any,
  opts?: { skipServerNotify?: boolean; explicitUntilMs?: number }
): void {
  try {
    const shouldMark = !err || isQuotaErrorLike(err);
    if (!shouldMark) return;

    const expiry = Math.max(
      opts?.explicitUntilMs || 0,
      computeDefaultExpiryMs(),
      memExhaustedUntilMs
    );

    const isFirstTransition = memExhaustedUntilMs <= Date.now();
    memExhaustedUntilMs = expiry;

    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        localStorage.setItem(QUOTA_EXCEEDED_KEY, String(expiry));
      } catch {}
    }

    if (isFirstTransition) {
      console.warn(
        '[Firestore Quota Service] Write quota exceeded on free tier. Switching to local-first mode until daily UTC reset.'
      );
    }

    if (!opts?.skipServerNotify && typeof window !== 'undefined' && !serverNotifiedThisSession) {
      serverNotifiedThisSession = true;
      fetch(buildApiUrl('/api/firestore/quota-exhausted'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: String(err?.message || err?.code || 'client-resource-exhausted').slice(0, 200),
        }),
        keepalive: true,
      }).catch(() => {});
    }
  } catch {}
}

export function checkAndHandleQuotaError(err: any): boolean {
  if (isQuotaErrorLike(err)) {
    markFirestoreQuotaExhausted(err);
    return true;
  }
  return false;
}

/**
 * Syncs write-quota status once from the backend server on app startup
 * so brand new browser tabs skip Firestore writes immediately if the backend
 * or another client already hit today's free-tier quota ceiling.
 */
export async function hydrateFirestoreQuotaStatus(): Promise<boolean> {
  if (typeof window === 'undefined') return true;
  if (!isFirestoreWriteAllowed()) return false;
  if (hydratedOnce) return isFirestoreWriteAllowed();
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1200);
      const res = await fetch(buildApiUrl('/api/firestore/quota-status'), {
        cache: 'no-store',
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));

      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data && data.writeAllowed === false) {
          markFirestoreQuotaExhausted(undefined, {
            skipServerNotify: true,
            explicitUntilMs: Number(data.exhaustedUntilMs) || undefined,
          });
          hydratedOnce = true;
          return false;
        }
      }
    } catch {}
    hydratedOnce = true;
    return isFirestoreWriteAllowed();
  })().finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
}

export interface GuardedWriteResult<T> {
  ok: boolean;
  value?: T;
  quotaExhausted?: boolean;
  error?: any;
}

/**
 * Wraps any Firestore SDK mutation (`setDoc`, `addDoc`, `updateDoc`, `deleteDoc`, `runTransaction`)
 * with quota pre-checks, timeout protection (prevents SDK backoff hang), and automatic quota caching.
 */
export async function guardedFirestoreWrite<T>(
  op: () => Promise<T>,
  timeoutMs = 4000
): Promise<GuardedWriteResult<T>> {
  if (!isFirestoreWriteAllowed()) {
    return { ok: false, quotaExhausted: true };
  }

  const allowed = await Promise.race([
    hydrateFirestoreQuotaStatus(),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(isFirestoreWriteAllowed()), 500)),
  ]);
  if (!allowed || !isFirestoreWriteAllowed()) {
    return { ok: false, quotaExhausted: true };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const value = await Promise.race([
      op(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          const timeoutErr = Object.assign(
            new Error('Firestore write timed out (quota/backoff protection).'),
            { code: 'resource-exhausted' }
          );
          markFirestoreQuotaExhausted(timeoutErr);
          reject(timeoutErr);
        }, timeoutMs);
      }),
    ]);
    return { ok: true, value };
  } catch (err: any) {
    const isQuota = checkAndHandleQuotaError(err);
    return { ok: false, quotaExhausted: isQuota, error: err };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
