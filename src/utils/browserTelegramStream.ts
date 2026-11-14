import './shims/globals';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import bigInt from 'big-integer';
import { parseTelegramUrl } from './telegramParser';

const TG_API_ID = 31425129;
const TG_API_HASH = 'd1069176c0bd22479ffed449cb9b3d2a';
const TG_BOT_TOKEN = '8993099137:AAH5ppM00ckVZvMek7fv623fbeYty3qgsxM';
const SESSION_STORAGE_KEY = 'tg_browser_bot_session_v1';
const CHANNEL_HASH_STORAGE_KEY = 'tg_known_channel_hashes_v1';

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

function getSavedChannelHash(cleanId: string): string | null {
  if (!cleanId) return null;
  if (KNOWN_ACCESS_HASHES[cleanId]) return KNOWN_ACCESS_HASHES[cleanId];
  try {
    const raw = localStorage.getItem(CHANNEL_HASH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed[cleanId] === 'string' && parsed[cleanId] !== '0') {
        return parsed[cleanId];
      }
    }
  } catch {}
  return null;
}

function saveChannelHash(cleanId: string, accessHash: string) {
  if (!cleanId || !accessHash || accessHash === '0') return;
  KNOWN_ACCESS_HASHES[cleanId] = accessHash;
  try {
    const raw = localStorage.getItem(CHANNEL_HASH_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[cleanId] = accessHash;
    localStorage.setItem(CHANNEL_HASH_STORAGE_KEY, JSON.stringify(parsed));
  } catch {}
}

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

function clearSavedBrowserSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {}
}

export async function resetBrowserTelegramClient(): Promise<void> {
  const prev = browserClient;
  browserClient = null;
  connectPromise = null;
  if (prev) {
    try {
      await prev.disconnect();
    } catch {}
  }
}

export async function getBrowserTelegramClient(forceReconnect = false): Promise<TelegramClient> {
  if (!forceReconnect && browserClient && browserClient.connected) {
    return browserClient;
  }
  if (forceReconnect) {
    await resetBrowserTelegramClient();
  }
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const saved = forceReconnect ? '' : getSavedBrowserSession();
    if (saved) {
      try {
        const client = new TelegramClient(new StringSession(saved), TG_API_ID, TG_API_HASH, {
          connectionRetries: 8,
          autoReconnect: true,
          useWSS: true,
          floodSleepThreshold: 60,
          maxConcurrentDownloads: 8,
        });
        await client.connect();
        if (client.connected) {
          browserClient = client;
          return client;
        }
      } catch {
        clearSavedBrowserSession();
      }
    }

    const freshClient = new TelegramClient(new StringSession(''), TG_API_ID, TG_API_HASH, {
      connectionRetries: 8,
      autoReconnect: true,
      useWSS: true,
      floodSleepThreshold: 60,
      maxConcurrentDownloads: 8,
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

function isRecoverableClientError(err: any): boolean {
  const msg = String(err?.message || err?.errorMessage || '').toUpperCase();
  return (
    msg.includes('AUTH_KEY_UNREGISTERED') ||
    msg.includes('SESSION_REVOKED') ||
    msg.includes('WEBSOCKET WAS CLOSED') ||
    msg.includes('CONNECTION') ||
    msg.includes('NOT CONNECTED')
  );
}

async function resolveTelegramDocument(telegramUrl: string, allowRetry = true): Promise<CachedBrowserMedia> {
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
  const cachedHash = getSavedChannelHash(cleanId);

  const candidates: any[] = [];
  if (cleanId && cachedHash) {
    candidates.push(
      new Api.InputPeerChannel({
        channelId: bigInt(cleanId),
        accessHash: bigInt(cachedHash),
      })
    );
    candidates.push(
      new Api.InputChannel({
        channelId: bigInt(cleanId),
        accessHash: bigInt(cachedHash),
      })
    );
  }
  if (parsed.chatId && parsed.chatId.startsWith('@')) {
    try {
      const ent: any = await client.getEntity(parsed.chatId);
      if (ent) {
        if (ent.accessHash && ent.id) {
          saveChannelHash(ent.id.toString().replace('-100', ''), ent.accessHash.toString());
        }
        candidates.push(ent);
      }
    } catch {}
  }
  if (cleanId && !cachedHash) {
    try {
      const ent: any = await client.getEntity(`-100${cleanId}`);
      if (ent && ent.accessHash) {
        saveChannelHash(cleanId, ent.accessHash.toString());
        candidates.unshift(
          new Api.InputPeerChannel({
            channelId: bigInt(cleanId),
            accessHash: bigInt(ent.accessHash.toString()),
          })
        );
      }
    } catch {}
  }
  if (parsed.chatId) candidates.push(parsed.chatId);
  if (cleanId) {
    if (/^\d+$/.test(cleanId)) {
      candidates.push(bigInt(cleanId));
    }
    const prefixed = `-100${cleanId}`;
    if (!candidates.includes(prefixed)) candidates.push(prefixed);
    if (!candidates.includes(cleanId)) candidates.push(cleanId);
  }

  let foundMsg: any = null;
  let lastErr: any = null;
  for (const peer of candidates) {
    if (foundMsg) break;
    try {
      const msgs = await client.getMessages(peer, { ids: [messageId] });
      if (msgs && msgs.length > 0 && msgs[0]) {
        foundMsg = msgs[0];
        break;
      }
    } catch (e: any) {
      lastErr = e;
      if (allowRetry && isRecoverableClientError(e)) {
        clearSavedBrowserSession();
        await resetBrowserTelegramClient();
        return resolveTelegramDocument(telegramUrl, false);
      }
    }
  }

  // Fallback: scan recent messages in channel if direct ID query missed
  if (!foundMsg) {
    for (const peer of candidates) {
      if (foundMsg) break;
      try {
        const recent = await client.getMessages(peer, { limit: 25 });
        const exact = recent?.find((m: any) => m && m.id === messageId);
        if (exact) {
          foundMsg = exact;
          break;
        }
      } catch (e: any) {
        if (!lastErr) lastErr = e;
      }
    }
  }

  if (!foundMsg || !foundMsg.media) {
    throw new Error(lastErr?.message || `Telegram message #${messageId} not found`);
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
  const isMkv = lowerName.endsWith('.mkv') || rawMime.includes('matroska') || rawMime.includes('mkv');
  const isWebm = lowerName.endsWith('.webm') || rawMime.includes('webm');
  const isAvi = lowerName.endsWith('.avi') || rawMime.includes('x-msvideo');
  const mimeType = isMkv
    ? 'video/x-matroska'
    : isWebm
      ? 'video/webm'
      : isAvi
        ? 'video/x-msvideo'
        : 'video/mp4';

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

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK))));
  }
  return btoa(parts.join(''));
}

let bridgeInstalled = false;

export function installAndroidStreamBridge(localBaseUrl: string) {
  if (bridgeInstalled || typeof window === 'undefined' || !localBaseUrl) return;
  bridgeInstalled = true;

  const base = localBaseUrl.replace(/\/+$/, '');
  const abortedReqs = new Set<string>();
  const nativeBridge = () => (window as any).AndroidStreamBridge;

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

  const sendMeta = async (reqId: string, payload: Record<string, any>) => {
    const json = JSON.stringify(payload);
    const nb = nativeBridge();
    if (nb && typeof nb.postMeta === 'function') {
      try {
        nb.postMeta(reqId, json);
        return;
      } catch {}
    }
    await postBridge(`/__bridge/meta?id=${encodeURIComponent(reqId)}`, json, 'application/json');
  };

  const sendEnd = async (reqId: string, error?: string) => {
    const nb = nativeBridge();
    if (nb && typeof nb.postEnd === 'function') {
      try {
        nb.postEnd(reqId, error || '');
        return;
      } catch {}
    }
    const qs = error
      ? `/__bridge/end?id=${encodeURIComponent(reqId)}&error=${encodeURIComponent(error)}`
      : `/__bridge/end?id=${encodeURIComponent(reqId)}`;
    await postBridge(qs, '', 'text/plain');
  };

  const sendChunk = async (reqId: string, data: Uint8Array): Promise<number> => {
    const status = await postBridge(
      `/__bridge/chunk?id=${encodeURIComponent(reqId)}`,
      data as unknown as BodyInit,
      'application/octet-stream'
    );
    if (status !== 0) return status;

    const nb = nativeBridge();
    if (nb && typeof nb.postChunkBase64 === 'function') {
      try {
        return Number(nb.postChunkBase64(reqId, uint8ToBase64(data))) || 200;
      } catch {
        return 0;
      }
    }
    return 0;
  };

  (window as any).__tgStreamBridge = {
    abort(reqId: string) {
      abortedReqs.add(reqId);
    },

    getCachedMeta(telegramUrl: string) {
      const parsed = parseTelegramUrl(telegramUrl);
      if (!parsed.isValid || !parsed.messageId) return null;
      const entry = mediaCache.get(`${parsed.chatId}:${parsed.messageId}`);
      if (!entry) return null;
      return {
        fileSize: entry.fileSize,
        durationSec: entry.durationSec,
        mimeType: entry.mimeType,
      };
    },

    async resolveMeta(reqId: string, telegramUrl: string) {
      try {
        const meta = await resolveTelegramDocument(telegramUrl);
        await sendMeta(reqId, {
          ok: true,
          fileSize: meta.fileSize,
          durationSec: meta.durationSec,
          mimeType: meta.mimeType,
        });
      } catch (err: any) {
        await sendMeta(reqId, {
          ok: false,
          error: err?.message || 'Failed to resolve Telegram video',
        });
      }
    },

    async pumpRange(reqId: string, telegramUrl: string, startByte: number, endByte: number) {
      const BLOCK = 512 * 1024;
      const CONCURRENCY = 3;
      const localBlockCache = ((window as any).__tgBlockCache ||= new Map<string, Uint8Array>());

      try {
        let entry = await resolveTelegramDocument(telegramUrl);
        let client = await getBrowserTelegramClient();

        const fetchOneBlock = async (doc: Api.Document, blockIdx: number): Promise<Uint8Array> => {
          const cacheKey = `${doc.id.toString()}:${blockIdx}`;
          const cached = localBlockCache.get(cacheKey);
          if (cached) return cached;

          const fileLocation = new Api.InputDocumentFileLocation({
            id: doc.id,
            accessHash: doc.accessHash,
            fileReference: doc.fileReference,
            thumbSize: '',
          });

          let collected: Uint8Array | null = null;
          for await (const chunk of client.iterDownload({
            file: fileLocation,
            offset: bigInt(blockIdx * BLOCK) as any,
            requestSize: BLOCK,
            dcId: (doc as any).dcId,
            fileSize: doc.size,
          })) {
            collected = new Uint8Array(chunk);
            break;
          }
          const result = collected || new Uint8Array(0);
          if (result.length > 0) {
            if (localBlockCache.size >= 40) {
              const oldest = localBlockCache.keys().next().value;
              if (oldest !== undefined) localBlockCache.delete(oldest);
            }
            localBlockCache.set(cacheKey, result);
          }
          return result;
        };

        const runPump = async (doc: Api.Document) => {
          const firstBlock = Math.floor(startByte / BLOCK);
          const lastBlock = Math.floor(endByte / BLOCK);
          const pending = new Map<number, Promise<Uint8Array>>();
          let nextQueue = firstBlock;

          const queueAhead = (upTo: number) => {
            const cap = Math.min(lastBlock, upTo);
            while (nextQueue <= cap && !abortedReqs.has(reqId)) {
              const idx = nextQueue++;
              if (!pending.has(idx)) {
                const p = fetchOneBlock(doc, idx);
                p.catch(() => {});
                pending.set(idx, p);
              }
            }
          };

          queueAhead(firstBlock + CONCURRENCY - 1);

          for (let blockIdx = firstBlock; blockIdx <= lastBlock; blockIdx++) {
            if (abortedReqs.has(reqId)) break;
            queueAhead(blockIdx + CONCURRENCY);

            const blockData = await (pending.get(blockIdx) || fetchOneBlock(doc, blockIdx));
            pending.delete(blockIdx);

            if (abortedReqs.has(reqId) || blockData.length === 0) break;

            const blockStart = blockIdx * BLOCK;
            const sliceStart = Math.max(0, startByte - blockStart);
            const sliceEnd = Math.min(blockData.length, endByte - blockStart + 1);

            if (sliceEnd > sliceStart) {
              const slice = blockData.subarray(sliceStart, sliceEnd);
              const status = await sendChunk(reqId, slice);
              if (status !== 200) {
                abortedReqs.add(reqId);
                break;
              }
            }
            if (blockData.length < BLOCK) break;
          }
          pending.clear();
        };

        try {
          await runPump(entry.document);
        } catch (err: any) {
          if (err?.message?.includes('FILE_REFERENCE')) {
            const parsed = parseTelegramUrl(telegramUrl);
            mediaCache.delete(`${parsed.chatId}:${parsed.messageId}`);
            entry = await resolveTelegramDocument(telegramUrl);
            await runPump(entry.document);
          } else if (isRecoverableClientError(err)) {
            client = await getBrowserTelegramClient(true);
            await runPump(entry.document);
          } else {
            throw err;
          }
        }

        await sendEnd(reqId);
      } catch (err: any) {
        await sendEnd(reqId, err?.message || 'stream_failed');
      } finally {
        abortedReqs.delete(reqId);
      }
    },
  };

  // Pre-warm Telegram WSS connection quietly in background on native app start
  getBrowserTelegramClient().catch(() => {});
}
