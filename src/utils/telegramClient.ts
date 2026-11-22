import fs from 'fs';
import os from 'os';
import path from 'path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { initializeChannelCache } from './channelRegistry.ts';

let client: TelegramClient | null = null;
let connectingPromise: Promise<TelegramClient> | null = null;
let resettingPromise: Promise<TelegramClient> | null = null;
let bypassEnvSession = false;

// Store auto-generated bot session outside workspace root so build snapshots/deployments
// never share the same auth_key across multiple servers or containers.
const SESSION_FILE_PATH = path.join(os.tmpdir(), '.movie_portal_tg_session.txt');

export function isTelegramAuthKeyError(err: any): boolean {
  const msg = String(err?.errorMessage || err?.message || err || '').toUpperCase();
  return (
    msg.includes('AUTH_KEY_DUPLICATED') ||
    msg.includes('AUTH_KEY_UNREGISTERED') ||
    msg.includes('AUTH_KEY_INVALID') ||
    msg.includes('SESSION_REVOKED') ||
    msg.includes('SESSION_EXPIRED')
  );
}

function getSavedSessionString(): string {
  if (!bypassEnvSession) {
    const envSession = (
      process.env.TELEGRAM_SESSION_STRING ||
      process.env.TELEGRAM_SESSION ||
      process.env.SESSION_STRING ||
      ''
    ).trim();
    if (envSession) return envSession;
  }

  try {
    if (fs.existsSync(SESSION_FILE_PATH)) {
      return fs.readFileSync(SESSION_FILE_PATH, 'utf-8').trim();
    }
  } catch (e) {
    console.warn('[TelegramClient] Could not read session file:', e);
  }
  return '';
}

export function getTelegramCredentials() {
  const apiId = Number(process.env.TELEGRAM_API_ID) || 31425129;
  const apiHash = (process.env.TELEGRAM_API_HASH || '').trim() || 'd1069176c0bd22479ffed449cb9b3d2a';
  const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim() || '8993099137:AAH5ppM00ckVZvMek7fv623fbeYty3qgsxM';
  const sessionStr = getSavedSessionString();

  return { apiId, apiHash, botToken, sessionStr };
}

export async function resetTelegramClient(options?: {
  clearSavedSession?: boolean;
  preferBotFallback?: boolean;
}): Promise<TelegramClient> {
  if (resettingPromise) return resettingPromise;

  const { clearSavedSession = true, preferBotFallback = true } = options || {};

  resettingPromise = (async () => {
    const prev = client;
    client = null;
    connectingPromise = null;

    if (prev) {
      try {
        await prev.disconnect();
      } catch {}
    }

    if (clearSavedSession) {
      try {
        if (fs.existsSync(SESSION_FILE_PATH)) {
          fs.unlinkSync(SESSION_FILE_PATH);
        }
      } catch {}
    }

    if (preferBotFallback) {
      const botToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim() || '8993099137:AAH5ppM00ckVZvMek7fv623fbeYty3qgsxM';
      if (botToken) {
        bypassEnvSession = true;
      }
    }

    console.warn('[TelegramClient] Session reset triggered; establishing fresh Telegram session...');
    return await getTelegramClient();
  })().finally(() => {
    resettingPromise = null;
  });

  return resettingPromise;
}

export function isTelegramConnected(): boolean {
  return Boolean(client && client.connected);
}

let serverKeepaliveStarted = false;
function ensureServerKeepalive(activeClient: TelegramClient) {
  if (serverKeepaliveStarted) return;
  serverKeepaliveStarted = true;
  const timer = setInterval(async () => {
    const c = client || activeClient;
    if (!c) return;
    try {
      if (!c.connected) {
        await c.connect().catch(() => {});
        return;
      }
      const bigInt = (await import('big-integer')).default;
      const { Api } = await import('telegram');
      await Promise.race([
        c.invoke(new Api.Ping({ pingId: bigInt(Date.now()) })),
        new Promise((_, rej) => setTimeout(() => rej(new Error('SERVER_PING_TIMEOUT')), 8000)),
      ]);
    } catch {}
  }, 40000);
  (timer as any).unref?.();
}

export async function getTelegramClient(): Promise<TelegramClient> {
  if (client) {
    if (client.connected) {
      ensureServerKeepalive(client);
      return client;
    }
    try {
      await client.connect();
      if (client.connected) {
        ensureServerKeepalive(client);
        return client;
      }
    } catch (e) {
      console.warn('[TelegramClient] Reconnect attempt failed, re-initializing...', e);
      client = null;
    }
  }

  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
    const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
    if (!apiId || !apiHash || (!botToken && !sessionStr)) {
      throw new Error('Telegram credentials incomplete in environment.');
    }

    const stringSession = new StringSession(sessionStr || '');
    const newClient = new TelegramClient(stringSession, apiId, apiHash, {
      connectionRetries: 15,
      autoReconnect: true,
      useWSS: false,
      floodSleepThreshold: 60,
      maxConcurrentDownloads: 20,
    });

    if (sessionStr) {
      await newClient.connect();
      console.log('[TelegramClient] Connected using Telegram Account Session String');
    } else if (botToken) {
      await newClient.start({ botAuthToken: botToken });
      console.log('[TelegramClient] Connected using Telegram Bot Auth Token');

      // Save session to tmpdir for future reuse within this container only
      const savedSession = newClient.session.save() as any;
      if (savedSession && typeof savedSession === 'string' && savedSession.length > 10) {
        try {
          fs.writeFileSync(SESSION_FILE_PATH, savedSession, 'utf-8');
          console.log('[TelegramClient] New session cached in tmpdir');
        } catch (e) {
          console.warn('[TelegramClient] Failed to save session:', e);
        }
      }
    }

    client = newClient;
    ensureServerKeepalive(newClient);

    // Asynchronously warm up channel entity cache
    initializeChannelCache(newClient).catch(err => {
      console.warn('[TelegramClient] Channel cache warmup note:', err?.message || err);
    });

    return newClient;
  })()
    .catch(err => {
      client = null;
      throw err;
    })
    .finally(() => {
      connectingPromise = null;
    });

  return connectingPromise;
}
