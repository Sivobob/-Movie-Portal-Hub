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

const LANGUAGE_CODE_MAP: Record<string, string> = {
  hi: 'Hindi',
  hin: 'Hindi',
  hindi: 'Hindi',
  en: 'English',
  eng: 'English',
  english: 'English',
  ta: 'Tamil',
  tam: 'Tamil',
  tamil: 'Tamil',
  te: 'Telugu',
  tel: 'Telugu',
  telugu: 'Telugu',
  ml: 'Malayalam',
  mal: 'Malayalam',
  malayalam: 'Malayalam',
  kn: 'Kannada',
  kan: 'Kannada',
  kannada: 'Kannada',
  bn: 'Bengali',
  ben: 'Bengali',
  bengali: 'Bengali',
  mr: 'Marathi',
  mar: 'Marathi',
  marathi: 'Marathi',
  pa: 'Punjabi',
  pan: 'Punjabi',
  pun: 'Punjabi',
  punjabi: 'Punjabi',
  gu: 'Gujarati',
  guj: 'Gujarati',
  gujarati: 'Gujarati',
  ur: 'Urdu',
  urd: 'Urdu',
  urdu: 'Urdu',
  ja: 'Japanese',
  jpn: 'Japanese',
  japanese: 'Japanese',
  ko: 'Korean',
  kor: 'Korean',
  korean: 'Korean',
  zh: 'Chinese',
  chi: 'Chinese',
  zho: 'Chinese',
  chinese: 'Chinese',
  es: 'Spanish',
  spa: 'Spanish',
  spanish: 'Spanish',
  fr: 'French',
  fre: 'French',
  fra: 'French',
  french: 'French',
  de: 'German',
  ger: 'German',
  deu: 'German',
  german: 'German',
  ar: 'Arabic',
  ara: 'Arabic',
  arabic: 'Arabic',
  ru: 'Russian',
  rus: 'Russian',
  russian: 'Russian',
  pt: 'Portuguese',
  por: 'Portuguese',
  portuguese: 'Portuguese',
  it: 'Italian',
  ita: 'Italian',
  italian: 'Italian',
  tr: 'Turkish',
  tur: 'Turkish',
  turkish: 'Turkish',
  th: 'Thai',
  tha: 'Thai',
  thai: 'Thai',
  id: 'Indonesian',
  ind: 'Indonesian',
  indonesian: 'Indonesian',
  und: '',
  unknown: '',
};

const KNOWN_LANGUAGE_NAMES = Array.from(
  new Set(Object.values(LANGUAGE_CODE_MAP).filter(Boolean))
);

export function cleanMediaTrackLabel(
  langRaw?: string,
  titleRaw?: string,
  kind: 'audio' | 'subtitle' = 'audio',
  index = 0
): { lang: string; label: string } {
  const code = String(langRaw || '')
    .trim()
    .toLowerCase()
    .replace(/[-_].*$/, '');
  const mappedLang = LANGUAGE_CODE_MAP[code] || '';

  let cleanedTitle = String(titleRaw || '')
    // Strip URLs, handles, piracy/site tags & decorative symbols
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/www\.\S+/gi, ' ')
    .replace(/@[a-z0-9_]+/gi, ' ')
    .replace(
      /\b(skymovieshd|filmyzilla|vegamovies|hdhub4u|mkvcinemas|katmoviehd|bolly4u|worldfree4u|moviesmod|uhdmovies|9xmovies|extramovies|olamovies|pagalworld|filmywap|mp4moviez|jalshamoviez|mlsbd|cinevez|tamilrockers|isaimini|movierulz)\b/gi,
      ' '
    )
    .replace(/\b[a-z0-9-]+\.(com|net|org|in|me|cc|lol|fun|pw|club|site|pro|xyz|top|live|info|to)\b/gi, ' ')
    .replace(/[:._]{2,}/g, ' ')
    // Strip codec/bitrate/container/channel/subtitle clutter
    .replace(/\[[^\]]*(aac|ac3|e-?ac3|ddp?|dts|truehd|atmos|flac|mp3|opus|vorbis|kbps|mbps|full|forced|sdh|cc|stereo|mono|\d\.\d|ch)[^\]]*\]/gi, ' ')
    .replace(/\([^\)]*(aac|ac3|e-?ac3|ddp?|dts|truehd|atmos|flac|mp3|opus|vorbis|kbps|mbps|full|forced|sdh|cc|stereo|mono|\d\.\d|ch)[^\)]*\)/gi, ' ')
    .replace(/\b(aac|ac3|e-?ac3|ddp?|dts|truehd|atmos|flac|mp3|opus|vorbis|5\.1|7\.1|2\.0|6ch|2ch|\d+\s*kbps|full|forced|sdh)\b/gi, ' ')
    .replace(/[()\[\]{}•|:/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Detect known language embedded inside raw title (e.g. "... - Hindi - ...")
  let detectedFromTitle = '';
  for (const name of KNOWN_LANGUAGE_NAMES) {
    const re = new RegExp(`\\b${name}\\b`, 'i');
    if (re.test(cleanedTitle)) {
      detectedFromTitle = name;
      break;
    }
  }

  const finalLang = mappedLang || detectedFromTitle;
  if (finalLang) {
    return { lang: finalLang, label: finalLang };
  }

  if (cleanedTitle && cleanedTitle.length >= 2 && !/^(track|audio|subtitle)\s*\d*$/i.test(cleanedTitle)) {
    return { lang: cleanedTitle, label: cleanedTitle };
  }

  if (code && code !== 'und' && code.length <= 3) {
    const up = code.toUpperCase();
    return { lang: up, label: up };
  }

  return kind === 'audio'
    ? { lang: 'Audio', label: `Audio ${index + 1}` }
    : { lang: 'Subtitle', label: `Subtitle ${index + 1}` };
}

export function isBitmapSubtitleCodec(codec?: string): boolean {
  return /^(hdmv_pgs_subtitle|pgs|dvd_subtitle|vobsub|dvb_subtitle|xsub)$/i.test(String(codec || '').trim());
}

function getSubtitleTrackQualityScore(item: { label?: string; codec?: string; forced?: boolean; defaultTrack?: boolean }): number {
  let score = 0;
  if (!isBitmapSubtitleCodec(item.codec)) {
    score += 100;
  }
  const rawLabel = String(item.label || '');
  if (!item.forced && !/\bforced\b/i.test(rawLabel)) {
    score += 50;
  }
  if (item.defaultTrack) {
    score += 10;
  }
  return score;
}

export function normalizePlayerTrackList<
  T extends { id: number | string; label?: string; lang?: string; selected?: boolean; codec?: string; forced?: boolean; defaultTrack?: boolean }
>(tracks: T[], kind: 'audio' | 'subtitle'): Array<T & { label: string; lang: string }> {
  if (!Array.isArray(tracks)) return [];
  const filtered =
    kind === 'subtitle'
      ? tracks.filter((t) => {
          const l = String(t.label || '').trim().toLowerCase();
          const lg = String(t.lang || '').trim().toLowerCase();
          return l !== 'off' && lg !== 'off' && String(t.id).toLowerCase() !== 'off';
        })
      : tracks;

  const seenLabels = new Map<string, number>();
  const subKeyToOutIndex = new Map<string, number>();
  const subKeyToBestScore = new Map<string, number>();
  const out: Array<T & { label: string; lang: string }> = [];

  for (let i = 0; i < filtered.length; i++) {
    const item = filtered[i];
    const { lang, label } = cleanMediaTrackLabel(item.lang, item.label, kind, i);
    const key = label.toLowerCase();

    if (kind === 'subtitle') {
      const score = getSubtitleTrackQualityScore(item);
      if (subKeyToOutIndex.has(key)) {
        const prevIdx = subKeyToOutIndex.get(key)!;
        const prevScore = subKeyToBestScore.get(key) ?? -999;
        if (score > prevScore) {
          subKeyToBestScore.set(key, score);
          out[prevIdx] = {
            ...item,
            lang,
            label,
          };
        }
        continue;
      }
      subKeyToOutIndex.set(key, out.length);
      subKeyToBestScore.set(key, score);
      out.push({
        ...item,
        lang,
        label,
      });
      continue;
    }

    const count = seenLabels.get(key) || 0;
    seenLabels.set(key, count + 1);
    const uniqueLabel = count > 0 ? `${label} (${count + 1})` : label;
    out.push({
      ...item,
      lang,
      label: uniqueLabel,
    });
  }

  return out;
}
