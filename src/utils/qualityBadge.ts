export type QualityBadgeValue = 'HD' | 'HDTC' | 'NONE';

export const HOLLYWOOD_PRINT_RE =
  /(?:^|[^a-z0-9])(?:v\d+[\s._-]*)?(?:hdtc(?:[\s._-]*rip)?|hd[\s._-]*tc|tcrip|tc[\s._-]*rip|tc|hdts(?:[\s._-]*rip)?|hd[\s._-]*ts|tsrip|ts[\s._-]*rip|ts|hdcam|hd[\s._-]*cam|camrip|cam[\s._-]*rip|cam|predvd|pre[\s._-]*dvd|prehd|pre[\s._-]*hd|pre[\s._-]*ts|dvdscr|dvd[\s._-]*scr|telesync|telecine|hq[\s._-]*rip|hqrip|s[\s._-]*print|sprint|1xbet|cinevood|cinevoo|cinewood|cinvood|holl[\s._-]*print(?:ed)?|hollywood[\s._-]*print(?:ed)?|hall[\s._-]*print|hall[\s._-]*cam|theatre[\s._-]*print|theater[\s._-]*print)(?=$|[^a-z0-9])|(?:[\[(]line[\])]|(?:^|[^a-z0-9])line[\s._-]*(?:audio|dub|rip)(?=$|[^a-z0-9])|(?:480p|720p|1080p|2160p|hevc|x264|x265|hdtc|hdts|tsrip|tc|cam|rip|hindi|eng(?:lish)?|japanese|jap|sub)[\s._-]+line(?=$|[^a-z0-9]))/i;

export function isHollywoodPrintText(text?: unknown): boolean {
  const s = String(text || '')
    .trim()
    .replace(/\.(mkv|mp4|avi|mov|webm|m4v|ts|flv|wmv|mpg|mpeg)(?=$|\s|\|)/gi, '');
  if (!s) return false;
  return HOLLYWOOD_PRINT_RE.test(s);
}

export function normalizeQualityBadge(value?: unknown): QualityBadgeValue {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw || raw === 'NONE' || raw === 'NO BADGE') return 'NONE';
  if (
    raw === 'HDTC' ||
    raw === 'HOLL PRINT' ||
    raw === 'HOLL_PRINT' ||
    raw === 'HOLLYWOOD PRINT' ||
    raw === 'HOLLYWOOD_PRINT' ||
    isHollywoodPrintText(raw)
  ) {
    return 'HDTC';
  }
  if (raw === 'HD' || raw === '4K' || raw === 'FHD' || raw === 'UHD') {
    return 'HD';
  }
  return 'NONE';
}

export function isHollywoodPrintMovie(
  movie?: {
    qualityBadge?: unknown;
    printType?: unknown;
    sourceFileName?: unknown;
    sourceCaption?: unknown;
    title?: unknown;
    originalTitle?: unknown;
    description?: unknown;
  } | null
): boolean {
  if (!movie) return false;
  const normBadge = normalizeQualityBadge(movie.qualityBadge);
  if (normBadge === 'HDTC') return true;
  if (normalizeQualityBadge(movie.printType) === 'HDTC') return true;
  const sourceText = [movie.sourceFileName, movie.sourceCaption].filter(Boolean).join(' ');
  if (sourceText && isHollywoodPrintText(sourceText)) return true;
  if (normBadge === 'HD') return false;
  return isHollywoodPrintText(
    [
      movie.qualityBadge,
      movie.printType,
      movie.title,
      movie.originalTitle,
      movie.description,
    ]
      .filter(Boolean)
      .join(' ')
  );
}

/**
 * Returns the label shown directly below the Watch Now button:
 * - "Holl Print" for HDTC / CineVood / CAM / HDTS / PreDVD / Hall & Holl Print releases
 * - "HD" for clean HD releases
 */
export function getWatchNowQualityLabel(movie?: any): 'Holl Print' | 'HD' {
  if (normalizeQualityBadge(movie?.qualityBadge) === 'HD') return 'HD';
  return isHollywoodPrintMovie(movie) ? 'Holl Print' : 'HD';
}

export type PrintUpgradeDecision =
  | 'replace_holl_print_with_hd'
  | 'skip_holl_print_on_hd'
  | 'merge_same_tier';

export function getQualityUpgradeDecision(
  existingMovie:
    | {
        qualityBadge?: unknown;
        printType?: unknown;
        sourceFileName?: unknown;
        sourceCaption?: unknown;
        title?: unknown;
        originalTitle?: unknown;
        description?: unknown;
      }
    | null
    | undefined,
  incomingBadge: QualityBadgeValue
): PrintUpgradeDecision {
  const existingIsPrint = isHollywoodPrintMovie(existingMovie);
  const incomingIsPrint = incomingBadge === 'HDTC';
  if (existingIsPrint && !incomingIsPrint) {
    return 'replace_holl_print_with_hd';
  }
  if (!existingIsPrint && incomingIsPrint) {
    return 'skip_holl_print_on_hd';
  }
  return 'merge_same_tier';
}

export function getVisibleQualityBadge(
  _movie?: { qualityBadge?: unknown } | null
): 'HD' | 'HDTC' | null {
  return null;
}
