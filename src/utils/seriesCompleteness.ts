export function expandEpisodeNumbers(ep: any): number[] {
  if (!ep) return [];
  const label = String(ep.episodeLabel || '').trim();
  const title = String(ep.title || '').trim();
  const labelLower = label.toLowerCase();
  if (
    labelLower === 'complete' ||
    labelLower === 'combined' ||
    labelLower === 'full' ||
    /\b(?:complete|combined|full)\s*(?:season|pack)?\b/i.test(title)
  ) {
    return [];
  }
  const rangeMatch =
    label.match(/^e?0*(\d{1,4})\s*[-–—]\s*e?0*(\d{1,4})$/i) ||
    title.match(/(?:^|\b(?:episodes?|eps?|e)\s*)0*(\d{1,4})\s*[-–—]\s*(?:e\s*)?0*(\d{1,4})\b/i);
  if (rangeMatch) {
    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start && start >= 1 && end - start <= 150) {
      const nums: number[] = [];
      for (let i = start; i <= end; i++) nums.push(i);
      return nums;
    }
  }
  if (/^episode\s*0\b/i.test(title)) return [];
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

export function isCompleteSeasonPackEpisode(ep: any): boolean {
  if (!ep || !String(ep.streamUrl || '').trim()) return false;
  const label = String(ep.episodeLabel || '').trim().toLowerCase();
  const title = String(ep.title || '').trim().toLowerCase();
  return (
    label === 'complete' ||
    label === 'combined' ||
    label === 'full' ||
    /\b(?:complete|combined|full)\s*(?:season|pack)?\b/i.test(title)
  );
}

export function inferEpisodeQualityRank(ep: any): number {
  if (!ep) return 0;
  const tokens: string[] = [
    String(ep.quality || ''),
    String(ep.title || ''),
    String(ep.episodeLabel || ''),
    ...(ep.videoQualities && typeof ep.videoQualities === 'object' ? Object.keys(ep.videoQualities) : []),
  ];
  const combined = tokens.join(' ').toLowerCase();
  if (/\b(?:2160p|4k|uhd)\b/.test(combined)) return 5;
  if (/\b(?:1080p|fhd)\b/.test(combined)) return 4;
  if (/\b720p\b/.test(combined)) return 3;
  if (/\b540p\b/.test(combined)) return 2.5;
  if (/\b480p\b/.test(combined)) return 2;
  if (/\b360p\b/.test(combined)) return 1;
  return 0;
}

interface EpisodeIntervalItem {
  ep: any;
  start: number;
  end: number;
  len: number;
  hasStream: boolean;
  qualityRank: number;
  durationSec: number;
  origIdx: number;
}

function isBetterDuplicateEp(cand: EpisodeIntervalItem, existing: EpisodeIntervalItem): boolean {
  if (cand.hasStream !== existing.hasStream) return cand.hasStream;
  if (cand.qualityRank !== existing.qualityRank) return cand.qualityRank > existing.qualityRank;
  const candHasDur = cand.durationSec > 0;
  const exHasDur = existing.durationSec > 0;
  if (candHasDur !== exHasDur) return candHasDur;
  return false;
}

/**
 * Reconciles a season's episode list:
 * - Removes invalid Episode 0 / non-positive entries
 * - Detects implicit Complete-season duration outliers disguised as Episode 1 / N+1
 * - Drops redundant Complete-season packs when >= 2 specific episodes exist
 * - Deduplicates identical episode/range intervals (preferring higher quality)
 * - Solves weighted interval scheduling so mixed/overlapping multi-episode packs
 *   (e.g. E1-10 + E9-16 + E11-20) never appear together, while preserving valid
 *   single-episode boundary overlaps on adjacent large packs (e.g. 51-65 + 65-80)
 * - Always returns episodes sorted in ascending episode order
 */
export function reconcileSeasonEpisodes(rawEpisodes: any[]): any[] {
  if (!Array.isArray(rawEpisodes) || rawEpisodes.length === 0) return [];

  const validRaw = rawEpisodes.filter((ep) => {
    if (!ep) return false;
    const epNum = Number(ep.episodeNumber);
    const title = String(ep.title || '').trim();
    if (/^episode\s*0\b/i.test(title)) return false;
    if (!isCompleteSeasonPackEpisode(ep) && (!Number.isFinite(epNum) || epNum <= 0)) {
      return expandEpisodeNumbers(ep).length > 0;
    }
    return true;
  });

  if (validRaw.length === 0) return [];

  // Detect unlabeled single episodes whose duration is an outlier (>= 5400s & >= 2.8x median single)
  const singleDurations = validRaw
    .filter((ep) => {
      if (isCompleteSeasonPackEpisode(ep)) return false;
      const nums = expandEpisodeNumbers(ep);
      const dur = Number(ep.durationSec) || 0;
      return nums.length === 1 && dur >= 300 && dur < 5400;
    })
    .map((ep) => Number(ep.durationSec))
    .sort((a, b) => a - b);

  let medianSingleDur = 0;
  if (singleDurations.length >= 3) {
    const mid = Math.floor(singleDurations.length / 2);
    medianSingleDur =
      singleDurations.length % 2 === 1
        ? singleDurations[mid]
        : (singleDurations[mid - 1] + singleDurations[mid]) / 2;
  }

  const completePacks: any[] = [];
  const intervalMap = new Map<string, EpisodeIntervalItem>();

  validRaw.forEach((ep, origIdx) => {
    const dur = Number(ep.durationSec) || 0;
    const expanded = expandEpisodeNumbers(ep);
    const isDurationOutlierComplete =
      !isCompleteSeasonPackEpisode(ep) &&
      expanded.length === 1 &&
      !String(ep.episodeLabel || '').trim() &&
      medianSingleDur > 0 &&
      dur >= 5400 &&
      dur >= medianSingleDur * 2.8;

    if (isCompleteSeasonPackEpisode(ep) || isDurationOutlierComplete) {
      completePacks.push(ep);
      return;
    }

    if (expanded.length === 0) return;
    const start = expanded[0];
    const end = expanded[expanded.length - 1];
    const key = `${start}-${end}`;
    const item: EpisodeIntervalItem = {
      ep,
      start,
      end,
      len: end - start + 1,
      hasStream: Boolean(String(ep.streamUrl || '').trim()),
      qualityRank: inferEpisodeQualityRank(ep),
      durationSec: dur,
      origIdx,
    };

    const prev = intervalMap.get(key);
    if (!prev || isBetterDuplicateEp(item, prev)) {
      // Preserve merged videoQualities if both have streams
      if (prev && prev.hasStream && item.hasStream && (prev.ep?.videoQualities || item.ep?.videoQualities)) {
        const mergedVq = {
          ...(prev.ep?.videoQualities || {}),
          ...(item.ep?.videoQualities || {}),
        };
        if (Object.keys(mergedVq).length > 0) {
          item.ep = { ...item.ep, videoQualities: mergedVq };
        }
      }
      intervalMap.set(key, item);
    }
  });

  const uniqueIntervals = Array.from(intervalMap.values());
  const specificCovered = new Set<number>();
  for (const it of uniqueIntervals) {
    if (!it.hasStream) continue;
    for (let e = it.start; e <= it.end; e++) specificCovered.add(e);
  }

  // Keep Complete pack only when there are < 2 specific covered episodes
  if (specificCovered.size < 2 && completePacks.length > 0) {
    const sortedCompletes = [...completePacks].sort((a, b) => {
      const aStream = Boolean(String(a?.streamUrl || '').trim()) ? 1 : 0;
      const bStream = Boolean(String(b?.streamUrl || '').trim()) ? 1 : 0;
      if (bStream !== aStream) return bStream - aStream;
      const qDiff = inferEpisodeQualityRank(b) - inferEpisodeQualityRank(a);
      if (qDiff !== 0) return qDiff;
      return (Number(b?.durationSec) || 0) - (Number(a?.durationSec) || 0);
    });
    return [sortedCompletes[0]];
  }

  if (uniqueIntervals.length === 0) return [];

  // Sort by end ASC, start ASC for DP
  const sorted = [...uniqueIntervals].sort((a, b) => {
    if (a.end !== b.end) return a.end - b.end;
    if (a.start !== b.start) return a.start - b.start;
    if (b.qualityRank !== a.qualityRank) return b.qualityRank - a.qualityRank;
    return a.origIdx - b.origIdx;
  });

  // Fast check: if strictly non-overlapping already, just sort by start ASC and return
  let hasAnyOverlap = false;
  const byStart = [...sorted].sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));
  for (let i = 1; i < byStart.length; i++) {
    if (byStart[i].start <= byStart[i - 1].end) {
      hasAnyOverlap = true;
      break;
    }
  }
  if (!hasAnyOverlap) {
    return byStart.map((it) => it.ep);
  }

  // Weighted interval scheduling DP
  const n = sorted.length;
  const dp = new Array<number>(n).fill(0);
  const parent = new Array<number>(n).fill(-1);

  const itemIntrinsic = (it: EpisodeIntervalItem, newlyCovered: number, isBoundaryTouch: boolean): number => {
    const streamScore = it.hasStream ? newlyCovered * 1000 : newlyCovered * 10;
    const qualityScore = newlyCovered * it.qualityRank * 8;
    const granularityBonus = 12;
    const boundaryPenalty = isBoundaryTouch ? -50 : 0;
    return streamScore + qualityScore + granularityBonus + boundaryPenalty;
  };

  for (let i = 0; i < n; i++) {
    const curr = sorted[i];
    const leadingPenalty = Math.max(0, curr.start - 1) * -200;
    let bestScore = itemIntrinsic(curr, curr.len, false) + leadingPenalty;
    let bestPrev = -1;

    for (let j = 0; j < i; j++) {
      const prev = sorted[j];
      const isDisjoint = curr.start > prev.end;
      const isBoundaryTouch =
        curr.start === prev.end && curr.len >= 4 && prev.len >= 4;

      if (!isDisjoint && !isBoundaryTouch) continue;

      const overlapCount = isBoundaryTouch ? 1 : 0;
      const newlyCovered = curr.len - overlapCount;
      const gapPenalty = Math.max(0, curr.start - prev.end - 1) * -1500;
      const candidate =
        dp[j] + itemIntrinsic(curr, newlyCovered, isBoundaryTouch) + gapPenalty;

      if (candidate > bestScore) {
        bestScore = candidate;
        bestPrev = j;
      }
    }

    dp[i] = bestScore;
    parent[i] = bestPrev;
  }

  let bestEndIdx = 0;
  for (let i = 1; i < n; i++) {
    if (dp[i] > dp[bestEndIdx]) bestEndIdx = i;
  }

  const chosen: EpisodeIntervalItem[] = [];
  let cur: number = bestEndIdx;
  while (cur !== -1) {
    chosen.push(sorted[cur]);
    cur = parent[cur];
  }
  chosen.reverse();
  chosen.sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end));

  return chosen.map((it) => it.ep);
}

/**
 * Normalizes seasons & episodes on a movie/series record so episodes are
 * consistently deduplicated, overlap-free, and sorted ascending.
 */
export function normalizeSeriesSeasons<T extends Record<string, any>>(movie: T): T {
  if (!movie || !isMovieRecordSeries(movie) || !Array.isArray(movie.seasons) || movie.seasons.length === 0) {
    return movie;
  }

  const normalizedSeasons = movie.seasons
    .map((s: any, idx: number) => ({
      ...s,
      seasonNumber: Number(s?.seasonNumber) || idx + 1,
      episodes: reconcileSeasonEpisodes(Array.isArray(s?.episodes) ? s.episodes : []),
    }))
    .sort((a: any, b: any) => a.seasonNumber - b.seasonNumber);

  const nonEmptySeasons = normalizedSeasons.filter((s: any) => s.episodes.length > 0);
  const finalSeasons = nonEmptySeasons.length > 0 ? nonEmptySeasons : normalizedSeasons;

  const allEpUrls = new Set<string>();
  for (const s of finalSeasons) {
    for (const ep of s.episodes) {
      const u = String(ep?.streamUrl || '').trim();
      if (u) allEpUrls.add(u);
    }
  }

  const firstEpStream = String(finalSeasons[0]?.episodes?.[0]?.streamUrl || '').trim();
  const currentStream = String(movie.streamingUrl || '').trim();
  const nextStreamingUrl =
    allEpUrls.size > 0 && (!currentStream || !allEpUrls.has(currentStream))
      ? firstEpStream
      : movie.streamingUrl;

  return {
    ...movie,
    seasons: finalSeasons,
    ...(nextStreamingUrl !== movie.streamingUrl ? { streamingUrl: nextStreamingUrl } : {}),
  };
}

/**
 * Safely merges an incoming episode or multi-episode pack into existing seasons
 * and runs season reconciliation so overlaps, duplicate packs, and Complete packs
 * over specific episodes are cleanly resolved.
 */
export function mergeEpisodeIntoSeasons(
  existingSeasons: Array<{ seasonNumber: number; episodes: any[] }>,
  seasonNum: number,
  newEpisode: {
    episodeNumber: number;
    episodeLabel?: string;
    title: string;
    streamUrl: string;
    quality?: string;
    videoQualities?: Record<string, string>;
    duration?: string;
    durationSec?: number;
    showInNewEpisodes?: boolean;
    newEpisodeEnabledAt?: number;
    createdAt?: number;
    addedAt?: number;
  },
  replaceExistingEpisode = false
): { mergedSeasons: Array<{ seasonNumber: number; episodes: any[] }>; added: boolean } {
  const cleanStream = String(newEpisode?.streamUrl || '').trim();
  const cleanStreamLower = cleanStream.toLowerCase();
  if (!cleanStream || (!isCompleteSeasonPackEpisode(newEpisode) && !(Number(newEpisode.episodeNumber) > 0))) {
    return {
      mergedSeasons: Array.isArray(existingSeasons) ? existingSeasons : [],
      added: false,
    };
  }
  if (/^episode\s*0\b/i.test(String(newEpisode.title || '').trim())) {
    return {
      mergedSeasons: Array.isArray(existingSeasons) ? existingSeasons : [],
      added: false,
    };
  }

  const cloned = Array.isArray(existingSeasons)
    ? existingSeasons.map((s) => ({
        ...s,
        seasonNumber: Number(s?.seasonNumber) || 1,
        episodes: Array.isArray(s?.episodes) ? [...s.episodes] : [],
      }))
    : [];

  let targetSeason = cloned.find((s) => s.seasonNumber === seasonNum);
  if (!targetSeason) {
    targetSeason = { seasonNumber: seasonNum, episodes: [] };
    cloned.push(targetSeason);
  }

  if (
    targetSeason.episodes.some(
      (ep) => String(ep?.streamUrl || '').trim().toLowerCase() === cleanStreamLower
    )
  ) {
    return { mergedSeasons: cloned, added: false };
  }

  const incomingNums = expandEpisodeNumbers(newEpisode);
  const incomingIsComplete = isCompleteSeasonPackEpisode(newEpisode);
  const existingCovered = getSeasonCoveredEpisodes(targetSeason);

  // Never overwrite/append a Complete pack on top of >= 2 specific episodes
  if (incomingIsComplete && existingCovered.size >= 2) {
    return { mergedSeasons: cloned, added: false };
  }

  let candidateEpisodes = [...targetSeason.episodes];
  if (replaceExistingEpisode && incomingNums.length > 0) {
    const incomingSet = new Set(incomingNums);
    candidateEpisodes = candidateEpisodes.filter((ep) => {
      const nums = expandEpisodeNumbers(ep);
      return !nums.some((n) => incomingSet.has(n));
    });
  } else if (incomingNums.length > 0) {
    // Allow incoming to supersede empty placeholder or lower-quality exact match
    const incomingRank = inferEpisodeQualityRank(newEpisode);
    const sameIntervalIdx = candidateEpisodes.findIndex((ep) => {
      const nums = expandEpisodeNumbers(ep);
      if (nums.length !== incomingNums.length) return false;
      return nums[0] === incomingNums[0] && nums[nums.length - 1] === incomingNums[incomingNums.length - 1];
    });
    if (sameIntervalIdx >= 0) {
      const existingEp = candidateEpisodes[sameIntervalIdx];
      const existingHasStream = Boolean(String(existingEp?.streamUrl || '').trim());
      const existingRank = inferEpisodeQualityRank(existingEp);
      if (existingHasStream && incomingRank <= existingRank) {
        return { mergedSeasons: cloned, added: false };
      }
      candidateEpisodes.splice(sameIntervalIdx, 1);
    }
  }

  candidateEpisodes.push(newEpisode);
  const reconciled = reconcileSeasonEpisodes(candidateEpisodes);
  const survived = reconciled.some(
    (ep) => String(ep?.streamUrl || '').trim().toLowerCase() === cleanStreamLower
  );

  if (!survived) {
    return { mergedSeasons: cloned, added: false };
  }

  targetSeason.episodes = reconciled;
  cloned.sort((a, b) => a.seasonNumber - b.seasonNumber);
  return { mergedSeasons: cloned, added: true };
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
    const hasCompletePack =
      Array.isArray(season?.episodes) &&
      season.episodes.some((ep: any) => isCompleteSeasonPackEpisode(ep));
    if (hasCompletePack) {
      continue;
    }

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
    if (Array.isArray(movie.seasons) && movie.seasons.length > 0) {
      return movie.seasons.some((s: any) =>
        Array.isArray(s?.episodes) &&
        s.episodes.some((ep: any) => Boolean(String(ep?.streamUrl || ep?.streamingUrl || '').trim()))
      );
    }
    return Boolean(String(movie.streamingUrl || '').trim());
  }
  const hasPrimary = Boolean(String(movie.streamingUrl || '').trim());
  const hasQualities = Boolean(
    movie.videoQualities &&
      typeof movie.videoQualities === 'object' &&
      Object.values(movie.videoQualities).some((u) => Boolean(String(u || '').trim()))
  );
  return hasPrimary || hasQualities;
}
