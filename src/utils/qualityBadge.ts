export type QualityBadgeValue = 'HD' | 'HDTC' | 'NONE';

/**
 * Normalizes stored qualityBadge value from Firestore or form state.
 * Legacy/unset documents default to 'HD' to preserve existing catalog behavior.
 */
export function normalizeQualityBadge(value?: unknown): QualityBadgeValue {
  if (value === 'NONE' || value === 'No Badge' || value === '') {
    return 'NONE';
  }
  if (typeof value === 'string') {
    const upper = value.trim().toUpperCase();
    if (upper === 'HDTC') return 'HDTC';
    if (upper === 'NONE' || upper === 'NO BADGE') return 'NONE';
    if (upper === 'HD') return 'HD';
  }
  return 'HD';
}

/**
 * Returns the badge text to render on poster cards ('HD' | 'HDTC'),
 * or null when admin selected "No Badge".
 */
export function getVisibleQualityBadge(
  movie?: { qualityBadge?: unknown } | null
): 'HD' | 'HDTC' | null {
  const normalized = normalizeQualityBadge(movie?.qualityBadge);
  if (normalized === 'NONE') return null;
  return normalized;
}
