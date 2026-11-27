import { Capacitor } from '@capacitor/core';
import { recordApkDownloadClick } from '../services/appStatsService';
import { buildApiUrl } from './apiConfig';

/**
 * Detects ALL iPhone / iPad / iPod models & ALL iOS versions (including iOS 13–18+ desktop UA mode).
 */
export const isIOSDevice = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    if (window.location.search && window.location.search.includes('platform=ios')) {
      return true;
    }

    const ua = navigator.userAgent || navigator.vendor || (window as any).opera || '';
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return true;
    }

    // iOS 13+ / iPadOS "Request Desktop Website" reports MacIntel with touch points > 1
    if (navigator.platform === 'MacIntel' && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
};

/**
 * Returns the major iOS version number (e.g. 12, 15, 17, 18) if detectable.
 */
export const getIOSVersionNumber = (): number | null => {
  if (typeof window === 'undefined') return null;
  try {
    const ua = navigator.userAgent || '';
    const match = ua.match(/OS (\d+)[._]/i);
    if (match && match[1]) {
      const ver = parseInt(match[1], 10);
      return Number.isFinite(ver) ? ver : null;
    }
  } catch {}
  return null;
};

/**
 * Returns true if running inside Apple Safari on iPhone/iPad (best browser for .mobileconfig & Add to Home Screen).
 */
export const isIOSSafari = (): boolean => {
  if (!isIOSDevice()) return false;
  try {
    const ua = navigator.userAgent || '';
    const isThirdParty = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|GSA|Instagram|FBAN|FBAV|WhatsApp|Snapchat|Line|MicroMessenger|Twitter/i.test(ua);
    return /Safari/i.test(ua) && !isThirdParty;
  } catch {
    return false;
  }
};

/**
 * Returns true when opened from an iOS third-party or in-app browser (WhatsApp, Instagram, Chrome on iOS, etc.).
 */
export const isIOSThirdPartyOrInApp = (): boolean => {
  return isIOSDevice() && !isIOSSafari();
};

/**
 * Detects whether the app is running as the ALREADY INSTALLED phone application
 * (Capacitor native Android APK or standalone installed PWA / Apple WebClip from home screen).
 * Returns FALSE when opened in regular Chrome, Safari, or mobile browser tabs.
 */
export const isInstalledPhoneApp = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    // 1. Capacitor native shell or Android WebView JS bridge (real APK running on Android device)
    if (
      (window as any).AndroidPlayerBridge ||
      (window as any).AndroidStreamBridge ||
      Capacitor.isNativePlatform()
    ) {
      return true;
    }

    const winCap = (window as any).Capacitor;
    if (winCap && typeof winCap.isNativePlatform === 'function' && winCap.isNativePlatform()) {
      return true;
    }
    if (winCap && winCap.isNativePlatform === true) {
      return true;
    }

    // 2. Installed standalone PWA / Apple WebClip mode (opened from Home Screen icon, not browser)
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
 * Helper to detect mobile device/Android environment for UI layout styles.
 * Never returns true on iPhones / iPads so iOS standalone PWA does not invoke Android bridges.
 */
export const isNativeAndroid = (): boolean => {
  if (typeof window === 'undefined') return false;

  try {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      return true;
    }

    if (isIOSDevice()) {
      return false;
    }

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
  return isNativeAndroid() || isIOSDevice() || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

export const OFFICIAL_APK_DOWNLOAD_URL = "https://github.com/Sivobob/-Movie-Portal-Hub/releases/latest/download/Movie-Portal.apk";

export const downloadOfficialApk = (e?: any) => {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  recordApkDownloadClick('web_promo').catch(() => {});
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

export const getIOSProfileDownloadUrl = (): string => {
  return buildApiUrl('/api/ios-profile');
};

export const downloadIOSProfile = (e?: any) => {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
  recordApkDownloadClick('web_promo').catch(() => {});
  if (typeof window !== 'undefined') {
    const profileUrl = getIOSProfileDownloadUrl();
    window.location.assign(profileUrl);
  }
};
