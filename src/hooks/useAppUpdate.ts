import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { buildApiUrl } from '../utils/apiConfig';

interface UpdateInfo {
  latestVersion: string;
  latestVersionCode: number;
  apkUrl: string;
  isMandatory: boolean;
  releaseNotes: string;
}

// Baseline version code for the current installed APK
const CURRENT_VERSION_CODE = 3409;

// Direct raw GitHub fallback which is 100% public, permanent and never blocked by cookie checks
const GITHUB_VERSION_URL = 'https://raw.githubusercontent.com/Sivobob/-Movie-Portal-Hub/main/public/version.json';

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    // Only check for updates on native Android
    if (!Capacitor.isNativePlatform()) return;

    const checkUpdate = async () => {
      // 1. Try public GitHub raw URL first (always accessible without cookies or 302s)
      try {
        const ghRes = await fetch(`${GITHUB_VERSION_URL}?t=${Date.now()}`);
        if (ghRes.ok) {
          const data: UpdateInfo = await ghRes.json();
          if (data && data.latestVersionCode > CURRENT_VERSION_CODE) {
            setUpdateAvailable(data);
            return;
          }
        }
      } catch (e) {
        console.warn('GitHub update check notice:', e);
      }

      // 2. Fallback to backend /version.json
      try {
        const response = await fetch(buildApiUrl('/version.json'));
        if (!response.ok) return;

        const data: UpdateInfo = await response.json();
        if (data && data.latestVersionCode > CURRENT_VERSION_CODE) {
          setUpdateAvailable(data);
        }
      } catch (error) {
        console.warn('Update check failed:', error);
      }
    };

    checkUpdate();
    
    // Check every 30 minutes
    const interval = setInterval(checkUpdate, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { updateAvailable };
}
