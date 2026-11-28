import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { guardedFirestoreWrite, isFirestoreWriteAllowed } from './firestoreQuotaService';
import {
  MovieData,
  broadcastDirectMovieUpsert,
  getLocalMovies,
  isMovieDeleted,
  saveMovieLocally,
  touchCatalogSyncMarker,
} from './movieStorage';
import {
  BrowserTelegramScannedMessage,
  fetchBrowserTelegramMessagesByIds,
  getBrowserTelegramClient,
} from '../utils/browserTelegramStream';
import {
  AutoMatchedCandidateSummary,
  ParsedTelegramMovieMeta,
  getTitleSimilarityScore,
  looksGenericTelegramName,
  mergeFinalLanguage,
  normalizeTitleKey,
  parseTelegramMovieMeta,
  scoreImdbCandidate,
} from '../utils/telegramTitleParser';
import { upgradePosterUrl } from '../utils/posterUrl';
import {
  getQualityUpgradeDecision,
  isHollywoodPrintMovie,
  isHollywoodPrintText,
  normalizeQualityBadge,
} from '../utils/qualityBadge';
import { getDisplayCategory } from '../utils/categoryMapping';
import { formatClockTime, parseDurationToSeconds } from '../utils/duration';
import {
  hasPlayableContent,
  mergeEpisodeIntoSeasons,
  normalizeSeriesSeasons,
} from '../utils/seriesCompleteness';
import {
  MetadataDetailData,
  fetchWikipediaFilmDetail,
  mergeImdbAndWikiResults,
  searchWikipediaFilmSuggestions,
} from '../utils/wikipediaMetadata';

const DEFAULT_CHANNEL_ID = '4451036277';
const FLOOR_START_MSG_ID = 4123;
const PROBE_WINDOW_SIZE = 50;
const MAX_PAGES_PER_PASS = 4;
const CURSOR_STORAGE_PREFIX = 'mp_direct_tg_cursor_v1_';
const MIN_SCAN_GAP_MS = 1200;
const FIRESTORE_CURSOR_CACHE_MS = 10000;

let activeSyncPromise: Promise<{ addedCount: number; updatedCount: number }> | null = null;
let lastScanStartedAt = 0;
let queuedPushRescan: { hintMsgId?: number } | null = null;
let cachedFirestoreCursor: { value: number; channelId: string; fetchedAt: number } | null = null;
const rejectedNonMediaUrls = new Set<string>();

function getLocalCursor(channelId: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(`${CURSOR_STORAGE_PREFIX}${channelId}`);
    const parsed = parseInt(String(raw || '0'), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function saveLocalCursor(channelId: string, msgId: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(msgId) || msgId <= 0) return;
  try {
    const prev = getLocalCursor(channelId);
    if (msgId > prev) {
      window.localStorage.setItem(`${CURSOR_STORAGE_PREFIX}${channelId}`, String(msgId));
    }
  } catch {}
}

function extractTelegramMsgId(url?: string | null, expectedChannelId?: string): number {
  const s = String(url || '').trim();
  if (!s) return 0;
  const m = s.match(/t\.me\/c\/(\d+)\/(\d+)/i);
  if (!m) return 0;
  if (expectedChannelId && m[1] !== expectedChannelId) return 0;
  const num = parseInt(m[2], 10);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function collectCatalogUrlsAndMaxMsgId(
  movies: MovieData[],
  channelId: string
): { urls: Set<string>; maxMsgId: number } {
  const urls = new Set<string>(rejectedNonMediaUrls);
  let maxMsgId = 0;

  const inspectUrl = (raw?: string | null) => {
    const u = String(raw || '').trim();
    if (!u) return;
    urls.add(u.toLowerCase());
    const id = extractTelegramMsgId(u, channelId);
    if (id > maxMsgId) maxMsgId = id;
  };

  for (const m of movies) {
    if (!m) continue;
    if (m.telegramChannelId === channelId || !m.telegramChannelId) {
      const topId = Number(m.telegramMsgId || 0);
      if (Number.isFinite(topId) && topId > maxMsgId) maxMsgId = topId;
      if (Array.isArray(m.sourceMsgIds)) {
        for (const sid of m.sourceMsgIds) {
          const n = Number(sid || 0);
          if (Number.isFinite(n) && n > maxMsgId) maxMsgId = n;
        }
      }
    }
    inspectUrl(m.streamingUrl);
    if (m.videoQualities && typeof m.videoQualities === 'object') {
      Object.values(m.videoQualities).forEach((u) => inspectUrl(u));
    }
    if (Array.isArray(m.seasons)) {
      for (const s of m.seasons) {
        if (!Array.isArray(s?.episodes)) continue;
        for (const ep of s.episodes) {
          inspectUrl(ep?.streamUrl);
          if (ep?.videoQualities && typeof ep.videoQualities === 'object') {
            Object.values(ep.videoQualities).forEach((u) => inspectUrl(u));
          }
        }
      }
    }
  }

  return { urls, maxMsgId };
}

async function readRemoteCursorConfig(): Promise<{ channelId: string; cursor: number }> {
  const now = Date.now();
  if (
    cachedFirestoreCursor &&
    now - cachedFirestoreCursor.fetchedAt < FIRESTORE_CURSOR_CACHE_MS
  ) {
    return {
      channelId: cachedFirestoreCursor.channelId,
      cursor: cachedFirestoreCursor.value,
    };
  }

  let channelId = DEFAULT_CHANNEL_ID;
  let cursor = 0;

  try {
    const ref = doc(db, 'app_config', 'telegram_auto_sync');
    let snap;
    try {
      snap = await getDocFromServer(ref);
    } catch {
      snap = await getDoc(ref);
    }
    if (snap && snap.exists()) {
      const data = snap.data() || {};
      const urlMatch = String(data.channelUrl || '').match(/t\.me\/c\/(\d+)/i);
      const rawCh = String(data.channelId || urlMatch?.[1] || '').replace(/^-100/, '').trim();
      if (/^\d+$/.test(rawCh)) {
        channelId = rawCh;
      }
      const candidates = [
        Number(data.lastSyncedMsgId || 0),
        Number(data.lastScannedMsgId || 0),
        Number(data.scannedMaxMsgId || 0),
        Number(data.lastMsgId || 0),
      ];
      cursor = Math.max(0, ...candidates.filter((n) => Number.isFinite(n) && n > 0));
    }
  } catch {}

  cachedFirestoreCursor = { value: cursor, channelId, fetchedAt: now };
  return { channelId, cursor };
}

async function persistRemoteCursor(channelId: string, msgId: number): Promise<void> {
  if (!Number.isFinite(msgId) || msgId <= 0) return;
  saveLocalCursor(channelId, msgId);
  if (cachedFirestoreCursor && cachedFirestoreCursor.channelId === channelId) {
    cachedFirestoreCursor = {
      channelId,
      value: Math.max(cachedFirestoreCursor.value, msgId),
      fetchedAt: Date.now(),
    };
  }
  if (!isFirestoreWriteAllowed()) return;
  await guardedFirestoreWrite(() =>
    setDoc(
      doc(db, 'app_config', 'telegram_auto_sync'),
      {
        channelId,
        lastSyncedMsgId: msgId,
        lastScannedMsgId: msgId,
        scannedMaxMsgId: msgId,
        updatedAt: Date.now(),
        updatedAtMs: Date.now(),
      },
      { merge: true }
    )
  ).catch(() => {});
}

function clampReleaseYear(val: any): number {
  const currentYear = new Date().getFullYear();
  const y = parseInt(String(val || '').slice(0, 4), 10);
  if (Number.isFinite(y) && y >= 1900) {
    return y > currentYear ? currentYear : y;
  }
  return currentYear;
}

function formatDurationShort(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const rounded = Math.round(sec);
  if (rounded < 3600) {
    const mins = Math.floor(rounded / 60);
    const secs = rounded % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return formatClockTime(rounded);
}

function buildFallbackPosterDataUri(title: string, year?: number | string | null): string {
  const safeTitle = String(title || 'Movie Hub')
    .replace(/[<>&"']/g, ' ')
    .trim()
    .slice(0, 34);
  const safeYear = String(year || '').replace(/[^0-9]/g, '').slice(0, 4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#111827"/><stop offset="55%" stop-color="#0f172a"/><stop offset="100%" stop-color="#064e3b"/></linearGradient></defs><rect width="600" height="900" fill="url(#bg)"/><circle cx="300" cy="360" r="88" fill="#10b981" opacity="0.16"/><polygon points="275,320 275,400 345,360" fill="#10b981"/><text x="300" y="545" text-anchor="middle" fill="#f9fafb" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="700">${safeTitle}</text>${safeYear ? `<text x="300" y="605" text-anchor="middle" fill="#34d399" font-family="system-ui,-apple-system,sans-serif" font-size="26" font-weight="600">${safeYear}</text>` : ''}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function fetchJsonSafe(url: string, timeoutMs = 3000): Promise<any> {
  if (typeof fetch !== 'function' || !url) return null;
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchImdbSuggestionsClient(query: string): Promise<AutoMatchedCandidateSummary[]> {
  try {
    const clean = query.toLowerCase().trim();
    if (!clean) return [];
    const firstChar = clean.charAt(0).replace(/[^a-z]/g, 'a') || 'a';
    const slug = clean.replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    if (!slug) return [];

    const urls = [
      `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(slug)}.json`,
      `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(slug)}.json`,
    ];

    for (const url of urls) {
      const json = await fetchJsonSafe(url, 5000);
      if (json && Array.isArray(json.d) && json.d.length > 0) {
        const currentYear = new Date().getFullYear();
        return json.d
          .filter((item: any) => item?.id && String(item.id).startsWith('tt'))
          .map((item: any) => {
            const q = String(item.q || '').toLowerCase();
            let itemType = 'movie';
            if (q.includes('series') || q.includes('tv') || q.includes('miniseries')) {
              itemType = 'series';
            } else if (q.includes('video game')) {
              itemType = 'game';
            }
            const rawY = Number(item.y);
            const safeYear =
              Number.isFinite(rawY) && rawY >= 1900 ? Math.min(rawY, currentYear) : item.y || 'N/A';
            return {
              imdbId: item.id,
              title: item.l,
              year: safeYear,
              type: itemType,
              posterUrl: upgradePosterUrl(item.i?.imageUrl || '', 1080),
              cast: item.s || '',
            };
          });
      }
    }
    return [];
  } catch {
    return [];
  }
}

async function searchMetadataClient(rawQuery: string): Promise<AutoMatchedCandidateSummary[]> {
  const q = rawQuery.trim();
  if (!q) return [];
  const yearMatch = q.match(/\(?((?:19|20)\d{2})\)?/);
  const year = yearMatch ? yearMatch[1] : null;
  const cleanTitle = (yearMatch ? q.replace(yearMatch[0], '').trim() : q) || q;

  let omdbUrl = `https://www.omdbapi.com/?apikey=trilogy&s=${encodeURIComponent(cleanTitle)}`;
  if (year) omdbUrl += `&y=${encodeURIComponent(year)}`;

  const [imdbRes, omdbData, wikiRes] = await Promise.all([
    fetchImdbSuggestionsClient(q),
    fetchJsonSafe(omdbUrl, 5000),
    searchWikipediaFilmSuggestions(q).catch(() => []),
  ]);

  const combined: AutoMatchedCandidateSummary[] = [];
  const seen = new Set<string>();
  for (const item of imdbRes) {
    if (item.imdbId && !seen.has(item.imdbId)) {
      seen.add(item.imdbId);
      combined.push(item);
    }
  }
  if (omdbData && omdbData.Response === 'True' && Array.isArray(omdbData.Search)) {
    for (const item of omdbData.Search) {
      if (item.imdbID && !seen.has(item.imdbID)) {
        seen.add(item.imdbID);
        combined.push({
          imdbId: item.imdbID,
          title: item.Title,
          year: clampReleaseYear(item.Year),
          type: item.Type || 'movie',
          posterUrl: upgradePosterUrl(item.Poster && item.Poster !== 'N/A' ? item.Poster : '', 1080),
        });
      }
    }
  }

  const merged = mergeImdbAndWikiResults(q, combined, wikiRes);
  if (merged.length > 0) return merged;
  if (year && cleanTitle) {
    return fetchImdbSuggestionsClient(cleanTitle);
  }
  return [];
}

async function fetchMetadataDetailClient(rawId?: string, rawTitle?: string): Promise<MetadataDetailData | null> {
  const id = String(rawId || '').trim();
  const titleParam = String(rawTitle || '').trim();
  if (!id && !titleParam) return null;

  if (/^wiki-\d+$/i.test(id)) {
    return fetchWikipediaFilmDetail(id).catch(() => null);
  }

  const cleanImdb = id.match(/(tt\d+)/i)?.[1]?.toLowerCase() || '';
  const omdbUrl = cleanImdb
    ? `https://www.omdbapi.com/?apikey=trilogy&i=${encodeURIComponent(cleanImdb)}&plot=full`
    : `https://www.omdbapi.com/?apikey=trilogy&t=${encodeURIComponent(titleParam)}&plot=full`;

  const lookupKey = cleanImdb || titleParam;
  const [data, imdbSuggestions] = await Promise.all([
    fetchJsonSafe(omdbUrl, 5500),
    lookupKey ? fetchImdbSuggestionsClient(lookupKey) : Promise.resolve([]),
  ]);

  const imdbHit = cleanImdb
    ? imdbSuggestions.find((x) => x.imdbId.toLowerCase() === cleanImdb) || imdbSuggestions[0]
    : imdbSuggestions[0];

  if (data && data.Response === 'True') {
    const genre = data.Genre && data.Genre !== 'N/A' ? data.Genre : 'Action';
    const lang = data.Language && data.Language !== 'N/A' ? data.Language : 'Hindi';
    const country = data.Country && data.Country !== 'N/A' ? data.Country : '';

    const isAnime =
      genre.toLowerCase().includes('animation') &&
      (lang.toLowerCase().includes('japanese') || country.toLowerCase().includes('japan'));
    const isBollywood = country.toLowerCase().includes('india') || lang.toLowerCase().includes('hindi');

    let cat = 'Hollywood Movie';
    if (data.Type === 'series') cat = isAnime ? 'Anime Series' : 'Web Series';
    else if (isAnime) cat = 'Anime Movie';
    else if (isBollywood) cat = 'Bollywood Movie';

    const rawPoster = imdbHit?.posterUrl || (data.Poster && data.Poster !== 'N/A' ? data.Poster : '');
    const posterUrl = upgradePosterUrl(rawPoster, 1080);
    const backdropUrl = upgradePosterUrl(rawPoster, 1280) || posterUrl;

    return {
      imdbId: data.imdbID || cleanImdb,
      title: data.Title || titleParam,
      originalTitle: data.Title || titleParam,
      releaseYear: clampReleaseYear(data.Year || imdbHit?.year),
      posterUrl,
      backdropUrl,
      genre,
      description: data.Plot && data.Plot !== 'N/A' ? data.Plot : '',
      director: data.Director && data.Director !== 'N/A' ? data.Director : '',
      cast: data.Actors && data.Actors !== 'N/A' ? data.Actors : imdbHit?.cast || '',
      runtime: data.Runtime && data.Runtime !== 'N/A' ? data.Runtime : '',
      language: lang,
      rating: parseFloat(data.imdbRating) || 8.0,
      suggestedCategory: cat,
    };
  }

  if (imdbHit) {
    const posterUrl = upgradePosterUrl(imdbHit.posterUrl, 1080);
    const backdropUrl = upgradePosterUrl(imdbHit.posterUrl, 1280) || posterUrl;
    return {
      imdbId: imdbHit.imdbId || cleanImdb,
      title: imdbHit.title || titleParam,
      originalTitle: imdbHit.title || titleParam,
      releaseYear: clampReleaseYear(imdbHit.year),
      posterUrl,
      backdropUrl,
      genre: 'Action',
      description: '',
      director: '',
      cast: imdbHit.cast || '',
      runtime: '',
      language: 'Hindi',
      rating: 8.0,
      suggestedCategory: imdbHit.type === 'series' ? 'Web Series' : 'Bollywood Movie',
    };
  }

  return null;
}

async function resolveClientImdbMatch(parsed: ParsedTelegramMovieMeta): Promise<{
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
}> {
  const currentYear = new Date().getFullYear();
  const fallbackYear = parsed.year && parsed.year <= currentYear ? parsed.year : currentYear;

  if (parsed.explicitImdbId) {
    const d = await fetchMetadataDetailClient(parsed.explicitImdbId);
    if (d) {
      const poster = upgradePosterUrl(d.posterUrl, 1080) || d.posterUrl || '';
      const backdrop = upgradePosterUrl(d.backdropUrl || poster, 1280) || poster;
      return {
        imdbId: d.imdbId || parsed.explicitImdbId,
        title: d.title || parsed.cleanTitle,
        originalTitle: d.originalTitle || d.title || parsed.cleanTitle,
        releaseYear: clampReleaseYear(d.releaseYear || fallbackYear),
        posterUrl: poster,
        backdropUrl: backdrop,
        genre: d.genre || 'Action',
        description: d.description || '',
        director: d.director || '',
        cast: d.cast || '',
        runtime: d.runtime || '',
        language: mergeFinalLanguage(d.language, parsed),
        rating: d.rating || 8.0,
        originalCategory: d.suggestedCategory || (parsed.isSeriesEpisode ? 'Web Series' : 'Bollywood Movie'),
      };
    }
  }

  const queriesToTry: string[] = [];
  if (parsed.cleanTitle && !looksGenericTelegramName(parsed.cleanTitle)) {
    if (parsed.isSeriesEpisode) {
      queriesToTry.push(parsed.cleanTitle);
      if (parsed.year) queriesToTry.push(`${parsed.cleanTitle} ${parsed.year}`);
    } else {
      if (parsed.year) queriesToTry.push(`${parsed.cleanTitle} ${parsed.year}`);
      queriesToTry.push(parsed.cleanTitle);
    }
    const strippedSub = parsed.cleanTitle.split(/\s*[:\-–]\s*/)[0]?.trim();
    if (
      strippedSub &&
      strippedSub.length >= 3 &&
      strippedSub.toLowerCase() !== parsed.cleanTitle.toLowerCase()
    ) {
      queriesToTry.push(
        parsed.year && !parsed.isSeriesEpisode ? `${strippedSub} ${parsed.year}` : strippedSub
      );
    }
  }

  const allCandidates = new Map<string, AutoMatchedCandidateSummary>();
  for (let i = 0; i < queriesToTry.length; i++) {
    const resList = await searchMetadataClient(queriesToTry[i]);
    for (const item of resList) {
      if (item?.imdbId && !allCandidates.has(item.imdbId)) {
        allCandidates.set(item.imdbId, {
          ...item,
          posterUrl: upgradePosterUrl(item.posterUrl, 1080) || item.posterUrl || '',
        });
      }
    }
    if (allCandidates.size > 0 && i === 0) {
      const top = Array.from(allCandidates.values())
        .map((c) => ({ c, s: scoreImdbCandidate(c, parsed) }))
        .sort((a, b) => b.s - a.s)[0];
      if (top && top.s >= 95 && top.c.posterUrl) break;
    }
  }

  const scored = Array.from(allCandidates.values())
    .map((cand) => ({ cand, score: scoreImdbCandidate(cand, parsed) }))
    .sort((a, b) => b.score - a.score);

  const winner = scored[0];
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
    };
  }

  const d = await fetchMetadataDetailClient(winner.cand.imdbId, winner.cand.title);
  const bestPoster =
    upgradePosterUrl(d?.posterUrl || winner.cand.posterUrl, 1080) ||
    d?.posterUrl ||
    winner.cand.posterUrl ||
    '';
  const bestBackdrop = upgradePosterUrl(d?.backdropUrl || bestPoster, 1280) || bestPoster;
  let suggestedCategory =
    d?.suggestedCategory || (parsed.isSeriesEpisode ? 'Web Series' : 'Bollywood Movie');
  if (parsed.isSeriesEpisode && suggestedCategory.toLowerCase().includes('movie')) {
    suggestedCategory = suggestedCategory.toLowerCase().includes('anime')
      ? 'Anime Series'
      : 'Web Series';
  }

  return {
    imdbId: d?.imdbId || winner.cand.imdbId,
    title: d?.title || winner.cand.title,
    originalTitle: d?.originalTitle || d?.title || winner.cand.title,
    releaseYear: clampReleaseYear(d?.releaseYear || winner.cand.year || fallbackYear),
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
  };
}

async function resolveClientImdbMatchWithTimeout(parsed: ParsedTelegramMovieMeta, timeoutMs = 4500) {
  const currentYear = new Date().getFullYear();
  const fallbackYear = parsed.year && parsed.year <= currentYear ? parsed.year : currentYear;
  const fallback = {
    imdbId: parsed.explicitImdbId || '',
    title: parsed.cleanTitle || parsed.rawFileName || 'Untitled Movie',
    originalTitle: parsed.cleanTitle || parsed.rawFileName || 'Untitled Movie',
    releaseYear: fallbackYear,
    posterUrl: '',
    backdropUrl: '',
    genre: parsed.isSeriesEpisode ? 'Drama' : 'Action',
    description: '',
    director: '',
    cast: '',
    runtime: '',
    language: parsed.languageHint || 'Hindi',
    rating: 8.0,
    originalCategory: parsed.isSeriesEpisode ? 'Web Series' : 'Bollywood Movie',
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    resolveClientImdbMatch(parsed).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<typeof fallback>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

function normalizeDupKey(title?: string | null): string {
  return normalizeTitleKey(title || '').replace(/\s+/g, '');
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

function isRecordSeries(m: MovieData): boolean {
  return (
    String(m.id || '').startsWith('tg_series_') ||
    (Array.isArray(m.seasons) && m.seasons.length > 0) ||
    String(m.originalCategory || '').toLowerCase().includes('series') ||
    String(m.displayCategory || '').toLowerCase().includes('series')
  );
}

function findMatchingExistingMovie(
  records: MovieData[],
  imdbId: string,
  titles: Array<string | undefined>,
  year: number,
  isSeries: boolean
): MovieData | null {
  const cleanImdb = String(imdbId || '').trim().toLowerCase();
  if (cleanImdb) {
    const byImdb = records.find((r) => r.imdbId && r.imdbId.toLowerCase() === cleanImdb);
    if (byImdb) return byImdb;
  }

  const candKeys = Array.from(
    new Set(titles.map((t) => normalizeDupKey(t)).filter((k) => k.length >= 2))
  );
  for (const r of records) {
    const rKeys = [normalizeDupKey(r.title), normalizeDupKey(r.originalTitle)].filter(
      (k) => k.length >= 2
    );
    const rSeries = isRecordSeries(r);
    const isExistingPrint = isHollywoodPrintMovie(r);
    for (const ck of candKeys) {
      for (const rk of rKeys) {
        if (ck !== rk) continue;
        if (isSeries || rSeries) return r;
        if (!year || !r.releaseYear || Math.abs(year - r.releaseYear) <= (isExistingPrint ? 2 : 1)) {
          return r;
        }
      }
    }
  }

  for (const r of records) {
    const rSeries = isRecordSeries(r);
    if (rSeries !== isSeries) continue;
    const isExistingPrint = isHollywoodPrintMovie(r);
    if (!isSeries) {
      if (!year || !r.releaseYear) continue;
      if (Math.abs(year - r.releaseYear) > (isExistingPrint ? 2 : 1)) continue;
    }
    const rKeys = [normalizeDupKey(r.title), normalizeDupKey(r.originalTitle)].filter(
      (k) => k.length >= 6
    );
    for (const ck of candKeys) {
      if (ck.length < 6) continue;
      const ckDigit = ck.match(/\d+$/)?.[0] || '';
      for (const rk of rKeys) {
        const rkDigit = rk.match(/\d+$/)?.[0] || '';
        if (ckDigit !== rkDigit || ck[0] !== rk[0]) continue;
        if (Math.abs(ck.length - rk.length) > 2) continue;
        const maxDist = Math.max(1, Math.floor(Math.min(ck.length, rk.length) * 0.16));
        if (levenshtein(ck, rk) <= maxDist) return r;
      }
    }
  }

  return null;
}

interface ScannedCandidate {
  msg: BrowserTelegramScannedMessage;
  streamUrl: string;
  parsed: ParsedTelegramMovieMeta;
}

function buildQualityGroupFromCandidates(members: ScannedCandidate[], fallbackPrimary: ScannedCandidate) {
  const cleanMembers = members.filter(
    (m) => !isHollywoodPrintText(`${m.msg.fileName} ${m.msg.caption}`)
  );
  const effectiveMembers = cleanMembers.length > 0 ? cleanMembers : members;
  const isSampleItem = (m: ScannedCandidate) =>
    /\b(sample|trailer|teaser|promo|preview)\b/i.test(`${m.msg.fileName} ${m.msg.caption}`);
  const maxCleanDurSec = Math.max(
    0,
    ...effectiveMembers.map((m) => (!isSampleItem(m) && m.msg.durationSec > 0 ? m.msg.durationSec : 0))
  );

  const filteredQualities: Record<string, string> = {};
  const qualitySizes: Record<string, number> = {};
  const fullLengthFallback = effectiveMembers.find(
    (m) => maxCleanDurSec < 300 || !m.msg.durationSec || m.msg.durationSec >= maxCleanDurSec * 0.85
  );
  let effectivePrimary = fullLengthFallback || effectiveMembers[0] || fallbackPrimary;

  for (const m of effectiveMembers) {
    if (
      maxCleanDurSec >= 300 &&
      m.msg.durationSec > 0 &&
      m.msg.durationSec < maxCleanDurSec * 0.85
    ) {
      continue;
    }
    if (m.parsed.quality) {
      const prevSz = qualitySizes[m.parsed.quality] || 0;
      if (!filteredQualities[m.parsed.quality] || m.msg.sizeBytes > prevSz) {
        filteredQualities[m.parsed.quality] = m.streamUrl;
        qualitySizes[m.parsed.quality] = m.msg.sizeBytes;
      }
    }
    if (
      (!effectivePrimary.parsed.year && m.parsed.year) ||
      (!effectivePrimary.parsed.explicitImdbId && m.parsed.explicitImdbId) ||
      m.parsed.quality === '1080p'
    ) {
      effectivePrimary = m;
    }
  }

  const bestStream =
    filteredQualities['1080p'] ||
    filteredQualities['4K'] ||
    filteredQualities['720p'] ||
    filteredQualities['480p'] ||
    filteredQualities['360p'] ||
    effectivePrimary.streamUrl;
  const hasHollywoodPrint = cleanMembers.length === 0;
  const qualityBadge: 'HD' | 'HDTC' = hasHollywoodPrint ? 'HDTC' : 'HD';
  const bestDurSec = Math.max(0, ...effectiveMembers.map((m) => m.msg.durationSec || 0));
  const dates = effectiveMembers.map((m) => m.msg.dateMs).filter((d) => d > 0);
  const realMsgDateMs = dates.length > 0 ? Math.min(...dates) : effectivePrimary.msg.dateMs || Date.now();

  return {
    effectivePrimary,
    effectiveMembers,
    filteredQualities,
    bestStream,
    qualityBadge,
    bestDurSec,
    realMsgDateMs,
  };
}

async function fetchLatestFirestoreRecords(): Promise<MovieData[]> {
  try {
    let snap;
    try {
      snap = await getDocsFromServer(collection(db, 'movies'));
    } catch {
      snap = await getDocs(collection(db, 'movies'));
    }
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as MovieData))
      .filter((m) => m && m.id && !isMovieDeleted(m.id, m.title, m.originalTitle) && hasPlayableContent(m));
  } catch {
    return [];
  }
}

export async function runDirectTelegramSyncPass(options?: {
  force?: boolean;
  bypassGap?: boolean;
  hintMsgId?: number;
  currentMovies?: MovieData[];
}): Promise<{ addedCount: number; updatedCount: number }> {
  if (typeof window === 'undefined') return { addedCount: 0, updatedCount: 0 };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { addedCount: 0, updatedCount: 0 };
  }
  if (!options?.force && typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return { addedCount: 0, updatedCount: 0 };
  }
  if (activeSyncPromise) {
    if (options?.hintMsgId) {
      queuedPushRescan = { hintMsgId: options.hintMsgId };
    }
    return activeSyncPromise;
  }

  const now = Date.now();
  if (!options?.bypassGap && !options?.force && now - lastScanStartedAt < MIN_SCAN_GAP_MS) {
    return { addedCount: 0, updatedCount: 0 };
  }
  if (options?.hintMsgId) {
    cachedFirestoreCursor = null;
  }
  lastScanStartedAt = now;

  activeSyncPromise = (async () => {
    let addedCount = 0;
    let updatedCount = 0;

    try {
      const { channelId, cursor: remoteCursor } = await readRemoteCursorConfig();
      const baseMovies =
        options?.currentMovies && options.currentMovies.length > 0
          ? options.currentMovies
          : getLocalMovies();
      const { urls: initialUrlSet, maxMsgId: catalogMaxMsgId } = collectCatalogUrlsAndMaxMsgId(
        baseMovies,
        channelId
      );
      const localCursor = getLocalCursor(channelId);
      let scanCursor = Math.max(FLOOR_START_MSG_ID, remoteCursor, localCursor, catalogMaxMsgId);
      const hintId = Number(options?.hintMsgId || 0);

      const newMessages: BrowserTelegramScannedMessage[] = [];
      const seenMsgIds = new Set<number>();
      let highestVideoMsgId = scanCursor;

      for (let page = 0; page < MAX_PAGES_PER_PASS; page++) {
        const probeSet = new Set<number>();
        for (let i = 1; i <= PROBE_WINDOW_SIZE; i++) {
          probeSet.add(scanCursor + i);
        }
        if (page === 0 && hintId > scanCursor && hintId <= scanCursor + 200) {
          for (let h = Math.max(scanCursor + 1, hintId - 3); h <= hintId + 5; h++) {
            probeSet.add(h);
          }
        }
        const probeIds = Array.from(probeSet).sort((a, b) => a - b);
        const res = await fetchBrowserTelegramMessagesByIds(channelId, probeIds);
        if (!res.peerReachable) break;

        let pageMaxId = scanCursor;
        for (const msg of res.messages) {
          if (msg.msgId > pageMaxId) pageMaxId = msg.msgId;
          if (msg.msgId > highestVideoMsgId) highestVideoMsgId = msg.msgId;
          const url = `https://t.me/c/${channelId}/${msg.msgId}`;
          if (!initialUrlSet.has(url.toLowerCase()) && !seenMsgIds.has(msg.msgId)) {
            seenMsgIds.add(msg.msgId);
            newMessages.push(msg);
          }
        }

        if (res.messages.length === 0) {
          if (res.highestAnyMsgId > scanCursor) {
            scanCursor = res.highestAnyMsgId;
            continue;
          }
          break;
        }
        if (pageMaxId <= scanCursor) {
          break;
        }
        scanCursor = pageMaxId;
      }

      if (newMessages.length === 0) {
        if (highestVideoMsgId > Math.max(localCursor, remoteCursor)) {
          await persistRemoteCursor(channelId, highestVideoMsgId);
        }
        return { addedCount: 0, updatedCount: 0 };
      }

      // Fresh snapshot from Firestore so we never duplicate docs added from Chrome/server/another device
      const remoteRecords = await fetchLatestFirestoreRecords();
      const recordMap = new Map<string, MovieData>();
      baseMovies.forEach((m) => {
        if (m?.id && hasPlayableContent(m)) recordMap.set(m.id, m);
      });
      remoteRecords.forEach((m) => {
        if (m?.id && hasPlayableContent(m)) recordMap.set(m.id, m);
      });
      const existingRecords = Array.from(recordMap.values());
      const { urls: existingUrlSet } = collectCatalogUrlsAndMaxMsgId(existingRecords, channelId);

      const candidates: ScannedCandidate[] = [];
      for (const msg of newMessages) {
        const streamUrl = `https://t.me/c/${channelId}/${msg.msgId}`;
        if (existingUrlSet.has(streamUrl.toLowerCase())) continue;

        const parsed = parseTelegramMovieMeta(
          msg.fileName,
          msg.caption,
          msg.width,
          msg.height,
          msg.durationSec,
          msg.sizeBytes
        );
        if (parsed.isSampleOrClip || !parsed.cleanTitle || looksGenericTelegramName(parsed.cleanTitle)) {
          rejectedNonMediaUrls.add(streamUrl.toLowerCase());
          existingUrlSet.add(streamUrl.toLowerCase());
          continue;
        }
        candidates.push({ msg, streamUrl, parsed });
      }

      if (candidates.length === 0) {
        await persistRemoteCursor(channelId, highestVideoMsgId);
        return { addedCount: 0, updatedCount: 0 };
      }

      interface GroupBucket {
        groupKey: string;
        primary: ScannedCandidate;
        members: ScannedCandidate[];
      }
      const groups: GroupBucket[] = [];
      const groupIdxByKey = new Map<string, number>();

      for (const c of candidates) {
        const gKey = c.parsed.groupKey || `msg-${c.msg.msgId}`;
        const existingIdx = c.parsed.groupKey ? groupIdxByKey.get(gKey) : undefined;
        if (existingIdx !== undefined) {
          groups[existingIdx].members.push(c);
        } else {
          if (c.parsed.groupKey) groupIdxByKey.set(gKey, groups.length);
          groups.push({ groupKey: gKey, primary: c, members: [c] });
        }
      }

      for (const grp of groups) {
        const {
          effectivePrimary,
          effectiveMembers,
          filteredQualities,
          bestStream,
          qualityBadge,
          bestDurSec,
          realMsgDateMs,
        } = buildQualityGroupFromCandidates(grp.members, grp.primary);

        const mergedParsed: ParsedTelegramMovieMeta = {
          ...effectivePrimary.parsed,
          year:
            effectivePrimary.parsed.year ||
            effectiveMembers.find((m) => m.parsed.year)?.parsed.year ||
            null,
          languageHint:
            effectivePrimary.parsed.languageHint ||
            effectiveMembers.find((m) => m.parsed.languageHint)?.parsed.languageHint ||
            '',
          isHindiDubbed: effectiveMembers.some((m) => m.parsed.isHindiDubbed),
        };

        const matched = await resolveClientImdbMatchWithTimeout(mergedParsed, 4500);
        const candYear = Number(matched.releaseYear || mergedParsed.year || 0);
        const isSeriesItem =
          mergedParsed.isSeriesEpisode ||
          String(matched.originalCategory || '').toLowerCase().includes('series');

        const durationFormatted = bestDurSec > 0 ? formatDurationShort(bestDurSec) : '';
        const nowMs = Date.now();
        const itemDateMs = realMsgDateMs > 0 ? realMsgDateMs : nowMs;
        const fallbackSvg = buildFallbackPosterDataUri(
          matched.title || mergedParsed.cleanTitle,
          candYear
        );
        const cleanPoster =
          (matched.posterUrl ? upgradePosterUrl(matched.posterUrl, 1080) || matched.posterUrl : '') ||
          fallbackSvg;
        const cleanBackdrop =
          (matched.backdropUrl || matched.posterUrl
            ? upgradePosterUrl(matched.backdropUrl || cleanPoster, 1280) || cleanPoster
            : '') || fallbackSvg;

        const catToSave = isSeriesItem
          ? String(matched.originalCategory || '').toLowerCase().includes('anime')
            ? 'Anime Series'
            : 'Web Series'
          : matched.originalCategory || 'Bollywood Movie';
        const displayCat = getDisplayCategory(catToSave);
        const badge = normalizeQualityBadge(qualityBadge) === 'HDTC' ? 'HDTC' : 'HD';

        const existingRec = findMatchingExistingMovie(
          existingRecords,
          matched.imdbId,
          [matched.title, matched.originalTitle, mergedParsed.cleanTitle],
          candYear,
          isSeriesItem
        );

        if (isSeriesItem) {
          const seasonNum = Math.max(1, Number(mergedParsed.seasonNumber) || 1);
          const rawEpNum = Number(mergedParsed.episodeNumber);
          const isCompletePackByDur =
            (!Number.isFinite(rawEpNum) || rawEpNum <= 0) &&
            bestDurSec >= 5400 &&
            /\b(?:s\d{1,2}|season|session|complete|combined|full)\b/i.test(
              `${effectivePrimary.msg.fileName} ${effectivePrimary.msg.caption}`
            );

          if (!Number.isFinite(rawEpNum) || rawEpNum <= 0) {
            if (!isCompletePackByDur) {
              grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
              continue;
            }
          }

          const resolvedEpLabel = isCompletePackByDur ? 'Complete' : mergedParsed.episodeLabel;
          const epNum = isCompletePackByDur ? 1 : Math.floor(rawEpNum);
          const epTitle = isCompletePackByDur
            ? 'Complete Season'
            : mergedParsed.episodeTitle || `Episode ${epNum}`;
          const epQuality =
            mergedParsed.quality ||
            (filteredQualities['1080p']
              ? '1080p'
              : filteredQualities['720p']
              ? '720p'
              : filteredQualities['480p']
              ? '480p'
              : '');

          const epObj = {
            episodeNumber: epNum,
            ...(resolvedEpLabel ? { episodeLabel: resolvedEpLabel } : {}),
            title: epTitle,
            streamUrl: bestStream,
            ...(epQuality ? { quality: epQuality } : {}),
            ...(Object.keys(filteredQualities).length > 0 ? { videoQualities: filteredQualities } : {}),
            ...(durationFormatted ? { duration: durationFormatted } : {}),
            ...(bestDurSec > 0 ? { durationSec: bestDurSec } : {}),
            showInNewEpisodes: true,
            newEpisodeEnabledAt: nowMs,
            addedAt: nowMs,
          };

          if (existingRec) {
            const seriesUpgrade = getQualityUpgradeDecision(existingRec, badge);
            if (seriesUpgrade === 'skip_holl_print_on_hd') {
              grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
              continue;
            }
            const replaceExistingEp = seriesUpgrade === 'replace_holl_print_with_hd';
            const { mergedSeasons, added } = mergeEpisodeIntoSeasons(
              existingRec.seasons || [],
              seasonNum,
              epObj,
              replaceExistingEp
            );
            if (!added) {
              grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
              continue;
            }

            const normalizedExisting = normalizeSeriesSeasons({
              ...existingRec,
              originalCategory: catToSave,
              displayCategory: displayCat,
              seasons: mergedSeasons,
              streamingUrl: replaceExistingEp ? epObj.streamUrl : existingRec.streamingUrl,
              published: true,
              qualityBadge: badge === 'HD' ? 'HD' : existingRec.qualityBadge || badge,
              updatedAt: nowMs,
            });

            const prevPoster = String(existingRec.posterUrl || '');
            const existingHasSvgPoster =
              !prevPoster || prevPoster.startsWith('data:image/svg+xml');
            const incomingHasRealPoster = Boolean(
              cleanPoster && !cleanPoster.startsWith('data:image/svg+xml')
            );
            if (existingHasSvgPoster && incomingHasRealPoster) {
              normalizedExisting.posterUrl = cleanPoster;
              normalizedExisting.backdropUrl = cleanBackdrop;
              if (!normalizedExisting.imdbId && matched.imdbId) {
                normalizedExisting.imdbId = matched.imdbId;
              }
              if (!normalizedExisting.description && matched.description) {
                normalizedExisting.description = matched.description;
              }
            }

            Object.assign(existingRec, normalizedExisting);
            saveMovieLocally(normalizedExisting);
            broadcastDirectMovieUpsert(normalizedExisting);
            grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
            updatedCount++;

            if (isFirestoreWriteAllowed()) {
              await guardedFirestoreWrite(() =>
                setDoc(
                  doc(db, 'movies', existingRec.id),
                  {
                    seasons: normalizedExisting.seasons,
                    streamingUrl: normalizedExisting.streamingUrl || epObj.streamUrl,
                    qualityBadge: normalizedExisting.qualityBadge,
                    published: true,
                    ...(existingHasSvgPoster && incomingHasRealPoster
                      ? {
                          posterUrl: normalizedExisting.posterUrl,
                          backdropUrl: normalizedExisting.backdropUrl,
                          ...(normalizedExisting.imdbId ? { imdbId: normalizedExisting.imdbId } : {}),
                          ...(normalizedExisting.description
                            ? { description: normalizedExisting.description }
                            : {}),
                        }
                      : {}),
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true }
                )
              ).catch(() => {});
            }
            await touchCatalogSyncMarker(existingRec.id, 'save').catch(() => {});
            continue;
          }

          const seriesDocId = `tg_series_${channelId}_${effectivePrimary.msg.msgId}`;
          const newSeries: MovieData = normalizeSeriesSeasons({
            id: seriesDocId,
            title: matched.title.trim(),
            originalTitle: (matched.originalTitle || matched.title).trim(),
            description: matched.description.trim(),
            posterUrl: cleanPoster,
            backdropUrl: cleanBackdrop,
            releaseYear: clampReleaseYear(matched.releaseYear),
            originalCategory: catToSave,
            displayCategory: displayCat,
            contentType: catToSave.toLowerCase().includes('anime') ? 'anime' : null,
            language: (matched.language || 'Hindi').trim(),
            genre: (matched.genre || 'Drama').trim(),
            director: (matched.director || '').trim(),
            cast: (matched.cast || '').trim(),
            runtime: durationFormatted || matched.runtime || '',
            rating: Number(matched.rating) || 8.0,
            imdbId: (matched.imdbId || '').trim(),
            trailerUrl: '',
            streamingUrl: epObj.streamUrl,
            videoQualities: {},
            seasons: [{ seasonNumber: seasonNum, episodes: [epObj] }],
            featured: true,
            published: true,
            qualityBadge: badge,
            duration: bestDurSec || parseDurationToSeconds(matched.runtime) || 0,
            telegramMsgId: effectivePrimary.msg.msgId,
            telegramChannelId: channelId,
            telegramDateMs: itemDateMs,
            updatedAt: nowMs,
            createdAt: itemDateMs,
          });

          existingRecords.push(newSeries);
          saveMovieLocally(newSeries);
          broadcastDirectMovieUpsert(newSeries);
          grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
          addedCount++;

          if (isFirestoreWriteAllowed()) {
            await guardedFirestoreWrite(() =>
              setDoc(
                doc(db, 'movies', seriesDocId),
                {
                  ...newSeries,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              )
            ).catch(() => {});
          }
          await touchCatalogSyncMarker(seriesDocId, 'save').catch(() => {});
          continue;
        }

        // Single Movie handling
        if (existingRec) {
          const upgradeDecision = getQualityUpgradeDecision(existingRec, badge);
          if (upgradeDecision === 'skip_holl_print_on_hd') {
            grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
            continue;
          }

          const incomingCleanQualities = Object.fromEntries(
            Object.entries(filteredQualities).filter(([, u]) => Boolean(String(u || '').trim()))
          );
          const prevPoster = String(existingRec.posterUrl || '');
          const existingHasSvgPoster = !prevPoster || prevPoster.startsWith('data:image/svg+xml');
          const incomingHasRealPoster = Boolean(
            cleanPoster && !cleanPoster.startsWith('data:image/svg+xml')
          );

          const posterPatch: Partial<MovieData> =
            existingHasSvgPoster && incomingHasRealPoster
              ? {
                  posterUrl: cleanPoster,
                  backdropUrl: cleanBackdrop,
                  ...(matched.description ? { description: matched.description } : {}),
                  ...(matched.imdbId && !existingRec.imdbId ? { imdbId: matched.imdbId } : {}),
                }
              : !existingRec.imdbId && matched.imdbId
              ? { imdbId: matched.imdbId }
              : {};

          if (upgradeDecision === 'replace_holl_print_with_hd') {
            const replacedStream =
              incomingCleanQualities['1080p'] ||
              incomingCleanQualities['4K'] ||
              incomingCleanQualities['720p'] ||
              incomingCleanQualities['480p'] ||
              bestStream;
            const updatedMovie: MovieData = {
              ...existingRec,
              videoQualities: incomingCleanQualities,
              streamingUrl: replacedStream,
              qualityBadge: 'HD',
              sourceFileName: effectivePrimary.msg.fileName,
              sourceCaption: `${mergedParsed.cleanTitle}${mergedParsed.year ? ` (${mergedParsed.year})` : ''}`,
              telegramMsgId: effectivePrimary.msg.msgId,
              ...(durationFormatted ? { runtime: durationFormatted } : {}),
              ...(bestDurSec > 0 ? { duration: bestDurSec } : {}),
              ...posterPatch,
              published: true,
              updatedAt: nowMs,
            };
            Object.assign(existingRec, updatedMovie);
            saveMovieLocally(updatedMovie);
            broadcastDirectMovieUpsert(updatedMovie);
            grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
            updatedCount++;

            if (isFirestoreWriteAllowed()) {
              await guardedFirestoreWrite(() =>
                setDoc(
                  doc(db, 'movies', existingRec.id),
                  {
                    ...updatedMovie,
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true }
                )
              ).catch(() => {});
            }
            await touchCatalogSyncMarker(existingRec.id, 'save').catch(() => {});
            continue;
          }

          const mergedQualities = { ...(existingRec.videoQualities || {}) };
          let qualityAdded = false;
          for (const [qk, qUrl] of Object.entries(incomingCleanQualities)) {
            if (qUrl && !mergedQualities[qk]) {
              mergedQualities[qk] = qUrl;
              qualityAdded = true;
            }
          }

          if (qualityAdded || Object.keys(posterPatch).length > 0) {
            const upgradedStream =
              mergedQualities['1080p'] ||
              mergedQualities['4K'] ||
              existingRec.streamingUrl ||
              bestStream;
            const upgradedBadge = badge === 'HD' ? 'HD' : existingRec.qualityBadge || badge;
            const updatedMovie: MovieData = {
              ...existingRec,
              ...(qualityAdded
                ? {
                    videoQualities: mergedQualities,
                    streamingUrl: upgradedStream,
                    qualityBadge: upgradedBadge,
                  }
                : {}),
              ...posterPatch,
              published: true,
              updatedAt: nowMs,
            };
            Object.assign(existingRec, updatedMovie);
            saveMovieLocally(updatedMovie);
            broadcastDirectMovieUpsert(updatedMovie);
            updatedCount++;

            if (isFirestoreWriteAllowed()) {
              await guardedFirestoreWrite(() =>
                setDoc(
                  doc(db, 'movies', existingRec.id),
                  {
                    ...(qualityAdded
                      ? {
                          videoQualities: mergedQualities,
                          streamingUrl: upgradedStream,
                          qualityBadge: upgradedBadge,
                        }
                      : {}),
                    ...posterPatch,
                    published: true,
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true }
                )
              ).catch(() => {});
            }
            await touchCatalogSyncMarker(existingRec.id, 'save').catch(() => {});
          }
          grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
          continue;
        }

        const deterministicDocId = `tg_${channelId}_${effectivePrimary.msg.msgId}`;
        const newMovie: MovieData = {
          id: deterministicDocId,
          title: matched.title.trim(),
          originalTitle: (matched.originalTitle || matched.title).trim(),
          description: matched.description.trim(),
          posterUrl: cleanPoster,
          backdropUrl: cleanBackdrop,
          releaseYear: clampReleaseYear(matched.releaseYear),
          originalCategory: catToSave,
          displayCategory: displayCat,
          contentType: catToSave.toLowerCase().includes('anime') ? 'anime' : null,
          language: (matched.language || 'Hindi').trim(),
          genre: (matched.genre || 'Action').trim(),
          director: (matched.director || '').trim(),
          cast: (matched.cast || '').trim(),
          runtime: durationFormatted || matched.runtime || '',
          rating: Number(matched.rating) || 8.0,
          imdbId: (matched.imdbId || '').trim(),
          trailerUrl: '',
          streamingUrl: bestStream,
          videoQualities: filteredQualities,
          seasons: [],
          featured: true,
          published: true,
          qualityBadge: badge,
          sourceFileName: effectivePrimary.msg.fileName,
          sourceCaption: `${mergedParsed.cleanTitle}${mergedParsed.year ? ` (${mergedParsed.year})` : ''}`,
          duration: bestDurSec || parseDurationToSeconds(matched.runtime) || 0,
          telegramMsgId: effectivePrimary.msg.msgId,
          telegramChannelId: channelId,
          telegramDateMs: itemDateMs,
          updatedAt: nowMs,
          createdAt: itemDateMs,
        };

        existingRecords.push(newMovie);
        saveMovieLocally(newMovie);
        broadcastDirectMovieUpsert(newMovie);
        grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
        addedCount++;

        if (isFirestoreWriteAllowed()) {
          await guardedFirestoreWrite(() =>
            setDoc(
              doc(db, 'movies', deterministicDocId),
              {
                ...newMovie,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            )
          ).catch(() => {});
        }
        await touchCatalogSyncMarker(deterministicDocId, 'save').catch(() => {});
      }

      await persistRemoteCursor(channelId, highestVideoMsgId);
      return { addedCount, updatedCount };
    } catch (err) {
      console.warn('[TelegramDirectSync] Pass notice:', err);
      return { addedCount, updatedCount };
    } finally {
      activeSyncPromise = null;
      if (queuedPushRescan) {
        const nextHint = queuedPushRescan.hintMsgId;
        queuedPushRescan = null;
        setTimeout(() => {
          void runDirectTelegramSyncPass({
            force: true,
            bypassGap: true,
            hintMsgId: nextHint,
            currentMovies: options?.currentMovies,
          });
        }, 150);
      }
    }
  })();

  return activeSyncPromise;
}

export function startTelegramDirectSyncLoop(
  getCurrentMovies: () => MovieData[],
  intervalMs = 2500
): () => void {
  if (typeof window === 'undefined') return () => {};

  // Pre-warm MTProto WebSocket client immediately so real-time channel push events arrive in Chrome & APK
  getBrowserTelegramClient().catch(() => {});

  const trigger = (force = false, bypassGap = false, hintMsgId?: number) => {
    void runDirectTelegramSyncPass({
      force,
      bypassGap,
      hintMsgId,
      currentMovies: getCurrentMovies(),
    });
  };

  // Start quickly after mount so missed uploads appear right away
  const bootTimer = setTimeout(() => trigger(true, true), 450);
  const pollTimer = setInterval(() => trigger(false, false), intervalMs);

  const onChannelPush = (e: Event) => {
    const detail = (e as CustomEvent)?.detail || {};
    const msgId = Number(detail.msgId || 0);
    trigger(true, true, msgId > 0 ? msgId : undefined);
  };

  const onWake = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    trigger(true, true);
  };
  const onOnline = () => {
    getBrowserTelegramClient().catch(() => {});
    trigger(true, true);
  };

  window.addEventListener('tg_channel_new_message', onChannelPush);
  window.addEventListener('focus', onWake);
  window.addEventListener('pageshow', onWake);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onWake);

  (window as any).__syncTelegramChannelNow = () =>
    runDirectTelegramSyncPass({ force: true, bypassGap: true, currentMovies: getCurrentMovies() });

  return () => {
    clearTimeout(bootTimer);
    clearInterval(pollTimer);
    window.removeEventListener('tg_channel_new_message', onChannelPush);
    window.removeEventListener('focus', onWake);
    window.removeEventListener('pageshow', onWake);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onWake);
  };
}
