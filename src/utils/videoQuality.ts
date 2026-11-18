export type VideoQualityTier = '1080p' | '720p' | '480p' | '360p';

export interface QualitySizeEstimate {
  tier: VideoQualityTier;
  label: string;
  resolution: string;
  sizeBytes: number;
  sizeLabel: string;
  sizeMb: number;
  badge: string;
  description: string;
  isOriginal: boolean;
  isExactBytes: boolean;
}

export function formatVideoSizeLabel(bytes: number, approximate = false): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '--';
  const prefix = approximate ? '~' : '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${prefix}${gb.toFixed(2)} GB`;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${prefix}${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  const kb = Math.max(1, Math.round(bytes / 1024));
  return `${prefix}${kb} KB`;
}

export function buildQualitySizeEstimates(params: {
  fileSizeBytes?: number;
  durationSec?: number;
  sourceHeight?: number;
}): QualitySizeEstimate[] {
  const fileSizeBytes = Number(params.fileSizeBytes) || 0;
  const durationSec = Number(params.durationSec) || 0;
  const sourceHeight = Number(params.sourceHeight) || 0;

  const sourceIs720OrLower = sourceHeight > 0 && sourceHeight <= 780;
  const sourceIs480OrLower = sourceHeight > 0 && sourceHeight <= 520;

  // Baseline original byte size (real Content-Length/Telegram doc size, or duration fallback only if unprobed)
  let baseBytes = fileSizeBytes;
  const hasRealSize = baseBytes > 0;
  if (!hasRealSize) {
    if (durationSec > 0) {
      const assumedBps = sourceIs480OrLower
        ? 750_000
        : sourceIs720OrLower
        ? 1_450_000
        : 2_600_000;
      baseBytes = Math.round((durationSec * assumedBps) / 8);
    } else {
      // Wait for real stream-info probe rather than pretending fixed GB
      baseBytes = 0;
    }
  }

  const results: QualitySizeEstimate[] = [];

  const calcScaledBytes = (targetBps: number, minRatio: number, maxRatio: number, fallbackRatio: number): number => {
    if (baseBytes <= 0) return 0;
    if (durationSec > 0) {
      const byBitrate = Math.round((durationSec * targetBps) / 8);
      return Math.min(
        Math.round(baseBytes * maxRatio),
        Math.max(Math.round(baseBytes * minRatio), byBitrate)
      );
    }
    return Math.round(baseBytes * fallbackRatio);
  };

  if (!sourceIs720OrLower) {
    const labelHeight = sourceHeight >= 1800 ? '4K / 1080p' : '1080p Full HD';
    const resStr = sourceHeight >= 1800 ? '2160p/1080p' : '1920×1080';
    results.push({
      tier: '1080p',
      label: labelHeight,
      resolution: resStr,
      sizeBytes: baseBytes,
      sizeLabel: hasRealSize ? formatVideoSizeLabel(baseBytes, false) : baseBytes > 0 ? formatVideoSizeLabel(baseBytes, true) : 'Checking size...',
      sizeMb: baseBytes > 0 ? Math.max(1, Math.round(baseBytes / (1024 * 1024))) : 0,
      badge: 'ORIGINAL HD',
      description: 'Original master clarity, zero quality loss',
      isOriginal: true,
      isExactBytes: hasRealSize,
    });
  }

  if (!sourceIs480OrLower) {
    const is720Original = sourceIs720OrLower;
    const bytes720 = is720Original
      ? baseBytes
      : calcScaledBytes(1_220_000, 0.38, 0.65, 0.56);
    results.push({
      tier: '720p',
      label: '720p HD',
      resolution: '1280×720',
      sizeBytes: bytes720,
      sizeLabel:
        bytes720 > 0
          ? formatVideoSizeLabel(bytes720, !(is720Original && hasRealSize))
          : 'Checking size...',
      sizeMb: bytes720 > 0 ? Math.max(1, Math.round(bytes720 / (1024 * 1024))) : 0,
      badge: is720Original ? 'ORIGINAL HD' : 'BALANCED',
      description: is720Original
        ? 'Original 720p HD clarity'
        : 'Sharp 720p HD re-encode, lighter download size',
      isOriginal: is720Original,
      isExactBytes: is720Original && hasRealSize,
    });
  }

  const bytes480 = sourceIs480OrLower
    ? baseBytes
    : calcScaledBytes(620_000, sourceIs720OrLower ? 0.36 : 0.22, sourceIs720OrLower ? 0.62 : 0.38, sourceIs720OrLower ? 0.50 : 0.31);

  results.push({
    tier: '480p',
    label: '480p SD',
    resolution: '854×480',
    sizeBytes: bytes480,
    sizeLabel:
      bytes480 > 0
        ? formatVideoSizeLabel(bytes480, !(sourceIs480OrLower && hasRealSize))
        : 'Checking size...',
    sizeMb: bytes480 > 0 ? Math.max(1, Math.round(bytes480 / (1024 * 1024))) : 0,
    badge: 'DATA SAVER',
    description: '480p mobile resolution, saves ~65% storage & data',
    isOriginal: sourceIs480OrLower,
    isExactBytes: sourceIs480OrLower && hasRealSize,
  });

  const bytes360 = calcScaledBytes(
    340_000,
    sourceIs720OrLower ? 0.20 : 0.12,
    sourceIs720OrLower ? 0.36 : 0.22,
    sourceIs720OrLower ? 0.29 : 0.18
  );

  results.push({
    tier: '360p',
    label: '360p Compact',
    resolution: '640×360',
    sizeBytes: bytes360,
    sizeLabel: bytes360 > 0 ? formatVideoSizeLabel(bytes360, true) : 'Checking size...',
    sizeMb: bytes360 > 0 ? Math.max(1, Math.round(bytes360 / (1024 * 1024))) : 0,
    badge: 'FASTEST',
    description: 'Smallest file size for quick download on slow data',
    isOriginal: false,
    isExactBytes: false,
  });

  return results;
}
