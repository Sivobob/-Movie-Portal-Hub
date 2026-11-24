import { parseDurationToSeconds } from './duration';

export interface EpisodeDurationCandidate {
  durationSec?: number | null;
  duration?: string | number | null;
}

/**
 * Resolves a single episode's real duration in seconds.
 * NEVER falls back to parent series IMDb/series runtime so a 23m episode never displays as 31m.
 */
export function resolveEpisodePlaybackDurationSec(
  episode?: EpisodeDurationCandidate | null,
  probedEpisodeDurationSec?: number | null,
  isInitialOpenedEpisode = false,
  initialDurationProp?: number | null
): number {
  if (episode) {
    if (typeof episode.durationSec === 'number' && Number.isFinite(episode.durationSec) && episode.durationSec > 0) {
      return Math.round(episode.durationSec);
    }
    const parsedEpDur = parseDurationToSeconds(episode.duration);
    if (parsedEpDur > 0) {
      return parsedEpDur;
    }
  }
  if (
    typeof probedEpisodeDurationSec === 'number' &&
    Number.isFinite(probedEpisodeDurationSec) &&
    probedEpisodeDurationSec > 0
  ) {
    return Math.round(probedEpisodeDurationSec);
  }
  if (
    isInitialOpenedEpisode &&
    typeof initialDurationProp === 'number' &&
    Number.isFinite(initialDurationProp) &&
    initialDurationProp > 0
  ) {
    return Math.round(initialDurationProp);
  }
  return 0;
}

export interface RawAutoEpisodeInput {
  episodeNumber?: number;
  episodeLabel?: string;
  title?: string;
  streamUrl: string;
  duration?: string;
  durationSec?: number;
  videoQualities?: Record<string, string>;
  showInNewEpisodes?: boolean;
  newEpisodeEnabledAt?: number;
  createdAt?: number;
  addedAt?: number;
}

export interface NormalizedAutoEpisode {
  episodeNumber: number;
  episodeLabel?: string;
  title: string;
  streamUrl: string;
  videoQualities?: Record<string, string>;
  duration?: string;
  durationSec?: number;
  showInNewEpisodes: boolean;
  newEpisodeEnabledAt?: number;
  createdAt?: number;
  addedAt?: number;
}

/**
 * Normalizes a newly synced/uploaded series episode before Firestore persistence.
 * Ensures newly uploaded episodes NEVER auto-appear under "New Episodes" unless explicitly enabled.
 */
export function normalizeEpisodeForSave(
  ep: RawAutoEpisodeInput,
  fallbackNumber = 1,
  nowMs: number = Date.now()
): NormalizedAutoEpisode {
  const epNum = Math.max(1, Number(ep.episodeNumber) || fallbackNumber);
  const showNew = ep.showInNewEpisodes === true;
  const cleanDurSec =
    typeof ep.durationSec === 'number' && Number.isFinite(ep.durationSec) && ep.durationSec > 0
      ? Math.round(ep.durationSec)
      : 0;
  const cleanDurText = String(ep.duration || '').trim();

  const out: NormalizedAutoEpisode = {
    episodeNumber: epNum,
    title: String(ep.title || '').trim() || `Episode ${epNum}`,
    streamUrl: String(ep.streamUrl || '').trim(),
    showInNewEpisodes: showNew,
  };

  if (ep.episodeLabel && String(ep.episodeLabel).trim()) {
    out.episodeLabel = String(ep.episodeLabel).trim();
  }
  if (ep.videoQualities && typeof ep.videoQualities === 'object') {
    out.videoQualities = { ...ep.videoQualities };
  }
  if (cleanDurText) {
    out.duration = cleanDurText;
  }
  if (cleanDurSec > 0) {
    out.durationSec = cleanDurSec;
  }
  if (showNew) {
    const ts = Number(ep.newEpisodeEnabledAt) > 0 ? Number(ep.newEpisodeEnabledAt) : nowMs;
    out.newEpisodeEnabledAt = ts;
    out.createdAt = Number(ep.createdAt) > 0 ? Number(ep.createdAt) : ts;
    out.addedAt = Number(ep.addedAt) > 0 ? Number(ep.addedAt) : ts;
  }

  return out;
}

export type StreamPlaybackMode = 'direct' | 'remux' | 'transcode';

export interface StreamBuildPlanInput {
  rawUrl: string;
  selectedQuality: string;
  videoQualities?: Record<string, string>;
  recommendedMode: StreamPlaybackMode;
  streamFallbackMode: StreamPlaybackMode;
  canScaleRemote: boolean;
  isNativePlatform: boolean;
  isIosWeb: boolean;
  userPickedQuality: boolean;
  audioIdx: number;
  durationSec: number;
  startHint: number;
  streamStartOffset: number;
  remoteBaseUrl?: string;
}

export interface StreamBuildPlan {
  sourceUrl: string;
  explicitUrl: string;
  effectiveMode: StreamPlaybackMode;
  needsScaledTranscode: boolean;
  useHlsPipeline: boolean;
  qualityParam: '' | '1080p' | '720p' | '480p' | '360p';
  isTelegram: boolean;
}

/**
 * Determines exact playback mode & quality scaling behavior so:
 * - Selecting 360P/480P/720P without an explicit quality URL forces scaled server transcoding (HLS `.m3u8` with `&quality=360p` etc.)
 * - Selecting 1080P preserves fast `direct` playback if the primary stream is already `direct`-compatible and not already forced into `transcode`.
 */
export function resolveStreamBuildPlan(input: StreamBuildPlanInput): StreamBuildPlan {
  const trimmed = String(input.rawUrl || '').trim();
  const qTier = String(input.selectedQuality || 'Auto').trim().toLowerCase();
  const isExplicitTier = qTier === '1080p' || qTier === '720p' || qTier === '480p' || qTier === '360p';

  const rawExplicit = isExplicitTier
    ? input.videoQualities?.[qTier] || input.videoQualities?.[input.selectedQuality] || ''
    : '';
  const trimmedExplicit = String(rawExplicit || '').trim();
  const explicitUrl =
    trimmedExplicit && trimmedExplicit.replace(/\/+$/, '') !== trimmed.replace(/\/+$/, '')
      ? trimmedExplicit
      : '';

  const sourceUrl = String(explicitUrl || trimmed).trim();
  const isTelegram = /t\.me|telegram\.me/i.test(sourceUrl);
  const isDownscaleTier = qTier === '360p' || qTier === '480p' || qTier === '720p';

  // For 360p / 480p / 720p with a single source URL, force server scaled transcode whenever remote backend is available.
  // For 1080p with a single source URL, only transcode if already in transcode fallback mode (so 1080p keeps instant direct playback when compatible).
  const needsScaledTranscode =
    input.canScaleRemote &&
    !explicitUrl &&
    (isDownscaleTier || (qTier === '1080p' && input.streamFallbackMode === 'transcode'));

  const isIncompatibleNonTgIos =
    input.isIosWeb && !isTelegram && /\.(mkv|avi|flv|wmv|webm)(\?|#|$)/i.test(sourceUrl);

  const effectiveMode: StreamPlaybackMode =
    explicitUrl
      ? 'direct'
      : needsScaledTranscode || isIncompatibleNonTgIos
        ? 'transcode'
        : input.streamFallbackMode;

  const isServerPipe = effectiveMode === 'remux' || effectiveMode === 'transcode';
  const isMp4Direct = !input.recommendedMode || input.recommendedMode === 'direct';

  const useHlsPipeline =
    isServerPipe &&
    (!input.isIosWeb || !isMp4Direct || needsScaledTranscode) &&
    (!input.isNativePlatform || input.canScaleRemote);

  return {
    sourceUrl,
    explicitUrl,
    effectiveMode,
    needsScaledTranscode,
    useHlsPipeline,
    qualityParam: isExplicitTier ? (qTier as '1080p' | '720p' | '480p' | '360p') : '',
    isTelegram,
  };
}
