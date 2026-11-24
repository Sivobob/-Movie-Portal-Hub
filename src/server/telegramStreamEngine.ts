import { Request, Response } from 'express';
import { spawn } from 'child_process';
import { Api, TelegramClient } from 'telegram';
import bigInt from 'big-integer';
import { cleanMediaTrackLabel } from '../utils/videoQuality.ts';
import { isTelegramAuthKeyError, resetTelegramClient } from '../utils/telegramClient.ts';

export const BLOCK_SIZE = 512 * 1024; // 512 KB (exact Telegram upload.GetFile unit)
const MAX_CACHED_BLOCKS = 96; // ~48 MB RAM LRU cache across active streams

export interface TelegramDocInfo {
  document: Api.Document;
  fileSize: number;
  durationSec: number;
  fileName: string;
  rawMime: string;
}

export interface AudioTrackInfo {
  id: number; // audio stream order (0, 1, 2...)
  streamIndex: number;
  codec: string;
  channels: number;
  lang: string;
  label: string;
  startTime?: number;
}

export interface SubtitleTrackInfo {
  id: number;
  streamIndex: number;
  codec: string;
  lang: string;
  label: string;
  forced?: boolean;
  defaultTrack?: boolean;
}

export interface ProbeMediaResult {
  durationSec: number;
  container: string;
  videoCodec: string;
  videoProfile: string;
  videoLevel: number;
  pixFmt: string;
  is10Bit: boolean;
  width: number;
  height: number;
  audioCodec: string;
  audioTracks: AudioTrackInfo[];
  subtitleTracks: SubtitleTrackInfo[];
  recommendedMode: 'direct' | 'remux' | 'transcode';
  needsAudioTranscode: boolean;
  probedByFfprobe: boolean;
  videoStartTime?: number;
  videoStreamIndex?: number;
}

// Global LRU Block Cache: key = `${docId}:${blockIndex}`
const blockCache = new Map<string, Buffer>();
const inflightBlocks = new Map<string, Promise<Buffer>>();
const resolvedDcMap = new Map<string, number>();

function touchCache(key: string, buf: Buffer) {
  if (blockCache.has(key)) {
    blockCache.delete(key);
  }
  blockCache.set(key, buf);
  while (blockCache.size > MAX_CACHED_BLOCKS) {
    const oldestKey = blockCache.keys().next().value;
    if (oldestKey !== undefined) {
      blockCache.delete(oldestKey);
    } else {
      break;
    }
  }
}

function getCachedBlock(key: string): Buffer | undefined {
  const hit = blockCache.get(key);
  if (hit) {
    // Refresh LRU order
    blockCache.delete(key);
    blockCache.set(key, hit);
  }
  return hit;
}

const dcSenderPromises = new Map<string, Promise<any>>();
const activeDcSenders = new Map<string, { client: TelegramClient; sender: any; dcId?: number; lastUsedAt: number }>();
let dcKeepaliveTimer: ReturnType<typeof setInterval> | null = null;

function ensureDcKeepaliveLoop() {
  if (dcKeepaliveTimer) return;
  dcKeepaliveTimer = setInterval(async () => {
    const now = Date.now();
    for (const [key, entry] of activeDcSenders.entries()) {
      // Evict senders idle for > 15 minutes
      if (now - entry.lastUsedAt > 15 * 60 * 1000) {
        activeDcSenders.delete(key);
        continue;
      }
      try {
        await Promise.race([
          entry.client.invokeWithSender(new Api.Ping({ pingId: bigInt(now) as any }), entry.sender),
          new Promise((_, rej) => setTimeout(() => rej(new Error('ping timeout')), 8000)),
        ]);
      } catch {
        try {
          (entry.sender as any)?.reconnect?.();
        } catch {}
      }
    }
  }, 35 * 1000);
  dcKeepaliveTimer.unref?.();
}

async function getDcSenderSafe(client: TelegramClient, dcId: number | undefined): Promise<any> {
  const key = dcId !== undefined ? String(dcId) : 'default';
  const cachedEntry = activeDcSenders.get(key);
  if (cachedEntry && cachedEntry.client === client && cachedEntry.sender) {
    cachedEntry.lastUsedAt = Date.now();
  }
  const existing = dcSenderPromises.get(key);
  if (existing) return existing;

  const p = client.getSender(dcId as any).then((sender) => {
    activeDcSenders.set(key, { client, sender, dcId, lastUsedAt: Date.now() });
    ensureDcKeepaliveLoop();
    return sender;
  }).finally(() => {
    dcSenderPromises.delete(key);
  });
  dcSenderPromises.set(key, p);
  return p;
}

async function fetchTelegramBlockRaw(
  client: TelegramClient,
  doc: Api.Document,
  blockIndex: number
): Promise<Buffer> {
  const docIdStr = doc.id.toString();
  const offsetBytes = blockIndex * BLOCK_SIZE;
  const location = new Api.InputDocumentFileLocation({
    id: doc.id,
    accessHash: doc.accessHash,
    fileReference: doc.fileReference,
    thumbSize: '',
  });

  let activeClient = client;
  let dcId: number | undefined = resolvedDcMap.get(docIdStr) ?? doc.dcId;
  let sender = await getDcSenderSafe(activeClient, dcId);

  const request = new Api.upload.GetFile({
    location,
    offset: bigInt(offsetBytes) as any,
    limit: BLOCK_SIZE,
  });

  const maxAttempts = 5;
  let attempts = 0;
  let authResetDone = false;

  while (attempts < maxAttempts) {
    attempts++;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    try {
      const invokePromise = activeClient.invokeWithSender(request, sender);
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error('TIMEOUT: Telegram GetFile timed out')), 20000);
      });
      const result: any = await Promise.race([invokePromise, timeoutPromise]);
      if (result instanceof Api.upload.FileCdnRedirect) {
        throw new Error('CDN redirect not supported for GetFile');
      }
      if (dcId !== undefined) {
        resolvedDcMap.set(docIdStr, dcId);
      }
      return Buffer.isBuffer(result.bytes) ? result.bytes : Buffer.from(result.bytes);
    } catch (err: any) {
      const msg = String(err?.errorMessage || err?.message || '');
      if (isTelegramAuthKeyError(err) && !authResetDone) {
        authResetDone = true;
        activeClient = await resetTelegramClient({ clearSavedSession: true, preferBotFallback: true });
        sender = await getDcSenderSafe(activeClient, dcId);
        continue;
      }
      if (err?.newDc) {
        dcId = Number(err.newDc);
        resolvedDcMap.set(docIdStr, dcId);
        sender = await getDcSenderSafe(activeClient, dcId);
        continue;
      }
      const migrateMatch = msg.match(/FILE_MIGRATE_(\d+)/i);
      if (migrateMatch) {
        dcId = Number(migrateMatch[1]);
        resolvedDcMap.set(docIdStr, dcId);
        sender = await getDcSenderSafe(activeClient, dcId);
        continue;
      }
      const upperMsg = msg.toUpperCase();
      const isTransientNetErr =
        upperMsg.includes('TIMEOUT') ||
        upperMsg.includes('ECONNRESET') ||
        upperMsg.includes('ETIMEDOUT') ||
        upperMsg.includes('EPIPE') ||
        upperMsg.includes('CONNECTION') ||
        upperMsg.includes('NOT CONNECTED') ||
        upperMsg.includes('WEBSOCKET') ||
        upperMsg.includes('RPC_CALL_FAIL') ||
        upperMsg.includes('INTERNAL');
      if (isTransientNetErr && attempts < maxAttempts) {
        const senderKey = dcId !== undefined ? String(dcId) : 'default';
        if (attempts >= 2) {
          activeDcSenders.delete(senderKey);
          try {
            (sender as any)?.reconnect?.();
          } catch {}
        }
        await new Promise((r) => setTimeout(r, Math.min(2500, 400 * attempts)));
        try {
          if (!activeClient.connected) {
            await activeClient.connect();
          }
          sender = await getDcSenderSafe(activeClient, dcId);
        } catch {}
        continue;
      }
      const floodMatch = msg.match(/FLOOD_WAIT_(\d+)/i);
      if (floodMatch && Number(floodMatch[1]) <= 10 && attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, (Number(floodMatch[1]) + 1) * 1000));
        continue;
      }
      throw err;
    } finally {
      if (timeoutHandle !== undefined) {
        clearTimeout(timeoutHandle);
      }
    }
  }
  throw new Error('Failed to fetch Telegram block after retries');
}

export function fetchBlock(
  client: TelegramClient,
  doc: Api.Document,
  blockIndex: number
): Promise<Buffer> {
  const key = `${doc.id.toString()}:${blockIndex}`;
  const cached = getCachedBlock(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  const inflight = inflightBlocks.get(key);
  if (inflight) {
    return inflight;
  }

  const promise = fetchTelegramBlockRaw(client, doc, blockIndex)
    .then((buf) => {
      touchCache(key, buf);
      return buf;
    })
    .finally(() => {
      inflightBlocks.delete(key);
    });

  inflightBlocks.set(key, promise);
  return promise;
}

/**
 * Streams byte range [start, endPos] using parallel pipelined 512KB block fetches
 * with LRU caching and immediate connection-close cancellation.
 */
export async function streamTelegramRange(
  res: Response,
  client: TelegramClient,
  doc: Api.Document,
  start: number,
  endPos: number,
  concurrency: number,
  isClosedFn: () => boolean,
  onFileRefExpired?: () => void,
  refreshDocFn?: () => Promise<Api.Document | null>
): Promise<void> {
  const firstBlock = Math.floor(start / BLOCK_SIZE);
  const lastBlock = Math.floor(endPos / BLOCK_SIZE);
  const effectiveConcurrency = Math.max(1, Math.min(concurrency, 3));

  let currentDoc = doc;
  let refRefreshAttempts = 0;
  let bytesWritten = 0;
  let reachedEndOfRange = false;

  // Active prefetch queue keyed by blockIndex
  const blockPromises = new Map<number, Promise<Buffer>>();
  let nextToQueue = firstBlock;

  const queueAhead = (upToBlock: number) => {
    const cap = Math.min(lastBlock, upToBlock);
    while (nextToQueue <= cap && !isClosedFn() && !res.writableEnded) {
      const idx = nextToQueue++;
      if (!blockPromises.has(idx)) {
        const p = fetchBlock(client, currentDoc, idx);
        // Prevent unhandled rejection warnings if aborted before awaiting
        p.catch(() => {});
        blockPromises.set(idx, p);
      }
    }
  };

  // Start initial parallel batch immediately
  queueAhead(firstBlock + effectiveConcurrency - 1);

  try {
    for (let blockIdx = firstBlock; blockIdx <= lastBlock; blockIdx++) {
      if (isClosedFn() || res.writableEnded) {
        reachedEndOfRange = true;
        break;
      }

      let blockBuf: Buffer;
      try {
        const p = blockPromises.get(blockIdx) || fetchBlock(client, currentDoc, blockIdx);
        blockBuf = await p;
        blockPromises.delete(blockIdx);
      } catch (blockErr: any) {
        blockPromises.delete(blockIdx);
        const errMsg = String(blockErr?.errorMessage || blockErr?.message || '');
        const canRefreshDoc =
          Boolean(refreshDocFn) &&
          refRefreshAttempts < 3 &&
          (errMsg.includes('FILE_REFERENCE') || bytesWritten > 0);
        if (canRefreshDoc && !isClosedFn() && !res.writableEnded) {
          refRefreshAttempts += 1;
          onFileRefExpired?.();
          try {
            const refreshedDoc = await refreshDocFn!();
            if (refreshedDoc) {
              currentDoc = refreshedDoc;
              blockPromises.clear();
              nextToQueue = blockIdx;
              queueAhead(blockIdx + effectiveConcurrency - 1);
              blockIdx -= 1;
              continue;
            }
          } catch {}
        }
        throw blockErr;
      }

      if (isClosedFn() || res.writableEnded) {
        reachedEndOfRange = true;
        break;
      }
      if (!blockBuf || blockBuf.length === 0) {
        reachedEndOfRange = true;
        break;
      }

      const blockFileStart = blockIdx * BLOCK_SIZE;
      const sliceStart = Math.max(0, start - blockFileStart);
      const sliceEnd = Math.min(blockBuf.length, endPos - blockFileStart + 1);

      if (sliceEnd > sliceStart) {
        const chunk = sliceStart === 0 && sliceEnd === blockBuf.length
          ? blockBuf
          : blockBuf.subarray(sliceStart, sliceEnd);

        bytesWritten += chunk.length;
        const canWrite = res.write(chunk);
        if (!canWrite && !isClosedFn() && !res.writableEnded) {
          await new Promise<void>((resolve) => {
            const onDrain = () => {
              cleanup();
              resolve();
            };
            const onClose = () => {
              cleanup();
              resolve();
            };
            const cleanup = () => {
              res.removeListener('drain', onDrain);
              res.removeListener('close', onClose);
            };
            res.once('drain', onDrain);
            res.once('close', onClose);
          });
        }
      }

      if (blockBuf.length < BLOCK_SIZE || blockIdx === lastBlock) {
        // Reached legitimate EOF or end of requested range
        reachedEndOfRange = true;
        if (blockBuf.length < BLOCK_SIZE) break;
      }

      // Queue next blocks ONLY after downstream socket accepted/drained the current block
      // so a paused player/FFmpeg backpressure never leaves Telegram GetFile RPCs stalling in flight.
      queueAhead(blockIdx + effectiveConcurrency);
    }
  } catch (err: any) {
    const errTxt = String(err?.errorMessage || err?.message || '');
    if (errTxt.includes('FILE_REFERENCE')) {
      onFileRefExpired?.();
    }
    if (!isClosedFn()) {
      console.error('[StreamEngine] Range transfer error:', errTxt || err);
    }
  } finally {
    blockPromises.clear();
    if (!res.writableEnded) {
      if (!reachedEndOfRange && bytesWritten > 0 && !isClosedFn()) {
        // Signal mid-stream error rather than clean EOF so FFmpeg -reconnect_streamed / players reconnect cleanly
        try {
          res.destroy(new Error('Telegram mid-stream range aborted'));
        } catch {
          res.end();
        }
      } else {
        res.end();
      }
    }
  }
}

function formatLanguageLabel(
  langRaw?: string,
  titleRaw?: string,
  idx: number = 0,
  kind: 'audio' | 'subtitle' = 'audio'
): { lang: string; label: string } {
  return cleanMediaTrackLabel(langRaw, titleRaw, kind, idx);
}

function fallbackProbeFromMetadata(docInfo: TelegramDocInfo): ProbeMediaResult {
  const lowerName = docInfo.fileName.toLowerCase();
  const rawMime = docInfo.rawMime.toLowerCase();
  const isWebm = lowerName.endsWith('.webm') || rawMime.includes('webm');
  const isMkv = !isWebm && (lowerName.endsWith('.mkv') || rawMime.includes('matroska') || rawMime.includes('mkv'));
  const isAvi = lowerName.endsWith('.avi') || rawMime.includes('avi');
  const isMp4 = lowerName.endsWith('.mp4') || lowerName.endsWith('.m4v') || rawMime.includes('mp4');
  const isRiskyCodec = /(^|[^a-z0-9])(hevc|x265|h\.?265|10bit|10-bit|hi10p|av1|xvid|divx|2160p|4k|uhd)([^a-z0-9]|$)/i.test(lowerName);

  // If ffprobe could not inspect the file, never blindly copy/remux MKV/AVI/unknown containers
  // because unlabelled HEVC/10-bit inside MKV causes audio-only black screens on mobile devices.
  const recommendedMode: 'direct' | 'remux' | 'transcode' =
    isRiskyCodec || isMkv || isAvi || (!isMp4 && !isWebm)
      ? 'transcode'
      : 'direct';

  return {
    durationSec: docInfo.durationSec || 0,
    container: isWebm ? 'webm' : isMkv ? 'matroska' : 'mp4',
    videoCodec: isRiskyCodec ? 'hevc' : 'h264',
    videoProfile: isRiskyCodec ? 'main 10' : 'high',
    videoLevel: 40,
    pixFmt: isRiskyCodec ? 'yuv420p10le' : 'yuv420p',
    is10Bit: isRiskyCodec,
    width: 0,
    height: 0,
    audioCodec: 'aac',
    audioTracks: [],
    subtitleTracks: [],
    recommendedMode,
    needsAudioTranscode: recommendedMode !== 'direct',
    probedByFfprobe: false,
  };
}

/**
 * Inspects actual video/audio codecs, duration, and tracks via ffprobe against local raw proxy.
 * Because the raw proxy uses the shared 512KB LRU cache, probed header/moov blocks stay in RAM
 * for zero-latency playback immediately after probing.
 */
export async function probeTelegramMedia(
  localPort: string,
  telegramUrl: string,
  docInfo: TelegramDocInfo,
  options?: { timeoutMs?: number; probesize?: number; analyzeduration?: number }
): Promise<ProbeMediaResult> {
  const localRawUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(telegramUrl)}&raw=1`;
  const timeoutMs = Math.max(3000, options?.timeoutMs ?? 14000);
  const probesize = String(options?.probesize ?? 900000);
  const analyzeduration = String(options?.analyzeduration ?? 900000);

  return new Promise<ProbeMediaResult>((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-probesize', probesize,
      '-analyzeduration', analyzeduration,
      localRawUrl,
    ];

    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          proc.kill('SIGKILL');
        } catch {}
        console.warn('[Probe] ffprobe timed out, falling back to safe metadata heuristic');
        resolve(fallbackProbeFromMetadata(docInfo));
      }
    }, timeoutMs);

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });

    proc.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(fallbackProbeFromMetadata(docInfo));
      }
    });

    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0 || !stdout.trim()) {
        resolve(fallbackProbeFromMetadata(docInfo));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        const streams: any[] = Array.isArray(parsed.streams) ? parsed.streams : [];
        const format = parsed.format || {};

        const formatDuration = parseFloat(format.duration || '0');
        const streamDurations = streams
          .map((s) => parseFloat(s?.duration || '0'))
          .filter((d) => Number.isFinite(d) && d > 0);
        const maxStreamDuration = streamDurations.length > 0 ? Math.max(...streamDurations) : 0;
        const durationSec =
          Number.isFinite(formatDuration) && formatDuration > 0
            ? Math.round(formatDuration)
            : maxStreamDuration > 0
              ? Math.round(maxStreamDuration)
              : docInfo.durationSec || 0;

        // Ignore attached cover art images (mjpeg/png with attached_pic = 1) or image codecs (png, mjpeg, webp, bmp, mjpg, gif)
        const videoStreamObj = streams.find(
          (s) =>
            s.codec_type === 'video' &&
            (!s.disposition || s.disposition.attached_pic !== 1) &&
            !['png', 'mjpeg', 'webp', 'bmp', 'mjpg', 'gif', 'image'].includes(String(s.codec_name || '').toLowerCase())
        ) || streams.find((s) => s.codec_type === 'video');

        const videoStreamIndex = Number(videoStreamObj?.index ?? 0);
        const videoStream = videoStreamObj;
        const audioStreamObjs = streams.filter((s) => s.codec_type === 'audio');
        const subtitleStreamObjs = streams.filter((s) => s.codec_type === 'subtitle');

        const videoCodec = String(videoStream?.codec_name || '').toLowerCase();
        const pixFmt = String(videoStream?.pix_fmt || '').toLowerCase();
        const profile = String(videoStream?.profile || '').toLowerCase();
        const fieldOrder = String(videoStream?.field_order || '').toLowerCase();
        const level = Number(videoStream?.level || 0);
        const width = Number(videoStream?.width || 0);
        const height = Number(videoStream?.height || 0);

        const is10Bit =
          pixFmt.includes('10le') ||
          pixFmt.includes('10be') ||
          pixFmt.includes('p10') ||
          pixFmt.includes('12le') ||
          pixFmt.includes('12be') ||
          pixFmt.includes('p12') ||
          pixFmt.includes('yuv422') ||
          pixFmt.includes('yuv444') ||
          profile.includes('10');

        const videoStartTime = parseFloat(videoStream?.start_time || '0');
        const audioTracks: AudioTrackInfo[] = audioStreamObjs.map((s, idx) => {
          const { lang, label } = formatLanguageLabel(s.tags?.language, s.tags?.title, idx, 'audio');
          const trackStart = parseFloat(s.start_time || '0');
          return {
            id: idx,
            streamIndex: Number(s.index ?? idx),
            codec: String(s.codec_name || '').toLowerCase(),
            channels: Number(s.channels || 2),
            lang,
            label,
            startTime: Number.isFinite(trackStart) ? trackStart : 0,
          };
        });

        const subtitleTracks: SubtitleTrackInfo[] = subtitleStreamObjs.map((s, idx) => {
          const rawTitle = String(s.tags?.title || '');
          const isForced = Boolean(s.disposition?.forced === 1 || /\bforced\b/i.test(rawTitle));
          const isDefault = Boolean(s.disposition?.default === 1);
          const { lang, label } = formatLanguageLabel(s.tags?.language, rawTitle, idx, 'subtitle');
          return {
            id: idx,
            streamIndex: Number(s.index ?? idx),
            codec: String(s.codec_name || '').toLowerCase(),
            lang: lang || 'English',
            label: label || (idx === 0 ? 'English' : 'Hindi'),
            forced: isForced,
            defaultTrack: isDefault,
          };
        });

        const primaryAudioCodec = audioTracks[0]?.codec || '';
        const container = String(format.format_name || '').toLowerCase();
        const lowerName = docInfo.fileName.toLowerCase();
        const isWebm = lowerName.endsWith('.webm') || docInfo.rawMime.toLowerCase().includes('webm');
        const isMp4Container =
          container.includes('mp4') ||
          container.includes('mov') ||
          container.includes('m4a') ||
          container.includes('3gp');

        // Determine strict universal mobile hardware / Android WebView / Chrome compatibility:
        // High@L5+, >1080p (4K), 10-bit, Hi422P/444P, interlaced, HEVC, AV1, or MPEG4 -> transcode to 1080p H.264 Main@L4.0
        const isResolutionSafe = (width === 0 || width <= 1920) && (height === 0 || height <= 1080);
        const isLevelSafe = level === 0 || level <= 42;
        const isProgressive = !fieldOrder || fieldOrder === 'progressive' || fieldOrder === 'unknown';
        const isProfileSafe =
          !profile.includes('high 10') &&
          !profile.includes('4:2:2') &&
          !profile.includes('4:4:4');

        const isBrowserSafeH264 =
          videoCodec === 'h264' &&
          !is10Bit &&
          isProfileSafe &&
          isResolutionSafe &&
          isLevelSafe &&
          isProgressive &&
          (pixFmt === '' || pixFmt === 'yuv420p' || pixFmt === 'yuvj420p' || pixFmt === 'nv12');

        const isBrowserSafeWebmVideo =
          isWebm && (videoCodec === 'vp8' || videoCodec === 'vp9') && !is10Bit && isResolutionSafe;

        const isBrowserSafeAudio =
          primaryAudioCodec === '' ||
          primaryAudioCodec === 'aac' ||
          primaryAudioCodec === 'mp3';

        const isBrowserSafeWebmAudio =
          isWebm &&
          (primaryAudioCodec === '' ||
            primaryAudioCodec === 'opus' ||
            primaryAudioCodec === 'vorbis');

        const needsAudioTranscode = !isBrowserSafeAudio;

        let recommendedMode: 'direct' | 'remux' | 'transcode' = 'direct';
        if (isBrowserSafeWebmVideo && isBrowserSafeWebmAudio) {
          recommendedMode = 'direct';
        } else if (!isBrowserSafeH264) {
          // HEVC / H.265 / 10-bit / 4K / High@L5+ / MPEG4 -> black screen on mobile phones -> transcode!
          recommendedMode = 'transcode';
        } else if (!isMp4Container || !isBrowserSafeAudio) {
          // Video is clean 8-bit <=1080p H.264 L4.2, only container (MKV/AVI) or audio (AC3/EAC3/DTS) needs remux!
          recommendedMode = 'remux';
        } else {
          recommendedMode = 'direct';
        }

        resolve({
          durationSec,
          container,
          videoCodec,
          videoProfile: profile,
          videoLevel: level,
          pixFmt,
          is10Bit,
          width,
          height,
          audioCodec: primaryAudioCodec,
          audioTracks,
          subtitleTracks,
          recommendedMode,
          needsAudioTranscode,
          probedByFfprobe: true,
          videoStartTime: Number.isFinite(videoStartTime) ? videoStartTime : 0,
          videoStreamIndex,
        });
      } catch {
        resolve(fallbackProbeFromMetadata(docInfo));
      }
    });
  });
}

function findSequence(buf: Buffer, seq: number[], from = 0, to = buf.length): number {
  const end = Math.min(to, buf.length) - seq.length;
  outer: for (let i = Math.max(0, from); i <= end; i++) {
    for (let j = 0; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function bufferContainsAnyAscii(buf: Buffer, needles: string[]): boolean {
  for (const n of needles) {
    if (buf.indexOf(n, 0, 'latin1') >= 0) return true;
  }
  return false;
}

function checkMp4MoovHasAudio(buf: Buffer): boolean | null {
  const moovIdx = buf.indexOf('moov', 0, 'latin1');
  if (moovIdx < 4) return null;
  const moovSize = buf.readUInt32BE(moovIdx - 4);
  const moovEnd = moovSize >= 8 ? moovIdx - 4 + moovSize : buf.length;
  const slice = buf.subarray(moovIdx - 4, Math.min(buf.length, moovEnd));

  if (
    bufferContainsAnyAscii(slice, [
      'soun',
      'mp4a',
      'ec-3',
      'ac-3',
      'dtsc',
      'dtsh',
      'dtse',
      'Opus',
      'fLaC',
      '.mp3',
      'samr',
      'sawb',
      'twos',
      'sowt',
      'alac',
      'lpcm',
    ])
  ) {
    return true;
  }

  // Only declare "no audio" if we saw the complete moov atom with trak/mvhd inside
  if (moovEnd <= buf.length && slice.indexOf('trak', 0, 'latin1') >= 0) {
    return false;
  }
  return null;
}

/**
 * Fast, zero-ffprobe audio track detector.
 * Reads ONLY 1-2 512KB Telegram blocks directly into RAM (which stay warm in blockCache)
 * to inspect MKV/WebM EBML Tracks, MP4/MOV moov atoms, or AVI headers without spawning ffprobe.
 * Returns true (has audio), false (confirmed silent/no audio), or null (indeterminate).
 */
export async function checkTelegramDocHasAudioFast(
  client: TelegramClient,
  docInfo: TelegramDocInfo
): Promise<boolean | null> {
  try {
    const firstBlock = await fetchBlock(client, docInfo.document, 0);
    if (!firstBlock || firstBlock.length < 16) return null;

    // 1. Matroska / WebM (EBML header: 1A 45 DF A3)
    if (
      firstBlock[0] === 0x1a &&
      firstBlock[1] === 0x45 &&
      firstBlock[2] === 0xdf &&
      firstBlock[3] === 0xa3
    ) {
      const tracksIdx = findSequence(firstBlock, [0x16, 0x54, 0xae, 0x6b]);
      if (tracksIdx >= 0) {
        const clusterIdx = findSequence(firstBlock, [0x1f, 0x43, 0xb6, 0x75], tracksIdx + 4);
        const searchEnd = clusterIdx > tracksIdx ? clusterIdx : firstBlock.length;
        const tracksSlice = firstBlock.subarray(tracksIdx, searchEnd);

        const hasAudioCodec = bufferContainsAnyAscii(tracksSlice, [
          'A_AAC',
          'A_AC3',
          'A_EAC3',
          'A_DTS',
          'A_TRUEHD',
          'A_OPUS',
          'A_VORBIS',
          'A_MPEG/',
          'A_FLAC',
          'A_PCM',
          'A_ALAC',
          'A_MS/ACM',
        ]);
        if (hasAudioCodec) return true;

        // TrackType = 2 (Audio): EBML ID 0x83, size 0x81, value 0x02
        if (findSequence(tracksSlice, [0x83, 0x81, 0x02]) >= 0) {
          return true;
        }

        // If we reached Cluster or end of small file, Tracks is complete with 0 audio tracks
        if (clusterIdx > tracksIdx || docInfo.fileSize <= BLOCK_SIZE) {
          return false;
        }
      }
      return null;
    }

    // 2. MP4 / MOV / M4V (ftyp or moov box)
    const ftyp = firstBlock.toString('latin1', 4, 8);
    if (ftyp === 'ftyp' || firstBlock.indexOf('moov', 0, 'latin1') >= 0) {
      const headRes = checkMp4MoovHasAudio(firstBlock);
      if (headRes !== null) return headRes;

      // moov is likely at the end of the file — fetch last block
      if (docInfo.fileSize > BLOCK_SIZE) {
        const lastBlockIdx = Math.floor((docInfo.fileSize - 1) / BLOCK_SIZE);
        const lastBlock = await fetchBlock(client, docInfo.document, lastBlockIdx);
        const tailRes = checkMp4MoovHasAudio(lastBlock);
        if (tailRes !== null) return tailRes;

        if (lastBlockIdx > 1) {
          const prevLastBlock = await fetchBlock(client, docInfo.document, lastBlockIdx - 1);
          const combinedTail = Buffer.concat([prevLastBlock, lastBlock]);
          return checkMp4MoovHasAudio(combinedTail);
        }
      }
      return null;
    }

    // 3. AVI (RIFF....AVI )
    if (firstBlock.toString('latin1', 0, 4) === 'RIFF' && firstBlock.toString('latin1', 8, 12) === 'AVI ') {
      if (firstBlock.indexOf('auds', 0, 'latin1') >= 0) return true;
      if (firstBlock.indexOf('hdrl', 0, 'latin1') >= 0 && firstBlock.indexOf('vids', 0, 'latin1') >= 0) {
        return false;
      }
      return null;
    }

    return null;
  } catch {
    return null;
  }
}
