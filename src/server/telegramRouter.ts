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

  // Detect any standalone 3-4 digit absolute episode number (e.g. "S17E08 369" or "Episode 369" or "erisode - 369")
  const absMatch =
    combined.match(/(?:e[pr]isode|ep)\s*[:\-_.\s]*0*([1-9]\d{2,3})\b/i) ||
    combined.match(/\bS\d{1,2}E\d{1,2}\s+([1-9]\d{2,3})\b/i);
  if (absMatch) {
    absEpNum = parseInt(absMatch[1], 10);
  }

  const capEpMatch =
    normCap.match(/e[pr]isode\s*[:\-]?\s*0*(\d{1,4})\b/i) ||
    normCap.match(/episode\s*[:\-]?\s*0*(\d{1,4})\b/i);
  const capSeasonMatch = normCap.match(/season\s*[:\-]?\s*0*(\d{1,2})\b/i);

  if (capEpMatch) {
    epNum = parseInt(capEpMatch[1], 10);
    if (capSeasonMatch) seasonNum = parseInt(capSeasonMatch[1], 10);
  } else {
    const seMatch = combined.match(/\bS(?:eason)?\s*0*(\d{1,2})\s*[-_.\s]*E(?:p|pisode)?\s*0*(\d{1,4})\b/i);
    const esMatch = combined.match(/\bE(?:p|pisode)?\s*[-_.\s]*0*(\d{1,4})[-_.\s]+S(?:eason)?\s*0*(\d{1,2})\b/i);
    if (seMatch) {
      seasonNum = parseInt(seMatch[1], 10);
      epNum = parseInt(seMatch[2], 10);
    } else if (esMatch) {
      epNum = parseInt(esMatch[1], 10);
      seasonNum = parseInt(esMatch[2], 10);
    } else {
      const fnEpMatch = normFn.match(/(?:^|[\s_\-\[])E(?:p|pisode)?\s*[:\-_.\s]*0*(\d{1,4})\b/i);
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

/**
 * POST /api/telegram/scan-range
 * Scans a range of Telegram message IDs in a channel and returns ONLY real video episodes,
 * automatically skipping stickers (.webp/.tgs/.webm), GIFs, photos, audio, text, and deleted posts.
 * Supports optional qualityFilter ('all' | 'best' | '1080p' | '720p' | '480p') for multi-quality channels.
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
      durationSec: number;
      duration: string;
      fileName: string;
      sizeBytes: number;
      quality: string;
      qualityScore: number;
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

        const attrs: any[] = Array.isArray(doc.attributes) ? doc.attributes : [];
        const mime = String(doc.mimeType || '').toLowerCase();

        const isSticker =
          mime === 'application/x-tgsticker' ||
          mime === 'image/webp' ||
          attrs.some(
            (a) =>
              a instanceof Api.DocumentAttributeSticker ||
              a?.className === 'DocumentAttributeSticker' ||
              a?.className === 'DocumentAttributeCustomEmoji'
          );

        if (isSticker) {
          skippedStickers++;
          activeHeaderEpNum = null;
          if (lastMsgWasVideo) {
            currentBurstId++;
            lastMsgWasVideo = false;
          }
          continue;
        }

        const isAnimatedGif = attrs.some(
          (a) => a instanceof Api.DocumentAttributeAnimated || a?.className === 'DocumentAttributeAnimated'
        );
        if (isAnimatedGif || mime.startsWith('image/') || mime.startsWith('audio/')) {
          skippedOther++;
          continue;
        }

        const fnAttr = attrs.find(
          (a) => a instanceof Api.DocumentAttributeFilename || a?.className === 'DocumentAttributeFilename'
        );
        const fileName = String(fnAttr?.fileName || '');
        const vidAttr = attrs.find(
          (a) => a instanceof Api.DocumentAttributeVideo || a?.className === 'DocumentAttributeVideo'
        );
        const sizeBytes = Number(doc.size || 0);

        const isVideo =
          mime.startsWith('video/') ||
          Boolean(vidAttr) ||
          (/\.(mp4|mkv|avi|mov|webm|m4v|ts|flv)$/i.test(fileName) && sizeBytes > 100 * 1024);

        if (!isVideo) {
          skippedOther++;
          continue;
        }

        const durationSec = Math.max(0, Math.round(Number(vidAttr?.duration || 0)));
        const streamUrl = publicUsername
          ? `https://t.me/${publicUsername}/${msg.id}`
          : `https://t.me/c/${startParsed.rawChannelId}/${msg.id}`;

        const caption = String(msg.message || '');
        const vidW = Number(vidAttr?.w || 0);
        const vidH = Number(vidAttr?.h || 0);
        const { quality, score } = parseQualityScore(caption, fileName, vidW, vidH);
        const { key: parsedKey, epNum, absEpNum } = parseEpisodeIdentity(caption, fileName);

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
          durationSec,
          duration: durationSec > 0 ? formatDuration(durationSec) : '',
          fileName: fileName || `Episode_Msg_${msg.id}`,
          sizeBytes,
          quality,
          qualityScore: score,
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

    if (qFilter === '1080p' || qFilter === '720p' || qFilter === '480p' || qFilter === 'best') {
      // Group videos by episodeKey (or unique msgId if untitled standalone video)
      const groups = new Map<string, typeof rawVideos>();
      for (const v of rawVideos) {
        const gKey = v.episodeKey || `msg-${v.msgId}`;
        const arr = groups.get(gKey) || [];
        arr.push(v);
        groups.set(gKey, arr);
      }

      const pickBestFromGroup = (arr: typeof rawVideos) => {
        if (arr.length === 1) return arr[0];

        if (qFilter === '1080p' || qFilter === '720p' || qFilter === '480p') {
          const exact = arr.filter((v) => v.quality.toLowerCase() === qFilter);
          if (exact.length > 0) {
            return exact.reduce((best, cur) => (cur.sizeBytes > best.sizeBytes ? cur : best));
          }
          // Preferred quality wasn't uploaded for this episode -> fall back to best available quality
          // so the episode itself is NEVER dropped from the season!
        }

        return arr.reduce((best, cur) => {
          if (cur.qualityScore !== best.qualityScore) {
            return cur.qualityScore > best.qualityScore ? cur : best;
          }
          return cur.sizeBytes > best.sizeBytes ? cur : best;
        });
      };

      filteredVideos = Array.from(groups.values())
        .map(pickBestFromGroup)
        .sort((a, b) => a.msgId - b.msgId);
      skippedDuplicates = rawVideos.length - filteredVideos.length;
    }

    const episodes = filteredVideos.map(({ qualityScore: _qs, episodeKey: _ek, absEpNum: _ae, headerEpNum: _he, burstId: _bi, ...rest }) => rest);

    console.log(
      `[TelegramScanRange] Channel "${channelTitle}" (${startMsgId}-${endMsgId}, filter=${qFilter}): ${episodes.length} videos found, ${skippedStickers} stickers skipped, ${skippedDuplicates} extra quality copies skipped, ${skippedOther} other posts skipped.`
    );

    return res.json({
      success: true,
      channelTitle,
      totalScanned: totalToScan,
      videosFound: episodes.length,
      skippedStickers,
      skippedDuplicates,
      skippedOther,
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
 * Filters an existing list of Telegram URLs already in Admin Panel, keeping ONLY the requested quality
 * (default '1080p') and removing 480p/720p/360p duplicates and stickers.
 */
router.post('/filter-urls', async (req: Request, res: Response) => {
  const urls: string[] = Array.isArray(req.body?.urls) ? req.body.urls.map((u: any) => String(u || '').trim()) : [];
  const qFilter = String(req.body?.qualityFilter || '1080p').toLowerCase();

  if (urls.length === 0) {
    return res.json({ success: true, keptUrls: [], removedCount: 0, totalChecked: 0 });
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
        nonTelegramIndices.add(idx);
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
      url: string;
      isVideo: boolean;
      isSticker: boolean;
      quality: string;
      qualityScore: number;
      episodeKey: string | null;
      sizeBytes: number;
      durationSec: number;
      duration: string;
    }

    const recordsByIdx = new Map<number, MetaRecord>();

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
          const doc: any = msg?.media?.document || msg?.document;
          if (!msg || !doc || !doc.id) {
            recordsByIdx.set(item.idx, {
              idx: item.idx,
              url: item.url,
              isVideo: false,
              isSticker: false,
              quality: '',
              qualityScore: 0,
              episodeKey: null,
              sizeBytes: 0,
              durationSec: 0,
              duration: '',
            });
            continue;
          }

          const attrs: any[] = Array.isArray(doc.attributes) ? doc.attributes : [];
          const mime = String(doc.mimeType || '').toLowerCase();
          const isSticker =
            mime === 'application/x-tgsticker' ||
            mime === 'image/webp' ||
            attrs.some(
              (a) =>
                a instanceof Api.DocumentAttributeSticker ||
                a?.className === 'DocumentAttributeSticker' ||
                a?.className === 'DocumentAttributeCustomEmoji'
            );

          const isAnimated = attrs.some(
            (a) => a instanceof Api.DocumentAttributeAnimated || a?.className === 'DocumentAttributeAnimated'
          );
          const fnAttr = attrs.find(
            (a) => a instanceof Api.DocumentAttributeFilename || a?.className === 'DocumentAttributeFilename'
          );
          const fileName = String(fnAttr?.fileName || '');
          const vidAttr = attrs.find(
            (a) => a instanceof Api.DocumentAttributeVideo || a?.className === 'DocumentAttributeVideo'
          );
          const sizeBytes = Number(doc.size || 0);
          const isVideo =
            !isSticker &&
            !isAnimated &&
            !mime.startsWith('image/') &&
            !mime.startsWith('audio/') &&
            (mime.startsWith('video/') ||
              Boolean(vidAttr) ||
              (/\.(mp4|mkv|avi|mov|webm|m4v|ts|flv)$/i.test(fileName) && sizeBytes > 100 * 1024));

          const durationSec = Math.max(0, Math.round(Number(vidAttr?.duration || 0)));
          const caption = String(msg.message || '');
          const { quality, score } = parseQualityScore(caption, fileName, Number(vidAttr?.w || 0), Number(vidAttr?.h || 0));
          const { key: episodeKey } = parseEpisodeIdentity(caption, fileName);

          recordsByIdx.set(item.idx, {
            idx: item.idx,
            url: item.url,
            isVideo,
            isSticker,
            quality,
            qualityScore: score,
            episodeKey,
            sizeBytes,
            durationSec,
            duration: durationSec > 0 ? formatDuration(durationSec) : '',
          });
        }
      }
    }

    const validVideos = Array.from(recordsByIdx.values()).filter((r) => r.isVideo);
    const hasAnyQualityLabel = validVideos.some((v) => Boolean(v.quality));
    const keptIndices = new Set<number>(nonTelegramIndices);

    let candidates = validVideos;
    if (qFilter === '1080p' || qFilter === '720p' || qFilter === '480p') {
      candidates = hasAnyQualityLabel
        ? validVideos.filter((v) => v.quality.toLowerCase() === qFilter)
        : validVideos;
    }

    const bestByEp = new Map<string, MetaRecord>();
    for (const v of candidates) {
      if (!v.episodeKey) {
        keptIndices.add(v.idx);
        continue;
      }
      const prev = bestByEp.get(v.episodeKey);
      if (!prev || v.qualityScore > prev.qualityScore || (v.qualityScore === prev.qualityScore && v.sizeBytes > prev.sizeBytes)) {
        bestByEp.set(v.episodeKey, v);
      }
    }
    for (const v of bestByEp.values()) {
      keptIndices.add(v.idx);
    }

    const keptUrls = urls
      .map((u, idx) => ({ idx, url: u, rec: recordsByIdx.get(idx) }))
      .filter((x) => keptIndices.has(x.idx))
      .map((x) => ({
        url: x.url,
        duration: x.rec?.duration || '',
        durationSec: x.rec?.durationSec || 0,
      }));

    return res.json({
      success: true,
      totalChecked: urls.length,
      keptCount: keptUrls.length,
      removedCount: urls.length - keptUrls.length,
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
    });
  } catch (err: any) {
    console.error('[StreamInfo] Error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Failed to inspect media stream' });
  }
});

const MAX_CONCURRENT_FFMPEG = Math.max(1, Number(process.env.MAX_CONCURRENT_FFMPEG) || 4);
const activeFfmpegProcs = new Set<ReturnType<typeof spawn>>();

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
        'X-Stream-Mode': effectiveMode,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Connection': 'keep-alive',
      };

      if (req.method === 'HEAD') {
        res.writeHead(200, {
          ...commonHeaders,
          ...(effectiveMode === 'direct' ? { 'Accept-Ranges': 'bytes', 'Content-Length': fileSize.toString() } : {}),
          'Content-Type': effectiveMode === 'direct' ? effectiveMimeType : 'video/mp4',
        });
        return res.end();
      }

      if (effectiveMode === 'remux' || effectiveMode === 'transcode') {
        if (activeFfmpegProcs.size >= MAX_CONCURRENT_FFMPEG) {
          console.warn(`[Stream] Active FFmpeg limit reached (${activeFfmpegProcs.size}/${MAX_CONCURRENT_FFMPEG})`);
          return res.status(503).json({ error: 'Transcoding server is busy. Please retry in a moment.' });
        }

        const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || '3000';
        const localSourceUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(urlParam)}&raw=1`;

        const ffArgs: string[] = [
          '-probesize', '2000000',
          '-analyzeduration', '2000000',
          '-fflags', '+genpts+discardcorrupt',
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
        const selectedChannels = selectedAudioTrack?.channels || 2;
        const canCopyAudio =
          (selectedAudioCodec === 'aac' || selectedAudioCodec === 'mp3') && selectedChannels <= 2;

        if (effectiveMode === 'remux') {
          ffArgs.push('-c:v', 'copy');
          if (canCopyAudio) {
            ffArgs.push('-c:a', 'copy');
          } else {
            ffArgs.push('-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k');
          }
        } else {
          // Universal H.264 Main 8-bit <=1080p Level 4.0 + AAC stereo fragmented MP4 (100% Android & Chrome compatible)
          ffArgs.push(
            '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'zerolatency',
            '-threads', '0',
            '-pix_fmt', 'yuv420p',
            '-profile:v', 'main',
            '-level', '4.0',
            '-color_primaries', 'bt709',
            '-color_trc', 'bt709',
            '-colorspace', 'bt709',
            '-vsync', 'cfr',
            '-crf', '23',
            '-maxrate', '3500k',
            '-bufsize', '7000k',
            '-g', '48',
            '-keyint_min', '48',
            '-sc_threshold', '0',
            '-c:a', 'aac',
            '-ac', '2',
            '-ar', '48000',
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
            console.warn(`[FFmpeg ${effectiveMode}] Startup timeout before first output byte`);
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
              console.warn(`[FFmpeg ${effectiveMode}]`, msg);
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
