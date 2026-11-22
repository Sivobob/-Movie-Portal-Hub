import { Capacitor } from '@capacitor/core';

const DB_NAME = 'movie_portal_offline_db';
const DB_VERSION = 1;
const STORE_VIDEOS = 'videos';

export interface OfflineVideoRecord {
  id: string;
  blob: Blob;
  mimeType: string;
  sizeBytes: number;
  savedAt: number;
}

const objectUrlCache = new Map<string, string>();
let dbPromise: Promise<IDBDatabase> | null = null;

function openOfflineDb(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_VIDEOS)) {
          db.createObjectStore(STORE_VIDEOS, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        dbPromise = null;
        reject(request.error || new Error('Failed to open offline storage'));
      };
    } catch (err) {
      dbPromise = null;
      reject(err);
    }
  });

  return dbPromise;
}

export async function requestPersistentOfflineStorage(): Promise<void> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
      await navigator.storage.persist();
    }
  } catch {}
}

export async function saveOfflineVideoBlob(
  id: string,
  blob: Blob,
  mimeType = 'video/mp4'
): Promise<void> {
  await requestPersistentOfflineStorage();
  const db = await openOfflineDb();
  const record: OfflineVideoRecord = {
    id,
    blob,
    mimeType: mimeType || blob.type || 'video/mp4',
    sizeBytes: blob.size,
    savedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_VIDEOS, 'readwrite');
    const store = tx.objectStore(STORE_VIDEOS);
    store.put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save offline video'));
    tx.onabort = () => reject(tx.error || new Error('Offline video save aborted'));
  });
}

export async function getOfflineVideoRecord(id: string): Promise<OfflineVideoRecord | null> {
  if (!id) return null;
  try {
    const db = await openOfflineDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_VIDEOS, 'readonly');
      const store = tx.objectStore(STORE_VIDEOS);
      const req = store.get(id);
      req.onsuccess = () => resolve((req.result as OfflineVideoRecord) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function checkNativeOfflineFileExists(localUri?: string): boolean {
  if (typeof window === 'undefined' || !Capacitor.isNativePlatform() || !localUri) {
    return false;
  }
  try {
    const bridge = (window as any).AndroidPlayerBridge;
    if (typeof bridge?.offlineFileExists === 'function') {
      return Boolean(bridge.offlineFileExists(localUri));
    }
  } catch {}
  return false;
}

export async function hasOfflineVideo(id: string, localUri?: string): Promise<boolean> {
  if (Capacitor.isNativePlatform() && localUri && checkNativeOfflineFileExists(localUri)) {
    return true;
  }
  const rec = await getOfflineVideoRecord(id);
  return Boolean(rec && rec.blob && rec.blob.size > 0);
}

export async function getOfflineVideoPlayableUrl(
  id: string,
  localUri?: string
): Promise<string | null> {
  if (Capacitor.isNativePlatform() && localUri) {
    if (checkNativeOfflineFileExists(localUri)) {
      return localUri;
    }
  }

  const cached = objectUrlCache.get(id);
  if (cached) {
    return cached;
  }

  const rec = await getOfflineVideoRecord(id);
  if (rec && rec.blob && rec.blob.size > 0) {
    const blobUrl = URL.createObjectURL(rec.blob);
    objectUrlCache.set(id, blobUrl);
    return blobUrl;
  }

  return null;
}

export async function deleteOfflineVideo(id: string, localUri?: string): Promise<void> {
  if (typeof window !== 'undefined' && Capacitor.isNativePlatform()) {
    try {
      const bridge = (window as any).AndroidPlayerBridge;
      bridge?.deleteOfflineVideoFile?.(localUri || id);
    } catch {}
  }

  const cachedUrl = objectUrlCache.get(id);
  if (cachedUrl) {
    try {
      URL.revokeObjectURL(cachedUrl);
    } catch {}
    objectUrlCache.delete(id);
  }

  try {
    const db = await openOfflineDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_VIDEOS, 'readwrite');
      tx.objectStore(STORE_VIDEOS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

export function formatBytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  if (mb >= 1) {
    return `${mb.toFixed(1)} MB`;
  }
  const kb = Math.max(1, Math.round(bytes / 1024));
  return `${kb} KB`;
}
