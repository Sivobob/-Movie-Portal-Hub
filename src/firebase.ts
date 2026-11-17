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

const app = initializeApp(firebaseConfig);

// Initialize Firestore with long-polling transport and safe multi-tab persistence
// to avoid WebChannel [code=unavailable] failures inside iframes, proxies, and WebViews.
const config = firebaseConfig as any;
const databaseId: string | undefined = config.firestoreDatabaseId || undefined;

function createFirestoreInstance(): Firestore {
  const isBrowser = typeof window !== 'undefined';
  const transportSettings = isBrowser
    ? { experimentalForceLongPolling: true, ignoreUndefinedProperties: true }
    : { ignoreUndefinedProperties: true };

  if (isBrowser) {
    try {
      return initializeFirestore(
        app,
        {
          ...transportSettings,
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        },
        databaseId
      );
    } catch {
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
  }

  try {
    return initializeFirestore(app, transportSettings, databaseId);
  } catch {
    return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }
}

export const db: Firestore = createFirestoreInstance();

export const auth = getAuth(app);

// Validate Firestore connectivity on startup
async function testConnection() {
  if (typeof window === 'undefined') return;
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
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
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
