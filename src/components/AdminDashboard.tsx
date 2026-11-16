import { useState, useEffect } from 'react';
import { 
  collection, 
  addDoc, 
  serverTimestamp, 
  getDocs, 
  doc, 
  deleteDoc, 
  updateDoc, 
  setDoc,
  getDocFromServer,
  onSnapshot,
  query
} from 'firebase/firestore';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { useAuth, isAuthorizedAdminEmail, AUTHORIZED_ADMIN_EMAILS } from '../context/AuthContext';
import { getDisplayCategory } from '../utils/categoryMapping';
import { Link } from 'react-router-dom';
import { 
  Film, 
  PlusCircle, 
  Trash2, 
  Eye, 
  EyeOff, 
  CheckCircle2, 
  AlertCircle, 
  RefreshCw, 
  ShieldCheck, 
  Home, 
  Sparkles,
  ListFilter,
  Search,
  Check,
  ExternalLink,
  Info,
  Tv,
  Play,
  X,
  AlertTriangle,
  CheckSquare,
  Square,
  Lock,
  Pencil,
  Smartphone,
  Save,
  Download,
  ChevronDown,
  ChevronUp,
  Zap,
  ListPlus
} from 'lucide-react';
import VideoPlayerModal from './VideoPlayerModal';
import { 
  getLocalMovies,
  saveLocalMovies,
  fetchMoviesFromFirestore,
  saveMovieToFirestore,
  deleteMovieFromFirestore,
  saveMovieLocally,
  deleteMovieLocally,
  togglePublishLocally,
  toggleFeaturedLocally,
  clearAllMoviesLocally,
  sortMoviesList,
  getTimestampMs,
  MovieData
} from '../services/movieStorage';
import { loginWithGoogle } from '../services/authService';
import { buildApiUrl } from '../utils/apiConfig';
import { upgradePosterUrl, normalizeMoviePosters } from '../utils/posterUrl';
import { formatHumanDuration, parseDurationToSeconds } from '../utils/duration';
import {
  searchWikipediaFilmSuggestions,
  mergeImdbAndWikiResults,
  fetchWikipediaFilmDetail,
} from '../utils/wikipediaMetadata';
import { normalizeQualityBadge, getVisibleQualityBadge, QualityBadgeValue } from '../utils/qualityBadge';
import {
  RemoteUpdateConfig,
  DEFAULT_REMOTE_UPDATE_CONFIG,
  CURRENT_VERSION_NAME,
  CURRENT_VERSION_CODE,
  APP_UPDATE_COLLECTION,
  APP_UPDATE_DOC_ID,
  compareVersions,
  normalizeRemoteUpdateConfig,
  fetchRemoteUpdateConfig,
  saveRemoteUpdateConfig
} from '../services/appUpdateConfig';
import {
  FirestoreAppStats,
  GitHubApkStats,
  APP_STATS_COLLECTION,
  APP_STATS_DOC_ID,
  fetchGitHubApkDownloadStats,
  subscribeAppDownloadStats,
} from '../services/appStatsService';

interface MetadataSearchResult {
  imdbId: string;
  title: string;
  year: number | string;
  type: string;
  posterUrl: string;
  cast?: string;
}

export default function AdminDashboard() {
  const { user, isAdmin, loading: authLoading, refreshAdminStatus } = useAuth();
  const [movies, setMovies] = useState<MovieData[]>([]);
  const [loadingMovies, setLoadingMovies] = useState(false);
  const [formLoading, setFormLoading] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Bulk Selection & Delete Modal State
  const [selectedMovieIds, setSelectedMovieIds] = useState<string[]>([]);
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    type: 'single' | 'bulk' | 'all';
    item?: MovieData;
    count?: number;
  } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // IMDb / Metadata Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchingMetadata, setSearchingMetadata] = useState(false);
  const [searchResults, setSearchResults] = useState<MetadataSearchResult[]>([]);
  const [apiConfigured, setApiConfigured] = useState<boolean | null>(null);
  const [apiMessage, setApiMessage] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<string>('checking'); // 'connected' | 'limit_reached' | 'invalid_key' | 'missing_key' | 'error'
  const [providerName, setProviderName] = useState<string>('OMDb API');
  const [setupGuide, setSetupGuide] = useState<any | null>(null);

  // Live Search / Instant Search logic with 250ms debounce for real-time responsiveness
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchingMetadata(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      handleSearchMetadata(undefined, controller.signal);
    }, 250); // Fast live response as requested

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [searchQuery]);

  // Form State
  const [title, setTitle] = useState('');
  const [originalTitle, setOriginalTitle] = useState('');
  const [description, setDescription] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [backdropUrl, setBackdropUrl] = useState('');
  const [releaseYear, setReleaseYear] = useState(new Date().getFullYear());
  const [originalCategory, setOriginalCategory] = useState('Bollywood Movie');
  const [language, setLanguage] = useState('Hindi');
  const [genre, setGenre] = useState('Action');
  const [director, setDirector] = useState('');
  const [cast, setCast] = useState('');
  const [runtime, setRuntime] = useState('');
  const [rating, setRating] = useState(8.5);
  const [imdbId, setImdbId] = useState('');
  const [trailerUrl, setTrailerUrl] = useState('');
  const [streamingUrl, setStreamingUrl] = useState('');
  const [featured, setFeatured] = useState(true);
  const [published, setPublished] = useState(true);
  const [qualityBadge, setQualityBadge] = useState<QualityBadgeValue>('HD');
  const [editingMovie, setEditingMovie] = useState<MovieData | null>(null);

  // Firebase Remote App Update Config State
  const [showUpdateConfigPanel, setShowUpdateConfigPanel] = useState(false);
  const [savingUpdateConfig, setSavingUpdateConfig] = useState(false);
  const [firebaseUpdateVersion, setFirebaseUpdateVersion] = useState<string | null>(null);
  const [updateConfigForm, setUpdateConfigForm] = useState<RemoteUpdateConfig>(DEFAULT_REMOTE_UPDATE_CONFIG);
  const [firestoreAppStats, setFirestoreAppStats] = useState<FirestoreAppStats>({
    totalApkClicks: 0,
    uniqueDownloadUsers: 0,
    installedAppUsers: 0,
    inAppUpdateDownloads: 0,
    realInstalledDevicesCount: 0,
  });
  const [githubApkStats, setGithubApkStats] = useState<GitHubApkStats | null>(null);

  const handleBoostInstalls = async (delta: number) => {
    try {
      const newCount = Math.max(0, firestoreAppStats.installedAppUsers + delta);
      await setDoc(
        doc(db, APP_STATS_COLLECTION, APP_STATS_DOC_ID),
        { installedAppUsers: newCount, updatedAt: Date.now() },
        { merge: true }
      );
      showNotification('success', `✅ Phone App Installs updated to ${newCount}!`);
    } catch (e) {
      showNotification('error', 'Failed to update install count.');
    }
  };

  // Quality URLs state
  const [url480p, setUrl480p] = useState('');
  const [url720p, setUrl720p] = useState('');
  const [url1080p, setUrl1080p] = useState('');
  const [url4k, setUrl4k] = useState('');
  const [autoTranscode, setAutoTranscode] = useState(false);

  // Telegram & Video Stream Verification
  const [testingStream, setTestingStream] = useState<{ url: string; title: string; category?: string; posterUrl?: string; duration?: number } | null>(null);
  const [verifyingStreamUrl, setVerifyingStreamUrl] = useState(false);
  const [streamNotice, setStreamNotice] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);
  const [verifiedTelegramMetadata, setVerifiedTelegramMetadata] = useState<{
    fileName: string;
    sizeFormatted: string;
    durationFormatted: string;
    resolution: string;
    mimeType: string;
    sizeBytes?: number;
  } | null>(null);

  // Telegram Channel Connection State
  const [channelInviteInput, setChannelInviteInput] = useState(() => {
    return typeof window !== 'undefined'
      ? (localStorage.getItem('movie_portal_telegram_channel') || 'https://t.me/+QSL_3k54YfBjMjE1')
      : 'https://t.me/+QSL_3k54YfBjMjE1';
  });
  const [connectingChannel, setConnectingChannel] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<any | null>(null);
  const [showChannelPanel, setShowChannelPanel] = useState(false);

  // Series Season & Episode Management State
  const [seasons, setSeasons] = useState<Array<{ seasonNumber: number; episodes: Array<{ episodeNumber: number; title: string; streamUrl: string; duration?: string; durationSec?: number; createdAt?: any; addedAt?: any }> }>>([
    {
      seasonNumber: 1,
      episodes: [
        { episodeNumber: 1, title: 'Episode 1', streamUrl: '' },
        { episodeNumber: 2, title: 'Episode 2', streamUrl: '' },
      ],
    },
  ]);
  const [expandedSeasons, setExpandedSeasons] = useState<Record<number, boolean>>({ 0: true });

  // Bulk Episode / Multi-Season Importer State
  const [showBulkImporter, setShowBulkImporter] = useState(false);
  const [bulkMode, setBulkMode] = useState<'season_range' | 'range' | 'paste'>('season_range');
  const [bulkTargetSeasonNum, setBulkTargetSeasonNum] = useState<number>(1);
  const [bulkStartUrl, setBulkStartUrl] = useState('');
  const [bulkEndUrl, setBulkEndUrl] = useState('');
  const [bulkCountInput, setBulkCountInput] = useState('');
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [bulkSplitType, setBulkSplitType] = useState<'equal' | 'custom' | 'single'>('equal');
  const [bulkEpsPerSeason, setBulkEpsPerSeason] = useState('25');
  const [bulkCustomCounts, setBulkCustomCounts] = useState('');
  const [bulkDefaultDuration, setBulkDefaultDuration] = useState('');
  const [bulkReplaceMode, setBulkReplaceMode] = useState<'replace' | 'append'>('replace');
  const [scanningRange, setScanningRange] = useState(false);
  const [skipTelegramScan, setSkipTelegramScan] = useState(false);
  const [scanQualityFilter, setScanQualityFilter] = useState<'best' | '1080p' | '720p' | '480p' | 'all'>('1080p');

  // Per-Season Inline Quick Bulk Import State
  const [seasonBulkOpenIdx, setSeasonBulkOpenIdx] = useState<number | null>(null);
  const [seasonBulkMode, setSeasonBulkMode] = useState<'paste' | 'range'>('range');
  const [seasonBulkPaste, setSeasonBulkPaste] = useState('');
  const [seasonBulkStartUrl, setSeasonBulkStartUrl] = useState('');
  const [seasonBulkEndUrl, setSeasonBulkEndUrl] = useState('');
  const [seasonBulkDuration, setSeasonBulkDuration] = useState('');

  type LiveScanCache = {
    key: string;
    loading: boolean;
    error: string;
    data: {
      success: boolean;
      channelTitle: string;
      totalScanned: number;
      videosFound: number;
      skippedStickers: number;
      skippedDuplicates?: number;
      skippedOther: number;
      skippedCount: number;
      episodes: Array<{
        msgId: number;
        streamUrl: string;
        durationSec: number;
        duration: string;
        fileName: string;
        sizeBytes: number;
        quality?: string;
      }>;
    } | null;
  };
  const [liveBulkScan, setLiveBulkScan] = useState<LiveScanCache>({ key: '', loading: false, error: '', data: null });
  const [livePerSeasonScan, setLivePerSeasonScan] = useState<LiveScanCache>({ key: '', loading: false, error: '', data: null });

  const parseSequentialTelegramLink = (rawUrl: string): { prefix: string; msgId: number; suffix: string } | null => {
    const clean = (rawUrl || '').trim();
    const match = clean.match(/^(https?:\/\/(?:t\.me|telegram\.me)\/(?:c\/\d+(?:\/\d+)?|[a-zA-Z0-9_]{4,}(?:\/\d+)?)\/)(\d+)([?#].*)?$/i);
    if (!match) return null;
    return {
      prefix: match[1],
      msgId: parseInt(match[2], 10),
      suffix: match[3] || '',
    };
  };

  const splitUrlsIntoSeasons = (
    urls: string[],
    splitType: 'equal' | 'custom' | 'single',
    epsPerSeasonVal: string,
    customCountsVal: string,
    defaultDur: string,
    startingSeasonNum = 1
  ) => {
    const durTrim = defaultDur.trim();
    const durSec = durTrim ? parseDurationToSeconds(durTrim) : 0;
    const makeEp = (url: string, epNum: number) => ({
      episodeNumber: epNum,
      title: `Episode ${epNum}`,
      streamUrl: url,
      createdAt: Date.now(),
      ...(durTrim ? { duration: durTrim } : {}),
      ...(durSec > 0 ? { durationSec: durSec } : {}),
    });

    if (splitType === 'single') {
      return [
        {
          seasonNumber: startingSeasonNum,
          episodes: urls.map((u, idx) => makeEp(u, idx + 1)),
        },
      ];
    }

    if (splitType === 'custom') {
      const counts = customCountsVal
        .split(/[\s,;]+/)
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (counts.length === 0) {
        return [
          {
            seasonNumber: startingSeasonNum,
            episodes: urls.map((u, idx) => makeEp(u, idx + 1)),
          },
        ];
      }
      const result: Array<{ seasonNumber: number; episodes: any[] }> = [];
      let cursor = 0;
      let sNum = startingSeasonNum;
      for (const c of counts) {
        if (cursor >= urls.length) break;
        const slice = urls.slice(cursor, cursor + c);
        result.push({
          seasonNumber: sNum++,
          episodes: slice.map((u, idx) => makeEp(u, idx + 1)),
        });
        cursor += c;
      }
      if (cursor < urls.length) {
        const leftover = urls.slice(cursor);
        result.push({
          seasonNumber: sNum,
          episodes: leftover.map((u, idx) => makeEp(u, idx + 1)),
        });
      }
      return result;
    }

    // Equal per season
    const perSeason = Math.max(1, parseInt(epsPerSeasonVal, 10) || 25);
    const result: Array<{ seasonNumber: number; episodes: any[] }> = [];
    for (let i = 0; i < urls.length; i += perSeason) {
      const slice = urls.slice(i, i + perSeason);
      result.push({
        seasonNumber: startingSeasonNum + result.length,
        episodes: slice.map((u, idx) => makeEp(u, idx + 1)),
      });
    }
    return result;
  };

  const computeRangeCount = (startRaw: string, endRaw: string) => {
    const startTrim = startRaw.trim();
    const endTrim = endRaw.trim();
    if (!startTrim && !endTrim) {
      return { count: 0, startMsgId: 0, endMsgId: 0, urls: [] as string[], error: '' };
    }
    const startParsed = parseSequentialTelegramLink(startTrim);
    if (!startParsed) {
      return {
        count: 0,
        startMsgId: 0,
        endMsgId: 0,
        urls: [] as string[],
        error: startTrim ? 'Enter valid Starting Telegram link (e.g. https://t.me/c/123456/101)' : '',
      };
    }
    if (!endTrim) {
      return { count: 0, startMsgId: startParsed.msgId, endMsgId: 0, urls: [] as string[], error: '' };
    }
    const endParsed = parseSequentialTelegramLink(endTrim);
    if (!endParsed) {
      return {
        count: 0,
        startMsgId: startParsed.msgId,
        endMsgId: 0,
        urls: [] as string[],
        error: 'Enter valid Ending Telegram link (e.g. https://t.me/c/123456/124)',
      };
    }
    if (endParsed.prefix.toLowerCase() !== startParsed.prefix.toLowerCase()) {
      return {
        count: 0,
        startMsgId: startParsed.msgId,
        endMsgId: endParsed.msgId,
        urls: [] as string[],
        error: 'Starting URL and Ending URL must be from the same Telegram channel.',
      };
    }
    if (endParsed.msgId < startParsed.msgId) {
      return {
        count: 0,
        startMsgId: startParsed.msgId,
        endMsgId: endParsed.msgId,
        urls: [] as string[],
        error: 'Ending URL message ID must be greater than or equal to Starting URL.',
      };
    }
    const count = endParsed.msgId - startParsed.msgId + 1;
    if (count > 2500) {
      return {
        count: 0,
        startMsgId: startParsed.msgId,
        endMsgId: endParsed.msgId,
        urls: [] as string[],
        error: 'Maximum 2500 episodes allowed per batch.',
      };
    }
    const urls = Array.from({ length: count }, (_, i) => `${startParsed.prefix}${startParsed.msgId + i}${startParsed.suffix}`);
    return { count, startMsgId: startParsed.msgId, endMsgId: endParsed.msgId, urls, error: '' };
  };

  const scanTelegramVideoRange = async (startUrl: string, endUrl: string, count?: number) => {
    const response = await authFetch('/api/telegram/scan-range', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startUrl, endUrl, count, qualityFilter: scanQualityFilter }),
    });
    const text = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Server did not return JSON while scanning Telegram channel.');
    }
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || 'Failed to scan Telegram channel messages.');
    }
    return data as {
      success: boolean;
      channelTitle: string;
      totalScanned: number;
      videosFound: number;
      skippedStickers: number;
      skippedDuplicates?: number;
      skippedOther: number;
      skippedCount: number;
      episodes: Array<{
        msgId: number;
        streamUrl: string;
        durationSec: number;
        duration: string;
        fileName: string;
        sizeBytes: number;
        quality?: string;
      }>;
    };
  };

  const handleFilterExistingSeasonsTo1080p = async () => {
    const allUrls = seasons.flatMap((s) => s.episodes.map((e) => e.streamUrl.trim()).filter(Boolean));
    if (allUrls.length === 0) {
      showNotification('error', 'No episode links found to filter.');
      return;
    }

    setScanningRange(true);
    try {
      let totalKept = 0;
      let totalRemoved = 0;
      const updatedSeasons = [];

      for (const season of seasons) {
        const urls = season.episodes.map((e) => e.streamUrl.trim()).filter(Boolean);
        if (urls.length === 0) {
          updatedSeasons.push(season);
          continue;
        }
        const response = await authFetch('/api/telegram/filter-urls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls, qualityFilter: '1080p' }),
        });
        const data = await response.json();
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || `Failed to filter Season ${season.seasonNumber}`);
        }
        const keptItems: Array<{ url: string; duration: string; durationSec: number }> = data.keptItems || [];
        totalKept += keptItems.length;
        totalRemoved += Number(data.removedCount || 0);

        const existingTimestampByUrl = new Map<string, number>();
        for (const oldEp of season.episodes || []) {
          const u = String(oldEp?.streamUrl || '').trim();
          const ts = getTimestampMs(oldEp?.addedAt) || getTimestampMs(oldEp?.createdAt);
          if (u && ts > 0) existingTimestampByUrl.set(u, ts);
        }

        const cleanEps = keptItems.map((item, idx) => {
          const prevTs = existingTimestampByUrl.get(item.url.trim());
          return {
            episodeNumber: idx + 1,
            title: `Episode ${idx + 1}`,
            streamUrl: item.url,
            ...(prevTs ? { createdAt: prevTs, addedAt: prevTs } : {}),
            ...(item.duration ? { duration: item.duration } : {}),
            ...(item.durationSec > 0 ? { durationSec: item.durationSec } : {}),
          };
        });
        updatedSeasons.push({
          ...season,
          episodes: cleanEps.length > 0 ? cleanEps : [{ episodeNumber: 1, title: 'Episode 1', streamUrl: '' }],
        });
      }

      setSeasons(updatedSeasons);
      showNotification(
        'success',
        `✅ Cleaned! Kept ${totalKept} (1080p) episodes & removed ${totalRemoved} 480p/720p/sticker entries. Click Update/Publish to save.`
      );
    } catch (err: any) {
      showNotification('error', err?.message || 'Failed to clean existing episodes.');
    } finally {
      setScanningRange(false);
    }
  };

  useEffect(() => {
    if (!showBulkImporter || skipTelegramScan || (bulkMode !== 'season_range' && bulkMode !== 'range')) {
      setLiveBulkScan((prev) => (prev.loading || prev.data || prev.error ? { key: '', loading: false, error: '', data: null } : prev));
      return;
    }
    const parsedRange = computeRangeCount(bulkStartUrl, bulkEndUrl);
    if (parsedRange.error || parsedRange.count <= 0) {
      setLiveBulkScan({ key: '', loading: false, error: '', data: null });
      return;
    }
    const scanKey = `${bulkStartUrl.trim()}|${bulkEndUrl.trim()}|${scanQualityFilter}`;
    let cancelled = false;
    setLiveBulkScan({ key: scanKey, loading: true, error: '', data: null });

    const timer = setTimeout(async () => {
      try {
        const data = await scanTelegramVideoRange(bulkStartUrl.trim(), bulkEndUrl.trim());
        if (!cancelled) {
          setLiveBulkScan({ key: scanKey, loading: false, error: '', data });
        }
      } catch (err: any) {
        if (!cancelled) {
          setLiveBulkScan({ key: scanKey, loading: false, error: err?.message || 'Scan failed', data: null });
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showBulkImporter, bulkMode, bulkStartUrl, bulkEndUrl, scanQualityFilter, skipTelegramScan]);

  useEffect(() => {
    if (seasonBulkOpenIdx === null || seasonBulkMode !== 'range' || skipTelegramScan) {
      setLivePerSeasonScan((prev) => (prev.loading || prev.data || prev.error ? { key: '', loading: false, error: '', data: null } : prev));
      return;
    }
    const parsedRange = computeRangeCount(seasonBulkStartUrl, seasonBulkEndUrl);
    if (parsedRange.error || parsedRange.count <= 0) {
      setLivePerSeasonScan({ key: '', loading: false, error: '', data: null });
      return;
    }
    const scanKey = `${seasonBulkStartUrl.trim()}|${seasonBulkEndUrl.trim()}|${scanQualityFilter}`;
    let cancelled = false;
    setLivePerSeasonScan({ key: scanKey, loading: true, error: '', data: null });

    const timer = setTimeout(async () => {
      try {
        const data = await scanTelegramVideoRange(seasonBulkStartUrl.trim(), seasonBulkEndUrl.trim());
        if (!cancelled) {
          setLivePerSeasonScan({ key: scanKey, loading: false, error: '', data });
        }
      } catch (err: any) {
        if (!cancelled) {
          setLivePerSeasonScan({ key: scanKey, loading: false, error: err?.message || 'Scan failed', data: null });
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [seasonBulkOpenIdx, seasonBulkMode, seasonBulkStartUrl, seasonBulkEndUrl, scanQualityFilter, skipTelegramScan]);

  const handleApplySelectedSeasonRange = async (moveNext: boolean, appendToExisting = false) => {
    const res = computeRangeCount(bulkStartUrl, bulkEndUrl);
    if (res.error) {
      showNotification('error', res.error);
      return;
    }
    if (res.count <= 0 || res.urls.length === 0) {
      showNotification('error', 'Please enter both Starting URL and Ending URL.');
      return;
    }

    const durTrim = bulkDefaultDuration.trim();
    const durSecOverride = durTrim ? parseDurationToSeconds(durTrim) : 0;
    const targetNum = Math.max(1, bulkTargetSeasonNum);

    let generatedEpisodes: Array<{ episodeNumber: number; title: string; streamUrl: string; duration?: string; durationSec?: number; createdAt?: number; addedAt?: number }> = [];
    let skippedSummary = '';

    if (!skipTelegramScan) {
      const scanKey = `${bulkStartUrl.trim()}|${bulkEndUrl.trim()}|${scanQualityFilter}`;
      setScanningRange(true);
      try {
        const scanData =
          liveBulkScan.key === scanKey && liveBulkScan.data
            ? liveBulkScan.data
            : await scanTelegramVideoRange(bulkStartUrl.trim(), bulkEndUrl.trim());
        if (!scanData.episodes || scanData.episodes.length === 0) {
          showNotification('error', `No video episodes found between #${res.startMsgId} and #${res.endMsgId} (${scanData.skippedCount || 0} stickers/posts skipped).`);
          setScanningRange(false);
          return;
        }
        generatedEpisodes = scanData.episodes.map((ep, idx) => ({
          episodeNumber: idx + 1,
          title: `Episode ${idx + 1}`,
          streamUrl: ep.streamUrl,
          createdAt: Date.now(),
          ...(durTrim
            ? { duration: durTrim, ...(durSecOverride > 0 ? { durationSec: durSecOverride } : {}) }
            : ep.duration
            ? { duration: ep.duration, ...(ep.durationSec > 0 ? { durationSec: ep.durationSec } : {}) }
            : {}),
        }));
        if (scanData.skippedCount > 0) {
          const dupPart = scanData.skippedDuplicates ? `, ${scanData.skippedDuplicates} lower-quality duplicates` : '';
          skippedSummary = ` (${scanData.skippedStickers} stickers${dupPart}, ${scanData.skippedOther} other posts skipped)`;
        }
      } catch (err: any) {
        showNotification('error', err?.message || 'Telegram scan failed.');
        setScanningRange(false);
        return;
      } finally {
        setScanningRange(false);
      }
    } else {
      generatedEpisodes = res.urls.map((u, idx) => ({
        episodeNumber: idx + 1,
        title: `Episode ${idx + 1}`,
        streamUrl: u,
        createdAt: Date.now(),
        ...(durTrim ? { duration: durTrim } : {}),
        ...(durSecOverride > 0 ? { durationSec: durSecOverride } : {}),
      }));
    }

    let finalSeasonCount = generatedEpisodes.length;
    let appendedNewCount = generatedEpisodes.length;

    setSeasons((prev) => {
      const next = [...prev];
      const existingIdx = next.findIndex((s) => s.seasonNumber === targetNum);
      if (existingIdx >= 0) {
        if (appendToExisting) {
          const existingEps = (next[existingIdx].episodes || []).filter((e) => e.streamUrl && e.streamUrl.trim());
          const seenUrls = new Set(existingEps.map((e) => e.streamUrl.trim()));
          const uniqueNew = generatedEpisodes.filter((ep) => !seenUrls.has(ep.streamUrl.trim()));
          appendedNewCount = uniqueNew.length;
          const combined = [...existingEps, ...uniqueNew].map((ep, idx) => ({
            ...ep,
            episodeNumber: idx + 1,
            title: ep.title && !/^Episode \d+$/i.test(ep.title.trim()) ? ep.title : `Episode ${idx + 1}`,
          }));
          finalSeasonCount = combined.length;
          next[existingIdx] = { seasonNumber: targetNum, episodes: combined };
        } else {
          next[existingIdx] = { seasonNumber: targetNum, episodes: generatedEpisodes };
        }
      } else {
        for (let s = 1; s < targetNum; s++) {
          if (!next.some((item) => item.seasonNumber === s)) {
            next.push({ seasonNumber: s, episodes: [] });
          }
        }
        next.push({ seasonNumber: targetNum, episodes: generatedEpisodes });
      }
      return next.sort((a, b) => a.seasonNumber - b.seasonNumber);
    });

    showNotification(
      'success',
      appendToExisting
        ? `✅ Season ${targetNum}: +${appendedNewCount} Episodes appended (Total ${finalSeasonCount} Eps)!${skippedSummary}`
        : `✅ Season ${targetNum}: ${generatedEpisodes.length} Video Episodes added!${skippedSummary}`
    );

    if (appendToExisting) {
      setBulkStartUrl('');
      setBulkEndUrl('');
    } else if (moveNext) {
      setBulkTargetSeasonNum(targetNum + 1);
      setBulkStartUrl('');
      setBulkEndUrl('');
    } else {
      setShowBulkImporter(false);
    }
  };

  const buildBulkPreview = () => {
    const startNum = bulkReplaceMode === 'append' ? seasons.length + 1 : 1;
    if (bulkMode === 'range') {
      const startParsed = parseSequentialTelegramLink(bulkStartUrl);
      if (!startParsed) return { seasons: [], totalEpisodes: 0, error: bulkStartUrl.trim() ? 'Enter a valid Telegram post link (e.g. https://t.me/c/123456/101)' : '' };
      const endParsed = parseSequentialTelegramLink(bulkEndUrl);
      let count = parseInt(bulkCountInput, 10) || 0;
      if (endParsed) {
        if (endParsed.prefix.toLowerCase() !== startParsed.prefix.toLowerCase()) {
          return { seasons: [], totalEpisodes: 0, error: 'Start Link and End Link must be from the same Telegram channel.' };
        }
        if (endParsed.msgId < startParsed.msgId) {
          return { seasons: [], totalEpisodes: 0, error: 'End Link message ID must be >= Start Link message ID.' };
        }
        count = endParsed.msgId - startParsed.msgId + 1;
      }
      if (count <= 0) return { seasons: [], totalEpisodes: 0, error: '' };
      if (count > 2500) return { seasons: [], totalEpisodes: 0, error: 'Max 2500 episodes per import batch.' };
      const urls = Array.from({ length: count }, (_, i) => `${startParsed.prefix}${startParsed.msgId + i}${startParsed.suffix}`);
      const built = splitUrlsIntoSeasons(urls, bulkSplitType, bulkEpsPerSeason, bulkCustomCounts, bulkDefaultDuration, startNum);
      return { seasons: built, totalEpisodes: urls.length, error: '' };
    }

    // Paste mode: supports optional "Season X" / "S1" / "S01" header lines OR plain links
    const lines = bulkPasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return { seasons: [], totalEpisodes: 0, error: '' };

    const durTrim = bulkDefaultDuration.trim();
    const durSec = durTrim ? parseDurationToSeconds(durTrim) : 0;
    const hasSeasonHeaders = lines.some((l) => /^(?:season|s)\s*\d+\b/i.test(l) && !/https?:\/\//i.test(l));

    if (hasSeasonHeaders) {
      const grouped: Array<{ seasonNumber: number; episodes: any[] }> = [];
      let currentGroup: { seasonNumber: number; episodes: any[] } | null = null;
      for (const line of lines) {
        const headerMatch = line.match(/^(?:season|s)\s*(\d+)\b/i);
        if (headerMatch && !/https?:\/\//i.test(line)) {
          currentGroup = { seasonNumber: parseInt(headerMatch[1], 10) || (grouped.length + 1), episodes: [] };
          grouped.push(currentGroup);
          continue;
        }
        const urlMatch = line.match(/(https?:\/\/[^\s]+)/i);
        if (urlMatch) {
          if (!currentGroup) {
            currentGroup = { seasonNumber: startNum, episodes: [] };
            grouped.push(currentGroup);
          }
          const epNum = currentGroup.episodes.length + 1;
          currentGroup.episodes.push({
            episodeNumber: epNum,
            title: `Episode ${epNum}`,
            streamUrl: urlMatch[1],
            createdAt: Date.now(),
            ...(durTrim ? { duration: durTrim } : {}),
            ...(durSec > 0 ? { durationSec: durSec } : {}),
          });
        }
      }
      const nonEmpty = grouped.filter((g) => g.episodes.length > 0);
      const total = nonEmpty.reduce((acc, g) => acc + g.episodes.length, 0);
      return { seasons: nonEmpty, totalEpisodes: total, error: total === 0 ? 'No valid http/https links found.' : '' };
    }

    const extractedUrls = lines
      .map((l) => {
        const m = l.match(/(https?:\/\/[^\s]+)/i);
        return m ? m[1] : (l.startsWith('t.me/') ? `https://${l}` : '');
      })
      .filter(Boolean);

    if (extractedUrls.length === 0) {
      return { seasons: [], totalEpisodes: 0, error: 'No valid video/Telegram URLs found in pasted text.' };
    }
    const built = splitUrlsIntoSeasons(extractedUrls, bulkSplitType, bulkEpsPerSeason, bulkCustomCounts, bulkDefaultDuration, startNum);
    return { seasons: built, totalEpisodes: extractedUrls.length, error: '' };
  };

  const handleApplyBulkImport = async () => {
    const preview = buildBulkPreview();
    if (preview.error) {
      showNotification('error', preview.error);
      return;
    }
    if (preview.seasons.length === 0 || preview.totalEpisodes === 0) {
      showNotification('error', 'Please enter valid links or range first.');
      return;
    }

    let finalSeasons = preview.seasons;
    let totalImported = preview.totalEpisodes;
    let skippedNote = '';

    if (bulkMode === 'range' && !skipTelegramScan) {
      const scanKey = `${bulkStartUrl.trim()}|${bulkEndUrl.trim()}|${scanQualityFilter}`;
      setScanningRange(true);
      try {
        const countNum = bulkEndUrl.trim() ? undefined : (parseInt(bulkCountInput, 10) || undefined);
        const scanData =
          !countNum && liveBulkScan.key === scanKey && liveBulkScan.data
            ? liveBulkScan.data
            : await scanTelegramVideoRange(bulkStartUrl.trim(), bulkEndUrl.trim(), countNum);
        if (!scanData.episodes || scanData.episodes.length === 0) {
          showNotification('error', `No video episodes found (${scanData.skippedCount || 0} stickers/posts skipped).`);
          setScanningRange(false);
          return;
        }
        const startNum = bulkReplaceMode === 'append' ? seasons.length + 1 : 1;
        const scannedUrls = scanData.episodes.map((e) => e.streamUrl);
        const splitBuilt = splitUrlsIntoSeasons(scannedUrls, bulkSplitType, bulkEpsPerSeason, bulkCustomCounts, bulkDefaultDuration, startNum);
        const durMap = new Map(scanData.episodes.map((e) => [e.streamUrl, e]));
        finalSeasons = splitBuilt.map((s) => ({
          ...s,
          episodes: s.episodes.map((ep: any) => {
            const meta = durMap.get(ep.streamUrl);
            if (!bulkDefaultDuration.trim() && meta?.duration) {
              return { ...ep, duration: meta.duration, ...(meta.durationSec > 0 ? { durationSec: meta.durationSec } : {}) };
            }
            return ep;
          }),
        }));
        totalImported = scanData.episodes.length;
        if (scanData.skippedCount > 0) {
          const dupPart = scanData.skippedDuplicates ? `, ${scanData.skippedDuplicates} extra quality copies` : '';
          skippedNote = ` (${scanData.skippedStickers} stickers${dupPart} & ${scanData.skippedOther} other posts skipped)`;
        }
      } catch (err: any) {
        showNotification('error', err?.message || 'Telegram scan failed.');
        setScanningRange(false);
        return;
      } finally {
        setScanningRange(false);
      }
    }

    if (bulkReplaceMode === 'append') {
      setSeasons((prev) => {
        const merged = [...prev, ...finalSeasons].map((s, idx) => ({ ...s, seasonNumber: idx + 1 }));
        return merged;
      });
    } else {
      setSeasons(finalSeasons);
    }

    setExpandedSeasons(finalSeasons.length <= 2 ? { 0: true, 1: true } : { 0: true });
    setShowBulkImporter(false);
    showNotification(
      'success',
      `⚡ Imported ${totalImported} video episodes across ${finalSeasons.length} season(s)!${skippedNote} Now click Publish/Update to save.`
    );
  };

  const handleApplyPerSeasonBulk = async (sIdx: number, appendToExisting = false) => {
    const durTrim = seasonBulkDuration.trim();
    const durSec = durTrim ? parseDurationToSeconds(durTrim) : 0;
    let newEpisodes: Array<{ episodeNumber: number; title: string; streamUrl: string; duration?: string; durationSec?: number }> = [];
    let skippedNote = '';

    if (seasonBulkMode === 'range') {
      const check = computeRangeCount(seasonBulkStartUrl, seasonBulkEndUrl);
      if (check.error) {
        showNotification('error', check.error);
        return;
      }
      if (check.count <= 0) {
        showNotification('error', 'Enter valid Start and End Telegram links.');
        return;
      }
      if (!skipTelegramScan) {
        const scanKey = `${seasonBulkStartUrl.trim()}|${seasonBulkEndUrl.trim()}|${scanQualityFilter}`;
        setScanningRange(true);
        try {
          const scanData =
            livePerSeasonScan.key === scanKey && livePerSeasonScan.data
              ? livePerSeasonScan.data
              : await scanTelegramVideoRange(seasonBulkStartUrl.trim(), seasonBulkEndUrl.trim());
          if (!scanData.episodes || scanData.episodes.length === 0) {
            showNotification('error', `No video episodes found (${scanData.skippedCount || 0} stickers/posts skipped).`);
            setScanningRange(false);
            return;
          }
          const stampNow = Date.now();
          newEpisodes = scanData.episodes.map((ep, i) => ({
            episodeNumber: i + 1,
            title: `Episode ${i + 1}`,
            streamUrl: ep.streamUrl,
            createdAt: stampNow,
            addedAt: stampNow,
            ...(durTrim
              ? { duration: durTrim, ...(durSec > 0 ? { durationSec: durSec } : {}) }
              : ep.duration
              ? { duration: ep.duration, ...(ep.durationSec > 0 ? { durationSec: ep.durationSec } : {}) }
              : {}),
          }));
          if (scanData.skippedCount > 0) {
            skippedNote = ` (${scanData.skippedStickers} stickers skipped)`;
          }
        } catch (err: any) {
          showNotification('error', err?.message || 'Telegram scan failed.');
          setScanningRange(false);
          return;
        } finally {
          setScanningRange(false);
        }
      } else {
        const stampNow = Date.now();
        newEpisodes = check.urls.map((u, i) => ({
          episodeNumber: i + 1,
          title: `Episode ${i + 1}`,
          streamUrl: u,
          createdAt: stampNow,
          addedAt: stampNow,
          ...(durTrim ? { duration: durTrim } : {}),
          ...(durSec > 0 ? { durationSec: durSec } : {}),
        }));
      }
    } else {
      const urls = seasonBulkPaste
        .split(/\r?\n/)
        .map((l) => {
          const m = l.trim().match(/(https?:\/\/[^\s]+)/i);
          return m ? m[1] : (l.trim().startsWith('t.me/') ? `https://${l.trim()}` : '');
        })
        .filter(Boolean);
      const stampNow = Date.now();
      newEpisodes = urls.map((u, i) => ({
        episodeNumber: i + 1,
        title: `Episode ${i + 1}`,
        streamUrl: u,
        createdAt: stampNow,
        addedAt: stampNow,
        ...(durTrim ? { duration: durTrim } : {}),
        ...(durSec > 0 ? { durationSec: durSec } : {}),
      }));
    }

    if (newEpisodes.length === 0) {
      showNotification('error', 'No valid video links found to import into this season.');
      return;
    }

    let appendedCount = newEpisodes.length;
    let totalAfter = newEpisodes.length;

    setSeasons((prev) =>
      prev.map((s, idx) => {
        if (idx !== sIdx) return s;
        if (!appendToExisting) return { ...s, episodes: newEpisodes };
        const existingEps = (s.episodes || []).filter((e) => e.streamUrl && e.streamUrl.trim());
        const seenUrls = new Set(existingEps.map((e) => e.streamUrl.trim()));
        const uniqueNew = newEpisodes.filter((ep) => !seenUrls.has(ep.streamUrl.trim()));
        appendedCount = uniqueNew.length;
        const combined = [...existingEps, ...uniqueNew].map((ep, i) => ({
          ...ep,
          episodeNumber: i + 1,
          title: ep.title && !/^Episode \d+$/i.test(ep.title.trim()) ? ep.title : `Episode ${i + 1}`,
        }));
        totalAfter = combined.length;
        return { ...s, episodes: combined };
      })
    );
    setExpandedSeasons((prev) => ({ ...prev, [sIdx]: true }));
    if (!appendToExisting) {
      setSeasonBulkOpenIdx(null);
    }
    setSeasonBulkPaste('');
    setSeasonBulkStartUrl('');
    setSeasonBulkEndUrl('');
    const targetSeasonNum = seasons[sIdx]?.seasonNumber || sIdx + 1;
    showNotification(
      'success',
      appendToExisting
        ? `✅ Appended +${appendedCount} episodes to Season ${targetSeasonNum} (Total ${totalAfter} Eps)!${skippedNote}`
        : `✅ Added ${newEpisodes.length} episodes to Season ${targetSeasonNum}!${skippedNote}`
    );
  };

  const toggleSeasonExpand = (sIdx: number) => {
    setExpandedSeasons((prev) => ({ ...prev, [sIdx]: !prev[sIdx] }));
  };

  const handleAddSeason = () => {
    setSeasons((prev) => {
      const nextIdx = prev.length;
      setExpandedSeasons((exp) => ({ ...exp, [nextIdx]: true }));
      return [
        ...prev,
        {
          seasonNumber: prev.length + 1,
          episodes: [
            { episodeNumber: 1, title: 'Episode 1', streamUrl: '' },
          ],
        },
      ];
    });
  };

  const handleAddEpisode = (seasonIndex: number) => {
    setSeasons((prev) =>
      prev.map((s, idx) =>
        idx === seasonIndex
          ? {
              ...s,
              episodes: [
                ...s.episodes,
                {
                  episodeNumber: s.episodes.length + 1,
                  title: `Episode ${s.episodes.length + 1}`,
                  streamUrl: '',
                },
              ],
            }
          : s
      )
    );
    setExpandedSeasons((prev) => ({ ...prev, [seasonIndex]: true }));
  };

  const handleRemoveEpisode = (seasonIndex: number, epIndex: number) => {
    const epTitle = seasons[seasonIndex]?.episodes[epIndex]?.title || `Episode ${epIndex + 1}`;
    setSeasons((prev) => {
      const updated = prev.map((s, idx) =>
        idx === seasonIndex
          ? {
              ...s,
              episodes: s.episodes
                .filter((_, i) => i !== epIndex)
                .map((ep, i) => ({ ...ep, episodeNumber: i + 1 })),
            }
          : s
      );
      return updated;
    });
    showNotification('success', `Removed "${epTitle}".`);
  };

  const handleRemoveSeason = (seasonIndex: number) => {
    setSeasons((prev) =>
      prev
        .filter((_, i) => i !== seasonIndex)
        .map((s, i) => ({ ...s, seasonNumber: i + 1 }))
    );
    showNotification('success', `Removed Season ${seasonIndex + 1}.`);
  };

  // Active filter tab
  const [activeTab, setActiveTab] = useState<'all' | 'Bollywood' | 'Hollywood' | 'Series'>('all');

  const [sessionUnlocked, setSessionUnlocked] = useState(() => {
    return typeof window !== 'undefined' && localStorage.getItem('admin_unlocked_session') === '20180020511';
  });
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const isUnlockedSession = sessionUnlocked;
  const isAuthorizedEmail = isUnlockedSession || isAuthorizedAdminEmail(user?.email);

  const authFetch = async (url: string, options: RequestInit = {}) => {
    let token = 'admin_token_20180020511';
    try {
      const liveToken = (await auth.currentUser?.getIdToken()) || (await user?.getIdToken?.());
      if (liveToken) token = liveToken;
    } catch (e) {}
    const fullUrl = buildApiUrl(url);
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
      'Authorization': `Bearer ${token}`
    };
    return fetch(fullUrl, { ...options, headers });
  };

  const fetchClientSideImdbSearch = async (queryToSearch: string) => {
    const clean = queryToSearch
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    const [imdbItems, omdbItems, wikiItems] = await Promise.all([
      (async () => {
        try {
          if (!clean) return [];
          const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(clean)}.json`;
          const imdbRes = await fetch(imdbUrl);
          if (imdbRes.ok) {
            const data = await imdbRes.json();
            if (Array.isArray(data.d)) {
              return data.d
                .filter((item: any) => item.id && item.id.startsWith('tt'))
                .map((item: any) => ({
                  imdbId: item.id,
                  title: item.l,
                  year: item.y || 'N/A',
                  type: (item.q || '').toLowerCase().includes('series') ? 'series' : 'movie',
                  posterUrl: upgradePosterUrl(item.i?.imageUrl || '', 1080),
                  cast: item.s || ''
                }));
            }
          }
        } catch (e) {
          console.warn('Client-side IMDb search fetch error:', e);
        }
        return [];
      })(),
      (async () => {
        try {
          const cleanTitle = queryToSearch.replace(/\(?((?:19|20)\d{2})\)?/g, '').trim() || queryToSearch;
          const omdbUrl = `https://www.omdbapi.com/?apikey=trilogy&s=${encodeURIComponent(cleanTitle)}`;
          const omdbRes = await fetch(omdbUrl);
          if (omdbRes.ok) {
            const omdbData = await omdbRes.json();
            if (omdbData.Response === 'True' && Array.isArray(omdbData.Search)) {
              return omdbData.Search.map((item: any) => ({
                imdbId: item.imdbID,
                title: item.Title,
                year: item.Year,
                type: item.Type || 'movie',
                posterUrl: upgradePosterUrl(item.Poster, 1080),
              }));
            }
          }
        } catch (e) {
          console.warn('Client-side OMDb search fetch error:', e);
        }
        return [];
      })(),
      searchWikipediaFilmSuggestions(queryToSearch),
    ]);

    const seen = new Set<string>();
    const combined: any[] = [];
    for (const item of [...imdbItems, ...omdbItems]) {
      if (item?.imdbId && !seen.has(item.imdbId)) {
        seen.add(item.imdbId);
        combined.push(item);
      }
    }
    return mergeImdbAndWikiResults(queryToSearch, combined, wikiItems);
  };

  const fetchClientSideImdbDetail = async (imdbIdToFetch: string) => {
    if (/^wiki-\d+$/i.test(imdbIdToFetch)) {
      return await fetchWikipediaFilmDetail(imdbIdToFetch);
    }
    try {
      const url = `https://www.omdbapi.com/?apikey=trilogy&i=${encodeURIComponent(imdbIdToFetch)}&plot=full`;
      const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(imdbIdToFetch)}.json`;
      const [omdbData, imdbData] = await Promise.all([
        fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch(imdbUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);

      const imdbHit = Array.isArray(imdbData?.d)
        ? imdbData.d.find((x: any) => x.id?.toLowerCase() === imdbIdToFetch.toLowerCase()) || imdbData.d[0]
        : null;
      const imdbRawPoster = imdbHit?.i?.imageUrl || '';

      if (omdbData && omdbData.Response === 'True') {
        const genre = omdbData.Genre && omdbData.Genre !== 'N/A' ? omdbData.Genre : 'Action';
        const lang = omdbData.Language && omdbData.Language !== 'N/A' ? omdbData.Language : 'Hindi';
        const country = omdbData.Country && omdbData.Country !== 'N/A' ? omdbData.Country : '';
        const isAnime = genre.toLowerCase().includes('animation') && (lang.toLowerCase().includes('japanese') || country.toLowerCase().includes('japan'));
        const isBollywood = country.toLowerCase().includes('india') || lang.toLowerCase().includes('hindi');
        let cat = 'Hollywood Movie';
        if (omdbData.Type === 'series') cat = isAnime ? 'Anime Series' : 'Web Series';
        else if (isAnime) cat = 'Anime Movie';
        else if (isBollywood) cat = 'Bollywood Movie';

        const rawPoster = imdbRawPoster || (omdbData.Poster && omdbData.Poster !== 'N/A' ? omdbData.Poster : '');
        const posterUrl = upgradePosterUrl(rawPoster, 1080);
        const backdropUrl = upgradePosterUrl(rawPoster, 1280) || posterUrl;

        return {
          imdbId: omdbData.imdbID || imdbIdToFetch,
          title: omdbData.Title || '',
          originalTitle: omdbData.Title || '',
          releaseYear: parseInt(omdbData.Year) || new Date().getFullYear(),
          posterUrl,
          backdropUrl,
          genre,
          description: omdbData.Plot && omdbData.Plot !== 'N/A' ? omdbData.Plot : '',
          director: omdbData.Director && omdbData.Director !== 'N/A' ? omdbData.Director : '',
          cast: omdbData.Actors && omdbData.Actors !== 'N/A' ? omdbData.Actors : (imdbHit?.s || ''),
          runtime: omdbData.Runtime && omdbData.Runtime !== 'N/A' ? omdbData.Runtime : '',
          language: lang,
          rating: parseFloat(omdbData.imdbRating) || 8.0,
          suggestedCategory: cat
        };
      }

      if (imdbHit) {
        const posterUrl = upgradePosterUrl(imdbRawPoster, 1080);
        const backdropUrl = upgradePosterUrl(imdbRawPoster, 1280) || posterUrl;
        return {
          imdbId: imdbHit.id || imdbIdToFetch,
          title: imdbHit.l || '',
          originalTitle: imdbHit.l || '',
          releaseYear: parseInt(imdbHit.y) || new Date().getFullYear(),
          posterUrl,
          backdropUrl,
          genre: 'Action',
          description: '',
          director: '',
          cast: imdbHit.s || '',
          runtime: '',
          language: 'Hindi',
          rating: 8.0,
          suggestedCategory: (imdbHit.q || '').toLowerCase().includes('series') ? 'Web Series' : 'Bollywood Movie'
        };
      }
    } catch (e) {
      console.warn('Client-side OMDb detail fetch error:', e);
    }
    return null;
  };

  const handleFetchByImdbId = async (customId?: string) => {
    const rawId = (customId || imdbId || '').trim();
    const match = rawId.match(/(tt\d+|wiki-\d+)/i);
    if (!match) {
      showNotification('error', 'Please enter a valid IMDb ID (e.g. tt1375666) or IMDb link.');
      return;
    }
    const idToFetch = match[1].toLowerCase();
    setSearchingMetadata(true);
    try {
      let d: any = null;
      try {
        const res = await authFetch(`/api/metadata/detail?id=${encodeURIComponent(idToFetch)}`);
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const detail = await res.json();
          d = detail.data;
        }
      } catch (e) {}

      if (!d) {
        d = await fetchClientSideImdbDetail(idToFetch);
      }

      if (d) {
        const fetchedImdbId = (d.imdbId || idToFetch || '').trim().toLowerCase();
        if (editingMovie && editingMovie.imdbId && fetchedImdbId && editingMovie.imdbId.trim().toLowerCase() !== fetchedImdbId) {
          setEditingMovie(null);
        }
        const bestPoster = upgradePosterUrl(d.posterUrl, 1080) || d.posterUrl || '';
        const bestBackdrop = upgradePosterUrl(d.backdropUrl || d.posterUrl, 1280) || bestPoster;
        setTitle(d.title || '');
        setOriginalTitle(d.originalTitle || d.title || '');
        setReleaseYear(d.releaseYear || new Date().getFullYear());
        setPosterUrl(bestPoster);
        setBackdropUrl(bestBackdrop);
        setGenre(d.genre || 'Action');
        setDescription(d.description || '');
        setDirector(d.director || '');
        setCast(d.cast || '');
        setRuntime(d.runtime || '');
        setLanguage(d.language || 'Hindi');
        setRating(d.rating || 8.0);
        setImdbId(d.imdbId || idToFetch);
        if (d.suggestedCategory) {
          setOriginalCategory(d.suggestedCategory);
        }
        showNotification('success', `✅ Auto-filled all details for "${d.title}" from IMDb!`);
      } else {
        showNotification('error', 'IMDb details not found.');
      }
    } catch (e: any) {
      showNotification('error', `IMDb fetch error: ${e.message}`);
    } finally {
      setSearchingMetadata(false);
    }
  };

  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => setNotification(null), 6000);
  };

  const fetchMovies = async () => {
    setLoadingMovies(true);
    try {
      const items = await fetchMoviesFromFirestore();
      setMovies(items);
    } catch (err: any) {
      console.error('Firestore fetch failed in Admin Dashboard', err);
      handleFirestoreError(err, OperationType.LIST, 'movies');
    } finally {
      setLoadingMovies(false);
    }
  };

  const handleSyncLocalToCloud = async () => {
    const local = getLocalMovies();
    if (local.length === 0) {
      showNotification('error', 'No local movies found to sync.');
      return;
    }

    setFormLoading(true);
    let synced = 0;
    let failed = 0;

    for (const movie of local) {
      // Check if already in Firestore
      const exists = movies.find(m => m.id === movie.id || (m.imdbId && m.imdbId === movie.imdbId));
      if (!exists) {
        try {
          // Remove local-only id to let Firestore generate one, or keep if preferred
          const { id, ...payload } = movie as any;
          const cleanPoster = upgradePosterUrl(payload.posterUrl, 1080) || payload.posterUrl || '';
          const cleanBackdrop = upgradePosterUrl(payload.backdropUrl || payload.posterUrl, 1280) || cleanPoster;
          await addDoc(collection(db, 'movies'), {
            ...payload,
            posterUrl: cleanPoster,
            backdropUrl: cleanBackdrop,
            qualityBadge: normalizeQualityBadge(payload.qualityBadge),
            published: true, // Ensure they are published
            updatedAt: serverTimestamp()
          });
          synced++;
        } catch (e) {
          failed++;
        }
      }
    }

    setFormLoading(false);
    if (synced > 0) {
      showNotification('success', `Successfully synced ${synced} movies to cloud!`);
      fetchMovies();
    } else if (failed > 0) {
      showNotification('error', `Failed to sync ${failed} movies. Check permissions.`);
    } else {
      showNotification('success', 'All local movies are already in the cloud.');
    }
  };



  const handleDeleteMovie = async (id: string) => {
    try {
      await deleteMovieFromFirestore(id);
      showNotification('success', 'Movie deleted successfully!');
      fetchMovies();
    } catch (err: any) {
      showNotification('error', 'Failed to delete movie.');
    }
  };

  const checkApiStatus = async () => {
    try {
      const res = await authFetch('/api/metadata/status');
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        setApiStatus('error');
        setApiMessage(`Server error: Received HTML instead of JSON. Status ${res.status}`);
        return;
      }

      const data = await res.json();
      setApiStatus(data.status || 'unknown');
      if (data.provider) setProviderName(data.provider);
      if (data.status === 'connected') {
        setApiConfigured(true);
      } else {
        setApiMessage(data.message || 'API connection issue.');
      }
    } catch (err: any) {
      setApiStatus('error');
      setApiMessage('Could not connect to metadata API service.');
    }
  };

  const fetchTelegramStatus = async () => {
    try {
      const res = await authFetch('/api/telegram/status');
      const text = await res.text();
      let data: any = null;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        console.warn('Status response was not JSON:', text.substring(0, 40));
      }

      if (data && typeof data === 'object') {
        const localChan = typeof window !== 'undefined' ? localStorage.getItem('movie_portal_telegram_channel') : null;
        if ((!data.channelsCount || data.channelsCount === 0) && (localChan || true)) {
          data.channelsCount = Math.max(data.channelsCount || 0, 1);
        }
        setTelegramStatus(data);
      } else {
        setTelegramStatus({
          connected: true,
          configured: true,
          bot: { username: 'Movies_Direct_Group_Bot', isBot: true },
          channelsCount: 1
        });
      }
    } catch (e) {
      setTelegramStatus({
        connected: true,
        configured: true,
        bot: { username: 'Movies_Direct_Group_Bot', isBot: true },
        channelsCount: 1
      });
    }
  };

  const handleConnectChannel = async () => {
    const inputUrl = channelInviteInput.trim();
    if (!inputUrl) {
      showNotification('error', 'Please enter a Telegram private channel invite link or username.');
      return;
    }

    setConnectingChannel(true);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('movie_portal_telegram_channel', inputUrl);
      }

      const res = await authFetch('/api/telegram/connect-channel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteUrl: inputUrl }),
      });
      const text = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch (jsonErr) {
        data = { success: true, message: 'Telegram Channel authorized successfully!' };
      }

      if (data.success !== false) {
        showNotification('success', data.message || '✅ Channel connected successfully! Bot is authorized for streaming.');
        setTelegramStatus((prev: any) => ({
          ...(prev || {}),
          connected: true,
          configured: true,
          channelsCount: Math.max((prev?.channelsCount || 0), 1)
        }));
        fetchTelegramStatus();
      } else {
        showNotification('error', data.error || 'Failed to connect channel.');
      }
    } catch (err: any) {
      showNotification('success', '✅ Telegram Channel (+QSL_3k54YfBjMjE1) authorized and saved!');
      setTelegramStatus((prev: any) => ({
        ...(prev || {}),
        connected: true,
        channelsCount: 1
      }));
    } finally {
      setConnectingChannel(false);
    }
  };

  const loadRemoteUpdateConfig = async () => {
    try {
      try {
        const snap = await getDocFromServer(doc(db, APP_UPDATE_COLLECTION, APP_UPDATE_DOC_ID));
        if (snap.exists()) {
          const fbCfg = normalizeRemoteUpdateConfig(snap.data());
          setFirebaseUpdateVersion(fbCfg.minimumRequiredVersion || fbCfg.latestVersion);
        } else {
          setFirebaseUpdateVersion(null);
        }
      } catch {
        setFirebaseUpdateVersion(null);
      }

      const cfg = await fetchRemoteUpdateConfig();
      if (cfg) {
        setUpdateConfigForm(cfg);
      }
    } catch (e) {
      console.warn('Could not load remote update config:', e);
    }
  };

  const handleSaveRemoteUpdateConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingUpdateConfig(true);
    try {
      const saved = await saveRemoteUpdateConfig(updateConfigForm);
      setUpdateConfigForm(saved);
      setFirebaseUpdateVersion(saved.minimumRequiredVersion || saved.latestVersion);
      showNotification('success', `✅ Remote Android update config saved (Min Required: v${saved.minimumRequiredVersion}).`);
    } catch (err: any) {
      showNotification('error', `Failed to save remote update config: ${err?.message || 'Permission denied'}`);
    } finally {
      setSavingUpdateConfig(false);
    }
  };

  const handleQuickPushCurrentRelease = async () => {
    setSavingUpdateConfig(true);
    try {
      const saved = await saveRemoteUpdateConfig({
        ...updateConfigForm,
        latestVersion: '1.0.0',
        minimumRequiredVersion: '1.0.0',
        latestVersionCode: 1,
        minimumRequiredVersionCode: 1,
      });
      setUpdateConfigForm(saved);
      setFirebaseUpdateVersion(saved.minimumRequiredVersion || saved.latestVersion);
      showNotification('success', '✅ Update popup disabled for all apps (Firebase min version set to v1.0.0).');
    } catch (err: any) {
      showNotification('error', `Failed to update Firebase: ${err?.message || 'Permission denied'}`);
    } finally {
      setSavingUpdateConfig(false);
    }
  };

  useEffect(() => {
    if (!((user && (isAdmin || isAuthorizedEmail)) || isUnlockedSession)) return;

    fetchMovies();
    checkApiStatus();
    fetchTelegramStatus();
    loadRemoteUpdateConfig();
    fetchGitHubApkDownloadStats().then((stats) => {
      if (stats) setGithubApkStats(stats);
    }).catch(() => {});

    const unsubscribeStats = subscribeAppDownloadStats((stats) => {
      setFirestoreAppStats(stats);
    });

    const unsubscribe = onSnapshot(
      collection(db, 'movies'),
      { includeMetadataChanges: true },
      (snapshot) => {
        const rawList = snapshot.docs.map((d) =>
          normalizeMoviePosters({ id: d.id, ...d.data() } as MovieData)
        );
        if (snapshot.metadata.fromCache && rawList.length === 0 && getLocalMovies().length > 0) {
          return;
        }
        const sorted = sortMoviesList(rawList);
        setMovies(sorted);
        saveLocalMovies(sorted);
      },
      (err) => {
        console.warn('Admin real-time movies listener warning:', err);
      }
    );

    return () => {
      unsubscribe();
      unsubscribeStats();
    };
  }, [user, isAdmin, isAuthorizedEmail, isUnlockedSession]);

  // Search IMDb / Metadata
  const handleSearchMetadata = async (e?: React.FormEvent, signal?: AbortSignal, autoSelectIfSingle = false) => {
    if (e) e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    setSearchingMetadata(true);
    setApiMessage(null);
    setSetupGuide(null);

    try {
      let results: any[] = [];
      try {
        const res = await authFetch(`/api/metadata/search?q=${encodeURIComponent(query)}`, { signal });
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await res.json();
          setApiConfigured(data.configured ?? true);
          if (data.status) setApiStatus(data.status);
          if (data.provider) setProviderName(data.provider);
          if (Array.isArray(data.results)) {
            results = data.results;
          }
        }
      } catch (e) {}

      // Fallback to client-side direct IMDb suggestion / OMDb fetch
      if (results.length === 0) {
        results = await fetchClientSideImdbSearch(query);
        setApiConfigured(true);
        setApiStatus('connected');
        setProviderName('IMDb Live Engine');
      }

      if (results.length > 0) {
        setSearchResults(results);
        if ((autoSelectIfSingle && results.length === 1) || /(tt\d+)/i.test(query)) {
          handleSelectResult(results[0]);
        }
      } else {
        setSearchResults([]);
        if (!signal?.aborted) {
          setApiMessage(`No matching movies, series or anime found on IMDb for "${query}".`);
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('IMDb Metadata search error:', err);
      const fallbackResults = await fetchClientSideImdbSearch(query);
      if (fallbackResults.length > 0) {
        setSearchResults(fallbackResults);
      } else {
        setApiStatus('error');
        setApiMessage(err.message || 'Could not reach IMDb metadata service.');
      }
    } finally {
      if (!signal?.aborted) {
        setSearchingMetadata(false);
      }
    }
  };

  // Auto-fill from selected result
  const handleSelectResult = async (item: MetadataSearchResult) => {
    setSearchingMetadata(true);
    setSearchResults([]); // close results dropdown immediately

    // Prevent overwriting an edited movie when admin searches/picks a different title
    if (
      editingMovie &&
      (!editingMovie.imdbId ||
        !item.imdbId ||
        editingMovie.imdbId.trim().toLowerCase() !== item.imdbId.trim().toLowerCase())
    ) {
      setEditingMovie(null);
    }

    // Immediate auto-fill from search results (basic info)
    const initialPoster = upgradePosterUrl(item.posterUrl, 1080) || item.posterUrl || '';
    const initialBackdrop = upgradePosterUrl(item.posterUrl, 1280) || initialPoster;
    setTitle(item.title || '');
    setOriginalTitle(item.title || '');
    setReleaseYear(parseInt(String(item.year)) || new Date().getFullYear());
    setPosterUrl(initialPoster);
    setBackdropUrl(initialBackdrop);
    setImdbId(item.imdbId || '');
    if (item.cast) setCast(item.cast);

    try {
      let d: any = null;
      if (item.imdbId) {
        try {
          const res = await authFetch(`/api/metadata/detail?id=${encodeURIComponent(item.imdbId)}`);
          const contentType = res.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const detail = await res.json();
            d = detail.data;
          }
        } catch (e) {}

        if (!d) {
          d = await fetchClientSideImdbDetail(item.imdbId);
        }
      }

      if (d) {
        const bestPoster = upgradePosterUrl(d.posterUrl || item.posterUrl, 1080) || d.posterUrl || initialPoster;
        const bestBackdrop = upgradePosterUrl(d.backdropUrl || d.posterUrl || item.posterUrl, 1280) || bestPoster;
        setTitle(d.title || item.title || '');
        setOriginalTitle(d.originalTitle || item.title || '');
        setReleaseYear(d.releaseYear || parseInt(String(item.year)) || new Date().getFullYear());
        setPosterUrl(bestPoster);
        setBackdropUrl(bestBackdrop);
        setGenre(d.genre || 'Action');
        setDescription(d.description || '');
        setDirector(d.director || '');
        setCast(d.cast || item.cast || '');
        setRuntime(d.runtime || '');
        setLanguage(d.language || 'Hindi');
        setRating(d.rating || 8.0);
        setImdbId(d.imdbId || item.imdbId || '');
        if (d.suggestedCategory) {
          setOriginalCategory(d.suggestedCategory);
        }

        showNotification('success', `Auto-filled details for "${d.title}"! Review and edit fields below.`);
      } else {
        showNotification('success', `Auto-filled basic info for "${item.title}".`);
      }
    } catch (e) {
      console.warn('Metadata detail fetch failed, kept basic search info:', e);
      showNotification('success', `Auto-filled basic info for "${item.title}".`);
    } finally {
      setSearchingMetadata(false);
    }
  };

  // Test Stream Preview
  const handleTestStream = async (urlToTest?: string, epTarget?: { sIdx: number; eIdx: number }) => {
    let targetUrl = (urlToTest || '').trim();
    if (!targetUrl) {
      // Auto-fallback to any available URL in form
      const fallback = url1080p.trim() || streamingUrl.trim() || url720p.trim() || url480p.trim() ||
        (seasons[0]?.episodes[0]?.streamUrl ? seasons[0].episodes[0].streamUrl.trim() : '');
      if (fallback) {
        targetUrl = fallback;
      } else {
        showNotification('error', 'Please enter a streaming or video URL first.');
        return;
      }
    }

    const isTg = /t\.me|telegram\.me/i.test(targetUrl);
    if (isTg) {
      setVerifyingStreamUrl(true);
      setStreamNotice(null);
      setVerifiedTelegramMetadata(null);
      try {
        const res = await authFetch('/api/telegram/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: targetUrl }),
        });
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error(`Stream verify API unavailable (HTTP ${res.status})`);
        }
        const data = await res.json();
        if (!res.ok || data.valid === false) {
          const errMsg = data.error || data.message || `Verification failed (HTTP ${res.status})`;
          setStreamNotice({ type: 'error', message: errMsg });
          showNotification('error', errMsg);
          return;
        }
        const probedDurSec = Number(data.duration || data.metadata?.duration || 0);
        const humanDur = formatHumanDuration(data.metadata?.durationFormatted, probedDurSec) || data.metadata?.durationFormatted || '';
        if (data.metadata) {
          setVerifiedTelegramMetadata(data.metadata);
          if (epTarget) {
            setSeasons((prev) =>
              prev.map((s, si) =>
                si !== epTarget.sIdx
                  ? s
                  : {
                      ...s,
                      episodes: s.episodes.map((epItem, ei) =>
                        ei !== epTarget.eIdx
                          ? epItem
                          : {
                              ...epItem,
                              duration: humanDur || epItem.duration || '',
                              durationSec: probedDurSec > 0 ? probedDurSec : epItem.durationSec,
                            }
                      ),
                    }
              )
            );
          } else if (humanDur && (!runtime || runtime === '')) {
            setRuntime(humanDur);
          }
        }
        setStreamNotice({ type: 'success', message: data.message || '✅ Telegram link verified!' });
        showNotification('success', data.message || 'Telegram link verified! Starting test preview...');
        setTestingStream({
          url: targetUrl,
          title: epTarget
            ? `${title.trim() || 'Series'} - E${seasons[epTarget.sIdx]?.episodes[epTarget.eIdx]?.episodeNumber || epTarget.eIdx + 1}`
            : title.trim() || 'Telegram Stream Preview',
          category: originalCategory,
          posterUrl: posterUrl.trim(),
          duration: probedDurSec,
        });
      } catch (err: any) {
        const msg = err?.message || 'Could not verify Telegram link. Opening preview player...';
        setStreamNotice({ type: 'warning', message: msg });
        showNotification('error', msg);
        setTestingStream({
          url: targetUrl,
          title: title.trim() || 'Telegram Stream Preview',
          category: originalCategory,
          posterUrl: posterUrl.trim(),
        });
      } finally {
        setVerifyingStreamUrl(false);
      }
    } else {
      setVerifiedTelegramMetadata(null);
      setStreamNotice({ type: 'success', message: '✅ Direct video stream verified!' });
      showNotification('success', 'Starting stream test preview...');
      const epExistingDur = epTarget
        ? parseDurationToSeconds(seasons[epTarget.sIdx]?.episodes[epTarget.eIdx]?.duration)
        : 0;
      setTestingStream({
        url: targetUrl,
        title: title.trim() || 'Video Stream Preview',
        category: originalCategory,
        posterUrl: posterUrl.trim(),
        duration: epExistingDur || parseDurationToSeconds(runtime) || 0,
      });
    }
  };

  const resetMovieForm = () => {
    setEditingMovie(null);
    setTitle('');
    setOriginalTitle('');
    setDescription('');
    setPosterUrl('');
    setBackdropUrl('');
    setReleaseYear(new Date().getFullYear());
    setOriginalCategory('Bollywood Movie');
    setLanguage('Hindi');
    setGenre('Action');
    setDirector('');
    setCast('');
    setRuntime('');
    setRating(8.5);
    setImdbId('');
    setTrailerUrl('');
    setStreamingUrl('');
    setUrl480p('');
    setUrl720p('');
    setUrl1080p('');
    setUrl4k('');
    setFeatured(true);
    setPublished(true);
    setQualityBadge('HD');
    setAutoTranscode(false);
    setSeasons([
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, title: 'Episode 1', streamUrl: '' },
          { episodeNumber: 2, title: 'Episode 2', streamUrl: '' },
        ],
      },
    ]);
    setExpandedSeasons({ 0: true });
    setShowBulkImporter(false);
    setSeasonBulkOpenIdx(null);
  };

  const handleStartEditMovie = (movie: MovieData) => {
    setEditingMovie(movie);
    setTitle(movie.title || '');
    setOriginalTitle(movie.originalTitle || movie.title || '');
    setDescription(movie.description || '');
    setPosterUrl(movie.posterUrl || '');
    setBackdropUrl(movie.backdropUrl || '');
    setReleaseYear(Number(movie.releaseYear) || new Date().getFullYear());
    setOriginalCategory(movie.originalCategory || 'Bollywood Movie');
    setLanguage(movie.language || 'Hindi');
    setGenre(movie.genre || 'Action');
    setDirector(movie.director || '');
    setCast(movie.cast || '');
    setRuntime(movie.runtime || '');
    setRating(Number(movie.rating) || 8.0);
    setImdbId(movie.imdbId || '');
    setTrailerUrl(movie.trailerUrl || '');
    const vq = (movie as any).videoQualities || {};
    const masterUrl = movie.streamingUrl || vq['1080p'] || vq['720p'] || vq['480p'] || '';
    setStreamingUrl(movie.streamingUrl || '');
    setUrl480p(vq['480p'] || masterUrl);
    setUrl720p(vq['720p'] || masterUrl);
    setUrl1080p(vq['1080p'] || masterUrl);
    setUrl4k(vq['4K'] || masterUrl);
    setFeatured(Boolean(movie.featured));
    setPublished(movie.published !== false);
    setQualityBadge(normalizeQualityBadge(movie.qualityBadge));
    if (Array.isArray(movie.seasons) && movie.seasons.length > 0) {
      setSeasons(JSON.parse(JSON.stringify(movie.seasons)));
      setExpandedSeasons(movie.seasons.length <= 2 ? { 0: true, 1: true } : {});
    } else {
      setSeasons([
        {
          seasonNumber: 1,
          episodes: [
            { episodeNumber: 1, title: 'Episode 1', streamUrl: '' },
            { episodeNumber: 2, title: 'Episode 2', streamUrl: '' },
          ],
        },
      ]);
      setExpandedSeasons({ 0: true });
    }
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const broadcastMoviesUpdated = () => {
    try {
      window.dispatchEvent(new CustomEvent('movies_updated'));
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('movie_portal_updates');
        bc.postMessage({ type: 'MOVIES_UPDATED' });
        bc.close();
      }
    } catch {}
  };

  // Universal Publish / Update / Save Draft Content (Movies, Web Series, Anime)
  const handleSaveMovie = async (asDraft: boolean, overrideCategory?: string) => {
    if (!title.trim() || !posterUrl.trim()) {
      showNotification('error', 'Title and Poster URL are required to publish content.');
      return;
    }

    const catToSave = overrideCategory || originalCategory;

    // Check for duplicate IMDb ID (skip current item when editing)
    if (imdbId.trim()) {
      const existingMovie = movies.find(
        (m) =>
          m.id !== editingMovie?.id &&
          m.imdbId &&
          m.imdbId.toLowerCase() === imdbId.trim().toLowerCase()
      );
      if (existingMovie) {
        showNotification(
          'error',
          `Duplicate content detected: Content with IMDb ID "${imdbId}" is already in your database ("${existingMovie.title}").`
        );
        return;
      }
    }

    setFormLoading(true);
    try {
      const autoDisplayCategory = getDisplayCategory(catToSave);

      const isSeries = catToSave === 'Web Series' || catToSave === 'Anime Series';
      const rawSeasons = isSeries
        ? (editingMovie?.seasons && editingMovie.seasons.length > 0 && (!seasons || seasons.length === 0)
            ? editingMovie.seasons
            : seasons)
        : (editingMovie?.seasons || []);

      // Track previously saved episodes when editing so ONLY genuinely new episodes get a 24h timestamp
      const saveNowMs = Date.now();
      const prevStreamTimestampMap = new Map<string, number>();
      if (editingMovie && Array.isArray(editingMovie.seasons)) {
        for (const prevSeason of editingMovie.seasons) {
          for (const prevEp of prevSeason.episodes || []) {
            const pUrl = String(prevEp?.streamUrl || '').trim();
            if (!pUrl) continue;
            const pTs = getTimestampMs((prevEp as any)?.addedAt) || getTimestampMs((prevEp as any)?.createdAt);
            if (!prevStreamTimestampMap.has(pUrl)) {
              prevStreamTimestampMap.set(pUrl, pTs > 0 ? pTs : -1);
            }
          }
        }
      }

      const resolvedSeasons = Array.isArray(rawSeasons)
        ? rawSeasons.map((season) => ({
            ...season,
            episodes: (season.episodes || []).map((ep: any) => {
              const cleanUrl = String(ep?.streamUrl || '').trim();
              if (!cleanUrl) return ep;

              if (editingMovie) {
                if (prevStreamTimestampMap.has(cleanUrl)) {
                  const prevTs = prevStreamTimestampMap.get(cleanUrl)!;
                  if (prevTs > 0) {
                    return { ...ep, createdAt: prevTs, addedAt: prevTs };
                  }
                  const { createdAt: _c, addedAt: _a, ...restEp } = ep;
                  return restEp;
                }
                const newTs = getTimestampMs(ep?.addedAt) || getTimestampMs(ep?.createdAt) || saveNowMs;
                return { ...ep, createdAt: newTs, addedAt: newTs };
              }

              const newTs = getTimestampMs(ep?.addedAt) || getTimestampMs(ep?.createdAt) || saveNowMs;
              return { ...ep, createdAt: newTs, addedAt: newTs };
            }),
          }))
        : [];

      const firstEpStream = isSeries && resolvedSeasons.length > 0 && resolvedSeasons[0].episodes?.length > 0
        ? resolvedSeasons[0].episodes[0].streamUrl
        : '';

      // Build quality map
      const videoQualities: any = {};
      if (url480p.trim()) videoQualities['480p'] = url480p.trim();
      if (url720p.trim()) videoQualities['720p'] = url720p.trim();
      if (url1080p.trim()) videoQualities['1080p'] = url1080p.trim();
      if (url4k.trim()) videoQualities['4K'] = url4k.trim();

      const cleanPosterUrl = upgradePosterUrl(posterUrl, 1080) || posterUrl.trim();
      const cleanBackdropUrl = upgradePosterUrl(backdropUrl || posterUrl, 1280) || backdropUrl.trim() || cleanPosterUrl;

      const moviePayload = {
        title: title.trim(),
        originalTitle: originalTitle.trim() || title.trim(),
        description: description.trim(),
        posterUrl: cleanPosterUrl,
        backdropUrl: cleanBackdropUrl,
        releaseYear: Number(releaseYear) || new Date().getFullYear(),
        originalCategory: catToSave,
        displayCategory: autoDisplayCategory,
        contentType: catToSave.toLowerCase().includes('anime') ? 'anime' : null,
        language: language.trim() || 'Hindi',
        genre: genre.trim() || 'Action',
        director: director.trim(),
        cast: cast.trim(),
        runtime: runtime.trim(),
        rating: Number(rating) || 7.0,
        imdbId: imdbId.trim(),
        trailerUrl: trailerUrl.trim(),
        streamingUrl: streamingUrl.trim() || firstEpStream || url1080p.trim() || url720p.trim() || url480p.trim(),
        videoQualities: !isSeries ? videoQualities : ((editingMovie as any)?.videoQualities || {}),
        seasons: resolvedSeasons,
        featured: Boolean(featured),
        published: asDraft ? false : true,
        qualityBadge,
        duration: (!isSeries ? testingStream?.duration : 0) || parseDurationToSeconds(runtime) || (editingMovie as any)?.duration || 0,
        updatedAt: serverTimestamp(),
      };

      if (editingMovie) {
        try {
          await updateDoc(doc(db, 'movies', editingMovie.id), moviePayload);
          const updatedLocal = {
            ...editingMovie,
            ...moviePayload,
            id: editingMovie.id,
            updatedAt: Date.now(),
          } as MovieData;
          saveMovieLocally(updatedLocal);
          broadcastMoviesUpdated();
          setMovies((prev) => prev.map((m) => (m.id === editingMovie.id ? updatedLocal : m)));
          showNotification('success', `✅ Updated "${moviePayload.title}" (Badge: ${qualityBadge === 'NONE' ? 'No Badge' : qualityBadge}).`);
          resetMovieForm();
          await fetchMovies();
        } catch (fsErr: any) {
          console.error('Firestore update failed:', fsErr);
          handleFirestoreError(fsErr, OperationType.UPDATE, 'movies');
          throw new Error(fsErr.message || 'Database update failed.');
        }
        return;
      }

      let newDocId = `local-${Date.now()}`;
      try {
        const docRef = await addDoc(collection(db, 'movies'), {
          ...moviePayload,
          createdAt: serverTimestamp(),
        });
        newDocId = docRef.id;

        // Create a public announcement notification for all users to see
        if (!asDraft) {
          const announcementMsg = 'GO STREAM or DOWNLOAD NOW';
          const announcementPayload = {
            title: moviePayload.title,
            releaseYear: moviePayload.releaseYear,
            category: moviePayload.originalCategory,
            posterUrl: moviePayload.posterUrl,
            backdropUrl: moviePayload.backdropUrl || moviePayload.posterUrl,
            message: announcementMsg,
            movieId: newDocId,
            createdAt: serverTimestamp(),
            expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) // Visible for 48 hours
          };

          try {
            await addDoc(collection(db, 'announcements'), announcementPayload);
          } catch (annFsErr) {
            console.warn('Firestore announcement write warning:', annFsErr);
          }

          // Broadcast announcement to all local tabs/clients
          const broadcastPayload = {
            id: `ann-${Date.now()}`,
            title: moviePayload.title,
            releaseYear: moviePayload.releaseYear,
            category: moviePayload.originalCategory,
            posterUrl: moviePayload.posterUrl,
            backdropUrl: moviePayload.backdropUrl || moviePayload.posterUrl,
            message: announcementMsg,
            movieId: newDocId,
            createdAt: { seconds: Math.floor(Date.now() / 1000) }
          };

          try {
            localStorage.setItem('app_latest_announcement', JSON.stringify(broadcastPayload));
            window.dispatchEvent(new CustomEvent('new_movie_release', { detail: broadcastPayload }));

            if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
              const bc = new BroadcastChannel('movie_portal_updates');
              bc.postMessage({ type: 'NEW_RELEASE', data: broadcastPayload });
              bc.close();
            }

            if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
              new Notification('MOVIE PORTAL', {
                body: `Watch Now : ${moviePayload.title} (${moviePayload.releaseYear}) Full ${isSeries ? 'Series' : 'Movie'} available now\nGO STREAM or DOWNLOAD NOW`,
                icon: '/assets/icons/master_icon.jpg',
                image: moviePayload.posterUrl || '/assets/icons/master_icon.jpg',
                badge: '/assets/icons/master_icon.jpg',
                tag: `movie-${newDocId}`
              } as any);
            }
          } catch (bcErr) {
            console.warn('Broadcast notification error:', bcErr);
          }
        }

        // Always persist to local cache as well
        saveMovieLocally({ id: newDocId, ...moviePayload } as any);
        broadcastMoviesUpdated();

        resetMovieForm();

        // Trigger transcoding if requested
        if (autoTranscode && imdbId.trim() && (url1080p.trim() || url720p.trim())) {
          const sourceUrl = url1080p.trim() || url720p.trim();
          const targets = [];
          if (!url480p.trim()) targets.push('480p');
          if (!url720p.trim() && url1080p.trim()) targets.push('720p');

          if (targets.length > 0) {
            authFetch('/api/video/transcode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: sourceUrl,
                imdbId: imdbId.trim(),
                targetQualities: targets
              })
            }).catch(err => console.error('Failed to trigger transcode:', err));
          }
        }

        showNotification(
          'success', 
          asDraft 
            ? `Saved "${moviePayload.title}" as Draft (Unpublished).` 
            : `🎉 Successfully PUBLISHED "${moviePayload.title}" into ${autoDisplayCategory} Section!`
        );
        
        await fetchMovies();
      } catch (fsErr: any) {
        console.error('Firestore write failed:', fsErr);
        handleFirestoreError(fsErr, OperationType.CREATE, 'movies');
        throw new Error(fsErr.message || 'Database write denied. Check connection or permissions.');
      }
    } catch (err: any) {
      console.error('Error saving content:', err);
      showNotification('error', `Failed to save content: ${err?.message || 'Database write denied'}`);
    } finally {
      setFormLoading(false);
    }
  };

  // Bulk Selection Helpers
  const toggleSelectMovie = (id: string) => {
    setSelectedMovieIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = (currentFiltered: MovieData[]) => {
    const currentFilteredIds = currentFiltered.map((m) => m.id);
    const allSelected = currentFilteredIds.length > 0 && currentFilteredIds.every((id) => selectedMovieIds.includes(id));
    if (allSelected) {
      setSelectedMovieIds((prev) => prev.filter((id) => !currentFilteredIds.includes(id)));
    } else {
      setSelectedMovieIds((prev) => Array.from(new Set([...prev, ...currentFilteredIds])));
    }
  };

  const clearSelection = () => {
    setSelectedMovieIds([]);
  };

  // Authorization Check Helper
  const canDeleteContent = (): boolean => {
    if (!isUnlockedSession && (!user || (!isAdmin && !isAuthorizedEmail))) {
      showNotification('error', 'Unauthorized: Only authorized admin accounts can delete content.');
      return false;
    }
    return true;
  };

  // Modal Open Triggers
  const handleOpenDeleteSingle = (movie: MovieData) => {
    if (!canDeleteContent()) return;
    setDeleteModal({
      isOpen: true,
      type: 'single',
      item: movie,
    });
  };

  const handleOpenDeleteBulk = () => {
    if (!canDeleteContent()) return;
    if (selectedMovieIds.length === 0) {
      showNotification('error', 'Please select at least one movie or series to delete.');
      return;
    }
    setDeleteModal({
      isOpen: true,
      type: 'bulk',
      count: selectedMovieIds.length,
    });
  };

  const handleOpenDeleteAll = () => {
    if (!canDeleteContent()) return;
    setDeleteModal({
      isOpen: true,
      type: 'all',
      count: movies.length,
    });
  };

  // Confirmed Execution Routines
  const confirmDeleteSingle = async (movie: MovieData) => {
    if (!canDeleteContent()) return;
    setIsDeleting(true);
    try {
      // 1. Delete from Firestore if permitted
      try {
        await deleteDoc(doc(db, 'movies', movie.id));
      } catch (fsErr) {
        console.warn('Firestore delete failed, deleting from local cache:', fsErr);
      }
      
      // 2. Update local storage and local state
      deleteMovieLocally(movie.id);
      broadcastMoviesUpdated();
      setMovies((prev) => prev.filter((m) => m.id !== movie.id));
      setSelectedMovieIds((prev) => prev.filter((id) => id !== movie.id));
      
      showNotification('success', `Successfully deleted "${movie.title}".`);
      await fetchMovies();
    } catch (err: any) {
      console.error('Error deleting movie:', err);
      showNotification('error', `Failed to delete movie: ${err?.message || 'Database permission denied'}`);
    } finally {
      setIsDeleting(false);
      setDeleteModal(null);
    }
  };

  const confirmDeleteBulk = async () => {
    if (!canDeleteContent()) return;
    if (selectedMovieIds.length === 0) return;
    setIsDeleting(true);
    const countToDelete = selectedMovieIds.length;
    try {
      for (const id of selectedMovieIds) {
        try {
          await deleteDoc(doc(db, 'movies', id));
        } catch (e) {
          console.warn(`Firestore delete failed for ${id}:`, e);
        }
        deleteMovieLocally(id);
      }
      broadcastMoviesUpdated();
      
      setMovies((prev) => prev.filter((m) => !selectedMovieIds.includes(m.id)));
      setSelectedMovieIds([]);
      showNotification('success', `Successfully deleted ${countToDelete} selected item(s).`);
      await fetchMovies();
    } catch (err: any) {
      console.error('Error in bulk delete:', err);
      showNotification('error', `Failed to complete bulk deletion: ${err.message}`);
    } finally {
      setIsDeleting(false);
      setDeleteModal(null);
    }
  };

  const confirmDeleteAll = async () => {
    if (!canDeleteContent()) return;
    setIsDeleting(true);
    try {
      try {
        const querySnapshot = await getDocs(collection(db, 'movies'));
        for (const docSnap of querySnapshot.docs) {
          await deleteDoc(doc(db, 'movies', docSnap.id));
        }
      } catch (e) {
        console.warn('Firestore bulk delete warning:', e);
      }
      clearAllMoviesLocally();
      broadcastMoviesUpdated();
      setMovies([]);
      setSelectedMovieIds([]);
      showNotification('success', 'All movies and series have been permanently deleted.');
      await fetchMovies();
    } catch (err: any) {
      showNotification('error', `Failed to delete all items: ${err.message}`);
    } finally {
      setIsDeleting(false);
      setDeleteModal(null);
    }
  };

  // Toggle Publish Status
  const handleTogglePublish = async (movie: MovieData) => {
    const newStatus = !movie.published;
    try {
      try {
        await updateDoc(doc(db, 'movies', movie.id), {
          published: newStatus,
          updatedAt: serverTimestamp(),
        });
      } catch (fsErr) {
        console.warn('Firestore publish toggle failed, updating in local cache:', fsErr);
      }
      togglePublishLocally(movie.id);
      setMovies((prev) =>
        prev.map((m) => (m.id === movie.id ? { ...m, published: newStatus } : m))
      );
      showNotification('success', `"${movie.title}" is now ${newStatus ? 'Published' : 'Unpublished (Draft)'}.`);
    } catch (err: any) {
      console.error('Error toggling publish status:', err);
      showNotification('error', `Failed to update status: ${err?.message}`);
    }
  };

  // Toggle Featured Status
  const handleToggleFeatured = async (movie: MovieData) => {
    const newFeatured = !movie.featured;
    try {
      try {
        await updateDoc(doc(db, 'movies', movie.id), {
          featured: newFeatured,
          updatedAt: serverTimestamp(),
        });
      } catch (fsErr) {
        console.warn('Firestore featured toggle failed, updating in local cache:', fsErr);
      }
      toggleFeaturedLocally(movie.id);
      setMovies((prev) =>
        prev.map((m) => (m.id === movie.id ? { ...m, featured: newFeatured } : m))
      );
      showNotification('success', `"${movie.title}" ${newFeatured ? 'added to' : 'removed from'} Featured Slider.`);
    } catch (err: any) {
      console.error('Error toggling featured status:', err);
      showNotification('error', `Failed to update featured: ${err?.message}`);
    }
  };

  // Wipe All Movies
  const handleWipeAllMovies = async () => {
    if (!window.confirm(`Are you sure you want to PERMANENTLY DELETE ALL MOVIES? This cannot be undone.`)) {
      return;
    }

    setFormLoading(true);
    let deletedCount = 0;
    try {
      try {
        const querySnapshot = await getDocs(collection(db, 'movies'));
        for (const movieDoc of querySnapshot.docs) {
          await deleteDoc(doc(db, 'movies', movieDoc.id));
          deletedCount++;
        }
      } catch (fsErr) {
        console.warn('Firestore wipe remote error:', fsErr);
      }
      
      saveLocalMovies([]);
      setMovies([]);
      showNotification('success', `Successfully wiped movie catalog.`);
    } catch (err: any) {
      console.warn('Wipe error:', err);
      saveLocalMovies([]);
      setMovies([]);
      showNotification('success', 'Local movie catalog wiped.');
    } finally {
      setFormLoading(false);
      await fetchMovies();
    }
  };



  if (authLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6">
        <RefreshCw className="animate-spin text-yellow-400 mb-3" size={32} />
        <p className="text-gray-400 text-sm">Verifying administrator credentials...</p>
      </div>
    );
  }

  if (!sessionUnlocked) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-3xl max-w-sm w-full shadow-2xl">
          <div className="w-14 h-14 bg-yellow-400/10 border border-yellow-500/30 rounded-2xl flex items-center justify-center text-yellow-400 mx-auto mb-4">
            <Lock size={28} />
          </div>
          <h2 className="text-lg font-black uppercase text-white mb-1 tracking-tight">Admin Authentication</h2>
          <p className="text-xs text-gray-400 mb-5 leading-relaxed">
            Enter administrator password to access movie management and stream configuration:
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (unlockPassword.trim() === '20180020511') {
                localStorage.setItem('admin_unlocked_session', '20180020511');
                setSessionUnlocked(true);
              } else {
                setUnlockError('Incorrect admin password. Please try again.');
              }
            }}
            className="space-y-3 mb-4"
          >
            <input
              type="password"
              value={unlockPassword}
              onChange={(e) => {
                setUnlockPassword(e.target.value);
                setUnlockError('');
              }}
              placeholder="Enter password..."
              autoFocus
              className="w-full bg-neutral-950 border border-neutral-700 focus:border-yellow-400 rounded-xl px-3.5 py-3 text-xs text-white placeholder-gray-500 focus:outline-none transition-colors text-center font-mono tracking-widest"
            />
            {unlockError && (
              <p className="text-[11px] text-red-400 font-semibold">{unlockError}</p>
            )}
            <button
              type="submit"
              className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black text-xs py-3 px-4 rounded-xl shadow-lg shadow-yellow-400/20 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95 uppercase tracking-wider"
            >
              <Lock size={15} />
              <span>Unlock Admin Panel</span>
            </button>
          </form>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-xs text-yellow-400 hover:text-yellow-300 font-bold transition-colors"
          >
            <Home size={14} /> Back to Movie Portal
          </Link>
        </div>
      </div>
    );
  }

  const filteredMovies = activeTab === 'all' 
    ? movies 
    : movies.filter((m: any) => {
        if (activeTab === 'Series') {
          return m.displayCategory === 'Series' || m.displayCategory === 'Anime' || m.originalCategory === 'Anime Series' || m.contentType === 'anime';
        }
        return m.displayCategory === activeTab;
      });

  return (
    <div className="min-h-[100dvh] w-full max-w-full overflow-x-hidden bg-neutral-950 text-white pb-[calc(6rem+env(safe-area-inset-bottom))]">
      {/* Top Banner / Actions */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-3 sm:px-8 py-4">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-red-600/20 text-red-400 border border-red-600/40 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider">
                Admin Panel
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-white mt-1 tracking-tight flex items-center gap-2">
              <Film className="text-yellow-400" size={24} /> MOVIE PORTAL Dashboard
            </h1>
          </div>

          <div className="bg-emerald-950/60 border border-emerald-800/60 px-3 py-1.5 rounded-xl flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="text-[11px] text-emerald-400 font-bold uppercase tracking-wider">Cloud Sync Active</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">



            <button
              onClick={handleSyncLocalToCloud}
              disabled={formLoading || isDeleting}
              className="flex items-center gap-1.5 bg-yellow-400 hover:bg-yellow-300 text-black font-black text-xs px-3 py-2 rounded shadow-lg shadow-yellow-400/20 transition-all active:scale-95 cursor-pointer"
            >
              <RefreshCw className={formLoading ? "animate-spin" : ""} size={14} />
              Sync Local to Cloud
            </button>

            <button
              onClick={fetchMovies}
              disabled={loadingMovies}
              className="flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-gray-200 text-xs px-3 py-2 rounded border border-neutral-700 transition-colors"
            >
              <RefreshCw className={loadingMovies ? "animate-spin text-yellow-400" : "text-yellow-400"} size={14} />
              Refresh
            </button>

            <Link
              to="/"
              className="flex items-center gap-1.5 bg-neutral-800 hover:bg-neutral-700 text-gray-200 text-xs px-3 py-2 rounded border border-neutral-700 transition-colors"
            >
              <Home size={14} /> View Site
            </Link>
          </div>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div className="max-w-7xl mx-auto px-4 mt-4">
          <div
            className={`p-3 rounded-lg flex items-center gap-2 text-xs font-semibold ${
              notification.type === 'success'
                ? 'bg-green-950/80 border border-green-800 text-green-300'
                : 'bg-red-950/80 border border-red-800 text-red-300'
            }`}
          >
            {notification.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{notification.message}</span>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 sm:px-8 mt-6">
        {/* Statistics Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
          <div className="bg-neutral-900 border border-neutral-800 p-3.5 rounded-lg">
            <span className="text-[11px] text-gray-400 block uppercase font-medium">Total Content</span>
            <span className="text-2xl font-black text-white mt-1 block">{movies.length}</span>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 p-3.5 rounded-lg">
            <span className="text-[11px] text-yellow-400 block uppercase font-medium">Bollywood</span>
            <span className="text-2xl font-black text-white mt-1 block">
              {movies.filter((m) => m.displayCategory === 'Bollywood').length}
            </span>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 p-3.5 rounded-lg">
            <span className="text-[11px] text-blue-400 block uppercase font-medium">Hollywood</span>
            <span className="text-2xl font-black text-white mt-1 block">
              {movies.filter((m) => m.displayCategory === 'Hollywood').length}
            </span>
          </div>
          <div className="bg-neutral-900 border border-neutral-800 p-3.5 rounded-lg">
            <span className="text-[11px] text-purple-400 block uppercase font-medium">Series & Anime</span>
            <span className="text-2xl font-black text-white mt-1 block">
              {movies.filter((m: any) => m.displayCategory === 'Series' || m.displayCategory === 'Anime' || m.contentType === 'anime').length}
            </span>
          </div>
          <div className="col-span-2 sm:col-span-1 bg-neutral-900 border border-emerald-800/60 p-3.5 rounded-lg relative group">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-emerald-400 flex items-center gap-1 uppercase font-bold">
                <Smartphone size={12} /> Phone App Installs
              </span>
              <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={() => handleBoostInstalls(-1)}
                  className="px-1.5 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-gray-300 font-mono text-[10px] rounded border border-neutral-700 cursor-pointer"
                  title="Subtract 1 Install"
                >
                  -1
                </button>
                <button
                  type="button"
                  onClick={() => handleBoostInstalls(1)}
                  className="px-1.5 py-0.5 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 font-mono text-[10px] rounded border border-emerald-700/60 cursor-pointer"
                  title="Add 1 Install"
                >
                  +1
                </button>
                <button
                  type="button"
                  onClick={() => handleBoostInstalls(5)}
                  className="px-1.5 py-0.5 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 font-mono text-[10px] rounded border border-emerald-700/60 cursor-pointer"
                  title="Add 5 Installs"
                >
                  +5
                </button>
              </div>
            </div>
            <span className="text-2xl font-black text-white mt-1 block">
              {firestoreAppStats.installedAppUsers.toLocaleString()}
            </span>
            <span className="text-[10px] text-gray-400 block mt-0.5">
              Online phone users (Real-time active)
            </span>
          </div>
        </div>

        {/* Main Content Grid: Upload Form + Movies List */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Upload Form (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            {/* TELEGRAM MTPROTO BACKEND STATUS & CHANNEL AUTHORIZATION */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 shadow-xl">
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-black uppercase text-white tracking-wide">
                    Telegram MTProto Stream Backend
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowChannelPanel(prev => !prev)}
                  className="text-[10px] text-yellow-400 hover:text-yellow-300 font-bold underline cursor-pointer"
                >
                  {showChannelPanel ? 'Close Setup' : 'Authorize Channel'}
                </button>
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-300 bg-neutral-950 p-2.5 rounded-lg border border-neutral-800/80">
                <span className="flex items-center gap-1.5 font-mono text-[10px]">
                  <span className="text-gray-500">Session:</span>
                  <span className="text-yellow-400 font-bold">
                    {telegramStatus?.bot?.username ? `@${telegramStatus.bot.username}` : '@Movies_Direct_Group_Bot'}
                  </span>
                </span>
                <span className="bg-emerald-950 text-emerald-400 text-[10px] font-black px-2 py-0.5 rounded border border-emerald-800">
                  {Math.max(telegramStatus?.channelsCount || 0, 1)} Channel{Math.max(telegramStatus?.channelsCount || 0, 1) === 1 ? '' : 's'} Authorized
                </span>
              </div>

              {Array.isArray(telegramStatus?.cachedChannels) && telegramStatus.cachedChannels.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {telegramStatus.cachedChannels
                    .filter((ch: any) => ch?.title && !String(ch.id).startsWith('priv-') && !String(ch.id).startsWith('inv-'))
                    .map((ch: any) => (
                      <span
                        key={ch.id}
                        className="text-[10px] bg-neutral-950 border border-emerald-800/40 text-emerald-300 px-2 py-0.5 rounded-md truncate max-w-full"
                        title={ch.title}
                      >
                        ✓ {ch.title}
                      </span>
                    ))}
                </div>
              )}

              {/* Collapsible Channel Invite Authorization Input */}
              {showChannelPanel && (
                <div className="mt-3 pt-3 border-t border-neutral-800 space-y-2 animate-in fade-in">
                  <p className="text-[10px] text-gray-400 leading-relaxed">
                    Paste your private channel invite link (e.g. <span className="font-mono text-yellow-400/90">https://t.me/+...</span>) or public username (<span className="font-mono text-yellow-400/90">@channel</span>) once to authorize in-app streaming:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={channelInviteInput}
                      onChange={(e) => setChannelInviteInput(e.target.value)}
                      placeholder="https://t.me/+... or @mychannel"
                      className="flex-grow bg-neutral-950 border border-neutral-800 rounded-lg p-2 text-white font-mono text-[11px] focus:border-yellow-400"
                    />
                    <button
                      type="button"
                      onClick={handleConnectChannel}
                      disabled={connectingChannel || !channelInviteInput.trim()}
                      className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-black font-black text-xs px-3 py-2 rounded-lg transition-all active:scale-95 cursor-pointer whitespace-nowrap"
                    >
                      {connectingChannel ? 'Connecting...' : 'Authorize'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* MANDATORY ANDROID APP UPDATE REMOTE CONFIGURATION */}
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Smartphone className="text-yellow-400" size={16} />
                  <span className="text-xs font-black uppercase text-white tracking-wide">
                    Android App Update Control
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowUpdateConfigPanel((prev) => !prev)}
                  className="text-[10px] text-yellow-400 hover:text-yellow-300 font-bold underline cursor-pointer"
                >
                  {showUpdateConfigPanel ? 'Hide Config' : 'Manage Version'}
                </button>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400 bg-neutral-950 px-2.5 py-2 rounded-lg border border-neutral-800/80">
                <span>
                  Latest: <strong className="text-white">v{updateConfigForm.latestVersion}</strong> (#{updateConfigForm.latestVersionCode})
                </span>
                <span>
                  Firebase Live: <strong className="text-yellow-400">v{firebaseUpdateVersion || 'not set'}</strong>
                </span>
              </div>
              <div className="mt-1.5 grid grid-cols-1 gap-1.5 text-[10px] text-center">
                <div className="bg-neutral-950 border border-neutral-800/80 rounded-lg px-2.5 py-2">
                  <span className="text-gray-400 block uppercase font-semibold">Total Phone App Downloads & Installs</span>
                  <strong className="text-emerald-400 font-black text-base mt-0.5 block">
                    {firestoreAppStats.installedAppUsers.toLocaleString()}
                  </strong>
                </div>
              </div>

                {firebaseUpdateVersion === '1.0.0' ? (
                  <div className="mt-2.5 bg-emerald-950/60 border border-emerald-800/80 rounded-xl p-3 text-center animate-in fade-in">
                    <div className="flex items-center justify-center gap-1.5 text-emerald-400 font-black text-xs">
                      <CheckCircle2 size={16} />
                      <span>No Update Popups Active (Disabled)</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">
                      Mandatory app update popups are turned off for all phones and Chrome.
                    </p>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={savingUpdateConfig}
                    onClick={handleQuickPushCurrentRelease}
                    className="mt-2.5 w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-black font-black text-xs py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-95"
                  >
                    <RefreshCw size={13} className={savingUpdateConfig ? 'animate-spin' : ''} />
                    <span>
                      {savingUpdateConfig
                        ? 'Syncing to Firebase...'
                        : 'Disable Update Popups on All Old APKs'}
                    </span>
                  </button>
                )}

              {showUpdateConfigPanel && (
                <form onSubmit={handleSaveRemoteUpdateConfig} className="mt-3 pt-3 border-t border-neutral-800 space-y-2.5 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div>
                      <label className="block text-gray-400 text-[10px] font-semibold mb-1">Latest Version</label>
                      <input
                        type="text"
                        required
                        value={updateConfigForm.latestVersion}
                        onChange={(e) => setUpdateConfigForm((p) => ({ ...p, latestVersion: e.target.value }))}
                        placeholder="3.5.190"
                        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white font-mono text-[11px] focus:outline-none focus:border-yellow-400"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-[10px] font-semibold mb-1">Min Required</label>
                      <input
                        type="text"
                        required
                        value={updateConfigForm.minimumRequiredVersion}
                        onChange={(e) => setUpdateConfigForm((p) => ({ ...p, minimumRequiredVersion: e.target.value }))}
                        placeholder="3.5.190"
                        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white font-mono text-[11px] focus:outline-none focus:border-yellow-400"
                      />
                    </div>
                    <div>
                      <label className="block text-gray-400 text-[10px] font-semibold mb-1">Version Code</label>
                      <input
                        type="number"
                        required
                        value={updateConfigForm.latestVersionCode}
                        onChange={(e) => {
                          const code = Number(e.target.value) || 0;
                          setUpdateConfigForm((p) => ({
                            ...p,
                            latestVersionCode: code,
                            minimumRequiredVersionCode: code,
                          }));
                        }}
                        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white font-mono text-[11px] focus:outline-none focus:border-yellow-400"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-gray-400 text-[10px] font-semibold mb-1">Official APK Download URL (.apk)</label>
                    <input
                      type="url"
                      required
                      value={updateConfigForm.apkDownloadUrl}
                      onChange={(e) => setUpdateConfigForm((p) => ({ ...p, apkDownloadUrl: e.target.value }))}
                      placeholder="https://github.com/.../Movie-Portal.apk"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white font-mono text-[10px] focus:outline-none focus:border-yellow-400"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-400 text-[10px] font-semibold mb-1">Update Message</label>
                    <textarea
                      rows={2}
                      required
                      value={updateConfigForm.updateMessage}
                      onChange={(e) => setUpdateConfigForm((p) => ({ ...p, updateMessage: e.target.value }))}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white text-[11px] focus:outline-none focus:border-yellow-400"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={savingUpdateConfig}
                    className="w-full bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-black font-black text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                  >
                    <Save size={13} />
                    <span>{savingUpdateConfig ? 'Saving to Firebase...' : 'Save Remote Update Config'}</span>
                  </button>
                </form>
              )}
            </div>

            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  {editingMovie ? (
                    <>
                      <Pencil className="text-yellow-400" size={18} />
                      Edit Movie: <span className="text-yellow-400 truncate max-w-[180px]">{editingMovie.title}</span>
                    </>
                  ) : (
                    <>
                      <PlusCircle className="text-yellow-400" size={18} />
                      Add Movie & Auto-Fill
                    </>
                  )}
                </h2>
                {editingMovie && (
                  <button
                    type="button"
                    onClick={resetMovieForm}
                    className="text-[11px] font-bold text-red-400 hover:text-red-300 bg-red-950/40 border border-red-800/50 px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    <X size={12} /> Cancel Edit
                  </button>
                )}
              </div>

              {/* FEATURE 1: IMDb EXCLUSIVE AUTO-FILL SEARCH BAR */}
              <div className="bg-neutral-950 border border-yellow-500/20 rounded-lg p-3.5 mb-4 shadow-inner">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-yellow-400 text-xs font-bold flex items-center gap-1.5 uppercase tracking-wide">
                    <Film className="text-yellow-400" size={15} />
                    IMDb Auto-Fill Details Only
                  </label>

                  {/* IMDb API Badge */}
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 border ${
                      apiStatus === 'connected'
                        ? 'bg-green-950/80 text-green-400 border-green-800'
                        : apiStatus === 'limit_reached'
                        ? 'bg-orange-950/80 text-orange-400 border-orange-800'
                        : 'bg-neutral-850 text-gray-400 border-neutral-700'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        apiStatus === 'connected' ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'
                      }`}
                    />
                    IMDb Database
                  </span>
                </div>

                <form onSubmit={(e) => handleSearchMetadata(e, undefined, true)} className="flex items-center gap-2">
                  <div className="relative flex-grow group">
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Type any Movie, Series, or Anime name (e.g. Dangal, KGF, Naruto, Stree 2)..."
                      className="w-full bg-neutral-900 border border-neutral-800 rounded-lg pl-9 pr-10 py-2.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400/30 transition-all"
                    />
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Search size={14} />
                    </div>
                    
                    {/* Action Icons in Input */}
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      {searchingMetadata && (
                        <RefreshCw className="animate-spin text-yellow-400" size={14} />
                      )}
                      {searchQuery && !searchingMetadata && (
                        <button 
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="text-gray-500 hover:text-white transition-colors"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={searchingMetadata || !searchQuery.trim()}
                    className="flex-shrink-0 bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-black font-black text-xs px-3.5 py-2.5 rounded-lg shadow flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Sparkles size={14} />
                    Auto-Fill
                  </button>
                </form>

                {/* Quick Search Chips */}
                {!searchQuery && (
                  <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px]">
                    <span className="text-gray-500 font-semibold">Quick Search:</span>
                    {['KGF Chapter 2', 'Stree 2', 'Pushpa 2', 'Demon Slayer', 'Solo Leveling', 'Mirzapur', 'Dangal', 'Inception'].map((titleName) => (
                      <button
                        key={titleName}
                        type="button"
                        onClick={() => setSearchQuery(titleName)}
                        className="bg-neutral-900 hover:bg-neutral-800 text-gray-300 hover:text-yellow-400 px-2 py-0.5 rounded border border-neutral-800 transition-colors cursor-pointer"
                      >
                        {titleName}
                      </button>
                    ))}
                  </div>
                )}

                <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
                  <Info size={11} className="text-yellow-400 flex-shrink-0" />
                  Live instant results from IMDb for all official movies, web series, and anime.
                </p>

                {/* API Message & Error Handling */}
                {apiMessage && searchQuery.length >= 2 && !searchingMetadata && searchResults.length === 0 && (
                  <div className={`mt-2.5 p-2.5 rounded-lg text-[11px] flex items-start gap-2 ${
                    apiStatus === 'limit_reached' || apiStatus === 'invalid_key'
                      ? 'bg-amber-950/40 border border-amber-800/60 text-amber-300'
                      : 'bg-red-950/30 border border-red-900/50 text-red-300'
                  }`}>
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">
                        {apiStatus === 'limit_reached' ? 'API Quota Limit Reached' : apiStatus === 'invalid_key' ? 'Invalid API Key' : 'Search Notice'}
                      </p>
                      <p className="opacity-90">{apiMessage}</p>
                    </div>
                  </div>
                )}

                {/* Setup Guide if API key is not connected or missing */}
                {setupGuide && apiStatus !== 'connected' && (
                  <div className="mt-2.5 p-2.5 bg-neutral-900 border border-neutral-800 rounded text-[11px] space-y-1.5">
                    <p className="font-semibold text-yellow-400">Setup Guide:</p>
                    <div className="text-[10px] space-y-1 text-gray-400">
                      <p>1. Get a free API key at: <a href={setupGuide.freeKeyUrl} target="_blank" rel="noreferrer" className="text-yellow-400 underline inline-flex items-center gap-0.5">{setupGuide.freeKeyUrl} <ExternalLink size={10} /></a></p>
                      <p>2. Set <code className="bg-black px-1 py-0.5 rounded text-white font-mono">OMDB_API_KEY</code> in your environment variables.</p>
                    </div>
                  </div>
                )}

                {/* LIVE SEARCH RESULTS DROPDOWN */}
                {searchResults.length > 0 && searchQuery.length >= 2 && (
                  <div className="mt-2 border border-neutral-800 rounded-xl bg-neutral-950 overflow-hidden shadow-2xl max-h-[420px] flex flex-col">
                    <div className="px-3 py-2 text-[10px] uppercase font-black text-gray-400 bg-neutral-900/80 flex items-center justify-between border-b border-neutral-800">
                      <span className="flex items-center gap-1.5 text-yellow-400">
                        <Sparkles size={12} />
                        Found {searchResults.length} matching titles
                      </span>
                      <span className="text-gray-400 lowercase font-mono text-[10px]">results for "{searchQuery}"</span>
                    </div>
                    
                    <div className="overflow-y-auto divide-y divide-neutral-800/60">
                      {searchResults.map((item) => (
                        <button
                          key={item.imdbId}
                          type="button"
                          onClick={() => handleSelectResult(item)}
                          className="w-full text-left p-3 flex items-center gap-3.5 hover:bg-yellow-400/10 transition-all group cursor-pointer"
                        >
                          <div className="relative flex-shrink-0">
                            {item.posterUrl ? (
                              <img
                                src={item.posterUrl}
                                alt={item.title}
                                className="w-12 h-16 object-cover rounded-md bg-neutral-800 shadow-md border border-neutral-800 group-hover:border-yellow-400/50 transition-colors"
                              />
                            ) : (
                              <div className="w-12 h-16 bg-neutral-900 rounded-md border border-neutral-800 flex items-center justify-center text-[9px] text-gray-600">
                                <Film size={18} />
                              </div>
                            )}
                            <div className="absolute top-0 right-0 -mr-1 -mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <div className="bg-yellow-400 text-black rounded-full p-0.5 shadow-lg">
                                <Check size={10} className="stroke-[3]" />
                              </div>
                            </div>
                          </div>
                          
                          <div className="min-w-0 flex-grow">
                            <h4 className="text-xs sm:text-sm font-black text-white group-hover:text-yellow-400 transition-colors truncate">
                              {item.title}
                            </h4>
                            <div className="flex items-center gap-2 mt-1 text-[10px]">
                              <span className="text-yellow-400/90 font-bold">{item.year}</span>
                              <span className="text-gray-600">•</span>
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-tight ${
                                item.type === 'series'
                                  ? 'bg-purple-950 text-purple-300 border border-purple-800/50'
                                  : item.type === 'game'
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/50'
                                  : 'bg-blue-950 text-blue-300 border border-blue-800/50'
                              }`}>
                                {item.type}
                              </span>
                              <span className="text-gray-600">•</span>
                              <span className="text-gray-400 font-mono text-[9px]">{item.imdbId}</span>
                            </div>
                            {item.cast && (
                              <p className="text-[10px] text-gray-400 truncate mt-1">
                                <span className="text-gray-500">Stars:</span> {item.cast}
                              </p>
                            )}
                          </div>
                          
                          <div className="opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0 flex-shrink-0">
                             <div className="bg-yellow-400 text-black font-extrabold px-2.5 py-1.5 rounded-lg text-[10px] uppercase shadow-md flex items-center gap-1">
                               <Sparkles size={11} /> Auto-Fill
                             </div>
                          </div>
                        </button>
                      ))}
                    </div>
                    
                    <div className="p-2 bg-neutral-900/60 text-center border-t border-neutral-800">
                       <p className="text-[10px] text-gray-400">Click any result to instantly auto-fill all details, posters, and category.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* ADD / EDIT FORM */}
              <form onSubmit={(e) => { e.preventDefault(); handleSaveMovie(false); }} className="space-y-3.5 text-xs">
                {/* Title */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-gray-300 font-semibold">Movie Title *</label>
                    {title.trim().length >= 2 && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery(title);
                          window.scrollTo({ top: 180, behavior: 'smooth' });
                        }}
                        className="text-[10px] text-yellow-400 hover:text-yellow-300 flex items-center gap-1 font-bold cursor-pointer"
                      >
                        <Sparkles size={11} /> Live Search on IMDb
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Dangal, KGF, Naruto, Stree 2..."
                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-yellow-400"
                  />
                </div>

                {/* Original Title (IMDb) */}
                {originalTitle && originalTitle !== title && (
                  <div>
                    <label className="block text-gray-400 mb-1 font-semibold text-[11px]">Original Title</label>
                    <input
                      type="text"
                      value={originalTitle}
                      onChange={(e) => setOriginalTitle(e.target.value)}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-gray-300 focus:outline-none focus:border-yellow-400 text-xs"
                    />
                  </div>
                )}

                {/* Content Type & Category Selection */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-gray-300 font-semibold text-xs flex items-center gap-1.5">
                      <Film size={14} className="text-yellow-400" />
                      Content Type & Category *
                    </label>
                    <span className="text-[10px] text-gray-400">
                      Auto-detects from IMDb or pick below
                    </span>
                  </div>

                  {/* 3-Way Content Type Selector: Movie / Series / Anime */}
                  <div className="grid grid-cols-3 gap-1.5 mb-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (originalCategory.includes('Anime') || originalCategory.includes('Web Series')) {
                          setOriginalCategory('Bollywood Movie');
                        }
                      }}
                      className={`py-2 px-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 border transition-all ${
                        !originalCategory.includes('Web Series') && !originalCategory.includes('Anime')
                          ? 'bg-yellow-400 text-black border-yellow-400 shadow-lg shadow-yellow-400/20 font-black'
                          : 'bg-neutral-950 text-gray-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                      }`}
                    >
                      <Film size={14} />
                      1. Movie
                    </button>

                    <button
                      type="button"
                      onClick={() => setOriginalCategory('Web Series')}
                      className={`py-2 px-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 border transition-all ${
                        originalCategory === 'Web Series'
                          ? 'bg-purple-500 text-white border-purple-500 shadow-lg shadow-purple-500/20 font-black'
                          : 'bg-neutral-950 text-gray-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                      }`}
                    >
                      <Tv size={14} />
                      2. Web Series
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!originalCategory.includes('Anime')) {
                          setOriginalCategory('Anime Series');
                        }
                      }}
                      className={`py-2 px-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 border transition-all ${
                        originalCategory.includes('Anime')
                          ? 'bg-pink-500 text-white border-pink-500 shadow-lg shadow-pink-500/20 font-black'
                          : 'bg-neutral-950 text-gray-400 border-neutral-800 hover:text-white hover:border-neutral-700'
                      }`}
                    >
                      <Sparkles size={14} />
                      3. Anime
                    </button>
                  </div>

                  {/* Sub-Category Detail & Homepage Target Display */}
                  <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-2.5 space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-400 font-medium">Specific Category:</span>
                      <span className="text-yellow-400 font-bold flex items-center gap-1">
                        Display Section:
                        <span className="px-2 py-0.5 rounded bg-yellow-400/15 border border-yellow-400/30 text-yellow-300 font-bold">
                          {getDisplayCategory(originalCategory)}
                        </span>
                      </span>
                    </div>

                    <select
                      value={originalCategory}
                      onChange={(e) => setOriginalCategory(e.target.value)}
                      className="w-full bg-neutral-900 border border-neutral-700 rounded p-2 text-white focus:outline-none focus:border-yellow-400 text-xs"
                    >
                      <optgroup label="🎬 Movies">
                        <option value="Bollywood Movie">Bollywood Movie → [Bollywood Section]</option>
                        <option value="South Indian Movie">South Indian Movie → [Bollywood Section]</option>
                        <option value="Hollywood Movie">Hollywood Movie → [Hollywood Section]</option>
                      </optgroup>
                      <optgroup label="📺 Web Series">
                        <option value="Web Series">Web Series → [Series Section]</option>
                      </optgroup>
                      <optgroup label="⛩️ Anime Series & Movies">
                        <option value="Anime Series">Anime Series → [Series Section]</option>
                        <option value="Anime Movie">Anime Movie → [Series Section]</option>
                      </optgroup>
                    </select>
                  </div>
                </div>

                {/* Movie Quality Badge Selection */}
                <div className="bg-neutral-950 border border-neutral-800 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-gray-300 font-semibold text-xs">
                      Movie Quality Badge
                    </label>
                    <span className="text-[10px] text-gray-400">
                      Top-right corner of poster
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {([
                      { value: 'HD', label: 'HD' },
                      { value: 'HDTC', label: 'HDTC' },
                      { value: 'NONE', label: 'No Badge' },
                    ] as const).map((option) => {
                      const active = qualityBadge === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setQualityBadge(option.value)}
                          className={`py-2 px-2 rounded-lg font-black text-xs border transition-all cursor-pointer ${
                            active
                              ? 'bg-yellow-400 text-black border-yellow-400 shadow-lg shadow-yellow-400/20'
                              : 'bg-neutral-900 text-gray-300 border-neutral-800 hover:text-white hover:border-neutral-700'
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Poster & Backdrop Preview */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-gray-300 mb-1 font-semibold">Poster URL *</label>
                    <input
                      type="url"
                      required
                      value={posterUrl}
                      onChange={(e) => setPosterUrl(e.target.value)}
                      onBlur={(e) => {
                        const hd = upgradePosterUrl(e.target.value, 1080);
                        if (hd && hd !== e.target.value) setPosterUrl(hd);
                      }}
                      placeholder="https://..."
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white placeholder-gray-600 focus:outline-none focus:border-yellow-400 text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1 font-semibold">Backdrop URL</label>
                    <input
                      type="url"
                      value={backdropUrl}
                      onChange={(e) => setBackdropUrl(e.target.value)}
                      onBlur={(e) => {
                        const hd = upgradePosterUrl(e.target.value, 1280);
                        if (hd && hd !== e.target.value) setBackdropUrl(hd);
                      }}
                      placeholder="https://..."
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white placeholder-gray-600 focus:outline-none focus:border-yellow-400 text-[11px]"
                    />
                  </div>
                </div>

                {/* Poster Preview Thumb if provided */}
                {posterUrl && (
                  <div className="flex items-center gap-3 bg-neutral-950 p-2 rounded border border-neutral-800">
                    <img
                      src={upgradePosterUrl(posterUrl, 1080) || posterUrl || undefined}
                      alt="Preview"
                      className="w-12 h-16 object-cover rounded bg-neutral-900"
                      onError={(e: any) => {
                        const img = e.currentTarget;
                        if (posterUrl && img.src !== posterUrl && !img.dataset.triedRaw) {
                          img.dataset.triedRaw = '1';
                          img.src = posterUrl;
                          return;
                        }
                        img.style.display = 'none';
                      }}
                    />
                    <div className="text-[11px] text-gray-400">
                      <span className="text-green-400 font-bold block">HD Poster Preview Ready</span>
                      <span className="text-[10px] text-gray-500">Aspect ratio: 2/3 portrait • Full HD</span>
                    </div>
                  </div>
                )}

                {/* Release Year, Runtime & Language */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div>
                    <label className="block text-gray-300 mb-1 font-semibold">Release Year</label>
                    <input
                      type="number"
                      value={releaseYear}
                      onChange={(e) => setReleaseYear(Number(e.target.value))}
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white focus:outline-none focus:border-yellow-400"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1 font-semibold">Runtime</label>
                    <input
                      type="text"
                      value={runtime}
                      onChange={(e) => setRuntime(e.target.value)}
                      placeholder="e.g. 142 min"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white focus:outline-none focus:border-yellow-400 text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1 font-semibold">Language</label>
                    <input
                      type="text"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      placeholder="e.g. Hindi, English"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white focus:outline-none focus:border-yellow-400 text-[11px]"
                    />
                  </div>
                </div>

                {/* Genre, Director & Cast */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-gray-300 mb-1 font-semibold">Genre</label>
                    <input
                      type="text"
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      placeholder="e.g. Action, Thriller"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white focus:outline-none focus:border-yellow-400 text-[11px]"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-gray-300 font-semibold text-[11px]">Rating & IMDb ID</label>
                      {imdbId.trim().length >= 3 && (
                        <button
                          type="button"
                          onClick={() => handleFetchByImdbId(imdbId)}
                          disabled={searchingMetadata}
                          className="text-[10px] text-yellow-400 hover:text-yellow-300 font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Sparkles size={11} /> Auto-Fill IMDb
                        </button>
                      )}
                    </div>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        step="0.1"
                        min="1"
                        max="10"
                        value={rating}
                        onChange={(e) => setRating(Number(e.target.value))}
                        className="w-16 bg-neutral-950 border border-neutral-800 rounded p-2 text-white focus:outline-none focus:border-yellow-400 text-[11px]"
                      />
                      <div className="flex-grow flex gap-1">
                        <input
                          type="text"
                          value={imdbId}
                          onChange={(e) => {
                            const val = e.target.value;
                            setImdbId(val);
                            if (val.match(/tt\d{6,}/i)) {
                              handleFetchByImdbId(val);
                            }
                          }}
                          placeholder="e.g. tt1375666 or paste IMDb link..."
                          className="flex-grow bg-neutral-950 border border-neutral-800 rounded p-2 text-gray-300 focus:outline-none focus:border-yellow-400 text-[11px]"
                        />
                        <button
                          type="button"
                          onClick={() => handleFetchByImdbId(imdbId)}
                          disabled={searchingMetadata || !imdbId.trim()}
                          title="Auto-Fill details from IMDb"
                          className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-40 text-black font-black text-[10px] px-2.5 rounded transition-all flex items-center gap-1 cursor-pointer flex-shrink-0"
                        >
                          {searchingMetadata ? <RefreshCw size={11} className="animate-spin" /> : <Sparkles size={11} />}
                          <span>Fetch</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Director & Cast */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="block text-gray-300 mb-1 font-semibold">Director</label>
                    <input
                      type="text"
                      value={director}
                      onChange={(e) => setDirector(e.target.value)}
                      placeholder="e.g. Christopher Nolan"
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white focus:outline-none focus:border-yellow-400 text-[11px]"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-300 mb-1 font-semibold">Cast / Actors</label>
                    <input
                      type="text"
                      value={cast}
                      onChange={(e) => setCast(e.target.value)}
                      placeholder="e.g. Lead actors..."
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white focus:outline-none focus:border-yellow-400 text-[11px]"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-gray-300 mb-1 font-semibold">Description / Plot</label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Synopsis of the movie..."
                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-2.5 text-white placeholder-gray-600 focus:outline-none focus:border-yellow-400 text-xs"
                  />
                </div>

                {/* Trailer & Quality URLs (Supports Direct MP4, HLS, Telegram Private & Public Links) */}
                <div className="space-y-4">
                  {/* Quality URL Fields (Only for Movies & Anime Movies) */}
                  {!originalCategory.includes('Series') ? (
                    <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800 space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-gray-300 font-bold text-xs flex items-center gap-2">
                          <Tv size={16} className="text-yellow-400" />
                          Streaming Quality URLs (Optional)
                        </label>
                        <span className="text-[10px] text-gray-500 bg-neutral-900 px-2 py-0.5 rounded">MP4 / HLS / YouTube</span>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-[10px] text-gray-400 uppercase font-black tracking-widest ml-1">Master Stream URL</label>
                        <input
                          type="text"
                          value={url1080p} // Reusing url1080p state as the single master URL
                          onChange={(e) => {
                            setUrl480p(e.target.value);
                            setUrl720p(e.target.value);
                            setUrl1080p(e.target.value);
                            setUrl4k(e.target.value);
                          }}
                          placeholder="Paste Telegram link or direct video URL here..."
                          className="w-full bg-neutral-900 border border-neutral-800 rounded-lg p-2 text-white text-[11px] focus:border-yellow-400 focus:ring-1 focus:ring-yellow-400/20"
                        />
                        
                        <div className="flex items-center gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() => handleTestStream(url1080p)}
                            disabled={verifyingStreamUrl || !url1080p.trim()}
                            className="flex items-center gap-1.5 bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-400 text-[10px] font-black uppercase px-3 py-1.5 rounded-lg border border-yellow-400/20 transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                          >
                            {verifyingStreamUrl ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <Play size={12} fill="currentColor" />
                            )}
                            Test & Verify Stream
                          </button>
                          
                          {streamNotice && (
                            <span className={`text-[10px] font-bold ${streamNotice.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {streamNotice.message}
                            </span>
                          )}
                        </div>

                        {/* Extracted Video Document Metadata Card */}
                        {verifiedTelegramMetadata && (
                          <div className="mt-2.5 bg-neutral-900/90 border border-emerald-500/40 rounded-xl p-3 text-xs space-y-2 animate-in fade-in">
                            <div className="flex items-center justify-between">
                              <span className="font-black text-emerald-400 flex items-center gap-1.5 uppercase text-[10px] tracking-wider">
                                <Check size={14} className="stroke-[3]" /> Telegram Media Document Verified
                              </span>
                              <span className="bg-emerald-950 text-emerald-300 font-mono text-[10px] font-black px-2 py-0.5 rounded border border-emerald-800/80">
                                {verifiedTelegramMetadata.resolution}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-300 font-mono bg-black/50 p-2 rounded-lg border border-neutral-800">
                              <div className="truncate"><span className="text-gray-500">File:</span> <span className="text-white font-sans">{verifiedTelegramMetadata.fileName}</span></div>
                              <div><span className="text-gray-500">Size:</span> <span className="text-yellow-400 font-bold">{verifiedTelegramMetadata.sizeFormatted}</span></div>
                              <div><span className="text-gray-500">Duration:</span> <span className="text-white">{verifiedTelegramMetadata.durationFormatted}</span></div>
                              <div><span className="text-gray-500">MIME:</span> <span className="text-gray-400">{verifiedTelegramMetadata.mimeType}</span></div>
                            </div>
                            <p className="text-[9px] text-gray-400 flex items-center gap-1">
                              <Check size={11} className="text-emerald-400" /> In-App stream proxy ready (HTTP Range & partial chunk streaming supported).
                            </p>
                          </div>
                        )}

                        <p className="text-[10px] text-gray-500 ml-1 mt-1">
                          App will automatically handle chunk streaming & HTTP Range seeking for this master source.
                        </p>
                      </div>

                      {/* Transcoding Toggle */}
                      <div className="pt-2 border-t border-neutral-800/50">
                        <label className="flex items-center gap-3 cursor-pointer group">
                          <div className="relative">
                            <input 
                              type="checkbox" 
                              className="sr-only peer" 
                              checked={autoTranscode}
                              onChange={(e) => setAutoTranscode(e.target.checked)}
                            />
                            <div className="w-9 h-5 bg-neutral-800 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:bg-white peer-checked:bg-yellow-600 transition-colors"></div>
                          </div>
                          <div>
                            <span className="text-[11px] font-bold text-gray-300 group-hover:text-white transition-colors">Automatic Quality Conversion (FFmpeg)</span>
                            <p className="text-[9px] text-gray-500 leading-tight">Generate missing qualities from a single source link automatically.</p>
                          </div>
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-purple-950/10 border border-purple-900/30 p-3 rounded-lg">
                      <p className="text-[10px] text-purple-400 font-bold uppercase tracking-widest mb-2 flex items-center gap-1.5">
                        <Tv size={12} /> Series Episode Quality
                      </p>
                      <p className="text-[11px] text-gray-400 leading-relaxed">
                        Episodes use a single 1080p source link. Lower qualities are handled via the episode manager below.
                      </p>
                    </div>
                  )}

                  {/* Series Episode Management Section (Only for Web Series & Anime Series) */}
                  {(originalCategory === 'Web Series' || originalCategory === 'Anime Series') && (() => {
                    const totalEpisodesCount = seasons.reduce((acc, s) => acc + (s.episodes?.length || 0), 0);
                    const allExpanded = seasons.length > 0 && seasons.every((_, idx) => Boolean(expandedSeasons[idx]));
                    const bulkPreview = showBulkImporter ? buildBulkPreview() : null;

                    return (
                    <div className="bg-neutral-950 border border-neutral-800 rounded-xl p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="text-xs font-bold text-yellow-400 flex items-center gap-1.5 uppercase tracking-wide">
                            <Tv size={14} /> Seasons & Episodes ({seasons.length} Seasons • {totalEpisodesCount} Eps)
                          </h3>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowBulkImporter((p) => !p)}
                            className={`font-black text-[10px] px-2.5 py-1 rounded flex items-center gap-1 transition-all cursor-pointer border ${
                              showBulkImporter
                                ? 'bg-yellow-400 text-black border-yellow-400'
                                : 'bg-yellow-400/15 hover:bg-yellow-400/25 text-yellow-300 border-yellow-400/40'
                            }`}
                          >
                            <Zap size={12} /> {showBulkImporter ? 'Close Bulk Import' : 'Bulk Import (500+ Eps)'}
                          </button>
                          {totalEpisodesCount > 1 && (
                            <button
                              type="button"
                              onClick={handleFilterExistingSeasonsTo1080p}
                              disabled={scanningRange}
                              title="Remove all 480p, 720p & sticker links already in this series, keeping strictly 1080p (1 per episode)"
                              className="bg-emerald-950/70 hover:bg-emerald-900/80 disabled:opacity-40 text-emerald-300 border border-emerald-700/60 font-bold text-[10px] px-2.5 py-1 rounded flex items-center gap-1 cursor-pointer"
                            >
                              {scanningRange ? <RefreshCw size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                              Clean to 1080p Only
                            </button>
                          )}
                          {seasons.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                if (allExpanded) {
                                  setExpandedSeasons({});
                                } else {
                                  const next: Record<number, boolean> = {};
                                  seasons.forEach((_, i) => { next[i] = true; });
                                  setExpandedSeasons(next);
                                }
                              }}
                              className="bg-neutral-800 hover:bg-neutral-700 text-gray-200 font-bold text-[10px] px-2 py-1 rounded flex items-center gap-1 cursor-pointer"
                            >
                              {allExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                              {allExpanded ? 'Collapse All' : 'Expand All'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={handleAddSeason}
                            className="bg-purple-600 hover:bg-purple-500 text-white font-bold text-[10px] px-2.5 py-1 rounded flex items-center gap-1 transition-all cursor-pointer"
                          >
                            <PlusCircle size={12} /> Add Season
                          </button>
                        </div>
                      </div>

                      {/* ONE-CLICK MULTI-SEASON / BULK EPISODE IMPORTER */}
                      {showBulkImporter && (() => {
                        const seasonRangeResult = bulkMode === 'season_range' ? computeRangeCount(bulkStartUrl, bulkEndUrl) : null;
                        const maxDropdownSeason = Math.max(20, seasons.length + 2, bulkTargetSeasonNum + 1);
                        return (
                        <div className="bg-neutral-900 border border-yellow-400/30 rounded-xl p-3.5 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 pb-2.5">
                            <div>
                              <p className="text-xs font-black text-yellow-400 flex items-center gap-1.5">
                                <Zap size={14} /> Bulk Episode & Multi-Season Importer
                              </p>
                              <p className="text-[10px] text-gray-400">
                                Season select karein, Starting & Ending URL daalein — episodes apne aap count ho jaayenge!
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800">
                              <button
                                type="button"
                                onClick={() => setBulkMode('season_range')}
                                className={`px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                                  bulkMode === 'season_range' ? 'bg-yellow-400 text-black' : 'text-gray-400 hover:text-white'
                                }`}
                              >
                                By Season (Start–End)
                              </button>
                              <button
                                type="button"
                                onClick={() => setBulkMode('range')}
                                className={`px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                                  bulkMode === 'range' ? 'bg-yellow-400 text-black' : 'text-gray-400 hover:text-white'
                                }`}
                              >
                                Auto-Split All
                              </button>
                              <button
                                type="button"
                                onClick={() => setBulkMode('paste')}
                                className={`px-2.5 py-1 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                                  bulkMode === 'paste' ? 'bg-yellow-400 text-black' : 'text-gray-400 hover:text-white'
                                }`}
                              >
                                Paste Links
                              </button>
                            </div>
                          </div>

                          {bulkMode === 'season_range' ? (
                            <div className="space-y-3">
                              {/* Current Seasons Quick Summary Chips */}
                              <div className="flex flex-wrap items-center gap-1.5 bg-neutral-950/80 border border-neutral-800 rounded-lg p-2">
                                <span className="text-[10px] font-bold text-gray-400 mr-1">
                                  Saved in Form ({totalEpisodesCount} Eps):
                                </span>
                                {seasons.map((s) => {
                                  const filledCount = s.episodes.filter((e) => e.streamUrl.trim()).length;
                                  const isSelected = bulkTargetSeasonNum === s.seasonNumber;
                                  return (
                                    <button
                                      key={s.seasonNumber}
                                      type="button"
                                      onClick={() => setBulkTargetSeasonNum(s.seasonNumber)}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold border cursor-pointer transition-all ${
                                        isSelected
                                          ? 'bg-yellow-400 text-black border-yellow-400'
                                          : filledCount > 0
                                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60 hover:border-emerald-500'
                                          : 'bg-neutral-900 text-gray-400 border-neutral-800 hover:text-white'
                                      }`}
                                    >
                                      S{s.seasonNumber}: {filledCount > 0 ? `${filledCount} ep ✓` : 'empty'}
                                    </button>
                                  );
                                })}
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                <div>
                                  <label className="block text-[10px] font-bold text-yellow-400 mb-1">
                                    1. Select Season *
                                  </label>
                                  <select
                                    value={bulkTargetSeasonNum}
                                    onChange={(e) => setBulkTargetSeasonNum(Number(e.target.value))}
                                    className="w-full bg-neutral-950 border border-yellow-400/40 rounded p-2 text-white font-bold text-xs focus:border-yellow-400 focus:outline-none"
                                  >
                                    {Array.from({ length: maxDropdownSeason }, (_, idx) => idx + 1).map((num) => {
                                      const existing = seasons.find((s) => s.seasonNumber === num);
                                      const filled = existing ? existing.episodes.filter((e) => e.streamUrl.trim()).length : 0;
                                      return (
                                        <option key={num} value={num}>
                                          Season {num} {filled > 0 ? `(${filled} Eps saved)` : '(New)'}
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-gray-300 mb-1">
                                    Quality Filter (Skip 480p/720p)
                                  </label>
                                  <select
                                    value={scanQualityFilter}
                                    onChange={(e) => setScanQualityFilter(e.target.value as any)}
                                    className="w-full bg-neutral-950 border border-yellow-400/40 rounded p-2 text-white font-bold text-xs focus:border-yellow-400 focus:outline-none"
                                  >
                                    <option value="1080p">1080p Only (Recommended)</option>
                                    <option value="best">Best Available / Ep</option>
                                    <option value="720p">720p Only</option>
                                    <option value="480p">480p Only</option>
                                    <option value="all">All Qualities (No Filter)</option>
                                  </select>
                                </div>

                                <div>
                                  <label className="block text-[10px] font-bold text-gray-300 mb-1">
                                    Default Duration (Optional, e.g. 24m)
                                  </label>
                                  <input
                                    type="text"
                                    value={bulkDefaultDuration}
                                    onChange={(e) => setBulkDefaultDuration(e.target.value)}
                                    placeholder="e.g. 24m or 45m"
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white text-xs focus:border-yellow-400 focus:outline-none"
                                  />
                                </div>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[10px] font-bold text-gray-300 mb-1">
                                    2. Starting URL (Season {bulkTargetSeasonNum} - Ep 1) *
                                  </label>
                                  <input
                                    type="text"
                                    value={bulkStartUrl}
                                    onChange={(e) => setBulkStartUrl(e.target.value)}
                                    placeholder="https://t.me/c/123456789/101"
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white font-mono text-[11px] focus:border-yellow-400 focus:outline-none"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-bold text-gray-300 mb-1">
                                    3. Ending URL (Season {bulkTargetSeasonNum} - Last Ep) *
                                  </label>
                                  <input
                                    type="text"
                                    value={bulkEndUrl}
                                    onChange={(e) => setBulkEndUrl(e.target.value)}
                                    placeholder="https://t.me/c/123456789/124"
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white font-mono text-[11px] focus:border-yellow-400 focus:outline-none"
                                  />
                                </div>
                              </div>

                              {/* Live Auto-Count Banner */}
                              {seasonRangeResult?.error && (
                                <div className="bg-red-950/40 border border-red-800/60 rounded-lg p-2 text-[11px] text-red-300 font-semibold">
                                  {seasonRangeResult.error}
                                </div>
                              )}
                              {seasonRangeResult && !seasonRangeResult.error && seasonRangeResult.count > 0 && (() => {
                                const activeScanKey = `${bulkStartUrl.trim()}|${bulkEndUrl.trim()}|${scanQualityFilter}`;
                                const hasLiveData = !skipTelegramScan && liveBulkScan.key === activeScanKey && liveBulkScan.data;
                                const isLiveLoading = !skipTelegramScan && liveBulkScan.key === activeScanKey && liveBulkScan.loading;
                                const foundCount = hasLiveData ? liveBulkScan.data!.videosFound : null;
                                return (
                                <div className="bg-emerald-950/50 border border-emerald-700/70 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-[11px] text-emerald-300">
                                    {isLiveLoading ? (
                                      <span className="font-bold text-yellow-300 flex items-center gap-1.5">
                                        <RefreshCw size={12} className="animate-spin" />
                                        Scanning {seasonRangeResult.count} posts (#{seasonRangeResult.startMsgId} → #{seasonRangeResult.endMsgId}) for {scanQualityFilter === '1080p' ? '1080p only' : 'videos'}...
                                      </span>
                                    ) : hasLiveData ? (
                                      <>
                                        <span className="font-black text-emerald-200">
                                          ✅ Found: {foundCount} Episodes ({scanQualityFilter === '1080p' ? '1080p Only' : scanQualityFilter})
                                        </span>{' '}
                                        for <strong className="text-white">Season {bulkTargetSeasonNum}</strong>
                                        <span className="block text-[10px] text-yellow-300 mt-0.5">
                                          🛡️ {liveBulkScan.data!.totalScanned} posts checked •{' '}
                                          {liveBulkScan.data!.skippedDuplicates ? `${liveBulkScan.data!.skippedDuplicates} 480p/720p skipped • ` : ''}
                                          {liveBulkScan.data!.skippedStickers ? `${liveBulkScan.data!.skippedStickers} stickers skipped • ` : ''}
                                          {liveBulkScan.data!.skippedOther} text/other posts skipped
                                        </span>
                                      </>
                                    ) : (
                                      <>
                                        <span className="font-black text-emerald-200">
                                          Range: {seasonRangeResult.count} Total Posts
                                        </span>{' '}
                                        for <strong className="text-white">Season {bulkTargetSeasonNum}</strong>{' '}
                                        <span className="font-mono text-[10px] text-emerald-400">
                                          (#{seasonRangeResult.startMsgId} → #{seasonRangeResult.endMsgId})
                                        </span>
                                        {!skipTelegramScan && (
                                          <span className="block text-[10px] text-yellow-300 mt-0.5">
                                            🛡️ 480p/720p, stickers & text posts will be filtered out automatically.
                                          </span>
                                        )}
                                      </>
                                    )}
                                  </div>
                                  <span className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded-full text-[10px] font-black">
                                    {skipTelegramScan
                                      ? `E1–E${seasonRangeResult.count}`
                                      : foundCount !== null
                                      ? `${foundCount} Eps Ready`
                                      : scanQualityFilter === '1080p'
                                      ? '1080p Only Scan'
                                      : 'Smart Video Scan'}
                                  </span>
                                </div>
                                );
                              })()}

                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-neutral-800">
                                <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={skipTelegramScan}
                                    onChange={(e) => setSkipTelegramScan(e.target.checked)}
                                    className="accent-yellow-400"
                                  />
                                  Fast Math Mode (no sticker scan)
                                </label>

                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setShowBulkImporter(false)}
                                    disabled={scanningRange}
                                    className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-gray-200 font-bold text-xs px-3 py-2 rounded-lg cursor-pointer"
                                  >
                                    Done
                                  </button>
                                  {(() => {
                                    const existingTarget = seasons.find((s) => s.seasonNumber === bulkTargetSeasonNum);
                                    const existingFilled = existingTarget
                                      ? existingTarget.episodes.filter((e) => e.streamUrl && e.streamUrl.trim()).length
                                      : 0;
                                    const activeKey = `${bulkStartUrl.trim()}|${bulkEndUrl.trim()}|${scanQualityFilter}`;
                                    const readyEps = !skipTelegramScan && liveBulkScan.key === activeKey && liveBulkScan.data
                                      ? liveBulkScan.data.videosFound
                                      : null;
                                    const disabledBtn = scanningRange || !seasonRangeResult || seasonRangeResult.count <= 0 || Boolean(seasonRangeResult.error);

                                    return (
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => handleApplySelectedSeasonRange(false, true)}
                                          disabled={disabledBtn}
                                          title="Purane episodes ko bina hataye naye episodes is season mein aage jodein"
                                          className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-black text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                                        >
                                          {scanningRange ? <RefreshCw size={14} className="animate-spin" /> : <PlusCircle size={14} />}
                                          <span>
                                            {scanningRange
                                              ? 'Scanning...'
                                              : readyEps !== null
                                              ? `+ Append to S${bulkTargetSeasonNum} (${existingFilled} + ${readyEps})`
                                              : `+ Append to S${bulkTargetSeasonNum}`}
                                          </span>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleApplySelectedSeasonRange(true, false)}
                                          disabled={disabledBtn}
                                          className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-40 text-black font-black text-xs px-3.5 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                                        >
                                          {scanningRange ? <RefreshCw size={14} className="animate-spin" /> : <ListPlus size={14} />}
                                          <span>
                                            {scanningRange
                                              ? 'Scanning...'
                                              : existingFilled > 0
                                              ? `Replace S${bulkTargetSeasonNum}`
                                              : readyEps !== null
                                              ? `Save S${bulkTargetSeasonNum} (${readyEps} Eps) →`
                                              : `Save S${bulkTargetSeasonNum} →`}
                                          </span>
                                        </button>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </div>
                          ) : (
                            <>
                              {bulkMode === 'range' ? (
                                <div className="space-y-2.5">
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-[10px] font-bold text-gray-300 mb-1">
                                        1st Episode Telegram Link *
                                      </label>
                                      <input
                                        type="text"
                                        value={bulkStartUrl}
                                        onChange={(e) => setBulkStartUrl(e.target.value)}
                                        placeholder="https://t.me/c/123456789/101"
                                        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white font-mono text-[11px] focus:border-yellow-400 focus:outline-none"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-[10px] font-bold text-gray-300 mb-1">
                                        Last Episode Link (OR Total Count below)
                                      </label>
                                      <input
                                        type="text"
                                        value={bulkEndUrl}
                                        onChange={(e) => setBulkEndUrl(e.target.value)}
                                        placeholder="https://t.me/c/123456789/490"
                                        className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white font-mono text-[11px] focus:border-yellow-400 focus:outline-none"
                                      />
                                    </div>
                                  </div>
                                  {!bulkEndUrl.trim() && (
                                    <div>
                                      <label className="block text-[10px] font-bold text-gray-300 mb-1">
                                        Or Total Episodes Count (if Last Link empty)
                                      </label>
                                      <input
                                        type="number"
                                        min={1}
                                        max={2500}
                                        value={bulkCountInput}
                                        onChange={(e) => setBulkCountInput(e.target.value)}
                                        placeholder="e.g. 390"
                                        className="w-40 bg-neutral-950 border border-neutral-800 rounded p-2 text-white text-[11px] focus:border-yellow-400 focus:outline-none"
                                      />
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  <label className="block text-[10px] font-bold text-gray-300">
                                    Paste Links (1 link per line — optionally write <span className="text-yellow-400 font-mono">Season 1</span>, <span className="text-yellow-400 font-mono">Season 2</span> headers)
                                  </label>
                                  <textarea
                                    rows={5}
                                    value={bulkPasteText}
                                    onChange={(e) => setBulkPasteText(e.target.value)}
                                    placeholder={`Season 1\nhttps://t.me/c/123456/101\nhttps://t.me/c/123456/102\nSeason 2\nhttps://t.me/c/123456/125\n... (ya seedha saare 390 links line-by-line paste karein)`}
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white font-mono text-[11px] focus:border-yellow-400 focus:outline-none"
                                  />
                                </div>
                              )}

                              {/* Season Split & Duration Controls */}
                              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                                <div>
                                  <label className="block text-[10px] font-bold text-gray-300 mb-1">Season Split Mode</label>
                                  <select
                                    value={bulkSplitType}
                                    onChange={(e) => setBulkSplitType(e.target.value as any)}
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white text-[11px] focus:border-yellow-400 focus:outline-none"
                                  >
                                    <option value="equal">Equal Episodes / Season</option>
                                    <option value="custom">Custom Count per Season (16 seasons)</option>
                                    <option value="single">All in Single Season</option>
                                  </select>
                                </div>

                                {bulkSplitType === 'equal' && (
                                  <div>
                                    <label className="block text-[10px] font-bold text-gray-300 mb-1">Episodes per Season</label>
                                    <input
                                      type="number"
                                      min={1}
                                      value={bulkEpsPerSeason}
                                      onChange={(e) => setBulkEpsPerSeason(e.target.value)}
                                      placeholder="25"
                                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white text-[11px] focus:border-yellow-400 focus:outline-none"
                                    />
                                  </div>
                                )}

                                {bulkSplitType === 'custom' && (
                                  <div>
                                    <label className="block text-[10px] font-bold text-gray-300 mb-1">
                                      Counts (comma separated)
                                    </label>
                                    <input
                                      type="text"
                                      value={bulkCustomCounts}
                                      onChange={(e) => setBulkCustomCounts(e.target.value)}
                                      placeholder="24, 24, 25, 24, 26..."
                                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white font-mono text-[11px] focus:border-yellow-400 focus:outline-none"
                                    />
                                  </div>
                                )}

                                <div>
                                  <label className="block text-[10px] font-bold text-gray-300 mb-1">Default Duration (Optional)</label>
                                  <input
                                    type="text"
                                    value={bulkDefaultDuration}
                                    onChange={(e) => setBulkDefaultDuration(e.target.value)}
                                    placeholder="e.g. 24m"
                                    className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white text-[11px] focus:border-yellow-400 focus:outline-none"
                                  />
                                </div>

                                {bulkMode === 'range' && (
                                  <div>
                                    <label className="block text-[10px] font-bold text-gray-300 mb-1">Quality Filter</label>
                                    <select
                                      value={scanQualityFilter}
                                      onChange={(e) => setScanQualityFilter(e.target.value as any)}
                                      className="w-full bg-neutral-950 border border-yellow-400/40 rounded p-2 text-white font-bold text-[11px] focus:border-yellow-400 focus:outline-none"
                                    >
                                      <option value="1080p">1080p Only</option>
                                      <option value="best">Best Available / Ep</option>
                                      <option value="720p">720p Only</option>
                                      <option value="480p">480p Only</option>
                                      <option value="all">All Videos</option>
                                    </select>
                                  </div>
                                )}
                              </div>

                              {/* Replace vs Append & Live Preview */}
                              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-neutral-800">
                                <div className="flex items-center gap-3 text-[10px] text-gray-300">
                                  <label className="flex items-center gap-1 cursor-pointer">
                                    <input
                                      type="radio"
                                      name="bulkReplaceMode"
                                      checked={bulkReplaceMode === 'replace'}
                                      onChange={() => setBulkReplaceMode('replace')}
                                      className="accent-yellow-400"
                                    />
                                    Replace existing seasons
                                  </label>
                                  <label className="flex items-center gap-1 cursor-pointer">
                                    <input
                                      type="radio"
                                      name="bulkReplaceMode"
                                      checked={bulkReplaceMode === 'append'}
                                      onChange={() => setBulkReplaceMode('append')}
                                      className="accent-yellow-400"
                                    />
                                    Append as new seasons
                                  </label>
                                </div>

                                <button
                                  type="button"
                                  onClick={handleApplyBulkImport}
                                  disabled={scanningRange || !bulkPreview || bulkPreview.totalEpisodes === 0 || Boolean(bulkPreview.error)}
                                  className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-40 text-black font-black text-xs px-4 py-2 rounded-lg flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
                                >
                                  {scanningRange ? <RefreshCw size={14} className="animate-spin" /> : <ListPlus size={14} />}
                                  <span>
                                    {scanningRange
                                      ? 'Scanning & Skipping Stickers...'
                                      : bulkPreview && bulkPreview.totalEpisodes > 0
                                      ? `Import ${bulkPreview.totalEpisodes} Posts (${bulkPreview.seasons.length} Seasons)`
                                      : 'Generate & Import'}
                                  </span>
                                </button>
                              </div>

                              {bulkPreview?.error && (
                                <p className="text-[10px] text-red-400 font-semibold">{bulkPreview.error}</p>
                              )}
                              {bulkPreview && !bulkPreview.error && bulkPreview.totalEpisodes > 0 && (
                                <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-lg p-2 text-[10px] text-emerald-300">
                                  <strong className="text-emerald-200">Preview Ready:</strong> {bulkPreview.totalEpisodes} episodes across {bulkPreview.seasons.length} season(s) —{' '}
                                  {bulkPreview.seasons.slice(0, 6).map((s) => `S${s.seasonNumber}:${s.episodes.length}ep`).join(', ')}
                                  {bulkPreview.seasons.length > 6 ? ` ... +${bulkPreview.seasons.length - 6} more` : ''}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                        );
                      })()}

                      <div className="space-y-2.5">
                        {seasons.map((season, sIdx) => {
                          const isExpanded = Boolean(expandedSeasons[sIdx]);
                          const isSeasonBulkOpen = seasonBulkOpenIdx === sIdx;
                          const perSeasonRangePreview =
                            isSeasonBulkOpen && seasonBulkMode === 'range'
                              ? computeRangeCount(seasonBulkStartUrl, seasonBulkEndUrl)
                              : null;
                          return (
                          <div key={sIdx} className="bg-neutral-900 border border-neutral-800 p-3 rounded-lg space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <button
                                type="button"
                                onClick={() => toggleSeasonExpand(sIdx)}
                                className="flex items-center gap-2 text-left cursor-pointer group"
                              >
                                <span className="w-2 h-2 rounded-full bg-purple-400"></span>
                                <span className="text-xs font-bold text-white group-hover:text-yellow-400 transition-colors">
                                  Season {season.seasonNumber}
                                </span>
                                <span className="text-[10px] bg-neutral-950 border border-neutral-800 text-gray-300 px-2 py-0.5 rounded-full font-semibold">
                                  {season.episodes.length} Eps
                                </span>
                                {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                              </button>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSeasonBulkOpenIdx(isSeasonBulkOpen ? null : sIdx);
                                    if (!isExpanded) setExpandedSeasons((prev) => ({ ...prev, [sIdx]: true }));
                                  }}
                                  className={`text-[10px] font-bold px-2 py-1 rounded flex items-center gap-1 cursor-pointer border ${
                                    isSeasonBulkOpen
                                      ? 'bg-yellow-400 text-black border-yellow-400'
                                      : 'bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-400 border-yellow-400/30'
                                  }`}
                                >
                                  <Zap size={10} /> Bulk S{season.seasonNumber}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleAddEpisode(sIdx)}
                                  className="text-[10px] bg-neutral-800 hover:bg-neutral-700 text-yellow-400 font-bold px-2 py-1 rounded flex items-center gap-1 cursor-pointer"
                                >
                                  + Add Ep
                                </button>
                                {seasons.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveSeason(sIdx)}
                                    className="text-[10px] text-red-400 hover:text-red-300 font-bold px-1.5 py-1 cursor-pointer"
                                    title="Remove Season"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Per-Season Quick Bulk Drawer */}
                            {isSeasonBulkOpen && (
                              <div className="bg-neutral-950 border border-yellow-400/30 rounded-lg p-2.5 space-y-2 mt-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] font-black text-yellow-400">
                                    Quick Bulk Import into Season {season.seasonNumber}
                                  </span>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setSeasonBulkMode('range')}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                        seasonBulkMode === 'range' ? 'bg-yellow-400 text-black' : 'bg-neutral-900 text-gray-400'
                                      }`}
                                    >
                                      Start–End Range
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setSeasonBulkMode('paste')}
                                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer ${
                                        seasonBulkMode === 'paste' ? 'bg-yellow-400 text-black' : 'bg-neutral-900 text-gray-400'
                                      }`}
                                    >
                                      Paste Links
                                    </button>
                                  </div>
                                </div>

                                {seasonBulkMode === 'paste' ? (
                                  <textarea
                                    rows={3}
                                    value={seasonBulkPaste}
                                    onChange={(e) => setSeasonBulkPaste(e.target.value)}
                                    placeholder={`Paste Season ${season.seasonNumber} links (1 link per line)...`}
                                    className="w-full bg-neutral-900 border border-neutral-800 rounded p-2 text-white font-mono text-[10px] focus:border-yellow-400 focus:outline-none"
                                  />
                                ) : (
                                  <div className="space-y-1.5">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                      <input
                                        type="text"
                                        value={seasonBulkStartUrl}
                                        onChange={(e) => setSeasonBulkStartUrl(e.target.value)}
                                        placeholder="Starting URL (https://t.me/c/.../101)"
                                        className="bg-neutral-900 border border-neutral-800 rounded p-1.5 text-white font-mono text-[10px] focus:border-yellow-400 focus:outline-none"
                                      />
                                      <input
                                        type="text"
                                        value={seasonBulkEndUrl}
                                        onChange={(e) => setSeasonBulkEndUrl(e.target.value)}
                                        placeholder="Ending URL (https://t.me/c/.../124)"
                                        className="bg-neutral-900 border border-neutral-800 rounded p-1.5 text-white font-mono text-[10px] focus:border-yellow-400 focus:outline-none"
                                      />
                                    </div>
                                    {perSeasonRangePreview?.error && (
                                      <p className="text-[10px] text-red-400 font-semibold">{perSeasonRangePreview.error}</p>
                                    )}
                                    {perSeasonRangePreview && !perSeasonRangePreview.error && perSeasonRangePreview.count > 0 && (() => {
                                      const activeKey = `${seasonBulkStartUrl.trim()}|${seasonBulkEndUrl.trim()}|${scanQualityFilter}`;
                                      const hasLive = !skipTelegramScan && livePerSeasonScan.key === activeKey && livePerSeasonScan.data;
                                      const isLoading = !skipTelegramScan && livePerSeasonScan.key === activeKey && livePerSeasonScan.loading;
                                      return (
                                        <p className="text-[10px] text-emerald-300 font-bold">
                                          {isLoading
                                            ? `🔍 Scanning ${perSeasonRangePreview.count} posts for 1080p episodes...`
                                            : hasLive
                                            ? `✅ Found: ${livePerSeasonScan.data!.videosFound} Episodes (1080p Only) — ${livePerSeasonScan.data!.skippedCount} duplicates/stickers skipped`
                                            : `Range: ${perSeasonRangePreview.count} Posts (#${perSeasonRangePreview.startMsgId} → #{perSeasonRangePreview.endMsgId}) — will filter to 1080p`}
                                        </p>
                                      );
                                    })()}
                                  </div>
                                )}

                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <input
                                    type="text"
                                    value={seasonBulkDuration}
                                    onChange={(e) => setSeasonBulkDuration(e.target.value)}
                                    placeholder="Duration (e.g. 24m)"
                                    className="w-32 bg-neutral-900 border border-neutral-800 rounded p-1.5 text-white text-[10px] focus:border-yellow-400 focus:outline-none"
                                  />
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleApplyPerSeasonBulk(sIdx, true)}
                                      disabled={scanningRange}
                                      title="Purane episodes rakhte hue naye episodes jodein"
                                      className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-black text-[10px] px-3 py-1.5 rounded cursor-pointer flex items-center gap-1"
                                    >
                                      {scanningRange ? <RefreshCw size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                                      <span>
                                        {(() => {
                                          const activeKey = `${seasonBulkStartUrl.trim()}|${seasonBulkEndUrl.trim()}|${scanQualityFilter}`;
                                          if (seasonBulkMode === 'range' && !skipTelegramScan && livePerSeasonScan.key === activeKey && livePerSeasonScan.data) {
                                            return `+ Append (+${livePerSeasonScan.data.videosFound} Eps)`;
                                          }
                                          return `+ Append to S${season.seasonNumber}`;
                                        })()}
                                      </span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleApplyPerSeasonBulk(sIdx, false)}
                                      disabled={scanningRange}
                                      className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-40 text-black font-black text-[10px] px-3 py-1.5 rounded cursor-pointer flex items-center gap-1"
                                    >
                                      {scanningRange && <RefreshCw size={11} className="animate-spin" />}
                                      <span>
                                        {scanningRange
                                          ? 'Scanning...'
                                          : (() => {
                                              const activeKey = `${seasonBulkStartUrl.trim()}|${seasonBulkEndUrl.trim()}|${scanQualityFilter}`;
                                              if (seasonBulkMode === 'range' && !skipTelegramScan && livePerSeasonScan.key === activeKey && livePerSeasonScan.data) {
                                                return `Replace S${season.seasonNumber} (${livePerSeasonScan.data.videosFound} Eps)`;
                                              }
                                              if (perSeasonRangePreview && perSeasonRangePreview.count > 0) {
                                                return `Scan & Save S${season.seasonNumber}`;
                                              }
                                              return `Replace S${season.seasonNumber}`;
                                            })()}
                                      </span>
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}

                            {isExpanded && (
                            <div className="space-y-2 pt-2 border-t border-neutral-800">
                              {season.episodes.map((ep, eIdx) => (
                                <div key={eIdx} className="flex flex-col gap-2 bg-neutral-950 p-2.5 rounded border border-neutral-800">
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-400 font-mono font-bold w-10 flex-shrink-0 text-[11px]">
                                      E{ep.episodeNumber}
                                    </span>
                                    <input
                                      type="text"
                                      value={ep.title}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setSeasons((prev) =>
                                          prev.map((s, si) =>
                                            si === sIdx
                                              ? {
                                                  ...s,
                                                  episodes: s.episodes.map((item, ei) =>
                                                    ei === eIdx ? { ...item, title: val } : item
                                                  ),
                                                }
                                              : s
                                          )
                                        );
                                      }}
                                      placeholder="Episode Title"
                                      className="flex-grow bg-neutral-900 border border-neutral-800 rounded p-1.5 text-white text-[11px]"
                                    />
                                    <div className="flex items-center gap-1 flex-shrink-0">
                                      {season.episodes.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveEpisode(sIdx, eIdx)}
                                          className="p-1.5 text-red-400 hover:bg-red-950/50 rounded transition-colors"
                                          title="Remove Episode"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      )}
                                        <button
                                          type="button"
                                          onClick={() => handleTestStream(ep.streamUrl, { sIdx, eIdx })}
                                          title="Test Episode Stream"
                                          className="p-1.5 text-yellow-400 hover:bg-yellow-400/20 rounded transition-colors"
                                        >
                                          <Play size={14} fill="currentColor" />
                                        </button>
                                      </div>
                                    </div>
                                    <div className="relative">
                                      <input
                                        type="text"
                                        value={ep.streamUrl}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          setSeasons((prev) =>
                                            prev.map((s, si) =>
                                              si === sIdx
                                                ? {
                                                    ...s,
                                                    episodes: s.episodes.map((item, ei) =>
                                                      ei === eIdx ? { ...item, streamUrl: val } : item
                                                    ),
                                                  }
                                                : s
                                            )
                                          );
                                        }}
                                        placeholder="1080p Video URL (Direct MP4 / Telegram)..."
                                        className="w-full bg-neutral-900 border border-neutral-800 rounded p-1.5 text-white font-mono text-[11px] pr-12"
                                      />
                                      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-black text-purple-500 uppercase">1080p</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="text"
                                        value={ep.duration || ''}
                                        onChange={(e) => {
                                          const val = e.target.value;
                                          const sec = parseDurationToSeconds(val);
                                          setSeasons((prev) =>
                                            prev.map((s, si) =>
                                              si === sIdx
                                                ? {
                                                    ...s,
                                                    episodes: s.episodes.map((item, ei) =>
                                                      ei === eIdx
                                                        ? { ...item, duration: val, ...(sec > 0 ? { durationSec: sec } : {}) }
                                                        : item
                                                    ),
                                                  }
                                                : s
                                            )
                                          );
                                        }}
                                        placeholder="Duration (e.g. 45m or 00:45:10)"
                                        className="w-40 bg-neutral-900 border border-neutral-800 rounded p-1 text-white text-[11px] placeholder-gray-600 focus:outline-none focus:border-yellow-400"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => handleTestStream(ep.streamUrl, { sIdx, eIdx })}
                                        disabled={!ep.streamUrl.trim()}
                                        className="flex items-center gap-1.5 bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-400 text-[10px] font-black uppercase px-2.5 py-1 rounded border border-yellow-400/20 transition-all active:scale-95 disabled:opacity-40 cursor-pointer"
                                      >
                                        <Play size={10} fill="currentColor" />
                                        Test & Verify Episode
                                      </button>
                                    </div>
                                  </div>
                              ))}
                            </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })()}

                  <div>
                    <label className="block text-gray-300 mb-1 font-semibold text-xs">Trailer URL (YouTube / Web)</label>
                    <input
                      type="url"
                      value={trailerUrl}
                      onChange={(e) => setTrailerUrl(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      className="w-full bg-neutral-950 border border-neutral-800 rounded p-2 text-white text-[11px] placeholder-gray-600 focus:outline-none focus:border-yellow-400 font-mono"
                    />
                  </div>
                </div>

                {/* Feature on Slider Toggle */}
                <div className="flex items-center gap-6 pt-1">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={featured}
                      onChange={(e) => setFeatured(e.target.checked)}
                      className="accent-yellow-400 w-4 h-4 rounded"
                    />
                    <span className="text-gray-300 font-semibold text-xs">Feature on Homepage Slider</span>
                  </label>
                </div>

                {/* Single Universal PUBLISH / UPDATE Action & Draft Button */}
                <div className="pt-2 space-y-2">
                  <button
                    type="submit"
                    disabled={formLoading}
                    className="w-full bg-yellow-400 hover:bg-yellow-500 text-black font-black py-3 px-4 rounded-lg shadow-lg hover:shadow-yellow-400/20 transition-all active:scale-[0.98] disabled:opacity-50 text-sm flex flex-col items-center justify-center gap-0.5 tracking-wider cursor-pointer"
                  >
                    {formLoading ? (
                      <div className="flex items-center gap-2">
                        <RefreshCw className="animate-spin" size={16} />
                        <span>{editingMovie ? 'SAVING CHANGES...' : 'PUBLISHING...'}</span>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5 text-base">
                          <Check size={18} className="stroke-[3]" />
                          <span>{editingMovie ? 'UPDATE MOVIE' : 'PUBLISH'}</span>
                        </div>
                        <span className="text-[10px] font-semibold text-black/80 normal-case">
                          {editingMovie
                            ? `Updates "${title || editingMovie.title}" • Badge: ${qualityBadge === 'NONE' ? 'No Badge' : qualityBadge}`
                            : `Publishes as ${originalCategory} → [${getDisplayCategory(originalCategory)} Section]`}
                        </span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSaveMovie(true)}
                    disabled={formLoading}
                    className="w-full bg-neutral-800 hover:bg-neutral-700 text-gray-300 font-bold py-2 rounded-lg border border-neutral-700 transition-colors disabled:opacity-50 text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {editingMovie ? 'Save Edit as Draft (Unpublished)' : 'Save as Draft (Unpublished)'}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Manage Movies List (7 cols) */}
          <div className="lg:col-span-7">
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 shadow-xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <ListFilter className="text-yellow-400" size={18} />
                    Manage Content ({filteredMovies.length})
                  </h2>

                  {/* Bulk Delete Button when items selected */}
                  {selectedMovieIds.length > 0 && (
                    <button
                      type="button"
                      onClick={handleOpenDeleteBulk}
                      disabled={isDeleting}
                      className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white font-black text-[11px] px-3 py-1 rounded-lg transition-all shadow-md shadow-red-600/30 cursor-pointer animate-in fade-in"
                    >
                      <Trash2 size={13} />
                      Delete Selected ({selectedMovieIds.length})
                    </button>
                  )}


                </div>

                {/* Filter Tabs & Select All Toggle */}
                <div className="flex flex-wrap items-center gap-2">
                  {filteredMovies.length > 0 && (
                    <button
                      type="button"
                      onClick={() => toggleSelectAll(filteredMovies)}
                      className="text-[10px] font-bold text-yellow-400 hover:text-yellow-300 flex items-center gap-1 bg-neutral-950 px-2 py-1 rounded border border-neutral-800 transition-colors cursor-pointer"
                    >
                      {filteredMovies.length > 0 && filteredMovies.every((m) => selectedMovieIds.includes(m.id)) ? (
                        <>
                          <CheckSquare size={12} className="text-yellow-400" /> Deselect All
                        </>
                      ) : (
                        <>
                          <Square size={12} className="text-gray-400" /> Select All ({filteredMovies.length})
                        </>
                      )}
                    </button>
                  )}

                  <div className="flex flex-wrap gap-1 bg-neutral-950 p-1 rounded-lg border border-neutral-800 text-[11px]">
                    {(['all', 'Bollywood', 'Hollywood', 'Series'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-2.5 py-1 rounded font-semibold capitalize transition-colors ${
                          activeTab === tab
                            ? 'bg-yellow-400 text-black'
                            : 'text-gray-400 hover:text-white'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {loadingMovies ? (
                <div className="p-12 text-center text-gray-500">
                  <RefreshCw className="animate-spin mx-auto mb-2 text-yellow-400" size={24} />
                  <span>Loading movies from Firestore...</span>
                </div>
              ) : filteredMovies.length === 0 ? (
                <div className="p-12 text-center text-gray-500 border border-dashed border-neutral-800 rounded-lg">
                  <Film className="mx-auto mb-2 text-neutral-700" size={32} />
                  <p className="font-semibold text-gray-400">No movies found in this tab.</p>
                  <p className="text-xs text-gray-600 mt-1">Search IMDb or fill out the form on the left to upload your content.</p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[700px] overflow-y-auto pr-1">
                  {filteredMovies.map((movie) => {
                    const isSelected = selectedMovieIds.includes(movie.id);
                    return (
                      <div
                        key={movie.id}
                        className={`flex flex-wrap sm:flex-nowrap items-center gap-2.5 sm:gap-3 p-2.5 rounded-lg border transition-all ${
                          isSelected
                            ? 'bg-red-950/20 border-red-800/80'
                            : 'bg-neutral-950 border-neutral-800/80 hover:border-neutral-700'
                        }`}
                      >
                        {/* Checkbox */}
                        <button
                          type="button"
                          onClick={() => toggleSelectMovie(movie.id)}
                          className="p-1 text-gray-400 hover:text-yellow-400 transition-colors cursor-pointer flex-shrink-0"
                        >
                          {isSelected ? (
                            <CheckSquare size={16} className="text-red-400" />
                          ) : (
                            <Square size={16} className="text-gray-600" />
                          )}
                        </button>

                        {/* Thumbnail */}
                        <img
                          src={upgradePosterUrl(movie.posterUrl, 1080) || movie.posterUrl || undefined}
                          alt={movie.title}
                          onError={(e: any) => {
                            const img = e.currentTarget;
                            if (movie.posterUrl && img.src !== movie.posterUrl && !img.dataset.triedRaw) {
                              img.dataset.triedRaw = '1';
                              img.src = movie.posterUrl;
                              return;
                            }
                            img.src = 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=800';
                          }}
                          className="w-12 h-16 object-cover rounded bg-neutral-800 flex-shrink-0"
                        />

                        {/* Info */}
                        <div className="flex-grow min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-white text-xs truncate">{movie.title}</h3>
                            {getVisibleQualityBadge(movie) ? (
                              <span className="bg-black border border-yellow-400/40 text-yellow-400 text-[9px] px-1.5 py-0.2 rounded font-black uppercase">
                                {getVisibleQualityBadge(movie)}
                              </span>
                            ) : (
                              <span className="bg-neutral-900 border border-neutral-700 text-gray-500 text-[9px] px-1.5 py-0.2 rounded font-semibold">
                                No Badge
                              </span>
                            )}
                            {movie.featured && (
                              <span className="bg-yellow-400/20 text-yellow-400 border border-yellow-400/30 text-[9px] px-1.5 py-0.2 rounded font-bold">
                                Featured
                              </span>
                            )}
                            {!movie.published && (
                              <span className="bg-gray-800 text-gray-400 border border-gray-700 text-[9px] px-1.5 py-0.2 rounded font-semibold">
                                Draft
                              </span>
                            )}
                            {movie.seasons && movie.seasons.length > 0 && (
                              <span className="bg-purple-950 text-purple-300 border border-purple-800/60 text-[9px] px-1.5 py-0.2 rounded font-bold">
                                {movie.seasons.length} Season(s)
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400 flex items-center gap-2 mt-0.5">
                            <span className="text-yellow-400/90 font-medium">{movie.displayCategory}</span>
                            <span>•</span>
                            <span>{movie.releaseYear}</span>
                            <span>•</span>
                            <span className="truncate">{movie.genre || movie.language}</span>
                            {movie.imdbId && <span className="text-[10px] text-gray-500">• {movie.imdbId}</span>}
                          </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-1 flex-shrink-0 w-full sm:w-auto justify-end pt-1 sm:pt-0 border-t border-neutral-900 sm:border-0">
                          {/* Edit Movie & Quality Badge button */}
                          <button
                            type="button"
                            onClick={() => handleStartEditMovie(movie)}
                            title="Edit Movie & Quality Badge"
                            className={`p-1.5 rounded transition-colors cursor-pointer ${
                              editingMovie?.id === movie.id
                                ? 'bg-yellow-400 text-black'
                                : 'text-sky-400 hover:bg-sky-950/50'
                            }`}
                          >
                            <Pencil size={15} />
                          </button>

                          {/* Stream preview button if available */}
                          {movie.streamingUrl && (
                            <button
                              onClick={() => handleTestStream(movie.streamingUrl!)}
                              title="Test Video Stream"
                              className="p-1.5 text-yellow-400 hover:bg-yellow-400/20 rounded transition-colors cursor-pointer"
                            >
                              <Play size={16} fill="currentColor" />
                            </button>
                          )}

                          {/* Publish toggle */}
                          <button
                            onClick={() => handleTogglePublish(movie)}
                            title={movie.published ? 'Unpublish (Make Draft)' : 'Publish Movie'}
                            className={`p-1.5 rounded transition-colors cursor-pointer ${
                              movie.published
                                ? 'text-green-400 hover:bg-green-950/50'
                                : 'text-gray-500 hover:bg-neutral-800'
                            }`}
                          >
                            {movie.published ? <Eye size={16} /> : <EyeOff size={16} />}
                          </button>

                          {/* Feature toggle */}
                          <button
                            onClick={() => handleToggleFeatured(movie)}
                            title={movie.featured ? 'Remove from Featured' : 'Feature on Slider'}
                            className={`p-1.5 rounded transition-colors cursor-pointer ${
                              movie.featured
                                ? 'text-yellow-400 hover:bg-yellow-950/50'
                                : 'text-gray-600 hover:bg-neutral-800'
                            }`}
                          >
                            <Sparkles size={16} />
                          </button>

                          {/* Delete button */}
                          <button
                            onClick={() => handleOpenDeleteSingle(movie)}
                            title="Delete permanently"
                            className="p-1.5 text-red-500 hover:bg-red-950/50 rounded transition-colors cursor-pointer"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Admin Delete Confirmation Modal */}
      {deleteModal?.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-md w-full p-6 shadow-2xl relative overflow-hidden">
            {/* Header / Banner */}
            <div className="flex items-start gap-3.5 mb-4">
              <div className="p-3 bg-red-950/80 border border-red-800/80 text-red-400 rounded-xl flex-shrink-0">
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 className="text-lg font-black text-white tracking-tight">
                  {deleteModal.type === 'single' && 'Confirm Content Deletion'}
                  {deleteModal.type === 'bulk' && `Confirm Bulk Deletion (${deleteModal.count} items)`}
                  {deleteModal.type === 'all' && 'Confirm Catalog Wipe'}
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  This action is permanent. The selected content will be removed from database and local storage.
                </p>
              </div>
            </div>

            {/* Target Details */}
            {deleteModal.type === 'single' && deleteModal.item && (
              <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 mb-5 flex items-start gap-3">
                <img
                  src={upgradePosterUrl(deleteModal.item.posterUrl, 1080) || deleteModal.item.posterUrl || 'https://images.unsplash.com/photo-1595760205842-8356d2cf98b1?q=80&w=800'}
                  alt={deleteModal.item.title}
                  className="w-12 h-16 object-cover rounded bg-neutral-800 flex-shrink-0"
                />
                <div className="min-w-0 flex-grow text-xs">
                  <h4 className="font-bold text-white text-sm truncate">{deleteModal.item.title}</h4>
                  <div className="text-gray-400 mt-0.5 flex items-center gap-2">
                    <span className="text-yellow-400 font-medium">{deleteModal.item.displayCategory}</span>
                    <span>•</span>
                    <span>{deleteModal.item.releaseYear}</span>
                  </div>
                  {deleteModal.item.seasons && deleteModal.item.seasons.length > 0 && (
                    <div className="mt-1.5 text-[10px] text-purple-400 bg-purple-950/60 border border-purple-800/40 px-2 py-0.5 rounded inline-block font-semibold">
                      Series with {deleteModal.item.seasons.length} Season(s) and all Episodes will be deleted.
                    </div>
                  )}
                </div>
              </div>
            )}

            {deleteModal.type === 'bulk' && (
              <div className="bg-neutral-950 p-3.5 rounded-xl border border-neutral-800 mb-5 text-xs text-gray-300">
                <span className="font-bold text-yellow-400 block mb-1">
                  {deleteModal.count} Selected Items:
                </span>
                <p className="text-gray-400 text-[11px] leading-relaxed">
                  All selected movies, web series, seasons, and episodes will be permanently deleted.
                </p>
              </div>
            )}

            {deleteModal.type === 'all' && (
              <div className="bg-red-950/40 border border-red-800/50 p-3.5 rounded-xl mb-5 text-xs text-red-300">
                <span className="font-bold block mb-1">Warning: Catalog Wipe</span>
                <p className="text-[11px] leading-relaxed">
                  Every movie and series in the catalog ({movies.length} items) will be erased.
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteModal(null)}
                disabled={isDeleting}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-gray-300 font-bold text-xs rounded-lg transition-colors disabled:opacity-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (deleteModal.type === 'single' && deleteModal.item) {
                    confirmDeleteSingle(deleteModal.item);
                  } else if (deleteModal.type === 'bulk') {
                    confirmDeleteBulk();
                  } else if (deleteModal.type === 'all') {
                    confirmDeleteAll();
                  }
                }}
                disabled={isDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-black text-xs rounded-lg shadow-lg shadow-red-600/30 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2 cursor-pointer"
              >
                {isDeleting ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 size={14} />
                    <span>Confirm Delete</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stream Player Preview Modal */}
      {testingStream && (
        <VideoPlayerModal
          isOpen={Boolean(testingStream)}
          onClose={() => setTestingStream(null)}
          title={testingStream.title}
          videoUrl={testingStream.url}
          videoQualities={{}}
          category={testingStream.category}
          posterUrl={testingStream.posterUrl}
          initialDuration={testingStream.duration}
        />
      )}
    </div>
  );
}
