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
  clearOfflineVideoChunks,
  deleteOfflineVideo,
  finalizeOfflineChunkedVideo,
  formatBytesLabel,
  requestPersistentOfflineStorage,
  saveOfflineVideoChunk,
} from '../services/offlineStorage';
import { QualitySizeEstimate, VideoQualityTier } from '../utils/videoQuality';

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
  qualityTier?: VideoQualityTier | 'original';
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

// Web active streaming runners (for real Pause/Resume/Cancel with progressive IndexedDB chunks)
const RANGE_CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB slices
const MAX_CHUNK_ATTEMPTS = 5;
const MAX_CONCURRENT_WEB_DOWNLOADS = 2;

interface WebRunner {
  pendingParts: Uint8Array[];
  pendingBytes: number;
  chunkIndex: number;
  receivedBytes: number;
  totalBytes: number;
  mimeType: string;
  supportsRange: boolean | null;
  usingFallback: boolean;
  paused: boolean;
  cancelled: boolean;
  controller: AbortController | null;
}

const webRunners = new Map<string, WebRunner>();
const activeWebTaskIds = new Set<string>();
const queuedWebTaskIds: string[] = [];

function removeFromWebQueue(taskId: string) {
  const idx = queuedWebTaskIds.indexOf(taskId);
  if (idx >= 0) {
    queuedWebTaskIds.splice(idx, 1);
  }
}

function pumpWebDownloadQueue() {
  while (activeWebTaskIds.size < MAX_CONCURRENT_WEB_DOWNLOADS && queuedWebTaskIds.length > 0) {
    const nextId = queuedWebTaskIds.shift()!;
    const runner = webRunners.get(nextId);
    const meta = pendingTaskMetaMap.get(nextId);
    if (!runner || !meta || runner.cancelled || runner.paused) continue;
    activeWebTaskIds.add(nextId);
    updateActiveTask(nextId, {
      status: 'downloading',
      speed: 'Connecting...',
      eta: 'Starting...',
    });
    runWebDownload(nextId, runner.usingFallback).finally(() => {
      activeWebTaskIds.delete(nextId);
      pumpWebDownloadQueue();
    });
  }
}

function enqueueWebDownload(taskId: string) {
  const runner = webRunners.get(taskId);
  if (!runner || runner.cancelled || runner.paused) return;
  if (activeWebTaskIds.has(taskId)) return;
  if (activeWebTaskIds.size < MAX_CONCURRENT_WEB_DOWNLOADS) {
    removeFromWebQueue(taskId);
    activeWebTaskIds.add(taskId);
    runWebDownload(taskId, runner.usingFallback).finally(() => {
      activeWebTaskIds.delete(taskId);
      pumpWebDownloadQueue();
    });
  } else {
    if (!queuedWebTaskIds.includes(taskId)) {
      queuedWebTaskIds.push(taskId);
    }
    updateActiveTask(taskId, {
      status: 'downloading',
      speed: 'Queued...',
      eta: 'Waiting slot...',
    });
  }
}

async function flushRunnerPendingToDb(taskId: string, runner: WebRunner): Promise<void> {
  if (runner.pendingBytes <= 0 || runner.pendingParts.length === 0) return;
  const blob = new Blob(runner.pendingParts as unknown as BlobPart[], {
    type: runner.mimeType || 'video/mp4',
  });
  runner.pendingParts = [];
  runner.pendingBytes = 0;
  if (blob.size > 0) {
    const idx = runner.chunkIndex;
    runner.chunkIndex += 1;
    await saveOfflineVideoChunk(taskId, idx, blob);
  }
}

async function resetRunnerStorage(taskId: string, runner: WebRunner): Promise<void> {
  runner.pendingParts = [];
  runner.pendingBytes = 0;
  runner.chunkIndex = 0;
  runner.receivedBytes = 0;
  runner.supportsRange = null;
  await clearOfflineVideoChunks(taskId);
}

async function fetchDownloadStreamInfo(
  infoUrl: string
): Promise<{
  fileSize: number;
  height: number;
  recommendedMode: 'direct' | 'remux' | 'transcode';
  qualityEstimates: QualitySizeEstimate[];
} | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const infoRes = await fetch(infoUrl, { cache: 'no-store', signal: ctrl.signal }).finally(() =>
      clearTimeout(timer)
    );
    if (!infoRes.ok) return null;
    const info = await infoRes.json();
    return {
      fileSize: Number(info?.fileSize) || 0,
      height: Number(info?.height) || 0,
      recommendedMode:
        info?.recommendedMode === 'remux' || info?.recommendedMode === 'transcode'
          ? info.recommendedMode
          : 'direct',
      qualityEstimates: Array.isArray(info?.qualityEstimates) ? info.qualityEstimates : [],
    };
  } catch {
    return null;
  }
}

async function resolveDownloadUrls(
  rawUrl: string,
  estimatedSizeMb: number,
  qualityTier?: VideoQualityTier | 'original'
): Promise<{
  primaryUrl: string;
  fallbackUrl: string;
  estimatedTotalBytes: number;
}> {
  const trimmed = String(rawUrl || '').trim();
  const isTelegram = /t\.me|telegram\.me/i.test(trimmed);
  const estBytes = Math.max(0, Math.round(estimatedSizeMb * 1024 * 1024));
  const isNative = Capacitor.isNativePlatform();

  let localBase = '';
  let remoteBase = '';
  if (isNative) {
    if (isTelegram) {
      const localUrl = await ensureAndroidStreamBridge().catch(() => '');
      localBase = localUrl || getNativeLocalBridgeUrl();
    }
    await probeWorkingBackendUrl().catch(() => null);
    remoteBase = getRemoteTranscodeBackendUrl();
  }

  const infoUrl = isNative
    ? (remoteBase || localBase ? `${remoteBase || localBase}/api/telegram/stream-info?url=${encodeURIComponent(trimmed)}` : '')
    : buildApiUrl(`/api/telegram/stream-info?url=${encodeURIComponent(trimmed)}`);
  const info = infoUrl ? await fetchDownloadStreamInfo(infoUrl) : null;

  const probedHeight = info?.height || 0;
  const probedFileSize = info?.fileSize || 0;
  const recommendedMode = info?.recommendedMode || 'direct';

  const wantsDownscale =
    qualityTier === '480p' ||
    qualityTier === '360p' ||
    (qualityTier === '720p' && (probedHeight <= 0 || probedHeight > 780));

  let resolvedBytes = estBytes;
  if (info?.qualityEstimates && qualityTier && qualityTier !== 'original') {
    const matched = info.qualityEstimates.find((q) => q.tier === qualityTier);
    if (matched && matched.sizeBytes > 0) {
      resolvedBytes = matched.sizeBytes;
    }
  }
  if (resolvedBytes <= 0 || (!wantsDownscale && probedFileSize > 0)) {
    resolvedBytes = probedFileSize > 0 ? probedFileSize : estBytes;
  }

  const hasTranscodeBackend = !isNative || Boolean(remoteBase);
  const makeTranscodeUrl = (pathAndQuery: string) =>
    isNative ? `${remoteBase}${pathAndQuery}` : buildApiUrl(pathAndQuery);

  if (!isTelegram) {
    const proxyUrl = buildApiUrl(
      `/api/download/file?url=${encodeURIComponent(trimmed)}&filename=video.mp4`
    );
    if (wantsDownscale && hasTranscodeBackend) {
      return {
        primaryUrl: makeTranscodeUrl(
          `/api/stream?url=${encodeURIComponent(trimmed)}&ext=.mp4&quality=${qualityTier}&transcode=1&download=1`
        ),
        fallbackUrl: trimmed,
        estimatedTotalBytes: resolvedBytes,
      };
    }
    return {
      primaryUrl: trimmed,
      fallbackUrl: proxyUrl,
      estimatedTotalBytes: resolvedBytes,
    };
  }

  if (wantsDownscale && hasTranscodeBackend) {
    const localStreamUrl = localBase
      ? `${localBase}/api/stream?url=${encodeURIComponent(trimmed)}&ext=.mp4`
      : '';
    const remoteRawUrl = remoteBase
      ? `${remoteBase}/api/stream?url=${encodeURIComponent(trimmed)}&raw=1`
      : '';

    return {
      primaryUrl: makeTranscodeUrl(
        `/api/stream?url=${encodeURIComponent(trimmed)}&ext=.mp4&quality=${qualityTier}&transcode=1&download=1`
      ),
      fallbackUrl: localStreamUrl || remoteRawUrl || buildApiUrl(`/api/stream?url=${encodeURIComponent(trimmed)}&raw=1`),
      estimatedTotalBytes: resolvedBytes,
    };
  }

  if (isNative) {
    const localStreamUrl = localBase
      ? `${localBase}/api/stream?url=${encodeURIComponent(trimmed)}&ext=.mp4`
      : '';
    const remoteStreamUrl = remoteBase
      ? `${remoteBase}/api/stream?url=${encodeURIComponent(trimmed)}&raw=1`
      : '';

    return {
      primaryUrl: localStreamUrl || remoteStreamUrl || buildApiUrl(`/api/stream?url=${encodeURIComponent(trimmed)}&raw=1`),
      fallbackUrl: remoteStreamUrl || localStreamUrl || '',
      estimatedTotalBytes: resolvedBytes,
    };
  }

  const streamUrl =
    recommendedMode === 'direct'
      ? buildApiUrl(`/api/stream?url=${encodeURIComponent(trimmed)}&raw=1`)
      : buildApiUrl(`/api/stream?url=${encodeURIComponent(trimmed)}&ext=.mp4&download=1`);

  return {
    primaryUrl: streamUrl,
    fallbackUrl: buildApiUrl(`/api/stream?url=${encodeURIComponent(trimmed)}&raw=1`),
    estimatedTotalBytes: resolvedBytes,
  };
}

function failWebDownload(taskId: string, meta: PendingTaskMeta, message: string) {
  updateActiveTask(taskId, {
    status: 'error',
    speed: '0 KB/s',
    eta: 'Failed',
    errorMessage: message,
  });
  setGlobalNotification(`Download failed: ${meta.baseTitle}`);
  pushBrowserSystemNotification(taskId, 'Download Failed', meta.baseTitle, true);
}

async function consumeResponseIntoRunner(
  taskId: string,
  meta: PendingTaskMeta,
  runner: WebRunner,
  response: Response,
  speedState: { startMs: number; bytes: number; lastUiMs: number; bps: number }
): Promise<'ok' | 'paused' | 'cancelled'> {
  if (!response.body) {
    const blob = await response.blob();
    if (runner.cancelled) return 'cancelled';
    if (runner.paused) return 'paused';
    if (blob.size > 0) {
      const idx = runner.chunkIndex;
      runner.chunkIndex += 1;
      await saveOfflineVideoChunk(taskId, idx, blob);
      runner.receivedBytes += blob.size;
    }
    return 'ok';
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      if (runner.cancelled) {
        try {
          await reader.cancel();
        } catch {}
        return 'cancelled';
      }
      if (runner.paused) {
        try {
          await reader.cancel();
        } catch {}
        await flushRunnerPendingToDb(taskId, runner);
        return 'paused';
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        runner.pendingParts.push(value);
        runner.pendingBytes += value.byteLength;
        runner.receivedBytes += value.byteLength;
        speedState.bytes += value.byteLength;

        if (runner.pendingBytes >= RANGE_CHUNK_BYTES) {
          await flushRunnerPendingToDb(taskId, runner);
        }

        const now = Date.now();
        const elapsedMs = now - speedState.startMs;
        if (elapsedMs >= 500) {
          speedState.bps = (speedState.bytes * 1000) / elapsedMs;
          speedState.startMs = now;
          speedState.bytes = 0;
        }

        if (now - speedState.lastUiMs >= 250) {
          speedState.lastUiMs = now;
          const totalForPct = Math.max(runner.totalBytes, runner.receivedBytes);
          const pct =
            runner.totalBytes > 0
              ? Math.min(99, Math.max(1, Math.round((runner.receivedBytes / runner.totalBytes) * 100)))
              : Math.min(95, Math.max(2, Math.round(runner.receivedBytes / (8 * 1024 * 1024))));
          const speedLabel = formatSpeed(speedState.bps);
          const etaLabel =
            runner.totalBytes > 0
              ? formatEta(Math.max(0, runner.totalBytes - runner.receivedBytes), speedState.bps)
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
  } finally {
    try {
      reader.releaseLock();
    } catch {}
  }

  if (runner.cancelled) return 'cancelled';
  if (runner.paused) {
    await flushRunnerPendingToDb(taskId, runner);
    return 'paused';
  }
  return 'ok';
}

async function fetchWithRangeSlice(
  url: string,
  startByte: number,
  endByte: number | null,
  runner: WebRunner
): Promise<Response> {
  const controller = new AbortController();
  runner.controller = controller;
  const headers: Record<string, string> = {};
  if (endByte !== null && endByte >= startByte) {
    headers['Range'] = `bytes=${startByte}-${endByte}`;
  } else {
    headers['Range'] = `bytes=${startByte}-${startByte + RANGE_CHUNK_BYTES - 1}`;
  }
  return fetch(url, {
    method: 'GET',
    headers,
    signal: controller.signal,
  });
}

async function runWebDownload(taskId: string, useFallback = false) {
  const meta = pendingTaskMetaMap.get(taskId);
  const runner = webRunners.get(taskId);
  if (!meta || !runner || runner.cancelled || runner.paused) return;

  await requestPersistentOfflineStorage().catch(() => {});

  runner.usingFallback = useFallback;
  const targetUrl =
    useFallback && meta.fallbackFetchUrl ? meta.fallbackFetchUrl : meta.primaryFetchUrl;

  const canSwitchToFallback =
    !useFallback && Boolean(meta.fallbackFetchUrl && meta.fallbackFetchUrl !== targetUrl);

  const switchToFallbackOrFail = async (reason: string) => {
    if (runner.cancelled || runner.paused) return;
    if (canSwitchToFallback) {
      await resetRunnerStorage(taskId, runner);
      updateActiveTask(taskId, {
        progress: 0,
        receivedBytes: 0,
        speed: 'Switching source...',
        eta: 'Starting...',
      });
      return runWebDownload(taskId, true);
    }
    failWebDownload(taskId, meta, reason);
  };

  const speedState = {
    startMs: Date.now(),
    bytes: 0,
    lastUiMs: 0,
    bps: 0,
  };

  let initialRes: Response | null = null;
  let lastAttemptErr = '';

  // Attempt initial / resume request with transient retry support
  for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt++) {
    if (runner.cancelled || runner.paused) return;
    try {
      const startOffset = runner.receivedBytes;
      const endOffset =
        runner.totalBytes > startOffset
          ? Math.min(startOffset + RANGE_CHUNK_BYTES - 1, runner.totalBytes - 1)
          : startOffset + RANGE_CHUNK_BYTES - 1;
      const res = await fetchWithRangeSlice(targetUrl, startOffset, endOffset, runner);
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok) {
        lastAttemptErr = `Server returned HTTP ${res.status}`;
        if (res.status >= 500 && attempt < MAX_CHUNK_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, Math.min(6000, 1000 * attempt)));
          continue;
        }
        initialRes = null;
        break;
      }
      if (ct.includes('text/html') || ct.includes('application/json')) {
        lastAttemptErr = 'Stream link did not return a playable video file.';
        initialRes = null;
        break;
      }
      initialRes = res;
      break;
    } catch (err: any) {
      if (runner.cancelled || runner.paused || err?.name === 'AbortError') return;
      lastAttemptErr = err?.message || 'Network download failed';
      if (attempt < MAX_CHUNK_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, Math.min(6000, 1000 * attempt)));
        continue;
      }
    }
  }

  if (!initialRes) {
    return switchToFallbackOrFail(lastAttemptErr || 'Download connection failed');
  }

  const contentType = initialRes.headers.get('content-type') || '';
  if (contentType) {
    runner.mimeType = contentType.split(';')[0].trim() || 'video/mp4';
  }

  const contentRangeHeader = initialRes.headers.get('content-range');
  const contentLenHeader = initialRes.headers.get('content-length');
  const exactContentLength = contentLenHeader && Number(contentLenHeader) > 0 ? Number(contentLenHeader) : 0;
  let sliceTotalBytes = 0;

  if (initialRes.status === 206 && contentRangeHeader) {
    const match = contentRangeHeader.match(/bytes\s+\d+-\d+\/(\d+)/i);
    if (match && Number(match[1]) > 0) {
      sliceTotalBytes = Number(match[1]);
      runner.totalBytes = sliceTotalBytes;
      runner.supportsRange = true;
    }
  } else {
    runner.supportsRange = false;
    // Server ignored Range and sent 200 full file -> reset partial offsets cleanly
    if (initialRes.status === 200 && (runner.receivedBytes > 0 || runner.chunkIndex > 0)) {
      await resetRunnerStorage(taskId, runner);
    }
    if (exactContentLength > 0) {
      runner.totalBytes = exactContentLength;
    } else if (!runner.totalBytes && meta.estimatedTotalBytes > 0) {
      runner.totalBytes = meta.estimatedTotalBytes;
    }
  }

  try {
    // Consume the initial response (either the first 8MB Range slice, or full 200 stream)
    const firstOutcome = await consumeResponseIntoRunner(taskId, meta, runner, initialRes, speedState);
    if (firstOutcome !== 'ok') return;

    // Guard against premature EOF on non-Range 200 streams (exact Content-Length mismatch or early remux/transcode cutoff)
    if (!runner.supportsRange) {
      if (exactContentLength > 0 && runner.receivedBytes < exactContentLength * 0.98) {
        return switchToFallbackOrFail('Download stream ended before receiving the full file.');
      }
      const isNonTranscodedRemux =
        targetUrl.includes('download=1') && !targetUrl.includes('transcode=1');
      if (
        isNonTranscodedRemux &&
        meta.estimatedTotalBytes > 10 * 1024 * 1024 &&
        runner.receivedBytes < meta.estimatedTotalBytes * 0.85
      ) {
        return switchToFallbackOrFail('Remux stream stopped early before completion.');
      }
      if (
        !exactContentLength &&
        meta.estimatedTotalBytes > 20 * 1024 * 1024 &&
        runner.receivedBytes < meta.estimatedTotalBytes * 0.15
      ) {
        return switchToFallbackOrFail('Video transcode stopped unexpectedly early.');
      }
    }

    // If Range-supported, download remaining 8MB slices sequentially with per-chunk retry
    if (runner.supportsRange && runner.totalBytes > 0) {
      while (runner.receivedBytes < runner.totalBytes) {
        if (runner.cancelled || runner.paused) {
          if (runner.paused) await flushRunnerPendingToDb(taskId, runner);
          return;
        }

        const sliceStart = runner.receivedBytes;
        const sliceEnd = Math.min(sliceStart + RANGE_CHUNK_BYTES - 1, runner.totalBytes - 1);
        let chunkRes: Response | null = null;
        let chunkErr = '';

        for (let attempt = 1; attempt <= MAX_CHUNK_ATTEMPTS; attempt++) {
          if (runner.cancelled || runner.paused) {
            if (runner.paused) await flushRunnerPendingToDb(taskId, runner);
            return;
          }
          try {
            const res = await fetchWithRangeSlice(targetUrl, sliceStart, sliceEnd, runner);
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            if (!res.ok) {
              chunkErr = `Server returned HTTP ${res.status}`;
              if (res.status >= 500 && attempt < MAX_CHUNK_ATTEMPTS) {
                await new Promise((r) => setTimeout(r, Math.min(8000, 1200 * attempt)));
                continue;
              }
              chunkRes = null;
              break;
            }
            if (ct.includes('text/html') || ct.includes('application/json')) {
              chunkErr = 'Stream link returned an invalid response mid-download.';
              chunkRes = null;
              break;
            }
            if (res.status === 200) {
              // Unexpected full 200 instead of 206 -> bail out to fallback or error
              chunkErr = 'Server stopped supporting partial range resume';
              chunkRes = null;
              break;
            }
            chunkRes = res;
            break;
          } catch (err: any) {
            if (runner.cancelled || runner.paused || err?.name === 'AbortError') return;
            chunkErr = err?.message || 'Chunk transfer failed';
            if (attempt < MAX_CHUNK_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, Math.min(8000, 1200 * attempt)));
            }
          }
        }

        if (!chunkRes) {
          return switchToFallbackOrFail(chunkErr || 'Download interrupted');
        }

        // Consume this 8MB slice, retrying the chunk cleanly if stream drops mid-slice
        const beforeSliceBytes = runner.receivedBytes;
        const beforeSlicePartsLen = runner.pendingParts.length;
        const beforeSlicePendingBytes = runner.pendingBytes;
        const beforeSliceChunkIdx = runner.chunkIndex;

        try {
          const outcome = await consumeResponseIntoRunner(taskId, meta, runner, chunkRes, speedState);
          if (outcome !== 'ok') return;
        } catch (readErr: any) {
          if (runner.cancelled || runner.paused || readErr?.name === 'AbortError') return;
          // Revert any buffered unread slice bytes beyond last flushed chunkIndex
          if (runner.chunkIndex === beforeSliceChunkIdx) {
            runner.pendingParts.length = beforeSlicePartsLen;
            runner.pendingBytes = beforeSlicePendingBytes;
            runner.receivedBytes = beforeSliceBytes;
          }
          // Retry this slice cleanly on next loop iteration (Wait 1.5s)
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
      }
    }

    if (runner.cancelled || runner.paused) return;
    await flushRunnerPendingToDb(taskId, runner);
    await finalizeWebDownload(taskId, meta, runner);
  } catch (err: any) {
    if (runner.cancelled || runner.paused || err?.name === 'AbortError') {
      return;
    }
    return switchToFallbackOrFail(err?.message || 'Download stream interrupted');
  }
}

async function finalizeWebDownload(taskId: string, meta: PendingTaskMeta, runner: WebRunner) {
  const totalBytes = runner.receivedBytes;
  if (totalBytes <= 0 || runner.chunkIndex <= 0) {
    await clearOfflineVideoChunks(taskId);
    updateActiveTask(taskId, {
      status: 'error',
      speed: '0 KB/s',
      eta: 'Failed',
      errorMessage: 'Downloaded file was empty.',
    });
    return;
  }

  try {
    await finalizeOfflineChunkedVideo(
      taskId,
      runner.mimeType || 'video/mp4',
      totalBytes,
      runner.chunkIndex
    );
  } catch (err: any) {
    updateActiveTask(taskId, {
      status: 'error',
      speed: '0 KB/s',
      eta: 'Storage Full',
      errorMessage: err?.message || 'Could not save video to offline storage',
    });
    return;
  }

  const sizeLabel = formatBytesLabel(totalBytes);
  updateActiveTask(taskId, {
    progress: 100,
    receivedBytes: totalBytes,
    totalBytes,
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
    sizeBytes: totalBytes,
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
    qualityTier,
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

  // Remove any stale errored active task for this same item before starting fresh
  const staleErrored = storeState.activeDownloads.filter(
    (d) =>
      d.status === 'error' &&
      ((movieId && d.movieId === movieId && d.seasonNumber === seasonNumber && d.episodeNumber === episodeNumber) ||
        d.videoUrl === cleanUrl)
  );
  staleErrored.forEach((d) => cancelActiveDownloadTask(d.id));

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

  const resolved = await resolveDownloadUrls(cleanUrl, estimatedSizeMb, qualityTier);
  if (!storeState.activeDownloads.some((d) => d.id === downloadId)) {
    return downloadId;
  }
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
    pendingParts: [],
    pendingBytes: 0,
    chunkIndex: 0,
    receivedBytes: 0,
    totalBytes: estTotal,
    mimeType: 'video/mp4',
    supportsRange: null,
    usingFallback: false,
    paused: false,
    cancelled: false,
    controller: null,
  });
  enqueueWebDownload(downloadId);
  return downloadId;
}

export async function removeCompletedDownload(id: string): Promise<void> {
  const target = storeState.downloads.find((d) => d.id === id);
  const updated = storeState.downloads.filter((d) => d.id !== id);
  persistDownloads(updated);
  await deleteOfflineVideo(target?.offlineKey || id, target?.localUri);
}

export function cancelActiveDownloadTask(id: string): void {
  removeFromWebQueue(id);
  activeWebTaskIds.delete(id);
  const runner = webRunners.get(id);
  if (runner) {
    runner.cancelled = true;
    try {
      runner.controller?.abort();
    } catch {}
    runner.pendingParts = [];
    runner.pendingBytes = 0;
    webRunners.delete(id);
  }
  clearOfflineVideoChunks(id).catch(() => {});
  if (Capacitor.isNativePlatform()) {
    try {
      (window as any).AndroidPlayerBridge?.cancelOfflineVideoDownload?.(id);
    } catch {}
  }
  pendingTaskMetaMap.delete(id);
  removeActiveTask(id);
  pumpWebDownloadQueue();
}

export function pauseActiveDownloadTask(id: string): void {
  removeFromWebQueue(id);
  activeWebTaskIds.delete(id);
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
  pumpWebDownloadQueue();
}

export function resumeActiveDownloadTask(id: string): void {
  const runner = webRunners.get(id);
  if (runner) {
    runner.paused = false;
    updateActiveTask(id, {
      status: 'downloading',
      errorMessage: undefined,
      speed: 'Resuming...',
      eta: 'Calculating...',
    });
    enqueueWebDownload(id);
    return;
  }
  if (Capacitor.isNativePlatform()) {
    try {
      (window as any).AndroidPlayerBridge?.resumeOfflineVideoDownload?.(id);
      ensureNativeDownloadPolling();
    } catch {}
    updateActiveTask(id, { status: 'downloading', errorMessage: undefined, speed: 'Resuming...', eta: 'Calculating...' });
    return;
  }
  // If retry from error without runner, re-create runner from existing active task cleanly
  const task = storeState.activeDownloads.find((d) => d.id === id);
  const meta = pendingTaskMetaMap.get(id);
  if (task && meta) {
    clearOfflineVideoChunks(id).catch(() => {});
    webRunners.set(id, {
      pendingParts: [],
      pendingBytes: 0,
      chunkIndex: 0,
      receivedBytes: 0,
      totalBytes: meta.estimatedTotalBytes,
      mimeType: 'video/mp4',
      supportsRange: null,
      usingFallback: false,
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
    enqueueWebDownload(id);
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
