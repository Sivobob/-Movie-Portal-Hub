import fs from 'fs';

const QUOTA_FLAG_FILE = '/tmp/.mp_firestore_write_quota.json';

interface QuotaFlagState {
  exhaustedUntilMs: number;
  updatedAtMs: number;
  reason?: string;
}

let cachedUntilMs = 0;
let loadedFromDisk = false;

function computeNextResetExpiryMs(): number {
  const now = new Date();
  // Firestore daily free quotas reset at 00:00 UTC; add 1h safety buffer (01:00 UTC next day)
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

function loadFromDiskOnce(): void {
  if (loadedFromDisk) return;
  loadedFromDisk = true;
  try {
    if (fs.existsSync(QUOTA_FLAG_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(QUOTA_FLAG_FILE, 'utf8')) as QuotaFlagState;
      if (parsed && typeof parsed.exhaustedUntilMs === 'number' && parsed.exhaustedUntilMs > Date.now()) {
        cachedUntilMs = parsed.exhaustedUntilMs;
      }
    }
  } catch {}
}

export function isFirestoreQuotaErrorLike(errOrText: any): boolean {
  const code = String(errOrText?.code || '').toLowerCase();
  const msg = String(errOrText?.message || errOrText || '').toLowerCase();
  if (msg.includes('timed out') || code.includes('deadline-exceeded') || code.includes('timeout')) {
    return false;
  }
  return (
    code.includes('resource-exhausted') ||
    code === '429' ||
    msg.includes('resource-exhausted') ||
    msg.includes('resource_exhausted') ||
    msg.includes('daily write') ||
    msg.includes('quota exceeded') ||
    msg.includes('too many requests')
  );
}

export function isServerFirestoreWriteAllowed(): boolean {
  loadFromDiskOnce();
  if (!cachedUntilMs) return true;
  if (Date.now() > cachedUntilMs) {
    cachedUntilMs = 0;
    try {
      if (fs.existsSync(QUOTA_FLAG_FILE)) fs.unlinkSync(QUOTA_FLAG_FILE);
    } catch {}
    return true;
  }
  return false;
}

export function markServerFirestoreQuotaExhausted(reason?: any): number {
  loadFromDiskOnce();
  const nextExpiry = computeNextResetExpiryMs();
  if (nextExpiry > cachedUntilMs) {
    cachedUntilMs = nextExpiry;
    const state: QuotaFlagState = {
      exhaustedUntilMs: nextExpiry,
      updatedAtMs: Date.now(),
      reason: String(reason?.message || reason || 'resource-exhausted').slice(0, 240),
    };
    try {
      fs.writeFileSync(QUOTA_FLAG_FILE, JSON.stringify(state));
    } catch {}
    console.warn(
      `[FirestoreQuota] Daily write quota exhausted; pausing Firestore writes until ${new Date(nextExpiry).toISOString()}`
    );
  }
  return cachedUntilMs;
}

export function getServerFirestoreQuotaStatus(): {
  writeAllowed: boolean;
  exhaustedUntilMs: number;
} {
  const writeAllowed = isServerFirestoreWriteAllowed();
  return {
    writeAllowed,
    exhaustedUntilMs: writeAllowed ? 0 : cachedUntilMs,
  };
}
