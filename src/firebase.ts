import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  Firestore,
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import {
  hydrateFirestoreQuotaStatus,
  isFirestoreWriteAllowed,
  isQuotaErrorLike,
  markFirestoreQuotaExhausted,
} from './services/firestoreQuotaService';

const app = initializeApp(firebaseConfig);

// Initialize Firestore with long-polling transport and memory-first cache
// to avoid WebChannel failures and prevent stale mutation retry loops when quota is exceeded.
const config = firebaseConfig as any;
const databaseId: string | undefined = config.firestoreDatabaseId || undefined;

// Cleanup any old failed IndexedDB mutation queues from previous sessions
if (typeof window !== 'undefined' && window.indexedDB && !isFirestoreWriteAllowed()) {
  try {
    if (window.indexedDB.databases) {
      window.indexedDB.databases().then((dbs) => {
        dbs.forEach((d) => {
          if (d.name && (d.name.includes('firestore') || d.name.includes('firebase') || d.name.includes('[DEFAULT]'))) {
            try { window.indexedDB.deleteDatabase(d.name); } catch {}
          }
        });
      }).catch(() => {});
    }
  } catch {}
}

function createFirestoreInstance(): Firestore {
  const isBrowser = typeof window !== 'undefined';
  const transportSettings = isBrowser
    ? { experimentalForceLongPolling: true, ignoreUndefinedProperties: true }
    : { ignoreUndefinedProperties: true };

  if (isBrowser) {
    // When quota is exhausted, always use memoryLocalCache so that failed writes are not persisted
    // into IndexedDB to replay repeatedly across page refreshes.
    try {
      return initializeFirestore(
        app,
        {
          ...transportSettings,
          localCache: memoryLocalCache(),
        },
        databaseId
      );
    } catch {
      return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
    }
  }

  try {
    return initializeFirestore(app, transportSettings, databaseId);
  } catch {
    return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }
}

export const db: Firestore = createFirestoreInstance();

export const auth = getAuth(app);

// Validate Firestore connectivity on startup only if write quota is normal
async function testConnection() {
  if (typeof window === 'undefined') return;
  await hydrateFirestoreQuotaStatus().catch(() => true);
  if (!isFirestoreWriteAllowed()) return;
  try {
    await getDocFromServer(doc(db, 'app_config', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore connection check: client is currently offline.');
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(
  error: unknown, 
  operationType: OperationType, 
  path: string | null,
  shouldThrow: boolean = false
) {
  const errMsg = error instanceof Error ? error.message : String(error);
  if (isQuotaErrorLike(error)) {
    markFirestoreQuotaExhausted(error);
    return;
  }

  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.warn('[Firestore Notice]', JSON.stringify(errInfo));
  if (shouldThrow) {
    throw new Error(JSON.stringify(errInfo));
  }
}

