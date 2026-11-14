import { Request, Response } from 'express';
import { spawn } from 'child_process';
import { Api, TelegramClient } from 'telegram';
import bigInt from 'big-integer';

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
}

export interface SubtitleTrackInfo {
  id: number;
  streamIndex: number;
  codec: string;
  lang: string;
  label: string;
}

export interface ProbeMediaResult {
  durationSec: number;
  container: string;
  videoCodec: string;
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

  let dcId: number | undefined = resolvedDcMap.get(docIdStr) ?? doc.dcId;
  let sender = await client.getSender(dcId as any);

  const request = new Api.upload.GetFile({
    location,
    offset: bigInt(offsetBytes) as any,
    limit: BLOCK_SIZE,
  });

  let attempts = 0;
  while (attempts < 4) {
    attempts++;
    try {
      const result: any = await client.invokeWithSender(request, sender);
      if (result instanceof Api.upload.FileCdnRedirect) {
        throw new Error('CDN redirect not supported for GetFile');
      }
      if (dcId !== undefined) {
        resolvedDcMap.set(docIdStr, dcId);
      }
      return Buffer.isBuffer(result.bytes) ? result.bytes : Buffer.from(result.bytes);
    } catch (err: any) {
      const msg = String(err?.errorMessage || err?.message || '');
      if (err?.newDc) {
        dcId = Number(err.newDc);
        resolvedDcMap.set(docIdStr, dcId);
        sender = await client.getSender(dcId as any);
        continue;
      }
      const migrateMatch = msg.match(/FILE_MIGRATE_(\d+)/i);
      if (migrateMatch) {
        dcId = Number(migrateMatch[1]);
        resolvedDcMap.set(docIdStr, dcId);
        sender = await client.getSender(dcId as any);
        continue;
      }
      if (msg.includes('TIMEOUT') && attempts < 3) {
        await new Promise((r) => setTimeout(r, 400));
        sender = await client.getSender(dcId as any);
        continue;
      }
      const floodMatch = msg.match(/FLOOD_WAIT_(\d+)/i);
      if (floodMatch && Number(floodMatch[1]) <= 10 && attempts < 3) {
        await new Promise((r) => setTimeout(r, (Number(floodMatch[1]) + 1) * 1000));
        continue;
      }
      throw err;
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
  onFileRefExpired?: () => void
): Promise<void> {
  const firstBlock = Math.floor(start / BLOCK_SIZE);
  const lastBlock = Math.floor(endPos / BLOCK_SIZE);

  // Active prefetch queue keyed by blockIndex
  const blockPromises = new Map<number, Promise<Buffer>>();
  let nextToQueue = firstBlock;

  const queueAhead = (upToBlock: number) => {
    const cap = Math.min(lastBlock, upToBlock);
    while (nextToQueue <= cap && !isClosedFn()) {
      const idx = nextToQueue++;
      if (!blockPromises.has(idx)) {
        const p = fetchBlock(client, doc, idx);
        // Prevent unhandled rejection warnings if aborted before awaiting
        p.catch(() => {});
        blockPromises.set(idx, p);
      }
    }
  };

  // Start initial parallel batch immediately
  queueAhead(firstBlock + concurrency - 1);

  try {
    for (let blockIdx = firstBlock; blockIdx <= lastBlock; blockIdx++) {
      if (isClosedFn() || res.writableEnded) break;

      // Ensure pipeline stays full ahead of current block
      queueAhead(blockIdx + concurrency);

      const p = blockPromises.get(blockIdx) || fetchBlock(client, doc, blockIdx);
      const blockBuf = await p;
      blockPromises.delete(blockIdx);

      if (isClosedFn() || res.writableEnded) break;
      if (!blockBuf || blockBuf.length === 0) break;

      const blockFileStart = blockIdx * BLOCK_SIZE;
      const sliceStart = Math.max(0, start - blockFileStart);
      const sliceEnd = Math.min(blockBuf.length, endPos - blockFileStart + 1);

      if (sliceEnd > sliceStart) {
        const chunk = sliceStart === 0 && sliceEnd === blockBuf.length
          ? blockBuf
          : blockBuf.subarray(sliceStart, sliceEnd);

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

      if (blockBuf.length < BLOCK_SIZE) {
        // Reached EOF
        break;
      }
    }
  } catch (err: any) {
    if (String(err?.message || '').includes('FILE_REFERENCE')) {
      onFileRefExpired?.();
    }
    if (!isClosedFn()) {
      console.error('[StreamEngine] Range transfer error:', err?.message || err);
    }
  } finally {
    blockPromises.clear();
    if (!res.writableEnded) {
      res.end();
    }
  }
}

function formatLanguageLabel(langRaw?: string, titleRaw?: string, idx: number = 0): { lang: string; label: string } {
  const code = (langRaw || '').trim().toLowerCase();
  const title = (titleRaw || '').trim();
  const langMap: Record<string, string> = {
    hin: 'Hindi',
    hi: 'Hindi',
    hindi: 'Hindi',
    eng: 'English',
    en: 'English',
    english: 'English',
    tam: 'Tamil',
    ta: 'Tamil',
    tel: 'Telugu',
    te: 'Telugu',
    mal: 'Malayalam',
    ml: 'Malayalam',
    kan: 'Kannada',
    kn: 'Kannada',
    ben: 'Bengali',
    bn: 'Bengali',
    mar: 'Marathi',
    mr: 'Marathi',
    pun: 'Punjabi',
    pa: 'Punjabi',
    jpn: 'Japanese',
    ja: 'Japanese',
    kor: 'Korean',
    ko: 'Korean',
    spa: 'Spanish',
    es: 'Spanish',
    fre: 'French',
    fra: 'French',
    fr: 'French',
    und: '',
  };

  const prettyLang = langMap[code] || (code ? code.toUpperCase() : '');
  if (title && prettyLang && !title.toLowerCase().includes(prettyLang.toLowerCase())) {
    return { lang: prettyLang || 'Unknown', label: `${prettyLang} (${title})` };
  }
  if (title) {
    return { lang: prettyLang || title, label: title };
  }
  if (prettyLang) {
    return { lang: prettyLang, label: prettyLang };
  }
  return { lang: 'Audio', label: `Audio Track ${idx + 1}` };
}

function fallbackProbeFromMetadata(docInfo: TelegramDocInfo): ProbeMediaResult {
  const lowerName = docInfo.fileName.toLowerCase();
  const rawMime = docInfo.rawMime.toLowerCase();
  const isWebm = lowerName.endsWith('.webm') || rawMime.includes('webm');
  const isMkv = !isWebm && (lowerName.endsWith('.mkv') || rawMime.includes('matroska') || rawMime.includes('mkv'));
  const isAvi = lowerName.endsWith('.avi') || rawMime.includes('avi');
  const isHevc = /(^|[^a-z0-9])(hevc|x265|h\.?265|10bit|10-bit)([^a-z0-9]|$)/i.test(lowerName);

  const recommendedMode: 'direct' | 'remux' | 'transcode' = isHevc
    ? 'transcode'
    : (isMkv || isAvi)
      ? 'remux'
      : 'direct';

  return {
    durationSec: docInfo.durationSec || 0,
    container: isWebm ? 'webm' : isMkv ? 'matroska' : 'mp4',
    videoCodec: isHevc ? 'hevc' : 'h264',
    pixFmt: isHevc ? 'yuv420p10le' : 'yuv420p',
    is10Bit: isHevc,
    width: 0,
    height: 0,
    audioCodec: 'aac',
    audioTracks: [],
    subtitleTracks: [],
    recommendedMode,
    needsAudioTranscode: isMkv || isAvi,
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
  docInfo: TelegramDocInfo
): Promise<ProbeMediaResult> {
  const localRawUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(telegramUrl)}&raw=1`;

  return new Promise<ProbeMediaResult>((resolve) => {
    const args = [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      '-probesize', '1500000',
      '-analyzeduration', '1500000',
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
        console.warn('[Probe] ffprobe timed out, falling back to filename metadata');
        resolve(fallbackProbeFromMetadata(docInfo));
      }
    }, 7000);

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
        const durationSec =
          Number.isFinite(formatDuration) && formatDuration > 0
            ? Math.round(formatDuration)
            : docInfo.durationSec || 0;

        // Ignore attached cover art images (mjpeg/png with attached_pic = 1)
        const videoStream = streams.find(
          (s) => s.codec_type === 'video' && (!s.disposition || s.disposition.attached_pic !== 1)
        );
        const audioStreamObjs = streams.filter((s) => s.codec_type === 'audio');
        const subtitleStreamObjs = streams.filter((s) => s.codec_type === 'subtitle');

        const videoCodec = String(videoStream?.codec_name || '').toLowerCase();
        const pixFmt = String(videoStream?.pix_fmt || '').toLowerCase();
        const profile = String(videoStream?.profile || '').toLowerCase();
        const width = Number(videoStream?.width || 0);
        const height = Number(videoStream?.height || 0);

        const is10Bit =
          pixFmt.includes('10le') ||
          pixFmt.includes('10be') ||
          pixFmt.includes('12le') ||
          profile.includes('10');

        const audioTracks: AudioTrackInfo[] = audioStreamObjs.map((s, idx) => {
          const { lang, label } = formatLanguageLabel(s.tags?.language, s.tags?.title, idx);
          return {
            id: idx,
            streamIndex: Number(s.index ?? idx),
            codec: String(s.codec_name || '').toLowerCase(),
            channels: Number(s.channels || 2),
            lang,
            label,
          };
        });

        const subtitleTracks: SubtitleTrackInfo[] = subtitleStreamObjs.map((s, idx) => {
          const { lang, label } = formatLanguageLabel(s.tags?.language, s.tags?.title, idx);
          return {
            id: idx,
            streamIndex: Number(s.index ?? idx),
            codec: String(s.codec_name || '').toLowerCase(),
            lang,
            label,
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

        // Determine native browser / Android WebView compatibility
        const isBrowserSafeH264 =
          videoCodec === 'h264' &&
          !is10Bit &&
          (pixFmt === '' || pixFmt === 'yuv420p' || pixFmt === 'yuvj420p' || pixFmt === 'nv12');

        const isBrowserSafeWebmVideo =
          isWebm && (videoCodec === 'vp8' || videoCodec === 'vp9') && !is10Bit;

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
          // HEVC / H.265 / 10-bit H.264 / MPEG4 / etc. -> black screen on Chrome/WebView -> transcode!
          recommendedMode = 'transcode';
        } else if (!isMp4Container || !isBrowserSafeAudio) {
          // Video is clean H.264 8-bit, only container (MKV/AVI) or audio (AC3/EAC3/DTS) needs remux!
          recommendedMode = 'remux';
        } else {
          recommendedMode = 'direct';
        }

        resolve({
          durationSec,
          container,
          videoCodec,
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
        });
      } catch {
        resolve(fallbackProbeFromMetadata(docInfo));
      }
    });
  });
}
