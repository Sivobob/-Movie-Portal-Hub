import fs from 'fs';
import path from 'path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { initializeChannelCache } from './channelRegistry.ts';

let client: TelegramClient | null = null;
let connectingPromise: Promise<TelegramClient> | null = null;

const SESSION_FILE_PATH = path.resolve('.telegram_session.txt');

function getSavedSessionString(): string {
  const envSession = (
    process.env.TELEGRAM_SESSION_STRING || 
    process.env.TELEGRAM_SESSION || 
    process.env.SESSION_STRING || 
    ''
  ).trim();
  if (envSession) return envSession;

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

export async function getTelegramClient(): Promise<TelegramClient> {
  if (client) {
    if (client.connected) return client;
    try {
      await client.connect();
      if (client.connected) return client;
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
      
      // Save session for future use to avoid flood waits
      const savedSession = newClient.session.save() as any;
      if (savedSession && typeof savedSession === 'string' && savedSession.length > 10) {
        try {
          fs.writeFileSync(SESSION_FILE_PATH, savedSession, 'utf-8');
          console.log('[TelegramClient] New session saved to .telegram_session.txt');
        } catch (e) {
          console.warn('[TelegramClient] Failed to save session:', e);
        }
      }
    }

    client = newClient;

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
