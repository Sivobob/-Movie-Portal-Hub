import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  buildApiUrl,
  ensureAndroidStreamBridge,
  getNativeLocalBridgeUrl,
  getRemoteTranscodeBackendUrl,
  probeWorkingBackendUrl,
} from '../utils/apiConfig';
import {
  deleteOfflineVideo,
  formatBytesLabel,
  saveOfflineVideoBlob,
} from '../services/offlineStorage';

export interface ActiveDownload {
  id: string;
  movieId?: string;
  title: string;
  posterUrl: string;
  quality: string;
  videoUrl: string;
  progress: number; // 0 to 100
  receivedBytes: number;
  totalBytes: number;
  speed: string; // e.g. "3.2 MB/s"
  eta: string; // e.g. "1m 20s"
  status: 'downloading' | 'paused' | 'completed' | 'error';
  errorMessage?: string;
  startTime: number;
  seasonNumber?: number;
  episodeNumber?: number;
  seasonEpisodeLabel?: string;
  isNative?: boolean;
}

export interface DownloadedItem {
  id: string;
  movieId?: string;
  offlineKey: string;
  localUri?: string;
  title: string;
  posterUrl: string;
  releaseYear: number;
  originalCategory: string;
  downloadedAt: number;
  fileSize?: string;
  sizeBytes?: number;
  videoUrl: string;
  quality?: string;
  videoQualities?: Record<string, string>;
  seasonNumber?: number;
  episodeNumber?: number;
  seasonEpisodeLabel?: string;
  isOfflineReady?: boolean;
}

export interface StartDownloadParams {
  movieId?: string;
  title: string;
  posterUrl: string;
  videoUrl: string;
  quality?: string;
  releaseYear?: number;
  originalCategory?: string;
  estimatedSizeMb?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  seasonEpisodeLabel?: string;
}

const STORAGE_KEY = 'app_downloads';

interface StoreState {
  downloads: DownloadedItem[];
  activeDownloads: ActiveDownload[];
  lastNotification: string | null;
}

function loadInitialDownloads(): DownloadedItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const storeState: StoreState = {
  downloads: loadInitialDownloads(),
  activeDownloads: [],
  lastNotification: null,
};

const listeners = new Set<() => void>();
let notificationClearTimer: ReturnType<typeof setTimeout> | null = null;

function emitChange() {
  listeners.forEach((cb) => {
    try {
      cb();
    } catch {}
  });
}

function setGlobalNotification(msg: string | null, autoClearMs = 4500) {
  storeState.lastNotification = msg;
  if (notificationClearTimer) {
    clearTimeout(notificationClearTimer);
    notificationClearTimer = null;
  }
  if (msg && autoClearMs > 0) {
    notificationClearTimer = setTimeout(() => {
      storeState.lastNotification = null;
      emitChange();
    }, autoClearMs);
  }
  emitChange();
}

function persistDownloads(items: DownloadedItem[]) {
  storeState.downloads = items;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn('[Downloads] Failed to persist download index:', err);
  }
  emitChange();
}

function upsertActiveTask(task: ActiveDownload) {
  const idx = storeState.activeDownloads.findIndex((d) => d.id === task.id);
  if (idx >= 0) {
    const next = [...storeState.activeDownloads];
    next[idx] = task;
    storeState.activeDownloads = next;
  } else {
    storeState.activeDownloads = [task, ...storeState.activeDownloads];
  }
  emitChange();
}

function updateActiveTask(id: string, patch: Partial<ActiveDownload>) {
  const idx = storeState.activeDownloads.findIndex((d) => d.id === id);
  if (idx < 0) return;
  const next = [...storeState.activeDownloads];
  next[idx] = { ...next[idx], ...patch };
  storeState.activeDownloads = next;
  emitChange();
}

function removeActiveTask(id: string) {
  const prevLen = storeState.activeDownloads.length;
  storeState.activeDownloads = storeState.activeDownloads.filter((d) => d.id !== id);
  if (storeState.activeDownloads.length !== prevLen) {
    emitChange();
  }
}

function addCompletedDownload(item: DownloadedItem) {
  const filtered = storeState.downloads.filter((d) => d.id !== item.id);
  persistDownloads([item, ...filtered]);
}

function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '0 KB/s';
  const mb = bytesPerSec / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  const kb = Math.max(1, Math.round(bytesPerSec / 1024));
  return `${kb} KB/s`;
}

function formatEta(remainingBytes: number, bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 1024 || remainingBytes <= 0) {
    return 'Calculating...';
  }
  const totalSec = Math.max(1, Math.round(remainingBytes / bytesPerSec));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

// Web Browser System Notification helper (shows % when user allows notifications)
const lastWebNotifTime: Record<string, number> = {};

function requestBrowserNotificationPermissionOnce() {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return;
  try {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  } catch {}
}

function pushBrowserSystemNotification(
  id: string,
  title: string,
  body: string,
  force = false
) {
  if (typeof window === 'undefined' || Capacitor.isNativePlatform()) return;
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const now = Date.now();
    if (!force && now - (lastWebNotifTime[id] || 0) < 2500) return;
    lastWebNotifTime[id] = now;
    new Notification(title, {
      body,
      tag: `mp-dl-${id}`,
      icon: '/assets/icons/master_icon.png',
      silent: !force,
    });
  } catch {}
}

// Pending metadata stored alongside active tasks so completed records preserve year/category
interface PendingTaskMeta {
  movieId?: string;
  baseTitle: string;
  posterUrl: string;
  quality: string;
  videoUrl: string;
  releaseYear: number;
  originalCategory: string;
  seasonNumber?: number;
  episodeNumber?: number;
  seasonEpisodeLabel?: string;
  primaryFetchUrl: string;
  fallbackFetchUrl: string;
  estimatedTotalBytes: number;
}

const pendingTaskMetaMap = new Map<string, PendingTaskMeta>();

// Web active streaming runners (for real Pause/Resume/Cancel with chunk accumulation)
interface WebRunner {
  chunks: Uint8Array[];
  receivedBytes: number;
  totalBytes: number;
  mimeType: string;
  paused: boolean;
  cancelled: boolean;
  controller: AbortController | null;
}

const webRunners = new Map<string, WebRunner>();

async function resolveDownloadUrls(
  rawUrl: string,
  estimatedSizeMb: number
): Promise<{
  primaryUrl: string;
  fallbackUrl: string;
  estimatedTotalBytes: number;
}> {
  const trimmed = String(rawUrl || '').trim();
  const isTelegram = /t\.me|telegram\.me/i.test(trimmed);
  const estBytes = Math.max(0, Math.round(estimatedSizeMb * 1024 * 1024));

  if (!isTelegram) {
    const proxyUrl = buildApiUrl(
      `/api/download/file?url=${encodeURIComponent(trimmed)}&filename=video.mp4`
    );
    return {
      primaryUrl: trimmed,
      fallbackUrl: proxyUrl,
      estimatedTotalBytes: estBytes,
    };
  }

  if (Capacitor.isNativePlatform()) {
    const localUrl = await ensureAndroidStreamBridge().catch(() => '');
    await probeWorkingBackendUrl().catch(() => null);
    const remoteBase = getRemoteTranscodeBackendUrl();
    const localBase = localUrl || getNativeLocalBridgeUrl();
    const localStreamUrl = localBase
      ? `${localBase}/api/stream?url=${encodeURIComponent(trimmed)}&ext=.mp4`
      : '';
    const remoteStreamUrl = remoteBase
      ? `${remoteBase}/api/stream?url=${encodeURIComponent(trimmed)}&raw=1`
      : '';

    return {
      primaryUrl: localStreamUrl || remoteStreamUrl || buildApiUrl(`/api/stream?url=${encodeURIComponent(trimmed)}&raw=1`),
      fallbackUrl: remoteStreamUrl || localStreamUrl || '',
      estimatedTotalBytes: estBytes,
    };
  }

  // Web browser: check stream-info to choose direct raw MP4 vs transcoded browser-compatible MP4 + get real fileSize
  let totalBytes = estBytes;
  let recommendedMode: 'direct' | 'remux' | 'transcode' = 'direct';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const infoRes = await fetch(
      buildApiUrl(`/api/telegram/stream-info?url=${encodeURIComponent(trimmed)}`),
      { cache: 'no-store', signal: ctrl.signal }
    ).finally(() => clearTimeout(timer));
    if (infoRes.ok) {
      const info = await infoRes.json();
      if (info?.fileSize && Number(info.fileSize) > 0) {
        totalBytes = Number(info.fileSize);
      }
      if (
        info?.recommendedMode === 'remux' ||
        info?.recommendedMode === 'transcode' ||
        info?.recommendedMode === 'direct'
      ) {
        recommendedMode = info.recommendedMode;
      }
    }
  } catch {}

  const streamUrl =
    recommendedMode === 'direct'
      ? buildApiUrl(`/api/stream?url=${encodeURIComponent(trimmed)}&raw=1`)
      : buildApiUrl(`/api/stream?url=${encodeURIComponent(trimmed)}&ext=.mp4`);

  return {
    primaryUrl: streamUrl,
    fallbackUrl: buildApiUrl(`/api/stream?url=${encodeURIComponent(trimmed)}&raw=1`),
    estimatedTotalBytes: totalBytes,
  };
}

async function runWebDownload(taskId: string, retryWithFallback = false) {
  const meta = pendingTaskMetaMap.get(taskId);
  const runner = webRunners.get(taskId);
  if (!meta || !runner || runner.cancelled || runner.paused) return;

  const targetUrl =
    retryWithFallback && meta.fallbackFetchUrl ? meta.fallbackFetchUrl : meta.primaryFetchUrl;

  const controller = new AbortController();
  runner.controller = controller;

  const headers: Record<string, string> = {};
  if (runner.receivedBytes > 0 && runner.totalBytes > runner.receivedBytes) {
    headers['Range'] = `bytes=${runner.receivedBytes}-${runner.totalBytes - 1}`;
  }

  let response: Response;
  try {
    response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });
  } catch (err: any) {
    if (runner.cancelled || runner.paused || err?.name === 'AbortError') {
      return;
    }
    // Retry via backend proxy if direct third-party URL fails CORS on browser
    if (!retryWithFallback && meta.fallbackFetchUrl && meta.fallbackFetchUrl !== targetUrl) {
      return runWebDownload(taskId, true);
    }
    updateActiveTask(taskId, {
      status: 'error',
      speed: '0 KB/s',
      eta: 'Failed',
      errorMessage: err?.message || 'Network download failed',
    });
    setGlobalNotification(`Download failed: ${meta.baseTitle}`);
    pushBrowserSystemNotification(taskId, 'Download Failed', meta.baseTitle, true);
    return;
  }

  if (!response.ok) {
    if (!retryWithFallback && meta.fallbackFetchUrl && meta.fallbackFetchUrl !== targetUrl) {
      return runWebDownload(taskId, true);
    }
    updateActiveTask(taskId, {
      status: 'error',
      speed: '0 KB/s',
      eta: 'Failed',
      errorMessage: `Server returned HTTP ${response.status}`,
    });
    setGlobalNotification(`Download failed (${response.status}): ${meta.baseTitle}`);
    return;
  }

  // If we asked for a Range resume but server responded with 200 full stream, restart cleanly from 0
  if (response.status === 200 && runner.receivedBytes > 0) {
    runner.chunks = [];
    runner.receivedBytes = 0;
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.toLowerCase().includes('text/html') || contentType.toLowerCase().includes('application/json')) {
    updateActiveTask(taskId, {
      status: 'error',
      speed: '0 KB/s',
      eta: 'Failed',
      errorMessage: 'Stream link did not return a playable video file.',
    });
    setGlobalNotification(`Unable to download "${meta.baseTitle}": invalid video source`);
    return;
  }
  if (contentType) {
    runner.mimeType = contentType.split(';')[0].trim() || 'video/mp4';
  }

  const contentRangeHeader = response.headers.get('content-range');
  const contentLenHeader = response.headers.get('content-length');
  if (contentRangeHeader) {
    const match = contentRangeHeader.match(/\/(\d+)/);
    if (match && Number(match[1]) > 0) {
      runner.totalBytes = Number(match[1]);
    }
  } else if (contentLenHeader && Number(contentLenHeader) > 0) {
    runner.totalBytes = runner.receivedBytes + Number(contentLenHeader);
  } else if (!runner.totalBytes && meta.estimatedTotalBytes > 0) {
    runner.totalBytes = meta.estimatedTotalBytes;
  }

  if (!response.body) {
    // Fallback if stream reader unsupported
    const blob = await response.blob();
    if (runner.cancelled) return;
    await finalizeWebDownload(taskId, meta, blob);
    return;
  }

  const reader = response.body.getReader();
  let speedSampleStartMs = Date.now();
  let speedSampleBytes = 0;
  let lastUiUpdateMs = 0;
  let currentBytesPerSec = 0;

  try {
    while (true) {
      if (runner.cancelled || runner.paused) {
        try {
          await reader.cancel();
        } catch {}
        return;
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        runner.chunks.push(value);
        runner.receivedBytes += value.byteLength;
        speedSampleBytes += value.byteLength;

        const now = Date.now();
        const elapsedMs = now - speedSampleStartMs;
        if (elapsedMs >= 500) {
          currentBytesPerSec = (speedSampleBytes * 1000) / elapsedMs;
          speedSampleStartMs = now;
          speedSampleBytes = 0;
        }

        if (now - lastUiUpdateMs >= 250) {
          lastUiUpdateMs = now;
          const totalForPct = Math.max(runner.totalBytes, runner.receivedBytes);
          const pct =
            runner.totalBytes > 0
              ? Math.min(99, Math.max(1, Math.round((runner.receivedBytes / runner.totalBytes) * 100)))
              : Math.min(95, Math.max(2, Math.round(runner.receivedBytes / (8 * 1024 * 1024))));
          const speedLabel = formatSpeed(currentBytesPerSec);
          const etaLabel =
            runner.totalBytes > 0
              ? formatEta(Math.max(0, runner.totalBytes - runner.receivedBytes), currentBytesPerSec)
              : 'Downloading...';

          updateActiveTask(taskId, {
            progress: pct,
            receivedBytes: runner.receivedBytes,
            totalBytes: totalForPct,
            speed: speedLabel,
            eta: etaLabel,
            status: 'downloading',
          });

          pushBrowserSystemNotification(
            taskId,
            `Downloading (${pct}%)`,
            `${meta.baseTitle} • ${formatBytesLabel(runner.receivedBytes)} • ${speedLabel}`
          );
        }
      }
    }

    if (runner.cancelled || runner.paused) return;

    const finalBlob = new Blob(runner.chunks as unknown as BlobPart[], {
      type: runner.mimeType || 'video/mp4',
    });
    runner.chunks = [];
    await finalizeWebDownload(taskId, meta, finalBlob);
  } catch (err: any) {
    if (runner.cancelled || runner.paused || err?.name === 'AbortError') {
      return;
    }
    updateActiveTask(taskId, {
      status: 'error',
      speed: '0 KB/s',
      eta: 'Interrupted',
      errorMessage: err?.message || 'Download stream interrupted',
    });
    setGlobalNotification(`Download interrupted: ${meta.baseTitle}`);
    pushBrowserSystemNotification(taskId, 'Download Interrupted', meta.baseTitle, true);
  }
}

async function finalizeWebDownload(taskId: string, meta: PendingTaskMeta, blob: Blob) {
  if (blob.size <= 0) {
    updateActiveTask(taskId, {
      status: 'error',
      speed: '0 KB/s',
      eta: 'Failed',
      errorMessage: 'Downloaded file was empty.',
    });
    return;
  }

  try {
    await saveOfflineVideoBlob(taskId, blob, blob.type || 'video/mp4');
  } catch (err: any) {
    updateActiveTask(taskId, {
      status: 'error',
      speed: '0 KB/s',
      eta: 'Storage Full',
      errorMessage: err?.message || 'Could not save video to offline storage',
    });
    return;
  }

  const sizeLabel = formatBytesLabel(blob.size);
  updateActiveTask(taskId, {
    progress: 100,
    receivedBytes: blob.size,
    totalBytes: blob.size,
    status: 'completed',
    speed: 'Saved Offline',
    eta: '0s',
  });

  const completedItem: DownloadedItem = {
    id: taskId,
    movieId: meta.movieId,
    offlineKey: taskId,
    title: meta.baseTitle,
    posterUrl: meta.posterUrl,
    releaseYear: meta.releaseYear,
    originalCategory: meta.originalCategory,
    downloadedAt: Date.now(),
    fileSize: sizeLabel,
    sizeBytes: blob.size,
    videoUrl: meta.videoUrl,
    quality: meta.quality,
    seasonNumber: meta.seasonNumber,
    episodeNumber: meta.episodeNumber,
    seasonEpisodeLabel: meta.seasonEpisodeLabel,
    isOfflineReady: true,
  };

  addCompletedDownload(completedItem);
  webRunners.delete(taskId);
  pendingTaskMetaMap.delete(taskId);

  setGlobalNotification(`Downloaded: "${meta.baseTitle}" — Ready offline!`, 5000);
  pushBrowserSystemNotification(
    taskId,
    'Download Complete (100%)',
    `${meta.baseTitle} (${sizeLabel}) • Ready to watch offline!`,
    true
  );

  setTimeout(() => {
    removeActiveTask(taskId);
  }, 1400);
}

// Native Android download polling loop
let nativePollTimer: ReturnType<typeof setInterval> | null = null;

function syncNativeDownloadTasksFromBridge() {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform()) return;
  const bridge = (window as any).AndroidPlayerBridge;
  if (!bridge || typeof bridge.getOfflineDownloadsStatus !== 'function') return;

  try {
    const raw = bridge.getOfflineDownloadsStatus();
    if (!raw) return;
    const list: any[] = JSON.parse(raw);
    if (!Array.isArray(list)) return;

    let anyStillDownloading = false;

    for (const nativeTask of list) {
      const id = String(nativeTask.id || '');
      if (!id) continue;
      const status = String(nativeTask.status || 'downloading') as ActiveDownload['status'];
      const progress = Math.max(0, Math.min(100, Number(nativeTask.progress || 0)));
      const receivedBytes = Number(nativeTask.receivedBytes || 0);
      const totalBytes = Number(nativeTask.totalBytes || 0);
      const speed = String(nativeTask.speed || '0 KB/s');
      const eta = String(nativeTask.eta || 'Calculating...');
      const localUri = String(nativeTask.localUri || '');
      const errorMessage = nativeTask.errorMessage ? String(nativeTask.errorMessage) : undefined;
      const meta = pendingTaskMetaMap.get(id);

      if (status === 'downloading' || status === 'paused') {
        anyStillDownloading = true;
      }

      if (status === 'completed') {
        const alreadySaved = storeState.downloads.some((d) => d.id === id);
        if (!alreadySaved && meta) {
          const finalBytes = totalBytes > 0 ? totalBytes : receivedBytes;
          const sizeLabel = formatBytesLabel(finalBytes);
          const completedItem: DownloadedItem = {
            id,
            movieId: meta.movieId,
            offlineKey: id,
            localUri,
            title: meta.baseTitle,
            posterUrl: meta.posterUrl,
            releaseYear: meta.releaseYear,
            originalCategory: meta.originalCategory,
            downloadedAt: Date.now(),
            fileSize: sizeLabel,
            sizeBytes: finalBytes,
            videoUrl: meta.videoUrl,
            quality: meta.quality,
            seasonNumber: meta.seasonNumber,
            episodeNumber: meta.episodeNumber,
            seasonEpisodeLabel: meta.seasonEpisodeLabel,
            isOfflineReady: true,
          };
          addCompletedDownload(completedItem);
          setGlobalNotification(`Downloaded: "${meta.baseTitle}" — Ready offline!`, 5000);
          pendingTaskMetaMap.delete(id);
        }
        updateActiveTask(id, {
          progress: 100,
          receivedBytes,
          totalBytes: Math.max(totalBytes, receivedBytes),
          speed: 'Saved Offline',
          eta: '0s',
          status: 'completed',
        });
        setTimeout(() => removeActiveTask(id), 1200);
        continue;
      }

      if (status === 'error') {
        updateActiveTask(id, {
          progress,
          receivedBytes,
          totalBytes,
          speed: '0 KB/s',
          eta: 'Failed',
          status: 'error',
          errorMessage: errorMessage || 'Download failed',
        });
        continue;
      }

      updateActiveTask(id, {
        progress,
        receivedBytes,
        totalBytes,
        speed,
        eta,
        status,
      });
    }

    if (!anyStillDownloading && nativePollTimer) {
      clearInterval(nativePollTimer);
      nativePollTimer = null;
    }
  } catch {}
}

function ensureNativeDownloadPolling() {
  if (nativePollTimer) return;
  nativePollTimer = setInterval(syncNativeDownloadTasksFromBridge, 550);
}

export async function startGlobalDownload(params: StartDownloadParams): Promise<string> {
  const {
    movieId,
    title,
    posterUrl,
    videoUrl,
    quality = 'HD',
    releaseYear = new Date().getFullYear(),
    originalCategory = 'Movie',
    estimatedSizeMb = 750,
    seasonNumber,
    episodeNumber,
    seasonEpisodeLabel,
  } = params;

  const cleanUrl = String(videoUrl || '').trim();
  if (!cleanUrl) {
    setGlobalNotification('No downloadable video link found for this title.');
    return '';
  }

  // Prevent duplicate active download for exact same title/episode
  const existingActive = storeState.activeDownloads.find(
    (d) =>
      d.status !== 'error' &&
      ((movieId && d.movieId === movieId && d.seasonNumber === seasonNumber && d.episodeNumber === episodeNumber) ||
        d.videoUrl === cleanUrl)
  );
  if (existingActive) {
    setGlobalNotification(`Already downloading "${existingActive.title}" (${existingActive.progress}%)`);
    return existingActive.id;
  }

  const downloadId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    try {
      const bridge = (window as any).AndroidPlayerBridge;
      if (typeof bridge?.hasNotificationPermission === 'function' && !bridge.hasNotificationPermission()) {
        bridge.requestNotificationPermission?.();
      }
    } catch {}
  } else {
    requestBrowserNotificationPermissionOnce();
  }

  const initialEstBytes = Math.max(0, Math.round(estimatedSizeMb * 1024 * 1024));
  const displayTitle = seasonEpisodeLabel && !title.includes(seasonEpisodeLabel)
    ? `${title} (${seasonEpisodeLabel})`
    : title;

  const initialTask: ActiveDownload = {
    id: downloadId,
    movieId,
    title: displayTitle,
    posterUrl,
    quality,
    videoUrl: cleanUrl,
    progress: 0,
    receivedBytes: 0,
    totalBytes: initialEstBytes,
    speed: 'Connecting...',
    eta: 'Starting...',
    status: 'downloading',
    startTime: Date.now(),
    seasonNumber,
    episodeNumber,
    seasonEpisodeLabel,
    isNative,
  };

  upsertActiveTask(initialTask);
  setGlobalNotification(`Starting download: "${displayTitle}"`);

  const resolved = await resolveDownloadUrls(cleanUrl, estimatedSizeMb);
  const estTotal = resolved.estimatedTotalBytes || initialEstBytes;

  const meta: PendingTaskMeta = {
    movieId,
    baseTitle: displayTitle,
    posterUrl,
    quality,
    videoUrl: cleanUrl,
    releaseYear,
    originalCategory,
    seasonNumber,
    episodeNumber,
    seasonEpisodeLabel,
    primaryFetchUrl: resolved.primaryUrl,
    fallbackFetchUrl: resolved.fallbackUrl,
    estimatedTotalBytes: estTotal,
  };
  pendingTaskMetaMap.set(downloadId, meta);
  updateActiveTask(downloadId, { totalBytes: estTotal });

  if (isNative && typeof (window as any).AndroidPlayerBridge?.startOfflineVideoDownload === 'function') {
    try {
      (window as any).AndroidPlayerBridge.startOfflineVideoDownload(
        downloadId,
        displayTitle,
        resolved.primaryUrl,
        resolved.fallbackUrl || ''
      );
      ensureNativeDownloadPolling();
      return downloadId;
    } catch (err) {
      console.warn('[NativeDownload] Bridge call failed, falling back to web stream:', err);
    }
  }

  webRunners.set(downloadId, {
    chunks: [],
    receivedBytes: 0,
    totalBytes: estTotal,
    mimeType: 'video/mp4',
    paused: false,
    cancelled: false,
    controller: null,
  });
  runWebDownload(downloadId, false);
  return downloadId;
}

export async function removeCompletedDownload(id: string): Promise<void> {
  const target = storeState.downloads.find((d) => d.id === id);
  const updated = storeState.downloads.filter((d) => d.id !== id);
  persistDownloads(updated);
  await deleteOfflineVideo(target?.offlineKey || id, target?.localUri);
}

export function cancelActiveDownloadTask(id: string): void {
  const runner = webRunners.get(id);
  if (runner) {
    runner.cancelled = true;
    try {
      runner.controller?.abort();
    } catch {}
    runner.chunks = [];
    webRunners.delete(id);
  }
  if (Capacitor.isNativePlatform()) {
    try {
      (window as any).AndroidPlayerBridge?.cancelOfflineVideoDownload?.(id);
    } catch {}
  }
  pendingTaskMetaMap.delete(id);
  removeActiveTask(id);
}

export function pauseActiveDownloadTask(id: string): void {
  const runner = webRunners.get(id);
  if (runner) {
    runner.paused = true;
    try {
      runner.controller?.abort();
    } catch {}
  }
  if (Capacitor.isNativePlatform()) {
    try {
      (window as any).AndroidPlayerBridge?.pauseOfflineVideoDownload?.(id);
    } catch {}
  }
  updateActiveTask(id, { status: 'paused', speed: 'Paused', eta: 'Paused' });
}

export function resumeActiveDownloadTask(id: string): void {
  const runner = webRunners.get(id);
  if (runner) {
    runner.paused = false;
    updateActiveTask(id, { status: 'downloading', speed: 'Resuming...', eta: 'Calculating...' });
    runWebDownload(id, false);
    return;
  }
  if (Capacitor.isNativePlatform()) {
    try {
      (window as any).AndroidPlayerBridge?.resumeOfflineVideoDownload?.(id);
      ensureNativeDownloadPolling();
    } catch {}
    updateActiveTask(id, { status: 'downloading', speed: 'Resuming...', eta: 'Calculating...' });
    return;
  }
  // If retry from error without runner, re-create runner from existing active task
  const task = storeState.activeDownloads.find((d) => d.id === id);
  const meta = pendingTaskMetaMap.get(id);
  if (task && meta) {
    webRunners.set(id, {
      chunks: [],
      receivedBytes: 0,
      totalBytes: meta.estimatedTotalBytes,
      mimeType: 'video/mp4',
      paused: false,
      cancelled: false,
      controller: null,
    });
    updateActiveTask(id, {
      status: 'downloading',
      progress: 0,
      receivedBytes: 0,
      errorMessage: undefined,
      speed: 'Retrying...',
      eta: 'Starting...',
    });
    runWebDownload(id, false);
  }
}

export function useDownloads() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const onUpdate = () => setTick((t) => t + 1);
    listeners.add(onUpdate);
    return () => {
      listeners.delete(onUpdate);
    };
  }, []);

  const getDownloadMatch = (
    movieId?: string,
    videoUrl?: string,
    seasonNumber?: number,
    episodeNumber?: number
  ) => {
    const active = storeState.activeDownloads.find((d) => {
      if (videoUrl && d.videoUrl === videoUrl) return true;
      if (movieId && d.movieId === movieId) {
        if (seasonNumber !== undefined && episodeNumber !== undefined) {
          return d.seasonNumber === seasonNumber && d.episodeNumber === episodeNumber;
        }
        return true;
      }
      return false;
    });

    const completed = storeState.downloads.find((d) => {
      if (videoUrl && d.videoUrl === videoUrl) return true;
      if (movieId && d.movieId === movieId) {
        if (seasonNumber !== undefined && episodeNumber !== undefined) {
          return d.seasonNumber === seasonNumber && d.episodeNumber === episodeNumber;
        }
        return true;
      }
      return false;
    });

    return { active, completed };
  };

  return {
    downloads: storeState.downloads,
    activeDownloads: storeState.activeDownloads,
    startDownload: startGlobalDownload,
    removeDownload: removeCompletedDownload,
    cancelActiveDownload: cancelActiveDownloadTask,
    pauseActiveDownload: pauseActiveDownloadTask,
    resumeActiveDownload: resumeActiveDownloadTask,
    lastNotification: storeState.lastNotification,
    setLastNotification: (msg: string | null) => setGlobalNotification(msg),
    getDownloadMatch,
  };
}
