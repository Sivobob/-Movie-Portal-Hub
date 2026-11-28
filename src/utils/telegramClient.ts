import fs from 'fs';
import os from 'os';
import path from 'path';
import { TelegramClient, Logger } from 'telegram';
import { LogLevel } from 'telegram/extensions/Logger.js';
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
        (prev as any)._destroyed = true;
        await (typeof (prev as any).destroy === 'function' ? (prev as any).destroy() : prev.disconnect());
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

const TELEGRAM_DC_ENDPOINTS: Array<{ id: number; ip: string; port: number }> = [
  { id: 5, ip: '91.108.56.130', port: 443 },
  { id: 2, ip: '149.154.167.51', port: 443 },
  { id: 1, ip: '149.154.175.53', port: 443 },
  { id: 4, ip: '149.154.167.91', port: 443 },
  { id: 3, ip: '149.154.175.100', port: 443 },
];

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

    let connectedClient: TelegramClient | null = null;

    if (sessionStr) {
      const savedSessionClient = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
        connectionRetries: 10,
        requestRetries: 5,
        retryDelay: 2000,
        autoReconnect: true,
        useWSS: false,
        floodSleepThreshold: 60,
        maxConcurrentDownloads: 20,
        baseLogger: new Logger(LogLevel.ERROR),
      });
      try {
        await savedSessionClient.connect();
        if (savedSessionClient.connected) {
          connectedClient = savedSessionClient;
          console.log('[TelegramClient] Connected using cached Telegram Session');
        } else {
          try {
            (savedSessionClient as any)._destroyed = true;
            await savedSessionClient.destroy();
          } catch {}
        }
      } catch (savedErr: any) {
        console.warn('[TelegramClient] Cached session connect failed, refreshing bot session:', savedErr?.message || savedErr);
        try {
          (savedSessionClient as any)._destroyed = true;
          await savedSessionClient.destroy();
        } catch {}
        try {
          if (fs.existsSync(SESSION_FILE_PATH)) fs.unlinkSync(SESSION_FILE_PATH);
        } catch {}
        if (!botToken) throw savedErr;
      }
    }

    if (!connectedClient && botToken) {
      let lastErr: any = null;
      for (const dc of TELEGRAM_DC_ENDPOINTS) {
        const dcSession = new StringSession('');
        dcSession.setDC(dc.id, dc.ip, dc.port);
        const attemptClient = new TelegramClient(dcSession, apiId, apiHash, {
          connectionRetries: 6,
          requestRetries: 3,
          retryDelay: 1500,
          autoReconnect: true,
          useWSS: false,
          floodSleepThreshold: 60,
          maxConcurrentDownloads: 20,
          baseLogger: new Logger(LogLevel.ERROR),
        });
        try {
          await attemptClient.start({ botAuthToken: botToken });
          connectedClient = attemptClient;
          console.log(`[TelegramClient] Connected via DC ${dc.id} using Telegram Bot Auth Token`);

          const savedSession = attemptClient.session.save() as any;
          if (savedSession && typeof savedSession === 'string' && savedSession.length > 10) {
            try {
              fs.writeFileSync(SESSION_FILE_PATH, savedSession, 'utf-8');
            } catch {}
          }
          break;
        } catch (dcErr: any) {
          lastErr = dcErr;
          console.warn(`[TelegramClient] DC ${dc.id} bot login fallback (${dcErr?.errorMessage || dcErr?.message || dcErr})`);
          try {
            (attemptClient as any)._destroyed = true;
            await attemptClient.destroy();
          } catch {}
        }
      }
      if (!connectedClient) {
        throw lastErr || new Error('Failed to connect Telegram Bot across all DCs.');
      }
    }

    if (!connectedClient) {
      throw new Error('Failed to establish Telegram client connection.');
    }

    client = connectedClient;
    ensureServerKeepalive(connectedClient);

    // Asynchronously warm up channel entity cache
    initializeChannelCache(connectedClient).catch(err => {
      console.warn('[TelegramClient] Channel cache warmup note:', err?.message || err);
    });

    return connectedClient;
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
