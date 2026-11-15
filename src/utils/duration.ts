import { buildApiUrl, isUsingLocalNativeBridge } from './apiConfig';
import { Capacitor } from '@capacitor/core';

/**
 * Parses any runtime / duration representation into integer seconds:
 * - Numeric seconds (e.g. 7200) -> 7200
 * - "HH:MM:SS" (e.g. "02:43:52") -> 9832
 * - "MM:SS" (e.g. "45:10") -> 2710
 * - "183 min" / "45m" / "2h 15m" / "2h 15m 30s" -> exact seconds
 * - Pure integer string <= 600 (e.g. "142") -> treated as minutes (142 * 60)
 */
export function parseDurationToSeconds(input?: string | number | null): number {
  if (input === null || input === undefined) return 0;

  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? Math.round(input) : 0;
  }

  const raw = String(input).trim();
  if (!raw || /^(n\/a|na|null|undefined|--+)$/i.test(raw)) return 0;

  // 1. Colon clock format: HH:MM:SS or MM:SS
  if (/^\d{1,3}:\d{1,2}(:\d{1,2})?$/.test(raw)) {
    const parts = raw.split(':').map((p) => parseInt(p, 10));
    if (parts.some((n) => Number.isNaN(n) || n < 0)) return 0;
    if (parts.length === 3) {
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    if (parts.length === 2) {
      return parts[0] * 60 + parts[1];
    }
  }

  // 2. Human readable units: "2h 15m 10s", "183 min", "45m", "1 hr 30 mins"
  let total = 0;
  let matchedUnit = false;

  const hMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i);
  if (hMatch) {
    total += Math.round(parseFloat(hMatch[1]) * 3600);
    matchedUnit = true;
  }

  const mMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i);
  if (mMatch) {
    total += Math.round(parseFloat(mMatch[1]) * 60);
    matchedUnit = true;
  }

  const sMatch = raw.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|s)\b/i);
  if (sMatch) {
    total += Math.round(parseFloat(sMatch[1]));
    matchedUnit = true;
  }

  if (matchedUnit) {
    return total > 0 ? total : 0;
  }

  // 3. Pure number string (typically runtime in minutes from forms / OMDb)
  if (/^\d+$/.test(raw)) {
    const num = parseInt(raw, 10);
    if (num <= 0) return 0;
    return num <= 600 ? num * 60 : num;
  }

  return 0;
}

/**
 * Formats seconds into fixed player clock notation HH:MM:SS (e.g. 02:43:52).
 */
export function formatClockTime(secs: number): string {
  if (typeof secs !== 'number' || Number.isNaN(secs) || !Number.isFinite(secs) || secs < 0) {
    return '00:00:00';
  }
  const rounded = Math.floor(secs);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/**
 * Formats a movie or episode duration cleanly for cards / details badges (e.g. "2h 43m", "45m").
 * Returns null if no real duration exists (never returns a fake placeholder like "2h 15m" or "45m").
 */
export function formatHumanDuration(
  runtime?: string | number | null,
  durationSec?: number | null
): string | null {
  const numericDur = typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0
    ? Math.round(durationSec)
    : 0;
  const parsedRuntime = parseDurationToSeconds(runtime);
  const totalSec = numericDur > 0 ? numericDur : parsedRuntime;

  if (totalSec <= 0) return null;

  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  if (hrs > 0) {
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }
  if (mins > 0) {
    return `${mins}m`;
  }
  return `${secs}s`;
}

// Shared cache & dedupe map for probing real Telegram stream durations on Details page
const probedDurationCache = new Map<string, number>();
const inflightDurationProbes = new Map<string, Promise<number>>();

export async function probeTelegramDurationSec(streamUrl?: string | null): Promise<number> {
  const trimmed = (streamUrl || '').trim();
  if (!trimmed || !/t\.me|telegram\.me/i.test(trimmed)) {
    return 0;
  }

  const cached = probedDurationCache.get(trimmed);
  if (typeof cached === 'number' && cached > 0) {
    return cached;
  }

  // Check native/browser Telegram cache synchronously first
  try {
    const bridgeMeta = (window as any).__tgStreamBridge?.getCachedMeta?.(trimmed);
    if (bridgeMeta?.durationSec && bridgeMeta.durationSec > 0) {
      const sec = Math.round(bridgeMeta.durationSec);
      probedDurationCache.set(trimmed, sec);
      return sec;
    }
  } catch {}

  const existing = inflightDurationProbes.get(trimmed);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const infoUrl = buildApiUrl(`/api/telegram/stream-info?url=${encodeURIComponent(trimmed)}`);
      if (!infoUrl || (Capacitor.isNativePlatform() && isUsingLocalNativeBridge() && !infoUrl.startsWith('http'))) {
        return 0;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(infoUrl, { cache: 'no-store', signal: controller.signal }).finally(() =>
        clearTimeout(timer)
      );
      if (!res.ok) return 0;
      const data = await res.json();
      const dur = Number(data?.durationSec || 0);
      if (Number.isFinite(dur) && dur > 0) {
        const rounded = Math.round(dur);
        probedDurationCache.set(trimmed, rounded);
        return rounded;
      }
      return 0;
    } catch {
      return 0;
    } finally {
      inflightDurationProbes.delete(trimmed);
    }
  })();

  inflightDurationProbes.set(trimmed, promise);
  return promise;
}
