import './shims/globals';
import { TelegramClient, Api, Logger } from 'telegram';
import { LogLevel } from 'telegram/extensions/Logger.js';
import { StringSession } from 'telegram/sessions/index.js';
import bigInt from 'big-integer';
import { parseTelegramUrl } from './telegramParser';
import { inspectMediaHeaderBytes, LocalHeaderProbeResult } from './mediaHeaderParser';

const TG_API_ID = 31425129;
const TG_API_HASH = 'd1069176c0bd22479ffed449cb9b3d2a';
const TG_BOT_TOKEN = '8993099137:AAH5ppM00ckVZvMek7fv623fbeYty3qgsxM';
const SESSION_STORAGE_KEY = 'tg_browser_bot_session_v2';
const LEGACY_SESSION_STORAGE_KEY = 'tg_browser_bot_session_v1';
const CHANNEL_HASH_STORAGE_KEY = 'tg_known_channel_hashes_v1';

// Known channel access hashes (same registry used by backend)
const KNOWN_ACCESS_HASHES: Record<string, string> = {
  '4451036277': '-4249150958547605887',
  '3432917101': '-4482230480674919611',
  '4498557265': '113338100892344891',
};

interface CachedBrowserMedia {
  document: Api.Document;
  fileSize: number;
  durationSec: number;
  width: number;
  height: number;
  fileName: string;
  rawMime: string;
  mimeType: string;
  headerProbe?: LocalHeaderProbeResult;
  cachedAt: number;
}

const mediaCache = new Map<string, CachedBrowserMedia>();
const MEDIA_CACHE_TTL_MS = 45 * 60 * 1000;

let browserClient: TelegramClient | null = null;
let connectPromise: Promise<TelegramClient> | null = null;
let resettingPromise: Promise<TelegramClient> | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
const dcSenders = new Map<number, any>();
const dcSenderPromises = new Map<string, Promise<any>>();
const resolvedDcMap = new Map<string, number>();

function isAuthSessionFatalError(err: any): boolean {
  const msg = String(err?.errorMessage || err?.message || err || '').toUpperCase();
  return (
    msg.includes('AUTH_KEY_DUPLICATED') ||
    msg.includes('AUTH_KEY_UNREGISTERED') ||
    msg.includes('AUTH_KEY_INVALID') ||
    msg.includes('SESSION_REVOKED') ||
    msg.includes('SESSION_EXPIRED')
  );
}

function isFileRefError(err: any): boolean {
  const msg = String(err?.errorMessage || err?.message || err || '').toUpperCase();
  return msg.includes('FILE_REFERENCE');
}

function ensureKeepaliveLoop() {
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(async () => {
    const c = browserClient;
    if (!c) return;
    try {
      if (!c.connected) {
        await c.connect().catch(() => {});
      } else {
        await Promise.race([
          c.invoke(new Api.Ping({ pingId: bigInt(Date.now()) })),
          new Promise((_, rej) => setTimeout(() => rej(new Error('PING_TIMEOUT')), 8000)),
        ]);
      }
      // Refresh active DC senders via getSender so GramJS's 30s exportedSenderReleaseTimeout resets cleanly
      for (const [dcId, sender] of Array.from(dcSenders.entries())) {
        try {
          if (!sender || (typeof sender.isConnected === 'function' && !sender.isConnected())) {
            dcSenders.delete(dcId);
            continue;
          }
          const refreshed = await Promise.race([
            c.getSender(dcId as any),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
          ]);
          if (refreshed) {
            dcSenders.set(dcId, refreshed);
          }
        } catch {}
      }
    } catch {
      if (!c.connected) {
        try {
          await resetBrowserTelegramClient({ clearSession: false });
        } catch {}
      }
    }
  }, 20000);
}

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
    const v2 = (localStorage.getItem(SESSION_STORAGE_KEY) || '').trim();
    if (v2) return v2;
    const v1 = (localStorage.getItem(LEGACY_SESSION_STORAGE_KEY) || '').trim();
    return v1;
  } catch {
    return '';
  }
}

function saveBrowserSession(sess: string) {
  try {
    if (sess && sess.length > 10) {
      localStorage.setItem(SESSION_STORAGE_KEY, sess);
      localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
    }
  } catch {}
}

function clearSavedBrowserSession() {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
  } catch {}
}

export async function resetBrowserTelegramClient(opts?: { clearSession?: boolean }): Promise<TelegramClient> {
  if (resettingPromise) return resettingPromise;
  const clearSession = Boolean(opts?.clearSession);

  resettingPromise = (async () => {
    const prev = browserClient;
    browserClient = null;
    connectPromise = null;
    dcSenders.clear();
    dcSenderPromises.clear();
    if (clearSession) {
      clearSavedBrowserSession();
    }
    if (prev) {
      try {
        await prev.disconnect();
      } catch {}
    }
    return await getBrowserTelegramClient(false);
  })().finally(() => {
    resettingPromise = null;
  });

  return resettingPromise;
}

const DC_WEB_DOMAINS: Record<number, string> = {
  1: 'pluto.web.telegram.org',
  2: 'venus.web.telegram.org',
  3: 'aurora.web.telegram.org',
  4: 'vesta.web.telegram.org',
  5: 'flora.web.telegram.org',
};

const BROWSER_TELEGRAM_DCS: Array<{ id: number; ip: string; port: number }> = [
  { id: 5, ip: 'flora.web.telegram.org', port: 443 },
  { id: 4, ip: 'vesta.web.telegram.org', port: 443 },
  { id: 2, ip: 'venus.web.telegram.org', port: 443 },
  { id: 1, ip: 'pluto.web.telegram.org', port: 443 },
  { id: 3, ip: 'aurora.web.telegram.org', port: 443 },
];

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`TIMEOUT: ${label}`)), ms);
    }),
  ]);
}

function buildSanitizedSavedSession(rawSession: string): StringSession | null {
  if (!rawSession) return null;
  try {
    const sess = new StringSession(rawSession);
    const dcId = Number(sess.dcId || 5);
    const webDomain = DC_WEB_DOMAINS[dcId] || 'flora.web.telegram.org';
    const addr = String(sess.serverAddress || '').trim().toLowerCase();
    if (!addr.endsWith('.web.telegram.org') || Number(sess.port) !== 443) {
      sess.setDC(dcId, webDomain, 443);
    }
    return sess;
  } catch {
    return null;
  }
}

export async function getBrowserTelegramClient(forceReconnect = false): Promise<TelegramClient> {
  if (forceReconnect) {
    return resetBrowserTelegramClient({ clearSession: false });
  }
  if (resettingPromise) {
    return resettingPromise;
  }
  if (browserClient) {
    if (browserClient.connected) {
      ensureKeepaliveLoop();
      return browserClient;
    }
    try {
      await browserClient.connect();
      if (browserClient.connected) {
        ensureKeepaliveLoop();
        return browserClient;
      }
    } catch {
      browserClient = null;
    }
  }
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    const saved = getSavedBrowserSession();
    const savedSess = buildSanitizedSavedSession(saved);
    if (savedSess) {
      try {
        const client = new TelegramClient(savedSess, TG_API_ID, TG_API_HASH, {
          connectionRetries: 3,
          requestRetries: 4,
          retryDelay: 800,
          autoReconnect: true,
          useWSS: true,
          floodSleepThreshold: 60,
          maxConcurrentDownloads: 8,
          baseLogger: new Logger(LogLevel.ERROR),
        });
        await withTimeout(client.connect(), 9000, 'saved session connect');
        if (client.connected) {
          saveBrowserSession(client.session.save() as unknown as string);
          browserClient = client;
          ensureKeepaliveLoop();
          return client;
        }
        try { await client.disconnect(); } catch {}
      } catch (err: any) {
        if (isAuthSessionFatalError(err)) {
          clearSavedBrowserSession();
        }
      }
    }

    let lastErr: any = null;
    for (const dc of BROWSER_TELEGRAM_DCS) {
      const sess = new StringSession('');
      sess.setDC(dc.id, dc.ip, dc.port);
      const freshClient = new TelegramClient(sess, TG_API_ID, TG_API_HASH, {
        connectionRetries: 2,
        requestRetries: 3,
        retryDelay: 600,
        autoReconnect: true,
        useWSS: true,
        floodSleepThreshold: 60,
        maxConcurrentDownloads: 8,
        baseLogger: new Logger(LogLevel.ERROR),
      });
      try {
        await withTimeout(
          freshClient.start({ botAuthToken: TG_BOT_TOKEN }),
          10000,
          `fresh WSS start DC${dc.id}`
        );
        const exported = freshClient.session.save() as unknown as string;
        saveBrowserSession(exported);
        browserClient = freshClient;
        ensureKeepaliveLoop();
        return freshClient;
      } catch (dcErr: any) {
        lastErr = dcErr;
        try { await freshClient.disconnect(); } catch {}
      }
    }
    throw lastErr || new Error('Failed to start browser Telegram client');
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

async function getBrowserDcSenderSafe(client: TelegramClient, dcId: number | undefined): Promise<any> {
  const numericDc = typeof dcId === 'number' && Number.isFinite(dcId) ? dcId : undefined;
  const key = numericDc !== undefined ? String(numericDc) : 'default';
  const existing = dcSenderPromises.get(key);
  if (existing) return existing;

  // Always borrow via client.getSender(numericDc) so GramJS's 30s _exportedSenderReleaseTimeouts resets
  // and disconnected senders are automatically re-established instead of returning a dead cached socket.
  const p = withTimeout(
    client.getSender(numericDc as any),
    12000,
    `getSender DC${numericDc ?? 'main'}`
  )
    .then((sender) => {
      if (numericDc !== undefined && sender) {
        dcSenders.set(numericDc, sender);
      }
      return sender;
    })
    .finally(() => {
      dcSenderPromises.delete(key);
    });
  dcSenderPromises.set(key, p);
  return p;
}

function isRecoverableClientError(err: any): boolean {
  const msg = String(err?.message || err?.errorMessage || '').toUpperCase();
  return (
    msg.includes('AUTH_KEY_DUPLICATED') ||
    msg.includes('AUTH_KEY_UNREGISTERED') ||
    msg.includes('AUTH_KEY_INVALID') ||
    msg.includes('SESSION_REVOKED') ||
    msg.includes('SESSION_EXPIRED') ||
    msg.includes('WEBSOCKET') ||
    msg.includes('CONNECTION') ||
    msg.includes('NOT CONNECTED') ||
    msg.includes('TIMEOUT') ||
    msg.includes('TIMED OUT') ||
    msg.includes('ABORT') ||
    msg.includes('ECONNRESET') ||
    msg.includes('PING_TIMEOUT') ||
    msg.includes('SOCKET')
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
  const rawToken = parsed.rawChannelId ? parsed.rawChannelId.replace(/^-100/, '').trim() : '';
  const cleanId = /^\d+$/.test(rawToken) ? rawToken : '';
  const cachedHash = cleanId ? getSavedChannelHash(cleanId) : null;

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
    candidates.push(bigInt(cleanId));
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
        await resetBrowserTelegramClient({ clearSession: isAuthSessionFatalError(e) });
        return resolveTelegramDocument(telegramUrl, false);
      }
    }
  }

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
  let width = 0;
  let height = 0;
  const videoAttr = document.attributes.find((a) => a instanceof Api.DocumentAttributeVideo);
  if (videoAttr) {
    const v = videoAttr as Api.DocumentAttributeVideo;
    durationSec = v.duration || 0;
    width = v.w || 0;
    height = v.h || 0;
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
    width,
    height,
    fileName,
    rawMime,
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
  const CHUNK = 0x4000;
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
  const activeReqIds = new Set<string>();
  const localBlockCache = ((window as any).__tgBlockCache ||= new Map<string, Uint8Array>());
  const nativeBridge = () => (window as any).AndroidStreamBridge;

  const postBridge = async (path: string, body: BodyInit, contentType: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body,
        signal: controller.signal,
      });
      return res.status;
    } catch {
      return 0;
    } finally {
      clearTimeout(timer);
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

  // Prefer raw binary HTTP loopback transfer (zero Base64 encoding on UI thread); fallback to JNI Base64 only if fetch fails
  const sendChunk = async (reqId: string, data: Uint8Array): Promise<number> => {
    const copyForFetch = data.buffer.byteLength === data.byteLength && data.byteOffset === 0
      ? data
      : data.slice();
    const status = await postBridge(
      `/__bridge/chunk?id=${encodeURIComponent(reqId)}`,
      copyForFetch as unknown as BodyInit,
      'application/octet-stream'
    );
    if (status > 0) {
      return status;
    }

    const nb = nativeBridge();
    if (nb && typeof nb.postChunkBase64 === 'function') {
      try {
        return Number(nb.postChunkBase64(reqId, uint8ToBase64(data))) || 200;
      } catch {}
    }
    return 0;
  };

  const BLOCK = 512 * 1024;
  const inflightBlocks = new Map<string, Promise<Uint8Array>>();

  const fetchOneBlockRaw = async (
    clientRef: { current: TelegramClient },
    doc: Api.Document,
    blockIdx: number
  ): Promise<Uint8Array> => {
    const docIdStr = doc.id.toString();
    const fileLocation = new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: '',
    });
    const request = new Api.upload.GetFile({
      location: fileLocation,
      offset: bigInt(blockIdx * BLOCK) as any,
      limit: BLOCK,
    });

    if (!clientRef.current?.connected) {
      clientRef.current = await getBrowserTelegramClient();
    }

    let dcId: number | undefined = resolvedDcMap.get(docIdStr) ?? (doc as any).dcId;
    let lastErr: any = null;
    let authResetDone = false;

    for (let attempt = 1; attempt <= 6; attempt++) {
      let timerId: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!clientRef.current?.connected) {
          clientRef.current = await getBrowserTelegramClient();
        }
        const sender = await getBrowserDcSenderSafe(clientRef.current, dcId);
        const invokePromise = clientRef.current.invokeWithSender(request, sender);
        const timeoutPromise = new Promise<never>((_, reject) => {
          timerId = setTimeout(() => reject(new Error('TIMEOUT: Telegram GetFile timed out')), 22000);
        });
        const result: any = await Promise.race([invokePromise, timeoutPromise]);
        if (result instanceof Api.upload.FileCdnRedirect) {
          throw new Error('CDN redirect not supported for GetFile');
        }
        if (dcId !== undefined) {
          resolvedDcMap.set(docIdStr, dcId);
        }
        const bytes = result?.bytes ? new Uint8Array(result.bytes) : new Uint8Array(0);
        if (bytes.length > 0) {
          if (localBlockCache.size >= 96) {
            const oldest = localBlockCache.keys().next().value;
            if (oldest !== undefined) localBlockCache.delete(oldest);
          }
          localBlockCache.set(`${docIdStr}:${blockIdx}`, bytes);
        }
        return bytes;
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.errorMessage || err?.message || '');
        if (isFileRefError(err)) {
          throw err;
        }
        if (isAuthSessionFatalError(err) && !authResetDone) {
          authResetDone = true;
          clientRef.current = await resetBrowserTelegramClient({ clearSession: true });
          continue;
        }
        if (err?.newDc) {
          dcId = Number(err.newDc);
          resolvedDcMap.set(docIdStr, dcId);
          continue;
        }
        const migrateMatch = msg.match(/FILE_MIGRATE_(\d+)/i);
        if (migrateMatch) {
          dcId = Number(migrateMatch[1]);
          resolvedDcMap.set(docIdStr, dcId);
          continue;
        }
        const floodMatch = msg.match(/FLOOD_WAIT_(\d+)/i);
        if (floodMatch && Number(floodMatch[1]) <= 12 && attempt < 6) {
          await new Promise((r) => setTimeout(r, (Number(floodMatch[1]) + 1) * 1000));
          continue;
        }
        if (attempt < 6) {
          await new Promise((r) => setTimeout(r, Math.min(2500, 400 * attempt)));
          try {
            if (dcId !== undefined) {
              const s = dcSenders.get(dcId);
              if (s && typeof s.isConnected === 'function' && !s.isConnected()) {
                dcSenders.delete(dcId);
              }
            }
            if (!clientRef.current?.connected) {
              if (attempt >= 4) {
                clientRef.current = await resetBrowserTelegramClient({ clearSession: false });
              } else {
                await clientRef.current?.connect();
              }
            }
          } catch {}
        }
      } finally {
        if (timerId !== undefined) clearTimeout(timerId);
      }
    }
    throw lastErr || new Error('Failed to fetch Telegram block');
  };

  const fetchOneBlockWithRetry = (
    clientRef: { current: TelegramClient },
    doc: Api.Document,
    blockIdx: number
  ): Promise<Uint8Array> => {
    const cacheKey = `${doc.id.toString()}:${blockIdx}`;
    const cached = localBlockCache.get(cacheKey);
    if (cached) {
      localBlockCache.delete(cacheKey);
      localBlockCache.set(cacheKey, cached);
      return Promise.resolve(cached);
    }
    const existing = inflightBlocks.get(cacheKey);
    if (existing) return existing;

    const p = fetchOneBlockRaw(clientRef, doc, blockIdx).finally(() => {
      inflightBlocks.delete(cacheKey);
    });
    inflightBlocks.set(cacheKey, p);
    return p;
  };

  (window as any).__tgStreamBridge = {
    abort(reqId: string) {
      abortedReqs.add(reqId);
    },

    abortAll() {
      for (const id of activeReqIds) {
        abortedReqs.add(id);
      }
    },

    getCachedMeta(telegramUrl: string) {
      const parsed = parseTelegramUrl(telegramUrl);
      if (!parsed.isValid || !parsed.messageId) return null;
      const entry = mediaCache.get(`${parsed.chatId}:${parsed.messageId}`);
      if (!entry) return null;
      return {
        fileSize: entry.fileSize,
        durationSec: entry.headerProbe?.durationSec || entry.durationSec,
        mimeType: entry.mimeType,
        headerProbe: entry.headerProbe,
      };
    },

    async resolveMeta(reqId: string, telegramUrl: string) {
      try {
        const meta = await resolveTelegramDocument(telegramUrl);
        await sendMeta(reqId, {
          ok: true,
          fileSize: meta.fileSize,
          durationSec: meta.headerProbe?.durationSec || meta.durationSec,
          mimeType: meta.mimeType,
          fileName: meta.fileName,
          width: meta.width,
          height: meta.height,
        });
      } catch (err: any) {
        await sendMeta(reqId, {
          ok: false,
          error: err?.message || 'Failed to resolve Telegram video',
        });
      }
    },

    async resolveStreamInfo(reqId: string, telegramUrl: string) {
      try {
        const meta = await resolveTelegramDocument(telegramUrl);
        if (!meta.headerProbe) {
          try {
            const client = await getBrowserTelegramClient();
            const clientRef = { current: client };
            const block0 = await fetchOneBlockWithRetry(clientRef, meta.document, 0);
            meta.headerProbe = inspectMediaHeaderBytes(
              block0,
              meta.fileName,
              meta.rawMime,
              meta.durationSec,
              meta.width,
              meta.height
            );
            if (meta.headerProbe.durationSec > 0 && meta.durationSec <= 0) {
              meta.durationSec = meta.headerProbe.durationSec;
            }
          } catch {
            meta.headerProbe = inspectMediaHeaderBytes(
              new Uint8Array(0),
              meta.fileName,
              meta.rawMime,
              meta.durationSec,
              meta.width,
              meta.height
            );
          }
        }
        const p = meta.headerProbe;
        await sendMeta(reqId, {
          ok: true,
          status: 'ok',
          isTelegram: true,
          fileName: meta.fileName,
          fileSize: meta.fileSize,
          durationSec: p.durationSec || meta.durationSec || 0,
          container: p.container,
          videoCodec: p.videoCodec,
          is10Bit: p.is10Bit,
          width: p.width || meta.width,
          height: p.height || meta.height,
          audioCodec: p.audioCodec,
          hasUnsupportedAudio: p.hasUnsupportedAudio,
          probedByFfprobe: false,
          mimeType: meta.mimeType,
        });
      } catch (err: any) {
        await sendMeta(reqId, {
          ok: false,
          error: err?.message || 'Failed to inspect local Telegram stream',
        });
      }
    },

    async pumpRange(reqId: string, telegramUrl: string, startByte: number, endByte: number) {
      const CONCURRENCY = 2;
      activeReqIds.add(reqId);

      try {
        let entry = await resolveTelegramDocument(telegramUrl);
        const clientRef = { current: await getBrowserTelegramClient() };
        const initialFirstBlock = Math.floor(startByte / BLOCK);
        const lastBlock = Math.floor(endByte / BLOCK);
        let resumeFromBlock = initialFirstBlock;

        const runPump = async (doc: Api.Document, fromBlock: number) => {
          const pending = new Map<number, Promise<Uint8Array>>();
          let nextQueue = fromBlock;

          const queueAhead = (upTo: number) => {
            const cap = Math.min(lastBlock, upTo);
            while (nextQueue <= cap && !abortedReqs.has(reqId)) {
              const idx = nextQueue++;
              if (!pending.has(idx)) {
                const p = fetchOneBlockWithRetry(clientRef, doc, idx);
                p.catch(() => {});
                pending.set(idx, p);
              }
            }
          };

          queueAhead(fromBlock + CONCURRENCY - 1);

          for (let blockIdx = fromBlock; blockIdx <= lastBlock; blockIdx++) {
            if (abortedReqs.has(reqId)) break;

            const blockData = await (pending.get(blockIdx) || fetchOneBlockWithRetry(clientRef, doc, blockIdx));
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
            // Advance resume checkpoint & pipeline next block only after downstream confirmed receipt
            resumeFromBlock = blockIdx + 1;
            if (blockData.length < BLOCK) break;
            queueAhead(blockIdx + CONCURRENCY);
          }
          pending.clear();
        };

        let consecutiveFailuresAtSameBlock = 0;
        while (resumeFromBlock <= lastBlock && !abortedReqs.has(reqId)) {
          const prevBlock = resumeFromBlock;
          try {
            await runPump(entry.document, resumeFromBlock);
            break;
          } catch (err: any) {
            if (resumeFromBlock > prevBlock) {
              consecutiveFailuresAtSameBlock = 0;
            }
            consecutiveFailuresAtSameBlock += 1;
            if (consecutiveFailuresAtSameBlock > 5) {
              throw err;
            }
            if (isFileRefError(err)) {
              const parsed = parseTelegramUrl(telegramUrl);
              mediaCache.delete(`${parsed.chatId}:${parsed.messageId}`);
              entry = await resolveTelegramDocument(telegramUrl);
              continue;
            }
            if (isRecoverableClientError(err)) {
              clientRef.current = await resetBrowserTelegramClient({ clearSession: isAuthSessionFatalError(err) });
              continue;
            }
            throw err;
          }
        }

        await sendEnd(reqId);
      } catch (err: any) {
        await sendEnd(reqId, err?.message || 'stream_failed');
      } finally {
        activeReqIds.delete(reqId);
        abortedReqs.delete(reqId);
      }
    },
  };

  // Pre-warm Telegram WSS connection quietly in background on native app start
  getBrowserTelegramClient().catch(() => {});
}
