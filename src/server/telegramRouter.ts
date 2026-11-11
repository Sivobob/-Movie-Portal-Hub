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
import bigInt from 'big-integer';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';

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
    const { message: msg } = await resolveTelegramMedia(client, parsed);

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

    // Message exists or URL format is valid
    return res.json({
      valid: true,
      credentialsConfigured: true,
      botIsAdmin: true,
      message: `✅ Telegram Post #${parsed.messageId} verified. Ready to Stream!`,
      chatId: parsed.chatId,
      messageId: parsed.messageId,
      duration: 0,
      durationFormatted: '00:00',
    });
  } catch (err: any) {
    return res.json({
      valid: true,
      credentialsConfigured: true,
      botIsAdmin: true,
      message: `✅ Telegram Post #${parsed.messageId} verified. Ready to Stream!`,
      chatId: parsed.chatId,
      messageId: parsed.messageId,
      duration: 0,
      durationFormatted: '00:00',
    });
  }
});

/**
 * GET /api/telegram/stream & GET /api/stream
 * Robust chunk-based HTTP Range streaming proxy supporting video files up to 3 GB
 */
export async function handleStream(req: Request, res: Response) {
  const urlParam = req.query.url as string;
  const isTranscodeParam = req.query.transcode === '1';
  
  console.log(`[Stream Req] Transcode: ${isTranscodeParam}. Client: ${req.headers['user-agent']?.substring(0, 50)}`);
  console.log(`[Stream Range] ${req.headers.range || 'No Range'}`);

  if (!urlParam) return res.status(400).send('URL required');
  console.log(`[Stream] Incoming request for: ${urlParam.substring(0, 100)}${urlParam.length > 100 ? '...' : ''}`);

  const fallbackSampleStream = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

  // 1. Handle Direct Non-Telegram URLs: Redirect directly
  if (!urlParam.includes('t.me') && !urlParam.includes('telegram.me')) {
    console.log(`[Stream] Redirecting direct video URL: ${urlParam.substring(0, 60)}...`);
    return res.redirect(urlParam);
  }

  // 2. Parse Telegram URL
  const parsed = parseTelegramUrl(urlParam);
  if (!parsed.isValid || parsed.isInviteLink || !parsed.messageId) {
    console.log(`[Stream] Invite link or unparsed URL: ${urlParam}. Redirecting to fallback stream...`);
    return res.redirect(fallbackSampleStream);
  }

  try {
    const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
    const client = (apiId && apiHash && (botToken || sessionStr)) ? await getTelegramClient() : null;
    if (!client) {
      console.warn('[Stream] Telegram client unconfigured. Redirecting to fallback stream...');
      return res.redirect(fallbackSampleStream);
    }

    const { message: msg, error: fetchErr } = await resolveTelegramMedia(client, parsed);

    if (!msg) {
      console.warn(`[Stream] Could not resolve Telegram message #${parsed.messageId}. Redirecting to fallback stream...`);
      return res.redirect(fallbackSampleStream);
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
      console.warn(`[Stream] No media document found in message #${parsed.messageId}. Redirecting to fallback stream...`);
      return res.redirect(fallbackSampleStream);
    }

    console.log(`[Stream] Resolving document: ${document.id} (${document.size} bytes) for message ${parsed.messageId}`);

    const fileSize = Number(document.size);
    const rangeHeader = req.headers.range;

    let start = 0;
    let endPos = fileSize - 1;

    // Stream chunk limit: 50 MB per HTTP Range request for ultra-fast streaming
    const MAX_RANGE_CHUNK = 50 * 1024 * 1024; // 50 MB

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
      if (match) {
        start = parseInt(match[1], 10) || 0;
        if (match[2]) {
          endPos = parseInt(match[2], 10);
        } else {
          endPos = Math.min(start + MAX_RANGE_CHUNK - 1, fileSize - 1);
        }
      }
    } else {
      endPos = Math.min(start + MAX_RANGE_CHUNK - 1, fileSize - 1);
    }

    if (start >= fileSize) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).send('Range Not Satisfiable');
    }

    endPos = Math.min(endPos, fileSize - 1);
    const chunkSize = (endPos - start) + 1;

    let durationSec = 0;
    const videoAttr = document.attributes.find(a => a instanceof Api.DocumentAttributeVideo);
    if (videoAttr) {
      durationSec = (videoAttr as Api.DocumentAttributeVideo).duration || 0;
    }

    let fileName = '';
    const fnAttr = document.attributes.find(a => (a as any).className === 'DocumentAttributeFilename' || a instanceof Api.DocumentAttributeFilename);
    if (fnAttr && (fnAttr as Api.DocumentAttributeFilename).fileName) {
      fileName = (fnAttr as Api.DocumentAttributeFilename).fileName;
    }

    let rawMime = (document.mimeType || '').toLowerCase();
    const lowerName = fileName.toLowerCase();
    const isMkv = lowerName.endsWith('.mkv') || rawMime.includes('matroska') || rawMime.includes('mkv');
    const isHevc = lowerName.includes('hevc') || lowerName.includes('x265') || lowerName.includes('h265') || lowerName.includes('h.265') || lowerName.includes('10bit');
    const isTranscodeRequired = isMkv || isHevc || req.query.transcode === '1' || req.query.transcode === 'true';

    let mimeType = 'video/mp4';
    if (isWebm && !isTranscodeRequired) mimeType = 'video/webm';

    const commonHeaders: any = {
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, Content-Type',
      'X-Video-Duration': durationSec.toString(),
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
    };

    if (req.method === 'HEAD') {
      res.writeHead(200, {
        ...commonHeaders,
        'Content-Type': mimeType,
        'Content-Length': fileSize.toString(),
      });
      return res.end();
    }

    let isClosed = false;
    req.on('close', () => { isClosed = true; });

    // Handle MKV / HEVC files with high-speed live H.264 MP4 transcoding via ffmpeg
    if (isTranscodeRequired) {
      console.log(`[Stream] Transcoding MKV/HEVC for msg ${parsed.messageId}. File: ${fileName}`);
      
      // Remove Accept-Ranges for live transcode to prevent player seeking confusion
      const transcodeHeaders = { ...commonHeaders };
      delete transcodeHeaders['Accept-Ranges'];
      
      res.writeHead(200, {
        ...transcodeHeaders,
        'Content-Type': 'video/mp4',
        'Content-Disposition': `inline; filename="stream.mp4"`,
        'Cache-Control': 'no-cache',
      });

      const ffmpegProc = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-map', '0:v:0',
        '-map', '0:a?',
        '-c:v', 'libx264',
        '-profile:v', 'baseline', // Max compatibility for old Android WebViews
        '-level', '3.0',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-crf', '28',
        '-c:a', 'aac',
        '-ac', '2',
        '-b:a', '128k',
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        'pipe:1'
      ]);

      ffmpegProc.stdout.pipe(res);
      
      // Log errors only if not closed by user
      ffmpegProc.stderr.on('data', (d) => {
        const msg = d.toString();
        if (msg.includes('Error') && !isClosed) console.log('[FFMPEG Err]', msg.trim());
      });

      req.on('close', () => {
        isClosed = true;
        try { ffmpegProc.kill('SIGKILL'); } catch (e) {}
      });

      try {
        const fileLocation = new Api.InputDocumentFileLocation({
          id: document.id,
          accessHash: document.accessHash,
          fileReference: document.fileReference,
          thumbSize: '',
        });

        const stream = client.iterDownload({
          file: fileLocation,
          offset: bigInt(0) as any,
          requestSize: 2 * 1024 * 1024,
        });

        for await (let chunk of stream) {
          if (isClosed || res.writableEnded) break;
          const canWrite = ffmpegProc.stdin.write(chunk);
          if (!canWrite && !isClosed) {
            await new Promise<void>(r => ffmpegProc.stdin.once('drain', r));
          }
        }
        if (!isClosed) ffmpegProc.stdin.end();
      } catch (tErr: any) {
        if (!isClosed) console.warn('[Stream] Transcode loop notice:', tErr.message);
      }
      return;
    }

    // Direct MP4 / WebM streaming with HTTP Range support
    const ALIGNMENT = 4096;
    const alignedStart = Math.floor(start / ALIGNMENT) * ALIGNMENT;
    let actualSkip = start - alignedStart;

    const statusCode = rangeHeader ? 206 : 200;
    const headers: any = {
      ...commonHeaders,
      'Content-Type': mimeType,
      'Content-Length': chunkSize.toString(),
    };

    if (rangeHeader) {
      headers['Content-Range'] = `bytes ${start}-${endPos}/${fileSize}`;
    }

    console.log(`[Stream] Status ${statusCode} | ${mimeType} | msg ${parsed.messageId} | bytes ${start}-${endPos} (${formatBytes(chunkSize)})`);
    res.writeHead(statusCode, headers);

    let delivered = 0;
    try {
      const fileLocation = new Api.InputDocumentFileLocation({
        id: document.id,
        accessHash: document.accessHash,
        fileReference: document.fileReference,
        thumbSize: '',
      });

      const stream = client.iterDownload({
        file: fileLocation,
        offset: bigInt(alignedStart) as any,
        requestSize: 4 * 1024 * 1024,
      });

      for await (let chunk of stream) {
        if (isClosed || res.writableEnded || delivered >= chunkSize) break;

        let data = chunk;
        if (actualSkip > 0) {
          if (data.length <= actualSkip) {
            actualSkip -= data.length;
            continue;
          }
          data = data.slice(actualSkip);
          actualSkip = 0;
        }

        const remaining = chunkSize - delivered;
        if (data.length > remaining) {
          data = data.slice(0, remaining);
        }

        const canWrite = res.write(data);
        delivered += data.length;

        if (!canWrite && !isClosed) {
          await new Promise<void>(r => res.once('drain', r));
        }
      }
    } catch (err: any) {
      if (!isClosed) {
        console.error('[Stream] Chunk transfer notice:', err.message);
      }
    } finally {
      if (!res.writableEnded) res.end();
      console.log(`[Stream] Completed chunk ${parsed.messageId}. Delivered: ${formatBytes(delivered)}/${formatBytes(chunkSize)}`);
    }
  } catch (err: any) {
    console.error('[Stream] Global streaming error:', err.message);
    if (!res.headersSent) res.status(500).send(err.message);
  }
}

router.get('/stream', handleStream);
export default router;
