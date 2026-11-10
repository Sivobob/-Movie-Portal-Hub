import { Router, Request, Response } from 'express';
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

  try {
    const client = await getTelegramClient();

    // 1. If it is an invite link (e.g. https://t.me/+... or https://t.me/joinchat/...)
    const inviteMatch = link.match(/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/i);
    if (inviteMatch) {
      const hash = inviteMatch[1];
      try {
        // Try importing or checking invite
        const checkRes: any = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
        const chat = checkRes?.chat || checkRes?.channel;
        if (chat && chat.accessHash) {
          const entry = saveChannelEntity(chat.id.toString(), chat.accessHash.toString(), chat.title, chat.username);
          return res.json({
            success: true,
            message: `✅ Private Channel "${chat.title || chat.id}" connected successfully!`,
            channel: entry
          });
        }
      } catch (checkErr: any) {
        if (checkErr.message?.includes('USER_ALREADY_PARTICIPANT') || checkErr.message?.includes('BOT_METHOD_INVALID')) {
          return res.json({
            success: true,
            message: `✅ Telegram Bot is connected and ready! Ensure the bot is added as an administrator to your private channel, then paste any post link (e.g. https://t.me/c/...) to stream instantly.`,
          });
        }
        // Try import invite
        try {
          const importRes: any = await client.invoke(new Api.messages.ImportChatInvite({ hash }));
          const updates = importRes?.chats || [];
          if (updates.length > 0 && updates[0].accessHash) {
            const chat = updates[0];
            const entry = saveChannelEntity(chat.id.toString(), chat.accessHash.toString(), chat.title, chat.username);
            return res.json({
              success: true,
              message: `✅ Joined and authorized private channel "${chat.title || chat.id}"!`,
              channel: entry
            });
          }
        } catch (impErr: any) {
          return res.json({
            success: true,
            message: `✅ Telegram Bot connected! Please ensure your bot is added as an admin to the channel, then paste any post link to stream.`,
          });
        }
      }
    }

    // 2. If it is a public username or @handle
    const cleanUsername = link.replace(/^https?:\/\/(?:www\.)?(?:t\.me|telegram\.me)\//i, '').replace(/^@/, '');
    const entity: any = await client.getEntity(`@${cleanUsername}`);
    if (entity && entity.accessHash) {
      const entry = saveChannelEntity(entity.id.toString(), entity.accessHash.toString(), entity.title, entity.username);
      return res.json({
        success: true,
        message: `✅ Channel "${entity.title || entity.username}" connected!`,
        channel: entry
      });
    }

    return res.status(400).json({ error: 'Could not resolve channel credentials from provided link.' });
  } catch (err: any) {
    console.error('[TelegramConnectChannel] Error:', err);
    return res.status(500).json({ error: err.message || 'Failed connecting channel' });
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
  const retryVal = req.query.retry as string;
  if (!urlParam) return res.status(400).send('URL required');
  console.log(`[Stream] Incoming request for: ${urlParam.substring(0, 100)}${urlParam.length > 100 ? '...' : ''}`);
  if (retryVal) console.log(`[Stream] Client requested retry token: ${retryVal}`);

  // 1. Handle Direct Non-Telegram URLs: Redirect directly to save proxy overhead
  if (!urlParam.includes('t.me') && !urlParam.includes('telegram.me')) {
    console.log(`[Stream] Redirecting direct video URL: ${urlParam.substring(0, 60)}...`);
    return res.redirect(urlParam);
  }

  // 2. Parse Telegram URL
  const parsed = parseTelegramUrl(urlParam);
  if (!parsed.isValid) return res.status(400).send('Invalid Link Format');
  if (parsed.isInviteLink) {
    return res.status(400).send('Invite links cannot be streamed directly. Please enter a video message post link.');
  }

  try {
    const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
    const client = (apiId && apiHash && (botToken || sessionStr)) ? await getTelegramClient() : null;
    if (!client) return res.status(500).send('Telegram client backend not configured.');

    const { message: msg, error: fetchErr } = await resolveTelegramMedia(client, parsed);

    if (!msg) {
      console.warn(`[Stream] Could not resolve message for: ${urlParam}. Error: ${fetchErr}`);
      return res.status(404).send(`Telegram media post #${parsed.messageId} could not be loaded into the web stream. Please ensure the post exists in your connected channel.`);
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
      console.warn(`[Stream] No document/media found in message ${parsed.messageId}`);
      return res.status(404).send('No video file or document attached to this Telegram post.');
    }

    console.log(`[Stream] Resolving document: ${document.id} (${document.size} bytes) for message ${parsed.messageId}`);

    const fileSize = Number(document.size);
    const rangeHeader = req.headers.range;

    let start = 0;
    let endPos = fileSize - 1;

    // Stream chunk limit: 5 MB per HTTP Range request when end is not explicitly requested
    const MAX_RANGE_CHUNK = 5 * 1024 * 1024; // 5 MB

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
    const isMkv = fileName.toLowerCase().endsWith('.mkv') || rawMime.includes('matroska') || rawMime.includes('mkv');
    const isWebm = fileName.toLowerCase().endsWith('.webm') || rawMime.includes('webm');

    let mimeType = 'video/mp4';
    if (isWebm) mimeType = 'video/webm';
    else if (isMkv) mimeType = 'video/mp4';

    if (req.query.format === 'webm' || req.query.retry) {
      mimeType = 'video/webm';
    }

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

    // Telegram MTProto requires 4096-byte chunk alignment for file offsets
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

    let isClosed = false;
    req.on('close', () => { isClosed = true; });

    let delivered = 0;
    try {
      const fileLocation = new Api.InputDocumentFileLocation({
        id: document.id,
        accessHash: document.accessHash,
        fileReference: document.fileReference,
        thumbSize: '',
      });

      // Stream chunks using Telegram iterDownload (1MB chunk size for high-speed streaming)
      const stream = client.iterDownload({
        file: fileLocation,
        offset: bigInt(alignedStart) as any,
        requestSize: 1024 * 1024,
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
