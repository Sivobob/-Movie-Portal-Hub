export type AllowedHdQuality = '1080p' | '720p';

export interface ChannelVideoProbeLike {
  probedByFfprobe?: boolean;
  height?: number;
  width?: number;
  audioCodec?: string | null;
  audioTracks?: Array<{ codec?: string | null; channels?: number }>;
}

export interface ChannelVideoFilterInput {
  fileName?: string;
  caption?: string;
  parsedQuality?: string;
  width?: number;
  height?: number;
  hasExplicitNoSound?: boolean;
  hasVideoAttr?: boolean;
  probe?: ChannelVideoProbeLike | null;
  requireValidAudio?: boolean;
  rejectCamRip?: boolean;
  allowedQualities?: AllowedHdQuality[];
}

export interface ChannelVideoFilterDecision {
  accepted: boolean;
  reason: 'ok' | 'no_audio' | 'low_quality' | 'cam_rip' | 'unverified_audio';
  effectiveQuality: AllowedHdQuality | '';
  hasValidAudio: boolean;
  effectiveHeight: number;
}

const CAM_RIP_RE = /\b(?:camrip|hd[\s._-]*cam|hdcam|hdts|hdtc|predvd|telesync|telecine|dvdscr)\b/i;

export function normalizeHdQualityFromHeightOrTag(
  height: number,
  width: number,
  parsedQuality?: string
): AllowedHdQuality | '' {
  const tag = String(parsedQuality || '').trim().toLowerCase();
  if (tag === '1080p') return '1080p';
  if (tag === '720p') return '720p';
  if (tag === '480p' || tag === '360p') return '';

  const h = Math.max(0, Number(height) || 0);
  const w = Math.max(0, Number(width) || 0);

  // Typical 1080p encodes (including cropped 2.39:1 cinemascope like 1920x800)
  if (h >= 900 || w >= 1700) return '1080p';
  // Typical 720p encodes (including cropped 2.39:1 cinemascope like 1280x534)
  if (h >= 680 || (w >= 1200 && h >= 500)) return '720p';

  return '';
}

export function hasConfirmedAudioTrack(input: {
  hasExplicitNoSound?: boolean;
  probe?: ChannelVideoProbeLike | null;
  hasVideoAttr?: boolean;
}): { confirmed: boolean; definitelyNoAudio: boolean } {
  if (input.hasExplicitNoSound) {
    return { confirmed: false, definitelyNoAudio: true };
  }

  const probe = input.probe;
  if (probe && probe.probedByFfprobe) {
    const tracks = Array.isArray(probe.audioTracks) ? probe.audioTracks : [];
    const validTracks = tracks.filter((t) => {
      const codec = String(t?.codec || '').trim().toLowerCase();
      const ch = Number(t?.channels) || 0;
      return Boolean(codec && codec !== 'none') || ch > 0;
    });
    if (validTracks.length > 0) {
      return { confirmed: true, definitelyNoAudio: false };
    }
    const topAudio = String(probe.audioCodec || '').trim().toLowerCase();
    if (topAudio && topAudio !== 'none') {
      return { confirmed: true, definitelyNoAudio: false };
    }
    // ffprobe inspected the file container and found 0 valid audio streams
    return { confirmed: false, definitelyNoAudio: true };
  }

  // Fallback only when ffprobe couldn't inspect header; if Telegram DocumentAttributeVideo says nosound=false
  if (input.hasVideoAttr) {
    return { confirmed: true, definitelyNoAudio: false };
  }

  return { confirmed: false, definitelyNoAudio: false };
}

export function evaluateChannelVideoFilter(
  input: ChannelVideoFilterInput
): ChannelVideoFilterDecision {
  const requireValidAudio = input.requireValidAudio !== false;
  const rejectCamRip = input.rejectCamRip === true;
  const allowedQualities: AllowedHdQuality[] =
    Array.isArray(input.allowedQualities) && input.allowedQualities.length > 0
      ? input.allowedQualities
      : ['1080p', '720p'];

  const combinedText = `${input.fileName || ''} ${input.caption || ''}`;
  if (rejectCamRip && CAM_RIP_RE.test(combinedText)) {
    return {
      accepted: false,
      reason: 'cam_rip',
      effectiveQuality: '',
      hasValidAudio: false,
      effectiveHeight: Math.max(Number(input.probe?.height) || 0, Number(input.height) || 0),
    };
  }

  const audioCheck = hasConfirmedAudioTrack({
    hasExplicitNoSound: input.hasExplicitNoSound,
    probe: input.probe,
    hasVideoAttr: input.hasVideoAttr,
  });

  if (requireValidAudio) {
    if (audioCheck.definitelyNoAudio) {
      return {
        accepted: false,
        reason: 'no_audio',
        effectiveQuality: '',
        hasValidAudio: false,
        effectiveHeight: Math.max(Number(input.probe?.height) || 0, Number(input.height) || 0),
      };
    }
    if (!audioCheck.confirmed) {
      return {
        accepted: false,
        reason: 'unverified_audio',
        effectiveQuality: '',
        hasValidAudio: false,
        effectiveHeight: Math.max(Number(input.probe?.height) || 0, Number(input.height) || 0),
      };
    }
  }

  const effectiveHeight = Math.max(Number(input.probe?.height) || 0, Number(input.height) || 0);
  const effectiveWidth = Math.max(Number(input.probe?.width) || 0, Number(input.width) || 0);
  const effectiveQuality = normalizeHdQualityFromHeightOrTag(
    effectiveHeight,
    effectiveWidth,
    input.parsedQuality
  );

  if (!effectiveQuality || !allowedQualities.includes(effectiveQuality)) {
    return {
      accepted: false,
      reason: 'low_quality',
      effectiveQuality: '',
      hasValidAudio: audioCheck.confirmed,
      effectiveHeight,
    };
  }

  return {
    accepted: true,
    reason: 'ok',
    effectiveQuality,
    hasValidAudio: audioCheck.confirmed,
    effectiveHeight,
  };
}

export function filterQualityMapForHdOnly(
  qualities: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  if (qualities['1080p']) out['1080p'] = qualities['1080p'];
  if (qualities['720p']) out['720p'] = qualities['720p'];
  return out;
}
