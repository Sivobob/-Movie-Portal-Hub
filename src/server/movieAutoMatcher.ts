import {
  fetchMetadataDetailInternal,
  InternalMetadataSearchResult,
  searchMetadataInternal,
} from './metadataRouter.ts';
import { upgradePosterUrl } from '../utils/posterUrl.ts';
import { isHollywoodPrintText } from '../utils/qualityBadge.ts';

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
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeLabel: string;
  episodeTitle: string;
  isSampleOrClip: boolean;
  isHollywoodPrint: boolean;
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
  msgDateMs?: number;
  sourceMsgIds: number[];
  streamUrl: string;
  videoQualities: Record<string, string>;
  qualityBadge: '4K' | 'HD' | 'HDTC';
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
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  episodeLabel?: string;
  episodeTitle?: string;
  alternateMatches: AutoMatchedCandidateSummary[];
}

const RELEASE_CUTOFF_RE =
  /\b(?:480p|720p|1080p|2160p|360p|4k|uhd|fhd|hdrip|hd[\s._-]*cam|hdcam|hdts|hdtc|v\d+[\s._-]*hdtc|tc|hq[\s._-]*rip|hqrip|prehd|pre[\s._-]*hd|s[\s._-]*print|sprint|1xbet|telesync|telecine|predvd|camrip|cam|dvdscr|dvdrip|holl[\s._-]*print(?:ed)?|hollywood[\s._-]*print(?:ed)?|hall[\s._-]*print|cinevood|cinevoo|cinewood|cinvood|web[\s._-]*dl|webdl|web[\s._-]*rip|webrip|bluray|bdrip|brrip|x264|x265|h[\s._-]*264|h[\s._-]*265|hevc|avc|10bit|8bit|hi10p|aac|aac2|aac5|ac3|eac3|dd5[\s._-]*1|ddp5[\s._-]*1|dd2[\s._-]*0|dts|atmos|truehd|esub|esubs|msub|msubs|hc[\s._-]*sub|hc[\s._-]*esub|dual[\s._-]*audio|multi[\s._-]*audio|full[\s._-]+(?:hindi|dubbed|hd|movie)|hindi[\s._-]*dubbed|org[\s._-]*hindi|original[\s._-]*hindi|uncut|unrated|extended|remastered|imax|nf|amzn|dsnp|kone|hotstar|zee5|jiocinema|sonyliv|mxplayer|voot|moviesmod|vegamovies|filmyzilla|filmy4wap|hdhub4u|katmoviehd|skymovieshd|mkvcinemas|bolly4u|bollyflix|dotmovies|hdmovie2|movies4u|pagalworld|worldfree4u|khatrimaza|yify|rarbg|psa|flux|ntb|evo|syncopy|watch[\s._-]+online|free[\s._-]+download|download[\s._-]+now)\b/i;

const SERIES_EP_RE =
  /(?:^|[\s._\-\[(])(?:S\d{1,2}[\s._-]*E\d{1,4}|S\d{1,2}|Season[\s._-]*\d{1,2}(?:[\s._-]*(?:Ep|Episode)[\s._-]*\d{1,4})?|Episode[\s._-]*\d{1,4}|Ep\.?[\s._-]*\d{1,4}|E0*\d{1,3}(?:[\s._-]*[-–—][\s._-]*E?0*\d{1,3})?|\d{1,2}x\d{1,4})(?:$|[\s._\-\])])/i;

const SERIES_CUTOFF_RE =
  /(?:^|[\s._\-\[(])(?:S0?\d{1,2}[\s._-]*E0?\d{1,4}|S0?\d{1,2}|Season[\s._-]*\d{1,2}|Episode[\s._-]*\d{1,4}|Ep\.?[\s._-]*\d{1,4}|E0*\d{1,3}(?:[\s._-]*[-–—][\s._-]*E?0*\d{1,3})?|\d{1,2}x\d{1,4})\b/i;

const PROMO_LINE_RE =
  /(?:join\s+@|join\s+our|join\s+channel|channel\s*[:\-–—]|powered\s+by|uploaded\s+by|upload\s+by|shared\s+by|share\s*&|subscribe|t\.me\/|https?:\/\/|download\s+link|request\s+here|feedback|backup\s+channel|follow\s+us|telegram\.me|watch\s+online|click\s+here|more\s+movies|visit\s+our|copyright|dmca|disclaimer)/i;

const NON_TITLE_META_LINE_RE =
  /^(?:imdb(?:\s+rating)?|tmdb|rotten\s*tomatoes|rating|score|genre|genres|story(?:\s*line)?|plot|synopsis|overview|about|summary|tagline|cast|starring|star\s*cast|actors?|actress|director|directed\s+by|writer|written\s+by|music(?:\s+by)?|producer|produced\s+by|language|languages|audio|voice|subtitle|subtitles|subs?|quality|format|resolution|codec|bitrate|size|file\s*size|duration|runtime|release(?:\s*(?:date|year))?|released|year|country|ott|platform|network|studio|banner|note|warning|info|screens?(?:hots?)?|links?|watch(?:\s+online)?|download|telegram|channel|backup|bot|credit|credits|uploaded(?:\s*by)?|posted(?:\s*by)?|source|rip|encoder?|episode\s*(?:title|name)?|episodes?|season|seasons?|status|part)\s*[:\-–—=|]/i;

const EXPLICIT_TITLE_LABEL_RE =
  /^(?:movie\s*(?:name|title)?|web\s*series|anime(?:\s*series)?|series\s*(?:name|title)?|show\s*(?:name|title)?|film\s*(?:name|title)?|title|name)\s*[:\-–—=|]\s*(.+)$/i;

const EXPLICIT_YEAR_LINE_RE =
  /^(?:release\s*)?(?:year|released|release\s*date)\s*[:\-–—=|]\s*.*?((?:19|20)\d{2})\b/i;

const INLINE_META_CUTOFF_RE =
  /\s+(?:imdb(?:\s*rating)?|rating|genre|genres|story(?:\s*line)?|plot|synopsis|summary|cast|starring|star\s*cast|actors?|director|directed\s+by|language|languages|audio|voice|quality|resolution|duration|runtime|release\s*(?:date|year)|year|subtitles?|subs?|size|download|watch\s+online|uploaded\s*by|join\s+@?)\s*[:\-–—=|]/i;

const TRAILING_LANG_SEASON_RE =
  /\b(?:s\d{1,2}[\s._-]*e\d{1,4}|s0?\d{1,2}|e0?\d{1,4}|ep\.?\s*0*\d{1,4}|season\s*\d{1,2}|episode\s*\d{1,4}|hindi|english|tamil|telugu|malayalam|kannada|punjabi|bengali|marathi|japanese|korean|dubbed|subbed|multi|dual)\b/gi;

function stripDecorativeSymbols(input: string): string {
  return String(input || '')
    .normalize('NFKD')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}★☆⭐🎬📺🔥✨👉👇━═─│┃•●◆◇■□▪▫»«›‹➤➜➞➣]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripFileExtension(name: string): string {
  return name.replace(/\.(mkv|mp4|avi|mov|webm|m4v|ts|flv|wmv|mpg|mpeg)$/i, '');
}

function cleanSingleTitleLine(rawLine: string): {
  title: string;
  year: number | null;
  hasExplicitLabel: boolean;
} {
  let text = stripFileExtension(String(rawLine || '').trim());

  // Strip emojis, stars, arrows, bullets, and decorative Unicode symbols (including NFKD bold/italic fonts)
  text = stripDecorativeSymbols(text);

  // Remove URLs, #hashtags, and @channel mentions WITHOUT swallowing underscore-separated movie titles (e.g. @Channel_Movie_Name)
  text = text.replace(/https?:\/\/\S+/gi, ' ');
  text = text.replace(/t\.me\/\S+/gi, ' ');
  text = text.replace(/(?:^|\s)@[a-zA-Z0-9]{2,}(?=[_\s\-.:|]|$)/g, ' ');
  text = text.replace(/@[a-zA-Z0-9_]{3,}(?=\s|$)/g, ' ');
  text = text.replace(/(?:^|\s)#[^\s]+/g, ' ');

  // Remove size tokens like 1.4GB, 850 MB
  text = text.replace(/\b\d+(?:\.\d+)?\s*(?:gb|mb|kb)\b/gi, ' ');

  // Replace dots/underscores/pipes used as separators with spaces
  text = text.replace(/[._|]+/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  // Strip leading channel/ripper prefixes like "TG :", "DVDWOALL -", "M4UHD -"
  text = text
    .replace(/^(?:tg|dvdwoall|m4uhd|kmmovies|moviesmod|vegamovies|hdhub4u|rd)\s*[:\-–—]+\s*/i, '')
    .trim();

  // Check and remove leading label prefixes like "Movie Name:", "Series Name:", "Title:", "Name:"
  let hasExplicitLabel = false;
  const labelMatch = text.match(EXPLICIT_TITLE_LABEL_RE);
  if (labelMatch) {
    hasExplicitLabel = true;
    text = labelMatch[1].trim();
  }

  // Cut off inline trailing metadata (e.g. "Pushpa 2 (2024) Rating: 8.5 Audio: Hindi")
  const inlineMetaMatch = text.match(INLINE_META_CUTOFF_RE);
  if (inlineMetaMatch && typeof inlineMetaMatch.index === 'number' && inlineMetaMatch.index > 1) {
    text = text.slice(0, inlineMetaMatch.index).trim();
  }

  // Remove bracketed site tags at start like [MoviesMod]
  text = text.replace(/^\[[^\]]{2,40}\]\s*/g, '').trim();

  // Extract valid release year (1940 .. currentYear) and trim trailing release tags after the year
  const maxValidYear = new Date().getFullYear();
  let detectedYear: number | null = null;
  let yearIndex = -1;

  // Prefer bracketed year first e.g. (2024) or [2024]
  const bracketYears = Array.from(text.matchAll(/[\[(]\s*((?:19|20)\d{2})\s*[\])]/g));
  for (const m of bracketYears) {
    const yr = parseInt(m[1], 10);
    if (yr >= 1940 && yr <= maxValidYear) {
      detectedYear = yr;
      const idx = m.index ?? -1;
      yearIndex = idx;
      if (idx > 1) {
        text = text.slice(0, idx).trim();
      } else if (idx >= 0) {
        // Leading year e.g. "(2024) Pushpa 2"
        text = `${text.slice(0, idx)} ${text.slice(idx + m[0].length)}`.trim();
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

  // Cut at the earliest series marker (S01E01 / Season 1 / Ep 01 / E01) if after the show title
  const seriesCut = text.match(SERIES_CUTOFF_RE);
  if (seriesCut && typeof seriesCut.index === 'number' && seriesCut.index > 1) {
    text = text.slice(0, seriesCut.index);
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

  // Strip lingering empty brackets / trailing punctuation / movie filler words
  text = text
    .replace(/[\[(]\s*[\])]/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*(?:dubbed|hindi|english|tamil|telugu|dual|audio|esub|480p|720p|1080p|4k|rip|cam)[^)]*\)/gi, ' ')
    .replace(/\b(?:full\s+movie|hindi\s+movie|south\s+movie|english\s+movie|new\s+movie|bollywood\s+movie|hollywood\s+movie|bollywood|hollywood|web\s+series|complete\s+series|complete\s+season|all\s+episodes|watch\s+online|free\s+download|download\s+now)\b/gi, ' ')
    .replace(/^[\s\-–—:;,./\\]+|[\s\-–—:;,./\\]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  void yearIndex;
  return { title: text, year: detectedYear, hasExplicitLabel };
}

function parseSeriesSeasonEpisode(rawText: string): {
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeLabel: string;
  episodeTitle: string;
} {
  const norm = String(rawText || '').replace(/[._]+/g, ' ');
  let seasonNumber: number | null = null;
  let episodeNumber: number | null = null;
  let episodeLabel = '';

  const seRange = norm.match(/\bS0*(\d{1,2})\s*[-–—]?\s*E0*(\d{1,4})\s*[-–—]\s*E?0*(\d{1,4})\b/i);
  const seSingle = norm.match(/\bS0*(\d{1,2})\s*[-–—]?\s*E0*(\d{1,4})\b/i);
  const xMatch = norm.match(/\b0*(\d{1,2})x0*(\d{1,4})\b/i);
  const seasonWord = norm.match(/\b(?:Season|S)\s*0*(\d{1,2})\b/i);
  const epRange = norm.match(/\b(?:Episodes?|Eps?)\s*[:\-]?\s*0*(\d{1,4})\s*(?:-|–|to)\s*0*(\d{1,4})\b/i);
  const epWord = norm.match(/\b(?:Episode|Ep)\s*[:\-]?\s*0*(\d{1,4})\b/i);
  const standaloneEpRange = norm.match(/(?:^|[\s\-\[(])E0*(\d{1,3})\s*[-–—]\s*E?0*(\d{1,3})(?:$|[\s\-\])])/i);
  const standaloneEpSingle = norm.match(/(?:^|[\s\-\[(])E0*(\d{1,3})(?:$|[\s\-\])])/i);

  if (seRange) {
    seasonNumber = parseInt(seRange[1], 10);
    const eStart = parseInt(seRange[2], 10);
    const eEnd = parseInt(seRange[3], 10);
    episodeNumber = eStart;
    if (eEnd > eStart) episodeLabel = `${eStart}-${eEnd}`;
  } else if (seSingle) {
    seasonNumber = parseInt(seSingle[1], 10);
    episodeNumber = parseInt(seSingle[2], 10);
  } else if (xMatch) {
    seasonNumber = parseInt(xMatch[1], 10);
    episodeNumber = parseInt(xMatch[2], 10);
  } else {
    if (seasonWord) seasonNumber = parseInt(seasonWord[1], 10);
    if (epRange) {
      const eStart = parseInt(epRange[1], 10);
      const eEnd = parseInt(epRange[2], 10);
      episodeNumber = eStart;
      if (eEnd > eStart) episodeLabel = `${eStart}-${eEnd}`;
    } else if (epWord) {
      episodeNumber = parseInt(epWord[1], 10);
    } else if (standaloneEpRange) {
      const eStart = parseInt(standaloneEpRange[1], 10);
      const eEnd = parseInt(standaloneEpRange[2], 10);
      episodeNumber = eStart;
      if (eEnd > eStart) episodeLabel = `${eStart}-${eEnd}`;
    } else if (standaloneEpSingle) {
      episodeNumber = parseInt(standaloneEpSingle[1], 10);
    }
  }

  if (episodeNumber !== null && seasonNumber === null) {
    seasonNumber = 1;
  }

  const episodeTitle =
    episodeLabel
      ? `Episodes ${episodeLabel}`
      : episodeNumber !== null
      ? `Episode ${episodeNumber}`
      : '';

  return { seasonNumber, episodeNumber, episodeLabel, episodeTitle };
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

const ONLY_LANG_QUALITY_TOKENS_RE =
  /^(?:hindi|english|tamil|telugu|malayalam|kannada|punjabi|bengali|marathi|gujarati|bhojpuri|odia|japanese|korean|chinese|spanish|french|dual|multi|audio|dubbed|subbed|org|original|esub|esubs|msub|480p|720p|1080p|2160p|4k|uhd|fhd|hd|webrip|webdl|hdrip|bluray|hevc|x264|x265|10bit|and|\s|,|\.|\/|-)+$/i;

function looksGenericTelegramName(name: string): boolean {
  const clean = normalizeTitleKey(name);
  if (!clean || clean.length < 2) return true;
  if (ONLY_LANG_QUALITY_TOKENS_RE.test(clean)) return true;
  return /^(?:vid|video|img|document|doc|file|movie|telegram|tg|episode|msg|mp4|mkv|year|title|name|unknown)\s*\d*$/i.test(clean);
}

export function parseTelegramMovieMeta(
  fileName: string,
  caption: string,
  width = 0,
  height = 0,
  durationSec = 0,
  sizeBytes = 0
): ParsedTelegramMovieMeta {
  const rawLines = String(caption || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Extract explicit "Year: 2024" / "Release Year: 2024" / IMDb / Season-Episode lines before discarding noisy body text
  const maxValidYear = new Date().getFullYear();
  let explicitCaptionYear: number | null = null;
  let explicitImdbId: string | null = null;
  const seasonEpisodeLines: string[] = [];

  for (const rawLine of rawLines) {
    const plain = stripDecorativeSymbols(rawLine);
    if (!plain) continue;

    if (!explicitCaptionYear) {
      const yMatch = plain.match(EXPLICIT_YEAR_LINE_RE);
      if (yMatch) {
        const yr = parseInt(yMatch[1], 10);
        if (yr >= 1940 && yr <= maxValidYear) explicitCaptionYear = yr;
      }
    }

    if (!explicitImdbId && (EXPLICIT_TITLE_LABEL_RE.test(plain) || /^imdb\b/i.test(plain))) {
      const im = plain.match(/\b(tt\d{6,10})\b/i);
      if (im) explicitImdbId = im[1].toLowerCase();
    }

    if (/^(?:season|episode|ep)\s*[:\-–—=]/i.test(plain)) {
      seasonEpisodeLines.push(plain);
    }
  }

  if (!explicitImdbId && fileName) {
    const im = fileName.match(/\b(tt\d{6,10})\b/i);
    if (im) explicitImdbId = im[1].toLowerCase();
  }

  // Detect samples / promos / tiny <60s clips
  const isSampleOrClip =
    /\b(?:sample|trailer|teaser|promo|intro[\s._-]*clip)\b/i.test(fileName || '') ||
    (durationSec > 0 && durationSec < 60 && sizeBytes > 0 && sizeBytes < 5 * 1024 * 1024);

  // Pick ONLY the cleanest Movie/Series title line from caption OR filename, ignoring all extra caption text
  const captionLines = rawLines.filter((l) => {
    const plain = stripDecorativeSymbols(l);
    if (!plain || plain.length < 2) return false;
    if (/^[\s\-_=*~.,:;!?/\\|]+$/.test(plain)) return false;
    if (/^(?:#[^\s]+\s*)+$/.test(plain)) return false;
    if (PROMO_LINE_RE.test(plain) || /^(?:join|http|@|visit|follow|share|download|click)/i.test(plain)) return false;
    if (NON_TITLE_META_LINE_RE.test(plain)) return false;
    if (ONLY_LANG_QUALITY_TOKENS_RE.test(plain)) return false;
    // Pure standalone year line (handled via adjacentYearLine)
    if (/^[\[(]?\s*(?:19|20)\d{2}\s*[\])]?$/.test(plain)) return false;
    // Ignore long descriptive/plot sentences unless explicitly prefixed with Movie/Series Name
    if (
      !EXPLICIT_TITLE_LABEL_RE.test(plain) &&
      (plain.length > 85 || plain.split(/\s+/).length > 12) &&
      !/^\s*.{2,45}[\[(]\s*(?:19|20)\d{2}\s*[\])]/.test(plain)
    ) {
      return false;
    }
    return true;
  });

  const candidates: Array<{
    title: string;
    year: number | null;
    hasExplicitLabel: boolean;
    fromCaption: boolean;
    lineIdx: number;
    rawLine: string;
  }> = [];

  for (let i = 0; i < Math.min(captionLines.length, 6); i++) {
    const parsedLine = cleanSingleTitleLine(captionLines[i]);
    if (parsedLine.title && !looksGenericTelegramName(parsedLine.title)) {
      candidates.push({
        title: parsedLine.title,
        year: parsedLine.year,
        hasExplicitLabel: parsedLine.hasExplicitLabel,
        fromCaption: true,
        lineIdx: i,
        rawLine: captionLines[i],
      });
    }
  }

  const parsedFile = cleanSingleTitleLine(fileName || '');
  if (parsedFile.title) {
    candidates.push({
      title: parsedFile.title,
      year: parsedFile.year,
      hasExplicitLabel: parsedFile.hasExplicitLabel,
      fromCaption: false,
      lineIdx: 99,
      rawLine: fileName || '',
    });
  }

  // Prefer explicit title labels and clean non-generic Movie/Series Name + Year lines
  candidates.sort((a, b) => {
    const scoreCand = (c: typeof a) => {
      let s = 0;
      if (looksGenericTelegramName(c.title)) s -= 100;
      if (c.hasExplicitLabel) s += 45;
      if (c.year) s += 25;
      if (c.title.length >= 2 && c.title.length <= 65) s += 14;
      else if (c.title.length > 85) s -= 30;
      if (c.fromCaption) s += Math.max(2, 12 - c.lineIdx * 2);
      return s;
    };
    return scoreCand(b) - scoreCand(a);
  });

  const best = candidates[0] || { title: '', year: null, rawLine: '' };

  // Check if line immediately following a caption title is just a standalone year like "2024" or "(2024)"
  let adjacentYear: number | null = null;
  if (rawLines.length >= 2) {
    const secondPlain = stripDecorativeSymbols(rawLines[1]);
    const adjMatch = secondPlain.match(/^[\[(]?\s*((?:19|20)\d{2})\s*[\])]?$/);
    if (adjMatch) {
      const yr = parseInt(adjMatch[1], 10);
      if (yr >= 1940 && yr <= maxValidYear) adjacentYear = yr;
    }
  }

  // Only accept year from the winning title line, explicit Year label, adjacent year line, or filename (NEVER random promo/prose lines)
  const fallbackYear = best.year || explicitCaptionYear || adjacentYear || parsedFile.year || null;

  // Scan ONLY focused sources (winning title line + explicit Season/Episode lines + filename) so extra caption text never pollutes S/E, quality, or language
  const focusedMetaText = [best.rawLine, ...seasonEpisodeLines, fileName || '']
    .filter(Boolean)
    .join('\n');

  const isSeriesEpisode = SERIES_EP_RE.test(focusedMetaText);
  const quality = detectQualityTag(focusedMetaText, width, height);
  const { languageHint, isHindiDubbed } = detectLanguageHint(focusedMetaText);
  const epDetails = parseSeriesSeasonEpisode(focusedMetaText);
  const finalIsSeries = isSeriesEpisode || epDetails.episodeNumber !== null;

  const cleanTitle = best.title || stripFileExtension(fileName || '').replace(/[._-]+/g, ' ').trim();
  const normalizedGroupTitle = normalizeTitleKey(cleanTitle).replace(/\s+/g, '');
  const groupKey = finalIsSeries && normalizedGroupTitle
    ? `${normalizedGroupTitle}-s${epDetails.seasonNumber || 1}-e${epDetails.episodeNumber || 0}${epDetails.episodeLabel ? `-${epDetails.episodeLabel}` : ''}`
    : explicitImdbId
    ? `imdb-${explicitImdbId}`
    : normalizedGroupTitle
    ? `${normalizedGroupTitle}${fallbackYear ? `-${fallbackYear}` : ''}`
    : '';

  const isHollywoodPrint = isHollywoodPrintText(`${caption || ''}\n${fileName || ''}`);

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
    isSeriesEpisode: finalIsSeries,
    seasonNumber: epDetails.seasonNumber,
    episodeNumber: epDetails.episodeNumber,
    episodeLabel: epDetails.episodeLabel,
    episodeTitle: epDetails.episodeTitle,
    isSampleOrClip,
    isHollywoodPrint,
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
  const typeLower = String(candidate.type || 'movie').toLowerCase();
  if (parsed.year && Number.isFinite(candYearNum)) {
    const diff = Math.abs(candYearNum - parsed.year);
    if (diff === 0) {
      score += 45;
    } else if (diff === 1) {
      score += 20;
    } else if (
      parsed.isSeriesEpisode &&
      typeLower === 'series' &&
      candYearNum <= parsed.year &&
      parsed.year - candYearNum <= 15
    ) {
      // Multi-season series (e.g. Mirzapur started 2018, Season 3 uploaded with 2024)
      score += 25;
    } else if (diff === 2) {
      score += 0;
    } else {
      score -= 35;
    }
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
  if (typeLower === 'game') {
    score -= 70;
  } else if (!parsed.isSeriesEpisode) {
    if (typeLower === 'movie') score += 12;
    else if (typeLower === 'series') score -= 12;
  } else {
    if (typeLower === 'series') score += 22;
    else if (typeLower === 'movie') score -= 14;
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
  const currentYear = new Date().getFullYear();
  const fallbackYear =
    parsed.year && parsed.year <= currentYear ? parsed.year : currentYear;

  // 1. Direct IMDb ID in Telegram caption/filename
  if (parsed.explicitImdbId) {
    const detail = await fetchMetadataDetailInternal(parsed.explicitImdbId);
    if (detail.status === 'ok' && detail.data) {
      const d = detail.data;
      const poster = upgradePosterUrl(d.posterUrl, 1080) || d.posterUrl || '';
      const backdrop = upgradePosterUrl(d.backdropUrl || poster, 1280) || poster;
      const rawYear = Number(d.releaseYear) || fallbackYear;
      const clampedYear = rawYear > currentYear ? fallbackYear : rawYear;
      return {
        imdbId: d.imdbId || parsed.explicitImdbId,
        title: d.title || parsed.cleanTitle,
        originalTitle: d.originalTitle || d.title || parsed.cleanTitle,
        releaseYear: clampedYear,
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
    // For multi-season series, bare series name finds the IMDb series entry even if caption carries a later season year
    if (parsed.isSeriesEpisode) {
      queriesToTry.push(parsed.cleanTitle);
      if (parsed.year) queriesToTry.push(`${parsed.cleanTitle} ${parsed.year}`);
    } else {
      if (parsed.year) queriesToTry.push(`${parsed.cleanTitle} ${parsed.year}`);
      queriesToTry.push(parsed.cleanTitle);
    }

    // Strip subtitle after ":" or "-" as fallback (e.g. "Pushpa 2: The Rule" -> "Pushpa 2")
    const strippedSub = parsed.cleanTitle.split(/\s*[:\-–]\s*/)[0]?.trim();
    if (strippedSub && strippedSub.length >= 3 && strippedSub.toLowerCase() !== parsed.cleanTitle.toLowerCase()) {
      queriesToTry.push(parsed.year && !parsed.isSeriesEpisode ? `${strippedSub} ${parsed.year}` : strippedSub);
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

  const candYearParsed = parseInt(String(winner.cand.year || '').slice(0, 4), 10);
  const detailYearParsed = Number(d?.releaseYear || 0);
  const rawFinalYear =
    detailYearParsed > 0 && detailYearParsed <= currentYear
      ? detailYearParsed
      : Number.isFinite(candYearParsed) && candYearParsed >= 1900 && candYearParsed <= currentYear
      ? candYearParsed
      : fallbackYear;
  const finalYear = rawFinalYear > currentYear ? fallbackYear : rawFinalYear;
  const rawSim = getTitleSimilarityScore(d?.title || winner.cand.title, parsed.cleanTitle);
  const winnerType = String(winner.cand.type || '').toLowerCase();
  const isSeriesYearMatch =
    parsed.isSeriesEpisode &&
    winnerType === 'series' &&
    Boolean(parsed.year && finalYear <= parsed.year && parsed.year - finalYear <= 15);
  const yearMatched = Boolean(
    (parsed.year && Math.abs(finalYear - parsed.year) <= 1) || isSeriesYearMatch
  );
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
