import { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDocFromServer,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  AlertCircle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Film,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import {
  guardedFirestoreWrite,
  isFirestoreWriteAllowed,
} from '../services/firestoreQuotaService';
import { MovieData, saveMovieLocally, touchCatalogSyncMarker } from '../services/movieStorage';
import { getDisplayCategory } from '../utils/categoryMapping';
import { formatHumanDuration, parseDurationToSeconds } from '../utils/duration';
import { normalizeEpisodeForSave } from '../utils/playerHelpers';
import { upgradePosterUrl } from '../utils/posterUrl';
import { isHollywoodPrintText, normalizeQualityBadge } from '../utils/qualityBadge';
import { parseTelegramUrl } from '../utils/telegramParser';

export interface AutoMatchCandidate {
  imdbId: string;
  title: string;
  year: number | string;
  type: string;
  posterUrl: string;
  cast?: string;
}

export interface AutoMovieDraft {
  draftId: string;
  channelId: string;
  channelTitle: string;
  msgId: number;
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
  alternateMatches: AutoMatchCandidate[];
}

interface SyncConfigState {
  configVersion?: number;
  channelUrl: string;
  lastSyncedMsgId: number;
  autoWatchEnabled: boolean;
  autoPublishVerified: boolean;
  notifyOnNewPublish: boolean;
  onlyValidAudioAndHd: boolean;
}

interface BulkSyncJobState {
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'quota_paused' | 'error';
  channelRef: string;
  channelId: string;
  channelTitle: string;
  onlyValidAudioAndHd: boolean;
  startMsgId: number;
  endMsgId: number;
  currentMsgId: number;
  scannedMessages: number;
  totalVideosSeen: number;
  publishedCount: number;
  mergedCount: number;
  skippedNoAudio: number;
  skippedLowQuality: number;
  skippedDuplicates: number;
  skippedNonVideo: number;
  startedAtMs: number;
  updatedAtMs: number;
  errorMessage: string;
  upgradeUrl: string;
}

interface TelegramAutoMovieSyncProps {
  existingMovies: MovieData[];
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onMoviePublished: (movie: MovieData) => void;
  onBatchComplete: () => Promise<void>;
  broadcastMoviesUpdated: (movieId?: string, action?: 'add' | 'edit' | 'delete' | 'import') => void;
  publishReleaseAnnouncement: (params: {
    movieId: string;
    title: string;
    releaseYear: number | string;
    originalCategory: string;
    isSeries: boolean;
    language?: string;
    genre?: string;
    qualityBadge?: string;
    runtime?: string;
    posterUrl?: string;
    backdropUrl?: string;
    customMessage?: string;
  }) => Promise<any>;
  showNotification: (type: 'success' | 'error', message: string) => void;
}

const LOCAL_SYNC_CONFIG_KEY = 'movie_hub_tg_auto_movie_sync_v1';
const CONFIG_DOC_PATH = ['app_config', 'telegram_auto_sync'] as const;
const DEFAULT_CHANNEL_URL = 'https://t.me/+P5UeGT1YlQ9lOGZl';
const AUTO_SYNC_CONFIG_VERSION = 3;

const CATEGORY_OPTIONS = [
  'Bollywood Movie',
  'Hollywood Movie',
  'Anime Movie',
  'Web Series',
  'Anime Series',
];

function normalizeDupTitle(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/\((?:tv\s*series|film|movie|series|\d{4})\)/gi, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function buildFallbackPosterDataUri(title: string, year?: number): string {
  const safeTitle = String(title || 'Movie').replace(/[<>&"']/g, '').slice(0, 34);
  const safeYear = year && Number(year) > 1900 ? String(year) : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750" viewBox="0 0 500 750"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#141824"/><stop offset="100%" stop-color="#090b10"/></linearGradient></defs><rect width="500" height="750" fill="url(#g)"/><rect x="28" y="28" width="444" height="694" rx="22" fill="none" stroke="#10b981" stroke-opacity="0.35" stroke-width="2"/><text x="250" y="345" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="30" font-weight="bold">${safeTitle}</text><text x="250" y="395" text-anchor="middle" fill="#10b981" font-family="sans-serif" font-size="22" font-weight="bold">${safeYear}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function collectExistingUrlsAndImdb(movies: MovieData[]): {
  urls: Set<string>;
  imdbIds: Set<string>;
  existingTitles: Array<{ title: string; originalTitle: string; releaseYear: number; category: string }>;
  isTitleDuplicate: (titles: Array<string | undefined>, releaseYear?: number, category?: string) => boolean;
  findExistingMatch: (
    imdbId: string | undefined,
    titles: Array<string | undefined>,
    releaseYear?: number,
    isSeries?: boolean
  ) => MovieData | null;
} {
  const urls = new Set<string>();
  const imdbIds = new Set<string>();
  const existingTitles: Array<{ title: string; originalTitle: string; releaseYear: number; category: string }> = [];
  const entries: Array<{ movie: MovieData; k1: string; k2: string; year: number; isSeries: boolean }> = [];

  for (const m of movies) {
    if (m.imdbId) imdbIds.add(String(m.imdbId).trim().toLowerCase());
    if (m.streamingUrl) urls.add(String(m.streamingUrl).trim().toLowerCase());
    const vq = (m as any)?.videoQualities;
    if (vq && typeof vq === 'object') {
      Object.values(vq).forEach((u) => {
        if (typeof u === 'string' && u.trim()) urls.add(u.trim().toLowerCase());
      });
    }
    if (Array.isArray(m.seasons)) {
      m.seasons.forEach((s: any) => {
        if (Array.isArray(s?.episodes)) {
          s.episodes.forEach((ep: any) => {
            if (ep?.streamUrl && typeof ep.streamUrl === 'string') {
              urls.add(ep.streamUrl.trim().toLowerCase());
            }
          });
        }
      });
    }
    const cat = String(m.originalCategory || '');
    const mIsSeries = cat.toLowerCase().includes('series') || (Array.isArray(m.seasons) && m.seasons.length > 0);
    existingTitles.push({
      title: String(m.title || ''),
      originalTitle: String((m as any).originalTitle || ''),
      releaseYear: Number(m.releaseYear) || 0,
      category: cat,
    });
    entries.push({
      movie: m,
      k1: normalizeDupTitle(String(m.title || '')),
      k2: normalizeDupTitle(String((m as any).originalTitle || '')),
      year: Number(m.releaseYear) || 0,
      isSeries: mIsSeries,
    });
  }

  const isTitleDuplicate = (titles: Array<string | undefined>, releaseYear = 0, category = '') => {
    const cKeys = titles.map((t) => normalizeDupTitle(t || '')).filter((k) => k.length >= 2);
    const candSeries = category.toLowerCase().includes('series');
    for (const ex of entries) {
      const eKeys = [ex.k1, ex.k2].filter((k) => k.length >= 2);
      for (const ck of cKeys) {
        for (const ek of eKeys) {
          if (ck !== ek) continue;
          if (ex.isSeries || candSeries) return true;
          if (!releaseYear || !ex.year) return true;
          if (Math.abs(releaseYear - ex.year) <= 1) return true;
        }
      }
    }
    return false;
  };

  const findExistingMatch = (
    imdbId: string | undefined,
    titles: Array<string | undefined>,
    releaseYear = 0,
    isSeries = false
  ): MovieData | null => {
    const cleanImdb = String(imdbId || '').trim().toLowerCase();
    if (cleanImdb) {
      const byImdb = movies.find(
        (m) => m.imdbId && String(m.imdbId).trim().toLowerCase() === cleanImdb
      );
      if (byImdb) return byImdb;
    }
    const cKeys = titles.map((t) => normalizeDupTitle(t || '')).filter((k) => k.length >= 2);
    for (const ex of entries) {
      const eKeys = [ex.k1, ex.k2].filter((k) => k.length >= 2);
      for (const ck of cKeys) {
        for (const ek of eKeys) {
          if (ck !== ek) continue;
          if (ex.isSeries || isSeries) return ex.movie;
          if (!releaseYear || !ex.year || Math.abs(releaseYear - ex.year) <= 1) return ex.movie;
        }
      }
    }
    return null;
  };

  return { urls, imdbIds, existingTitles, isTitleDuplicate, findExistingMatch };
}

function mergeEpisodeIntoClientSeasons(
  existingSeasons: any[],
  seasonNum: number,
  newEpisode: {
    episodeNumber: number;
    episodeLabel?: string;
    title: string;
    streamUrl: string;
    duration?: string;
    durationSec?: number;
    showInNewEpisodes: boolean;
    newEpisodeEnabledAt?: number;
    createdAt?: number;
    addedAt?: number;
  }
): { mergedSeasons: any[]; added: boolean } {
  const cloned = Array.isArray(existingSeasons)
    ? existingSeasons.map((s) => ({
        seasonNumber: Number(s?.seasonNumber) || 1,
        episodes: Array.isArray(s?.episodes) ? [...s.episodes] : [],
      }))
    : [];

  let targetSeason = cloned.find((s) => s.seasonNumber === seasonNum);
  if (!targetSeason) {
    targetSeason = { seasonNumber: seasonNum, episodes: [] };
    cloned.push(targetSeason);
  }

  const cleanStream = newEpisode.streamUrl.trim().toLowerCase();
  if (
    targetSeason.episodes.some(
      (ep) => String(ep?.streamUrl || '').trim().toLowerCase() === cleanStream
    )
  ) {
    return { mergedSeasons: cloned, added: false };
  }

  const sameIdx = targetSeason.episodes.findIndex(
    (ep) => Number(ep?.episodeNumber) === newEpisode.episodeNumber && String(ep?.streamUrl || '').trim() !== ''
  );
  if (sameIdx >= 0) {
    return { mergedSeasons: cloned, added: false };
  }

  const emptyIdx = targetSeason.episodes.findIndex(
    (ep) => Number(ep?.episodeNumber) === newEpisode.episodeNumber && !String(ep?.streamUrl || '').trim()
  );
  if (emptyIdx >= 0) {
    targetSeason.episodes[emptyIdx] = newEpisode;
  } else {
    targetSeason.episodes.push(newEpisode);
  }

  targetSeason.episodes.sort((a, b) => (Number(a?.episodeNumber) || 0) - (Number(b?.episodeNumber) || 0));
  cloned.sort((a, b) => a.seasonNumber - b.seasonNumber);

  return { mergedSeasons: cloned, added: true };
}

export default function TelegramAutoMovieSync({
  existingMovies,
  authFetch,
  onMoviePublished,
  onBatchComplete,
  broadcastMoviesUpdated,
  publishReleaseAnnouncement,
  showNotification,
}: TelegramAutoMovieSyncProps) {
  const [expanded, setExpanded] = useState(() => {
    try {
      const saved = localStorage.getItem(LOCAL_SYNC_CONFIG_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        return !String(parsed?.channelUrl || '').trim();
      }
    } catch {}
    return true;
  });
  const [scanTab, setScanTab] = useState<'new' | 'full'>('new');

  const [config, setConfig] = useState<SyncConfigState>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_SYNC_CONFIG_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        const savedVer = Number(parsed?.configVersion) || 1;
        const savedUrl = String(parsed?.channelUrl || '').trim();
        const isOldDefault =
          savedUrl.includes('QSL_3k54YfBjMjE1') || savedUrl.includes('s2Qki5-sfnVjZTI1');
        if (savedVer >= AUTO_SYNC_CONFIG_VERSION && savedUrl && !isOldDefault) {
          return {
            configVersion: savedVer,
            channelUrl: savedUrl,
            lastSyncedMsgId: Number(parsed?.lastSyncedMsgId) || 0,
            autoWatchEnabled: Boolean(parsed?.autoWatchEnabled ?? true),
            autoPublishVerified: Boolean(parsed?.autoPublishVerified ?? true),
            notifyOnNewPublish: Boolean(parsed?.notifyOnNewPublish ?? true),
            onlyValidAudioAndHd: Boolean(parsed?.onlyValidAudioAndHd ?? false),
          };
        }
      }
    } catch {}
    return {
      configVersion: AUTO_SYNC_CONFIG_VERSION,
      channelUrl: DEFAULT_CHANNEL_URL,
      lastSyncedMsgId: 0,
      autoWatchEnabled: true,
      autoPublishVerified: true,
      notifyOnNewPublish: true,
      onlyValidAudioAndHd: false,
    };
  });
  const [resolvedChannelTitle, setResolvedChannelTitle] = useState<string>('');

  // Full / Range Scan Inputs
  const [rangeStartUrl, setRangeStartUrl] = useState('');
  const [rangeEndUrl, setRangeEndUrl] = useState('');
  const [startFromMsgNum, setStartFromMsgNum] = useState('1');

  // 3k+ Bulk Auto-Publish Background Job State
  const [bulkJob, setBulkJob] = useState<BulkSyncJobState | null>(null);
  const [startingBulkJob, setStartingBulkJob] = useState(false);

  // Scanning & Publishing State
  const [scanning, setScanning] = useState(false);
  const [scanProgressText, setScanProgressText] = useState('');
  const [scanError, setScanError] = useState('');
  const [lastScanStats, setLastScanStats] = useState<string>('');
  const [drafts, setDrafts] = useState<AutoMovieDraft[]>([]);
  const [filterView, setFilterView] = useState<'all' | 'verified' | 'review'>('all');
  const [publishingBatch, setPublishingBatch] = useState(false);
  const [publishingSingleId, setPublishingSingleId] = useState<string | null>(null);
  const [sendPushOnBatch, setSendPushOnBatch] = useState(false);

  // Per-card Inline IMDb Fixer Modal/Drawer State
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [inlineSearchText, setInlineSearchText] = useState('');
  const [inlineSearching, setInlineSearching] = useState(false);
  const [inlineSearchResults, setInlineSearchResults] = useState<AutoMatchCandidate[]>([]);
  const [applyingFixId, setApplyingFixId] = useState<string | null>(null);

  const existingMoviesRef = useRef<MovieData[]>(existingMovies);
  existingMoviesRef.current = existingMovies;
  const scanningRef = useRef(false);
  const configRef = useRef(config);
  configRef.current = config;

  // Persist config locally and in Firestore
  const saveSyncConfig = async (next: SyncConfigState) => {
    const withVersion: SyncConfigState = {
      ...next,
      configVersion: AUTO_SYNC_CONFIG_VERSION,
    };
    setConfig(withVersion);
    configRef.current = withVersion;
    try {
      localStorage.setItem(LOCAL_SYNC_CONFIG_KEY, JSON.stringify(withVersion));
    } catch {}
    if (isFirestoreWriteAllowed()) {
      await guardedFirestoreWrite(() =>
        setDoc(
          doc(db, CONFIG_DOC_PATH[0], CONFIG_DOC_PATH[1]),
          {
            ...withVersion,
            updatedAtMs: Date.now(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      );
    }
  };

  // Load saved Firestore config on mount (and auto-migrate old default channel)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocFromServer(doc(db, CONFIG_DOC_PATH[0], CONFIG_DOC_PATH[1]));
        if (!cancelled) {
          const data = snap.exists() ? (snap.data() as any) : {};
          const rawUrl = String(data?.channelUrl || '').trim();
          const rawVer = Number(data?.configVersion) || 1;
          const isOldDefault =
            rawUrl.includes('QSL_3k54YfBjMjE1') || rawUrl.includes('s2Qki5-sfnVjZTI1');

          if (!snap.exists() || rawVer < AUTO_SYNC_CONFIG_VERSION || isOldDefault || !rawUrl) {
            const migrated: SyncConfigState = {
              configVersion: AUTO_SYNC_CONFIG_VERSION,
              channelUrl: DEFAULT_CHANNEL_URL,
              lastSyncedMsgId: 0,
              autoWatchEnabled: true,
              autoPublishVerified: true,
              notifyOnNewPublish: true,
              onlyValidAudioAndHd: false,
            };
            await saveSyncConfig(migrated);
          } else {
            const merged: SyncConfigState = {
              configVersion: rawVer,
              channelUrl: rawUrl,
              lastSyncedMsgId: Math.max(
                Number(data?.lastSyncedMsgId) || 0,
                configRef.current.lastSyncedMsgId || 0
              ),
              autoWatchEnabled:
                typeof data?.autoWatchEnabled === 'boolean'
                  ? data.autoWatchEnabled
                  : configRef.current.autoWatchEnabled,
              autoPublishVerified:
                typeof data?.autoPublishVerified === 'boolean'
                  ? data.autoPublishVerified
                  : configRef.current.autoPublishVerified,
              notifyOnNewPublish:
                typeof data?.notifyOnNewPublish === 'boolean'
                  ? data.notifyOnNewPublish
                  : configRef.current.notifyOnNewPublish,
              onlyValidAudioAndHd:
                typeof data?.onlyValidAudioAndHd === 'boolean'
                  ? data.onlyValidAudioAndHd
                  : configRef.current.onlyValidAudioAndHd,
            };
            setConfig(merged);
            configRef.current = merged;
            try {
              localStorage.setItem(LOCAL_SYNC_CONFIG_KEY, JSON.stringify(merged));
            } catch {}
          }
        }
      } catch {}

      try {
        const bulkResp = await authFetch('/api/telegram/bulk-sync-status');
        const bulkJson = await bulkResp.json();
        if (!cancelled && bulkJson?.job && bulkJson.job.status !== 'idle') {
          setBulkJob(bulkJson.job as BulkSyncJobState);
        }
      } catch {}

      try {
        const pendResp = await authFetch('/api/telegram/pending-review-drafts');
        const pendJson = await pendResp.json();
        if (!cancelled && Array.isArray(pendJson?.drafts) && pendJson.drafts.length > 0) {
          const { urls, imdbIds, isTitleDuplicate } = collectExistingUrlsAndImdb(existingMoviesRef.current);
          const fresh = (pendJson.drafts as AutoMovieDraft[]).filter((d) => {
            if (d.streamUrl && urls.has(d.streamUrl.trim().toLowerCase())) return false;
            const isSeriesItem =
              d.isSeriesEpisode || String(d.originalCategory || '').toLowerCase().includes('series');
            if (isSeriesItem) return true;
            return (
              (!d.imdbId || !imdbIds.has(d.imdbId.trim().toLowerCase())) &&
              !isTitleDuplicate([d.title, d.originalTitle, d.parsedTitle], d.releaseYear, d.originalCategory)
            );
          });
          if (fresh.length > 0) {
            setDrafts((prev) => {
              const seen = new Set(prev.map((p) => p.draftId));
              return [...fresh.filter((f) => !seen.has(f.draftId)), ...prev];
            });
          }
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll 3k+ Bulk Auto-Publish job while active
  useEffect(() => {
    if (!bulkJob || bulkJob.status !== 'running') return;
    let active = true;
    const pollId = setInterval(async () => {
      try {
        const resp = await authFetch('/api/telegram/bulk-sync-status');
        const data = await resp.json();
        if (!active || !data?.job) return;
        const nextJob = data.job as BulkSyncJobState;
        setBulkJob(nextJob);
        if (nextJob.status !== 'running') {
          clearInterval(pollId);
          if (nextJob.publishedCount + nextJob.mergedCount > 0) {
            await onBatchComplete().catch(() => {});
          }
          if (nextJob.status === 'completed') {
            showNotification(
              'success',
              `🎉 3k+ Channel Publish Complete! ${nextJob.publishedCount} naye + ${nextJob.mergedCount} merged (${nextJob.skippedNoAudio} no-audio & ${nextJob.skippedLowQuality} <720p skipped).`
            );
          } else if (nextJob.status === 'quota_paused') {
            showNotification(
              'error',
              `Firestore daily free quota full ho gayi (#${nextJob.currentMsgId} par paused). Upgrade karein ya kal yahin se resume karein.`
            );
          }
        }
      } catch {}
    }, 2000);
    return () => {
      active = false;
      clearInterval(pollId);
    };
  }, [bulkJob?.status]);

  // Helper: publish a single movie OR series/episode draft to Firestore `movies`
  const publishSingleDraftToFirestore = async (
    draft: AutoMovieDraft,
    sendNotification: boolean
  ): Promise<{ published: boolean; skippedDuplicate?: boolean }> => {
    const cleanPoster =
      upgradePosterUrl(draft.posterUrl, 1080) ||
      (draft.posterUrl || '').trim() ||
      buildFallbackPosterDataUri(draft.title, draft.releaseYear);
    if (!draft.title.trim()) {
      return { published: false };
    }

    const { urls, findExistingMatch } = collectExistingUrlsAndImdb(existingMoviesRef.current);
    if (draft.streamUrl && urls.has(draft.streamUrl.trim().toLowerCase())) {
      return { published: false, skippedDuplicate: true };
    }

    const rawCat = draft.originalCategory || 'Bollywood Movie';
    const isSeries =
      draft.isSeriesEpisode ||
      rawCat.toLowerCase().includes('series') ||
      Boolean(draft.seasonNumber || draft.episodeNumber);
    const catToSave = isSeries
      ? rawCat.toLowerCase().includes('anime')
        ? 'Anime Series'
        : 'Web Series'
      : rawCat;
    const displayCat = getDisplayCategory(catToSave);
    const cleanBackdrop = upgradePosterUrl(draft.backdropUrl || cleanPoster, 1280) || cleanPoster;
    const badge = normalizeQualityBadge(
      isHollywoodPrintText(`${draft.sourceFileName} ${draft.sourceCaption}`)
        ? 'HDTC'
        : draft.qualityBadge === '4K'
        ? 'HD'
        : draft.qualityBadge || 'HD'
    );

    const existingMatch = findExistingMatch(
      draft.imdbId,
      [draft.title, draft.originalTitle, draft.parsedTitle],
      draft.releaseYear,
      isSeries
    );

    const nowMs = Date.now();

    if (isSeries) {
      const seasonNum = Math.max(1, Number(draft.seasonNumber) || 1);
      const fallbackEpNum = existingMatch
        ? Math.max(
            1,
            ...(((Array.isArray(existingMatch.seasons)
              ? existingMatch.seasons.find((s: any) => Number(s?.seasonNumber) === seasonNum)?.episodes
              : []) || []
            ).map((e: any) => Number(e?.episodeNumber) || 0)),
            0
          ) + 1
        : 1;
      const epNum = Math.max(1, Number(draft.episodeNumber) || fallbackEpNum);
      const epTitle = draft.episodeTitle || `Episode ${epNum}`;
      const epDurationFormatted = draft.durationSec > 0 ? formatHumanDuration(null, draft.durationSec) || '' : '';
      const epObj = normalizeEpisodeForSave(
        {
          episodeNumber: epNum,
          episodeLabel: draft.episodeLabel,
          title: epTitle,
          streamUrl: draft.streamUrl.trim(),
          videoQualities: {},
          duration: epDurationFormatted || undefined,
          durationSec: draft.durationSec > 0 ? draft.durationSec : undefined,
          showInNewEpisodes: false,
        },
        epNum,
        nowMs
      );

      if (existingMatch && existingMatch.id) {
        const { mergedSeasons, added } = mergeEpisodeIntoClientSeasons(
          existingMatch.seasons || [],
          seasonNum,
          epObj
        );
        if (!added) {
          return { published: false, skippedDuplicate: true };
        }
        const nextStream = existingMatch.streamingUrl || epObj.streamUrl;
        if (isFirestoreWriteAllowed()) {
          const wRes = await guardedFirestoreWrite(() =>
            setDoc(
              doc(db, 'movies', existingMatch.id),
              {
                seasons: mergedSeasons,
                streamingUrl: nextStream,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            )
          );
          if (!wRes.ok && !wRes.quotaExhausted && wRes.error) {
            throw wRes.error;
          }
        }
        const updatedMovie: MovieData = {
          ...existingMatch,
          seasons: mergedSeasons,
          streamingUrl: nextStream,
          updatedAt: nowMs,
        };
        existingMoviesRef.current = existingMoviesRef.current.map((m) =>
          m.id === existingMatch.id ? updatedMovie : m
        );
        saveMovieLocally(updatedMovie);
        touchCatalogSyncMarker();
        onMoviePublished(updatedMovie);
        broadcastMoviesUpdated(existingMatch.id, 'edit');
        authFetch('/api/telegram/dismiss-review-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ draftId: draft.draftId }),
        }).catch(() => {});

        if (sendNotification) {
          await publishReleaseAnnouncement({
            movieId: existingMatch.id,
            title: existingMatch.title || draft.title,
            releaseYear: existingMatch.releaseYear || draft.releaseYear,
            originalCategory: existingMatch.originalCategory || catToSave,
            isSeries: true,
            language: existingMatch.language || draft.language,
            genre: existingMatch.genre || draft.genre,
            qualityBadge: badge !== 'NONE' ? badge : '',
            runtime: draft.runtime,
            posterUrl: existingMatch.posterUrl || cleanPoster,
            backdropUrl: existingMatch.backdropUrl || cleanBackdrop,
            customMessage: `Season ${seasonNum} Episode ${draft.episodeLabel || epNum} Now Streaming!`,
          }).catch(() => {});
        }
        return { published: true };
      }

      const initialSeasons = [{ seasonNumber: seasonNum, episodes: [epObj] }];
      const seriesPayload: any = {
        title: draft.title.trim(),
        originalTitle: (draft.originalTitle || draft.title).trim(),
        description: draft.description.trim(),
        posterUrl: cleanPoster,
        backdropUrl: cleanBackdrop,
        releaseYear: Number(draft.releaseYear) || new Date().getFullYear(),
        originalCategory: catToSave,
        displayCategory: displayCat,
        contentType: catToSave.toLowerCase().includes('anime') ? 'anime' : null,
        language: (draft.language || 'Hindi').trim(),
        genre: (draft.genre || 'Drama').trim(),
        director: (draft.director || '').trim(),
        cast: (draft.cast || '').trim(),
        runtime: (draft.runtime || '').trim(),
        rating: Number(draft.rating) || 8.0,
        imdbId: (draft.imdbId || '').trim(),
        trailerUrl: '',
        streamingUrl: epObj.streamUrl,
        videoQualities: Object.fromEntries(
          Object.entries(draft.videoQualities || {}).filter(
            ([, u]) => String(u || '').trim() && String(u || '').trim() !== epObj.streamUrl.trim()
          )
        ),
        seasons: initialSeasons,
        featured: true,
        published: true,
        qualityBadge: badge,
        duration: draft.durationSec || parseDurationToSeconds(draft.runtime) || 0,
        telegramMsgId: draft.msgId,
        telegramChannelId: draft.channelId,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      };

      const seriesDocId =
        draft.channelId && draft.msgId ? `tg_series_${draft.channelId}_${draft.msgId}` : '';
      let publishedDocId = seriesDocId || `local_series_${nowMs}`;
      if (isFirestoreWriteAllowed()) {
        if (seriesDocId) {
          const wRes = await guardedFirestoreWrite(() =>
            setDoc(doc(db, 'movies', seriesDocId), seriesPayload, { merge: true })
          );
          if (!wRes.ok && !wRes.quotaExhausted && wRes.error) throw wRes.error;
        } else {
          const wRes = await guardedFirestoreWrite(() =>
            addDoc(collection(db, 'movies'), seriesPayload)
          );
          if (wRes.ok && wRes.value?.id) {
            publishedDocId = wRes.value.id;
          } else if (!wRes.ok && !wRes.quotaExhausted && wRes.error) {
            throw wRes.error;
          }
        }
      }

      const localSeries: MovieData = {
        ...seriesPayload,
        id: publishedDocId,
        createdAt: nowMs,
        updatedAt: nowMs,
      };
      existingMoviesRef.current = [localSeries, ...existingMoviesRef.current];
      saveMovieLocally(localSeries);
      touchCatalogSyncMarker();
      onMoviePublished(localSeries);
      broadcastMoviesUpdated(publishedDocId, 'add');
      authFetch('/api/telegram/dismiss-review-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draft.draftId }),
      }).catch(() => {});

      if (sendNotification) {
        await publishReleaseAnnouncement({
          movieId: publishedDocId,
          title: seriesPayload.title,
          releaseYear: seriesPayload.releaseYear,
          originalCategory: seriesPayload.originalCategory,
          isSeries: true,
          language: seriesPayload.language,
          genre: seriesPayload.genre,
          qualityBadge: badge !== 'NONE' ? badge : '',
          runtime: seriesPayload.runtime,
          posterUrl: seriesPayload.posterUrl,
          backdropUrl: seriesPayload.backdropUrl,
        }).catch(() => {});
      }

      return { published: true };
    }

    // Single Movie: merge newly uploaded quality tiers if already in Firestore
    if (existingMatch && existingMatch.id) {
      const mergedQualities: Record<string, string> = {
        ...((existingMatch as any).videoQualities || {}),
      };
      let qualityAdded = false;
      for (const [qk, qUrl] of Object.entries(draft.videoQualities || {})) {
        if (qUrl && !mergedQualities[qk]) {
          mergedQualities[qk] = qUrl;
          qualityAdded = true;
        }
      }
      if (!qualityAdded) {
        return { published: false, skippedDuplicate: true };
      }
      const upgradedStream =
        mergedQualities['1080p'] ||
        mergedQualities['4K'] ||
        existingMatch.streamingUrl ||
        draft.streamUrl.trim();
      if (isFirestoreWriteAllowed()) {
        const wRes = await guardedFirestoreWrite(() =>
          setDoc(
            doc(db, 'movies', existingMatch.id),
            {
              videoQualities: mergedQualities,
              streamingUrl: upgradedStream,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          )
        );
        if (!wRes.ok && !wRes.quotaExhausted && wRes.error) {
          throw wRes.error;
        }
      }
      const updatedMovie = {
        ...existingMatch,
        videoQualities: mergedQualities,
        streamingUrl: upgradedStream,
        updatedAt: nowMs,
      } as MovieData;
      existingMoviesRef.current = existingMoviesRef.current.map((m) =>
        m.id === existingMatch.id ? updatedMovie : m
      );
      saveMovieLocally(updatedMovie);
      touchCatalogSyncMarker();
      onMoviePublished(updatedMovie);
      broadcastMoviesUpdated(existingMatch.id, 'edit');
      authFetch('/api/telegram/dismiss-review-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draft.draftId }),
      }).catch(() => {});
      return { published: true };
    }

    const moviePayload: any = {
      title: draft.title.trim(),
      originalTitle: (draft.originalTitle || draft.title).trim(),
      description: draft.description.trim(),
      posterUrl: cleanPoster,
      backdropUrl: cleanBackdrop,
      releaseYear: Number(draft.releaseYear) || new Date().getFullYear(),
      originalCategory: catToSave,
      displayCategory: displayCat,
      contentType: catToSave.toLowerCase().includes('anime') ? 'anime' : null,
      language: (draft.language || 'Hindi').trim(),
      genre: (draft.genre || 'Action').trim(),
      director: (draft.director || '').trim(),
      cast: (draft.cast || '').trim(),
      runtime: (draft.runtime || '').trim(),
      rating: Number(draft.rating) || 8.0,
      imdbId: (draft.imdbId || '').trim(),
      trailerUrl: '',
      streamingUrl: draft.streamUrl.trim(),
      videoQualities: Object.fromEntries(
        Object.entries(draft.videoQualities || {}).filter(
          ([, u]) => String(u || '').trim() && String(u || '').trim() !== draft.streamUrl.trim()
        )
      ),
      seasons: [],
      featured: true,
      published: true,
      qualityBadge: badge,
      duration: draft.durationSec || parseDurationToSeconds(draft.runtime) || 0,
      telegramMsgId: draft.msgId,
      telegramChannelId: draft.channelId,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    };

    const deterministicDocId =
      draft.channelId && draft.msgId ? `tg_${draft.channelId}_${draft.msgId}` : '';
    let publishedDocId = deterministicDocId || `local_${nowMs}`;
    if (isFirestoreWriteAllowed()) {
      if (deterministicDocId) {
        const wRes = await guardedFirestoreWrite(() =>
          setDoc(doc(db, 'movies', deterministicDocId), moviePayload, { merge: true })
        );
        if (!wRes.ok && !wRes.quotaExhausted && wRes.error) throw wRes.error;
      } else {
        const wRes = await guardedFirestoreWrite(() =>
          addDoc(collection(db, 'movies'), moviePayload)
        );
        if (wRes.ok && wRes.value?.id) {
          publishedDocId = wRes.value.id;
        } else if (!wRes.ok && !wRes.quotaExhausted && wRes.error) {
          throw wRes.error;
        }
      }
    }
    const localMovie: MovieData = {
      ...moviePayload,
      id: publishedDocId,
      createdAt: nowMs,
      updatedAt: nowMs,
    };

    existingMoviesRef.current = [localMovie, ...existingMoviesRef.current];
    saveMovieLocally(localMovie);
    touchCatalogSyncMarker();
    onMoviePublished(localMovie);
    broadcastMoviesUpdated(publishedDocId, 'add');
    authFetch('/api/telegram/dismiss-review-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: draft.draftId }),
    }).catch(() => {});

    if (sendNotification) {
      await publishReleaseAnnouncement({
        movieId: publishedDocId,
        title: moviePayload.title,
        releaseYear: moviePayload.releaseYear,
        originalCategory: moviePayload.originalCategory,
        isSeries: false,
        language: moviePayload.language,
        genre: moviePayload.genre,
        qualityBadge: badge !== 'NONE' ? badge : '',
        runtime: moviePayload.runtime,
        posterUrl: moviePayload.posterUrl,
        backdropUrl: moviePayload.backdropUrl,
      }).catch(() => {});
    }

    return { published: true };
  };

  // Automatic or manual "Check New Uploads" forward from lastSyncedMsgId (works with invite link OR post link!)
  const handleCheckNewUploads = async (silentAuto = false) => {
    const activeUrl = (configRef.current.channelUrl || rangeEndUrl || rangeStartUrl || DEFAULT_CHANNEL_URL).trim();
    if (!activeUrl) {
      if (!silentAuto) {
        setScanError('Pehle apne Telegram channel ka invite link ya post link paste karein.');
      }
      return;
    }
    if (scanningRef.current) return;

    const parsed = parseTelegramUrl(activeUrl);
    let baselineMsgId =
      configRef.current.lastSyncedMsgId > 0
        ? configRef.current.lastSyncedMsgId
        : parsed.messageId
        ? Math.max(0, parseInt(parsed.messageId, 10) - 1)
        : 0;

    scanningRef.current = true;
    setScanning(true);
    setScanError('');
    setScanProgressText(
      baselineMsgId > 0
        ? `Checking new uploads after post #${baselineMsgId}...`
        : 'Resolving channel & checking latest uploads...'
    );

    try {
      const { urls, imdbIds, existingTitles } = collectExistingUrlsAndImdb(existingMoviesRef.current);
      const resp = await authFetch('/api/telegram/scan-movies-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'since_latest',
          channelRef: activeUrl,
          sinceMsgId: baselineMsgId,
          onlyValidAudioAndHd: configRef.current.onlyValidAudioAndHd,
          existingUrls: Array.from(urls),
          existingImdbIds: Array.from(imdbIds),
          existingTitles,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to check new Telegram uploads.');
      }

      if (data.channelTitle) setResolvedChannelTitle(String(data.channelTitle));

      const incoming: AutoMovieDraft[] = Array.isArray(data.items) ? data.items : [];
      const serverHighest = Number(data.highestMsgId) || 0;
      const reconciledStale = Boolean(data.reconciledStaleBaseline) || (serverHighest > 0 && serverHighest < baselineMsgId);
      const scannedFrom = Number(data.scannedFromMsgId) || (reconciledStale ? 1 : baselineMsgId + 1);
      const highestMsgId = reconciledStale ? serverHighest : Math.max(baselineMsgId, serverHighest);

      let autoPublishedCount = 0;
      const reviewQueue: AutoMovieDraft[] = [];

      if (configRef.current.autoPublishVerified && incoming.length > 0) {
        const shouldNotify =
          configRef.current.notifyOnNewPublish && incoming.length <= 3;

        for (const item of incoming) {
          if (item.title && item.title.trim()) {
            try {
              const res = await publishSingleDraftToFirestore(item, shouldNotify);
              if (res.published) {
                autoPublishedCount++;
                continue;
              }
              if (res.skippedDuplicate) {
                continue;
              }
            } catch (e) {
              console.warn('Auto-publish item fallback to review:', e);
            }
          }
          reviewQueue.push(item);
        }
      } else {
        reviewQueue.push(...incoming);
      }

      if (reconciledStale || highestMsgId > configRef.current.lastSyncedMsgId) {
        await saveSyncConfig({
          ...configRef.current,
          channelUrl: activeUrl,
          lastSyncedMsgId: highestMsgId,
        });
      }

      if (reviewQueue.length > 0) {
        setDrafts((prev) => {
          const prevIds = new Set(prev.map((p) => p.draftId));
          const merged = [...reviewQueue.filter((r) => !prevIds.has(r.draftId)), ...prev];
          return merged;
        });
      }

      if (autoPublishedCount > 0) {
        await onBatchComplete();
        showNotification(
          'success',
          `🎉 ${autoPublishedCount} nayi movie/series IMDb poster & details ke sath automatically Publish ho gayi!${
            reviewQueue.length > 0 ? ` (${reviewQueue.length} check ke liye queue me hain)` : ''
          }`
        );
      } else if (reviewQueue.length > 0) {
        showNotification(
          'success',
          `📥 ${reviewQueue.length} nayi movie/series mili — poster check karke 1 click me Publish karein!`
        );
      } else if (!silentAuto) {
        showNotification('success', `Channel "${data.channelTitle || 'Connected'}" up-to-date hai — koi nayi pending upload nahi mili.`);
      }

      const skippedAudioCount = Number(data.skippedNoAudio) || 0;
      const skippedLowQualCount = Number(data.skippedLowQuality) || 0;
      const filterSuffix =
        skippedAudioCount > 0 || skippedLowQualCount > 0
          ? ` • Filtered: ${skippedAudioCount} no-audio, ${skippedLowQualCount} <720p`
          : '';
      setLastScanStats(
        `${data.channelTitle ? `${data.channelTitle} • ` : ''}Scanned #${scannedFrom}–#${highestMsgId} • Auto-Published: ${autoPublishedCount} • Needs Review: ${reviewQueue.length}${filterSuffix}`
      );
    } catch (err: any) {
      if (!silentAuto) {
        setScanError(err?.message || 'Error scanning Telegram channel.');
      }
    } finally {
      scanningRef.current = false;
      setScanning(false);
      setScanProgressText('');
    }
  };

  // Automatic Watch Timer: checks every 35s when Admin Panel is open and channel is configured
  useEffect(() => {
    if (!config.autoWatchEnabled || !config.channelUrl.trim()) return;
    const initialTimer = setTimeout(() => {
      handleCheckNewUploads(true);
    }, 3500);
    const interval = setInterval(() => {
      handleCheckNewUploads(true);
    }, 35000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [config.autoWatchEnabled, config.channelUrl]);

  // Full / Range Scan (works automatically from invite link https://t.me/+... OR start/end links!)
  const handleScanExistingChannel = async () => {
    const channelOrEndLink = (rangeEndUrl || config.channelUrl || rangeStartUrl || DEFAULT_CHANNEL_URL).trim();
    const startLink = rangeStartUrl.trim() || channelOrEndLink;
    if (!channelOrEndLink) {
      setScanError('Apne Telegram channel ka invite link ya post link paste karein.');
      return;
    }

    const parsedEnd = parseTelegramUrl(channelOrEndLink);
    const parsedStart = parseTelegramUrl(startLink);
    if (!parsedEnd.isValid && !channelOrEndLink.startsWith('@')) {
      setScanError('Valid Telegram channel invite link (https://t.me/+...) ya post link daalein.');
      return;
    }

    scanningRef.current = true;
    setScanning(true);
    setScanError('');
    setExpanded(true);

    try {
      let endMsgNum = parsedEnd.messageId ? parseInt(parsedEnd.messageId, 10) : 0;
      const startMsgNum = rangeStartUrl.trim() && parsedStart.messageId
        ? parseInt(parsedStart.messageId, 10)
        : Math.max(1, parseInt(startFromMsgNum, 10) || 1);

      // Auto-discover latest message ID if user gave an invite link or @username without message number
      if (!endMsgNum) {
        setScanProgressText('Resolving Telegram channel & finding total posts...');
        const infoRes = await authFetch('/api/telegram/resolve-channel-info', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelRef: channelOrEndLink }),
        });
        const infoJson = await infoRes.json();
        if (!infoRes.ok || !infoJson?.success) {
          throw new Error(infoJson?.error || 'Could not resolve channel posts.');
        }
        if (infoJson.channelTitle) setResolvedChannelTitle(String(infoJson.channelTitle));
        endMsgNum = Math.max(startMsgNum, Number(infoJson.latestMsgId) || 150);
      }

      if (!endMsgNum || endMsgNum < startMsgNum) {
        throw new Error('Ending message number Starting message number se bada hona chahiye.');
      }

      const CHUNK_SIZE = 150;
      let totalFound = 0;
      let totalAutoPublished = 0;
      let totalSkippedAlready = 0;
      let totalSkippedNoAudio = 0;
      let totalSkippedLowQual = 0;
      let highestSeen = config.lastSyncedMsgId;

      for (let cursor = startMsgNum; cursor <= endMsgNum; cursor += CHUNK_SIZE) {
        const chunkEnd = Math.min(cursor + CHUNK_SIZE - 1, endMsgNum);
        setScanProgressText(
          `Scanning posts #${cursor} – #${chunkEnd} (of #${startMsgNum}–#${endMsgNum})...`
        );

        const { urls, imdbIds, existingTitles } = collectExistingUrlsAndImdb(existingMoviesRef.current);
        const resp = await authFetch('/api/telegram/scan-movies-channel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: 'range',
            channelRef: channelOrEndLink,
            startMsgId: cursor,
            endMsgId: chunkEnd,
            onlyValidAudioAndHd: configRef.current.onlyValidAudioAndHd,
            existingUrls: Array.from(urls),
            existingImdbIds: Array.from(imdbIds),
            existingTitles,
          }),
        });
        const data = await resp.json();
        if (!resp.ok || !data?.success) {
          throw new Error(data?.error || `Scan failed on messages #${cursor}–#${chunkEnd}`);
        }

        if (data.channelTitle) setResolvedChannelTitle(String(data.channelTitle));
        totalSkippedAlready += Number(data.skippedAlreadyAdded) || 0;
        totalSkippedNoAudio += Number(data.skippedNoAudio) || 0;
        totalSkippedLowQual += Number(data.skippedLowQuality) || 0;
        highestSeen = Math.max(highestSeen, Number(data.highestMsgId) || chunkEnd);

        const chunkItems: AutoMovieDraft[] = Array.isArray(data.items) ? data.items : [];
        totalFound += chunkItems.length;

        const queueAdd: AutoMovieDraft[] = [];
        for (const item of chunkItems) {
          if (configRef.current.autoPublishVerified && item.title && item.title.trim()) {
            try {
              const res = await publishSingleDraftToFirestore(item, false);
              if (res.published) {
                totalAutoPublished++;
                continue;
              }
              if (res.skippedDuplicate) continue;
            } catch {}
          }
          queueAdd.push(item);
        }

        if (queueAdd.length > 0) {
          setDrafts((prev) => {
            const seen = new Set(prev.map((d) => d.draftId));
            return [...prev, ...queueAdd.filter((q) => !seen.has(q.draftId))];
          });
        }
      }

      await saveSyncConfig({
        ...configRef.current,
        channelUrl: configRef.current.channelUrl || channelOrEndLink,
        lastSyncedMsgId: Math.max(configRef.current.lastSyncedMsgId, highestSeen),
      });

      if (totalAutoPublished > 0) {
        await onBatchComplete();
      }

      const remainingInQueue = Math.max(0, totalFound - totalAutoPublished);
      const filterInfo =
        totalSkippedNoAudio > 0 || totalSkippedLowQual > 0
          ? ` • Skipped: ${totalSkippedNoAudio} no-audio, ${totalSkippedLowQual} <720p`
          : '';
      setLastScanStats(
        `Scanned #${startMsgNum}–#${endMsgNum} • Auto-Published: ${totalAutoPublished} • Ready in Review: ${remainingInQueue} • Already in App: ${totalSkippedAlready}${filterInfo}`
      );
      showNotification(
        'success',
        `✅ Scan Complete! ${totalAutoPublished} verified movies automatically published${
          remainingInQueue > 0 ? `, ${remainingInQueue} movies poster check ke liye niche ready hain` : ''
        }.`
      );
    } catch (err: any) {
      setScanError(err?.message || 'Channel scan failed.');
    } finally {
      scanningRef.current = false;
      setScanning(false);
      setScanProgressText('');
    }
  };

  // Start / Resume 3k+ Full Channel Server-Side Auto-Publish
  const handleStartBulkPublish = async (resumeFromId?: number) => {
    const channelOrEndLink = (rangeEndUrl || rangeStartUrl || config.channelUrl || DEFAULT_CHANNEL_URL).trim();
    if (!channelOrEndLink) {
      setScanError('Pehle channel link ya kisi 1 post ka link paste karein.');
      return;
    }

    const parsedStart = parseTelegramUrl(rangeStartUrl.trim() || channelOrEndLink);
    const parsedEnd = parseTelegramUrl(rangeEndUrl.trim() || '');
    const explicitStart =
      typeof resumeFromId === 'number' && resumeFromId > 0
        ? resumeFromId
        : rangeStartUrl.trim() && parsedStart.messageId
        ? parseInt(parsedStart.messageId, 10)
        : Math.max(1, parseInt(startFromMsgNum, 10) || 1);
    const explicitEnd = parsedEnd.messageId ? parseInt(parsedEnd.messageId, 10) : 0;

    setStartingBulkJob(true);
    setScanError('');
    setExpanded(true);

    try {
      const resp = await authFetch('/api/telegram/bulk-sync-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelRef: channelOrEndLink,
          startMsgId: explicitStart,
          endMsgId: explicitEnd,
          onlyValidAudioAndHd: configRef.current.onlyValidAudioAndHd,
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        if (data?.job) setBulkJob(data.job as BulkSyncJobState);
        throw new Error(data?.error || 'Could not start 3k+ full channel auto-publish.');
      }
      if (data?.job) {
        setBulkJob(data.job as BulkSyncJobState);
        if (data.job.channelTitle) setResolvedChannelTitle(String(data.job.channelTitle));
      }
      showNotification(
        'success',
        `🚀 3k+ Full Channel Auto-Publish shuru ho gaya (${
          configRef.current.onlyValidAudioAndHd ? 'Only 1080p/720p + Valid Audio' : 'All qualities'
        }).`
      );
    } catch (err: any) {
      setScanError(err?.message || 'Could not start bulk channel auto-publish.');
    } finally {
      setStartingBulkJob(false);
    }
  };

  const handleStopBulkPublish = async () => {
    try {
      const resp = await authFetch('/api/telegram/bulk-sync-stop', { method: 'POST' });
      const data = await resp.json();
      if (data?.job) setBulkJob(data.job as BulkSyncJobState);
    } catch {}
  };

  // Inline IMDb Fixer handlers
  const openInlineFixer = async (draft: AutoMovieDraft) => {
    setEditingDraftId(draft.draftId);
    const seedQuery = draft.parsedTitle || draft.title || '';
    setInlineSearchText(seedQuery);
    if (draft.alternateMatches && draft.alternateMatches.length > 0) {
      setInlineSearchResults(draft.alternateMatches);
      return;
    }
    if (seedQuery.trim().length >= 2) {
      await runInlineImdbSearch(seedQuery);
    } else {
      setInlineSearchResults([]);
    }
  };

  const runInlineImdbSearch = async (queryStr: string) => {
    const q = queryStr.trim();
    if (q.length < 2) return;
    setInlineSearching(true);
    try {
      const res = await authFetch(`/api/metadata/search?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setInlineSearchResults(Array.isArray(data?.results) ? data.results : []);
    } catch {
      setInlineSearchResults([]);
    } finally {
      setInlineSearching(false);
    }
  };

  const applyCandidateToDraft = async (draftId: string, candidate: AutoMatchCandidate) => {
    setApplyingFixId(draftId);
    try {
      const res = await authFetch(`/api/metadata/detail?id=${encodeURIComponent(candidate.imdbId)}`);
      const json = await res.json();
      const d = json?.data;

      setDrafts((prev) =>
        prev.map((item) => {
          if (item.draftId !== draftId) return item;
          const poster = upgradePosterUrl(d?.posterUrl || candidate.posterUrl, 1080) || candidate.posterUrl || item.posterUrl;
          const backdrop = upgradePosterUrl(d?.backdropUrl || poster, 1280) || poster;
          return {
            ...item,
            imdbId: d?.imdbId || candidate.imdbId,
            title: d?.title || candidate.title,
            originalTitle: d?.originalTitle || candidate.title,
            releaseYear: Number(d?.releaseYear || parseInt(String(candidate.year || ''), 10) || item.releaseYear),
            posterUrl: poster,
            backdropUrl: backdrop,
            genre: d?.genre || item.genre,
            description: d?.description || item.description,
            director: d?.director || item.director,
            cast: d?.cast || candidate.cast || item.cast,
            runtime: d?.runtime || item.runtime,
            language: d?.language && !item.language.toLowerCase().includes('hindi') ? d.language : item.language,
            rating: Number(d?.rating) || item.rating,
            originalCategory: d?.suggestedCategory || item.originalCategory,
            matchConfidence: poster ? 'high' : 'medium',
            matchReason: 'Manually verified from IMDb',
          };
        })
      );
      setEditingDraftId(null);
      showNotification('success', `✅ Updated poster & IMDb details to "${candidate.title}"!`);
    } catch (err: any) {
      showNotification('error', err?.message || 'Could not fetch selected movie details.');
    } finally {
      setApplyingFixId(null);
    }
  };

  const handlePublishSingleDraft = async (draft: AutoMovieDraft) => {
    if (!draft.title.trim()) {
      showNotification('error', 'Movie title missing hai.');
      await openInlineFixer(draft);
      return;
    }
    setPublishingSingleId(draft.draftId);
    try {
      const res = await publishSingleDraftToFirestore(draft, config.notifyOnNewPublish);
      setDrafts((prev) => prev.filter((d) => d.draftId !== draft.draftId));
      await onBatchComplete();
      if (res.skippedDuplicate) {
        showNotification('success', `"${draft.title}" app me pehle se maujood hai.`);
      } else {
        showNotification('success', `🎉 "${draft.title}" IMDb details ke sath Publish ho gayi!`);
      }
    } catch (err: any) {
      showNotification('error', err?.message || 'Publish failed.');
    } finally {
      setPublishingSingleId(null);
    }
  };

  const handlePublishAllReady = async () => {
    const readyList = drafts.filter((d) => d.posterUrl && d.title.trim());
    if (readyList.length === 0) {
      showNotification('error', 'No movies with valid posters ready to publish.');
      return;
    }

    setPublishingBatch(true);
    let publishedCount = 0;
    let dupCount = 0;
    const publishedIds = new Set<string>();

    try {
      for (let i = 0; i < readyList.length; i++) {
        const item = readyList[i];
        const sendAlert = sendPushOnBatch && i === readyList.length - 1;
        const res = await publishSingleDraftToFirestore(item, sendAlert);
        if (res.published) {
          publishedCount++;
          publishedIds.add(item.draftId);
        } else if (res.skippedDuplicate) {
          dupCount++;
          publishedIds.add(item.draftId);
        }
      }

      setDrafts((prev) => prev.filter((d) => !publishedIds.has(d.draftId)));
      await onBatchComplete();
      showNotification(
        'success',
        `🎉 ${publishedCount} movies IMDb posters & full details ke sath Publish ho gayi!${
          dupCount > 0 ? ` (${dupCount} duplicates skipped)` : ''
        }`
      );
    } catch (err: any) {
      showNotification('error', err?.message || 'Batch publish error.');
    } finally {
      setPublishingBatch(false);
    }
  };

  const filteredDrafts = useMemo(() => {
    if (filterView === 'verified') return drafts.filter((d) => d.matchConfidence === 'high' && d.posterUrl);
    if (filterView === 'review') return drafts.filter((d) => d.matchConfidence !== 'high' || !d.posterUrl);
    return drafts;
  }, [drafts, filterView]);

  const readyCount = useMemo(() => drafts.filter((d) => Boolean(d.posterUrl && d.title.trim())).length, [drafts]);
  const reviewCount = useMemo(
    () => drafts.filter((d) => d.matchConfidence !== 'high' || !d.posterUrl).length,
    [drafts]
  );

  return (
    <div className="mb-8 bg-neutral-900 border border-yellow-500/30 rounded-2xl shadow-2xl overflow-hidden">
      {/* Header Bar */}
      <div className="px-4 sm:px-6 py-4 bg-gradient-to-r from-neutral-900 via-neutral-900 to-yellow-500/10 border-b border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-400/15 border border-yellow-400/40 flex items-center justify-center text-yellow-400 flex-shrink-0">
            <UploadCloud size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-black text-white tracking-tight">
                Telegram Channel → Auto IMDb & Auto-Publish Movies & Series
              </h2>
              {config.autoWatchEnabled && config.channelUrl && (
                <span className="inline-flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded bg-emerald-950/90 text-emerald-400 border border-emerald-700/60">
                  <Radio size={10} className="animate-pulse" /> 24/7 Auto-Publish Active
                </span>
              )}
              {drafts.length > 0 && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded bg-yellow-400 text-black">
                  {drafts.length} In Review
                </span>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Channel me movie ya web/anime series upload karein — app automatically sahi IMDb poster, rating, cast, plot, episodes & category fill karke publish karega.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {config.channelUrl && (
            <button
              type="button"
              onClick={() => handleCheckNewUploads(false)}
              disabled={scanning}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black text-xs px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            >
              <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
              <span>Check New Uploads</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            className="bg-neutral-800 hover:bg-neutral-700 text-white font-bold text-xs px-3.5 py-2 rounded-xl border border-neutral-700 flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            <span>{expanded ? 'Hide Auto-Sync' : 'Setup / Scan Channel'}</span>
          </button>
        </div>
      </div>

      {/* Expandable Workspace */}
      {(expanded || drafts.length > 0) && (
        <div className="p-4 sm:p-6 space-y-5">
          {/* Quick Mode Switcher + Config */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-7 bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 bg-neutral-900 p-1 rounded-lg border border-neutral-800">
                  <button
                    type="button"
                    onClick={() => setScanTab('new')}
                    className={`px-3 py-1.5 rounded-md text-xs font-black transition-all cursor-pointer ${
                      scanTab === 'new'
                        ? 'bg-yellow-400 text-black'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    1. Auto-Sync New Uploads
                  </button>
                  <button
                    type="button"
                    onClick={() => setScanTab('full')}
                    className={`px-3 py-1.5 rounded-md text-xs font-black transition-all cursor-pointer ${
                      scanTab === 'full'
                        ? 'bg-yellow-400 text-black'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    2. Scan Old / Full Channel
                  </button>
                </div>

                {config.lastSyncedMsgId > 0 && (
                  <span className="text-[10px] font-mono text-gray-400 bg-neutral-900 px-2 py-1 rounded border border-neutral-800">
                    Last Synced Post: <strong className="text-yellow-400">#{config.lastSyncedMsgId}</strong>
                  </span>
                )}
              </div>

              {scanTab === 'new' ? (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-gray-300">
                        Saved Telegram Channel Invite / Post Link
                      </label>
                      {resolvedChannelTitle && (
                        <span className="text-[10px] font-bold text-emerald-400">
                          ✓ Connected: {resolvedChannelTitle}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={config.channelUrl}
                        onChange={(e) => setConfig((p) => ({ ...p, channelUrl: e.target.value }))}
                        placeholder="https://t.me/+s2Qki5-sfnVjZTI1"
                        className="flex-grow bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-yellow-400"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          const targetUrl = config.channelUrl.trim();
                          if (!targetUrl) return;
                          setScanError('');
                          try {
                            const infoRes = await authFetch('/api/telegram/resolve-channel-info', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ channelRef: targetUrl }),
                            });
                            const infoJson = await infoRes.json();
                            if (!infoRes.ok || !infoJson?.success) {
                              await saveSyncConfig({ ...config, channelUrl: targetUrl });
                              setScanError(
                                infoJson?.error ||
                                  'Channel saved, lekin Bot abhi isko resolve nahi kar paya. Bot ko Admin banakar 1 message bhejein ya 1 post link daalein.'
                              );
                              return;
                            }
                            if (infoJson?.channelTitle) setResolvedChannelTitle(String(infoJson.channelTitle));
                            const parsed = parseTelegramUrl(targetUrl);
                            const nextId =
                              config.lastSyncedMsgId > 0
                                ? config.lastSyncedMsgId
                                : parsed.messageId
                                ? Math.max(0, parseInt(parsed.messageId, 10) - 1)
                                : Math.max(0, Number(infoJson?.latestMsgId || 0) - 25);
                            await saveSyncConfig({
                              ...config,
                              channelUrl: targetUrl,
                              lastSyncedMsgId: nextId,
                            });
                            showNotification('success', `✅ Channel "${infoJson?.channelTitle || 'Saved'}" connected! Ab nayi uploads check ho sakti hain.`);
                          } catch {
                            await saveSyncConfig({ ...config, channelUrl: targetUrl });
                            showNotification('success', '✅ Channel saved!');
                          }
                        }}
                        disabled={!config.channelUrl.trim()}
                        className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-40 text-black font-black text-xs px-3.5 py-2 rounded-lg cursor-pointer whitespace-nowrap"
                      >
                        Save Channel
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => handleCheckNewUploads(false)}
                      disabled={scanning || !config.channelUrl.trim()}
                      className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black text-xs px-4 py-2.5 rounded-lg flex items-center gap-2 cursor-pointer transition-all"
                    >
                      {scanning ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                      <span>Check & Auto-Fill New Uploads Now</span>
                    </button>
                    <span className="text-[11px] text-gray-400">
                      Bot (<code className="text-yellow-400">@Movies_Direct_Group_Bot</code>) ko channel me Admin rakhein.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-bold text-gray-300 mb-1">
                        Starting Post Link (Optional — blank = #1 se)
                      </label>
                      <input
                        type="text"
                        value={rangeStartUrl}
                        onChange={(e) => setRangeStartUrl(e.target.value)}
                        placeholder="https://t.me/c/.../1 (blank = start from #1)"
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-yellow-400"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-gray-300 mb-1">
                        Channel / Any 1 Post Link (blank = Saved Channel)
                      </label>
                      <input
                        type="text"
                        value={rangeEndUrl}
                        onChange={(e) => setRangeEndUrl(e.target.value)}
                        placeholder={config.channelUrl || 'https://t.me/+P5UeGT1YlQ9lOGZl'}
                        className="w-full bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-yellow-400"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    {!rangeStartUrl.trim() && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-300">
                        <span>Start from Post #:</span>
                        <input
                          type="number"
                          min={1}
                          value={startFromMsgNum}
                          onChange={(e) => setStartFromMsgNum(e.target.value)}
                          className="w-20 bg-neutral-900 border border-neutral-800 rounded-lg px-2 py-1.5 text-xs text-white font-mono"
                        />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleStartBulkPublish()}
                      disabled={
                        startingBulkJob ||
                        bulkJob?.status === 'running' ||
                        (!rangeEndUrl.trim() && !rangeStartUrl.trim() && !config.channelUrl.trim())
                      }
                      className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black text-xs px-4 py-2.5 rounded-lg flex items-center gap-2 cursor-pointer transition-all"
                    >
                      {startingBulkJob || bulkJob?.status === 'running' ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <UploadCloud size={14} />
                      )}
                      <span>Start 3k+ Full Channel Auto-Publish</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleScanExistingChannel}
                      disabled={scanning || (!rangeEndUrl.trim() && !config.channelUrl.trim())}
                      className="bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-black font-black text-xs px-3.5 py-2.5 rounded-lg flex items-center gap-2 cursor-pointer transition-all"
                    >
                      {scanning ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                      <span>Scan & Preview Drafts</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Automation Rules Card */}
            <div className="lg:col-span-5 bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-yellow-400">
                Smart Accuracy & Auto-Publish Rules
              </h3>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.onlyValidAudioAndHd}
                  onChange={(e) =>
                    saveSyncConfig({ ...config, onlyValidAudioAndHd: e.target.checked })
                  }
                  className="mt-0.5 accent-emerald-400 w-4 h-4 rounded"
                />
                <span className="text-xs text-gray-200 leading-snug">
                  <strong className="text-emerald-400">Only 1080p / 720p with Valid Audio (Skip No-Audio):</strong> Sirf wahi movies aur episodes publish honge jinme working audio track aur 1080p ya 720p quality hai (muted / no-audio / 480p / 360p skip).
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoPublishVerified}
                  onChange={(e) =>
                    saveSyncConfig({ ...config, autoPublishVerified: e.target.checked })
                  }
                  className="mt-0.5 accent-emerald-400 w-4 h-4 rounded"
                />
                <span className="text-xs text-gray-200 leading-snug">
                  <strong className="text-white">Auto-Publish Verified Matches:</strong> Sahi IMDb poster & year confirm hone par movies aur series episodes seedha app me publish ho jayenge; doubtful matches Review me rukenge.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoWatchEnabled}
                  onChange={(e) =>
                    saveSyncConfig({ ...config, autoWatchEnabled: e.target.checked })
                  }
                  className="mt-0.5 accent-yellow-400 w-4 h-4 rounded"
                />
                <span className="text-xs text-gray-200 leading-snug">
                  <strong className="text-white">24/7 Background Auto-Sync:</strong> Channel me movie/series upload hote hi background server aur Admin Panel apne aap auto-publish karenge.
                </span>
              </label>

              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.notifyOnNewPublish}
                  onChange={(e) =>
                    saveSyncConfig({ ...config, notifyOnNewPublish: e.target.checked })
                  }
                  className="mt-0.5 accent-yellow-400 w-4 h-4 rounded"
                />
                <span className="text-xs text-gray-200 leading-snug">
                  <strong className="text-white">Send Release Notification:</strong> Nayi upload publish hone par users ko phone alert bhejein (max 3 new at once).
                </span>
              </label>

              <p className="text-[10px] text-gray-400 bg-neutral-900 border border-neutral-800 rounded-lg p-2">
                Tip: Movie ke liye <span className="text-yellow-400 font-mono">Pushpa 2 (2024) 1080p</span> ya Series ke liye <span className="text-yellow-400 font-mono">Stranger Things S01E01 1080p</span> (ya IMDb link) daalne se 100% exact IMDb auto-fill hota hai.
              </p>
            </div>
          </div>

          {/* 3k+ Bulk Channel Job Progress Card */}
          {bulkJob && bulkJob.status !== 'idle' && (
            <div className="bg-neutral-950 border border-emerald-700/50 rounded-xl p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {bulkJob.status === 'running' ? (
                    <Loader2 size={15} className="text-emerald-400 animate-spin" />
                  ) : bulkJob.status === 'completed' ? (
                    <CheckCircle2 size={15} className="text-emerald-400" />
                  ) : (
                    <AlertCircle size={15} className="text-amber-400" />
                  )}
                  <span className="text-xs font-black text-white">
                    3k+ Auto-Publish ({bulkJob.channelTitle || bulkJob.channelId}) —{' '}
                    <span className="uppercase text-yellow-400">{bulkJob.status.replace('_', ' ')}</span>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {bulkJob.status === 'running' && (
                    <button
                      type="button"
                      onClick={handleStopBulkPublish}
                      className="bg-red-600/90 hover:bg-red-500 text-white text-[11px] font-black px-3 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                    >
                      <Square size={10} className="fill-white" />
                      <span>Stop</span>
                    </button>
                  )}
                  {(bulkJob.status === 'stopped' || bulkJob.status === 'quota_paused') &&
                    bulkJob.currentMsgId < bulkJob.endMsgId && (
                      <button
                        type="button"
                        onClick={() => handleStartBulkPublish(bulkJob.currentMsgId)}
                        className="bg-emerald-500 hover:bg-emerald-400 text-black text-[11px] font-black px-3 py-1 rounded-lg cursor-pointer"
                      >
                        Resume from #{bulkJob.currentMsgId}
                      </button>
                    )}
                </div>
              </div>

              <div className="w-full h-2 bg-neutral-900 rounded-full overflow-hidden border border-neutral-800">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{
                    width: `${
                      bulkJob.endMsgId > bulkJob.startMsgId
                        ? Math.min(
                            100,
                            Math.round(
                              ((bulkJob.currentMsgId - bulkJob.startMsgId + 1) /
                                (bulkJob.endMsgId - bulkJob.startMsgId + 1)) *
                                100
                            )
                          )
                        : bulkJob.status === 'completed'
                        ? 100
                        : 0
                    }%`,
                  }}
                />
              </div>

              <div className="flex flex-wrap gap-3 text-[11px] text-gray-300 font-mono">
                <span>
                  Posts: <strong className="text-white">#{bulkJob.currentMsgId}</strong> / #{bulkJob.endMsgId}
                </span>
                <span className="text-emerald-400 font-bold">
                  Published: {bulkJob.publishedCount} (+{bulkJob.mergedCount} merged)
                </span>
                <span className="text-amber-300">Skipped No-Audio: {bulkJob.skippedNoAudio}</span>
                <span className="text-orange-300">Skipped &lt;720p: {bulkJob.skippedLowQuality}</span>
                <span className="text-gray-400">Duplicates: {bulkJob.skippedDuplicates}</span>
              </div>

              {bulkJob.errorMessage && (
                <div className="text-xs text-amber-300 bg-amber-950/50 border border-amber-800/70 rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                  <span>{bulkJob.errorMessage}</span>
                  {bulkJob.upgradeUrl && (
                    <a
                      href={bulkJob.upgradeUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-yellow-400 underline font-bold"
                    >
                      Open Firebase Quota Upgrade
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Scan Status / Progress / Errors */}
          {scanProgressText && (
            <div className="bg-yellow-400/10 border border-yellow-400/40 rounded-xl px-4 py-2.5 flex items-center gap-2.5 text-xs text-yellow-300 font-bold">
              <Loader2 size={15} className="animate-spin flex-shrink-0" />
              <span>{scanProgressText}</span>
            </div>
          )}

          {scanError && (
            <div className="bg-red-950/60 border border-red-800 rounded-xl px-4 py-2.5 flex items-center justify-between gap-2 text-xs text-red-300 font-semibold">
              <div className="flex items-center gap-2">
                <AlertCircle size={15} className="flex-shrink-0" />
                <span>{scanError}</span>
              </div>
              <button type="button" onClick={() => setScanError('')} className="text-red-400 hover:text-white cursor-pointer">
                <X size={14} />
              </button>
            </div>
          )}

          {lastScanStats && !scanProgressText && (
            <div className="text-[11px] text-emerald-300 bg-emerald-950/40 border border-emerald-800/50 rounded-lg px-3 py-2 flex items-center justify-between gap-2 flex-wrap">
              <span>{lastScanStats}</span>
              {drafts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setDrafts([])}
                  className="text-gray-400 hover:text-white text-[10px] underline cursor-pointer"
                >
                  Clear Review Queue
                </button>
              )}
            </div>
          )}

          {/* Visual Poster Review & Bulk Publish Grid */}
          {drafts.length > 0 && (
            <div className="space-y-4 pt-2 border-t border-neutral-800">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setFilterView('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                      filterView === 'all'
                        ? 'bg-white text-black border-white'
                        : 'bg-neutral-950 text-gray-300 border-neutral-800'
                    }`}
                  >
                    All ({drafts.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterView('verified')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                      filterView === 'verified'
                        ? 'bg-emerald-500 text-black border-emerald-500'
                        : 'bg-neutral-950 text-emerald-400 border-neutral-800'
                    }`}
                  >
                    ✓ Verified ({drafts.length - reviewCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterView('review')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                      filterView === 'review'
                        ? 'bg-amber-400 text-black border-amber-400'
                        : 'bg-neutral-950 text-amber-400 border-neutral-800'
                    }`}
                  >
                    ⚠ Needs Poster Check ({reviewCount})
                  </button>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sendPushOnBatch}
                      onChange={(e) => setSendPushOnBatch(e.target.checked)}
                      className="accent-yellow-400 w-3.5 h-3.5"
                    />
                    <Bell size={12} className="text-yellow-400" />
                    <span>Notify users on Publish All</span>
                  </label>
                  <button
                    type="button"
                    onClick={handlePublishAllReady}
                    disabled={publishingBatch || readyCount === 0}
                    className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black text-xs px-4 py-2.5 rounded-xl flex items-center gap-1.5 shadow-lg shadow-emerald-500/20 cursor-pointer transition-all"
                  >
                    {publishingBatch ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={15} />}
                    <span>Publish All Ready Movies ({readyCount})</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredDrafts.map((draft) => {
                  const isEditingThis = editingDraftId === draft.draftId;
                  const qualityTags = Object.keys(draft.videoQualities || {});

                  return (
                    <div
                      key={draft.draftId}
                      className={`bg-neutral-950 border rounded-xl overflow-hidden flex flex-col ${
                        draft.matchConfidence === 'high' && draft.posterUrl
                          ? 'border-emerald-800/60'
                          : draft.posterUrl
                          ? 'border-amber-700/60'
                          : 'border-red-800/70'
                      }`}
                    >
                      <div className="flex gap-3 p-3">
                        {/* Poster Thumbnail */}
                        <div className="w-24 aspect-[2/3] flex-shrink-0 rounded-lg overflow-hidden bg-neutral-900 border border-neutral-800 relative">
                          {draft.posterUrl ? (
                            <img
                              src={draft.posterUrl}
                              alt={draft.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex flex-col items-center justify-center text-gray-600 p-2 text-center">
                              <Film size={20} />
                              <span className="text-[9px] mt-1 font-bold">No Poster</span>
                            </div>
                          )}
                          <span
                            className={`absolute top-1 left-1 text-[9px] font-black px-1.5 py-0.5 rounded ${
                              draft.matchConfidence === 'high' && draft.posterUrl
                                ? 'bg-emerald-500 text-black'
                                : draft.posterUrl
                                ? 'bg-amber-400 text-black'
                                : 'bg-red-600 text-white'
                            }`}
                          >
                            {draft.matchConfidence === 'high' && draft.posterUrl
                              ? '✓ Verified'
                              : draft.posterUrl
                              ? '⚠ Check'
                              : '✗ Missing'}
                          </span>
                        </div>

                        {/* Metadata Info */}
                        <div className="min-w-0 flex-1 flex flex-col justify-between space-y-1.5">
                          <div>
                            <h4 className="text-xs font-black text-white line-clamp-2 leading-snug">
                              {draft.title}
                            </h4>
                            <div className="flex items-center gap-1.5 mt-1 text-[10px] text-gray-400 flex-wrap">
                              <span className="text-yellow-400 font-bold">{draft.releaseYear}</span>
                              <span>•</span>
                              <span className="text-emerald-400 font-bold">★ {draft.rating}</span>
                              {draft.runtime && (
                                <>
                                  <span>•</span>
                                  <span>{draft.runtime}</span>
                                </>
                              )}
                            </div>

                            <select
                              value={draft.originalCategory}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDrafts((prev) =>
                                  prev.map((d) =>
                                    d.draftId === draft.draftId ? { ...d, originalCategory: val } : d
                                  )
                                );
                              }}
                              className="mt-1.5 w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-[10px] font-bold text-gray-200 focus:outline-none focus:border-yellow-400"
                            >
                              {CATEGORY_OPTIONS.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>

                            <input
                              type="text"
                              value={draft.language}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDrafts((prev) =>
                                  prev.map((d) =>
                                    d.draftId === draft.draftId ? { ...d, language: val } : d
                                  )
                                );
                              }}
                              placeholder="Language (Hindi)"
                              className="mt-1 w-full bg-neutral-900 border border-neutral-800 rounded px-2 py-1 text-[10px] text-gray-200 focus:outline-none focus:border-yellow-400"
                            />
                          </div>

                          <div className="flex flex-wrap gap-1">
                            {(draft.isSeriesEpisode || draft.originalCategory.toLowerCase().includes('series')) && (
                              <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-purple-950/90 text-purple-300 border border-purple-700/60">
                                {`S${String(draft.seasonNumber || 1).padStart(2, '0')} • E${draft.episodeLabel || String(draft.episodeNumber || 1).padStart(2, '0')}`}
                              </span>
                            )}
                            {qualityTags.length > 0 ? (
                              qualityTags.map((q) => (
                                <span
                                  key={q}
                                  className="text-[9px] font-black px-1.5 py-0.5 rounded bg-neutral-800 text-yellow-400 border border-neutral-700"
                                >
                                  {q}
                                </span>
                              ))
                            ) : (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-neutral-800 text-gray-300">
                                Msg #{draft.msgId}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Source Telegram Filename + Confidence Reason */}
                      <div className="px-3 pb-2 space-y-1">
                        <p
                          className="text-[10px] font-mono text-gray-400 truncate bg-neutral-900 px-2 py-1 rounded border border-neutral-800/80"
                          title={`${draft.sourceFileName}\n${draft.sourceCaption}`}
                        >
                          TG: {draft.sourceFileName}
                        </p>
                        <p className="text-[10px] text-gray-400 truncate">{draft.matchReason}</p>
                      </div>

                      {/* Inline IMDb Switcher */}
                      {isEditingThis && (
                        <div className="mx-3 mb-2 p-2.5 bg-neutral-900 border border-yellow-500/40 rounded-lg space-y-2">
                          <div className="flex gap-1.5">
                            <input
                              type="text"
                              value={inlineSearchText}
                              onChange={(e) => setInlineSearchText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  runInlineImdbSearch(inlineSearchText);
                                }
                              }}
                              placeholder="Search movie name or tt123..."
                              className="flex-grow bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-[11px] text-white focus:outline-none focus:border-yellow-400"
                            />
                            <button
                              type="button"
                              onClick={() => runInlineImdbSearch(inlineSearchText)}
                              disabled={inlineSearching}
                              className="bg-yellow-400 text-black font-black text-[10px] px-2.5 py-1 rounded cursor-pointer"
                            >
                              {inlineSearching ? '...' : 'Find'}
                            </button>
                          </div>

                          <div className="max-h-40 overflow-y-auto space-y-1">
                            {inlineSearchResults.map((cand) => (
                              <button
                                key={cand.imdbId}
                                type="button"
                                disabled={applyingFixId === draft.draftId}
                                onClick={() => applyCandidateToDraft(draft.draftId, cand)}
                                className="w-full text-left flex items-center gap-2 p-1.5 rounded bg-neutral-950 hover:bg-yellow-400/15 border border-neutral-800 hover:border-yellow-400/50 transition-colors cursor-pointer"
                              >
                                {cand.posterUrl ? (
                                  <img
                                    src={cand.posterUrl}
                                    alt={cand.title}
                                    referrerPolicy="no-referrer"
                                    className="w-7 h-10 object-cover rounded flex-shrink-0"
                                  />
                                ) : (
                                  <div className="w-7 h-10 bg-neutral-800 rounded flex items-center justify-center flex-shrink-0">
                                    <Film size={12} />
                                  </div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="text-[11px] font-bold text-white truncate">{cand.title}</p>
                                  <p className="text-[9px] text-gray-400">
                                    {cand.year} • {cand.type}
                                  </p>
                                </div>
                                <Check size={12} className="text-yellow-400 flex-shrink-0" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Card Footer Buttons */}
                      <div className="mt-auto px-3 pb-3 pt-1 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            isEditingThis ? setEditingDraftId(null) : openInlineFixer(draft)
                          }
                          className="flex-1 bg-neutral-900 hover:bg-neutral-800 text-yellow-400 font-bold text-[11px] py-1.5 px-2 rounded-lg border border-neutral-800 flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Search size={11} />
                          <span>{isEditingThis ? 'Close' : 'Change IMDb'}</span>
                        </button>
                        <button
                          type="button"
                          disabled={publishingSingleId === draft.draftId}
                          onClick={() => handlePublishSingleDraft(draft)}
                          className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-black text-[11px] py-1.5 px-2 rounded-lg flex items-center justify-center gap-1 cursor-pointer"
                        >
                          {publishingSingleId === draft.draftId ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Play size={11} className="fill-black" />
                          )}
                          <span>Publish</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDrafts((prev) => prev.filter((d) => d.draftId !== draft.draftId));
                            authFetch('/api/telegram/dismiss-review-draft', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ draftId: draft.draftId }),
                            }).catch(() => {});
                          }}
                          title="Remove from queue"
                          className="p-1.5 bg-neutral-900 hover:bg-red-950/60 text-gray-400 hover:text-red-400 rounded-lg border border-neutral-800 cursor-pointer"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
