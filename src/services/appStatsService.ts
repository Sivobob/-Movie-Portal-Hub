import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { buildApiUrl } from '../utils/apiConfig';
import { Capacitor } from '@capacitor/core';

export const APP_STATS_COLLECTION = 'app_config';
export const APP_STATS_DOC_ID = 'app_stats';
export const APP_INSTALLS_COLLECTION = 'app_installs';

const DOWNLOADED_USER_KEY = 'mp_apk_downloaded_user_v1';
const DEVICE_UUID_KEY = 'mp_device_uuid_v1';

export interface FirestoreAppStats {
  totalApkClicks: number;
  uniqueDownloadUsers: number;
  installedAppUsers: number;
  inAppUpdateDownloads: number;
  realInstalledDevicesCount: number;
}

export interface GitHubApkStats {
  totalGitHubDownloads: number;
  latestReleaseTag: string;
  latestReleaseDownloads: number;
  releaseCount: number;
}

export async function recordApkDownloadClick(
  source: 'web_promo' | 'in_app_update' | 'direct_link'
): Promise<void> {
  try {
    let isFirstDownloadOnDevice = false;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (!localStorage.getItem(DOWNLOADED_USER_KEY)) {
          isFirstDownloadOnDevice = true;
          localStorage.setItem(DOWNLOADED_USER_KEY, String(Date.now()));
        }
      }
    } catch {}

    const payload: Record<string, any> = {
      totalApkClicks: increment(1),
      lastDownloadAt: serverTimestamp(),
      lastDownloadSource: source,
    };

    if (isFirstDownloadOnDevice) {
      payload.uniqueDownloadUsers = increment(1);
    }
    if (source === 'in_app_update') {
      payload.inAppUpdateDownloads = increment(1);
    }

    await setDoc(doc(db, APP_STATS_COLLECTION, APP_STATS_DOC_ID), payload, {
      merge: true,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${APP_STATS_COLLECTION}/${APP_STATS_DOC_ID}`);
  }
}

export async function recordInstalledApkDevice(versionName?: string): Promise<void> {
  return registerActiveDeviceInstall(versionName);
}

/**
 * Registers or updates the current device in Firestore 'app_installs' collection on app startup,
 * ensuring accurate active device tracking for all installed phone users.
 */
export async function registerActiveDeviceInstall(versionName?: string): Promise<void> {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;

    let deviceId = localStorage.getItem(DEVICE_UUID_KEY);
    if (!deviceId) {
      deviceId = 'dev_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
      localStorage.setItem(DEVICE_UUID_KEY, deviceId);
    }

    const platform = Capacitor.isNativePlatform() ? 'android' : (/android/i.test(navigator.userAgent) ? 'android_web' : 'web');
    const userAgent = navigator.userAgent || '';

    await setDoc(
      doc(db, APP_INSTALLS_COLLECTION, deviceId),
      {
        deviceId,
        platform,
        versionName: versionName || '3.5.213',
        lastActiveAt: serverTimestamp(),
        userAgent,
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    // Also update aggregate counter in app_stats
    await setDoc(
      doc(db, APP_STATS_COLLECTION, APP_STATS_DOC_ID),
      {
        lastInstalledVersion: versionName || '3.5.213',
        lastActiveAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${APP_INSTALLS_COLLECTION}/device`);
  }
}

export function normalizeFirestoreAppStats(data: any, realCount = 0): FirestoreAppStats {
  return {
    totalApkClicks: Math.max(0, Number(data?.totalApkClicks) || 0),
    uniqueDownloadUsers: Math.max(0, Number(data?.uniqueDownloadUsers) || 0),
    installedAppUsers: Math.max(realCount, Number(data?.installedAppUsers) || 0),
    inAppUpdateDownloads: Math.max(0, Number(data?.inAppUpdateDownloads) || 0),
    realInstalledDevicesCount: realCount,
  };
}

export function subscribeAppDownloadStats(
  onStats: (stats: FirestoreAppStats) => void
): () => void {
  const statsRef = doc(db, APP_STATS_COLLECTION, APP_STATS_DOC_ID);
  const installsCol = collection(db, APP_INSTALLS_COLLECTION);

  let latestStatsData: any = null;
  let latestInstallCount = 0;

  const emit = () => {
    onStats(normalizeFirestoreAppStats(latestStatsData, latestInstallCount));
  };

  const unsubStats = onSnapshot(
    statsRef,
    { includeMetadataChanges: false },
    (snap) => {
      latestStatsData = snap.exists() ? snap.data() : null;
      emit();
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, `${APP_STATS_COLLECTION}/${APP_STATS_DOC_ID}`);
    }
  );

  const unsubInstalls = onSnapshot(
    installsCol,
    { includeMetadataChanges: false },
    (snap) => {
      latestInstallCount = snap.size;
      emit();
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, APP_INSTALLS_COLLECTION);
    }
  );

  return () => {
    unsubStats();
    unsubInstalls();
  };
}

export async function fetchGitHubApkDownloadStats(): Promise<GitHubApkStats | null> {
  try {
    const apiRes = await fetch(buildApiUrl('/api/download/stats'), {
      cache: 'no-store',
    });
    if (apiRes.ok) {
      const data = await apiRes.json();
      if (typeof data?.totalGitHubDownloads === 'number') {
        return {
          totalGitHubDownloads: data.totalGitHubDownloads,
          latestReleaseTag: String(data.latestReleaseTag || ''),
          latestReleaseDownloads: Number(data.latestReleaseDownloads || 0),
          releaseCount: Number(data.releaseCount || 0),
        };
      }
    }
  } catch {}

  try {
    const ghRes = await fetch(
      'https://api.github.com/repos/Sivobob/-Movie-Portal-Hub/releases?per_page=100',
      {
        headers: {
          Accept: 'application/vnd.github+json',
        },
        cache: 'no-store',
      }
    );
    if (!ghRes.ok) return null;
    const releases = await ghRes.json();
    if (!Array.isArray(releases)) return null;

    let totalGitHubDownloads = 0;
    let latestReleaseTag = '';
    let latestReleaseDownloads = 0;

    for (const rel of releases) {
      if (rel?.draft) continue;
      let relSum = 0;
      for (const asset of rel?.assets || []) {
        if (typeof asset?.name === 'string' && asset.name.endsWith('.apk')) {
          relSum += Number(asset.download_count || 0);
        }
      }
      if (!latestReleaseTag) {
        latestReleaseTag = String(rel?.tag_name || '');
        latestReleaseDownloads = relSum;
      }
      totalGitHubDownloads += relSum;
    }

    return {
      totalGitHubDownloads,
      latestReleaseTag,
      latestReleaseDownloads,
      releaseCount: releases.length,
    };
  } catch {
    return null;
  }
}
