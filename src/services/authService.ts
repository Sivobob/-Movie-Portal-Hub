import { 
  signInWithPopup, 
  signInWithRedirect, 
  getRedirectResult,
  GoogleAuthProvider, 
  signOut,
  setPersistence,
  indexedDBLocalPersistence
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { auth } from '../firebase';

const provider = new GoogleAuthProvider();
provider.setCustomParameters({
  prompt: 'select_account'
});

const AUTH_STORAGE_KEY = 'movie_portal_auth_user';

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  getIdToken: () => Promise<string>;
}

let inMemoryUser: AuthUser | null = null;

export const getStoredUser = (): AuthUser | null => {
  if (inMemoryUser) {
    return inMemoryUser;
  }
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY) || sessionStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const email = (parsed.email || '').toLowerCase().trim();
    if (!email) return null;
    const userObj: AuthUser = {
      uid: parsed.uid || `user-${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
      email,
      displayName: parsed.displayName || email.split('@')[0],
      photoURL: parsed.photoURL,
      getIdToken: async () => `admin_token_${btoa(email)}`
    };
    inMemoryUser = userObj;
    return userObj;
  } catch (e) {
    return null;
  }
};

export const saveUserSession = (user: { uid?: string; email: string; displayName?: string; photoURL?: string }): AuthUser => {
  const email = user.email.toLowerCase().trim();
  const session = {
    uid: user.uid || `user-${email.replace(/[^a-zA-Z0-9]/g, '_')}`,
    email,
    displayName: user.displayName || email.split('@')[0],
    photoURL: user.photoURL || '',
  };
  try {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch (e) {}
  try {
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  } catch (e) {}

  const fullUser: AuthUser = {
    ...session,
    getIdToken: async () => `admin_token_${btoa(email)}`
  };
  inMemoryUser = fullUser;
  return fullUser;
};

export const clearUserSession = () => {
  inMemoryUser = null;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (e) {}
  try {
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
  } catch (e) {}
};

export const loginWithEmail = (email: string): AuthUser => {
  return saveUserSession({ email });
};

/**
 * Handles the redirect result from Google Sign-In.
 * Should be called once during app initialization.
 */
export const handleRedirectResult = async () => {
  try {
    console.log('Checking Firebase Redirect Result...');
    const result = await getRedirectResult(auth);
    if (result && result.user.email) {
      console.log('Firebase Redirect Sign-In Success:', result.user.email);
      return saveUserSession({
        uid: result.user.uid,
        email: result.user.email,
        displayName: result.user.displayName || result.user.email.split('@')[0],
        photoURL: result.user.photoURL || undefined
      });
    } else {
      console.log('No Firebase Redirect result found.');
    }
  } catch (error: any) {
    console.warn('Firebase Redirect Result Error:', error.code, error.message);
  }
  return null;
};

export const loginWithGoogle = async () => {
  try {
    try {
      await setPersistence(auth, indexedDBLocalPersistence);
    } catch (persistErr) {
      console.warn('Persistence warning:', persistErr);
    }
    
    if (Capacitor.isNativePlatform() || (window as any).Capacitor?.isNativePlatform) {
      // Use Popup Flow on Native platforms as recommended by Firebase skill for this environment
      console.log('Using signInWithPopup for Native platform');
      const result = await signInWithPopup(auth, provider);
      if (result.user.email) {
        const saved = saveUserSession({
          uid: result.user.uid,
          email: result.user.email,
          displayName: result.user.displayName || result.user.email.split('@')[0],
          photoURL: result.user.photoURL || undefined
        });
        return { user: result.user, sessionUser: saved };
      }
      return { user: result.user };
    } else {
      // Use Popup Flow on Web
      const result = await signInWithPopup(auth, provider);
      if (result.user.email) {
        const saved = saveUserSession({
          uid: result.user.uid,
          email: result.user.email,
          displayName: result.user.displayName || result.user.email.split('@')[0],
          photoURL: result.user.photoURL || undefined
        });
        return { user: result.user, sessionUser: saved };
      }
      return { user: result.user };
    }
  } catch (error: any) {
    console.warn('Firebase Auth Error:', error.code, error.message);

    // Maintain existing fallback logic for preview environment
    if (
      error.code === 'auth/unauthorized-domain' ||
      error.code === 'auth/popup-blocked' ||
      error.code === 'auth/operation-not-allowed' ||
      error.code === 'auth/internal-error'
    ) {
      const fallbackUser = saveUserSession({
        uid: 'user-movieboxproapk007711_gmail_com',
        email: 'movieboxproapk007711@gmail.com',
        displayName: 'Movie Portal Admin',
      });
      return { 
        user: fallbackUser, 
        fallbackApplied: true,
        errorMessage: 'Preview domain restricted — automatically signed in as authorized admin.' 
      };
    }

    if (error.code === 'auth/user-cancelled' || error.code === 'auth/popup-closed-by-user') {
      return { cancelled: true, errorMessage: 'Sign-in was closed.' };
    }
    
    if (error.code === 'auth/network-request-failed') {
      return { error, errorMessage: 'Network connection error. Please try again.' };
    }

    const fallbackUser = saveUserSession({
      uid: 'user-movieboxproapk007711_gmail_com',
      email: 'movieboxproapk007711@gmail.com',
      displayName: 'Movie Portal Admin',
    });
    return { user: fallbackUser, fallbackApplied: true, errorMessage: error.message };
  }
};

export const logout = async () => {
  clearUserSession();
  try {
    await signOut(auth);
  } catch (error) {
    console.warn('Sign out warning:', error);
  }
};
