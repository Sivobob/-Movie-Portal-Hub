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
import { guardedFirestoreWrite, isFirestoreWriteAllowed } from './firestoreQuotaService';

export const APP_UPDATE_COLLECTION = 'admins';
export const APP_UPDATE_DOC_ID = 'android_update';

export const CURRENT_VERSION_NAME = '3.5.308';
export const CURRENT_VERSION_CODE = 35308;

export const OFFICIAL_APK_DIRECT_URL =
  'https://github.com/Sivobob/-Movie-Portal-Hub/releases/latest/download/Movie-Portal.apk';

export function resolveApkDownloadUrl(rawUrl?: string | null): string {
  const trimmed = String(rawUrl || '').trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return OFFICIAL_APK_DIRECT_URL;
}

export const DEFAULT_UPDATE_MESSAGE =
  'Movie Hub v3.5.306: High-speed Android downloads and instant channel-to-app live sync without app restart have been fully optimized and verified.';

const GITHUB_VERSION_JSON_URL =
  'https://raw.githubusercontent.com/Sivobob/-Movie-Portal-Hub/main/public/version.json';

export interface RemoteUpdateConfig {
  latestVersion: string;
  minimumRequiredVersion: string;
  latestVersionCode: number;
  minimumRequiredVersionCode?: number;
  isMandatory?: boolean;
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
  const minVersion = String(remote.minimumRequiredVersion || '1.0.0').trim();
  const minCode = Number(remote.minimumRequiredVersionCode || 1);
  const latestVer = String(remote.latestVersion || '').trim();
  const latestCode = Number(remote.latestVersionCode || 0);

  // Explicit kill-switch sentinel when admin sets version to 1.0.0
  if (minVersion === '1.0.0' && minCode <= 1 && (!latestVer || latestVer === '1.0.0')) {
    return false;
  }

  // If installed version is >= latest version, NEVER require update!
  if (latestVer && installed.versionName) {
    if (compareVersions(installed.versionName, latestVer) >= 0) {
      return false;
    }
  }
  if (latestCode > 0 && installed.versionCode > 0) {
    if (installed.versionCode >= latestCode) {
      return false;
    }
  }

  // Check minimum required version
  if (minVersion && minVersion !== '1.0.0' && installed.versionName) {
    if (compareVersions(installed.versionName, minVersion) < 0) return true;
  }
  if (minCode > 1 && installed.versionCode > 0) {
    if (installed.versionCode < minCode) return true;
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
  
  const isMandatory = Boolean(raw?.isMandatory);
  const minimumRequiredVersion = String(
    raw?.minimumRequiredVersion || (isMandatory ? latestVersion : '1.0.0')
  )
    .trim()
    .replace(/^v/i, '');

  const latestVersionCode = Number(raw?.latestVersionCode) || CURRENT_VERSION_CODE;
  const minimumRequiredVersionCode = Number(
    raw?.minimumRequiredVersionCode ?? (isMandatory ? latestVersionCode : 1)
  );

  return {
    latestVersion,
    minimumRequiredVersion,
    latestVersionCode,
    minimumRequiredVersionCode: minimumRequiredVersionCode > 1 ? minimumRequiredVersionCode : undefined,
    isMandatory,
    apkDownloadUrl: resolveApkDownloadUrl(apkDownloadUrl),
    updateMessage: String(raw?.updateMessage || raw?.releaseNotes || DEFAULT_UPDATE_MESSAGE).trim() || DEFAULT_UPDATE_MESSAGE,
    updatedAt: raw?.updatedAt,
  };
}

export function pickHigherRemoteUpdateConfig(
  a: RemoteUpdateConfig | null,
  b: RemoteUpdateConfig | null
): RemoteUpdateConfig | null {
  if (!a) return b;
  if (!b) return a;
  const cmpVersion = compareVersions(
    a.minimumRequiredVersion || a.latestVersion,
    b.minimumRequiredVersion || b.latestVersion
  );
  if (cmpVersion > 0) return a;
  if (cmpVersion < 0) return b;
  const aCode = Number(a.minimumRequiredVersionCode || a.latestVersionCode || 0);
  const bCode = Number(b.minimumRequiredVersionCode || b.latestVersionCode || 0);
  return aCode >= bCode ? a : b;
}

export async function fetchRemoteUpdateConfig(): Promise<RemoteUpdateConfig | null> {
  const ref = doc(db, APP_UPDATE_COLLECTION, APP_UPDATE_DOC_ID);

  const fetchFirestoreConfig = async (): Promise<RemoteUpdateConfig | null> => {
    try {
      const serverSnap = await getDocFromServer(ref);
      if (serverSnap.exists()) {
        return normalizeRemoteUpdateConfig(serverSnap.data());
      }
    } catch {
      try {
        const cachedSnap = await getDoc(ref);
        if (cachedSnap.exists()) {
          return normalizeRemoteUpdateConfig(cachedSnap.data());
        }
      } catch {}
    }
    return null;
  };

  const fetchFirestoreRestConfig = async (): Promise<RemoteUpdateConfig | null> => {
    try {
      const restUrl = `https://firestore.googleapis.com/v1/projects/gen-lang-client-0267042672/databases/ai-studio-movieportalhub-664a3e40-85f3-4758-945e-fd031bdc459f/documents/${APP_UPDATE_COLLECTION}/${APP_UPDATE_DOC_ID}?t=${Date.now()}`;
      const res = await fetch(restUrl, { cache: 'no-store' });
      if (res.ok) {
        const docJson = await res.json();
        const f = docJson?.fields;
        if (f) {
          return normalizeRemoteUpdateConfig({
            latestVersion: f.latestVersion?.stringValue,
            minimumRequiredVersion: f.minimumRequiredVersion?.stringValue,
            latestVersionCode: f.latestVersionCode?.integerValue ? Number(f.latestVersionCode.integerValue) : undefined,
            minimumRequiredVersionCode: f.minimumRequiredVersionCode?.integerValue ? Number(f.minimumRequiredVersionCode.integerValue) : undefined,
            isMandatory: typeof f.isMandatory?.booleanValue === 'boolean' ? f.isMandatory.booleanValue : undefined,
            apkDownloadUrl: f.apkDownloadUrl?.stringValue,
            updateMessage: f.updateMessage?.stringValue,
          });
        }
      }
    } catch {}
    return null;
  };

  const fetchGithubConfig = async (): Promise<RemoteUpdateConfig | null> => {
    try {
      const ghRes = await fetch(`${GITHUB_VERSION_JSON_URL}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (ghRes.ok) {
        const data = await ghRes.json();
        if (data) return normalizeRemoteUpdateConfig(data);
      }
    } catch {}
    return null;
  };

  // Query live Firebase Firestore (SDK + REST) and GitHub version.json, picking the highest version
  const [firestoreConfig, firestoreRestConfig, githubConfig] = await Promise.all([
    fetchFirestoreConfig(),
    fetchFirestoreRestConfig(),
    fetchGithubConfig(),
  ]);

  const bestFirestore = pickHigherRemoteUpdateConfig(firestoreConfig, firestoreRestConfig);
  const bestRemote = pickHigherRemoteUpdateConfig(bestFirestore, githubConfig);
  if (bestRemote) {
    return bestRemote;
  }

  // Fallback to backend /version.json
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
    isMandatory: normalized.isMandatory ?? true,
    apkDownloadUrl: normalized.apkDownloadUrl,
    updateMessage: normalized.updateMessage,
    updatedAt: serverTimestamp(),
  };

  if (isFirestoreWriteAllowed()) {
    const res = await guardedFirestoreWrite(() =>
      setDoc(doc(db, APP_UPDATE_COLLECTION, APP_UPDATE_DOC_ID), payload, { merge: true })
    );
    if (!res.ok && !res.quotaExhausted && res.error) {
      console.warn('Could not sync update config to Firestore (saved locally):', res.error);
    }
  }
  return normalized;
}
