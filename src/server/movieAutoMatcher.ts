import {
  fetchMetadataDetailInternal,
  InternalMetadataSearchResult,
  searchMetadataInternal,
} from './metadataRouter.ts';
import { upgradePosterUrl } from '../utils/posterUrl.ts';

export interface ParsedTelegramMovieMeta {
  rawFileName: string;
  rawCaption: string;
  explicitImdbId: string | null;
  cleanTitle: string;
  groupKey: string;
  year: number | null;
  quality: '4K' | '1080p' | '720p' | '480p' | '360p' | '';
  languageHint: string;
  isHindiDubbed: boolean;
  isSeriesEpisode: boolean;
  isSampleOrClip: boolean;
}

export interface AutoMatchedCandidateSummary {
  imdbId: string;
  title: string;
  year: number | string;
  type: string;
  posterUrl: string;
  cast?: string;
}

export interface AutoMatchedMovieDraft {
  draftId: string;
  channelId: string;
  channelTitle: string;
  msgId: number;
  sourceMsgIds: number[];
  streamUrl: string;
  videoQualities: Record<string, string>;
  qualityBadge: '4K' | 'HD';
  durationSec: number;
  runtime: string;
  sourceFileName: string;
  sourceCaption: string;
  parsedTitle: string;
  parsedYear: number | null;
  imdbId: string;
  title: string;
  originalTitle: string;
  releaseYear: number;
  posterUrl: string;
  backdropUrl: string;
  genre: string;
  description: string;
  director: string;
  cast: string;
  language: string;
  rating: number;
  originalCategory: string;
  matchConfidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  matchReason: string;
  isSeriesEpisode: boolean;
  alternateMatches: AutoMatchedCandidateSummary[];
}

const RELEASE_CUTOFF_RE =
  /\b(?:480p|720p|1080p|2160p|360p|4k|uhd|fhd|hdrip|hd[\s._-]*cam|hdcam|hdts|hdtc|predvd|camrip|dvdscr|dvdrip|web[\s._-]*dl|webdl|web[\s._-]*rip|webrip|bluray|bdrip|brrip|x264|x265|h[\s._-]*264|h[\s._-]*265|hevc|avc|10bit|8bit|hi10p|aac|aac2|aac5|ac3|eac3|dd5[\s._-]*1|ddp5[\s._-]*1|dd2[\s._-]*0|dts|atmos|truehd|esub|esubs|msub|msubs|hc[\s._-]*sub|hc[\s._-]*esub|dual[\s._-]*audio|multi[\s._-]*audio|hindi[\s._-]*dubbed|org[\s._-]*hindi|original[\s._-]*hindi|uncut|unrated|extended|remastered|imax|nf|amzn|dsnp|kone|hotstar|zee5|jiocinema|sonyliv|mxplayer|voot|moviesmod|vegamovies|filmyzilla|filmy4wap|hdhub4u|katmoviehd|skymovieshd|mkvcinemas|bolly4u|bollyflix|dotmovies|hdmovie2|cinevoo|movies4u|pagalworld|worldfree4u|khatrimaza|yify|rarbg|psa|flux|ntb|evo|syncopy)\b/i;

const SERIES_EP_RE =
  /(?:^|[\s._\-\[(])(?:S\d{1,2}[\s._-]*E\d{1,4}|S\d{1,2}|Season[\s._-]*\d{1,2}(?:[\s._-]*(?:Ep|Episode)[\s._-]*\d{1,4})?|Episode[\s._-]*\d{1,4})(?:$|[\s._\-\])])/i;

const PROMO_LINE_RE =
  /(?:join\s+@|join\s+our|channel\s*:|powered\s+by|uploaded\s+by|share\s*&|subscribe|t\.me\/|https?:\/\/|download\s+link|request\s+here|feedback|backup\s+channel)/i;

const TRAILING_LANG_SEASON_RE =
  /\b(?:s\d{1,2}[\s._-]*e\d{1,4}|s0?\d{1,2}|e0?\d{1,4}|season\s*\d{1,2}|episode\s*\d{1,4}|hindi|english|tamil|telugu|malayalam|kannada|punjabi|bengali|marathi|japanese|korean|dubbed|subbed|multi|dual)\b/gi;

function stripFileExtension(name: string): string {
  return name.replace(/\.(mkv|mp4|avi|mov|webm|m4v|ts|flv|wmv|mpg|mpeg)$/i, '');
}

function cleanSingleTitleLine(rawLine: string): {
  title: string;
  year: number | null;
} {
  let text = stripFileExtension(String(rawLine || '').trim());

  // Strip emojis and decorative Unicode symbols
  text = text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ');

  // Remove URLs and @mentions
  text = text.replace(/https?:\/\/\S+/gi, ' ');
  text = text.replace(/t\.me\/\S+/gi, ' ');
  text = text.replace(/@[a-zA-Z0-9_]{3,}/g, ' ');

  // Remove size tokens like 1.4GB, 850 MB
  text = text.replace(/\b\d+(?:\.\d+)?\s*(?:gb|mb|kb)\b/gi, ' ');

  // Replace dots/underscores used as separators with spaces
  text = text.replace(/[._|]+/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  // Remove leading label prefixes like "Movie:", "Title:", "Name:"
  text = text.replace(/^(?:movie|film|title|name)\s*[:\-]\s*/i, '').trim();

  // Remove bracketed site tags at start like [MoviesMod]
  text = text.replace(/^\[[^\]]{2,40}\]\s*/g, '').trim();

  // Extract valid release year (1940 .. nextYear) and remember its position to trim trailing release tags
  const maxValidYear = new Date().getFullYear() + 1;
  let detectedYear: number | null = null;
  let yearIndex = -1;

  // Prefer bracketed year first e.g. (2024) or [2024]
  const bracketYears = Array.from(text.matchAll(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/g));
  for (const m of bracketYears) {
    const yr = parseInt(m[1], 10);
    if (yr >= 1940 && yr <= maxValidYear) {
      detectedYear = yr;
      const idx = m.index ?? -1;
      if (idx > 1) {
        yearIndex = idx;
        text = text.slice(0, idx).trim();
      }
      break;
    }
  }

  // Fallback: unbracketed 4-digit year after title words
  if (!detectedYear) {
    const yearMatches = Array.from(text.matchAll(/\b((?:19|20)\d{2})\b/g));
    for (let i = yearMatches.length - 1; i >= 0; i--) {
      const m = yearMatches[i];
      const idx = m.index ?? 0;
      const yr = parseInt(m[1], 10);
      if (idx > 2 && yr >= 1940 && yr <= maxValidYear) {
        detectedYear = yr;
        yearIndex = idx;
        text = text.slice(0, idx).trim();
        break;
      }
    }
  }

  // Cut at the earliest release/quality/codec/site tag
  const cutoffMatch = text.match(RELEASE_CUTOFF_RE);
  if (cutoffMatch && typeof cutoffMatch.index === 'number' && cutoffMatch.index > 1) {
    text = text.slice(0, cutoffMatch.index);
  }

  // Also strip trailing language/season tokens if not the entire title (e.g. "Kaali Kheti Hindi", "Dhindora S02")
  const wordsAfterStrip = text.replace(TRAILING_LANG_SEASON_RE, ' ').replace(/\s+/g, ' ').trim();
  if (wordsAfterStrip.length >= 2) {
    text = wordsAfterStrip;
  }

  // Strip lingering empty brackets / trailing punctuation
  text = text
    .replace(/[\[(]\s*[\])]/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*(?:dubbed|hindi|english|tamil|telugu|dual|audio|esub|480p|720p|1080p|4k|rip|cam)[^)]*\)/gi, ' ')
    .replace(/\b(?:full\s+movie|hindi\s+movie|south\s+movie|bollywood|hollywood)\b/gi, ' ')
    .replace(/^[\s\-–—:;,./\\]+|[\s\-–—:;,./\\]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  void yearIndex;
  return { title: text, year: detectedYear };
}

function detectQualityTag(
  text: string,
  width = 0,
  height = 0
): '4K' | '1080p' | '720p' | '480p' | '360p' | '' {
  const lower = text.toLowerCase();
  if (/\b(?:2160p|4k|uhd)\b/.test(lower)) return '4K';
  if (/\b(?:1080p|fhd)\b/.test(lower)) return '1080p';
  if (/\b720p\b/.test(lower)) return '720p';
  if (/\b480p\b/.test(lower)) return '480p';
  if (/\b360p\b/.test(lower)) return '360p';

  const maxDim = Math.max(width || 0, height || 0);
  if (maxDim >= 3400 || height >= 2000) return '4K';
  if (maxDim >= 1700 || height >= 950) return '1080p';
  if (maxDim >= 1150 || height >= 680) return '720p';
  if (maxDim >= 700 || height >= 440) return '480p';
  if (maxDim > 0) return '360p';
  return '';
}

function detectLanguageHint(text: string): { languageHint: string; isHindiDubbed: boolean } {
  const lower = text.toLowerCase();
  const isDual = /\b(?:dual[\s._-]*audio|multi[\s._-]*audio)\b/.test(lower);
  const hasHindi = /\bhindi\b/.test(lower);
  const isHindiDubbed = /\bhindi[\s._-]*dubbed\b/.test(lower) || (hasHindi && isDual);

  const langs: string[] = [];
  if (hasHindi) langs.push('Hindi');
  if (/\benglish\b/.test(lower)) langs.push('English');
  if (/\btamil\b/.test(lower)) langs.push('Tamil');
  if (/\btelugu\b/.test(lower)) langs.push('Telugu');
  if (/\bmalayalam\b/.test(lower)) langs.push('Malayalam');
  if (/\bkannada\b/.test(lower)) langs.push('Kannada');
  if (/\bpunjabi\b/.test(lower)) langs.push('Punjabi');
  if (/\bbengali\b/.test(lower)) langs.push('Bengali');
  if (/\bmarathi\b/.test(lower)) langs.push('Marathi');
  if (/\bjapanese\b/.test(lower)) langs.push('Japanese');
  if (/\bkorean\b/.test(lower)) langs.push('Korean');

  if (langs.length === 0 && isDual) {
    return { languageHint: 'Hindi, English', isHindiDubbed: true };
  }
  return {
    languageHint: langs.join(', '),
    isHindiDubbed,
  };
}

function normalizeTitleKey(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function looksGenericTelegramName(name: string): boolean {
  const clean = normalizeTitleKey(name);
  if (!clean || clean.length < 2) return true;
  return /^(?:vid|video|img|document|doc|file|movie|telegram|episode|msg|mp4|mkv)\s*\d*$/i.test(clean);
}

export function parseTelegramMovieMeta(
  fileName: string,
  caption: string,
  width = 0,
  height = 0,
  durationSec = 0,
  sizeBytes = 0
): ParsedTelegramMovieMeta {
  const combined = `${caption || ''}\n${fileName || ''}`;

  // Explicit IMDb ID in caption or filename guarantees 100% accuracy
  const imdbMatch = combined.match(/\b(tt\d{6,10})\b/i);
  const explicitImdbId = imdbMatch ? imdbMatch[1].toLowerCase() : null;

  // Detect samples / promos / short clips
  const lowerCombined = combined.toLowerCase();
  const isSampleOrClip =
    /\b(?:sample|trailer|teaser|promo|intro[\s._-]*clip)\b/i.test(fileName || '') ||
    (durationSec > 0 && durationSec < 300 && sizeBytes > 0 && sizeBytes < 25 * 1024 * 1024);

  const isSeriesEpisode = SERIES_EP_RE.test(combined);

  // Pick the cleanest title from caption lines OR filename
  const captionLines = String(caption || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !PROMO_LINE_RE.test(l) && !/^(?:join|http|@)/i.test(l));

  const candidates: Array<{ title: string; year: number | null; fromCaption: boolean }> = [];
  if (captionLines.length > 0) {
    for (const line of captionLines.slice(0, 3)) {
      const parsedLine = cleanSingleTitleLine(line);
      if (parsedLine.title) {
        candidates.push({ ...parsedLine, fromCaption: true });
      }
    }
  }
  const parsedFile = cleanSingleTitleLine(fileName || '');
  if (parsedFile.title) {
    candidates.push({ ...parsedFile, fromCaption: false });
  }

  // Prefer a non-generic candidate that includes a valid year (and slight preference for caption line #1 if filename is messy)
  candidates.sort((a, b) => {
    const aGen = looksGenericTelegramName(a.title) ? -100 : 0;
    const bGen = looksGenericTelegramName(b.title) ? -100 : 0;
    const aYr = a.year ? 20 : 0;
    const bYr = b.year ? 20 : 0;
    const aWords = a.title.split(/\s+/).length >= 1 && a.title.length >= 3 ? 10 : 0;
    const bWords = b.title.split(/\s+/).length >= 1 && b.title.length >= 3 ? 10 : 0;
    const aCap = a.fromCaption ? 5 : 0;
    const bCap = b.fromCaption ? 5 : 0;
    return (bGen + bYr + bWords + bCap) - (aGen + aYr + aWords + aCap);
  });

  const best = candidates[0] || { title: '', year: null };
  // If caption had title without year, borrow year from filename (or vice versa)
  const fallbackYear = best.year || candidates.find((c) => c.year)?.year || null;

  const quality = detectQualityTag(combined, width, height);
  const { languageHint, isHindiDubbed } = detectLanguageHint(combined);

  const cleanTitle = best.title || stripFileExtension(fileName || '').replace(/[._-]+/g, ' ').trim();
  const normalizedGroupTitle = normalizeTitleKey(cleanTitle).replace(/\s+/g, '');
  const groupKey = explicitImdbId
    ? `imdb-${explicitImdbId}`
    : normalizedGroupTitle
    ? `${normalizedGroupTitle}${fallbackYear ? `-${fallbackYear}` : ''}`
    : '';

  return {
    rawFileName: fileName || '',
    rawCaption: caption || '',
    explicitImdbId,
    cleanTitle,
    groupKey,
    year: fallbackYear,
    quality,
    languageHint,
    isHindiDubbed,
    isSeriesEpisode,
    isSampleOrClip,
  };
}

function getTitleSimilarityScore(candidateTitle: string, queryTitle: string): number {
  const cNorm = normalizeTitleKey(candidateTitle);
  const qNorm = normalizeTitleKey(queryTitle);
  if (!cNorm || !qNorm) return 0;
  if (cNorm === qNorm) return 65;

  // Compact alphanumeric equality (e.g. "Spider-Man" vs "Spider Man" / "K.G.F" vs "KGF")
  const cCompact = cNorm.replace(/\s+/g, '');
  const qCompact = qNorm.replace(/\s+/g, '');
  if (cCompact === qCompact) return 62;

  const stopWords = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'to', 'part', 'chapter', 'movie']);
  const cTokens = cNorm.split(/\s+/).filter((t) => t.length > 0);
  const qTokens = qNorm.split(/\s+/).filter((t) => t.length > 0);
  const cSig = cTokens.filter((t) => !stopWords.has(t));
  const qSig = qTokens.filter((t) => !stopWords.has(t));
  const useC = cSig.length > 0 ? cSig : cTokens;
  const useQ = qSig.length > 0 ? qSig : qTokens;

  let matchedQ = 0;
  for (const qt of useQ) {
    if (useC.includes(qt)) matchedQ++;
  }
  const qCoverage = useQ.length > 0 ? matchedQ / useQ.length : 0;
  const cCoverage = useC.length > 0 ? matchedQ / useC.length : 0;
  const harmonic = qCoverage + cCoverage > 0 ? (2 * qCoverage * cCoverage) / (qCoverage + cCoverage) : 0;

  // Penalize missing sequel numbers (e.g. querying "Pushpa 2" must strongly prefer "Pushpa 2" over "Pushpa 1")
  const qNums: string[] = qNorm.match(/\b(?:2|3|4|5|6|ii|iii|iv)\b/g) || [];
  const cNums: string[] = cNorm.match(/\b(?:2|3|4|5|6|ii|iii|iv)\b/g) || [];
  let sequelPenalty = 0;
  if (qNums.length > 0) {
    const hasMatchNum = qNums.some((n) => cNums.includes(n));
    if (!hasMatchNum) sequelPenalty = -28;
  } else if (cNums.length > 0) {
    sequelPenalty = -10;
  }

  let bonus = 0;
  if (cNorm.startsWith(qNorm) || qNorm.startsWith(cNorm)) bonus += 10;

  return Math.round(harmonic * 52 + bonus + sequelPenalty);
}

function scoreImdbCandidate(
  candidate: AutoMatchedCandidateSummary,
  parsed: ParsedTelegramMovieMeta
): number {
  let score = getTitleSimilarityScore(candidate.title, parsed.cleanTitle);

  const candYearNum = parseInt(String(candidate.year || '').slice(0, 4), 10);
  if (parsed.year && Number.isFinite(candYearNum)) {
    const diff = Math.abs(candYearNum - parsed.year);
    if (diff === 0) score += 45;
    else if (diff === 1) score += 20;
    else if (diff === 2) score += 0;
    else score -= 35;
  } else if (Number.isFinite(candYearNum) && candYearNum >= 1950) {
    // Prefer modern releases over silent-era 1920s entries when filename omits year
    if (candYearNum >= 2000) score += 8;
  }

  // Must have a real poster
  if (candidate.posterUrl && candidate.posterUrl !== 'N/A' && /^https?:\/\//i.test(candidate.posterUrl)) {
    score += 20;
  } else {
    score -= 55;
  }

  // Content type alignment
  const typeLower = String(candidate.type || 'movie').toLowerCase();
  if (typeLower === 'game') {
    score -= 70;
  } else if (!parsed.isSeriesEpisode) {
    if (typeLower === 'movie') score += 12;
    else if (typeLower === 'series') score -= 12;
  } else {
    if (typeLower === 'series') score += 15;
  }

  return score;
}

function mergeFinalLanguage(omdbLang: string, parsed: ParsedTelegramMovieMeta): string {
  const hint = parsed.languageHint;
  if (!hint) return omdbLang || 'Hindi';
  if (parsed.isHindiDubbed) {
    const hintParts = hint.split(',').map((s) => s.trim()).filter(Boolean);
    if (!hintParts.some((s) => s.toLowerCase() === 'hindi')) {
      hintParts.unshift('Hindi');
    }
    return hintParts.join(', ');
  }
  if (hint.toLowerCase().includes('hindi') && omdbLang && !omdbLang.toLowerCase().includes('hindi')) {
    return `${hint}, ${omdbLang}`;
  }
  return hint || omdbLang || 'Hindi';
}

export async function resolveBestImdbMatch(
  parsed: ParsedTelegramMovieMeta
): Promise<{
  imdbId: string;
  title: string;
  originalTitle: string;
  releaseYear: number;
  posterUrl: string;
  backdropUrl: string;
  genre: string;
  description: string;
  director: string;
  cast: string;
  runtime: string;
  language: string;
  rating: number;
  originalCategory: string;
  matchConfidence: 'high' | 'medium' | 'low';
  confidenceScore: number;
  matchReason: string;
  alternateMatches: AutoMatchedCandidateSummary[];
}> {
  const fallbackYear = parsed.year || new Date().getFullYear();

  // 1. Direct IMDb ID in Telegram caption/filename
  if (parsed.explicitImdbId) {
    const detail = await fetchMetadataDetailInternal(parsed.explicitImdbId);
    if (detail.status === 'ok' && detail.data) {
      const d = detail.data;
      const poster = upgradePosterUrl(d.posterUrl, 1080) || d.posterUrl || '';
      const backdrop = upgradePosterUrl(d.backdropUrl || poster, 1280) || poster;
      return {
        imdbId: d.imdbId || parsed.explicitImdbId,
        title: d.title || parsed.cleanTitle,
        originalTitle: d.originalTitle || d.title || parsed.cleanTitle,
        releaseYear: d.releaseYear || fallbackYear,
        posterUrl: poster,
        backdropUrl: backdrop,
        genre: d.genre || 'Action',
        description: d.description || '',
        director: d.director || '',
        cast: d.cast || '',
        runtime: d.runtime || '',
        language: mergeFinalLanguage(d.language, parsed),
        rating: d.rating || 8.0,
        originalCategory: d.suggestedCategory || 'Bollywood Movie',
        matchConfidence: poster ? 'high' : 'medium',
        confidenceScore: poster ? 100 : 75,
        matchReason: 'Exact IMDb ID in caption',
        alternateMatches: [],
      };
    }
  }

  // 2. Build clean search queries
  const queriesToTry: string[] = [];
  if (parsed.cleanTitle && !looksGenericTelegramName(parsed.cleanTitle)) {
    if (parsed.year) queriesToTry.push(`${parsed.cleanTitle} ${parsed.year}`);
    queriesToTry.push(parsed.cleanTitle);

    // Strip subtitle after ":" or "-" as fallback (e.g. "Pushpa 2: The Rule" -> "Pushpa 2")
    const strippedSub = parsed.cleanTitle.split(/\s*[:\-–]\s*/)[0]?.trim();
    if (strippedSub && strippedSub.length >= 3 && strippedSub.toLowerCase() !== parsed.cleanTitle.toLowerCase()) {
      queriesToTry.push(parsed.year ? `${strippedSub} ${parsed.year}` : strippedSub);
    }
  }

  const allCandidatesMap = new Map<string, AutoMatchedCandidateSummary>();
  for (let i = 0; i < queriesToTry.length; i++) {
    const q = queriesToTry[i];
    const searchRes: InternalMetadataSearchResult = await searchMetadataInternal(q);
    for (const item of searchRes.results || []) {
      if (item?.imdbId && !allCandidatesMap.has(item.imdbId)) {
        allCandidatesMap.set(item.imdbId, {
          imdbId: item.imdbId,
          title: item.title,
          year: item.year,
          type: item.type,
          posterUrl: upgradePosterUrl(item.posterUrl, 1080) || item.posterUrl || '',
          cast: item.cast,
        });
      }
    }
    // Stop early if first query already produced a strong scored match with a poster
    if (allCandidatesMap.size > 0 && i === 0) {
      const topFirst = Array.from(allCandidatesMap.values())
        .map((c) => ({ c, s: scoreImdbCandidate(c, parsed) }))
        .sort((a, b) => b.s - a.s)[0];
      if (topFirst && topFirst.s >= 95 && topFirst.c.posterUrl) {
        break;
      }
    }
  }

  const scoredCandidates = Array.from(allCandidatesMap.values())
    .map((cand) => ({ cand, score: scoreImdbCandidate(cand, parsed) }))
    .sort((a, b) => b.score - a.score);

  const winner = scoredCandidates[0];
  const alternateMatches = scoredCandidates.slice(0, 6).map((x) => x.cand);

  if (!winner || winner.score < 25) {
    return {
      imdbId: '',
      title: parsed.cleanTitle || parsed.rawFileName || 'Untitled Movie',
      originalTitle: parsed.cleanTitle || parsed.rawFileName || 'Untitled Movie',
      releaseYear: fallbackYear,
      posterUrl: '',
      backdropUrl: '',
      genre: 'Action',
      description: '',
      director: '',
      cast: '',
      runtime: '',
      language: parsed.languageHint || 'Hindi',
      rating: 7.5,
      originalCategory: parsed.isSeriesEpisode ? 'Web Series' : 'Bollywood Movie',
      matchConfidence: 'low',
      confidenceScore: Math.max(0, winner?.score || 0),
      matchReason: 'Movie not confidently matched on IMDb — pick poster manually',
      alternateMatches,
    };
  }

  // 3. Fetch complete IMDb/OMDb/Wikipedia detail for the winning candidate
  const detail = await fetchMetadataDetailInternal(winner.cand.imdbId, winner.cand.title);
  const d = detail.status === 'ok' ? detail.data : undefined;

  const bestPoster =
    upgradePosterUrl(d?.posterUrl || winner.cand.posterUrl, 1080) ||
    d?.posterUrl ||
    winner.cand.posterUrl ||
    '';
  const bestBackdrop =
    upgradePosterUrl(d?.backdropUrl || bestPoster, 1280) || bestPoster;

  const finalYear = Number(d?.releaseYear || parseInt(String(winner.cand.year || ''), 10) || fallbackYear) || fallbackYear;
  const rawSim = getTitleSimilarityScore(d?.title || winner.cand.title, parsed.cleanTitle);
  const yearMatched = Boolean(parsed.year && Math.abs(finalYear - parsed.year) <= 1);
  const hasPoster = Boolean(bestPoster && /^https?:\/\//i.test(bestPoster));

  let matchConfidence: 'high' | 'medium' | 'low' = 'low';
  let matchReason = 'Verify title & poster';

  if (hasPoster && rawSim >= 55 && (yearMatched || (!parsed.year && winner.score >= 82))) {
    matchConfidence = 'high';
    matchReason = yearMatched
      ? `Exact Title + Year (${finalYear}) • Verified Poster`
      : 'Strong Title Match • Verified Poster';
  } else if (hasPoster && winner.score >= 55) {
    matchConfidence = 'medium';
    matchReason = !parsed.year
      ? 'Matched without release year in filename — quick check poster'
      : 'Partial match — verify poster & year';
  } else {
    matchConfidence = 'low';
    matchReason = hasPoster ? 'Low title similarity — verify movie' : 'No poster found on IMDb';
  }

  let suggestedCategory = d?.suggestedCategory || 'Bollywood Movie';
  if (parsed.isSeriesEpisode && suggestedCategory.toLowerCase().includes('movie')) {
    suggestedCategory = suggestedCategory.toLowerCase().includes('anime') ? 'Anime Series' : 'Web Series';
  }

  return {
    imdbId: d?.imdbId || winner.cand.imdbId,
    title: d?.title || winner.cand.title,
    originalTitle: d?.originalTitle || d?.title || winner.cand.title,
    releaseYear: finalYear,
    posterUrl: bestPoster,
    backdropUrl: bestBackdrop,
    genre: d?.genre || 'Action',
    description: d?.description || '',
    director: d?.director || '',
    cast: d?.cast || winner.cand.cast || '',
    runtime: d?.runtime || '',
    language: mergeFinalLanguage(d?.language || 'Hindi', parsed),
    rating: Number(d?.rating) || 8.0,
    originalCategory: suggestedCategory,
    matchConfidence,
    confidenceScore: Math.max(0, Math.min(100, winner.score)),
    matchReason,
    alternateMatches,
  };
}
