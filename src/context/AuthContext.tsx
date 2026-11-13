import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { getStoredUser, loginWithEmail as serviceLoginWithEmail, clearUserSession } from '../services/authService';

export const AUTHORIZED_ADMIN_EMAILS = [
  'riteshdahiyajaat00@gmail.com',
  'adityaantil260@gmail.com',
  'amandabasladpuriya@gmail.com',
  'movieboxproapk007711@gmail.com',
  'movieboxproapp0011@gmail.com',
];

export function isAuthorizedAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.toLowerCase().trim();
  return AUTHORIZED_ADMIN_EMAILS.includes(normalized);
}

interface AuthContextType {
  user: any | null;
  loading: boolean;
  isAdmin: boolean;
  customClaimAdmin: boolean;
  firestoreAdminDocExists: boolean;
  lastError: string | null;
  domainError: boolean;
  refreshAdminStatus: () => Promise<void>;
  setDomainError: (val: boolean) => void;
  signInWithEmail: (email: string) => void;
  handleLogout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  isAdmin: false,
  customClaimAdmin: false,
  firestoreAdminDocExists: false,
  lastError: null,
  domainError: false,
  refreshAdminStatus: async () => {},
  setDomainError: () => {},
  signInWithEmail: () => {},
  handleLogout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any | null>(() => getStoredUser());
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean>(() => {
    const stored = getStoredUser();
    return stored ? isAuthorizedAdminEmail(stored.email) : false;
  });
  const [customClaimAdmin, setCustomClaimAdmin] = useState(false);
  const [firestoreAdminDocExists, setFirestoreAdminDocExists] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [domainError, setDomainError] = useState(false);

  const checkUserAdminStatus = async (currentUser: User) => {
    try {
      const emailMatch = isAuthorizedAdminEmail(currentUser.email);
      if (!emailMatch) {
        setIsAdmin(false);
        setCustomClaimAdmin(false);
        setFirestoreAdminDocExists(false);
        setLastError(null);
        return;
      }

      // 1. Check custom claim (force token refresh)
      let claimVal = false;
      try {
        const tokenResult = await currentUser.getIdTokenResult(true);
        claimVal = !!tokenResult.claims.admin;
      } catch (claimErr: any) {
        console.warn('Could not fetch custom claims:', claimErr);
      }
      setCustomClaimAdmin(claimVal);

      // 2. Check Firestore /admins/{uid} doc
      let docExists = false;
      try {
        const adminDoc = await getDoc(doc(db, 'admins', currentUser.uid));
        docExists = adminDoc.exists();
      } catch (fsErr: any) {
        console.warn('Firestore admin doc lookup error:', fsErr);
      }
      setFirestoreAdminDocExists(docExists);

      // Authorized email is verified admin
      setIsAdmin(true);
      setLastError(null);
    } catch (err: any) {
      console.error('checkUserAdminStatus error:', err);
      setLastError(err?.message || 'Admin status verification error');
      setIsAdmin(isAuthorizedAdminEmail(currentUser.email));
    }
  };

  const signInWithEmail = (email: string) => {
    const sessionUser = serviceLoginWithEmail(email);
    setUser(sessionUser);
    setIsAdmin(isAuthorizedAdminEmail(email));
    setLastError(null);
  };

  const handleLogout = async () => {
    clearUserSession();
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('Signout warning:', e);
    }
    setUser(null);
    setIsAdmin(false);
    setCustomClaimAdmin(false);
    setFirestoreAdminDocExists(false);
    setLastError(null);
  };

  const refreshAdminStatus = async () => {
    if (auth.currentUser) {
      await checkUserAdminStatus(auth.currentUser);
    } else if (user) {
      setIsAdmin(isAuthorizedAdminEmail(user.email));
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        await checkUserAdminStatus(currentUser);
      } else {
        const stored = getStoredUser();
        if (stored) {
          setUser(stored);
          setIsAdmin(isAuthorizedAdminEmail(stored.email));
        } else {
          setUser(null);
          setIsAdmin(false);
          setCustomClaimAdmin(false);
          setFirestoreAdminDocExists(false);
          setLastError(null);
        }
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAdmin,
        customClaimAdmin,
        firestoreAdminDocExists,
        lastError,
        domainError,
        refreshAdminStatus,
        setDomainError,
        signInWithEmail,
        handleLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
