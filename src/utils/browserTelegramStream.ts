import './shims/globals';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import bigInt from 'big-integer';
import { parseTelegramUrl } from './telegramParser';

const TG_API_ID = 31425129;
const TG_API_HASH = 'd1069176c0bd22479ffed449cb9b3d2a';
const TG_BOT_TOKEN = '8993099137:AAH5ppM00ckVZvMek7fv623fbeYty3qgsxM';
const SESSION_STORAGE_KEY = 'tg_browser_bot_session_v1';

// Known private channel access hashes (same registry used by backend)
const KNOWN_ACCESS_HASHES: Record<string, string> = {
  '3850537977': '5272514172729841892',
};

interface CachedBrowserMedia {
  document: Api.Document;
  fileSize: number;
  durationSec: number;
  mimeType: string;
  cachedAt: number;
}

const mediaCache = new Map<string, CachedBrowserMedia>();
const MEDIA_CACHE_TTL_MS = 5 * 60 * 1000;

let browserClient: TelegramClient | null = null;
let connectPromise: Promise<TelegramClient> | null = null;

function getSavedBrowserSession(): string {
  try {
    return (localStorage.getItem(SESSION_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

function saveBrowserSession(sess: string) {
  try {
    if (sess && sess.length > 10) {
      localStorage.setItem(SESSION_STORAGE_KEY, sess);
    }
  } catch {}
}

export async function getBrowserTelegramClient(): Promise<TelegramClient> {
  if (browserClient && browserClient.connected) {
    return browserClient;
  }
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const saved = getSavedBrowserSession();
    const client = new TelegramClient(new StringSession(saved), TG_API_ID, TG_API_HASH, {
      connectionRetries: 8,
      autoReconnect: true,
      useWSS: true,
      floodSleepThreshold: 60,
    });

    if (saved) {
      try {
        await client.connect();
        if (client.connected) {
          browserClient = client;
          return client;
        }
      } catch {
        // Fallback to fresh bot authorization if saved session fails
      }
    }

    const freshClient = new TelegramClient(new StringSession(''), TG_API_ID, TG_API_HASH, {
      connectionRetries: 8,
      autoReconnect: true,
      useWSS: true,
      floodSleepThreshold: 60,
    });
    await freshClient.start({ botAuthToken: TG_BOT_TOKEN });
    const exported = freshClient.session.save() as unknown as string;
    saveBrowserSession(exported);
    browserClient = freshClient;
    return freshClient;
  })()
    .catch((err) => {
      browserClient = null;
      throw err;
    })
    .finally(() => {
      connectPromise = null;
    });

  return connectPromise;
}

async function resolveTelegramDocument(telegramUrl: string): Promise<CachedBrowserMedia> {
  const parsed = parseTelegramUrl(telegramUrl);
  if (!parsed.isValid || parsed.isInviteLink || !parsed.messageId) {
    throw new Error('Invalid Telegram post URL');
  }

  const cacheKey = `${parsed.chatId}:${parsed.messageId}`;
  const existing = mediaCache.get(cacheKey);
  if (existing && Date.now() - existing.cachedAt < MEDIA_CACHE_TTL_MS) {
    return existing;
  }

  const client = await getBrowserTelegramClient();
  const messageId = parseInt(parsed.messageId, 10);
  const cleanId = parsed.rawChannelId ? parsed.rawChannelId.replace('-100', '') : '';

  const candidates: any[] = [];
  if (cleanId && KNOWN_ACCESS_HASHES[cleanId]) {
    candidates.push(
      new Api.InputPeerChannel({
        channelId: bigInt(cleanId),
        accessHash: bigInt(KNOWN_ACCESS_HASHES[cleanId]),
      })
    );
  }
  if (parsed.chatId && parsed.chatId.startsWith('@')) {
    try {
      const ent = await client.getEntity(parsed.chatId);
      if (ent) candidates.push(ent);
    } catch {}
  }
  if (parsed.chatId) candidates.push(parsed.chatId);
  if (cleanId) candidates.push(`-100${cleanId}`);

  let foundMsg: any = null;
  for (const peer of candidates) {
    if (foundMsg) break;
    try {
      const msgs = await client.getMessages(peer, { ids: [messageId] });
      if (msgs && msgs.length > 0 && msgs[0]) {
        foundMsg = msgs[0];
        break;
      }
    } catch {}
  }

  if (!foundMsg || !foundMsg.media) {
    throw new Error(`Telegram message #${messageId} not found`);
  }

  let document: Api.Document | null = null;
  if (foundMsg.media instanceof Api.MessageMediaDocument && foundMsg.media.document instanceof Api.Document) {
    document = foundMsg.media.document;
  } else if (
    foundMsg.media instanceof Api.MessageMediaWebPage &&
    (foundMsg.media as any).webpage?.document instanceof Api.Document
  ) {
    document = (foundMsg.media as any).webpage.document;
  }

  if (!document) {
    throw new Error(`No playable video document in post #${messageId}`);
  }

  const fileSize = Number(document.size);
  let durationSec = 0;
  const videoAttr = document.attributes.find((a) => a instanceof Api.DocumentAttributeVideo);
  if (videoAttr) {
    durationSec = (videoAttr as Api.DocumentAttributeVideo).duration || 0;
  }

  let fileName = '';
  const fnAttr = document.attributes.find(
    (a) => (a as any).className === 'DocumentAttributeFilename' || a instanceof Api.DocumentAttributeFilename
  );
  if (fnAttr && (fnAttr as Api.DocumentAttributeFilename).fileName) {
    fileName = (fnAttr as Api.DocumentAttributeFilename).fileName;
  }

  const rawMime = (document.mimeType || '').toLowerCase();
  const lowerName = fileName.toLowerCase();
  const isWebm = lowerName.endsWith('.webm') || rawMime.includes('webm');
  const mimeType = isWebm ? 'video/webm' : 'video/mp4';

  const entry: CachedBrowserMedia = {
    document,
    fileSize,
    durationSec,
    mimeType,
    cachedAt: Date.now(),
  };
  mediaCache.set(cacheKey, entry);
  return entry;
}

export async function testDownloadChunk(
  telegramUrl: string,
  offset = 0,
  length = 65536
): Promise<{ fileSize: number; durationSec: number; mimeType: string; bytes: Uint8Array }> {
  const entry = await resolveTelegramDocument(telegramUrl);
  const client = await getBrowserTelegramClient();
  const alignedStart = Math.floor(offset / 4096) * 4096;
  let skip = offset - alignedStart;
  const loc = new Api.InputDocumentFileLocation({
    id: entry.document.id,
    accessHash: entry.document.accessHash,
    fileReference: entry.document.fileReference,
    thumbSize: '',
  });

  const collected: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of client.iterDownload({
    file: loc,
    offset: bigInt(alignedStart) as any,
    requestSize: 65536,
  })) {
    let data = new Uint8Array(chunk);
    if (skip > 0) {
      if (data.length <= skip) {
        skip -= data.length;
        continue;
      }
      data = data.slice(skip);
      skip = 0;
    }
    const need = length - total;
    if (data.length > need) data = data.slice(0, need);
    collected.push(data);
    total += data.length;
    if (total >= length) break;
  }

  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of collected) {
    out.set(c, pos);
    pos += c.length;
  }

  return {
    fileSize: entry.fileSize,
    durationSec: entry.durationSec,
    mimeType: entry.mimeType,
    bytes: out,
  };
}

let bridgeInstalled = false;

export function installAndroidStreamBridge(localBaseUrl: string) {
  if (bridgeInstalled || typeof window === 'undefined' || !localBaseUrl) return;
  bridgeInstalled = true;

  const base = localBaseUrl.replace(/\/+$/, '');
  const abortedReqs = new Set<string>();

  const postBridge = async (path: string, body: BodyInit, contentType: string) => {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
      });
      return res.status;
    } catch {
      return 0;
    }
  };

  (window as any).__tgStreamBridge = {
    abort(reqId: string) {
      abortedReqs.add(reqId);
    },

    async resolveMeta(reqId: string, telegramUrl: string) {
      try {
        const meta = await resolveTelegramDocument(telegramUrl);
        await postBridge(
          `/__bridge/meta?id=${encodeURIComponent(reqId)}`,
          JSON.stringify({
            ok: true,
            fileSize: meta.fileSize,
            durationSec: meta.durationSec,
            mimeType: meta.mimeType,
          }),
          'application/json'
        );
      } catch (err: any) {
        await postBridge(
          `/__bridge/meta?id=${encodeURIComponent(reqId)}`,
          JSON.stringify({
            ok: false,
            error: err?.message || 'Failed to resolve Telegram video',
          }),
          'application/json'
        );
      }
    },

    async pumpRange(reqId: string, telegramUrl: string, startByte: number, endByte: number) {
      try {
        let entry = await resolveTelegramDocument(telegramUrl);
        const client = await getBrowserTelegramClient();

        const chunkTotal = Math.max(0, endByte - startByte + 1);
        const alignedStart = Math.floor(startByte / 4096) * 4096;
        let actualSkip = startByte - alignedStart;
        let delivered = 0;

        const runPump = async (doc: Api.Document) => {
          const fileLocation = new Api.InputDocumentFileLocation({
            id: doc.id,
            accessHash: doc.accessHash,
            fileReference: doc.fileReference,
            thumbSize: '',
          });

          const stream = client.iterDownload({
            file: fileLocation,
            offset: bigInt(alignedStart) as any,
            requestSize: 512 * 1024,
          });

          for await (const chunk of stream) {
            if (abortedReqs.has(reqId) || delivered >= chunkTotal) break;

            let data = new Uint8Array(chunk);
            if (actualSkip > 0) {
              if (data.length <= actualSkip) {
                actualSkip -= data.length;
                continue;
              }
              data = data.slice(actualSkip);
              actualSkip = 0;
            }

            const remaining = chunkTotal - delivered;
            if (data.length > remaining) {
              data = data.slice(0, remaining);
            }

            const status = await postBridge(
              `/__bridge/chunk?id=${encodeURIComponent(reqId)}`,
              data,
              'application/octet-stream'
            );
            if (status !== 200) {
              abortedReqs.add(reqId);
              break;
            }
            delivered += data.length;
            if (delivered >= chunkTotal) break;
          }
        };

        try {
          await runPump(entry.document);
        } catch (err: any) {
          if (err?.message?.includes('FILE_REFERENCE') && delivered === 0) {
            const parsed = parseTelegramUrl(telegramUrl);
            mediaCache.delete(`${parsed.chatId}:${parsed.messageId}`);
            entry = await resolveTelegramDocument(telegramUrl);
            actualSkip = startByte - alignedStart;
            await runPump(entry.document);
          } else {
            throw err;
          }
        }

        await postBridge(`/__bridge/end?id=${encodeURIComponent(reqId)}`, '', 'text/plain');
      } catch (err: any) {
        await postBridge(
          `/__bridge/end?id=${encodeURIComponent(reqId)}&error=${encodeURIComponent(err?.message || 'stream_failed')}`,
          '',
          'text/plain'
        );
      } finally {
        abortedReqs.delete(reqId);
      }
    },
  };

  // Pre-warm Telegram WSS connection quietly in background on native app start
  getBrowserTelegramClient().catch(() => {});
}
