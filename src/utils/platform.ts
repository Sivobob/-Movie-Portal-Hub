import { Capacitor } from '@capacitor/core';

/**
 * Detects whether the app is running as the ALREADY INSTALLED phone application
 * (Capacitor native Android APK or standalone installed PWA from home screen).
 * Returns FALSE when opened in regular Chrome or mobile browser tabs.
 */
export const isInstalledPhoneApp = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    // 1. Capacitor native shell (real APK running on Android device)
    if (Capacitor.isNativePlatform()) {
      return true;
    }

    const winCap = (window as any).Capacitor;
    if (winCap && typeof winCap.isNativePlatform === 'function' && winCap.isNativePlatform()) {
      return true;
    }
    if (winCap && winCap.isNativePlatform === true) {
      return true;
    }

    // 2. Installed standalone PWA mode (opened from Android home screen icon, not browser)
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      return true;
    }
    if ((window.navigator as any).standalone === true) {
      return true;
    }

    // 3. Query flag for forcing installed testing
    if (window.location.search && (window.location.search.includes('installed=true') || window.location.search.includes('app_shell=true'))) {
      return true;
    }
  } catch (e) {
    return false;
  }

  return false;
};

/**
 * Helper to detect mobile device/Android environment for UI layout styles
 */
export const isNativeAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    if (isInstalledPhoneApp()) return true;

    if (window.location.search && window.location.search.includes('platform=android')) {
      return true;
    }

    const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera || '';
    if (/android/i.test(userAgent) && /mobile/i.test(userAgent)) {
      return true;
    }
  } catch (e) {
    return false;
  }

  return false;
};

/**
 * Check if the device is a touch/mobile device
 */
export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return isNativeAndroid() || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

export const OFFICIAL_APK_DOWNLOAD_URL = "https://github.com/Sivobob/-Movie-Portal-Hub/releases/download/v3.5.114/Movie-Portal.apk";

export const downloadOfficialApk = (e?: any) => {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  if (typeof window !== 'undefined') {
    try {
      const a = document.createElement('a');
      a.href = OFFICIAL_APK_DOWNLOAD_URL;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
      }, 500);
      return;
    } catch (err) {}
    window.location.href = OFFICIAL_APK_DOWNLOAD_URL;
  }
};

