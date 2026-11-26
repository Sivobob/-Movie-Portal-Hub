export type QualityBadgeValue = 'HD' | 'HDTC' | 'NONE';

export const HOLLYWOOD_PRINT_RE =
  /(?:^|[^a-z0-9])(?:hdtc|hd[\s._-]*tc|hdts|hd[\s._-]*ts|hdcam|hd[\s._-]*cam|camrip|cam[\s._-]*rip|cam|predvd|pre[\s._-]*dvd|dvdscr|telesync|telecine|cinevood|cinevoo|cinewood|cinvood|holl[\s._-]*print(?:ed)?|hollywood[\s._-]*print(?:ed)?|hall[\s._-]*print)(?=$|[^a-z0-9])/i;

export function isHollywoodPrintText(text?: unknown): boolean {
  const s = String(text || '').trim();
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
  if (normBadge === 'HD') return false;
  if (normalizeQualityBadge(movie.printType) === 'HDTC') return true;
  return isHollywoodPrintText(
    [
      movie.qualityBadge,
      movie.printType,
      movie.sourceFileName,
      movie.sourceCaption,
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
