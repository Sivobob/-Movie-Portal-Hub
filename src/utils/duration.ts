import { buildApiUrl, ensureAndroidStreamBridge, isUsingLocalNativeBridge } from './apiConfig';
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

// Shared cache & dedupe map for probing real Telegram stream info (duration, codecs, tracks) on Details page & Watch Now
export interface CachedStreamInfo {
  status?: string;
  notFound?: boolean;
  error?: string;
  isTelegram?: boolean;
  recommendedMode?: 'direct' | 'remux' | 'transcode';
  fileSize?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  pixFmt?: string;
  is10Bit?: boolean;
  audioCodec?: string;
  container?: string;
  hasUnsupportedAudio?: boolean;
  probedByFfprobe?: boolean;
  audioTracks?: any[];
  subtitleTracks?: any[];
  qualityEstimates?: any;
  [key: string]: any;
}

const STREAM_INFO_CACHE_TTL_MS = 10 * 60 * 1000;
const streamInfoCache = new Map<string, { data: CachedStreamInfo; cachedAt: number }>();
const inflightStreamInfoProbes = new Map<string, Promise<CachedStreamInfo | null>>();

export function getCachedStreamInfo(streamUrl?: string | null): CachedStreamInfo | null {
  const trimmed = (streamUrl || '').trim();
  if (!trimmed) return null;
  const hit = streamInfoCache.get(trimmed);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > STREAM_INFO_CACHE_TTL_MS) {
    streamInfoCache.delete(trimmed);
    return null;
  }
  return hit.data;
}

function isPermanentStreamNotFound(errMsg?: string, status?: number): boolean {
  if (status === 404 || status === 410) return true;
  const lower = String(errMsg || '').toLowerCase();
  return (
    lower.includes('not found') ||
    lower.includes('no playable video') ||
    lower.includes('invalid telegram')
  );
}

export async function fetchStreamInfo(
  streamUrl?: string | null,
  options?: { force?: boolean; timeoutMs?: number }
): Promise<CachedStreamInfo | null> {
  const trimmed = (streamUrl || '').trim();
  if (!trimmed || /^(file:|blob:)/i.test(trimmed)) return null;

  if (!options?.force) {
    const cached = getCachedStreamInfo(trimmed);
    if (cached) return cached;
  }

  const existing = inflightStreamInfoProbes.get(trimmed);
  if (existing && !options?.force) return existing;

  const timeoutMs = Math.max(2500, options?.timeoutMs ?? 8000);
  const promise = (async (): Promise<CachedStreamInfo | null> => {
    try {
      if (Capacitor.isNativePlatform() && isUsingLocalNativeBridge()) {
        await ensureAndroidStreamBridge().catch(() => '');
        const bridge = (window as any).__tgStreamBridge;
        if (bridge && typeof bridge.getStreamInfoDirect === 'function') {
          const directPromise = bridge.getStreamInfoDirect(trimmed);
          const data = await Promise.race([
            directPromise,
            new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
          ]);
          if (data && data.status === 'ok') {
            if (data.probedByFfprobe !== false || Number(data.durationSec || 0) > 0) {
              streamInfoCache.set(trimmed, { data, cachedAt: Date.now() });
            }
            return data;
          }
          if (data && data.status === 'error' && (data.notFound || isPermanentStreamNotFound(data.error))) {
            return {
              status: 'error',
              notFound: true,
              error: String(data.error || 'Telegram post not found'),
            };
          }
          return null;
        }
      }

      const infoUrl = buildApiUrl(`/api/telegram/stream-info?url=${encodeURIComponent(trimmed)}`);
      if (!infoUrl || (Capacitor.isNativePlatform() && isUsingLocalNativeBridge() && !infoUrl.startsWith('http'))) {
        return null;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(infoUrl, { cache: 'no-store', signal: controller.signal }).finally(() =>
        clearTimeout(timer)
      );
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        const errMsg = String(errBody?.error || '');
        if (isPermanentStreamNotFound(errMsg, res.status)) {
          return {
            status: 'error',
            notFound: true,
            error: errMsg || 'Telegram post not found or removed',
          };
        }
        return null;
      }
      const data = await res.json();
      if (data && data.status === 'ok') {
        if (data.probedByFfprobe !== false || Number(data.durationSec || 0) > 0) {
          streamInfoCache.set(trimmed, { data, cachedAt: Date.now() });
        }
        return data;
      }
      return null;
    } catch {
      return null;
    } finally {
      inflightStreamInfoProbes.delete(trimmed);
    }
  })();

  inflightStreamInfoProbes.set(trimmed, promise);
  return promise;
}

export async function probeTelegramDurationSec(streamUrl?: string | null): Promise<number> {
  const trimmed = (streamUrl || '').trim();
  if (!trimmed || !/t\.me|telegram\.me/i.test(trimmed)) {
    return 0;
  }

  const cached = getCachedStreamInfo(trimmed);
  if (cached && typeof cached.durationSec === 'number' && cached.durationSec > 0) {
    return Math.round(cached.durationSec);
  }

  // Check native/browser Telegram cache synchronously first
  try {
    const bridgeMeta = (window as any).__tgStreamBridge?.getCachedMeta?.(trimmed);
    if (bridgeMeta?.durationSec && bridgeMeta.durationSec > 0) {
      return Math.round(bridgeMeta.durationSec);
    }
  } catch {}

  const data = await fetchStreamInfo(trimmed, { timeoutMs: 8000 });
  const dur = Number(data?.durationSec || 0);
  if (Number.isFinite(dur) && dur > 0) {
    return Math.round(dur);
  }
  return 0;
}
