import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

export interface AppPreferences {
  notificationsEnabled: boolean;
  preferredLanguage: string;
  watchOption: 'Streaming' | 'Data Saver';
  familyMode: boolean;
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  notificationsEnabled: true,
  preferredLanguage: 'Hindi',
  watchOption: 'Streaming',
  familyMode: false,
};

const PREFS_STORAGE_KEY = 'movie_portal_app_preferences_v1';

export function getAppPreferences(): AppPreferences {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APP_PREFERENCES };
    const parsed = JSON.parse(raw);
    return {
      notificationsEnabled:
        typeof parsed.notificationsEnabled === 'boolean'
          ? parsed.notificationsEnabled
          : DEFAULT_APP_PREFERENCES.notificationsEnabled,
      preferredLanguage: String(parsed.preferredLanguage || DEFAULT_APP_PREFERENCES.preferredLanguage),
      watchOption: parsed.watchOption === 'Data Saver' ? 'Data Saver' : 'Streaming',
      familyMode: Boolean(parsed.familyMode),
    };
  } catch {
    return { ...DEFAULT_APP_PREFERENCES };
  }
}

import {
  isFirestoreWriteAllowed,
  checkAndHandleQuotaError,
} from './firestoreQuotaService';

let isPrefsQuotaExceeded = !isFirestoreWriteAllowed();

export async function saveAppPreferences(
  partial: Partial<AppPreferences>,
  userId?: string | null
): Promise<AppPreferences> {
  const next: AppPreferences = {
    ...getAppPreferences(),
    ...partial,
  };
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {}

  if (userId && userId !== 'guest_user' && !isPrefsQuotaExceeded && isFirestoreWriteAllowed()) {
    try {
      await setDoc(
        doc(db, 'users', userId, 'preferences', 'app'),
        {
          ...next,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e: any) {
      if (checkAndHandleQuotaError(e)) {
        isPrefsQuotaExceeded = true;
      } else {
        console.warn('Failed to sync preferences to Firestore:', e);
      }
    }
  }

  try {
    window.dispatchEvent(new CustomEvent('mp_preferences_updated', { detail: next }));
  } catch {}

  return next;
}

export async function syncAppPreferencesFromFirestore(userId?: string | null): Promise<AppPreferences> {
  const local = getAppPreferences();
  if (!userId || userId === 'guest_user') return local;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'preferences', 'app'));
    if (snap.exists()) {
      const data = snap.data();
      const merged: AppPreferences = {
        notificationsEnabled:
          typeof data.notificationsEnabled === 'boolean'
            ? data.notificationsEnabled
            : local.notificationsEnabled,
        preferredLanguage: String(data.preferredLanguage || local.preferredLanguage),
        watchOption: data.watchOption === 'Data Saver' ? 'Data Saver' : 'Streaming',
        familyMode: Boolean(data.familyMode),
      };
      try {
        localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(merged));
        window.dispatchEvent(new CustomEvent('mp_preferences_updated', { detail: merged }));
      } catch {}
      return merged;
    }
  } catch {}
  return local;
}

export function isMatureContent(movie: any): boolean {
  if (!movie) return false;
  const haystack = `${movie.genre || ''} ${movie.displayCategory || ''} ${movie.originalCategory || ''} ${movie.maturityRating || ''}`.toLowerCase();
  return /\badult\b|\b18\+\b|\bmidnight\b|\berotic\b|\bnc-17\b/.test(haystack);
}
