import { Capacitor } from '@capacitor/core';
import {
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { buildApiUrl } from '../utils/apiConfig';

export const APP_UPDATE_COLLECTION = 'admins';
export const APP_UPDATE_DOC_ID = 'android_update';

export const CURRENT_VERSION_NAME = '3.5.194';
export const CURRENT_VERSION_CODE = 3414;

export const OFFICIAL_APK_DIRECT_URL =
  'https://github.com/Sivobob/-Movie-Portal-Hub/releases/latest/download/Movie-Portal.apk';

export const DEFAULT_UPDATE_MESSAGE =
  'A new version of Movie Box is available. Please update the app to continue watching movies and series.';

const GITHUB_VERSION_JSON_URL =
  'https://raw.githubusercontent.com/Sivobob/-Movie-Portal-Hub/main/public/version.json';

export interface RemoteUpdateConfig {
  latestVersion: string;
  minimumRequiredVersion: string;
  latestVersionCode: number;
  minimumRequiredVersionCode?: number;
  apkDownloadUrl: string;
  updateMessage: string;
  updatedAt?: any;
}

export interface InstalledAppVersion {
  versionName: string;
  versionCode: number;
  packageName: string;
  source: 'native_bridge' | 'capacitor_app' | 'bundled_fallback';
}

export const DEFAULT_REMOTE_UPDATE_CONFIG: RemoteUpdateConfig = {
  latestVersion: CURRENT_VERSION_NAME,
  minimumRequiredVersion: CURRENT_VERSION_NAME,
  latestVersionCode: CURRENT_VERSION_CODE,
  minimumRequiredVersionCode: CURRENT_VERSION_CODE,
  apkDownloadUrl: OFFICIAL_APK_DIRECT_URL,
  updateMessage: DEFAULT_UPDATE_MESSAGE,
};

/**
 * Compares two dot-separated version strings (e.g. "3.5.189" vs "3.5.190").
 * Returns: -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareVersions(versionA?: string | null, versionB?: string | null): number {
  const cleanA = String(versionA || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((n) => parseInt(n, 10) || 0);
  const cleanB = String(versionB || '')
    .trim()
    .replace(/^v/i, '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((n) => parseInt(n, 10) || 0);

  if (cleanA.length === 0 && cleanB.length === 0) return 0;
  const maxLen = Math.max(cleanA.length, cleanB.length);
  for (let i = 0; i < maxLen; i++) {
    const a = cleanA[i] ?? 0;
    const b = cleanB[i] ?? 0;
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

/**
 * Reads the real installed APK version from Android PackageManager via native bridge
 * (or Capacitor App plugin) so web cache cannot spoof an updated binary version.
 */
export async function getInstalledAppVersion(): Promise<InstalledAppVersion> {
  if (typeof window !== 'undefined') {
    try {
      const bridge = (window as any).AndroidPlayerBridge;
      if (bridge && typeof bridge.getAppVersionInfo === 'function') {
        const raw = bridge.getAppVersionInfo();
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && (parsed.versionName || parsed.versionCode)) {
          return {
            versionName: String(parsed.versionName || CURRENT_VERSION_NAME).replace(/^v/i, ''),
            versionCode: Number(parsed.versionCode) || CURRENT_VERSION_CODE,
            packageName: String(parsed.packageName || 'com.moviebox.stream.app'),
            source: 'native_bridge',
          };
        }
      }
    } catch (e) {
      console.warn('AndroidPlayerBridge.getAppVersionInfo notice:', e);
    }

    if (Capacitor.isNativePlatform()) {
      try {
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        if (info && (info.version || info.build)) {
          return {
            versionName: String(info.version || CURRENT_VERSION_NAME).replace(/^v/i, ''),
            versionCode: Number(info.build) || CURRENT_VERSION_CODE,
            packageName: String(info.id || 'com.moviebox.stream.app'),
            source: 'capacitor_app',
          };
        }
      } catch (e) {
        console.warn('Capacitor App.getInfo notice:', e);
      }
    }
  }

  return {
    versionName: CURRENT_VERSION_NAME,
    versionCode: CURRENT_VERSION_CODE,
    packageName: 'com.moviebox.stream.app',
    source: 'bundled_fallback',
  };
}

/**
 * Evaluates whether the installed app fails the Firebase minimum required version check.
 */
export function isAppUpdateRequired(
  installed: Pick<InstalledAppVersion, 'versionName' | 'versionCode'>,
  remote: RemoteUpdateConfig | null | undefined
): boolean {
  if (!remote) return false;

  const minVersion = (remote.minimumRequiredVersion || '').trim();
  const minCode = Number(remote.minimumRequiredVersionCode || 0);
  const latestCode = Number(remote.latestVersionCode || 0);

  if (minVersion) {
    const semverCmp = compareVersions(installed.versionName, minVersion);
    if (semverCmp < 0) {
      return true;
    }
    if (semverCmp > 0) {
      return false;
    }
    // Same versionName string: check minimumRequiredVersionCode if provided
    if (minCode > 0 && installed.versionCode > 0 && installed.versionCode < minCode) {
      return true;
    }
    return false;
  }

  if (latestCode > 0 && installed.versionCode > 0 && installed.versionCode < latestCode) {
    return true;
  }

  return false;
}

export function normalizeRemoteUpdateConfig(raw: any): RemoteUpdateConfig {
  const apkDownloadUrl = String(
    raw?.apkDownloadUrl || raw?.apkUrl || OFFICIAL_APK_DIRECT_URL
  ).trim();

  const latestVersion = String(raw?.latestVersion || CURRENT_VERSION_NAME)
    .trim()
    .replace(/^v/i, '');
  const minimumRequiredVersion = String(
    raw?.minimumRequiredVersion || raw?.latestVersion || CURRENT_VERSION_NAME
  )
    .trim()
    .replace(/^v/i, '');

  const latestVersionCode = Number(raw?.latestVersionCode) || CURRENT_VERSION_CODE;
  const minimumRequiredVersionCode = Number(
    raw?.minimumRequiredVersionCode ??
      (compareVersions(minimumRequiredVersion, latestVersion) === 0 ? latestVersionCode : 0)
  );

  return {
    latestVersion,
    minimumRequiredVersion,
    latestVersionCode,
    minimumRequiredVersionCode: minimumRequiredVersionCode > 0 ? minimumRequiredVersionCode : undefined,
    apkDownloadUrl: apkDownloadUrl || OFFICIAL_APK_DIRECT_URL,
    updateMessage: String(raw?.updateMessage || raw?.releaseNotes || DEFAULT_UPDATE_MESSAGE).trim() || DEFAULT_UPDATE_MESSAGE,
    updatedAt: raw?.updatedAt,
  };
}

export async function fetchRemoteUpdateConfig(): Promise<RemoteUpdateConfig | null> {
  const ref = doc(db, APP_UPDATE_COLLECTION, APP_UPDATE_DOC_ID);

  // 1. Always try live Firebase Firestore server first so resume re-checks see latest config
  try {
    const serverSnap = await getDocFromServer(ref);
    if (serverSnap.exists()) {
      return normalizeRemoteUpdateConfig(serverSnap.data());
    }
  } catch (serverErr) {
    try {
      const cachedSnap = await getDoc(ref);
      if (cachedSnap.exists()) {
        return normalizeRemoteUpdateConfig(cachedSnap.data());
      }
    } catch {}
  }

  // 2. Fallback to GitHub public version.json
  try {
    const ghRes = await fetch(`${GITHUB_VERSION_JSON_URL}?t=${Date.now()}`, {
      cache: 'no-store',
    });
    if (ghRes.ok) {
      const data = await ghRes.json();
      if (data) return normalizeRemoteUpdateConfig(data);
    }
  } catch {}

  // 3. Fallback to backend /version.json
  try {
    const res = await fetch(buildApiUrl(`/version.json?t=${Date.now()}`), {
      cache: 'no-store',
    });
    if (res.ok) {
      const data = await res.json();
      if (data) return normalizeRemoteUpdateConfig(data);
    }
  } catch {}

  return null;
}

export function subscribeRemoteUpdateConfig(
  onConfig: (config: RemoteUpdateConfig) => void,
  onError?: (err: any) => void
): () => void {
  const ref = doc(db, APP_UPDATE_COLLECTION, APP_UPDATE_DOC_ID);
  return onSnapshot(
    ref,
    { includeMetadataChanges: false },
    (snap) => {
      if (snap.exists()) {
        onConfig(normalizeRemoteUpdateConfig(snap.data()));
      }
    },
    (err) => {
      if (onError) onError(err);
    }
  );
}

export async function saveRemoteUpdateConfig(
  config: Partial<RemoteUpdateConfig>
): Promise<RemoteUpdateConfig> {
  const normalized = normalizeRemoteUpdateConfig(config);
  const payload = {
    latestVersion: normalized.latestVersion,
    minimumRequiredVersion: normalized.minimumRequiredVersion,
    latestVersionCode: normalized.latestVersionCode,
    minimumRequiredVersionCode: normalized.minimumRequiredVersionCode || normalized.latestVersionCode,
    apkDownloadUrl: normalized.apkDownloadUrl,
    updateMessage: normalized.updateMessage,
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, APP_UPDATE_COLLECTION, APP_UPDATE_DOC_ID), payload, { merge: true });
  return normalized;
}
