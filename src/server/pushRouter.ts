import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';
import { Router, Request, Response } from 'express';
import type { PushSubscription } from 'web-push';
import firebaseConfig from '../../firebase-applet-config.json';
import { adminDb } from './firebaseAdmin.ts';

const require = createRequire(import.meta.url);
const webPush = require('web-push') as typeof import('web-push');

interface StoredPushSub {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
  platform?: string;
  updatedAtMs?: number;
}

const SUBS_CACHE_FILE = path.join(os.tmpdir(), '.movie_hub_push_subs.json');
const subscriptionMap = new Map<string, StoredPushSub>();

function loadSubsFromTmp(): void {
  try {
    if (fs.existsSync(SUBS_CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SUBS_CACHE_FILE, 'utf-8'));
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.endpoint === 'string' && item.keys?.p256dh && item.keys?.auth) {
            subscriptionMap.set(item.endpoint, item);
          }
        }
      }
    }
  } catch {}
}

function saveSubsToTmp(): void {
  try {
    fs.writeFileSync(SUBS_CACHE_FILE, JSON.stringify(Array.from(subscriptionMap.values())), 'utf-8');
  } catch {}
}

loadSubsFromTmp();

function getVapidKeys(): { publicKey: string; privateKey: string } {
  const envPub = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const envPriv = (process.env.VAPID_PRIVATE_KEY || '').trim();
  if (envPub && envPriv) {
    return { publicKey: envPub, privateKey: envPriv };
  }

  // Deterministic P-256 ECDH VAPID pair per Firebase project+db so subscriptions
  // remain valid across Cloud Run cold starts and redeploys.
  const projectId = (firebaseConfig as any).projectId || 'movie-portal-hub';
  const dbId = (firebaseConfig as any).firestoreDatabaseId || 'default';
  const customSeed = (process.env.VAPID_KEY_SEED || 'mp-webpush-vapid-v1').trim();
  const seed = crypto
    .createHash('sha256')
    .update(`${projectId}:${dbId}:${customSeed}`)
    .digest();

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(seed);
  return {
    publicKey: ecdh.getPublicKey(null, 'uncompressed').toString('base64url'),
    privateKey: ecdh.getPrivateKey().toString('base64url'),
  };
}

const vapidKeys = getVapidKeys();
webPush.setVapidDetails('mailto:support@moviehub.app', vapidKeys.publicKey, vapidKeys.privateKey);

function normalizeSub(raw: any): StoredPushSub | null {
  const endpoint = String(raw?.endpoint || '').trim();
  const p256dh = String(raw?.keys?.p256dh || '').trim();
  const auth = String(raw?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth) return null;
  if (!/^https:\/\//i.test(endpoint)) return null;
  return {
    endpoint,
    expirationTime: raw?.expirationTime ?? null,
    keys: { p256dh, auth },
    platform: String(raw?.platform || '').trim() || undefined,
    updatedAtMs: Number(raw?.updatedAtMs) || Date.now(),
  };
}

const router = Router();

router.get('/vapid-public-key', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ publicKey: vapidKeys.publicKey });
});

router.post('/subscribe', (req: Request, res: Response) => {
  const sub = normalizeSub(req.body?.subscription || req.body);
  if (!sub) {
    return res.status(400).json({ error: 'Invalid Web Push subscription payload' });
  }
  subscriptionMap.set(sub.endpoint, sub);
  saveSubsToTmp();
  return res.json({ ok: true, cachedCount: subscriptionMap.size });
});

router.post('/unsubscribe', (req: Request, res: Response) => {
  const endpoint = String(req.body?.endpoint || '').trim();
  if (endpoint && subscriptionMap.delete(endpoint)) {
    saveSubsToTmp();
  }
  return res.json({ ok: true });
});

router.post('/broadcast', async (req: Request, res: Response) => {
  const payload = req.body?.payload;
  const incomingSubs: any[] = Array.isArray(req.body?.subscriptions) ? req.body.subscriptions : [];

  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Notification payload is required' });
  }

  const merged = new Map<string, StoredPushSub>();
  for (const [ep, cached] of subscriptionMap.entries()) {
    merged.set(ep, cached);
  }
  for (const raw of incomingSubs) {
    const sub = normalizeSub(raw);
    if (sub) {
      merged.set(sub.endpoint, sub);
      subscriptionMap.set(sub.endpoint, sub);
    }
  }

  try {
    if (adminDb) {
      const snap = await adminDb.collection('app_installs').where('type', '==', 'web_push').get().catch(() => null);
      if (snap) {
        snap.forEach((docSnap) => {
          const data: any = docSnap.data();
          const sub = normalizeSub(data);
          if (sub) {
            merged.set(sub.endpoint, sub);
            subscriptionMap.set(sub.endpoint, sub);
          }
        });
      }
    }
  } catch (dbErr) {
    // Silent fallback to local TMP subscription cache
  }

  saveSubsToTmp();

  const targets = Array.from(merged.values());
  if (targets.length === 0) {
    return res.json({
      ok: true,
      totalTargets: 0,
      sentCount: 0,
      failedCount: 0,
      expiredEndpoints: [],
    });
  }

  const serializedPayload = JSON.stringify({
    id: String(payload.id || `push-${Date.now()}`),
    movieId: String(payload.movieId || ''),
    title: String(payload.title || 'New Release'),
    notificationTitle: String(payload.notificationTitle || ''),
    notificationBody: String(payload.notificationBody || ''),
    message: String(payload.message || ''),
    posterUrl: String(payload.posterUrl || ''),
    backdropUrl: String(payload.backdropUrl || ''),
    imageUrl: String(payload.imageUrl || ''),
  });

  let sentCount = 0;
  let failedCount = 0;
  const expiredEndpoints: string[] = [];

  const BATCH_SIZE = 20;
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((sub) =>
        webPush.sendNotification(sub as PushSubscription, serializedPayload, {
          TTL: 86400,
          urgency: 'high',
        })
      )
    );

    results.forEach((result, idx) => {
      const sub = batch[idx];
      if (result.status === 'fulfilled') {
        sentCount++;
      } else {
        failedCount++;
        const statusCode = Number((result.reason as any)?.statusCode || 0);
        if (statusCode === 404 || statusCode === 410) {
          expiredEndpoints.push(sub.endpoint);
          subscriptionMap.delete(sub.endpoint);
        }
      }
    });
  }

  if (expiredEndpoints.length > 0) {
    saveSubsToTmp();
  }

  console.log(
    `[WebPush] Broadcast complete | targets=${targets.length} sent=${sentCount} failed=${failedCount} expired=${expiredEndpoints.length}`
  );

  return res.json({
    ok: true,
    totalTargets: targets.length,
    sentCount,
    failedCount,
    expiredEndpoints,
  });
});

export default router;
