export function expandEpisodeNumbers(ep: any): number[] {
  if (!ep) return [];
  const label = String(ep.episodeLabel || '').trim();
  const title = String(ep.title || '').trim();
  const rangeMatch =
    label.match(/^(\d{1,4})\s*[-–—]\s*(\d{1,4})$/) ||
    title.match(/\b(\d{1,4})\s*[-–—]\s*(\d{1,4})\b/);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && start >= 1 && end - start <= 150) {
      const nums: number[] = [];
      for (let i = start; i <= end; i++) nums.push(i);
      return nums;
    }
  }
  const epNum = Number(ep.episodeNumber);
  return Number.isFinite(epNum) && epNum > 0 ? [Math.floor(epNum)] : [];
}

export function isMovieRecordSeries(movie: any): boolean {
  if (!movie) return false;
  if (String(movie.id || '').startsWith('tg_series_')) return true;
  if (Array.isArray(movie.seasons) && movie.seasons.length > 0) return true;
  const orig = String(movie.originalCategory || '').toLowerCase();
  const disp = String(movie.displayCategory || '').toLowerCase();
  if (orig.includes('series') || disp.includes('series')) return true;
  return false;
}

export function getSeasonCoveredEpisodes(season: any): Set<number> {
  const covered = new Set<number>();
  if (!season || !Array.isArray(season.episodes)) return covered;
  for (const ep of season.episodes) {
    if (!ep || !String(ep.streamUrl || '').trim()) continue;
    for (const n of expandEpisodeNumbers(ep)) {
      covered.add(n);
    }
  }
  return covered;
}

/**
 * Verifies that a series has playable episodes, no missing seasons from Season 1,
 * no missing/gapped episode numbers inside any season (must cover 1..maxEp contiguously),
 * and meets any known expected episode counts per season.
 * Non-series movies pass through untouched (unless they have zero playable streams).
 */
export function isSeriesComplete(
  movie: any,
  expectedSeasonCounts?: Record<number, number> | null
): boolean {
  if (!movie) return false;
  if (!isMovieRecordSeries(movie)) {
    return true;
  }

  const seasons = Array.isArray(movie.seasons) ? movie.seasons : [];
  if (seasons.length === 0) return false;

  const sortedSeasons = [...seasons].sort(
    (a, b) => (Number(a?.seasonNumber) || 0) - (Number(b?.seasonNumber) || 0)
  );

  // Must start at Season 1 and have contiguous season numbers (1..N)
  const seasonNumbers = sortedSeasons.map((s) => Number(s?.seasonNumber) || 0);
  if (seasonNumbers[0] !== 1) return false;
  for (let i = 0; i < seasonNumbers.length; i++) {
    if (seasonNumbers[i] !== i + 1) return false;
  }

  for (const season of sortedSeasons) {
    const sNum = Number(season?.seasonNumber) || 0;
    const covered = getSeasonCoveredEpisodes(season);
    if (covered.size === 0) return false;

    const maxEp = Math.max(...covered);
    const minEp = Math.min(...covered);
    if (minEp !== 1) return false;

    for (let ep = 1; ep <= maxEp; ep++) {
      if (!covered.has(ep)) return false;
    }

    const expectedCount = expectedSeasonCounts?.[sNum];
    if (typeof expectedCount === 'number' && expectedCount > 0 && maxEp < expectedCount) {
      return false;
    }
  }

  return true;
}

export function hasPlayableContent(movie: any): boolean {
  if (!movie) return false;
  if (isMovieRecordSeries(movie)) {
    return isSeriesComplete(movie);
  }
  const hasPrimary = Boolean(String(movie.streamingUrl || '').trim());
  const hasQualities = Boolean(
    movie.videoQualities &&
      typeof movie.videoQualities === 'object' &&
      Object.values(movie.videoQualities).some((u) => Boolean(String(u || '').trim()))
  );
  return hasPrimary || hasQualities;
}
