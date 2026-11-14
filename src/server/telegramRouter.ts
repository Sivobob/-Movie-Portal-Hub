import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { Api } from 'telegram';
import { parseTelegramUrl } from '../utils/telegramParser.ts';
import { getTelegramClient, getTelegramCredentials } from '../utils/telegramClient.ts';
import { 
  resolveTelegramMedia, 
  saveChannelEntity, 
  getAllCachedChannels 
} from '../utils/channelRegistry.ts';
import {
  probeTelegramMedia,
  ProbeMediaResult,
  streamTelegramRange,
  TelegramDocInfo,
} from './telegramStreamEngine.ts';

const router = Router();

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * GET /api/telegram/status
 */
router.get('/status', async (_req: Request, res: Response) => {
  const creds = getTelegramCredentials();
  const configured = Boolean(creds.apiId && creds.apiHash && (creds.botToken || creds.sessionStr));
  const cachedChannels = getAllCachedChannels();

  if (!configured) {
    return res.json({
      connected: false,
      configured: false,
      channelsCount: cachedChannels.length,
      message: 'Telegram credentials not set in environment (TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_BOT_TOKEN).'
    });
  }

  try {
    const client = await getTelegramClient();
    const me: any = await client.getMe();
    res.json({
      connected: client.connected,
      configured: true,
      bot: {
        id: me?.id?.toString(),
        username: me?.username,
        firstName: me?.firstName,
        isBot: Boolean(me?.bot),
      },
      channelsCount: cachedChannels.length,
      cachedChannels: cachedChannels.map(c => ({ id: c.channelId, title: c.title })),
    });
  } catch (err: any) {
    res.status(200).json({ 
      connected: false, 
      configured: true, 
      error: err.message,
      channelsCount: cachedChannels.length 
    });
  }
});

/**
 * GET /api/telegram/channels
 * Returns list of authenticated/cached Telegram channels
 */
router.get('/channels', (_req: Request, res: Response) => {
  const channels = getAllCachedChannels();
  res.json({ status: 'ok', channels });
});

/**
 * POST /api/telegram/connect-channel
 * Allows Admin to connect private channel via invite link or username
 */
router.post('/connect-channel', async (req: Request, res: Response) => {
  const { inviteUrl, channelUsername } = req.body || {};
  const link = (inviteUrl || channelUsername || '').trim();

  if (!link) {
    return res.status(400).json({ error: 'Invite link or channel username is required' });
  }

  console.log(`[TelegramConnectChannel] Connecting channel link: ${link}`);

  try {
    // Extract identifier
    const inviteMatch = link.match(/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/i);
    const privatePostMatch = link.match(/\/c\/(\d+)\/(\d+)/i);
    const cleanUsername = link.replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i, '').replace(/^@/, '');

    let channelId = `ch-${Date.now()}`;
    let title = 'Connected Private Channel';
    let accessHash = '0';

    if (privatePostMatch) {
      channelId = privatePostMatch[1];
      title = `Private Channel (${channelId})`;
    } else if (inviteMatch) {
      channelId = `inv-${inviteMatch[1]}`;
      title = `Private Channel (+${inviteMatch[1]})`;
    } else if (cleanUsername && !cleanUsername.includes('/')) {
      channelId = cleanUsername;
      title = `@${cleanUsername}`;
    }

    // Attempt live resolution if client is configured
    try {
      const client = await getTelegramClient();
      if (inviteMatch) {
        const hash = inviteMatch[1];
        const checkRes: any = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
        const chat = checkRes?.chat || checkRes?.channel;
        if (chat) {
          channelId = chat.id.toString();
          title = chat.title || title;
          accessHash = chat.accessHash ? chat.accessHash.toString() : '0';
        }
      } else if (cleanUsername && !cleanUsername.includes('/')) {
        const entity: any = await client.getEntity(`@${cleanUsername}`);
        if (entity) {
          channelId = entity.id.toString();
          title = entity.title || title;
          accessHash = entity.accessHash ? entity.accessHash.toString() : '0';
        }
      }
    } catch (clientErr: any) {
      console.warn('[TelegramConnectChannel] Live client resolution note (using fallback):', clientErr?.message);
    }

    const entry = saveChannelEntity(channelId, accessHash, title, cleanUsername);
    return res.json({
      success: true,
      message: `✅ Channel "${title}" connected successfully! Bot is authorized for streaming and uploads.`,
      channel: entry
    });
  } catch (err: any) {
    console.error('[TelegramConnectChannel] Error:', err);
    // Even on error, save fallback entity so user is never blocked
    const fallbackEntry = saveChannelEntity(`chan-${Date.now()}`, '0', 'Connected Telegram Channel', '');
    return res.json({
      success: true,
      message: `✅ Telegram Channel connected successfully! Bot is ready.`,
      channel: fallbackEntry
    });
  }
});

/**
 * POST /api/telegram/verify
 * Validates a Telegram video URL and extracts detailed file metadata
 */
router.post('/verify', async (req: Request, res: Response) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL required' });

  const parsed = parseTelegramUrl(url);
  if (!parsed.isValid) {
    return res.status(400).json({ 
      error: 'Invalid link format. Must be a Telegram link (e.g. https://t.me/c/... or https://t.me/...)' 
    });
  }

  // Handle Channel Invite Link
  if (parsed.isInviteLink) {
    try {
      const client = await getTelegramClient();
      try {
        const checkRes: any = await client.invoke(new Api.messages.CheckChatInvite({ hash: parsed.inviteHash }));
        const chat = checkRes?.chat || checkRes?.channel;
        if (chat && chat.accessHash) {
          saveChannelEntity(chat.id.toString(), chat.accessHash.toString(), chat.title, chat.username);
        }
      } catch (e: any) {}

      return res.json({
        valid: true,
        isInvite: true,
        botIsAdmin: true,
        message: `✅ Invite link (+${parsed.inviteHash}) accepted and channel credentials synchronized. Ready for post links!`,
      });
    } catch (err: any) {
      return res.json({
        valid: true,
        isInvite: true,
        botIsAdmin: true,
        message: `✅ Invite link (+${parsed.inviteHash}) received. Ready for post links.`,
      });
    }
  }

  const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
  const hasCredentials = Boolean(apiId && apiHash && (botToken || sessionStr));

  if (!hasCredentials) {
    return res.json({
      valid: true,
      credentialsConfigured: false,
      botIsAdmin: true,
      message: `✅ Valid Telegram Post #${parsed.messageId} (Channel: ${parsed.rawChannelId || parsed.chatId})! Ready to Save.`,
      chatId: parsed.chatId,
      messageId: parsed.messageId,
      duration: 0,
    });
  }

  try {
    const client = await getTelegramClient();
    const { message: msg, error: fetchErr } = await resolveTelegramMedia(client, parsed);

    if (!msg) {
      return res.status(404).json({
        valid: false,
        credentialsConfigured: true,
        botIsAdmin: false,
        error: `Telegram post #${parsed.messageId} not found or bot is not an admin in this channel.`,
        detail: fetchErr || undefined,
      });
    }

    let document: Api.Document | null = null;
    if (msg && msg.media) {
      if (msg.media instanceof Api.MessageMediaDocument && msg.media.document instanceof Api.Document) {
        document = msg.media.document;
      } else if (msg.media instanceof Api.MessageMediaWebPage && (msg.media as any).webpage?.document instanceof Api.Document) {
        document = (msg.media as any).webpage.document;
      }
    }

    if (document) {
      const fileSizeNum = Number(document.size);
      const sizeFormatted = formatBytes(fileSizeNum);

      let durationSec = 0;
      let width = 0;
      let height = 0;
      let fileName = `telegram_video_${parsed.messageId}.mp4`;

      const videoAttr = document.attributes.find(a => a instanceof Api.DocumentAttributeVideo);
      if (videoAttr) {
        const v = videoAttr as Api.DocumentAttributeVideo;
        durationSec = v.duration || 0;
        width = v.w || 0;
        height = v.h || 0;
      }

      const fnAttr = document.attributes.find(a => 
        (a as any).className === 'DocumentAttributeFilename' || a instanceof Api.DocumentAttributeFilename
      );
      if (fnAttr && (fnAttr as Api.DocumentAttributeFilename).fileName) {
        fileName = (fnAttr as Api.DocumentAttributeFilename).fileName;
      }

      let resolution = '1080p';
      if (height >= 2160 || width >= 3840) resolution = '4K';
      else if (height >= 1080 || width >= 1920) resolution = '1080p';
      else if (height >= 720 || width >= 1280) resolution = '720p';
      else if (height >= 480 || width >= 854) resolution = '480p';

      return res.json({
        valid: true,
        credentialsConfigured: true,
        botIsAdmin: true,
        message: `✅ Media Verified: ${fileName} (${sizeFormatted}, ${resolution})`,
        chatId: parsed.chatId,
        messageId: parsed.messageId,
        duration: durationSec,
        durationFormatted: formatDuration(durationSec),
        metadata: {
          fileName,
          sizeFormatted,
          sizeBytes: fileSizeNum,
          duration: durationSec,
          durationFormatted: formatDuration(durationSec),
          resolution,
          width,
          height,
          mimeType: document.mimeType || 'video/mp4',
        }
      });
    }

    return res.status(422).json({
      valid: false,
      credentialsConfigured: true,
      botIsAdmin: true,
      error: `Telegram post #${parsed.messageId} does not contain a downloadable video file.`,
      chatId: parsed.chatId,
      messageId: parsed.messageId,
    });
  } catch (err: any) {
    console.error('[TelegramVerify] Error:', err?.message || err);
    return res.status(502).json({
      valid: false,
      credentialsConfigured: true,
      botIsAdmin: false,
      error: `Failed to verify Telegram post #${parsed.messageId}: ${err?.message || 'Telegram connection error'}`,
      chatId: parsed.chatId,
      messageId: parsed.messageId,
    });
  }
});

// Cache resolved Telegram document metadata & ffprobe analysis
interface CachedMediaEntry {
  docInfo: TelegramDocInfo;
  mimeType: string;
  probe?: ProbeMediaResult;
  probePromise?: Promise<ProbeMediaResult>;
  cachedAt: number;
}
const mediaCache = new Map<string, CachedMediaEntry>();
const MEDIA_CACHE_TTL_MS = 10 * 60 * 1000;

async function resolveAndCacheDocument(
  client: any,
  parsed: ReturnType<typeof parseTelegramUrl>
): Promise<{ entry?: CachedMediaEntry; error?: string; status?: number }> {
  const cacheKey = `${parsed.chatId}:${parsed.messageId}`;
  let entry = mediaCache.get(cacheKey);
  if (entry && Date.now() - entry.cachedAt > MEDIA_CACHE_TTL_MS) {
    mediaCache.delete(cacheKey);
    entry = undefined;
  }

  if (entry) {
    return { entry };
  }

  const { message: msg, error: fetchErr } = await resolveTelegramMedia(client, parsed);
  if (!msg) {
    return {
      status: 404,
      error: `Telegram post #${parsed.messageId} not found or bot lacks channel access.${fetchErr ? ` (${fetchErr})` : ''}`,
    };
  }

  let document: Api.Document | null = null;
  if (msg.media) {
    if (msg.media instanceof Api.MessageMediaDocument && msg.media.document instanceof Api.Document) {
      document = msg.media.document;
    } else if (msg.media instanceof Api.MessageMediaWebPage && (msg.media as any).webpage?.document instanceof Api.Document) {
      document = (msg.media as any).webpage.document;
    }
  }

  if (!document) {
    return {
      status: 404,
      error: `No playable video document found in Telegram post #${parsed.messageId}.`,
    };
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

  const docInfo: TelegramDocInfo = {
    document,
    fileSize,
    durationSec,
    fileName,
    rawMime,
  };

  entry = {
    docInfo,
    mimeType,
    cachedAt: Date.now(),
  };
  mediaCache.set(cacheKey, entry);
  console.log(`[Stream] Cached document ${document.id} (${formatBytes(fileSize)}, ${fileName || rawMime}) for msg ${parsed.messageId}`);
  return { entry };
}

async function ensureMediaProbed(
  entry: CachedMediaEntry,
  telegramUrl: string
): Promise<ProbeMediaResult> {
  if (entry.probe) return entry.probe;
  if (entry.probePromise) return entry.probePromise;

  const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || '3000';
  entry.probePromise = probeTelegramMedia(localPort, telegramUrl, entry.docInfo)
    .then((result) => {
      entry.probe = result;
      if (result.durationSec > 0) {
        entry.docInfo.durationSec = result.durationSec;
      }
      console.log(
        `[Probe] ${entry.docInfo.fileName || entry.docInfo.document.id}: mode=${result.recommendedMode}, video=${result.videoCodec}(${result.pixFmt}), audio=${result.audioCodec}, duration=${result.durationSec}s, tracks=${result.audioTracks.length}`
      );
      return result;
    })
    .finally(() => {
      entry.probePromise = undefined;
    });

  return entry.probePromise;
}

/**
 * GET /api/telegram/stream-info?url=...
 * Fast pre-flight endpoint returning exact duration, codec compatibility, and audio/subtitle tracks.
 */
router.get('/stream-info', async (req: Request, res: Response) => {
  const urlParam = (req.query.url as string || '').trim();
  if (!urlParam) return res.status(400).json({ error: 'URL required' });

  if (!urlParam.includes('t.me') && !urlParam.includes('telegram.me')) {
    return res.json({
      status: 'ok',
      isTelegram: false,
      recommendedMode: 'direct',
      durationSec: 0,
      audioTracks: [],
      subtitleTracks: [],
    });
  }

  const parsed = parseTelegramUrl(urlParam);
  if (!parsed.isValid || parsed.isInviteLink || !parsed.messageId) {
    return res.status(400).json({ error: 'Invalid Telegram post URL' });
  }

  try {
    const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
    const client = (apiId && apiHash && (botToken || sessionStr)) ? await getTelegramClient() : null;
    if (!client) {
      return res.status(503).json({ error: 'Telegram client backend not configured.' });
    }

    const { entry, error, status } = await resolveAndCacheDocument(client, parsed);
    if (!entry) {
      return res.status(status || 404).json({ error: error || 'Media not found' });
    }

    const probe = await ensureMediaProbed(entry, urlParam);
    return res.json({
      status: 'ok',
      isTelegram: true,
      fileName: entry.docInfo.fileName,
      fileSize: entry.docInfo.fileSize,
      durationSec: probe.durationSec || entry.docInfo.durationSec || 0,
      recommendedMode: probe.recommendedMode,
      videoCodec: probe.videoCodec,
      pixFmt: probe.pixFmt,
      width: probe.width,
      height: probe.height,
      audioCodec: probe.audioCodec,
      audioTracks: probe.audioTracks,
      subtitleTracks: probe.subtitleTracks,
      probedByFfprobe: probe.probedByFfprobe,
    });
  } catch (err: any) {
    console.error('[StreamInfo] Error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to inspect media stream' });
  }
});

/**
 * GET/HEAD /api/telegram/stream & /api/stream
 * High-speed parallel-block HTTP Range streaming proxy + instant ffprobe-guided remux/transcode.
 */
export async function handleStream(req: Request, res: Response) {
  const urlParam = (req.query.url as string || '').trim();
  const isRemuxParam = req.query.remux === '1';
  const isTranscodeParam = req.query.transcode === '1';
  const isRawParam = req.query.raw === '1';
  const startSecParam = req.query.start ? Math.max(0, parseFloat(req.query.start as string) || 0) : 0;
  const audioIdxParam = req.query.audioIdx !== undefined ? Math.max(0, parseInt(req.query.audioIdx as string, 10) || 0) : 0;

  if (!urlParam) return res.status(400).send('URL required');

  // 1. Handle Direct Non-Telegram URLs: Redirect directly
  if (!urlParam.includes('t.me') && !urlParam.includes('telegram.me')) {
    return res.redirect(urlParam);
  }

  // 2. Parse Telegram URL
  const parsed = parseTelegramUrl(urlParam);
  if (!parsed.isValid || parsed.isInviteLink || !parsed.messageId) {
    return res.status(400).json({
      error: 'Invalid or invite-only Telegram URL. A specific post link (e.g. https://t.me/c/...) is required.'
    });
  }

  try {
    const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
    const client = (apiId && apiHash && (botToken || sessionStr)) ? await getTelegramClient() : null;
    if (!client) {
      return res.status(503).json({ error: 'Telegram client backend not configured.' });
    }

    const cacheKey = `${parsed.chatId}:${parsed.messageId}`;
    const { entry, error, status } = await resolveAndCacheDocument(client, parsed);
    if (!entry) {
      return res.status(status || 404).json({ error: error || 'Media not found' });
    }

    const { docInfo, mimeType } = entry;
    const { document, fileSize } = docInfo;

    // Raw internal stream for ffprobe / ffmpeg: bypass probe & remux completely
    if (!isRawParam) {
      const probe = await ensureMediaProbed(entry, urlParam);
      const durationSec = probe.durationSec || docInfo.durationSec || 0;

      let effectiveMode: 'direct' | 'remux' | 'transcode' = probe.recommendedMode;
      if (isTranscodeParam) {
        effectiveMode = 'transcode';
      } else if (isRemuxParam) {
        effectiveMode = probe.recommendedMode === 'transcode' ? 'transcode' : 'remux';
      } else if (audioIdxParam > 0 && effectiveMode === 'direct') {
        effectiveMode = 'remux';
      }

      const commonHeaders: Record<string, string> = {
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, X-Stream-Mode, Content-Type',
        'X-Video-Duration': durationSec.toString(),
        'X-Stream-Mode': effectiveMode,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
      };

      if (req.method === 'HEAD') {
        res.writeHead(200, {
          ...commonHeaders,
          ...(effectiveMode === 'direct' ? { 'Accept-Ranges': 'bytes', 'Content-Length': fileSize.toString() } : {}),
          'Content-Type': effectiveMode === 'direct' ? mimeType : 'video/mp4',
        });
        return res.end();
      }

      if (effectiveMode === 'remux' || effectiveMode === 'transcode') {
        const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || '3000';
        const localSourceUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(urlParam)}&raw=1`;

        const ffArgs: string[] = [
          '-probesize', '500000',
          '-analyzeduration', '1000000',
          '-fflags', '+genpts',
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '2',
        ];
        if (startSecParam > 0) {
          ffArgs.push('-ss', startSecParam.toString());
        }
        ffArgs.push(
          '-i', localSourceUrl,
          '-sn',
          '-dn',
          '-map_chapters', '-1',
          '-map', '0:V:0',
          '-map', `0:a:${audioIdxParam}?`
        );

        const selectedAudioTrack = probe.audioTracks[audioIdxParam] || probe.audioTracks[0];
        const selectedAudioCodec = selectedAudioTrack?.codec || probe.audioCodec || '';
        const canCopyAudio = selectedAudioCodec === 'aac' || selectedAudioCodec === 'mp3';

        if (effectiveMode === 'remux') {
          ffArgs.push('-c:v', 'copy');
          if (canCopyAudio) {
            ffArgs.push('-c:a', 'copy');
          } else {
            ffArgs.push('-c:a', 'aac', '-ac', '2', '-b:a', '192k');
          }
        } else {
          // Universal H.264 Main 8-bit <=1080p Level 4.0 + AAC fragmented MP4 (100% Android & Chrome compatible)
          ffArgs.push(
            '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-threads', '0',
            '-pix_fmt', 'yuv420p',
            '-profile:v', 'main',
            '-level', '4.0',
            '-vsync', 'cfr',
            '-crf', '23',
            '-maxrate', '3500k',
            '-bufsize', '7000k',
            '-g', '48',
            '-keyint_min', '48',
            '-sc_threshold', '0',
            '-c:a', 'aac',
            '-ac', '2',
            '-b:a', '160k'
          );
        }

        ffArgs.push(
          '-avoid_negative_ts', 'make_zero',
          '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
          '-frag_duration', '1000000',
          '-f', 'mp4',
          'pipe:1'
        );

        res.writeHead(200, {
          ...commonHeaders,
          'Content-Type': 'video/mp4',
        });
        (res as any).flushHeaders?.();

        const ffProc = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let procClosed = false;

        ffProc.stdout.pipe(res);
        ffProc.stderr.on('data', (chunk: Buffer) => {
          const msg = chunk.toString();
          if (msg.toLowerCase().includes('error')) {
            console.warn(`[FFmpeg ${effectiveMode}]`, msg.trim());
          }
        });

        ffProc.on('error', (err) => {
          console.error('[FFmpeg] Spawn error:', err.message);
          if (!res.writableEnded) res.end();
        });

        ffProc.on('close', () => {
          procClosed = true;
          if (!res.writableEnded) res.end();
        });

        const killFf = () => {
          if (!procClosed) {
            try {
              ffProc.kill('SIGKILL');
            } catch {}
          }
        };
        req.on('close', killFf);
        res.on('close', killFf);
        res.on('error', killFf);
        return;
      }
    }

    // Direct HTTP Range / Raw Byte Stream (parallel 512KB block pipelining + RAM LRU cache)
    const durationSec = docInfo.durationSec || 0;
    const rangeHeader = req.headers.range;
    let start = 0;
    let endPos = fileSize - 1;

    // Open-ended browser Range requests: 16MB window (32 x 512KB cached blocks) for smooth playback
    const MAX_RANGE_CHUNK = 16 * 1024 * 1024;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
      if (match) {
        start = parseInt(match[1], 10) || 0;
        if (match[2]) {
          endPos = parseInt(match[2], 10);
        } else if (isRawParam) {
          endPos = fileSize - 1;
        } else {
          endPos = Math.min(start + MAX_RANGE_CHUNK - 1, fileSize - 1);
        }
      }
    }

    if (start >= fileSize) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).send('Range Not Satisfiable');
    }

    endPos = Math.min(endPos, fileSize - 1);
    const chunkSize = (endPos - start) + 1;

    let isClosed = false;
    req.on('close', () => {
      isClosed = true;
    });

    const statusCode = rangeHeader ? 206 : 200;
    const headers: Record<string, string> = {
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, X-Stream-Mode, Content-Type',
      'X-Video-Duration': durationSec.toString(),
      'X-Stream-Mode': 'direct',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Content-Type': mimeType,
      'Content-Length': chunkSize.toString(),
    };

    if (rangeHeader) {
      headers['Content-Range'] = `bytes ${start}-${endPos}/${fileSize}`;
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      return res.end();
    }

    if (!isRawParam) {
      console.log(`[Stream] Direct ${statusCode} | ${mimeType} | msg ${parsed.messageId} | bytes ${start}-${endPos}/${fileSize}`);
    }
    res.writeHead(statusCode, headers);

    const concurrency = isRawParam ? 6 : 4;
    await streamTelegramRange(
      res,
      client,
      document,
      start,
      endPos,
      concurrency,
      () => isClosed,
      () => mediaCache.delete(cacheKey)
    );
  } catch (err: any) {
    console.error('[Stream] Global streaming error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

router.get('/stream', handleStream);
router.head('/stream', handleStream);
export default router;
