import { Capacitor } from '@capacitor/core';

/**
 * Helper to reliably detect whether the app is running as the installed
 * native Android application (Capacitor native shell) vs a normal web browser.
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

    // 3. Optional dev query flag for testing the Android shell in browser preview (?platform=android)
    if (window.location.search && window.location.search.includes('platform=android')) {
      return true;
    }
  } catch (e) {
    return false;
  }

  return false;
};
