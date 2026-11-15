import {
  doc,
  getDocFromServer,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { buildApiUrl } from '../utils/apiConfig';

export const APP_STATS_COLLECTION = 'app_config';
export const APP_STATS_DOC_ID = 'app_stats';

const DOWNLOADED_USER_KEY = 'mp_apk_downloaded_user_v1';
const INSTALLED_DEVICE_KEY = 'mp_native_installed_device_v1';

export interface FirestoreAppStats {
  totalApkClicks: number;
  uniqueDownloadUsers: number;
  installedAppUsers: number;
  inAppUpdateDownloads: number;
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
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const alreadyCounted = localStorage.getItem(INSTALLED_DEVICE_KEY);
    if (alreadyCounted) return;

    localStorage.setItem(INSTALLED_DEVICE_KEY, String(Date.now()));

    await setDoc(
      doc(db, APP_STATS_COLLECTION, APP_STATS_DOC_ID),
      {
        installedAppUsers: increment(1),
        lastInstalledVersion: versionName || 'unknown',
        lastActiveAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${APP_STATS_COLLECTION}/${APP_STATS_DOC_ID}`);
  }
}

export function normalizeFirestoreAppStats(data: any): FirestoreAppStats {
  return {
    totalApkClicks: Math.max(0, Number(data?.totalApkClicks) || 0),
    uniqueDownloadUsers: Math.max(0, Number(data?.uniqueDownloadUsers) || 0),
    installedAppUsers: Math.max(0, Number(data?.installedAppUsers) || 0),
    inAppUpdateDownloads: Math.max(0, Number(data?.inAppUpdateDownloads) || 0),
  };
}

export async function fetchFirestoreAppStats(): Promise<FirestoreAppStats> {
  try {
    const snap = await getDocFromServer(doc(db, APP_STATS_COLLECTION, APP_STATS_DOC_ID));
    if (snap.exists()) {
      return normalizeFirestoreAppStats(snap.data());
    }
  } catch {}
  return normalizeFirestoreAppStats(null);
}

export function subscribeAppDownloadStats(
  onStats: (stats: FirestoreAppStats) => void
): () => void {
  const ref = doc(db, APP_STATS_COLLECTION, APP_STATS_DOC_ID);
  return onSnapshot(
    ref,
    { includeMetadataChanges: false },
    (snap) => {
      onStats(normalizeFirestoreAppStats(snap.exists() ? snap.data() : null));
    },
    (err) => {
      handleFirestoreError(err, OperationType.GET, `${APP_STATS_COLLECTION}/${APP_STATS_DOC_ID}`);
    }
  );
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
