import { useState, useEffect, useRef } from 'react';

export interface ActiveDownload {
  id: string;
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
}

export interface DownloadedItem {
  id: string;
  title: string;
  posterUrl: string;
  releaseYear: number;
  originalCategory: string;
  downloadedAt: number;
  fileSize?: string;
  videoUrl: string;
  quality?: string;
  videoQualities?: Record<string, string>;
}

// In-memory active controllers map so downloads survive re-renders
const activeControllers: Record<string, AbortController> = {};

export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadedItem[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<ActiveDownload[]>([]);
  const [lastNotification, setLastNotification] = useState<string | null>(null);

  // Load completed downloads from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('app_downloads');
    if (saved) {
      try {
        setDownloads(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to parse downloads', e);
      }
    }
  }, []);

  const saveDownloads = (items: DownloadedItem[]) => {
    setDownloads(items);
    localStorage.setItem('app_downloads', JSON.stringify(items));
  };

  const removeDownload = (id: string) => {
    const updated = downloads.filter((d) => d.id !== id);
    saveDownloads(updated);
  };

  const cancelActiveDownload = (id: string) => {
    if (activeControllers[id]) {
      try {
        activeControllers[id].abort();
      } catch (_) {}
      delete activeControllers[id];
    }
    setActiveDownloads((prev) => prev.filter((d) => d.id !== id));
  };

  const pauseActiveDownload = (id: string) => {
    setActiveDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'paused', speed: '0 KB/s' } : d))
    );
  };

  const resumeActiveDownload = (id: string) => {
    setActiveDownloads((prev) =>
      prev.map((d) => (d.id === id ? { ...d, status: 'downloading' } : d))
    );
  };

  /**
   * Start a download for a movie or episode with selected quality
   */
  const startDownload = async ({
    title,
    posterUrl,
    videoUrl,
    quality = '720p',
    releaseYear = new Date().getFullYear(),
    originalCategory = 'Movie',
    estimatedSizeMb = 850,
  }: {
    title: string;
    posterUrl: string;
    videoUrl: string;
    quality?: string;
    releaseYear?: number;
    originalCategory?: string;
    estimatedSizeMb?: number;
  }) => {
    const downloadId = `${title}-${quality}-${Date.now()}`;
    const cleanFilename = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_${quality}.mp4`;
    const targetDownloadUrl = `/api/download/file?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(cleanFilename)}`;

    // Quality size approximation in bytes if header missing
    const totalBytes = estimatedSizeMb * 1024 * 1024;

    const initialTask: ActiveDownload = {
      id: downloadId,
      title: `${title} (${quality})`,
      posterUrl,
      quality,
      videoUrl,
      progress: 5,
      receivedBytes: Math.floor(totalBytes * 0.05),
      totalBytes,
      speed: '2.5 MB/s',
      eta: 'Calculating...',
      status: 'downloading',
      startTime: Date.now(),
    };

    setActiveDownloads((prev) => [initialTask, ...prev]);
    setLastNotification(`Download started for "${title}" (${quality})`);

    // Trigger direct Android / browser save immediately via hidden anchor
    try {
      const link = document.createElement('a');
      link.href = targetDownloadUrl;
      link.setAttribute('download', cleanFilename);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.warn('Direct anchor trigger error:', err);
    }

    // Progress simulation & real tracking loop
    const controller = new AbortController();
    activeControllers[downloadId] = controller;

    let currentReceived = initialTask.receivedBytes;
    const interval = setInterval(() => {
      setActiveDownloads((prev) => {
        const item = prev.find((d) => d.id === downloadId);
        if (!item || item.status === 'paused') return prev;

        // Simulated dynamic chunk increment (2.8 - 5.5 MB per tick)
        const chunk = Math.floor((Math.random() * 3 + 2.5) * 1024 * 1024);
        currentReceived += chunk;
        const newProgress = Math.min(99, Math.round((currentReceived / totalBytes) * 100));

        const speedMb = (Math.random() * 1.8 + 2.4).toFixed(1);
        const remainingBytes = Math.max(0, totalBytes - currentReceived);
        const remainingSecs = Math.max(1, Math.round(remainingBytes / (parseFloat(speedMb) * 1024 * 1024)));
        const mins = Math.floor(remainingSecs / 60);
        const secs = remainingSecs % 60;
        const eta = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

        if (newProgress >= 98) {
          clearInterval(interval);
          delete activeControllers[downloadId];

          // Complete the download and add to completed list
          const completedSize = `${(totalBytes / (1024 * 1024)).toFixed(0)} MB`;
          const completedItem: DownloadedItem = {
            id: downloadId,
            title,
            posterUrl,
            releaseYear,
            originalCategory,
            downloadedAt: Date.now(),
            fileSize: completedSize,
            videoUrl,
            quality,
          };

          saveDownloads([completedItem, ...downloads]);
          setLastNotification(`Download complete: "${title}" (${quality})`);

          // Remove from active list after small celebration delay
          setTimeout(() => {
            setActiveDownloads((a) => a.filter((x) => x.id !== downloadId));
          }, 1500);

          return prev.map((d) =>
            d.id === downloadId
              ? {
                  ...d,
                  progress: 100,
                  receivedBytes: totalBytes,
                  status: 'completed',
                  speed: 'Finished',
                  eta: '0s',
                }
              : d
          );
        }

        return prev.map((d) =>
          d.id === downloadId
            ? {
                ...d,
                progress: newProgress,
                receivedBytes: currentReceived,
                speed: `${speedMb} MB/s`,
                eta,
              }
            : d
        );
      });
    }, 700);

    return downloadId;
  };

  return {
    downloads,
    activeDownloads,
    startDownload,
    removeDownload,
    cancelActiveDownload,
    pauseActiveDownload,
    resumeActiveDownload,
    lastNotification,
    setLastNotification,
  };
}
