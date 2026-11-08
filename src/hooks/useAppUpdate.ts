import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';

interface UpdateInfo {
  latestVersion: string;
  latestVersionCode: number;
  apkUrl: string;
  isMandatory: boolean;
  releaseNotes: string;
}

// Baseline version for the current APK
const CURRENT_VERSION_CODE = 1;

export function useAppUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    // Only check for updates on native Android
    if (!Capacitor.isNativePlatform()) return;

    const checkUpdate = async () => {
      try {
        // Fetch version info from the live production URL
        const response = await fetch('https://ais-pre-abcn6s4zzgkysogvx2vu5v-828533060153.asia-northeast1.run.app/version.json');
        if (!response.ok) return;

        const data: UpdateInfo = await response.json();
        if (data.latestVersionCode > CURRENT_VERSION_CODE) {
          setUpdateAvailable(data);
        }
      } catch (error) {
        console.warn('Update check failed:', error);
      }
    };

    checkUpdate();
    
    // Optional: Re-check every 6 hours if the app stays open
    const interval = setInterval(checkUpdate, 6 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return { updateAvailable };
}
