export type QualityBadgeValue = 'HD' | 'HDTC' | 'NONE';

export function normalizeQualityBadge(_value?: unknown): QualityBadgeValue {
  return 'NONE';
}

export function getVisibleQualityBadge(
  _movie?: { qualityBadge?: unknown } | null
): 'HD' | 'HDTC' | null {
  return null;
}
