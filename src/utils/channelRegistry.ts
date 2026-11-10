import fs from 'fs';
import path from 'path';
import { Api, TelegramClient } from 'telegram';
import bigInt from 'big-integer';
import { ParsedTelegramLink } from './telegramParser.ts';

export interface CachedChannelInfo {
  channelId: string;
  accessHash: string;
  title?: string;
  username?: string;
  updatedAt: number;
}

const CACHE_FILE = path.resolve('.channel_entities.json');
let inMemoryCache: Record<string, CachedChannelInfo> = {};

function loadCacheFromDisk(): Record<string, CachedChannelInfo> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        inMemoryCache = parsed;
        return inMemoryCache;
      }
    }
  } catch (err: any) {
    console.warn('[ChannelRegistry] Error loading cache from disk:', err?.message || err);
  }
  return inMemoryCache;
}

export function saveChannelEntity(
  channelId: string | number,
  accessHash: string | number | bigint,
  title?: string,
  username?: string
): CachedChannelInfo {
  const cleanId = channelId.toString().replace('-100', '');
  const entry: CachedChannelInfo = {
    channelId: cleanId,
    accessHash: accessHash.toString(),
    title: title || `Channel ${cleanId}`,
    username: username || '',
    updatedAt: Date.now(),
  };

  inMemoryCache[cleanId] = entry;
  inMemoryCache[`-100${cleanId}`] = entry;

  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(inMemoryCache, null, 2), 'utf-8');
    console.log(`[ChannelRegistry] Saved entity for channel: ${cleanId} (hash: ${entry.accessHash.substring(0, 5)}...)`);
  } catch (err: any) {
    console.warn('[ChannelRegistry] Failed writing cache to disk:', err?.message || err);
  }

  return entry;
}

export function getAllCachedChannels(): CachedChannelInfo[] {
  loadCacheFromDisk();
  const seen = new Set<string>();
  const list: CachedChannelInfo[] = [];

  for (const item of Object.values(inMemoryCache)) {
    if (item && item.channelId && !seen.has(item.channelId)) {
      seen.add(item.channelId);
      list.push(item);
    }
  }

  return list;
}

export function getCachedAccessHash(channelId: string): string | null {
  loadCacheFromDisk();
  const cleanId = channelId.replace('-100', '');
  if (inMemoryCache[cleanId]) return inMemoryCache[cleanId].accessHash;
  if (inMemoryCache[`-100${cleanId}`]) return inMemoryCache[`-100${cleanId}`].accessHash;
  return null;
}

/**
 * Initializes and warms up entity cache from Telegram client session
 */
export async function initializeChannelCache(client: TelegramClient): Promise<void> {
  loadCacheFromDisk();

  try {
    const me = await client.getMe();
    console.log(`[ChannelRegistry] Connected session: @${(me as any)?.username || (me as any)?.id} (isBot: ${(me as any)?.bot})`);

    // If session is a user account, load dialogs to cache all member channels automatically
    if (!(me as any)?.bot) {
      try {
        console.log('[ChannelRegistry] User session detected. Syncing dialogs to entity cache...');
        const dialogs = await client.getDialogs({ limit: 100 });
        for (const dialog of dialogs) {
          const entity = dialog.entity;
          if (entity && (entity instanceof Api.Channel || (entity as any).className === 'Channel')) {
            const ch = entity as Api.Channel;
            if (ch.accessHash) {
              saveChannelEntity(ch.id.toString(), ch.accessHash.toString(), ch.title, ch.username);
            }
          }
        }
        console.log(`[ChannelRegistry] Synced ${dialogs.length} dialogs into cache.`);
      } catch (dErr: any) {
        console.warn('[ChannelRegistry] Dialog sync notice:', dErr?.message || dErr);
      }
    }

    // Check environment pre-configured channel
    const envChannel = (process.env.TELEGRAM_PRIVATE_CHANNEL || '').trim();
    if (envChannel) {
      const parts = envChannel.split(',').map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        try {
          if (p.startsWith('http') || p.includes('+') || p.includes('joinchat')) {
            const hashMatch = p.match(/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/);
            if (hashMatch) {
              const res: any = await client.invoke(new Api.messages.CheckChatInvite({ hash: hashMatch[1] }));
              const chat = res?.chat || res?.channel;
              if (chat && chat.accessHash) {
                saveChannelEntity(chat.id.toString(), chat.accessHash.toString(), chat.title, chat.username);
              }
            }
          } else if (p.startsWith('@')) {
            const entity: any = await client.getEntity(p);
            if (entity && entity.accessHash) {
              saveChannelEntity(entity.id.toString(), entity.accessHash.toString(), entity.title, entity.username);
            }
          }
        } catch (e: any) {
          console.warn(`[ChannelRegistry] Env channel ${p} init notice:`, e?.message || e);
        }
      }
    }
  } catch (err: any) {
    console.warn('[ChannelRegistry] Initialization note:', err?.message || err);
  }
}

/**
 * Resolves a Telegram message and its document media using cached access_hash,
 * entity lookup, or direct candidate peers.
 */
export async function resolveTelegramMedia(
  client: TelegramClient,
  parsed: ParsedTelegramLink
): Promise<{ message: any | null; error?: string }> {
  const messageId = parseInt(parsed.messageId);
  const cleanId = parsed.rawChannelId ? parsed.rawChannelId.replace('-100', '') : '';
  const cachedHash = cleanId ? getCachedAccessHash(cleanId) : null;

  const candidatePeers: any[] = [];

  // 1. If we have a cached access_hash for this channel, create an authentic InputPeerChannel
  if (cleanId && cachedHash) {
    try {
      const inputPeer = new Api.InputPeerChannel({
        channelId: bigInt(cleanId),
        accessHash: bigInt(cachedHash),
      });
      candidatePeers.push(inputPeer);

      const inputChannel = new Api.InputChannel({
        channelId: bigInt(cleanId),
        accessHash: bigInt(cachedHash),
      });
      candidatePeers.push(inputChannel);
    } catch (e) {}
  }

  // 2. If it is a public channel with username
  if (parsed.chatId && parsed.chatId.startsWith('@')) {
    try {
      const entity: any = await client.getEntity(parsed.chatId);
      if (entity) {
        if (entity.accessHash) {
          saveChannelEntity(entity.id.toString(), entity.accessHash.toString(), entity.title, entity.username);
        }
        candidatePeers.push(entity);
      }
    } catch (e) {}
  }

  // 3. Add standard peer fallbacks
  if (parsed.chatId) candidatePeers.push(parsed.chatId);
  if (cleanId) {
    candidatePeers.push(bigInt(cleanId));
    candidatePeers.push(`-100${cleanId}`);
    candidatePeers.push(cleanId);
  }

  let foundMsg: any = null;
  let lastError = '';

  console.log(`[ChannelRegistry] Searching for message ${messageId} in ${candidatePeers.length} candidate peers...`);

  for (const peer of candidatePeers) {
    if (foundMsg) break;
    try {
      const peerStr = typeof peer === 'string' ? peer : JSON.stringify(peer);
      console.log(`[ChannelRegistry] Checking peer: ${peerStr.substring(0, 50)}...`);
      const messages = await client.getMessages(peer, { ids: [messageId] });
      if (messages && messages.length > 0 && messages[0]) {
        foundMsg = messages[0];
        console.log(`[ChannelRegistry] ✅ Found message ${messageId} in peer ${peerStr.substring(0, 30)}`);
        break;
      }
    } catch (err: any) {
      lastError = err?.message || '';
      console.warn(`[ChannelRegistry] Peer check failed: ${lastError.substring(0, 100)}`);
    }
  }

  // Fallback: Scan channel's recent messages if ID wasn't directly found
  if (!foundMsg) {
    console.log(`[ChannelRegistry] Message ${messageId} not found directly. Attempting recent scan fallback...`);
    for (const peer of candidatePeers) {
      if (foundMsg) break;
      try {
        const messages = await client.getMessages(peer, { limit: 25 });
        if (messages && messages.length > 0) {
          const exact = messages.find((m: any) => m.id === messageId);
          if (exact) {
            foundMsg = exact;
            console.log(`[ChannelRegistry] ✅ Found message ${messageId} in recent scan of peer`);
            break;
          }
        }
      } catch (err: any) {
        if (!lastError) lastError = err?.message || '';
      }
    }
  }

  if (!foundMsg) {
    console.error(`[ChannelRegistry] ❌ Could not resolve message ${messageId} for streaming.`);
  }

  return { message: foundMsg, error: lastError };
}
