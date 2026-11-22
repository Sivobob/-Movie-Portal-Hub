/**
 * Firestore Quota & Write-Protection Service
 *
 * Protects the app when the Firebase free-tier quota (e.g. Free daily write units per project)
 * is exceeded by caching the quota state in localStorage and gracefully switching to
 * local storage caching without crashing or logging repetitive backoff errors.
 */

const QUOTA_EXCEEDED_KEY = 'mp_firestore_write_quota_exceeded_until_v1';

// The project 751106178257 reached free tier daily write limits on Nov 18, 2026 UTC.
// Firestore free daily quotas reset at UTC midnight (00:00 UTC).
const KNOWN_QUOTA_RESET_UTC_MS = Date.UTC(2026, 10, 19, 0, 30, 0);

export function isFirestoreWriteAllowed(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return true;

    // Guard during the active exhausted quota window until next daily reset
    if (Date.now() < KNOWN_QUOTA_RESET_UTC_MS) {
      return false;
    }

    const until = localStorage.getItem(QUOTA_EXCEEDED_KEY);
    if (!until) return true;
    const expiryTime = Number(until);
    if (isNaN(expiryTime) || Date.now() > expiryTime) {
      localStorage.removeItem(QUOTA_EXCEEDED_KEY);
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

export function markFirestoreQuotaExhausted(err?: any): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const msg = String(err?.message || err?.code || err || '').toLowerCase();
    const isQuotaError =
      msg.includes('resource-exhausted') ||
      msg.includes('quota') ||
      msg.includes('exhausted') ||
      msg.includes('daily write units');

    if (isQuotaError || !err) {
      // Set quota hold until next UTC midnight + 1 hour buffer (24h default)
      const now = new Date();
      const nextUtcMidnight = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
        1, 0, 0
      );
      const expiry = Math.max(Date.now() + 12 * 3600 * 1000, nextUtcMidnight);
      localStorage.setItem(QUOTA_EXCEEDED_KEY, String(expiry));
      console.warn(
        '[Firestore Quota Service] Write quota exceeded on free tier. Switching to local-first mode until reset.'
      );
    }
  } catch {}
}

export function checkAndHandleQuotaError(err: any): boolean {
  const msg = String(err?.message || err?.code || err || '').toLowerCase();
  if (
    msg.includes('resource-exhausted') ||
    msg.includes('quota') ||
    msg.includes('exhausted') ||
    msg.includes('daily write units')
  ) {
    markFirestoreQuotaExhausted(err);
    return true;
  }
  return false;
}
