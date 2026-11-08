import { useState, useEffect } from 'react';

export interface DownloadedItem {
  id: string;
  title: string;
  posterUrl: string;
  releaseYear: number;
  originalCategory: string;
  downloadedAt: number;
  fileSize?: string;
  videoUrl: string;
  videoQualities?: Record<string, string>;
}

export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadedItem[]>([]);

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

  const addDownload = (item: DownloadedItem) => {
    setDownloads(prev => {
      const exists = prev.find(d => d.id === item.id);
      if (exists) return prev;
      const updated = [item, ...prev];
      localStorage.setItem('app_downloads', JSON.stringify(updated));
      return updated;
    });
  };

  const removeDownload = (id: string) => {
    setDownloads(prev => {
      const updated = prev.filter(d => d.id !== id);
      localStorage.setItem('app_downloads', JSON.stringify(updated));
      return updated;
    });
  };

  return { downloads, addDownload, removeDownload };
}
