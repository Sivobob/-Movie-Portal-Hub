import { Capacitor } from '@capacitor/core';

/**
 * Helper to reliably detect whether the app is running as the installed
 * native Android application (Capacitor native shell, standalone PWA, or Android device)
 */
export const isNativeAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    // 1. Capacitor native platform detection
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      return true;
    }
    if (Capacitor.isNativePlatform()) {
      return true;
    }

    // 2. Window Capacitor object injection check (native WebView)
    const winCap = (window as any).Capacitor;
    if (winCap && typeof winCap.isNativePlatform === 'function' && winCap.isNativePlatform()) {
      return true;
    }
    if (winCap && winCap.isNativePlatform === true) {
      return true;
    }

    // 3. Installed PWA Standalone Mode (Launched from home screen without browser UI)
    if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) {
      return true;
    }
    if ((window.navigator as any).standalone === true) {
      return true;
    }

    // 4. Query flag for testing/forcing Android shell (?platform=android)
    if (window.location.search && window.location.search.includes('platform=android')) {
      return true;
    }

    // 5. Android user agent on mobile
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
