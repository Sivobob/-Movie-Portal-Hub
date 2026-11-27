import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import { guardedFirestoreWrite, isFirestoreWriteAllowed } from './firestoreQuotaService';
import { buildApiUrl } from '../utils/apiConfig';
import { isNativeAndroid } from '../utils/platform';

const PUSH_SYNC_SIG_KEY = 'mp_webpush_synced_sig_v1';

export interface StoredWebPushSub {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  platform?: string;
  updatedAtMs?: number;
}

function hashEndpointId(endpoint: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < endpoint.length; i++) {
    const c = endpoint.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return `webpush_${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}`;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function uint8ToBase64Url(buf: ArrayBuffer | null | undefined): string {
  if (!buf) return '';
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]);
  }
  return window.btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) {
      return await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<ServiceWorkerRegistration>((resolve) => setTimeout(() => resolve(existing), 3000)),
      ]);
    }
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
  } catch {
    return null;
  }
}

function detectPlatformLabel(): string {
  if (typeof navigator === 'undefined') return 'web';
  const ua = navigator.userAgent || '';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios-pwa';
  if (/android/i.test(ua)) return 'android-web';
  return 'desktop-web';
}

export function isWebPushSupported(): boolean {
  if (typeof window === 'undefined' || isNativeAndroid()) return false;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

let inflightSubscribe: Promise<{
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
}> | null = null;

export async function ensureWebPushSubscribed(
  askPermissionIfDefault = false
): Promise<{
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
}> {
  if (!isWebPushSupported()) {
    return { supported: false, permission: 'unsupported', subscribed: false };
  }

  if (inflightSubscribe && !askPermissionIfDefault) {
    return inflightSubscribe;
  }

  const run = async () => {
    let permission = Notification.permission;
    if (permission === 'default' && askPermissionIfDefault) {
      try {
        permission = await Notification.requestPermission();
      } catch {}
    }

    if (permission !== 'granted') {
      return { supported: true, permission, subscribed: false };
    }

    const reg = await getReadyServiceWorkerRegistration();
    if (!reg || !reg.pushManager) {
      return { supported: true, permission, subscribed: false };
    }

    let publicKey = '';
    try {
      const resp = await fetch(buildApiUrl('/api/push/vapid-public-key'), { cache: 'no-store' });
      if (resp.ok) {
        const data = await resp.json();
        publicKey = String(data?.publicKey || '').trim();
      }
    } catch {}
    if (!publicKey) {
      return { supported: true, permission, subscribed: false };
    }

    const expectedAppServerKey = urlBase64ToUint8Array(publicKey);
    let sub = await reg.pushManager.getSubscription();

    if (sub) {
      const currentKeyStr = uint8ToBase64Url(sub.options?.applicationServerKey as ArrayBuffer | undefined);
      if (currentKeyStr && currentKeyStr !== publicKey) {
        try {
          await sub.unsubscribe();
          sub = null;
        } catch {}
      }
    }

    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: expectedAppServerKey,
        });
      } catch {
        return { supported: true, permission, subscribed: false };
      }
    }

    const json = sub.toJSON();
    const endpoint = String(json?.endpoint || '').trim();
    const p256dh = String(json?.keys?.p256dh || '').trim();
    const auth = String(json?.keys?.auth || '').trim();
    if (!endpoint || !p256dh || !auth) {
      return { supported: true, permission, subscribed: false };
    }

    const payload: StoredWebPushSub = {
      endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: { p256dh, auth },
      platform: detectPlatformLabel(),
      updatedAtMs: Date.now(),
    };

    // Always sync to active backend server cache
    fetch(buildApiUrl('/api/push/subscribe'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: payload }),
    }).catch(() => {});

    // Persist in Firestore app_installs once per endpoint/key signature (zero write spam)
    const sig = `${publicKey}::${endpoint}::${p256dh}`;
    let prevSig = '';
    try {
      prevSig = localStorage.getItem(PUSH_SYNC_SIG_KEY) || '';
    } catch {}

    if (prevSig !== sig && isFirestoreWriteAllowed()) {
      const subId = hashEndpointId(endpoint);
      const res = await guardedFirestoreWrite(() =>
        setDoc(
          doc(db, 'app_installs', subId),
          {
            type: 'web_push',
            endpoint,
            keys: { p256dh, auth },
            platform: payload.platform,
            updatedAtMs: payload.updatedAtMs,
          },
          { merge: true }
        )
      );
      if (res.ok) {
        try {
          localStorage.setItem(PUSH_SYNC_SIG_KEY, sig);
        } catch {}
      }
    }

    return { supported: true, permission, subscribed: true };
  };

  const p = run().finally(() => {
    if (inflightSubscribe === p) inflightSubscribe = null;
  });
  inflightSubscribe = p;
  return p;
}

export async function unsubscribeWebPush(): Promise<void> {
  if (!isWebPushSupported()) return;
  try {
    const reg = await getReadyServiceWorkerRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      fetch(buildApiUrl('/api/push/unsubscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint }),
      }).catch(() => {});
      if (isFirestoreWriteAllowed() && endpoint) {
        await guardedFirestoreWrite(() =>
          deleteDoc(doc(db, 'app_installs', hashEndpointId(endpoint)))
        );
      }
    }
    try {
      localStorage.removeItem(PUSH_SYNC_SIG_KEY);
    } catch {}
  } catch {}
}

export async function broadcastWebPushNotification(payload: {
  id: string;
  movieId: string;
  title: string;
  notificationTitle: string;
  notificationBody: string;
  message: string;
  posterUrl?: string;
  backdropUrl?: string;
  imageUrl?: string;
}): Promise<{ sentCount: number; totalTargets: number }> {
  if (typeof window === 'undefined') {
    return { sentCount: 0, totalTargets: 0 };
  }

  // Ensure current Admin device is subscribed too if notifications are allowed
  ensureWebPushSubscribed(false).catch(() => {});

  const subscriptions: StoredWebPushSub[] = [];
  const docIdByEndpoint = new Map<string, string>();

  try {
    const q = query(collection(db, 'app_installs'), where('type', '==', 'web_push'));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const data: any = d.data();
      if (data?.endpoint && data?.keys?.p256dh && data?.keys?.auth) {
        const sub: StoredWebPushSub = {
          endpoint: String(data.endpoint),
          keys: {
            p256dh: String(data.keys.p256dh),
            auth: String(data.keys.auth),
          },
          platform: data.platform,
          updatedAtMs: data.updatedAtMs,
        };
        subscriptions.push(sub);
        docIdByEndpoint.set(sub.endpoint, d.id);
      }
    });
  } catch (err) {
    console.warn('[WebPush] Failed reading Firestore subscriptions:', err);
  }

  try {
    const resp = await fetch(buildApiUrl('/api/push/broadcast'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload, subscriptions }),
    });
    if (!resp.ok) {
      return { sentCount: 0, totalTargets: subscriptions.length };
    }
    const result = await resp.json();
    const expired: string[] = Array.isArray(result?.expiredEndpoints) ? result.expiredEndpoints : [];
    if (expired.length > 0 && isFirestoreWriteAllowed()) {
      for (const ep of expired) {
        if (!isFirestoreWriteAllowed()) break;
        const docId = docIdByEndpoint.get(ep) || hashEndpointId(ep);
        await guardedFirestoreWrite(() => deleteDoc(doc(db, 'app_installs', docId)));
      }
    }
    return {
      sentCount: Number(result?.sentCount) || 0,
      totalTargets: Number(result?.totalTargets) || subscriptions.length,
    };
  } catch (err) {
    console.warn('[WebPush] Broadcast call error:', err);
    return { sentCount: 0, totalTargets: subscriptions.length };
  }
}
