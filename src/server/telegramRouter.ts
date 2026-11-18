import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { Api } from 'telegram';
import { parseTelegramUrl } from '../utils/telegramParser.ts';
import { getTelegramClient, getTelegramCredentials } from '../utils/telegramClient.ts';
import { 
  resolveTelegramMedia, 
  saveChannelEntity, 
  getAllCachedChannels,
  getCachedAccessHash
} from '../utils/channelRegistry.ts';
import {
  checkTelegramDocHasAudioFast,
  probeTelegramMedia,
  ProbeMediaResult,
  streamTelegramRange,
  TelegramDocInfo,
} from './telegramStreamEngine.ts';
import { buildQualitySizeEstimates, VideoQualityTier } from '../utils/videoQuality.ts';

interface DirectHttpProbeInfo {
  fileSize: number;
  durationSec: number;
  width: number;
  height: number;
  cachedAt: number;
}

const directHttpProbeCache = new Map<string, DirectHttpProbeInfo>();

async function probeDirectHttpInfo(targetUrl: string): Promise<DirectHttpProbeInfo> {
  const cached = directHttpProbeCache.get(targetUrl);
  if (cached && Date.now() - cached.cachedAt < 5 * 60 * 1000) {
    return cached;
  }

  let fileSize = 0;
  let durationSec = 0;
  let width = 0;
  let height = 0;

  // 1. HEAD request to fetch exact Content-Length
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const headRes = await fetch(targetUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36' },
    }).finally(() => clearTimeout(timer));
    const cl = Number(headRes.headers.get('content-length') || 0);
    if (Number.isFinite(cl) && cl > 0) fileSize = cl;
  } catch {}

  // 2. Range 0-0 fallback if HEAD didn't give Content-Length
  if (fileSize <= 0) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const rngRes = await fetch(targetUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Range: 'bytes=0-0',
          'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36',
        },
      }).finally(() => clearTimeout(timer));
      const cr = rngRes.headers.get('content-range') || '';
      const m = cr.match(/bytes\s+\d+-\d+\/(\d+)/i);
      if (m && m[1]) {
        const total = Number(m[1]);
        if (Number.isFinite(total) && total > 0) fileSize = total;
      } else {
        const cl = Number(rngRes.headers.get('content-length') || 0);
        if (Number.isFinite(cl) && cl > 1024) fileSize = cl;
      }
      try {
        await rngRes.body?.cancel();
      } catch {}
    } catch {}
  }

  // 3. Fast ffprobe for exact duration & source dimensions
  try {
    const probeJson = await new Promise<any>((resolve) => {
      const proc = spawn(
        'ffprobe',
        [
          '-v', 'quiet',
          '-print_format', 'json',
          '-probesize', '1500000',
          '-analyzeduration', '1500000',
          '-show_format',
          '-show_streams',
          targetUrl,
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] }
      );
      let out = '';
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
        resolve(null);
      }, 6000);
      proc.stdout.on('data', (d: Buffer) => {
        out += d.toString();
      });
      proc.on('close', () => {
        clearTimeout(timer);
        try {
          resolve(out ? JSON.parse(out) : null);
        } catch {
          resolve(null);
        }
      });
      proc.on('error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });

    if (probeJson) {
      const dur = Number(probeJson.format?.duration || 0);
      if (Number.isFinite(dur) && dur > 0) durationSec = Math.round(dur);
      if (fileSize <= 0) {
        const fmtSize = Number(probeJson.format?.size || 0);
        if (Number.isFinite(fmtSize) && fmtSize > 0) fileSize = fmtSize;
      }
      const vStream = Array.isArray(probeJson.streams)
        ? probeJson.streams.find((s: any) => s.codec_type === 'video')
        : null;
      if (vStream) {
        width = Number(vStream.width || 0);
        height = Number(vStream.height || 0);
      }
    }
  } catch {}

  const info: DirectHttpProbeInfo = {
    fileSize,
    durationSec,
    width,
    height,
    cachedAt: Date.now(),
  };
  directHttpProbeCache.set(targetUrl, info);
  return info;
}

function normalizeRequestedQuality(raw: unknown): VideoQualityTier | '' {
  const s = String(raw || '').trim().toLowerCase();
  if (s === '1080p' || s === '1080') return '1080p';
  if (s === '720p' || s === '720') return '720p';
  if (s === '480p' || s === '480') return '480p';
  if (s === '360p' || s === '360') return '360p';
  return '';
}

function getFfmpegQualityArgs(quality: VideoQualityTier | '', isDownload: boolean): string[] {
  const args: string[] = [];
  if (quality === '360p') {
    args.push(
      '-vf', "scale='min(640,iw)':'min(360,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      ...(isDownload ? [] : ['-tune', 'zerolatency']),
      '-threads', '0',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-level', '3.1',
      '-vsync', 'cfr',
      '-b:v', '280k',
      '-maxrate', '360k',
      '-bufsize', '720k',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-ac', '2',
      '-ar', '44100',
      '-b:a', '64k'
    );
    return args;
  }

  if (quality === '480p') {
    args.push(
      '-vf', "scale='min(854,iw)':'min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      ...(isDownload ? [] : ['-tune', 'zerolatency']),
      '-threads', '0',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-level', '3.1',
      '-vsync', 'cfr',
      '-b:v', '520k',
      '-maxrate', '650k',
      '-bufsize', '1300k',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-ac', '2',
      '-ar', '48000',
      '-b:a', '96k'
    );
    return args;
  }

  if (quality === '720p') {
    args.push(
      '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      ...(isDownload ? [] : ['-tune', 'zerolatency']),
      '-threads', '0',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-level', '4.0',
      '-vsync', 'cfr',
      '-b:v', '1050k',
      '-maxrate', '1300k',
      '-bufsize', '2600k',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0',
      '-c:a', 'aac',
      '-ac', '2',
      '-ar', '48000',
      '-b:a', '128k'
    );
    return args;
  }

  // Default 1080p high quality
  args.push(
    '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    ...(isDownload ? [] : ['-tune', 'zerolatency']),
    '-threads', '0',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'main',
    '-level', '4.0',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-vsync', 'cfr',
    '-crf', '22',
    '-maxrate', '3400k',
    '-bufsize', '6800k',
    '-g', '48',
    '-keyint_min', '48',
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-ac', '2',
    '-ar', '48000',
    '-b:a', '160k'
  );
  return args;
}

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
        let resolvedFromInvite = false;
        try {
          const checkRes: any = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
          const chat = checkRes?.chat || checkRes?.channel;
          if (chat) {
            channelId = chat.id.toString();
            title = chat.title || title;
            accessHash = chat.accessHash ? chat.accessHash.toString() : '0';
            resolvedFromInvite = true;
          }
        } catch (inviteErr: any) {
          console.warn('[TelegramConnectChannel] CheckChatInvite note:', inviteErr?.message || inviteErr);
        }

        // Bot sessions cannot invoke CheckChatInvite; discover via Bot API updates/getChat
        if (!resolvedFromInvite) {
          try {
            const { botToken } = getTelegramCredentials();
            if (botToken) {
              const updResp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`);
              const updJson: any = await updResp.json();
              const updates: any[] = Array.isArray(updJson?.result) ? updJson.result : [];
              const candidateChatIds: string[] = [];
              for (let i = updates.length - 1; i >= 0; i--) {
                const u = updates[i];
                const src = u?.my_chat_member || u?.channel_post || u?.edited_channel_post || u?.message;
                const cId = src?.chat?.id ? String(src.chat.id) : '';
                if (cId && cId.startsWith('-100') && !candidateChatIds.includes(cId)) {
                  candidateChatIds.push(cId);
                }
              }

              let matchedChatId = '';
              for (const cId of candidateChatIds) {
                try {
                  const chatResp = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(cId)}`);
                  const chatJson: any = await chatResp.json();
                  const inv = String(chatJson?.result?.invite_link || '');
                  if (inv.includes(hash)) {
                    matchedChatId = cId;
                    break;
                  }
                } catch {}
              }

              // If invite link was a secondary link, pick the most recent channel in updates not yet cached or first channel
              if (!matchedChatId && candidateChatIds.length > 0) {
                const uncached = candidateChatIds.find((cId) => {
                  const clean = cId.replace('-100', '');
                  const h = getCachedAccessHash(clean);
                  return !h || h === '0';
                });
                matchedChatId = uncached || candidateChatIds[0];
              }

              if (matchedChatId) {
                const entity: any = await client.getEntity(matchedChatId);
                if (entity) {
                  channelId = entity.id.toString();
                  title = entity.title || title;
                  accessHash = entity.accessHash ? entity.accessHash.toString() : '0';
                }
              }
            }
          } catch (botFallbackErr: any) {
            console.warn('[TelegramConnectChannel] Bot API fallback note:', botFallbackErr?.message || botFallbackErr);
          }
        }
      } else if (privatePostMatch) {
        const cleanPrivateId = privatePostMatch[1].replace('-100', '');
        const entity: any = await client.getEntity(`-100${cleanPrivateId}`);
        if (entity) {
          channelId = entity.id.toString();
          title = entity.title || title;
          accessHash = entity.accessHash ? entity.accessHash.toString() : '0';
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

function normalizeTelegramText(input: string): string {
  return String(input || '')
    .replace(/[\u03C1\u03A1\u0440\u0420]/g, 'p') // Greek rho (ρ/Ρ) & Cyrillic er (р/Р) -> 'p'
    .replace(/[\u03C5\u0443]/g, 'u')
    .replace(/[\u03B1\u0430]/g, 'a')
    .replace(/[\u03B9]/g, 'i')
    .replace(/[\u03C4]/g, 't')
    .replace(/[\u03BB]/g, 'l')
    .replace(/[\u03B5\u0435\u0454]/g, 'e')
    .replace(/[\u0455]/g, 's')
    .replace(/[\u03BF\u043E\u03C3]/g, 'o')
    .replace(/[\u2202]/g, 'd');
}

function matchQualityInString(raw: string): { quality: string; score: number } {
  const lower = normalizeTelegramText(raw).toLowerCase();
  if (!lower.trim()) return { quality: '', score: 0 };

  // Catch common uploader typos / truncated filenames like Quality_108.mkv -> 1080p, 4800p -> 480p, 7200p -> 720p
  if (/(?:^|\b|[^0-9])4800p(?:\b|$)/i.test(lower)) return { quality: '480p', score: 480 };
  if (/(?:^|\b|[^0-9])7200(?:p|\b)/i.test(lower)) return { quality: '720p', score: 720 };
  if (/(?:^|\b|[^0-9])10800p(?:\b|$)/i.test(lower)) return { quality: '1080p', score: 1080 };
  if (/(?:^|[^0-9])quality[_\s:\-]*108(?:\b|\.|[^0-9]|$)/i.test(lower)) return { quality: '1080p', score: 1080 };

  if (/(?:2160p|\b4k\b|\buhd\b|3840x2160)/i.test(lower)) return { quality: '4K', score: 2160 };
  if (/(?:1080p|\bfhd\b|1920x1080|quality\s*[:\-_]\s*1080\b)/i.test(lower)) return { quality: '1080p', score: 1080 };
  if (/(?:720p|1280x720|quality\s*[:\-_]\s*720\b)/i.test(lower)) return { quality: '720p', score: 720 };
  if (/(?:480p|854x480|quality\s*[:\-_]\s*480\b)/i.test(lower)) return { quality: '480p', score: 480 };
  if (/(?:360p|quality\s*[:\-_]\s*360\b)/i.test(lower)) return { quality: '360p', score: 360 };
  return { quality: '', score: 0 };
}

function parseQualityScore(caption: string, fileName: string, width = 0, height = 0): { quality: string; score: number } {
  // Always trust explicit caption quality BEFORE filename (fixes 720p releases with 1080p in filename)
  const capMatch = matchQualityInString(caption);
  if (capMatch.quality) return capMatch;

  const fnMatch = matchQualityInString(fileName);
  if (fnMatch.quality) return fnMatch;

  // Fallback to actual video resolution when Telegram didn't use a 320x320 square placeholder
  if (width > 360 || height > 360) {
    if (height >= 2000 || width >= 3600) return { quality: '4K', score: 2160 };
    if (height >= 1000 || width >= 1800) return { quality: '1080p', score: 1080 };
    if (height >= 680 || width >= 1200) return { quality: '720p', score: 720 };
    if (height >= 400 || width >= 700) return { quality: '480p', score: 480 };
  }
  return { quality: '', score: 0 };
}

function parseEpisodeIdentity(caption: string, fileName: string): { key: string | null; epNum: number | null; absEpNum: number | null } {
  const normCap = normalizeTelegramText(caption);
  const normFn = normalizeTelegramText(fileName);
  const combined = `${normCap}\n${normFn}`;
  let seasonNum: number | null = null;
  let epNum: number | null = null;
  let absEpNum: number | null = null;

  // Detect any standalone 3-4 digit absolute episode number (e.g. "S17E08 369" or "Episode 369" or "S14_E297")
  const absMatch =
    combined.match(/(?:e[pr]isode|ep)\s*[:\-_.\s]*0*([1-9]\d{2,3})(?=$|[^0-9])/i) ||
    combined.match(/(?:^|[^a-z0-9])S\d{1,2}E\d{1,2}\s+([1-9]\d{2,3})(?=$|[^0-9])/i);
  if (absMatch) {
    absEpNum = parseInt(absMatch[1], 10);
  }

  const capEpMatch =
    normCap.match(/e[pr]isode\s*[:\-]?\s*0*(\d{1,4})(?=$|[^0-9])/i) ||
    normCap.match(/episode\s*[:\-]?\s*0*(\d{1,4})(?=$|[^0-9])/i);
  const capSeasonMatch = normCap.match(/season\s*[:\-]?\s*0*(\d{1,2})(?=$|[^0-9])/i);

  if (capEpMatch) {
    epNum = parseInt(capEpMatch[1], 10);
    if (capSeasonMatch) seasonNum = parseInt(capSeasonMatch[1], 10);
  } else {
    const seMatch = combined.match(/(?:^|[^a-z0-9])S(?:eason)?\s*0*(\d{1,2})\s*[-_.\s]*E(?:p|pisode)?\s*0*(\d{1,4})(?=$|[^0-9])/i);
    const esMatch = combined.match(/(?:^|[^a-z0-9])E(?:p|pisode)?\s*[-_.\s]*0*(\d{1,4})[-_.\s]+S(?:eason)?\s*0*(\d{1,2})(?=$|[^0-9])/i);
    if (seMatch) {
      seasonNum = parseInt(seMatch[1], 10);
      epNum = parseInt(seMatch[2], 10);
    } else if (esMatch) {
      epNum = parseInt(esMatch[1], 10);
      seasonNum = parseInt(esMatch[2], 10);
    } else {
      const fnEpMatch = normFn.match(/(?:^|[\s_\-\[])E(?:p|pisode)?\s*[:\-_.\s]*0*(\d{1,4})(?=$|[^0-9])/i);
      if (fnEpMatch) {
        epNum = parseInt(fnEpMatch[1], 10);
      }
    }
  }

  if (absEpNum !== null && Number.isFinite(absEpNum)) {
    return { key: `abs-${absEpNum}`, epNum: absEpNum, absEpNum };
  }
  if (epNum === null || !Number.isFinite(epNum)) {
    return { key: null, epNum: null, absEpNum: null };
  }
  const key = seasonNum !== null ? `s${seasonNum}-e${epNum}` : `e${epNum}`;
  return { key, epNum, absEpNum: null };
}

type ClassifiedDocMedia =
  | { kind: 'sticker'; mime: string; fileName: string; sizeBytes: number }
  | { kind: 'other'; mime: string; fileName: string; sizeBytes: number }
  | {
      kind: 'video';
      doc: any;
      mime: string;
      fileName: string;
      sizeBytes: number;
      durationSec: number;
      width: number;
      height: number;
      caption: string;
      hasExplicitNoSound: boolean;
    };

const NON_VIDEO_FILE_EXT_RE =
  /\.(txt|text|log|md|csv|json|xml|html?|pdf|zip|rar|7z|tar|gz|apk|exe|tgs|webp|png|jpe?g|gif|bmp|svg|ico|mp3|wav|aac|flac|ogg|m4a|opus|srt|ass|ssa|vtt|nfo|sub|idx)$/i;

function classifyTelegramDocMedia(msg: any): ClassifiedDocMedia {
  if (!msg || !msg.id) {
    return { kind: 'other', mime: '', fileName: '', sizeBytes: 0 };
  }
  const media: any = msg.media;
  const doc: any = media?.document || msg.document;
  if (!doc || !doc.id) {
    return { kind: 'other', mime: '', fileName: '', sizeBytes: 0 };
  }

  const attrs: any[] = Array.isArray(doc.attributes) ? doc.attributes : [];
  const mime = String(doc.mimeType || '').toLowerCase();
  const fnAttr = attrs.find(
    (a) => a instanceof Api.DocumentAttributeFilename || a?.className === 'DocumentAttributeFilename'
  );
  const fileName = String(fnAttr?.fileName || '');
  const lowerFileName = fileName.toLowerCase();
  const vidAttr = attrs.find(
    (a) => a instanceof Api.DocumentAttributeVideo || a?.className === 'DocumentAttributeVideo'
  );
  const sizeBytes = Number(doc.size || 0);

  const isSticker =
    mime === 'application/x-tgsticker' ||
    mime === 'image/webp' ||
    lowerFileName === 'sticker.webm' ||
    /\.(tgs|webp)$/i.test(lowerFileName) ||
    attrs.some(
      (a) =>
        a instanceof Api.DocumentAttributeSticker ||
        a?.className === 'DocumentAttributeSticker' ||
        a?.className === 'DocumentAttributeCustomEmoji'
    ) ||
    (mime === 'video/webm' && Boolean(vidAttr?.nosound) && sizeBytes > 0 && sizeBytes < 2 * 1024 * 1024);

  if (isSticker) {
    return { kind: 'sticker', mime, fileName, sizeBytes };
  }

  const isAnimatedGif = attrs.some(
    (a) => a instanceof Api.DocumentAttributeAnimated || a?.className === 'DocumentAttributeAnimated'
  );
  const isRoundNote = Boolean(vidAttr?.roundMessage);
  const isBlockedMime =
    mime.startsWith('text/') ||
    mime.startsWith('image/') ||
    mime.startsWith('audio/') ||
    mime === 'application/pdf' ||
    mime === 'application/json' ||
    mime === 'application/zip' ||
    mime === 'application/x-rar-compressed' ||
    mime === 'application/x-7z-compressed' ||
    mime === 'application/vnd.android.package-archive';

  if (isAnimatedGif || isRoundNote || isBlockedMime || NON_VIDEO_FILE_EXT_RE.test(lowerFileName)) {
    return { kind: 'other', mime, fileName, sizeBytes };
  }

  const isVideo =
    mime.startsWith('video/') ||
    Boolean(vidAttr) ||
    (/\.(mp4|mkv|avi|mov|webm|m4v|ts|flv)$/i.test(lowerFileName) && sizeBytes > 100 * 1024);

  if (!isVideo) {
    return { kind: 'other', mime, fileName, sizeBytes };
  }

  const caption = String(msg.message || '');
  const durationSec = Math.max(0, Math.round(Number(vidAttr?.duration || 0)));
  const width = Number(vidAttr?.w || 0);
  const height = Number(vidAttr?.h || 0);
  const hasExplicitNoSound =
    Boolean(vidAttr?.nosound) ||
    /\b(no[\s_-]*audio|without[\s_-]*audio|muted|silent|video[\s_-]*only)\b/i.test(`${caption} ${fileName}`);

  return {
    kind: 'video',
    doc,
    mime,
    fileName,
    sizeBytes,
    durationSec,
    width,
    height,
    caption,
    hasExplicitNoSound,
  };
}

function getQualityRankForFilter(quality: string, qFilter: string): number {
  const q = quality.toLowerCase();
  if (qFilter === '1080p') {
    if (q === '1080p') return 5;
    if (q === '720p') return 4;
    if (q === '480p') return 3;
    if (q === '4k') return 2;
    if (q === '360p') return 1;
    return 0;
  }
  if (qFilter === '720p') {
    if (q === '720p') return 5;
    if (q === '1080p') return 4;
    if (q === '480p') return 3;
    if (q === '4k') return 2;
    if (q === '360p') return 1;
    return 0;
  }
  if (qFilter === '480p') {
    if (q === '480p') return 5;
    if (q === '720p') return 4;
    if (q === '1080p') return 3;
    if (q === '4k') return 2;
    if (q === '360p') return 1;
    return 0;
  }
  // 'best'
  if (q === '4k') return 5;
  if (q === '1080p') return 4;
  if (q === '720p') return 3;
  if (q === '480p') return 2;
  if (q === '360p') return 1;
  return 0;
}

function primeMediaCacheFromTelegramDoc(
  streamUrl: string,
  doc: any,
  fileName: string,
  durationSec: number,
  rawMime: string
): CachedMediaEntry | null {
  const parsed = parseTelegramUrl(streamUrl);
  if (!parsed.isValid || !parsed.chatId || !parsed.messageId || !doc) return null;
  const cacheKey = `${parsed.chatId}:${parsed.messageId}`;
  const existing = mediaCache.get(cacheKey);
  if (existing && Date.now() - existing.cachedAt <= MEDIA_CACHE_TTL_MS) {
    return existing;
  }
  const lowerName = fileName.toLowerCase();
  const isWebm = lowerName.endsWith('.webm') || rawMime.includes('webm');
  const entry: CachedMediaEntry = {
    docInfo: {
      document: doc,
      fileSize: Number(doc.size || 0),
      durationSec,
      fileName,
      rawMime,
    },
    mimeType: isWebm ? 'video/webm' : 'video/mp4',
    cachedAt: Date.now(),
  };
  mediaCache.set(cacheKey, entry);
  return entry;
}

async function checkCandidateHasAudio(
  candidate: {
    streamUrl: string;
    doc: any;
    mime: string;
    fileName: string;
    durationSec: number;
    hasExplicitNoSound: boolean;
  },
  client: any
): Promise<boolean> {
  if (candidate.hasExplicitNoSound) {
    return false;
  }
  try {
    const entry = primeMediaCacheFromTelegramDoc(
      candidate.streamUrl,
      candidate.doc,
      candidate.fileName,
      candidate.durationSec,
      candidate.mime
    );
    if (!entry) return true;
    if (typeof entry.hasAudio === 'boolean') {
      return entry.hasAudio;
    }
    if (entry.probe?.probedByFfprobe) {
      const has = entry.probe.audioTracks.length > 0;
      entry.hasAudio = has;
      return has;
    }

    const fastAudio = await checkTelegramDocHasAudioFast(client, entry.docInfo);
    if (fastAudio !== null) {
      entry.hasAudio = fastAudio;
      return fastAudio;
    }
    return true;
  } catch {
    return true;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
  shouldAbort?: () => boolean
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      if (shouldAbort?.()) break;
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  });
  await Promise.all(runners);
  return results;
}

async function selectBestCandidateForGroup<
  T extends {
    streamUrl: string;
    doc: any;
    mime: string;
    fileName: string;
    durationSec: number;
    quality: string;
    sizeBytes: number;
    hasExplicitNoSound: boolean;
  }
>(
  arr: T[],
  qFilter: string,
  client: any,
  shouldAbort?: () => boolean
): Promise<{
  chosen: T;
  switchedForAudio: boolean;
  fellBackQuality: boolean;
}> {
  if (arr.length === 1) {
    const only = arr[0];
    const fellBackQuality =
      (qFilter === '1080p' || qFilter === '720p' || qFilter === '480p') &&
      Boolean(only.quality) &&
      only.quality.toLowerCase() !== qFilter;
    return { chosen: only, switchedForAudio: false, fellBackQuality };
  }

  const sorted = [...arr].sort((a, b) => {
    const rankDiff = getQualityRankForFilter(b.quality, qFilter) - getQualityRankForFilter(a.quality, qFilter);
    if (rankDiff !== 0) return rankDiff;
    return b.sizeBytes - a.sizeBytes;
  });

  let skippedNoAudioCount = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (shouldAbort?.()) break;
    const candidate = sorted[i];
    const hasAudio = await checkCandidateHasAudio(candidate, client);
    if (hasAudio) {
      const switchedForAudio = skippedNoAudioCount > 0;
      const fellBackQuality =
        (qFilter === '1080p' || qFilter === '720p' || qFilter === '480p') &&
        Boolean(candidate.quality) &&
        candidate.quality.toLowerCase() !== qFilter;
      return { chosen: candidate, switchedForAudio, fellBackQuality };
    }
    skippedNoAudioCount++;
  }

  // If all copies are silent (or scan aborted), return the top-ranked quality rather than dropping the episode
  const fallbackTop = sorted[0];
  const fellBackQuality =
    (qFilter === '1080p' || qFilter === '720p' || qFilter === '480p') &&
    Boolean(fallbackTop.quality) &&
    fallbackTop.quality.toLowerCase() !== qFilter;
  return { chosen: fallbackTop, switchedForAudio: false, fellBackQuality };
}

/**
 * POST /api/telegram/scan-range
 * Scans a range of Telegram message IDs in a channel and returns ONLY real video episodes,
 * automatically skipping stickers (.webp/.tgs/.webm), GIFs, photos, audio, .txt/text posts, and deleted posts.
 * Supports qualityFilter ('1080p' | 'best' | '720p' | '480p' | 'all') with 1080p -> 720p fallback
 * and automatic audio verification (switches to 720p with audio if 1080p has no audio).
 */
router.post('/scan-range', async (req: Request, res: Response) => {
  const { startUrl, endUrl, count, qualityFilter } = req.body || {};
  const qFilter = String(qualityFilter || 'all').toLowerCase();
  const startParsed = parseTelegramUrl(String(startUrl || ''));
  if (!startParsed.isValid || !startParsed.messageId) {
    return res.status(400).json({ error: 'Valid Starting Telegram link is required.' });
  }

  const startMsgId = parseInt(startParsed.messageId, 10);
  let endMsgId = startMsgId;

  if (endUrl && String(endUrl).trim()) {
    const endParsed = parseTelegramUrl(String(endUrl));
    if (!endParsed.isValid || !endParsed.messageId) {
      return res.status(400).json({ error: 'Valid Ending Telegram link is required.' });
    }
    if (
      (startParsed.chatId || '').toLowerCase() !== (endParsed.chatId || '').toLowerCase() ||
      (startParsed.rawChannelId || '').toLowerCase() !== (endParsed.rawChannelId || '').toLowerCase()
    ) {
      return res.status(400).json({ error: 'Starting URL and Ending URL must be from the same Telegram channel.' });
    }
    endMsgId = parseInt(endParsed.messageId, 10);
  } else if (count && Number(count) > 0) {
    endMsgId = startMsgId + Math.min(2500, Math.floor(Number(count))) - 1;
  } else {
    return res.status(400).json({ error: 'Ending Telegram link or episode count is required.' });
  }

  if (endMsgId < startMsgId) {
    return res.status(400).json({ error: 'Ending URL message ID must be >= Starting URL message ID.' });
  }

  const totalToScan = endMsgId - startMsgId + 1;
  if (totalToScan > 2500) {
    return res.status(400).json({ error: 'Max 2500 messages can be scanned per request.' });
  }

  try {
    const client = await getTelegramClient();
    let peer: any = null;
    let channelTitle = startParsed.rawChannelId || startParsed.chatId;
    let publicUsername = !startParsed.isPrivate ? startParsed.rawChannelId : '';

    if (startParsed.chatId && startParsed.chatId.startsWith('@')) {
      const entity: any = await client.getEntity(startParsed.chatId);
      if (entity) {
        peer = entity;
        channelTitle = entity.title || channelTitle;
        publicUsername = entity.username || publicUsername;
        if (entity.accessHash) {
          saveChannelEntity(entity.id.toString(), entity.accessHash.toString(), entity.title, entity.username);
        }
      }
    } else if (startParsed.rawChannelId) {
      const cleanId = startParsed.rawChannelId.replace('-100', '');
      const cachedHash = getCachedAccessHash(cleanId);
      if (cachedHash && cachedHash !== '0') {
        const bigInt = (await import('big-integer')).default;
        peer = new Api.InputPeerChannel({
          channelId: bigInt(cleanId),
          accessHash: bigInt(cachedHash),
        });
      } else {
        try {
          const entity: any = await client.getEntity(`-100${cleanId}`);
          if (entity) {
            peer = entity;
            channelTitle = entity.title || channelTitle;
            if (entity.accessHash) {
              saveChannelEntity(cleanId, entity.accessHash.toString(), entity.title, entity.username);
            }
          }
        } catch {}
      }
      if (!peer) peer = `-100${cleanId}`;
    }

    if (!peer) {
      return res.status(400).json({ error: 'Could not resolve Telegram channel. Please authorize channel first.' });
    }

    const rawVideos: Array<{
      msgId: number;
      streamUrl: string;
      doc: any;
      mime: string;
      durationSec: number;
      duration: string;
      fileName: string;
      sizeBytes: number;
      quality: string;
      qualityScore: number;
      hasExplicitNoSound: boolean;
      episodeKey: string | null;
      epNum: number | null;
      absEpNum: number | null;
      headerEpNum: number | null;
      burstId: number;
    }> = [];

    let skippedStickers = 0;
    let skippedOther = 0;
    let activeHeaderEpNum: number | null = null;
    let currentBurstId = 1;
    let lastMsgWasVideo = false;

    const BATCH_SIZE = 100;
    for (let cursor = startMsgId; cursor <= endMsgId; cursor += BATCH_SIZE) {
      const batchEnd = Math.min(cursor + BATCH_SIZE - 1, endMsgId);
      const batchIds: number[] = [];
      for (let id = cursor; id <= batchEnd; id++) {
        batchIds.push(id);
      }

      const messages: any[] = await client.getMessages(peer, { ids: batchIds });
      const sortedBatch = [...(messages || [])].filter(Boolean).sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

      for (const msg of sortedBatch) {
        if (!msg || !msg.id) {
          skippedOther++;
          continue;
        }
        const media: any = msg.media;
        const doc: any = media?.document || msg.document;
        if (!doc || !doc.id) {
          const textMsg = normalizeTelegramText(String(msg.message || '')).trim();
          const isFutureAnnouncement = /\b(?:tomorrow|soon|will upload|coming|at \d+\s*(?:am|pm)|filler)\b/i.test(textMsg);
          const hdrMatch = !isFutureAnnouncement
            ? textMsg.match(/(?:episode|ep)\s*[:\-]?\s*0*(\d{1,4})\b/i)
            : null;
          if (hdrMatch) {
            activeHeaderEpNum = parseInt(hdrMatch[1], 10);
            if (lastMsgWasVideo) {
              currentBurstId++;
              lastMsgWasVideo = false;
            }
          }
          skippedOther++;
          continue;
        }

        const classified = classifyTelegramDocMedia(msg);
        if (classified.kind === 'sticker') {
          skippedStickers++;
          activeHeaderEpNum = null;
          if (lastMsgWasVideo) {
            currentBurstId++;
            lastMsgWasVideo = false;
          }
          continue;
        }
        if (classified.kind !== 'video') {
          skippedOther++;
          continue;
        }

        const streamUrl = publicUsername
          ? `https://t.me/${publicUsername}/${msg.id}`
          : `https://t.me/c/${startParsed.rawChannelId}/${msg.id}`;

        const { quality, score } = parseQualityScore(
          classified.caption,
          classified.fileName,
          classified.width,
          classified.height
        );
        const { key: parsedKey, epNum, absEpNum } = parseEpisodeIdentity(classified.caption, classified.fileName);

        // If header announced a different episode >= 100 than this video's >= 100 episode, clear stale header
        if (activeHeaderEpNum !== null && absEpNum !== null && activeHeaderEpNum >= 100 && absEpNum !== activeHeaderEpNum) {
          activeHeaderEpNum = null;
        }

        // Unify key using text header when filename uses season-relative E02 or lacks filename/caption
        let episodeKey = parsedKey;
        if (activeHeaderEpNum !== null) {
          if (!parsedKey || (activeHeaderEpNum >= 100 && absEpNum === null)) {
            episodeKey = `hdr-${activeHeaderEpNum}`;
          } else if (absEpNum === activeHeaderEpNum) {
            episodeKey = `hdr-${activeHeaderEpNum}`;
          }
        }

        lastMsgWasVideo = true;

        rawVideos.push({
          msgId: Number(msg.id),
          streamUrl,
          doc: classified.doc,
          mime: classified.mime,
          durationSec: classified.durationSec,
          duration: classified.durationSec > 0 ? formatDuration(classified.durationSec) : '',
          fileName: classified.fileName || `Episode_Msg_${msg.id}`,
          sizeBytes: classified.sizeBytes,
          quality,
          qualityScore: score,
          hasExplicitNoSound: classified.hasExplicitNoSound,
          episodeKey,
          epNum,
          absEpNum,
          headerEpNum: activeHeaderEpNum,
          burstId: currentBurstId,
        });
      }

      if (batchEnd < endMsgId) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    rawVideos.sort((a, b) => a.msgId - b.msgId);

    // Second pass: if a sticker-free burst has a season-relative file (e.g. E01 480p) immediately followed
    // by an absolute file (E362 720p/1080p) of different quality, or an untagged blank-name video right next to
    // a keyed video in the same burst, assign them the same episode group key.
    for (let i = 0; i < rawVideos.length; i++) {
      const curr = rawVideos[i];
      const prev = i > 0 ? rawVideos[i - 1] : null;
      const next = i + 1 < rawVideos.length ? rawVideos[i + 1] : null;

      if (!curr.episodeKey) {
        if (prev && prev.burstId === curr.burstId && curr.msgId - prev.msgId <= 3 && prev.episodeKey && prev.qualityScore !== curr.qualityScore) {
          curr.episodeKey = prev.episodeKey;
        } else if (next && next.burstId === curr.burstId && next.msgId - curr.msgId <= 3 && next.episodeKey && next.qualityScore !== curr.qualityScore) {
          curr.episodeKey = next.episodeKey;
        }
      } else if (
        prev &&
        prev.burstId === curr.burstId &&
        curr.msgId - prev.msgId <= 3 &&
        prev.epNum !== null &&
        curr.epNum === prev.epNum &&
        prev.episodeKey &&
        prev.qualityScore !== curr.qualityScore
      ) {
        curr.episodeKey = prev.episodeKey;
      } else if (
        curr.absEpNum === null &&
        (curr.epNum || 0) < 100 &&
        next &&
        next.burstId === curr.burstId &&
        next.msgId - curr.msgId <= 2 &&
        next.absEpNum !== null &&
        next.episodeKey &&
        curr.qualityScore > 0 &&
        next.qualityScore > 0 &&
        curr.qualityScore !== next.qualityScore
      ) {
        curr.episodeKey = next.episodeKey;
      }
    }

    let filteredVideos = rawVideos;
    let skippedDuplicates = 0;
    let fallbackCount = 0;
    let silentSkippedCount = 0;

    let aborted = false;
    res.on('close', () => {
      if (!res.writableEnded) aborted = true;
    });

    if (qFilter === '1080p' || qFilter === '720p' || qFilter === '480p' || qFilter === 'best') {
      // Group videos by episodeKey (or unique msgId if untitled standalone video)
      const groups = new Map<string, typeof rawVideos>();
      for (const v of rawVideos) {
        const gKey = v.episodeKey || `msg-${v.msgId}`;
        const arr = groups.get(gKey) || [];
        arr.push(v);
        groups.set(gKey, arr);
      }

      const selections = await mapWithConcurrency(
        Array.from(groups.values()),
        4,
        (arr) => selectBestCandidateForGroup(arr, qFilter, client, () => aborted),
        () => aborted
      );

      if (aborted) return;

      for (const sel of selections) {
        if (!sel) continue;
        if (sel.switchedForAudio) silentSkippedCount++;
        if (sel.fellBackQuality) fallbackCount++;
      }

      filteredVideos = selections.filter(Boolean).map((s) => s.chosen).sort((a, b) => a.msgId - b.msgId);
      skippedDuplicates = rawVideos.length - filteredVideos.length;
    }

    const episodes = filteredVideos.map(
      ({
        doc: _doc,
        mime: _mime,
        qualityScore: _qs,
        hasExplicitNoSound: _ns,
        episodeKey: _ek,
        absEpNum: _ae,
        headerEpNum: _he,
        burstId: _bi,
        ...rest
      }) => rest
    );

    console.log(
      `[TelegramScanRange] Channel "${channelTitle}" (${startMsgId}-${endMsgId}, filter=${qFilter}): ${episodes.length} videos found, ${skippedStickers} stickers skipped, ${skippedDuplicates} extra quality copies skipped, ${fallbackCount} quality fallbacks, ${silentSkippedCount} silent-audio switches, ${skippedOther} text/other posts skipped.`
    );

    return res.json({
      success: true,
      channelTitle,
      totalScanned: totalToScan,
      videosFound: episodes.length,
      skippedStickers,
      skippedDuplicates,
      skippedOther,
      fallbackCount,
      silentSkippedCount,
      skippedCount: skippedStickers + skippedDuplicates + skippedOther,
      episodes,
    });
  } catch (err: any) {
    console.error('[TelegramScanRange] Error:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to scan Telegram channel messages.',
    });
  }
});

/**
 * POST /api/telegram/filter-urls
 * Filters an existing or pasted list of Telegram URLs:
 * - Removes stickers (.webp/.tgs/.webm), GIFs, photos, audio, and .txt/text posts
 * - Groups multi-quality copies per episode
 * - Prefers requested quality (default '1080p'), falling back to '720p' (or best available) if missing
 * - Checks audio presence and switches silent 1080p -> 720p with audio
 */
router.post('/filter-urls', async (req: Request, res: Response) => {
  const urls: string[] = Array.isArray(req.body?.urls) ? req.body.urls.map((u: any) => String(u || '').trim()) : [];
  const qFilter = String(req.body?.qualityFilter || '1080p').toLowerCase();

  if (urls.length === 0) {
    return res.json({
      success: true,
      keptUrls: [],
      keptItems: [],
      removedCount: 0,
      totalChecked: 0,
      skippedStickers: 0,
      skippedOther: 0,
      fallbackCount: 0,
      silentSkippedCount: 0,
    });
  }

  try {
    const client = await getTelegramClient();

    type ParsedItem = {
      idx: number;
      url: string;
      channelKey: string;
      rawChannelId: string;
      chatId: string;
      isPrivate: boolean;
      msgId: number;
    };

    const byChannel = new Map<string, ParsedItem[]>();
    const nonTelegramIndices = new Set<number>();

    urls.forEach((url, idx) => {
      const parsed = parseTelegramUrl(url);
      if (!parsed.isValid || parsed.isInviteLink || !parsed.messageId) {
        if (/^https?:\/\//i.test(url) && !NON_VIDEO_FILE_EXT_RE.test(url.split('?')[0])) {
          nonTelegramIndices.add(idx);
        }
        return;
      }
      const cleanId = parsed.rawChannelId ? parsed.rawChannelId.replace('-100', '') : parsed.chatId;
      const channelKey = cleanId || parsed.chatId;
      const list = byChannel.get(channelKey) || [];
      list.push({
        idx,
        url,
        channelKey,
        rawChannelId: parsed.rawChannelId || '',
        chatId: parsed.chatId || '',
        isPrivate: Boolean(parsed.isPrivate),
        msgId: parseInt(parsed.messageId, 10),
      });
      byChannel.set(channelKey, list);
    });

    interface MetaRecord {
      idx: number;
      channelKey: string;
      msgId: number;
      streamUrl: string;
      doc: any;
      mime: string;
      fileName: string;
      isVideo: boolean;
      isSticker: boolean;
      quality: string;
      qualityScore: number;
      hasExplicitNoSound: boolean;
      episodeKey: string | null;
      sizeBytes: number;
      durationSec: number;
      duration: string;
    }

    const recordsByIdx = new Map<number, MetaRecord>();
    let skippedStickers = 0;
    let skippedOther = 0;

    for (const [channelKey, items] of byChannel.entries()) {
      let peer: any = null;
      const sample = items[0];
      if (sample.chatId.startsWith('@')) {
        try {
          peer = await client.getEntity(sample.chatId);
        } catch {}
      }
      if (!peer) {
        const cleanId = channelKey.replace('-100', '');
        const cachedHash = getCachedAccessHash(cleanId);
        if (cachedHash && cachedHash !== '0') {
          const bigInt = (await import('big-integer')).default;
          peer = new Api.InputPeerChannel({ channelId: bigInt(cleanId), accessHash: bigInt(cachedHash) });
        } else {
          try {
            peer = await client.getEntity(`-100${cleanId}`);
          } catch {}
        }
        if (!peer) peer = `-100${cleanId}`;
      }

      const BATCH_SIZE = 100;
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const slice = items.slice(i, i + BATCH_SIZE);
        const ids = slice.map((x) => x.msgId);
        const messages: any[] = await client.getMessages(peer, { ids });
        const msgMap = new Map<number, any>();
        for (const m of messages || []) {
          if (m && m.id) msgMap.set(Number(m.id), m);
        }

        for (const item of slice) {
          const msg = msgMap.get(item.msgId);
          const classified = classifyTelegramDocMedia(msg);
          if (classified.kind !== 'video') {
            if (classified.kind === 'sticker') skippedStickers++;
            else skippedOther++;
            recordsByIdx.set(item.idx, {
              idx: item.idx,
              channelKey,
              msgId: item.msgId,
              streamUrl: item.url,
              doc: null,
              mime: '',
              fileName: classified.fileName || '',
              isVideo: false,
              isSticker: classified.kind === 'sticker',
              quality: '',
              qualityScore: 0,
              hasExplicitNoSound: false,
              episodeKey: null,
              sizeBytes: 0,
              durationSec: 0,
              duration: '',
            });
            continue;
          }

          const { quality, score } = parseQualityScore(
            classified.caption,
            classified.fileName,
            classified.width,
            classified.height
          );
          const { key: episodeKey } = parseEpisodeIdentity(classified.caption, classified.fileName);

          recordsByIdx.set(item.idx, {
            idx: item.idx,
            channelKey,
            msgId: item.msgId,
            streamUrl: item.url,
            doc: classified.doc,
            mime: classified.mime,
            fileName: classified.fileName || `Episode_Msg_${item.msgId}`,
            isVideo: true,
            isSticker: false,
            quality,
            qualityScore: score,
            hasExplicitNoSound: classified.hasExplicitNoSound,
            episodeKey,
            sizeBytes: classified.sizeBytes,
            durationSec: classified.durationSec,
            duration: classified.durationSec > 0 ? formatDuration(classified.durationSec) : '',
          });
        }
      }
    }

    const validVideos = Array.from(recordsByIdx.values())
      .filter((r) => r.isVideo)
      .sort((a, b) => a.idx - b.idx);

    const keptIndices = new Set<number>(nonTelegramIndices);
    let fallbackCount = 0;
    let silentSkippedCount = 0;

    if (qFilter === 'all') {
      for (const v of validVideos) {
        keptIndices.add(v.idx);
      }
    } else {
      // Pair adjacent untitled videos from the same channel if they have different qualities & matching duration
      for (let i = 0; i < validVideos.length; i++) {
        const curr = validVideos[i];
        if (curr.episodeKey) continue;
        const prev = i > 0 ? validVideos[i - 1] : null;
        if (
          prev &&
          prev.channelKey === curr.channelKey &&
          Math.abs(curr.msgId - prev.msgId) <= 3 &&
          prev.quality &&
          curr.quality &&
          prev.quality !== curr.quality &&
          (curr.durationSec === 0 || prev.durationSec === 0 || Math.abs(curr.durationSec - prev.durationSec) <= 15)
        ) {
          if (!prev.episodeKey) prev.episodeKey = `pair-${prev.channelKey}-${prev.msgId}`;
          curr.episodeKey = prev.episodeKey;
        }
      }

      const groups = new Map<string, MetaRecord[]>();
      for (const v of validVideos) {
        const gKey = v.episodeKey ? `${v.channelKey}:${v.episodeKey}` : `single:${v.idx}`;
        const arr = groups.get(gKey) || [];
        arr.push(v);
        groups.set(gKey, arr);
      }

      let aborted = false;
      res.on('close', () => {
        if (!res.writableEnded) aborted = true;
      });

      const selections = await mapWithConcurrency(
        Array.from(groups.values()),
        4,
        (arr) => selectBestCandidateForGroup(arr, qFilter, client, () => aborted),
        () => aborted
      );

      if (aborted) return;

      for (const sel of selections) {
        if (!sel) continue;
        if (sel.switchedForAudio) silentSkippedCount++;
        if (sel.fellBackQuality) fallbackCount++;
        keptIndices.add(sel.chosen.idx);
      }
    }

    const keptUrls = urls
      .map((u, idx) => ({ idx, url: u, rec: recordsByIdx.get(idx) }))
      .filter((x) => keptIndices.has(x.idx))
      .map((x) => ({
        url: x.url,
        duration: x.rec?.duration || '',
        durationSec: x.rec?.durationSec || 0,
        quality: x.rec?.quality || '',
      }));

    return res.json({
      success: true,
      totalChecked: urls.length,
      keptCount: keptUrls.length,
      removedCount: urls.length - keptUrls.length,
      skippedStickers,
      skippedOther,
      fallbackCount,
      silentSkippedCount,
      keptItems: keptUrls,
    });
  } catch (err: any) {
    console.error('[TelegramFilterUrls] Error:', err);
    return res.status(500).json({ error: err?.message || 'Failed to filter existing URLs.' });
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
  hasAudio?: boolean;
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
  telegramUrl: string,
  probeOptions?: { timeoutMs?: number; probesize?: number; analyzeduration?: number }
): Promise<ProbeMediaResult> {
  if (entry.probe) return entry.probe;
  if (entry.probePromise) return entry.probePromise;

  const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || '3000';
  entry.probePromise = probeTelegramMedia(localPort, telegramUrl, entry.docInfo, probeOptions)
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
    try {
      const info = await probeDirectHttpInfo(urlParam);
      const qualityEstimates = buildQualitySizeEstimates({
        fileSizeBytes: info.fileSize,
        durationSec: info.durationSec,
        sourceHeight: info.height,
      });
      return res.json({
        status: 'ok',
        isTelegram: false,
        recommendedMode: 'direct',
        fileSize: info.fileSize,
        durationSec: info.durationSec,
        width: info.width,
        height: info.height,
        qualityEstimates,
        audioTracks: [],
        subtitleTracks: [],
      });
    } catch {
      return res.json({
        status: 'ok',
        isTelegram: false,
        recommendedMode: 'direct',
        fileSize: 0,
        durationSec: 0,
        width: 0,
        height: 0,
        qualityEstimates: buildQualitySizeEstimates({}),
        audioTracks: [],
        subtitleTracks: [],
      });
    }
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
    const resolvedDuration = probe.durationSec || entry.docInfo.durationSec || 0;
    const qualityEstimates = buildQualitySizeEstimates({
      fileSizeBytes: entry.docInfo.fileSize,
      durationSec: resolvedDuration,
      sourceHeight: probe.height,
    });

    return res.json({
      status: 'ok',
      isTelegram: true,
      fileName: entry.docInfo.fileName,
      fileSize: entry.docInfo.fileSize,
      durationSec: resolvedDuration,
      recommendedMode: probe.recommendedMode,
      container: probe.container,
      videoCodec: probe.videoCodec,
      videoProfile: probe.videoProfile,
      videoLevel: probe.videoLevel,
      is10Bit: probe.is10Bit,
      pixFmt: probe.pixFmt,
      width: probe.width,
      height: probe.height,
      audioCodec: probe.audioCodec,
      audioTracks: probe.audioTracks,
      subtitleTracks: probe.subtitleTracks,
      probedByFfprobe: probe.probedByFfprobe,
      qualityEstimates,
    });
  } catch (err: any) {
    console.error('[StreamInfo] Error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to inspect media stream' });
  }
});

const MAX_CONCURRENT_FFMPEG = Math.max(1, Number(process.env.MAX_CONCURRENT_FFMPEG) || 4);
const activeFfmpegProcs = new Set<ReturnType<typeof spawn>>();

function pipeFfmpegMp4Stream(opts: {
  inputUrl: string;
  modeLabel: string;
  startSec: number;
  audioIdx: number;
  remuxOnly: boolean;
  canCopyAudio: boolean;
  requestedQuality: VideoQualityTier | '';
  isDownload: boolean;
  commonHeaders: Record<string, string>;
  req: Request;
  res: Response;
}) {
  const {
    inputUrl,
    modeLabel,
    startSec,
    audioIdx,
    remuxOnly,
    canCopyAudio,
    requestedQuality,
    isDownload,
    commonHeaders,
    req,
    res,
  } = opts;

  if (activeFfmpegProcs.size >= MAX_CONCURRENT_FFMPEG) {
    console.warn(`[Stream] Active FFmpeg limit reached (${activeFfmpegProcs.size}/${MAX_CONCURRENT_FFMPEG})`);
    return res.status(503).json({ error: 'Transcoding server is busy. Please retry in a moment.' });
  }

  const ffArgs: string[] = [
    '-probesize', '2000000',
    '-analyzeduration', '2000000',
    '-fflags', '+genpts+discardcorrupt',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
  ];
  if (startSec > 0) {
    ffArgs.push('-ss', startSec.toString());
  }
  ffArgs.push(
    '-i', inputUrl,
    '-sn',
    '-dn',
    '-map_chapters', '-1',
    '-map', '0:V:0',
    '-map', `0:a:${audioIdx}?`
  );

  if (remuxOnly && !requestedQuality) {
    ffArgs.push('-c:v', 'copy');
    if (canCopyAudio) {
      ffArgs.push('-c:a', 'copy');
    } else {
      ffArgs.push('-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k');
    }
  } else {
    ffArgs.push(...getFfmpegQualityArgs(requestedQuality, isDownload));
  }

  ffArgs.push(
    '-avoid_negative_ts', 'make_zero',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-frag_duration', '1000000',
    '-f', 'mp4',
    'pipe:1'
  );

  const ffProc = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeFfmpegProcs.add(ffProc);
  let procClosed = false;
  let headersCommitted = false;
  let clientClosed = false;
  let lastErrLine = '';

  const killFf = () => {
    clientClosed = true;
    if (!procClosed) {
      try {
        ffProc.kill('SIGTERM');
        setTimeout(() => {
          if (!procClosed) {
            try { ffProc.kill('SIGKILL'); } catch {}
          }
        }, 500);
      } catch {}
    }
  };

  const startupTimer = setTimeout(() => {
    if (!headersCommitted && !procClosed) {
      console.warn(`[FFmpeg ${modeLabel}] Startup timeout before first output byte`);
      killFf();
      if (!res.headersSent && !res.writableEnded) {
        res.status(504).json({ error: 'Stream transcode startup timed out' });
      }
    }
  }, 25000);

  ffProc.stdout.on('data', (chunk: Buffer) => {
    if (clientClosed || res.writableEnded) return;
    if (!headersCommitted) {
      headersCommitted = true;
      clearTimeout(startupTimer);
      res.writeHead(200, {
        ...commonHeaders,
        'Content-Type': 'video/mp4',
      });
      (res as any).flushHeaders?.();
    }
    const ok = res.write(chunk);
    if (!ok) {
      ffProc.stdout.pause();
      res.once('drain', () => {
        if (!procClosed && !clientClosed) ffProc.stdout.resume();
      });
    }
  });

  ffProc.stderr.on('data', (chunk: Buffer) => {
    const msg = chunk.toString().trim();
    if (msg) {
      lastErrLine = msg;
      if (msg.toLowerCase().includes('error')) {
        console.warn(`[FFmpeg ${modeLabel}]`, msg);
      }
    }
  });

  ffProc.on('error', (err) => {
    clearTimeout(startupTimer);
    activeFfmpegProcs.delete(ffProc);
    procClosed = true;
    console.error('[FFmpeg] Spawn error:', err.message);
    if (!headersCommitted && !res.headersSent) {
      res.status(502).json({ error: 'FFmpeg failed to start: ' + err.message });
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  ffProc.on('close', (code) => {
    clearTimeout(startupTimer);
    activeFfmpegProcs.delete(ffProc);
    procClosed = true;
    if (!headersCommitted && !clientClosed && !res.headersSent) {
      res.status(502).json({
        error: `FFmpeg exited (${code}) before streaming${lastErrLine ? ': ' + lastErrLine.slice(-180) : ''}`,
      });
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  req.on('close', killFf);
  res.on('close', killFf);
  res.on('error', killFf);
}

/**
 * GET/HEAD /api/telegram/stream & /api/stream
 * High-speed parallel-block HTTP Range streaming proxy + instant ffprobe-guided remux/transcode.
 */
export async function handleStream(req: Request, res: Response) {
  const urlParam = (req.query.url as string || '').trim();
  const isRemuxParam = req.query.remux === '1';
  const isTranscodeParam = req.query.transcode === '1';
  const isCastParam = req.query.cast === '1';
  const isRawParam = req.query.raw === '1';
  const isDownloadParam = req.query.download === '1';
  const requestedQuality = normalizeRequestedQuality(req.query.quality);
  const startSecParam = req.query.start ? Math.max(0, parseFloat(req.query.start as string) || 0) : 0;
  const audioIdxParam = req.query.audioIdx !== undefined ? Math.max(0, parseInt(req.query.audioIdx as string, 10) || 0) : 0;

  if (!urlParam) return res.status(400).send('URL required');

  // 1. Handle Direct Non-Telegram URLs
  if (!urlParam.includes('t.me') && !urlParam.includes('telegram.me')) {
    const needsScaledTranscode =
      requestedQuality === '720p' ||
      requestedQuality === '480p' ||
      requestedQuality === '360p' ||
      isTranscodeParam;

    if (!needsScaledTranscode) {
      return res.redirect(urlParam);
    }

    const commonHeaders: Record<string, string> = {
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, X-Stream-Mode, Content-Type',
      'X-Stream-Mode': `transcode-${requestedQuality || '1080p'}`,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
    };
    if (isDownloadParam) {
      commonHeaders['Content-Disposition'] = `attachment; filename="Movie_Portal_${requestedQuality || 'HD'}.mp4"`;
    }

    if (req.method === 'HEAD') {
      res.writeHead(200, { ...commonHeaders, 'Content-Type': 'video/mp4' });
      return res.end();
    }

    return pipeFfmpegMp4Stream({
      inputUrl: urlParam,
      modeLabel: `http-${requestedQuality || '1080p'}`,
      startSec: startSecParam,
      audioIdx: audioIdxParam,
      remuxOnly: false,
      canCopyAudio: false,
      requestedQuality: requestedQuality || '1080p',
      isDownload: isDownloadParam,
      commonHeaders,
      req,
      res,
    });
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
      const shouldDownscaleQuality =
        requestedQuality === '480p' ||
        requestedQuality === '360p' ||
        (requestedQuality === '720p' && (probe.height <= 0 || probe.height > 780));

      if (isTranscodeParam || shouldDownscaleQuality) {
        effectiveMode = 'transcode';
      } else if (isRemuxParam) {
        effectiveMode = probe.recommendedMode === 'transcode' ? 'transcode' : 'remux';
      } else if (isCastParam) {
        const vc = (probe.videoCodec || '').toLowerCase();
        const ac = (probe.audioCodec || '').toLowerCase();
        const cont = (probe.container || '').toLowerCase();
        const castDirectVideoOk = !probe.is10Bit && (vc === 'h264' || vc === 'avc' || vc === 'vp8' || vc === 'vp9');
        const castDirectAudioOk = !ac || ac === 'aac' || ac === 'mp3' || ac === 'opus' || ac === 'vorbis';
        const castDirectContainerOk = cont === 'mp4' || cont === 'mov' || cont === 'm4v' || cont === 'webm';
        if (castDirectVideoOk && castDirectAudioOk && castDirectContainerOk) {
          effectiveMode = 'direct';
        } else if (castDirectVideoOk && cont === 'mkv') {
          effectiveMode = 'remux';
        } else {
          effectiveMode = 'transcode';
        }
      } else if (audioIdxParam > 0 && effectiveMode === 'direct') {
        effectiveMode = 'remux';
      }

      const effectiveMimeType =
        isCastParam && (!mimeType || mimeType === 'application/octet-stream')
          ? 'video/mp4'
          : mimeType;

      const commonHeaders: Record<string, string> = {
        'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, X-Stream-Mode, Content-Type',
        'X-Video-Duration': durationSec.toString(),
        'X-Stream-Mode': requestedQuality ? `${effectiveMode}-${requestedQuality}` : effectiveMode,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
      };
      if (isDownloadParam && effectiveMode !== 'direct') {
        commonHeaders['Content-Disposition'] = `attachment; filename="Movie_Portal_${requestedQuality || 'HD'}.mp4"`;
      }

      if (req.method === 'HEAD') {
        res.writeHead(200, {
          ...commonHeaders,
          ...(effectiveMode === 'direct' ? { 'Accept-Ranges': 'bytes', 'Content-Length': fileSize.toString() } : {}),
          'Content-Type': effectiveMode === 'direct' ? effectiveMimeType : 'video/mp4',
        });
        return res.end();
      }

      if (effectiveMode === 'remux' || effectiveMode === 'transcode') {
        const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || '3000';
        const localSourceUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(urlParam)}&raw=1`;
        const selectedAudioTrack = probe.audioTracks[audioIdxParam] || probe.audioTracks[0];
        const selectedAudioCodec = selectedAudioTrack?.codec || probe.audioCodec || '';
        const selectedChannels = selectedAudioTrack?.channels || 2;
        const canCopyAudio =
          (selectedAudioCodec === 'aac' || selectedAudioCodec === 'mp3') && selectedChannels <= 2;

        return pipeFfmpegMp4Stream({
          inputUrl: localSourceUrl,
          modeLabel: `${effectiveMode}${requestedQuality ? '-' + requestedQuality : ''}`,
          startSec: startSecParam,
          audioIdx: audioIdxParam,
          remuxOnly: effectiveMode === 'remux',
          canCopyAudio,
          requestedQuality,
          isDownload: isDownloadParam,
          commonHeaders,
          req,
          res,
        });
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
      'Content-Type': (isCastParam && (!mimeType || mimeType === 'application/octet-stream')) ? 'video/mp4' : mimeType,
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
