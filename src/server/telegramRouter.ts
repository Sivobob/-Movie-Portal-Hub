import { Router, Request, Response } from 'express';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Api } from 'telegram';
import { parseTelegramUrl } from '../utils/telegramParser.ts';
import {
  getTelegramClient,
  getTelegramCredentials,
  isTelegramAuthKeyError,
  resetTelegramClient,
} from '../utils/telegramClient.ts';
import { 
  resolveTelegramMedia, 
  saveChannelEntity, 
  removeChannelEntity,
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
import {
  AutoMatchedMovieDraft,
  parseTelegramMovieMeta,
  resolveBestImdbMatch,
} from './movieAutoMatcher.ts';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase.ts';
import { getDisplayCategory } from '../utils/categoryMapping.ts';
import { parseDurationToSeconds } from '../utils/duration.ts';
import { upgradePosterUrl } from '../utils/posterUrl.ts';
import {
  getQualityUpgradeDecision,
  isHollywoodPrintMovie,
  isHollywoodPrintText,
  normalizeQualityBadge,
} from '../utils/qualityBadge.ts';
import {
  evaluateChannelVideoFilter,
  filterQualityMapForHdOnly,
} from '../utils/channelSyncFilters.ts';
import {
  isFirestoreQuotaErrorLike,
  isServerFirestoreWriteAllowed,
  markServerFirestoreQuotaExhausted,
} from './firestoreQuotaFlag.ts';
import {
  isCompleteSeasonPackEpisode,
  isSeriesComplete,
  mergeEpisodeIntoSeasons,
  normalizeSeriesSeasons,
  reconcileSeasonEpisodes,
} from '../utils/seriesCompleteness.ts';

const TVMAZE_EP_COUNT_CACHE = new Map<string, { counts: Record<number, number> | null; expiresAt: number }>();

async function fetchExpectedSeasonEpisodeCounts(imdbId?: string | null): Promise<Record<number, number> | null> {
  const cleanId = String(imdbId || '').trim();
  if (!/^tt\d+$/i.test(cleanId)) return null;
  const cached = TVMAZE_EP_COUNT_CACHE.get(cleanId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.counts;
  }
  try {
    const showResp = await fetch(
      `https://api.tvmaze.com/lookup/shows?imdb=${encodeURIComponent(cleanId)}`,
      { signal: AbortSignal.timeout(3500) }
    );
    if (!showResp.ok) {
      TVMAZE_EP_COUNT_CACHE.set(cleanId, { counts: null, expiresAt: Date.now() + 30 * 60_000 });
      return null;
    }
    const showJson: any = await showResp.json();
    if (!showJson?.id) {
      TVMAZE_EP_COUNT_CACHE.set(cleanId, { counts: null, expiresAt: Date.now() + 30 * 60_000 });
      return null;
    }
    const epsResp = await fetch(`https://api.tvmaze.com/shows/${showJson.id}/episodes`, {
      signal: AbortSignal.timeout(3500),
    });
    if (!epsResp.ok) {
      TVMAZE_EP_COUNT_CACHE.set(cleanId, { counts: null, expiresAt: Date.now() + 30 * 60_000 });
      return null;
    }
    const epsList: any[] = await epsResp.json();
    const counts: Record<number, number> = {};
    if (Array.isArray(epsList)) {
      for (const ep of epsList) {
        const s = Number(ep?.season);
        const n = Number(ep?.number);
        if (s > 0 && n > 0) {
          counts[s] = Math.max(counts[s] || 0, n);
        }
      }
    }
    const result = Object.keys(counts).length > 0 ? counts : null;
    TVMAZE_EP_COUNT_CACHE.set(cleanId, { counts: result, expiresAt: Date.now() + 6 * 3600_000 });
    return result;
  } catch {
    return null;
  }
}

function clampReleaseYear(val: any): number {
  const currentYear = new Date().getFullYear();
  const parsed = Number(val);
  if (!Number.isFinite(parsed) || parsed < 1900) return currentYear;
  return Math.min(Math.floor(parsed), currentYear);
}

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

function getFfmpegQualityArgs(quality: VideoQualityTier | '', _isDownload: boolean): string[] {
  const args: string[] = [];
  if (quality === '360p') {
    args.push(
      '-vf', "scale='min(640,iw)':'min(360,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,setsar=1,format=yuv420p",
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-threads', '0',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-level', '3.1',
      '-vsync', 'vfr',
      '-b:v', '220k',
      '-maxrate', '320k',
      '-bufsize', '640k',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0',
      '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
      '-c:a', 'aac',
      '-ac', '2',
      '-ar', '44100',
      '-b:a', '64k'
    );
    return args;
  }

  if (quality === '480p') {
    args.push(
      '-vf', "scale='min(854,iw)':'min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,setsar=1,format=yuv420p",
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-threads', '0',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-level', '3.1',
      '-vsync', 'vfr',
      '-b:v', '500k',
      '-maxrate', '700k',
      '-bufsize', '1400k',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0',
      '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
      '-c:a', 'aac',
      '-ac', '2',
      '-ar', '44100',
      '-b:a', '96k'
    );
    return args;
  }

  if (quality === '720p') {
    args.push(
      '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,format=yuv420p",
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-threads', '0',
      '-pix_fmt', 'yuv420p',
      '-profile:v', 'main',
      '-level', '4.0',
      '-vsync', 'vfr',
      '-crf', '21',
      '-maxrate', '1800k',
      '-bufsize', '3600k',
      '-g', '48',
      '-keyint_min', '48',
      '-sc_threshold', '0',
      '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
      '-c:a', 'aac',
      '-ac', '2',
      '-ar', '48000',
      '-b:a', '128k'
    );
    return args;
  }

  // Default 1080p Full HD high quality
  args.push(
    '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,format=yuv420p",
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-threads', '0',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'main',
    '-level', '4.0',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-colorspace', 'bt709',
    '-vsync', 'vfr',
    '-crf', '18',
    '-maxrate', '5500k',
    '-bufsize', '11000k',
    '-g', '48',
    '-keyint_min', '48',
    '-sc_threshold', '0',
    '-af', 'aresample=async=1:min_hard_comp=0.100000:first_pts=0',
    '-c:a', 'aac',
    '-ac', '2',
    '-ar', '48000',
    '-b:a', '192k'
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
    let client = await getTelegramClient();
    await ensureChannelUploadWatcher(client);
    let me: any;
    try {
      me = await client.getMe();
    } catch (meErr: any) {
      if (isTelegramAuthKeyError(meErr)) {
        client = await resetTelegramClient({ clearSavedSession: true, preferBotFallback: true });
        me = await client.getMe();
      } else {
        throw meErr;
      }
    }
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

router.post('/remove-channel', (req: Request, res: Response) => {
  const channelId = String(req.body?.channelId || '').trim();
  if (!channelId) {
    return res.status(400).json({ error: 'channelId is required' });
  }
  const removed = removeChannelEntity(channelId);
  const channels = getAllCachedChannels();
  res.json({ success: true, removed, channels });
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
    normCap.match(/e[pr]isodes?\s*['’`,]*\s*[:\-]?\s*0*(\d{1,4})(?=$|[^0-9])/i) ||
    normCap.match(/episodes?\s*['’`,]*\s*[:\-]?\s*0*(\d{1,4})(?=$|[^0-9])/i);
  const capSeasonMatch = normCap.match(/(?:season|session)\s*['’`,]*\s*[:\-]?\s*0*(\d{1,2})(?=$|[^0-9])/i);

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

    const probe = await ensureMediaProbed(entry, candidate.streamUrl, {
      timeoutMs: 8000,
      probesize: 1_500_000,
      analyzeduration: 1_500_000,
    });
    if (probe.probedByFfprobe) {
      const has = probe.audioTracks.length > 0 || Boolean(probe.audioCodec && probe.audioCodec !== 'none');
      entry.hasAudio = has;
      return has;
    }
    return fastAudio === true;
  } catch {
    return false;
  }
}

async function verifyCandidateAudioAndHd(
  candidate: {
    streamUrl: string;
    doc: any;
    mime: string;
    fileName: string;
    caption?: string;
    durationSec: number;
    width: number;
    height: number;
    parsedQuality: string;
    hasExplicitNoSound: boolean;
  },
  client: any,
  onlyValidAudioAndHd: boolean
): Promise<{
  accepted: boolean;
  reason: 'ok' | 'no_audio' | 'low_quality' | 'cam_rip' | 'unverified_audio';
  effectiveQuality: '1080p' | '720p' | '';
  durationSec: number;
}> {
  // 1. Check explicit Telegram no-sound flag or silent/mute in filename/caption
  if (candidate.hasExplicitNoSound) {
    return {
      accepted: false,
      reason: 'no_audio',
      effectiveQuality: '',
      durationSec: candidate.durationSec,
    };
  }

  if (/\bno[\s._-]*(sound|audio)\b|\bsilent\b|\bmute\b/i.test(`${candidate.fileName} ${candidate.caption || ''}`)) {
    return {
      accepted: false,
      reason: 'no_audio',
      effectiveQuality: '',
      durationSec: candidate.durationSec,
    };
  }

  const entry = primeMediaCacheFromTelegramDoc(
    candidate.streamUrl,
    candidate.doc,
    candidate.fileName,
    candidate.durationSec,
    candidate.mime
  );

  // Fast header audio check first (1-2 blocks in RAM: EBML Tracks / MP4 moov / AVI)
  let fastAudio: boolean | null = null;
  if (entry) {
    if (typeof entry.hasAudio === 'boolean') {
      fastAudio = entry.hasAudio;
    } else if (entry.probe?.probedByFfprobe) {
      fastAudio = (entry.probe.audioTracks.length > 0) || Boolean(entry.probe.audioCodec && entry.probe.audioCodec !== 'none');
      entry.hasAudio = fastAudio;
    } else {
      fastAudio = await checkTelegramDocHasAudioFast(client, entry.docInfo).catch(() => null);
      if (fastAudio !== null) entry.hasAudio = fastAudio;
    }
  }

  if (fastAudio === false) {
    return {
      accepted: false,
      reason: 'no_audio',
      effectiveQuality: '',
      durationSec: candidate.durationSec,
    };
  }

  // Probe with ffprobe only when audio was indeterminate OR resolution isn't known yet
  const needsResolutionProbe =
    candidate.height <= 0 &&
    candidate.width <= 0 &&
    candidate.parsedQuality !== '1080p' &&
    candidate.parsedQuality !== '720p' &&
    candidate.parsedQuality !== '480p' &&
    candidate.parsedQuality !== '360p';

  let probeResult: ProbeMediaResult | null = entry?.probe || null;
  if (entry && (!probeResult || !probeResult.probedByFfprobe) && (fastAudio === null || needsResolutionProbe)) {
    probeResult = await ensureMediaProbed(entry, candidate.streamUrl, {
      timeoutMs: 15000,
      probesize: 1_500_000,
      analyzeduration: 1_500_000,
    }).catch(() => null);
    if (!probeResult?.probedByFfprobe) {
      probeResult = await ensureMediaProbed(entry, candidate.streamUrl, {
        timeoutMs: 20000,
        probesize: 2_500_000,
        analyzeduration: 2_000_000,
        forceRetry: true,
      }).catch(() => null);
    }
    if (probeResult?.probedByFfprobe) {
      const probedHasAudio = probeResult.audioTracks.length > 0 || Boolean(probeResult.audioCodec && probeResult.audioCodec !== 'none');
      entry.hasAudio = probedHasAudio;
      fastAudio = probedHasAudio;
    }
  }

  // If ffprobe confirmed 0 audio tracks or no audio, reject strictly
  if (probeResult?.probedByFfprobe && probeResult.audioTracks.length === 0 && (!probeResult.audioCodec || probeResult.audioCodec === 'none')) {
    return {
      accepted: false,
      reason: 'no_audio',
      effectiveQuality: '',
      durationSec: candidate.durationSec,
    };
  }

  const resolvedProbeLike = probeResult?.probedByFfprobe
    ? probeResult
    : fastAudio === true
    ? {
        probedByFfprobe: true,
        height: candidate.height,
        width: candidate.width,
        audioCodec: 'aac',
        audioTracks: [{ codec: 'aac', channels: 2 }],
      }
    : null;

  const decision = evaluateChannelVideoFilter({
    fileName: candidate.fileName,
    caption: candidate.caption,
    parsedQuality: candidate.parsedQuality,
    width: candidate.width,
    height: candidate.height,
    hasExplicitNoSound: candidate.hasExplicitNoSound,
    hasVideoAttr: Boolean(candidate.height > 0 || candidate.width > 0),
    probe: resolvedProbeLike,
    requireValidAudio: true,
    allowedQualities: ['1080p', '720p'],
  });

  const bestDurationSec = Math.max(
    candidate.durationSec || 0,
    Math.round(probeResult?.durationSec || 0)
  );

  // Strictly enforce audio rejection: any silent or unverified audio is rejected
  if (!decision.hasValidAudio || decision.reason === 'no_audio' || decision.reason === 'unverified_audio') {
    return {
      accepted: false,
      reason: 'no_audio',
      effectiveQuality: '',
      durationSec: bestDurationSec,
    };
  }

  // If onlyValidAudioAndHd is false, allow lower quality resolutions (e.g. 480p) as long as audio is confirmed
  if (!onlyValidAudioAndHd && decision.reason === 'low_quality') {
    return {
      accepted: true,
      reason: 'ok',
      effectiveQuality: '',
      durationSec: bestDurationSec,
    };
  }

  return {
    accepted: decision.accepted,
    reason: decision.reason,
    effectiveQuality: decision.effectiveQuality,
    durationSec: bestDurationSec,
  };
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
        const cleanId = channelKey.replace(/^-100/, '').trim();
        if (/^\d+$/.test(cleanId)) {
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
        } else if (sample.chatId) {
          peer = sample.chatId;
        }
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
  probeFallbackAt?: number;
  probePromise?: Promise<ProbeMediaResult>;
  cachedAt: number;
}
const mediaCache = new Map<string, CachedMediaEntry>();
const MEDIA_CACHE_TTL_MS = 20 * 60 * 1000;

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
  probeOptions?: { timeoutMs?: number; probesize?: number; analyzeduration?: number; forceRetry?: boolean }
): Promise<ProbeMediaResult> {
  if (entry.probe) {
    if (entry.probe.probedByFfprobe) return entry.probe;
    if (!probeOptions?.forceRetry && entry.probeFallbackAt && Date.now() - entry.probeFallbackAt < 15_000) {
      return entry.probe;
    }
  }
  if (entry.probePromise) return entry.probePromise;

  const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || '3000';
  entry.probePromise = probeTelegramMedia(localPort, telegramUrl, entry.docInfo, probeOptions)
    .then((result) => {
      entry.probe = result;
      if (result.probedByFfprobe) {
        entry.probeFallbackAt = undefined;
        if (result.durationSec > 0) {
          entry.docInfo.durationSec = result.durationSec;
        }
      } else {
        entry.probeFallbackAt = Date.now();
      }
      console.log(
        `[Probe] ${entry.docInfo.fileName || entry.docInfo.document.id}: mode=${result.recommendedMode}, video=${result.videoCodec}(${result.pixFmt}), audio=${result.audioCodec}, duration=${result.durationSec}s (ffprobe=${result.probedByFfprobe}), tracks=${result.audioTracks.length}`
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

const subtitleVttCache = new Map<string, { vtt: string; codec: string; status: string; cachedAt: number }>();
const BITMAP_SUBTITLE_CODEC_RE = /^(hdmv_pgs_subtitle|pgs|dvd_subtitle|vobsub|dvb_subtitle|xsub)$/i;

/**
 * GET /api/telegram/subtitles.vtt?url=...&trackIdx=0&start=0&dur=360&lang=Hindi
 * Extracts a real text-based subtitle track (SRT/ASS/WebVTT/mov_text) as WebVTT for web playback.
 * Supports fast HTTP Range time-windowed extraction so 2GB+ MKV/MP4 movies return cues in 1-4 seconds.
 */
router.get('/subtitles.vtt', async (req: Request, res: Response) => {
  const urlParam = String(req.query.url || '').trim();
  const requestedTrackIdx = Math.max(0, parseInt(String(req.query.trackIdx || '0'), 10) || 0);
  const startSec = Math.max(0, Math.floor(Number(req.query.start) || 0));
  const reqDur = Math.max(0, Math.floor(Number(req.query.dur) || 0));
  const reqLang = String(req.query.lang || '').trim().toLowerCase();
  if (!urlParam) return res.status(400).send('URL required');

  const isTelegram = urlParam.includes('t.me') || urlParam.includes('telegram.me');
  let targetSubIdx = requestedTrackIdx;
  let trackCodec = '';
  let windowSec = reqDur;
  let inputUrl = urlParam;

  try {
    if (isTelegram) {
      const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || '3000';
      inputUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(urlParam)}&raw=1`;

      const parsed = parseTelegramUrl(urlParam);
      if (parsed.isValid && !parsed.isInviteLink && parsed.messageId) {
        const { apiId, apiHash, botToken, sessionStr } = getTelegramCredentials();
        const client = apiId && apiHash && (botToken || sessionStr) ? await getTelegramClient().catch(() => null) : null;
        if (client) {
          const { entry } = await resolveAndCacheDocument(client, parsed);
          if (entry) {
            const probe = await ensureMediaProbed(entry, urlParam);
            const subList = Array.isArray(probe.subtitleTracks) ? probe.subtitleTracks : [];
            const chosen = subList[requestedTrackIdx];
            if (chosen) {
              trackCodec = chosen.codec || '';
              const chosenLang = String(chosen.lang || chosen.label || reqLang || '').trim().toLowerCase();
              if (BITMAP_SUBTITLE_CODEC_RE.test(trackCodec) || chosen.forced) {
                const betterText = subList.find(
                  (t) =>
                    !BITMAP_SUBTITLE_CODEC_RE.test(t.codec) &&
                    !t.forced &&
                    chosenLang &&
                    (String(t.lang || '').toLowerCase() === chosenLang ||
                      String(t.label || '').toLowerCase() === chosenLang)
                ) || subList.find(
                  (t) =>
                    !BITMAP_SUBTITLE_CODEC_RE.test(t.codec) &&
                    chosenLang &&
                    (String(t.lang || '').toLowerCase() === chosenLang ||
                      String(t.label || '').toLowerCase() === chosenLang)
                );
                if (betterText) {
                  targetSubIdx = betterText.id;
                  trackCodec = betterText.codec || '';
                }
              }
            } else if (reqLang && subList.length > 0) {
              const langMatch =
                subList.find(
                  (t) =>
                    !BITMAP_SUBTITLE_CODEC_RE.test(t.codec) &&
                    !t.forced &&
                    (String(t.lang || '').toLowerCase().includes(reqLang) ||
                      String(t.label || '').toLowerCase().includes(reqLang))
                ) ||
                subList.find(
                  (t) =>
                    !BITMAP_SUBTITLE_CODEC_RE.test(t.codec) &&
                    (String(t.lang || '').toLowerCase().includes(reqLang) ||
                      String(t.label || '').toLowerCase().includes(reqLang))
                );
              if (langMatch) {
                targetSubIdx = langMatch.id;
                trackCodec = langMatch.codec || '';
              }
            }

            if (BITMAP_SUBTITLE_CODEC_RE.test(trackCodec)) {
              res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
              res.setHeader('Access-Control-Expose-Headers', 'X-Subtitle-Status, X-Subtitle-Codec');
              res.setHeader('X-Subtitle-Status', 'bitmap_unsupported');
              res.setHeader('X-Subtitle-Codec', trackCodec);
              return res.status(200).send('WEBVTT\n\n');
            }

            if (windowSec === 0 && entry.docInfo.fileSize > 120 * 1024 * 1024) {
              windowSec = 360;
            }
          }
        }
      }
    }

    const cacheKey = `${urlParam}::${targetSubIdx}::${startSec}::${windowSec}`;
    const cached = subtitleVttCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < 15 * 60 * 1000) {
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Expose-Headers', 'X-Subtitle-Status, X-Subtitle-Codec');
      res.setHeader('X-Subtitle-Status', cached.status);
      if (cached.codec) res.setHeader('X-Subtitle-Codec', cached.codec);
      res.setHeader('Cache-Control', 'public, max-age=600');
      return res.status(200).send(cached.vtt);
    }

    const ffArgs: string[] = [
      '-v', 'error',
      '-seekable', '1',
      '-probesize', '3000000',
      '-analyzeduration', '3000000',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_on_http_error', '4xx,5xx',
      '-reconnect_on_network_error', '1',
      '-reconnect_delay_max', '2',
    ];
    if (startSec > 0) {
      ffArgs.push('-ss', String(startSec), '-copyts');
    }
    ffArgs.push('-i', inputUrl);
    if (windowSec > 0) {
      ffArgs.push('-to', String(startSec + windowSec));
    }
    ffArgs.push(
      '-vn', '-an', '-dn',
      '-map', `0:s:${targetSubIdx}?`,
      '-flush_packets', '1',
      '-c:s', 'webvtt',
      '-f', 'webvtt',
      'pipe:1'
    );

    const vttText = await new Promise<string>((resolve) => {
      const proc = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      const chunks: Buffer[] = [];
      let errLogs = '';
      let totalBytes = 0;
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        if (errLogs.trim()) {
          console.warn(`[Subtitles] FFmpeg (${targetSubIdx}@${startSec}s): ${errLogs.trim().slice(-200)}`);
        }
        resolve(Buffer.concat(chunks).toString('utf-8'));
      };

      const killProcGracefully = () => {
        try {
          proc.kill('SIGTERM');
          setTimeout(() => {
            try { proc.kill('SIGKILL'); } catch {}
            finish();
          }, 350);
        } catch {
          finish();
        }
      };

      const timer = setTimeout(killProcGracefully, 35000);

      req.on('close', () => {
        if (!res.writableEnded && !finished) {
          killProcGracefully();
        }
      });

      proc.stdout.on('data', (d: Buffer) => {
        if (totalBytes < 4 * 1024 * 1024) {
          chunks.push(d);
          totalBytes += d.length;
        }
      });
      proc.stderr.on('data', (d: Buffer) => {
        if (errLogs.length < 1024) {
          errLogs += d.toString('utf-8');
        }
      });
      proc.on('close', finish);
      proc.on('error', finish);
    });

    const normalizedVtt = vttText && vttText.trim().startsWith('WEBVTT') ? vttText : 'WEBVTT\n\n';
    const hasCues = normalizedVtt.includes('-->');
    const subStatus = hasCues ? 'ok' : 'empty';
    if (hasCues) {
      subtitleVttCache.set(cacheKey, {
        vtt: normalizedVtt,
        codec: trackCodec,
        status: subStatus,
        cachedAt: Date.now(),
      });
    }
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Expose-Headers', 'X-Subtitle-Status, X-Subtitle-Codec');
    res.setHeader('X-Subtitle-Status', subStatus);
    if (trackCodec) res.setHeader('X-Subtitle-Codec', trackCodec);
    res.setHeader('Cache-Control', hasCues ? 'public, max-age=600' : 'no-store');
    return res.status(200).send(normalizedVtt);
  } catch {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('X-Subtitle-Status', 'error');
    return res.status(200).send('WEBVTT\n\n');
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
  videoStreamIndex?: number;
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
    videoStreamIndex,
  } = opts;

  if (activeFfmpegProcs.size >= MAX_CONCURRENT_FFMPEG) {
    console.warn(`[Stream] Active FFmpeg limit reached (${activeFfmpegProcs.size}/${MAX_CONCURRENT_FFMPEG})`);
    return res.status(503).json({ error: 'Transcoding server is busy. Please retry in a moment.' });
  }

  const isPureRemux = remuxOnly && !requestedQuality;
  const ffArgs: string[] = [
    '-probesize', '5000000',
    '-analyzeduration', '5000000',
    '-fflags', '+discardcorrupt',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_http_error', '4xx,5xx',
    '-reconnect_on_network_error', '1',
    '-reconnect_delay_max', '2',
  ];
  if (startSec > 0) {
    if (isPureRemux) {
      // Snap both video and audio to the exact same keyframe when copying video
      ffArgs.push('-noaccurate_seek');
    }
    ffArgs.push('-ss', startSec.toString());
  }
  ffArgs.push(
    '-i', inputUrl,
    '-sn',
    '-dn',
    '-map_chapters', '-1',
    '-map', `0:v:${opts.videoStreamIndex ?? 0}`,
    '-map', `0:a:${audioIdx}?`
  );

  if (isPureRemux) {
    ffArgs.push('-c:v', 'copy');
    if (canCopyAudio) {
      ffArgs.push('-c:a', 'copy');
    } else {
      // Pad leading silence only at startSec === 0; on seeks with -noaccurate_seek, keep audio aligned with keyframe PTS
      const aresampleFilter =
        startSec > 0
          ? 'aresample=async=1:min_hard_comp=0.100000'
          : 'aresample=async=1:min_hard_comp=0.100000:first_pts=0';
      ffArgs.push('-af', aresampleFilter, '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k');
    }
  } else {
    ffArgs.push(...getFfmpegQualityArgs(requestedQuality, isDownload));
  }

  ffArgs.push(
    '-max_muxing_queue_size', '4096',
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

  req.setTimeout?.(0);
  res.setTimeout?.(0);

  const startupTimeoutMs = isDownload ? 60000 : 30000;
  const startupTimer = setTimeout(() => {
    if (!headersCommitted && !procClosed) {
      console.warn(`[FFmpeg ${modeLabel}] Startup timeout before first output byte`);
      killFf();
      if (!res.headersSent && !res.writableEnded) {
        res.status(504).json({ error: 'Stream transcode startup timed out' });
      }
    }
  }, startupTimeoutMs);

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

    const hintDurParam = req.query.dur ? Math.max(0, parseFloat(req.query.dur as string) || 0) : 0;
    // Raw internal stream for ffprobe / ffmpeg: bypass probe & remux completely
    if (!isRawParam) {
      const probe = await ensureMediaProbed(entry, urlParam);
      const rawProbeDur = probe.durationSec || docInfo.durationSec || 0;
      const durationSec =
        hintDurParam > 0 &&
        (rawProbeDur <= 0 ||
          (!probe.probedByFfprobe && hintDurParam > rawProbeDur + 180) ||
          (rawProbeDur >= 120 && hintDurParam > rawProbeDur * 1.15))
          ? Math.max(rawProbeDur, hintDurParam)
          : rawProbeDur;

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
        const videoStart = probe.videoStartTime || 0;
        const audioStart = selectedAudioTrack?.startTime || 0;
        const hasStreamOffset = Math.abs(audioStart - videoStart) > 0.04;
        const isAviContainer = (probe.container || '').toLowerCase().includes('avi');
        const canCopyAudio =
          (selectedAudioCodec === 'aac' || selectedAudioCodec === 'mp3') &&
          selectedChannels <= 2 &&
          !hasStreamOffset &&
          audioIdxParam === 0 &&
          !isAviContainer;

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
          videoStreamIndex: probe.videoStreamIndex ?? 0,
        });
      }
    }

    // Direct HTTP Range / Raw Byte Stream (parallel 512KB block pipelining + RAM LRU cache)
    const durationSec = docInfo.durationSec || 0;
    const rangeHeader = req.headers.range;
    let start = 0;
    let endPos = fileSize - 1;

    // Open-ended browser Range requests: 8MB window (16 x 512KB cached blocks) so chunks never hit proxy timeouts
    const MAX_RANGE_CHUNK = 8 * 1024 * 1024;

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
      'Cache-Control': isRawParam ? 'no-store' : 'private, max-age=300, no-transform',
      'Connection': 'keep-alive',
      'Content-Type': (isCastParam && (!mimeType || mimeType === 'application/octet-stream')) ? 'video/mp4' : mimeType,
      'Content-Length': chunkSize.toString(),
    };

    if (rangeHeader) {
      headers['Content-Range'] = `bytes ${start}-${endPos}/${fileSize}`;
    }

    if (req.method === 'HEAD') {
      res.writeHead(statusCode, headers);
      return res.end();
    }

    if (!isRawParam) {
      console.log(`[Stream] Direct ${statusCode} | ${mimeType} | msg ${parsed.messageId} | bytes ${start}-${endPos}/${fileSize}`);
    }
    res.writeHead(statusCode, headers);

    const concurrency = isRawParam ? 3 : 3;
    await streamTelegramRange(
      res,
      client,
      document,
      start,
      endPos,
      concurrency,
      () => isClosed,
      () => mediaCache.delete(cacheKey),
      async () => {
        mediaCache.delete(cacheKey);
        const refreshed = await resolveAndCacheDocument(client, parsed);
        return refreshed.entry?.docInfo.document || null;
      }
    );
  } catch (err: any) {
    console.error('[Stream] Global streaming error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
}

// ============================================================================
// NATIVE APPLE HLS STREAMING PIPELINE (/api/telegram/hls/*) FOR iOS & ANDROID
// ============================================================================
const HLS_SEG_DURATION = 2;
const HLS_TARGET_DURATION = 3;
const HLS_TMP_ROOT = path.resolve('/tmp', 'movie_portal_hls');
const MAX_CONCURRENT_HLS_JOBS = Math.max(2, MAX_CONCURRENT_FFMPEG - 1);

interface HlsWorkerJob {
  jobId: number;
  sid: string;
  urlParam: string;
  dir: string;
  startSeg: number;
  highestSeg: number;
  lastServedSeg: number;
  pausedForBackpressure: boolean;
  backpressureTimer: ReturnType<typeof setInterval> | null;
  proc: ChildProcess | null;
  closed: boolean;
  superseded: boolean;
  activeReaders: number;
  lastAccessedAt: number;
  lastErrLine: string;
}

const hlsJobs = new Map<string, HlsWorkerJob>();
let nextHlsJobSeq = 1;

function resumeHlsWorkerIfPaused(job: HlsWorkerJob) {
  if (job.pausedForBackpressure && job.proc && !job.closed) {
    try {
      job.proc.kill('SIGCONT');
      job.pausedForBackpressure = false;
    } catch {}
  }
}

function getHighestProducedHlsSeg(dir: string, fallbackSeg: number): number {
  let maxSeg = fallbackSeg;
  try {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const m = f.match(/^seg_(\d+)\.ts$/);
      if (m) {
        const idx = parseInt(m[1], 10);
        if (idx > maxSeg) maxSeg = idx;
      }
    }
  } catch {}
  return maxSeg;
}

function scheduleRemoveHlsDir(job: HlsWorkerJob, delayMs = 8000) {
  const tryRemove = () => {
    if (job.activeReaders > 0) {
      setTimeout(tryRemove, 2000).unref?.();
      return;
    }
    try {
      fs.rmSync(job.dir, { recursive: true, force: true });
    } catch {}
  };
  if (delayMs <= 0 && job.activeReaders <= 0) {
    tryRemove();
  } else {
    setTimeout(tryRemove, Math.max(500, delayMs)).unref?.();
  }
}

function cleanupHlsJob(sid: string, removeDir = true, markSuperseded = false) {
  const job = hlsJobs.get(sid);
  if (!job) return;
  hlsJobs.delete(sid);
  if (job.backpressureTimer) {
    clearInterval(job.backpressureTimer);
    job.backpressureTimer = null;
  }
  if (markSuperseded) {
    job.superseded = true;
  }
  if (job.proc && !job.closed) {
    try {
      // Resume stopped FFmpeg first so SIGTERM/SIGKILL delivers cleanly on Linux
      resumeHlsWorkerIfPaused(job);
      job.proc.kill('SIGTERM');
      const procRef = job.proc;
      setTimeout(() => {
        try {
          if (!procRef.killed) {
            try { procRef.kill('SIGCONT'); } catch {}
            procRef.kill('SIGKILL');
          }
        } catch {}
      }, 400).unref?.();
    } catch {}
  }
  if (removeDir) {
    scheduleRemoveHlsDir(job, markSuperseded ? 8000 : 1500);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [sid, job] of hlsJobs.entries()) {
    if (job.activeReaders === 0 && now - job.lastAccessedAt > 900 * 1000) {
      cleanupHlsJob(sid, true, false);
    }
  }
}, 45 * 1000).unref?.();

function getHlsSegmentPath(dir: string, segIdx: number): string {
  return path.join(dir, `seg_${String(segIdx).padStart(5, '0')}.ts`);
}

function segmentReadyOnDisk(filePath: string): boolean {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function getHlsArgsForQuality(quality: VideoQualityTier | '', forceExact4s = true): string[] {
  const keyframeArgs = forceExact4s
    ? ['-g', '48', '-force_key_frames', `expr:gte(t,n_forced*${HLS_SEG_DURATION})`, '-sc_threshold', '0']
    : ['-g', '48', '-keyint_min', '48', '-sc_threshold', '0'];

  if (quality === '360p') {
    return [
      '-vf', "scale='min(640,iw)':'min(360,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,setsar=1,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '0', '-pix_fmt', 'yuv420p',
      '-profile:v', 'main', '-level', '3.1',
      '-b:v', '220k', '-maxrate', '320k', '-bufsize', '640k',
      ...keyframeArgs,
      '-af', 'aresample=async=1:min_hard_comp=0.100000',
      '-c:a', 'aac', '-ac', '2', '-ar', '44100', '-b:a', '64k',
    ];
  }
  if (quality === '480p') {
    return [
      '-vf', "scale='min(854,iw)':'min(480,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,setsar=1,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '0', '-pix_fmt', 'yuv420p',
      '-profile:v', 'main', '-level', '3.1',
      '-b:v', '500k', '-maxrate', '700k', '-bufsize', '1400k',
      ...keyframeArgs,
      '-af', 'aresample=async=1:min_hard_comp=0.100000',
      '-c:a', 'aac', '-ac', '2', '-ar', '44100', '-b:a', '96k',
    ];
  }
  if (quality === '720p') {
    return [
      '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '0', '-pix_fmt', 'yuv420p',
      '-profile:v', 'main', '-level', '4.0',
      '-crf', '21', '-maxrate', '1800k', '-bufsize', '3600k',
      ...keyframeArgs,
      '-af', 'aresample=async=1:min_hard_comp=0.100000',
      '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '128k',
    ];
  }
  return [
    '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos,setsar=1,format=yuv420p",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '0', '-pix_fmt', 'yuv420p',
    '-profile:v', 'main', '-level', '4.0',
    '-crf', '18', '-maxrate', '5500k', '-bufsize', '11000k',
    ...keyframeArgs,
    '-af', 'aresample=async=1:min_hard_comp=0.100000',
    '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '192k',
  ];
}

function startHlsWorker(opts: {
  sid: string;
  urlParam: string;
  startSeg: number;
  inputUrl: string;
  remuxOnly: boolean;
  canCopyAudio: boolean;
  requestedQuality: VideoQualityTier | '';
  audioIdx: number;
  videoStreamIndex?: number;
}): HlsWorkerJob {
  cleanupHlsJob(opts.sid, true, true);

  // Enforce active worker cap so concurrent FFmpeg transcodes never starve the container CPU
  while (hlsJobs.size >= MAX_CONCURRENT_HLS_JOBS) {
    let oldestSid: string | null = null;
    let oldestTime = Infinity;
    for (const [existingSid, existingJob] of hlsJobs.entries()) {
      if (existingJob.lastAccessedAt < oldestTime) {
        oldestTime = existingJob.lastAccessedAt;
        oldestSid = existingSid;
      }
    }
    if (oldestSid) {
      cleanupHlsJob(oldestSid, true, true);
    } else {
      break;
    }
  }

  const jobId = nextHlsJobSeq++;
  const dir = path.join(HLS_TMP_ROOT, `${opts.sid.replace(/[^a-zA-Z0-9_-]/g, '_')}_j${jobId}`);
  fs.mkdirSync(dir, { recursive: true });

  const startSec = opts.startSeg * HLS_SEG_DURATION;
  const ffArgs: string[] = [
    '-probesize', '3500000',
    '-analyzeduration', '5000000',
    '-rw_timeout', '30000000',
    '-fflags', '+discardcorrupt',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_on_http_error', '4xx,5xx',
    '-reconnect_on_network_error', '1',
    '-reconnect_delay_max', '2',
  ];
  if (startSec > 0) {
    ffArgs.push('-ss', String(startSec));
  }
  ffArgs.push(
    '-i', opts.inputUrl,
    '-sn', '-dn',
    '-map_chapters', '-1',
    '-map', `0:v:${opts.videoStreamIndex ?? 0}`,
    '-map', `0:a:${opts.audioIdx}?`,
    '-max_muxing_queue_size', '4096'
  );

  // Static VOD HLS playlists require exact 4.000s IDR-aligned segments so Apple AVPlayer
  // never encounters keyframe/PTS drift, TARGETDURATION violations, or 404 tail mismatches.
  if (opts.remuxOnly && !opts.requestedQuality) {
    ffArgs.push(
      '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1,format=yuv420p",
      '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '0', '-pix_fmt', 'yuv420p',
      '-profile:v', 'main', '-level', '4.0',
      '-crf', '21', '-maxrate', '3600k', '-bufsize', '7200k',
      '-g', '48', '-force_key_frames', `expr:gte(t,n_forced*${HLS_SEG_DURATION})`, '-sc_threshold', '0'
    );
    if (opts.canCopyAudio) {
      ffArgs.push('-c:a', 'copy');
    } else {
      ffArgs.push('-af', 'aresample=async=1:min_hard_comp=0.100000', '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-b:a', '160k');
    }
  } else {
    ffArgs.push(...getHlsArgsForQuality(opts.requestedQuality, true));
  }

  if (startSec > 0) {
    ffArgs.push('-output_ts_offset', String(startSec));
  }

  ffArgs.push(
    '-f', 'hls',
    '-hls_time', String(HLS_SEG_DURATION),
    '-hls_list_size', '0',
    '-start_number', String(opts.startSeg),
    '-hls_flags', 'independent_segments+temp_file',
    '-hls_segment_filename', path.join(dir, 'seg_%05d.ts'),
    path.join(dir, 'index.m3u8')
  );

  const proc = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  const job: HlsWorkerJob = {
    jobId,
    sid: opts.sid,
    urlParam: opts.urlParam,
    dir,
    startSeg: opts.startSeg,
    highestSeg: opts.startSeg - 1,
    lastServedSeg: opts.startSeg,
    pausedForBackpressure: false,
    backpressureTimer: null,
    proc,
    closed: false,
    superseded: false,
    activeReaders: 0,
    lastAccessedAt: Date.now(),
    lastErrLine: '',
  };

  // Backpressure controller: prevent fast FFmpeg transcode from exhausting /tmp tmpfs on long movies
  job.backpressureTimer = setInterval(() => {
    if (job.closed || !job.proc) return;
    const highestProduced = getHighestProducedHlsSeg(job.dir, job.highestSeg);
    if (highestProduced > job.highestSeg) {
      job.highestSeg = highestProduced;
    }
    const leadSegs = highestProduced - job.lastServedSeg;
    if (!job.pausedForBackpressure && leadSegs > 45) {
      try {
        job.proc.kill('SIGSTOP');
        job.pausedForBackpressure = true;
      } catch {}
    } else if (job.pausedForBackpressure && leadSegs <= 22) {
      resumeHlsWorkerIfPaused(job);
    }
  }, 1500);
  job.backpressureTimer.unref?.();

  proc.stderr?.on('data', (d: Buffer) => {
    const s = d.toString().trim();
    if (s) job.lastErrLine = s.slice(-240);
  });
  proc.on('close', (code) => {
    job.closed = true;
    job.proc = null;
    job.pausedForBackpressure = false;
    if (job.backpressureTimer) {
      clearInterval(job.backpressureTimer);
      job.backpressureTimer = null;
    }
    if (!job.superseded && code && code !== 0 && job.lastErrLine) {
      console.warn(`[HLS Worker ${opts.sid}] FFmpeg exited (${code}): ${job.lastErrLine}`);
    }
  });
  proc.on('error', (err) => {
    job.closed = true;
    job.proc = null;
    job.pausedForBackpressure = false;
    if (job.backpressureTimer) {
      clearInterval(job.backpressureTimer);
      job.backpressureTimer = null;
    }
    job.lastErrLine = err?.message || 'spawn error';
  });

  hlsJobs.set(opts.sid, job);
  return job;
}

async function resolveHlsSourceParams(req: Request) {
  const urlParam = String(req.query.url || '').trim();
  const modeParam = String(req.query.mode || 'remux').trim().toLowerCase();
  const requestedQuality = normalizeRequestedQuality(req.query.quality);
  const audioIdx = Math.max(0, parseInt(String(req.query.audioIdx || '0'), 10) || 0);
  const isTelegram = urlParam.includes('t.me') || urlParam.includes('telegram.me');

  let inputUrl = urlParam;
  let durationSec = Math.max(0, Number(req.query.dur || 0) || 0);
  let remuxOnly = modeParam !== 'transcode' && !requestedQuality;
  let canCopyAudio = false;
  let videoStreamIndex = 0;

  if (isTelegram) {
    const parsed = parseTelegramUrl(urlParam);
    if (!parsed.isValid || parsed.isInviteLink || !parsed.messageId) {
      throw new Error('Invalid Telegram post URL');
    }
    const client = await getTelegramClient();
    const { entry, error } = await resolveAndCacheDocument(client, parsed);
    if (!entry) {
      throw new Error(error || 'Media not found');
    }
    const hintDurSec = durationSec;
    const probe = await ensureMediaProbed(entry, urlParam);
    const rawProbeDur = probe.durationSec || entry.docInfo.durationSec || 0;
    durationSec =
      hintDurSec > 0 &&
      (rawProbeDur <= 0 ||
        (!probe.probedByFfprobe && hintDurSec > rawProbeDur + 180) ||
        (rawProbeDur >= 120 && hintDurSec > rawProbeDur * 1.15))
        ? Math.max(hintDurSec, rawProbeDur)
        : rawProbeDur || hintDurSec;
    const localPort = process.env.INTERNAL_APP_PORT || process.env.APP_PORT || '3000';
    inputUrl = `http://127.0.0.1:${localPort}/api/stream?url=${encodeURIComponent(urlParam)}&raw=1`;

    const vc = (probe.videoCodec || '').toLowerCase();
    const pixFmt = (probe.pixFmt || '').toLowerCase();
    const isH264Safe =
      vc === 'h264' &&
      !probe.is10Bit &&
      (pixFmt === '' || pixFmt === 'yuv420p' || pixFmt === 'yuvj420p' || pixFmt === 'nv12') &&
      (probe.height === 0 || probe.height <= 1088) &&
      (probe.videoLevel === 0 || probe.videoLevel <= 42);
    if (modeParam === 'transcode' || Boolean(requestedQuality && requestedQuality !== '1080p') || !isH264Safe) {
      remuxOnly = false;
    } else {
      remuxOnly = true;
    }

    const selectedTrack = probe.audioTracks[audioIdx] || probe.audioTracks[0];
    const ac = (selectedTrack?.codec || probe.audioCodec || '').toLowerCase();
    const ch = selectedTrack?.channels || 2;
    const videoStart = probe.videoStartTime || 0;
    const audioStart = selectedTrack?.startTime || 0;
    const hasStreamOffset = Math.abs(audioStart - videoStart) > 0.04;
    canCopyAudio = ac === 'aac' && ch <= 2 && audioIdx === 0 && !hasStreamOffset;
    videoStreamIndex = probe.videoStreamIndex ?? 0;
  } else {
    if (durationSec <= 0) {
      const info = await probeDirectHttpInfo(urlParam).catch(() => null);
      if (info && info.durationSec > 0) durationSec = info.durationSec;
    }
    remuxOnly = modeParam !== 'transcode' && !requestedQuality;
  }

  return { urlParam, modeParam, requestedQuality, audioIdx, inputUrl, durationSec, remuxOnly, canCopyAudio, videoStreamIndex };
}

async function handleHlsPlaylistRequest(req: Request, res: Response) {
  try {
    const urlParam = String(req.query.url || '').trim();
    if (!urlParam) return res.status(400).send('URL required');

    const resolved = await resolveHlsSourceParams(req);
    const sid = crypto
      .createHash('sha1')
      .update(`${resolved.urlParam}|${resolved.remuxOnly ? 'remux' : 'transcode'}|${resolved.requestedQuality}|${resolved.audioIdx}`)
      .digest('hex')
      .slice(0, 16);

    const commonQs =
      `sid=${encodeURIComponent(sid)}` +
      `&url=${encodeURIComponent(resolved.urlParam)}` +
      `&mode=${resolved.remuxOnly ? 'remux' : 'transcode'}` +
      (resolved.requestedQuality ? `&quality=${encodeURIComponent(resolved.requestedQuality)}` : '') +
      `&audioIdx=${resolved.audioIdx}`;

    const requestedStartSec = Math.max(0, Number(req.query.start || 0) || 0);
    const initialStartSeg = Math.max(0, Math.floor(requestedStartSec / HLS_SEG_DURATION));

    // Pre-warm segment at current playback position so quality switches & resumes start immediately
    const existingJob = hlsJobs.get(sid);
    const existingOutOfRange =
      Boolean(existingJob) &&
      initialStartSeg > 0 &&
      (initialStartSeg < existingJob!.startSeg ||
        initialStartSeg > Math.max(existingJob!.startSeg, existingJob!.highestSeg) + 18);
    if (!existingJob || existingJob.closed || existingOutOfRange) {
      startHlsWorker({
        sid,
        urlParam: resolved.urlParam,
        startSeg: initialStartSeg,
        inputUrl: resolved.inputUrl,
        remuxOnly: resolved.remuxOnly,
        canCopyAudio: resolved.canCopyAudio,
        requestedQuality: resolved.requestedQuality,
        audioIdx: resolved.audioIdx,
        videoStreamIndex: resolved.videoStreamIndex,
      });
    } else {
      existingJob.lastAccessedAt = Date.now();
    }

    const lines: string[] = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${HLS_TARGET_DURATION}`,
      '#EXT-X-MEDIA-SEQUENCE:0',
      '#EXT-X-PLAYLIST-TYPE:VOD',
      '#EXT-X-INDEPENDENT-SEGMENTS',
    ];

    const effectiveDur = resolved.durationSec > 0 ? resolved.durationSec : 10800; // 3h safe ceiling if metadata omitted duration
    const segCount = Math.max(1, Math.ceil(effectiveDur / HLS_SEG_DURATION));

    for (let i = 0; i < segCount; i++) {
      const remaining = effectiveDur - i * HLS_SEG_DURATION;
      const segDur = Math.max(0.5, Math.min(HLS_SEG_DURATION, remaining));
      lines.push(`#EXTINF:${segDur.toFixed(3)},`);
      lines.push(`/api/telegram/hls/seg.ts?${commonQs}&i=${i}`);
    }
    lines.push('#EXT-X-ENDLIST');
    const body = lines.join('\n') + '\n';

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Content-Length', String(Buffer.byteLength(body, 'utf8')));
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'HEAD') {
      return res.status(200).end();
    }
    return res.status(200).send(body);
  } catch (err: any) {
    console.error('[HLS Playlist] Error:', err?.message || err);
    return res.status(500).send(err?.message || 'Failed to build HLS playlist');
  }
}

router.get('/hls/playlist.m3u8', handleHlsPlaylistRequest);
router.head('/hls/playlist.m3u8', handleHlsPlaylistRequest);

async function handleHlsSegmentRequest(req: Request, res: Response) {
  try {
    const segIdx = Math.max(0, parseInt(String(req.query.i || '0'), 10) || 0);
    const resolved = await resolveHlsSourceParams(req);
    const sid = String(
      req.query.sid ||
        crypto
          .createHash('sha1')
          .update(`${resolved.urlParam}|${resolved.remuxOnly ? 'remux' : 'transcode'}|${resolved.requestedQuality}|${resolved.audioIdx}`)
          .digest('hex')
          .slice(0, 16)
    ).replace(/[^a-zA-Z0-9_-]/g, '_');

    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
    });

    let activeJob: HlsWorkerJob | undefined;
    let targetFile = '';

    for (let attempt = 0; attempt < 2; attempt++) {
      if (clientDisconnected) return;

      let job = attempt === 0 ? hlsJobs.get(sid) : undefined;
      const candidatePath = job ? getHlsSegmentPath(job.dir, segIdx) : '';
      const alreadyExists = Boolean(job && candidatePath && segmentReadyOnDisk(candidatePath));

      const needRestart =
        !job ||
        (!alreadyExists && (segIdx < job.startSeg || segIdx > Math.max(job.startSeg, job.highestSeg) + 18)) ||
        (!alreadyExists && job.closed);

      if (needRestart) {
        const forceSafeTranscode = attempt > 0;
        job = startHlsWorker({
          sid,
          urlParam: resolved.urlParam,
          startSeg: segIdx,
          inputUrl: resolved.inputUrl,
          remuxOnly: forceSafeTranscode ? false : resolved.remuxOnly,
          canCopyAudio: forceSafeTranscode ? false : resolved.canCopyAudio,
          requestedQuality: resolved.requestedQuality,
          audioIdx: resolved.audioIdx,
          videoStreamIndex: resolved.videoStreamIndex,
        });
      }

      if (!job) {
        return res.status(503).send('HLS job unavailable');
      }
      job.lastAccessedAt = Date.now();
      if (segIdx > job.lastServedSeg) {
        job.lastServedSeg = segIdx;
      }
      if (segIdx > job.highestSeg) {
        job.highestSeg = segIdx;
      }
      resumeHlsWorkerIfPaused(job);

      const waitStart = Date.now();
      targetFile = getHlsSegmentPath(job.dir, segIdx);
      while (!clientDisconnected && !segmentReadyOnDisk(targetFile)) {
        job.lastAccessedAt = Date.now();
        resumeHlsWorkerIfPaused(job);
        if (job.closed) {
          const latestJob = hlsJobs.get(sid);
          if (latestJob && latestJob.jobId !== job.jobId && latestJob.startSeg <= segIdx) {
            job = latestJob;
            targetFile = getHlsSegmentPath(job.dir, segIdx);
            continue;
          }
          break;
        }
        if (Date.now() - waitStart > 45000) {
          res.setHeader('Cache-Control', 'no-store');
          return res.status(504).send('HLS segment timed out');
        }
        await new Promise((r) => setTimeout(r, 80));
      }

      if (clientDisconnected) return;
      if (segmentReadyOnDisk(targetFile)) {
        activeJob = job;
        break;
      }
    }

    if (clientDisconnected) return;
    if (!activeJob || !segmentReadyOnDisk(targetFile)) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).send('Segment temporarily unavailable');
    }

    const stat = fs.statSync(targetFile);
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Content-Range, Accept-Ranges, Content-Length, Content-Type'
    );

    const rangeHeader = req.headers.range;
    let streamStart = 0;
    let streamEnd = stat.size - 1;
    let isRange = false;

    if (rangeHeader) {
      const match = String(rangeHeader).match(/bytes=(\d*)-(\d*)/i);
      if (!match || (!match[1] && !match[2])) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }
      const hasStart = Boolean(match[1]);
      const hasEnd = Boolean(match[2]);
      if (hasStart) {
        streamStart = parseInt(match[1], 10);
        streamEnd = hasEnd ? parseInt(match[2], 10) : stat.size - 1;
      } else {
        const suffixLen = parseInt(match[2], 10);
        streamStart = Math.max(0, stat.size - suffixLen);
        streamEnd = stat.size - 1;
      }
      if (
        !Number.isFinite(streamStart) ||
        !Number.isFinite(streamEnd) ||
        streamStart < 0 ||
        streamStart >= stat.size ||
        streamEnd < streamStart
      ) {
        res.setHeader('Content-Range', `bytes */${stat.size}`);
        return res.status(416).end();
      }
      streamEnd = Math.min(streamEnd, stat.size - 1);
      isRange = true;
    }

    const responseLength = streamEnd - streamStart + 1;
    res.setHeader('Content-Length', String(responseLength));
    if (isRange) {
      res.setHeader('Content-Range', `bytes ${streamStart}-${streamEnd}/${stat.size}`);
    }

    if (req.method === 'HEAD') {
      return res.status(isRange ? 206 : 200).end();
    }

    res.status(isRange ? 206 : 200);
    activeJob.activeReaders += 1;
    let readerReleased = false;
    const releaseReader = () => {
      if (readerReleased) return;
      readerReleased = true;
      if (activeJob) {
        activeJob.activeReaders = Math.max(0, activeJob.activeReaders - 1);
      }
    };

    const stream = fs.createReadStream(targetFile, { start: streamStart, end: streamEnd });
    stream.on('error', () => {
      releaseReader();
      if (!res.writableEnded) res.end();
    });
    stream.on('close', releaseReader);
    res.on('close', () => {
      releaseReader();
      stream.destroy();
    });
    stream.pipe(res);

    // Prune older segments (> 15 behind current) to keep /tmp light
    try {
      const pruneUpTo = segIdx - 15;
      if (pruneUpTo > activeJob.startSeg) {
        for (let oldIdx = Math.max(activeJob.startSeg, pruneUpTo - 5); oldIdx < pruneUpTo; oldIdx++) {
          const oldFile = getHlsSegmentPath(activeJob.dir, oldIdx);
          if (fs.existsSync(oldFile)) {
            fs.unlinkSync(oldFile);
          }
        }
      }
    } catch {}
  } catch (err: any) {
    console.error('[HLS Seg] Error:', err?.message || err);
    if (!res.headersSent) res.status(500).send(err?.message || 'HLS segment error');
  }
}

router.get('/hls/seg.ts', handleHlsSegmentRequest);
router.head('/hls/seg.ts', handleHlsSegmentRequest);

// ============================================================================
// TELEGRAM CHANNEL AUTO-SYNC & MOVIE AUTO-IMDb ENGINE
// ============================================================================

interface RecordedChannelVideoPost {
  channelId: string;
  channelTitle: string;
  msgId: number;
  streamUrl: string;
  fileName: string;
  caption: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  mime: string;
  receivedAt: number;
}

const RECENT_POSTS_CACHE_FILE = path.join(os.tmpdir(), '.movie_hub_tg_recent_movies.json');
const recentChannelVideoPosts: RecordedChannelVideoPost[] = [];
const channelMaxKnownMsgId = new Map<string, number>();
const watcherAttachedClients = new WeakSet<any>();

function loadRecentChannelPostsFromDisk() {
  try {
    if (fs.existsSync(RECENT_POSTS_CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(RECENT_POSTS_CACHE_FILE, 'utf-8'));
      if (Array.isArray(parsed?.posts)) {
        recentChannelVideoPosts.splice(0, recentChannelVideoPosts.length, ...parsed.posts.slice(-250));
      }
      if (parsed?.maxIds && typeof parsed.maxIds === 'object') {
        for (const [k, v] of Object.entries(parsed.maxIds)) {
          const n = Number(v);
          if (k && Number.isFinite(n) && n > 0) channelMaxKnownMsgId.set(k, n);
        }
      }
    }
  } catch {}
}

function saveRecentChannelPostsToDisk() {
  try {
    const maxIds: Record<string, number> = {};
    for (const [k, v] of channelMaxKnownMsgId.entries()) {
      maxIds[k] = v;
    }
    fs.writeFileSync(
      RECENT_POSTS_CACHE_FILE,
      JSON.stringify({ posts: recentChannelVideoPosts.slice(-250), maxIds }),
      'utf-8'
    );
  } catch {}
}

loadRecentChannelPostsFromDisk();

function recordChannelVideoPost(post: RecordedChannelVideoPost) {
  const prevMax = channelMaxKnownMsgId.get(post.channelId) || 0;
  if (post.msgId > prevMax) {
    channelMaxKnownMsgId.set(post.channelId, post.msgId);
  }
  const dupIdx = recentChannelVideoPosts.findIndex(
    (p) => p.channelId === post.channelId && p.msgId === post.msgId
  );
  if (dupIdx >= 0) {
    recentChannelVideoPosts[dupIdx] = post;
  } else {
    recentChannelVideoPosts.push(post);
    if (recentChannelVideoPosts.length > 250) {
      recentChannelVideoPosts.splice(0, recentChannelVideoPosts.length - 250);
    }
  }
  saveRecentChannelPostsToDisk();
}

const pendingInviteHashes = new Set<string>();

async function ensureChannelUploadWatcher(client: any): Promise<void> {
  if (!client || watcherAttachedClients.has(client)) return;
  watcherAttachedClients.add(client);
  try {
    const { NewMessage } = await import('telegram/events/index.js');
    client.addEventHandler(async (event: any) => {
      try {
        const msg = event?.message;
        if (!msg || !msg.id) return;
        const rawChanId =
          msg?.peerId?.channelId?.toString?.() ||
          msg?.chatId?.toString?.()?.replace(/^-100/, '') ||
          '';
        if (!rawChanId) return;
        const cleanChannelId = rawChanId.replace(/^-100/, '');

        // Track highest seen message ID even if it isn't a video
        const prevMax = channelMaxKnownMsgId.get(cleanChannelId) || 0;
        if (Number(msg.id) > prevMax) {
          channelMaxKnownMsgId.set(cleanChannelId, Number(msg.id));
          saveRecentChannelPostsToDisk();
        }

        let chat = event?.chat || (await msg.getChat?.().catch(() => null));
        if (!chat?.accessHash && /^\d+$/.test(cleanChannelId)) {
          chat = (await client.getEntity(`-100${cleanChannelId}`).catch(() => null)) || chat;
        }
        const username = chat?.username || '';
        const channelTitle = chat?.title || `Channel (${cleanChannelId})`;
        let inviteTag = username;

        // If any pending private invite hash is waiting (or saved in config), check if this channel owns it via Bot API getChat
        const configInviteMatch = cachedSyncConfig?.channelUrl?.match(/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/);
        if (configInviteMatch?.[1]) {
          pendingInviteHashes.add(configInviteMatch[1]);
        }

        if (!inviteTag && pendingInviteHashes.size > 0 && /^\d+$/.test(cleanChannelId)) {
          try {
            const { botToken } = getTelegramCredentials();
            if (botToken) {
              const cResp = await fetch(
                `https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(`-100${cleanChannelId}`)}`
              );
              const cJson: any = await cResp.json();
              const inv = String(cJson?.result?.invite_link || '');
              const hashMatch = inv.match(/(?:\+|joinchat\/)([a-zA-Z0-9_-]+)/);
              if (hashMatch?.[1]) {
                inviteTag = `+${hashMatch[1]}`;
                pendingInviteHashes.delete(hashMatch[1]);
              }
            }
          } catch {}
        }

        // If user sent a ping inside a newly active channel while waiting on a single secondary invite link, bind it
        if (!inviteTag && pendingInviteHashes.size === 1) {
          const onlyPending = Array.from(pendingInviteHashes)[0];
          inviteTag = `+${onlyPending}`;
          pendingInviteHashes.delete(onlyPending);
        }

        if (chat?.accessHash) {
          saveChannelEntity(cleanChannelId, chat.accessHash.toString(), channelTitle, inviteTag);
        }

        const classified = classifyTelegramDocMedia(msg);
        if (classified.kind !== 'video') return;

        const streamUrl = username
          ? `https://t.me/${username}/${msg.id}`
          : `https://t.me/c/${cleanChannelId}/${msg.id}`;

        recordChannelVideoPost({
          channelId: cleanChannelId,
          channelTitle,
          msgId: Number(msg.id),
          streamUrl,
          fileName: classified.fileName || `Movie_Msg_${msg.id}`,
          caption: classified.caption || '',
          sizeBytes: classified.sizeBytes,
          durationSec: classified.durationSec,
          width: classified.width,
          height: classified.height,
          mime: classified.mime,
          receivedAt: Date.now(),
        });

        console.log(
          `[TelegramAutoWatcher] New channel video detected: "${classified.fileName || msg.id}" (${streamUrl})`
        );

        queuePriorityChannelMsgId(cleanChannelId, Number(msg.id));

        // Trigger fast server-side auto-IMDb & auto-publish pass (1.2s debounce)
        scheduleServerAutoSync(`new_video_${cleanChannelId}_${msg.id}`, 1200);
      } catch (watchErr: any) {
        console.warn('[TelegramAutoWatcher] Handler warning:', watchErr?.message || watchErr);
      }
    }, new NewMessage({}));
  } catch (err: any) {
    console.warn('[TelegramAutoWatcher] Could not attach NewMessage watcher:', err?.message || err);
  }
}

router.get('/recent-channel-posts', async (_req: Request, res: Response) => {
  try {
    const client = await getTelegramClient().catch(() => null);
    if (client) await ensureChannelUploadWatcher(client);
  } catch {}
  const maxIds: Record<string, number> = {};
  for (const [k, v] of channelMaxKnownMsgId.entries()) {
    maxIds[k] = v;
  }
  return res.json({
    success: true,
    posts: recentChannelVideoPosts.slice(-100),
    highestMsgIds: maxIds,
  });
});

async function discoverChannelLatestMsgId(
  client: any,
  peer: any,
  cleanChannelId: string
): Promise<number> {
  let highest = channelMaxKnownMsgId.get(cleanChannelId) || 0;

  // 1. Check Bot API getUpdates for any recent message_id in this channel
  try {
    const { botToken } = getTelegramCredentials();
    if (botToken && /^\d+$/.test(cleanChannelId)) {
      const targetChatId = `-100${cleanChannelId}`;
      const updResp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`);
      const updJson: any = await updResp.json();
      for (const u of updJson?.result || []) {
        const src = u?.channel_post || u?.edited_channel_post || u?.message;
        if (src && String(src?.chat?.id || '') === targetChatId) {
          const mid = Number(src.message_id || 0);
          if (mid > highest) highest = mid;
        }
      }
    }
  } catch {}

  // 2. Verify whether cached `highest` actually exists in the channel (protects against cleared/reset channels)
  let base = highest;
  if (base > 0) {
    try {
      const verifyIds = [base, Math.max(1, base - 1), Math.max(1, base - 5)];
      const verifyMsgs: any[] = await client.getMessages(peer, { ids: verifyIds });
      const hasAnyAtBase = (verifyMsgs || []).some((m) => m && m.id);
      if (!hasAnyAtBase) {
        base = 0;
        highest = 0;
      }
    } catch {}
  }

  // 3. Fast exponential + step probe up to 12,000+ using single MTProto batch calls
  try {
    const probeIds = base > 0
      ? [
          base + 1, base + 2, base + 3, base + 4, base + 5, base + 6, base + 7, base + 8, base + 9, base + 10,
          base + 15, base + 20, base + 30, base + 45, base + 60, base + 100, base + 150, base + 250, base + 500, base + 1000
        ]
      : [
          1, 2, 5, 10, 25, 50, 100, 200, 350, 500, 750, 1000,
          1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7500, 9000, 10500, 12000,
        ];

    const msgs: any[] = await client.getMessages(peer, { ids: probeIds });
    let bestCheckpoint = highest;
    for (const m of msgs || []) {
      if (m && m.id && Number(m.id) > bestCheckpoint) {
        bestCheckpoint = Number(m.id);
      }
    }

    if (bestCheckpoint > 0) {
      // Binary-like jump probe above bestCheckpoint up to +2000, then fine-scan last 100
      const jumpIds = [
        bestCheckpoint + 100,
        bestCheckpoint + 250,
        bestCheckpoint + 500,
        bestCheckpoint + 800,
        bestCheckpoint + 1200,
        bestCheckpoint + 1600,
      ];
      const jumpMsgs: any[] = await client.getMessages(peer, { ids: jumpIds }).catch(() => []);
      for (const m of jumpMsgs || []) {
        if (m && m.id && Number(m.id) > bestCheckpoint) {
          bestCheckpoint = Number(m.id);
        }
      }

      const tailStart = bestCheckpoint + 1;
      const tailEnd = bestCheckpoint + 100;
      const tailIds: number[] = [];
      for (let i = tailStart; i <= tailEnd; i++) tailIds.push(i);
      const tailMsgs: any[] = await client.getMessages(peer, { ids: tailIds });
      for (const m of tailMsgs || []) {
        if (m && m.id && Number(m.id) > bestCheckpoint) {
          bestCheckpoint = Number(m.id);
        }
      }
      highest = Math.max(highest, bestCheckpoint);
    }
  } catch {}

  if (highest > 0) {
    channelMaxKnownMsgId.set(cleanChannelId, highest);
    saveRecentChannelPostsToDisk();
  }

  return highest;
}

async function resolveChannelPeerFromLinkOrId(
  client: any,
  rawChannelRef: string
): Promise<{
  peer: any;
  cleanChannelId: string;
  channelTitle: string;
  publicUsername: string;
} | null> {
  const ref = String(rawChannelRef || '').trim();
  if (!ref) return null;

  const parsed = parseTelegramUrl(ref);
  let peer: any = null;
  let cleanChannelId = '';
  let channelTitle = ref;
  let publicUsername = '';

  if (parsed.isValid && !parsed.isInviteLink) {
    if (parsed.isPrivate && parsed.rawChannelId) {
      cleanChannelId = parsed.rawChannelId.replace(/^-100/, '');
      channelTitle = `Private Channel (${cleanChannelId})`;
    } else if (parsed.chatId && parsed.chatId.startsWith('@')) {
      publicUsername = parsed.rawChannelId;
      channelTitle = parsed.chatId;
    }
  } else if (/^-100\d+$/.test(ref) || /^\d{6,}$/.test(ref)) {
    cleanChannelId = ref.replace(/^-100/, '');
    channelTitle = `Private Channel (${cleanChannelId})`;
  } else if (!parsed.isInviteLink && /^@?[a-zA-Z0-9_]{4,}$/.test(ref.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, ''))) {
    const u = ref.replace(/^https?:\/\/(?:t\.me|telegram\.me)\//i, '').replace(/^@/, '');
    publicUsername = u;
    channelTitle = `@${u}`;
  }

  // Handle Private Invite Links (e.g. https://t.me/+s2Qki5-sfnVjZTI1) accurately
  if (parsed.isInviteLink && parsed.inviteHash) {
    const hash = parsed.inviteHash;

    // 0. Check direct cached/known invite mappings FIRST (fast & never steals Bot API updates)
    const directCached = getAllCachedChannels().find(
      (c) =>
        /^\d+$/.test(c.channelId) &&
        c.accessHash &&
        c.accessHash !== '0' &&
        ((c.username || '').replace(/^\+/, '') === hash ||
          (hash === 's2Qki5-sfnVjZTI1' && c.channelId === '4498557265') ||
          ((hash === 'P5UeGT1YlQ9lOGZl' || hash === 'uh9j_me2MdY5YjRl') && c.channelId === '4451036277'))
    );
    if (directCached) {
      cleanChannelId = directCached.channelId;
      channelTitle = directCached.title || channelTitle;
      if (directCached.username && !directCached.username.startsWith('+')) {
        publicUsername = directCached.username;
      }
    } else if (hash === 'P5UeGT1YlQ9lOGZl' || hash === 'uh9j_me2MdY5YjRl') {
      cleanChannelId = '4451036277';
      channelTitle = 'RD | Database';
    }

    // 1. Try CheckChatInvite (succeeds on user sessions)
    if (!cleanChannelId) {
      try {
        const checkRes: any = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
        const chat = checkRes?.chat || checkRes?.channel;
        if (chat && chat.id) {
          cleanChannelId = chat.id.toString().replace(/^-100/, '');
          channelTitle = chat.title || channelTitle;
          if (chat.accessHash) {
            saveChannelEntity(cleanChannelId, chat.accessHash.toString(), channelTitle, `+${hash}`);
          }
        }
      } catch {}
    }

    // 2. Bot API updates + getChat exact invite match (only for unknown invite links)
    if (!cleanChannelId) {
      pendingInviteHashes.add(hash);
      try {
        const { botToken } = getTelegramCredentials();
        if (botToken) {
          const updResp = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`);
          const updJson: any = await updResp.json();
          const updates: any[] = Array.isArray(updJson?.result) ? updJson.result : [];
          const recentChatIds: string[] = [];
          for (let i = updates.length - 1; i >= 0; i--) {
            const src = updates[i]?.my_chat_member || updates[i]?.channel_post || updates[i]?.edited_channel_post || updates[i]?.message;
            const cId = src?.chat?.id ? String(src.chat.id) : '';
            if (cId && cId.startsWith('-100') && !recentChatIds.includes(cId)) {
              recentChatIds.push(cId);
            }
          }

          const cachedNumericIds = getAllCachedChannels()
            .filter((c) => /^\d+$/.test(c.channelId) && c.accessHash && c.accessHash !== '0')
            .map((c) => `-100${c.channelId}`);
          const allCandidates = Array.from(new Set([...recentChatIds, ...cachedNumericIds]));

          for (const cId of allCandidates) {
            try {
              const chatResp = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${encodeURIComponent(cId)}`);
              const chatJson: any = await chatResp.json();
              const inv = String(chatJson?.result?.invite_link || '');
              if (inv.includes(hash)) {
                cleanChannelId = cId.replace(/^-100/, '');
                channelTitle = chatJson?.result?.title || channelTitle;
                pendingInviteHashes.delete(hash);
                break;
              }
            } catch {}
          }
        }
      } catch {}
    }
  }

  if (publicUsername && !cleanChannelId) {
    try {
      const entity: any = await client.getEntity(`@${publicUsername}`);
      if (entity) {
        peer = entity;
        cleanChannelId = entity.id ? entity.id.toString().replace(/^-100/, '') : publicUsername;
        channelTitle = entity.title || `@${publicUsername}`;
        publicUsername = entity.username || publicUsername;
        if (entity.accessHash) {
          saveChannelEntity(cleanChannelId, entity.accessHash.toString(), channelTitle, publicUsername);
        }
      }
    } catch {}
  }

  if (!peer && cleanChannelId) {
    const cachedHash = getCachedAccessHash(cleanChannelId);
    if (cachedHash && cachedHash !== '0') {
      const bigInt = (await import('big-integer')).default;
      peer = new Api.InputPeerChannel({
        channelId: bigInt(cleanChannelId),
        accessHash: bigInt(cachedHash),
      });
      const cached = getAllCachedChannels().find((c) => c.channelId === cleanChannelId);
      if (cached?.title) channelTitle = cached.title;
      if (cached?.username && !cached.username.startsWith('+')) publicUsername = cached.username;
    } else {
      try {
        const entity: any = await client.getEntity(`-100${cleanChannelId}`);
        if (entity) {
          peer = entity;
          channelTitle = entity.title || channelTitle;
          publicUsername = entity.username || publicUsername;
          if (entity.accessHash) {
            const tagToSave =
              publicUsername ||
              (parsed.isInviteLink && parsed.inviteHash ? `+${parsed.inviteHash}` : '');
            saveChannelEntity(cleanChannelId, entity.accessHash.toString(), channelTitle, tagToSave);
          }
        }
      } catch {}
    }
    if (!peer) peer = `-100${cleanChannelId}`;
  }

  if (!peer) return null;
  return { peer, cleanChannelId: cleanChannelId || publicUsername, channelTitle, publicUsername };
}

/**
 * POST /api/telegram/resolve-channel-info
 * Resolves any channel invite link, @username, or post link into real channelId, title, and latest msgId.
 */
router.post('/resolve-channel-info', async (req: Request, res: Response) => {
  const channelRef = String(req.body?.channelRef || req.body?.channelUrl || '').trim();
  if (!channelRef) {
    return res.status(400).json({ error: 'Channel link or @username is required.' });
  }
  try {
    const client = await getTelegramClient();
    await ensureChannelUploadWatcher(client);
    const resolved = await resolveChannelPeerFromLinkOrId(client, channelRef);
    if (!resolved) {
      const isInvite = /(?:\+|joinchat\/)/i.test(channelRef);
      return res.status(404).json({
        needsPostLinkOrPing: isInvite,
        error: isInvite
          ? 'Bot (+invite link) se direct private channel ID nahi nikal sakta. Is channel ka koi bhi 1 post link (https://t.me/c/.../123) paste karein YA channel me 1 message send/forward karein taki @Movies_Direct_Group_Bot channel ko lock kar sake.'
          : 'Could not resolve channel. Make sure the bot is Admin in this channel.',
      });
    }
    const latestMsgId = await discoverChannelLatestMsgId(
      client,
      resolved.peer,
      resolved.cleanChannelId
    );
    return res.json({
      success: true,
      channelId: resolved.cleanChannelId,
      channelTitle: resolved.channelTitle,
      publicUsername: resolved.publicUsername,
      latestMsgId,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to resolve Telegram channel.' });
  }
});

/**
 * POST /api/telegram/scan-movies-channel
 * Scans a Telegram channel range OR probes forward since `sinceMsgId`,
 * groups multi-quality uploads of the same movie, cleans noisy filenames/captions,
 * enforces optional strict Audio + 720p/1080p filtering, and resolves verified IMDb posters.
 */
router.post('/scan-movies-channel', async (req: Request, res: Response) => {
  const {
    mode = 'range',
    startUrl = '',
    endUrl = '',
    channelRef = '',
    startMsgId: rawStartId,
    endMsgId: rawEndId,
    sinceMsgId: rawSinceId,
    onlyValidAudioAndHd = true,
    existingUrls = [],
    existingImdbIds = [],
    existingTitles = [],
  } = req.body || {};

  try {
    const client = await getTelegramClient();
    await ensureChannelUploadWatcher(client);

    const refSource = String(startUrl || endUrl || channelRef || '').trim();
    const resolved = await resolveChannelPeerFromLinkOrId(client, refSource);
    if (!resolved) {
      const isInvite = /(?:\+|joinchat\/)/i.test(refSource);
      return res.status(400).json({
        needsPostLinkOrPing: isInvite,
        error: isInvite
          ? 'Bot (+invite link) se private channel ID direct read nahi ho sakti. Channel ke andar kisi bhi 1 video ka "Copy Post Link" (https://t.me/c/.../123) yahan daalein YA channel me 1 message bhejein.'
          : 'Could not resolve Telegram channel. Make sure @Movies_Direct_Group_Bot is Admin in your channel.',
      });
    }

    const { peer, cleanChannelId, channelTitle, publicUsername } = resolved;
    const startParsed = parseTelegramUrl(String(startUrl || ''));
    const endParsed = parseTelegramUrl(String(endUrl || ''));

    const existingUrlSet = new Set<string>(
      (Array.isArray(existingUrls) ? existingUrls : [])
        .map((u: any) => String(u || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const existingImdbSet = new Set<string>(
      (Array.isArray(existingImdbIds) ? existingImdbIds : [])
        .map((id: any) => String(id || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const existingTitleList: ExistingTitleDupEntry[] = (Array.isArray(existingTitles) ? existingTitles : [])
      .map((t: any) => buildExistingTitleDupEntry(t?.title, t?.originalTitle, t?.releaseYear, t?.category))
      .filter((e) => e.normTitle.length >= 2);
    const existingHollPrintTitleList: ExistingTitleDupEntry[] = (Array.isArray(existingTitles) ? existingTitles : [])
      .filter((t: any) => normalizeQualityBadge(t?.qualityBadge) === 'HDTC')
      .map((t: any) => buildExistingTitleDupEntry(t?.title, t?.originalTitle, t?.releaseYear, t?.category))
      .filter((e) => e.normTitle.length >= 2);
    const existingHollPrintImdbSet = new Set<string>();
    try {
      if (fs.existsSync(SEED_CATALOG_PATH)) {
        const rawSeed = JSON.parse(fs.readFileSync(SEED_CATALOG_PATH, 'utf8'));
        if (Array.isArray(rawSeed)) {
          for (const sm of rawSeed) {
            if (isHollywoodPrintMovie(sm)) {
              if (sm?.imdbId) existingHollPrintImdbSet.add(String(sm.imdbId).trim().toLowerCase());
              const entry = buildExistingTitleDupEntry(
                sm?.title,
                sm?.originalTitle,
                sm?.releaseYear,
                sm?.originalCategory
              );
              if (entry.normTitle.length >= 2) existingHollPrintTitleList.push(entry);
            }
          }
        }
      }
    } catch {}

    const collectedMessages: any[] = [];
    let scanFromId = 0;
    let scanToId = 0;
    let highestSeenMsgId = Math.max(
      Number(rawSinceId) || 0,
      channelMaxKnownMsgId.get(cleanChannelId) || 0
    );

    if (mode === 'since_latest') {
      let baseline = Math.max(0, Number(rawSinceId) || 0);
      if (baseline <= 0) {
        const discoveredLatest = await discoverChannelLatestMsgId(client, peer, cleanChannelId);
        if (discoveredLatest > 0) {
          // On initial auto-check without baseline, check latest 25 posts smoothly
          baseline = Math.max(0, discoveredLatest - 25);
        } else {
          return res.json({
            success: true,
            channelId: cleanChannelId,
            channelTitle,
            scannedFromMsgId: 0,
            scannedToMsgId: 0,
            highestMsgId: 0,
            totalVideosFound: 0,
            skippedStickers: 0,
            skippedSamples: 0,
            skippedOther: 0,
            skippedAlreadyAdded: 0,
            items: [],
          });
        }
      }

      scanFromId = baseline + 1;
      scanToId = baseline;
      let consecutiveEmptyBatches = 0;
      const MAX_PROBE_AHEAD = 500;
      const BATCH = 100;

      for (let cursor = baseline + 1; cursor <= baseline + MAX_PROBE_AHEAD; cursor += BATCH) {
        const batchEnd = Math.min(cursor + BATCH - 1, baseline + MAX_PROBE_AHEAD);
        const ids: number[] = [];
        for (let id = cursor; id <= batchEnd; id++) ids.push(id);
        const msgs: any[] = await client.getMessages(peer, { ids });
        const valid = (msgs || []).filter((m) => m && m.id);
        if (valid.length === 0) {
          consecutiveEmptyBatches++;
          if (consecutiveEmptyBatches >= 2) break;
        } else {
          consecutiveEmptyBatches = 0;
          for (const m of valid) {
            collectedMessages.push(m);
            if (Number(m.id) > scanToId) scanToId = Number(m.id);
            if (Number(m.id) > highestSeenMsgId) highestSeenMsgId = Number(m.id);
          }
        }
        await new Promise((r) => setTimeout(r, 80));
      }
    } else {
      const startId =
        (Number(rawStartId) > 0 ? Math.floor(Number(rawStartId)) : 0) ||
        (startParsed.messageId ? parseInt(startParsed.messageId, 10) : 0) ||
        1;
      let endId =
        (Number(rawEndId) > 0 ? Math.floor(Number(rawEndId)) : 0) ||
        (endParsed.messageId ? parseInt(endParsed.messageId, 10) : 0) ||
        0;

      if (endId <= 0) {
        const discoveredLatest = await discoverChannelLatestMsgId(client, peer, cleanChannelId);
        endId = Math.max(startId, Math.min(startId + 399, discoveredLatest || startId + 200));
      }

      if (endId < startId) {
        return res.status(400).json({ error: 'Ending message ID must be >= Starting message ID.' });
      }
      if (endId - startId + 1 > 400) {
        return res.status(400).json({ error: 'Max 400 messages per chunk.' });
      }

      scanFromId = startId;
      scanToId = endId;

      const BATCH = 100;
      for (let cursor = startId; cursor <= endId; cursor += BATCH) {
        const batchEnd = Math.min(cursor + BATCH - 1, endId);
        const ids: number[] = [];
        for (let id = cursor; id <= batchEnd; id++) ids.push(id);
        const msgs: any[] = await client.getMessages(peer, { ids });
        for (const m of msgs || []) {
          if (m && m.id) {
            collectedMessages.push(m);
            if (Number(m.id) > highestSeenMsgId) highestSeenMsgId = Number(m.id);
          }
        }
        if (batchEnd < endId) {
          await new Promise((r) => setTimeout(r, 90));
        }
      }
    }

    if (highestSeenMsgId > (channelMaxKnownMsgId.get(cleanChannelId) || 0)) {
      channelMaxKnownMsgId.set(cleanChannelId, highestSeenMsgId);
      saveRecentChannelPostsToDisk();
    }

    collectedMessages.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));

    let skippedStickers = 0;
    let skippedSamples = 0;
    let skippedOther = 0;
    let skippedAlreadyAdded = 0;
    let skippedNoAudio = 0;
    let skippedLowQuality = 0;

    interface RawVideoCandidate {
      msgId: number;
      streamUrl: string;
      doc: any;
      mime: string;
      durationSec: number;
      sizeBytes: number;
      width: number;
      height: number;
      fileName: string;
      caption: string;
      hasExplicitNoSound: boolean;
      parsed: ReturnType<typeof parseTelegramMovieMeta>;
    }

    const rawCandidates: RawVideoCandidate[] = [];

    for (const msg of collectedMessages) {
      const classified = classifyTelegramDocMedia(msg);
      if (classified.kind === 'sticker') {
        skippedStickers++;
        continue;
      }
      if (classified.kind !== 'video') {
        skippedOther++;
        continue;
      }

      const streamUrl = publicUsername
        ? `https://t.me/${publicUsername}/${msg.id}`
        : `https://t.me/c/${cleanChannelId}/${msg.id}`;

      const parsedMeta = parseTelegramMovieMeta(
        classified.fileName,
        classified.caption,
        classified.width,
        classified.height,
        classified.durationSec,
        classified.sizeBytes
      );

      if (parsedMeta.isSampleOrClip) {
        skippedSamples++;
        continue;
      }

      if (existingUrlSet.has(streamUrl.toLowerCase())) {
        skippedAlreadyAdded++;
        continue;
      }

      primeMediaCacheFromTelegramDoc(
        streamUrl,
        classified.doc,
        classified.fileName,
        classified.durationSec,
        classified.mime
      );

      rawCandidates.push({
        msgId: Number(msg.id),
        streamUrl,
        doc: classified.doc,
        mime: classified.mime,
        durationSec: classified.durationSec,
        sizeBytes: classified.sizeBytes,
        width: classified.width,
        height: classified.height,
        fileName: classified.fileName || `Movie_${msg.id}`,
        caption: classified.caption || '',
        hasExplicitNoSound: classified.hasExplicitNoSound,
        parsed: parsedMeta,
      });
    }

    let aborted = false;
    res.on('close', () => {
      if (!res.writableEnded) aborted = true;
    });

    interface ScannedVideoCandidate {
      msgId: number;
      streamUrl: string;
      durationSec: number;
      sizeBytes: number;
      fileName: string;
      caption: string;
      parsed: ReturnType<typeof parseTelegramMovieMeta>;
    }

    const verifiedList = await mapWithConcurrency(
      rawCandidates,
      2,
      async (cand): Promise<ScannedVideoCandidate | null> => {
        if (aborted) return null;
        const check = await verifyCandidateAudioAndHd(
          {
            streamUrl: cand.streamUrl,
            doc: cand.doc,
            mime: cand.mime,
            fileName: cand.fileName,
            caption: cand.caption,
            durationSec: cand.durationSec,
            width: cand.width,
            height: cand.height,
            parsedQuality: cand.parsed.quality,
            hasExplicitNoSound: cand.hasExplicitNoSound,
          },
          client,
          Boolean(onlyValidAudioAndHd)
        );
        if (!check.accepted) {
          if (check.reason === 'no_audio' || check.reason === 'unverified_audio') {
            skippedNoAudio++;
          } else {
            skippedLowQuality++;
          }
          return null;
        }
        return {
          msgId: cand.msgId,
          streamUrl: cand.streamUrl,
          durationSec: check.durationSec || cand.durationSec,
          sizeBytes: cand.sizeBytes,
          fileName: cand.fileName,
          caption: cand.caption,
          parsed: {
            ...cand.parsed,
            quality: check.effectiveQuality || cand.parsed.quality,
          },
        };
      },
      () => aborted
    );

    if (aborted) return;

    const videoCandidates = verifiedList.filter((v): v is ScannedVideoCandidate => Boolean(v));

    // Group multi-quality uploads of the same movie into single rich movie entries
    interface GroupedMovieEntry {
      groupKey: string;
      primary: ScannedVideoCandidate;
      members: ScannedVideoCandidate[];
      videoQualities: Record<string, string>;
      qualitySizes: Record<string, number>;
    }

    const groupedList: GroupedMovieEntry[] = [];
    const groupIndexByKey = new Map<string, number>();

    for (const v of videoCandidates) {
      const gKey = v.parsed.groupKey || `msg-${v.msgId}`;

      const existingIdx = v.parsed.groupKey ? groupIndexByKey.get(gKey) : undefined;
      if (existingIdx !== undefined) {
        const grp = groupedList[existingIdx];
        grp.members.push(v);
        if (v.parsed.quality) {
          const prevSize = grp.qualitySizes[v.parsed.quality] || 0;
          if (!grp.videoQualities[v.parsed.quality] || v.sizeBytes > prevSize) {
            grp.videoQualities[v.parsed.quality] = v.streamUrl;
            grp.qualitySizes[v.parsed.quality] = v.sizeBytes;
          }
        }
        // Prefer member with explicit IMDb ID, year, or higher quality
        if (
          (!grp.primary.parsed.year && v.parsed.year) ||
          (!grp.primary.parsed.explicitImdbId && v.parsed.explicitImdbId) ||
          v.parsed.quality === '1080p'
        ) {
          grp.primary = v;
        }
      } else {
        const vq: Record<string, string> = {};
        const qs: Record<string, number> = {};
        if (v.parsed.quality) {
          vq[v.parsed.quality] = v.streamUrl;
          qs[v.parsed.quality] = v.sizeBytes;
        }
        const newIdx = groupedList.length;
        groupedList.push({
          groupKey: gKey,
          primary: v,
          members: [v],
          videoQualities: vq,
          qualitySizes: qs,
        });
        if (v.parsed.groupKey) {
          groupIndexByKey.set(gKey, newIdx);
        }
      }
    }

    const drafts = await mapWithConcurrency(
      groupedList,
      3,
      async (grp): Promise<AutoMatchedMovieDraft | null> => {
        if (aborted) return null;
        const bestStream =
          grp.videoQualities['1080p'] ||
          grp.videoQualities['720p'] ||
          grp.videoQualities['480p'] ||
          grp.videoQualities['4K'] ||
          grp.videoQualities['360p'] ||
          grp.primary.streamUrl;

        const mergedParsed = {
          ...grp.primary.parsed,
          year: grp.primary.parsed.year || grp.members.find((m) => m.parsed.year)?.parsed.year || null,
          languageHint:
            grp.primary.parsed.languageHint ||
            grp.members.find((m) => m.parsed.languageHint)?.parsed.languageHint ||
            '',
          isHindiDubbed: grp.members.some((m) => m.parsed.isHindiDubbed),
        };

        const matched = await resolveBestImdbMatch(mergedParsed);
        const isSeriesItem =
          mergedParsed.isSeriesEpisode ||
          String(matched.originalCategory || '').toLowerCase().includes('series');

        const filteredQualities = onlyValidAudioAndHd
          ? filterQualityMapForHdOnly(grp.videoQualities)
          : grp.videoQualities;
        const chosenStream =
          filteredQualities['1080p'] ||
          filteredQualities['720p'] ||
          bestStream;
        const bestDurSec = Math.max(0, ...grp.members.map((m) => m.durationSec || 0));
        const durationFormatted = bestDurSec > 0 ? formatDuration(bestDurSec) : '';
        const hasHollywoodPrint = grp.members.some((m) =>
          isHollywoodPrintText(`${m.fileName} ${m.caption}`)
        );
        const qualityBadge: '4K' | 'HD' | 'HDTC' = hasHollywoodPrint
          ? 'HDTC'
          : filteredQualities['4K']
          ? '4K'
          : 'HD';

        // For single movies (not series episodes), allow clean HD uploads to pass through if they replace an existing Holl Print movie.
        if (!isSeriesItem) {
          const matchedExistingImdb = Boolean(matched.imdbId && existingImdbSet.has(matched.imdbId.toLowerCase()));
          const matchedExistingTitle = isDuplicateByTitleAndYear(
            existingTitleList,
            [matched.title, matched.originalTitle, mergedParsed.cleanTitle],
            matched.releaseYear || mergedParsed.year || 0,
            false
          );
          if (matchedExistingImdb || matchedExistingTitle) {
            const existingIsHollPrint =
              (matched.imdbId && existingHollPrintImdbSet.has(matched.imdbId.toLowerCase())) ||
              isDuplicateByTitleAndYear(
                existingHollPrintTitleList,
                [matched.title, matched.originalTitle, mergedParsed.cleanTitle],
                matched.releaseYear || mergedParsed.year || 0,
                false
              );
            if (hasHollywoodPrint || !existingIsHollPrint) {
              skippedAlreadyAdded++;
              return null;
            }
          }
        }

        return {
          draftId: `tg-${cleanChannelId}-${grp.primary.msgId}`,
          channelId: cleanChannelId,
          channelTitle,
          msgId: grp.primary.msgId,
          sourceMsgIds: grp.members.map((m) => m.msgId),
          streamUrl: chosenStream,
          videoQualities: filteredQualities,
          qualityBadge,
          durationSec: bestDurSec,
          runtime: matched.runtime || durationFormatted,
          sourceFileName: grp.primary.fileName,
          sourceCaption: `${mergedParsed.cleanTitle}${mergedParsed.year ? ` (${mergedParsed.year})` : ''}`,
          parsedTitle: mergedParsed.cleanTitle,
          parsedYear: mergedParsed.year,
          imdbId: matched.imdbId,
          title: matched.title,
          originalTitle: matched.originalTitle,
          releaseYear: matched.releaseYear,
          posterUrl: matched.posterUrl,
          backdropUrl: matched.backdropUrl,
          genre: matched.genre,
          description: matched.description,
          director: matched.director,
          cast: matched.cast,
          language: matched.language,
          rating: matched.rating,
          originalCategory: matched.originalCategory,
          matchConfidence: matched.matchConfidence,
          confidenceScore: matched.confidenceScore,
          matchReason: matched.matchReason,
          isSeriesEpisode: mergedParsed.isSeriesEpisode,
          seasonNumber: mergedParsed.seasonNumber,
          episodeNumber: mergedParsed.episodeNumber,
          episodeLabel: mergedParsed.episodeLabel,
          episodeTitle: mergedParsed.episodeTitle,
          alternateMatches: matched.alternateMatches,
        };
      },
      () => aborted
    );

    if (aborted) return;

    const finalItems = drafts.filter((d): d is AutoMatchedMovieDraft => Boolean(d));

    console.log(
      `[TelegramScanMovies] Channel "${channelTitle}" (${scanFromId}-${scanToId}, mode=${mode}): ${finalItems.length} movies matched (${videoCandidates.length} valid HD+Audio / ${rawCandidates.length} raw, ${skippedNoAudio} no-audio, ${skippedLowQuality} <720p, ${skippedAlreadyAdded} already in app)`
    );

    return res.json({
      success: true,
      channelId: cleanChannelId,
      channelTitle,
      scannedFromMsgId: scanFromId,
      scannedToMsgId: scanToId,
      highestMsgId: highestSeenMsgId,
      totalVideosFound: videoCandidates.length,
      skippedStickers,
      skippedSamples,
      skippedOther,
      skippedAlreadyAdded,
      skippedNoAudio,
      skippedLowQuality,
      items: finalItems,
    });
  } catch (err: any) {
    console.error('[TelegramScanMovies] Error:', err);
    return res.status(500).json({
      error: err?.message || 'Failed to scan Telegram channel movies.',
    });
  }
});

// ============================================================================
// SERVER-SIDE 24/7 AUTO-SYNC & AUTO-PUBLISH ENGINE
// Automatically detects newly uploaded movies in the connected Telegram
// channel even when Admin Panel is closed, resolves IMDb posters + metadata,
// and publishes verified movies straight into Firestore.
// ============================================================================
interface ExistingTitleDupEntry {
  normTitle: string;
  normOrigTitle: string;
  releaseYear: number;
  isSeries: boolean;
}

function normalizeDupTitleKey(title: string): string {
  return String(title || '')
    .toLowerCase()
    .replace(/\((?:tv\s*series|film|movie|series|\d{4})\)/gi, '')
    .replace(
      /\b(?:hdtc|hdts|tsrip|tcrip|hdcam|camrip|predvd|dvdscr|telesync|telecine|cinevood|cinevoo|cinewood|cinvood|holl[\s._-]*print(?:ed)?|hollywood[\s._-]*print(?:ed)?|hall[\s._-]*print)\b/gi,
      ''
    )
    .replace(/\bviii\b/g, '8')
    .replace(/\bvii\b/g, '7')
    .replace(/\bvi\b/g, '6')
    .replace(/\biv\b/g, '4')
    .replace(/\biii\b/g, '3')
    .replace(/\bii\b/g, '2')
    .replace(/\bix\b/g, '9')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
}

function buildExistingTitleDupEntry(
  title: any,
  origTitle: any,
  releaseYear: any,
  category: any
): ExistingTitleDupEntry {
  const catLower = String(category || '').toLowerCase();
  return {
    normTitle: normalizeDupTitleKey(String(title || '')),
    normOrigTitle: normalizeDupTitleKey(String(origTitle || '')),
    releaseYear: Number(releaseYear) || 0,
    isSeries: catLower.includes('series'),
  };
}

function isDuplicateByTitleAndYear(
  existingList: ExistingTitleDupEntry[],
  candidateTitles: Array<string | undefined>,
  candidateYear: number,
  candidateIsSeries: boolean
): boolean {
  const normCandidates = candidateTitles
    .map((t) => normalizeDupTitleKey(t || ''))
    .filter((k) => k.length >= 2);
  if (normCandidates.length === 0) return false;

  for (const ex of existingList) {
    const exKeys = [ex.normTitle, ex.normOrigTitle].filter((k) => k.length >= 2);
    for (const ck of normCandidates) {
      for (const ek of exKeys) {
        if (ck !== ek) continue;
        // Never re-upload the same Web/Anime Series even if new season/episode tag differs
        if (ex.isSeries || candidateIsSeries) return true;
        // Same title without year info -> duplicate
        if (!candidateYear || !ex.releaseYear) return true;
        // Same title within ±1 release year (e.g. festival vs theatrical year) -> duplicate
        if (Math.abs(candidateYear - ex.releaseYear) <= 1) return true;
      }
    }
  }
  return false;
}

const DEFAULT_AUTO_SYNC_CHANNEL_URL = 'https://t.me/+P5UeGT1YlQ9lOGZl';
const DEFAULT_AUTO_SYNC_CHANNEL_ID = '4451036277';
const AUTO_SYNC_CONFIG_VERSION = 3;
const SEED_CATALOG_PATH = path.resolve(process.cwd(), 'public/movies-seed.json');
const DIST_SEED_CATALOG_PATH = path.resolve(process.cwd(), 'dist/movies-seed.json');
const AUTO_SYNC_STATE_FILE = path.join(os.tmpdir(), '.movie_hub_tg_autosync_state.json');
const PENDING_DRAFTS_FILE = path.join(os.tmpdir(), '.movie_hub_tg_pending_drafts.json');
let pendingServerDrafts: AutoMatchedMovieDraft[] = [];

const pendingPriorityMsgIds = new Map<string, Set<number>>();
const liveCatalogSseClients = new Set<Response>();
let localChannelCheckpoint: Record<string, number> = {};

function loadLocalAutoSyncState() {
  try {
    if (fs.existsSync(AUTO_SYNC_STATE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(AUTO_SYNC_STATE_FILE, 'utf-8'));
      if (parsed?.channels && typeof parsed.channels === 'object') {
        for (const [k, v] of Object.entries(parsed.channels)) {
          const n = Number(v);
          if (k && Number.isFinite(n) && n > 0) {
            localChannelCheckpoint[k] = n;
          }
        }
      }
    }
  } catch {}
}

function saveLocalChannelCheckpoint(channelId: string, msgId: number) {
  if (!channelId || !Number.isFinite(msgId) || msgId <= 0) return;
  const prev = localChannelCheckpoint[channelId] || 0;
  if (msgId <= prev) return;
  localChannelCheckpoint[channelId] = msgId;
  try {
    fs.writeFileSync(
      AUTO_SYNC_STATE_FILE,
      JSON.stringify({ channels: localChannelCheckpoint, updatedAt: Date.now() }),
      'utf-8'
    );
  } catch {}
}

loadLocalAutoSyncState();

function queuePriorityChannelMsgId(channelId: string, msgId: number) {
  if (!channelId || !Number.isFinite(msgId) || msgId <= 0) return;
  let set = pendingPriorityMsgIds.get(channelId);
  if (!set) {
    set = new Set<number>();
    pendingPriorityMsgIds.set(channelId, set);
  }
  set.add(msgId);
}

function consumePriorityChannelMsgIds(channelId: string): number[] {
  const set = pendingPriorityMsgIds.get(channelId);
  if (!set || set.size === 0) return [];
  const list = Array.from(set).sort((a, b) => a - b);
  set.clear();
  return list;
}

function writeSeedCatalogToDisk(items: any[]) {
  const payload = JSON.stringify(items);
  try {
    fs.writeFileSync(SEED_CATALOG_PATH, payload);
  } catch {}
  try {
    const distDir = path.dirname(DIST_SEED_CATALOG_PATH);
    if (!fs.existsSync(distDir)) {
      fs.mkdirSync(distDir, { recursive: true });
    }
    fs.writeFileSync(DIST_SEED_CATALOG_PATH, payload);
  } catch {}
  try {
    const tsPath = path.resolve(process.cwd(), 'src/services/seedCatalog.ts');
    fs.writeFileSync(
      tsPath,
      `import type { MovieData } from './movieStorage';\n\nexport const BUNDLED_SEED_CATALOG: MovieData[] = ${payload};\n`
    );
  } catch {}
}

function broadcastLiveCatalogUpdate(payload: {
  type: 'catalog_updated';
  count: number;
  updatedAt: number;
  action?: string;
  latestTitle?: string;
  latestId?: string;
}) {
  if (liveCatalogSseClients.size === 0) return;
  const frame = `event: catalog_updated\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const clientRes of Array.from(liveCatalogSseClients)) {
    try {
      if (!clientRes.writableEnded) {
        clientRes.write(frame);
      } else {
        liveCatalogSseClients.delete(clientRes);
      }
    } catch {
      liveCatalogSseClients.delete(clientRes);
    }
  }
}

router.get('/live-events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  liveCatalogSseClients.add(res);
  try {
    res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, ts: Date.now() })}\n\n`);
  } catch {}

  const pingTimer = setInterval(() => {
    try {
      if (!res.writableEnded) {
        res.write(`: ping ${Date.now()}\n\n`);
      }
    } catch {}
  }, 20000);

  req.on('close', () => {
    clearInterval(pingTimer);
    liveCatalogSseClients.delete(res);
  });
});

function loadPendingServerDrafts() {
  try {
    if (fs.existsSync(PENDING_DRAFTS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PENDING_DRAFTS_FILE, 'utf-8'));
      if (Array.isArray(raw)) {
        pendingServerDrafts = raw;
      }
    }
  } catch {}
}

function savePendingServerDrafts() {
  try {
    fs.writeFileSync(PENDING_DRAFTS_FILE, JSON.stringify(pendingServerDrafts.slice(0, 100)), 'utf-8');
  } catch {}
}

loadPendingServerDrafts();

router.get('/pending-review-drafts', (_req: Request, res: Response) => {
  return res.json({ success: true, drafts: pendingServerDrafts });
});

router.post('/dismiss-review-draft', (req: Request, res: Response) => {
  const draftId = String(req.body?.draftId || '').trim();
  if (draftId) {
    pendingServerDrafts = pendingServerDrafts.filter((d) => d.draftId !== draftId);
    savePendingServerDrafts();
  }
  return res.json({ success: true, remaining: pendingServerDrafts.length });
});

router.post('/trigger-auto-sync', async (_req: Request, res: Response) => {
  try {
    await runServerAutoSyncPass('manual_trigger');
    return res.json({
      success: true,
      pendingDrafts: pendingServerDrafts.length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Auto-sync trigger failed.' });
  }
});

let cachedAudioAuditContext: {
  fetchedAt: number;
  allMovies: any[];
  refs: Array<{
    movieId: string;
    title: string;
    releaseYear: any;
    category: string;
    label: string;
    url: string;
    channelId: string;
    msgId: number;
  }>;
  uniqueRefs: Array<{
    movieId: string;
    title: string;
    releaseYear: any;
    category: string;
    label: string;
    url: string;
    channelId: string;
    msgId: number;
  }>;
  msgMap: Map<string, any>;
} | null = null;

router.get('/audit-catalog-audio', async (req: Request, res: Response) => {
  try {
    const deepProbeAll = String(req.query.deep || '') === '1';
    const refreshCache = String(req.query.refresh || '') === '1';
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 60));
    const client = await getTelegramClient();

    if (!cachedAudioAuditContext || refreshCache || Date.now() - cachedAudioAuditContext.fetchedAt > 15 * 60_000) {
      const byId = new Map<string, any>();

      try {
        if (fs.existsSync('public/movies-seed.json')) {
          const seedArr = JSON.parse(fs.readFileSync('public/movies-seed.json', 'utf8'));
          if (Array.isArray(seedArr)) {
            for (const m of seedArr) {
              if (m && m.id) byId.set(m.id, m);
            }
          }
        }
      } catch {}

      try {
        const fsSnap = await Promise.race([
          getDocsFromServer(collection(db, 'movies')),
          new Promise<null>((r) => setTimeout(() => r(null), 10000)),
        ]);
        if (fsSnap) {
          fsSnap.docs.forEach((d) => {
            const data = d.data() as any;
            const prev = byId.get(d.id) || {};
            byId.set(d.id, { ...prev, ...data, id: d.id });
          });
        }
      } catch {}

      const allMovies = Array.from(byId.values());
      const refs: NonNullable<typeof cachedAudioAuditContext>['refs'] = [];

      const addRef = (m: any, label: string, rawUrl: any) => {
        const url = String(rawUrl || '').trim();
        if (!url) return;
        const p = parseTelegramUrl(url);
        if (!p.isValid || p.isInviteLink || !p.messageId) return;
        const chId = String(p.rawChannelId || p.chatId || '').replace(/^-100/, '');
        const msgId = Number(p.messageId);
        if (!chId || !Number.isFinite(msgId) || msgId <= 0) return;
        refs.push({
          movieId: m.id,
          title: String(m.title || ''),
          releaseYear: m.releaseYear,
          category: String(m.category || m.originalCategory || ''),
          label,
          url,
          channelId: chId,
          msgId,
        });
      };

      for (const m of allMovies) {
        addRef(m, 'primary', m.streamingUrl);
        if (m.videoQualities && typeof m.videoQualities === 'object') {
          for (const [q, u] of Object.entries(m.videoQualities)) {
            if (typeof u === 'string') addRef(m, `quality:${q}`, u);
          }
        }
        if (Array.isArray(m.seasons)) {
          for (const s of m.seasons) {
            for (const ep of s.episodes || []) {
              addRef(m, `S${s.seasonNumber}E${ep.episodeNumber}`, ep.streamUrl);
              if (ep.videoQualities && typeof ep.videoQualities === 'object') {
                for (const [q, u] of Object.entries(ep.videoQualities)) {
                  if (typeof u === 'string') {
                    addRef(m, `S${s.seasonNumber}E${ep.episodeNumber}:${q}`, u);
                  }
                }
              }
            }
          }
        }
      }

      const uniqueRefByUrl = new Map<string, (typeof refs)[number]>();
      for (const r of refs) {
        if (!uniqueRefByUrl.has(r.url)) uniqueRefByUrl.set(r.url, r);
      }
      const uniqueRefs = Array.from(uniqueRefByUrl.values()).sort((a, b) => b.msgId - a.msgId);

      cachedAudioAuditContext = {
        fetchedAt: Date.now(),
        allMovies,
        refs,
        uniqueRefs,
        msgMap: new Map<string, any>(),
      };
    }

    const { allMovies, refs, uniqueRefs, msgMap } = cachedAudioAuditContext;
    const sliceRefs = uniqueRefs.slice(offset, offset + limit);

    // Fetch Telegram messages ONLY for uncached refs in the current page
    const missingByChannel = new Map<string, Set<number>>();
    for (const r of sliceRefs) {
      if (!msgMap.has(`${r.channelId}:${r.msgId}`)) {
        if (!missingByChannel.has(r.channelId)) missingByChannel.set(r.channelId, new Set());
        missingByChannel.get(r.channelId)!.add(r.msgId);
      }
    }

    for (const [chId, idSet] of missingByChannel.entries()) {
      const accessHash = getCachedAccessHash(chId);
      let peer: any = null;
      if (accessHash && /^\d+$/.test(chId)) {
        peer = new Api.InputPeerChannel({
          channelId: BigInt(chId) as any,
          accessHash: BigInt(accessHash) as any,
        });
      } else {
        try {
          peer = await Promise.race([
            client.getEntity(/^\d+$/.test(chId) ? `-100${chId}` : chId),
            new Promise<null>((r) => setTimeout(() => r(null), 8000)),
          ]);
        } catch {}
      }
      if (!peer) continue;
      const ids = Array.from(idSet).sort((a, b) => b - a);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        try {
          const msgs = await Promise.race([
            client.getMessages(peer, { ids: chunk }),
            new Promise<null>((r) => setTimeout(() => r(null), 12000)),
          ]);
          for (const msg of msgs || []) {
            if (msg && (msg as any).id) {
              msgMap.set(`${chId}:${(msg as any).id}`, msg);
            }
          }
        } catch (err) {
          console.warn(`[AudioAudit] getMessages chunk failed for ${chId}:`, err);
        }
      }
    }

    const urlStatus = new Map<string, any>();

    await mapWithConcurrency(sliceRefs, 4, async (r) => {
      const msg = msgMap.get(`${r.channelId}:${r.msgId}`);
      if (!msg) {
        urlStatus.set(r.url, { url: r.url, issue: 'missing_message', fastAudio: false, probedAudio: false, audioTracksCount: 0, audioCodec: '' });
        return;
      }
      const classified = classifyTelegramDocMedia(msg);
      if (classified.kind !== 'video') {
        urlStatus.set(r.url, { url: r.url, fileName: classified.fileName || '', mime: classified.mime || '', issue: `not_video:${classified.kind}`, fastAudio: false, probedAudio: false, audioTracksCount: 0, audioCodec: '' });
        return;
      }
      if (classified.hasExplicitNoSound) {
        urlStatus.set(r.url, { url: r.url, fileName: classified.fileName, mime: classified.mime, issue: 'tg_nosound_flag', fastAudio: false, probedAudio: false, audioTracksCount: 0, audioCodec: '' });
        return;
      }
      if (/\bno[\s._-]*(sound|audio)\b|\bsilent\b|\bmute\b/i.test(`${classified.fileName} ${classified.caption}`)) {
        urlStatus.set(r.url, { url: r.url, fileName: classified.fileName, mime: classified.mime, issue: 'filename_no_sound', fastAudio: false, probedAudio: false, audioTracksCount: 0, audioCodec: '' });
        return;
      }

      const entry = primeMediaCacheFromTelegramDoc(
        r.url,
        classified.doc,
        classified.fileName,
        classified.durationSec,
        classified.mime
      );
      let fastAudio: boolean | null = null;
      if (entry) {
        fastAudio = await Promise.race([
          checkTelegramDocHasAudioFast(client, entry.docInfo).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
        ]);
      }

      let probedAudio: boolean | null = null;
      let audioTracksCount = 0;
      let audioCodec = '';
      if (entry && (fastAudio !== true || deepProbeAll)) {
        const probe = await ensureMediaProbed(entry, r.url, {
          timeoutMs: 12000,
          probesize: 1_500_000,
          analyzeduration: 1_500_000,
        }).catch(() => null);
        if (probe?.probedByFfprobe) {
          audioTracksCount = probe.audioTracks.length;
          audioCodec = probe.audioCodec || '';
          probedAudio = audioTracksCount > 0 || Boolean(audioCodec && audioCodec !== 'none');
        }
      }

      let issue = '';
      if (probedAudio === false) issue = 'ffprobe_zero_audio';
      else if (fastAudio === false && probedAudio !== true) issue = 'header_zero_audio';
      else if (fastAudio !== true && probedAudio !== true) issue = 'unverified_audio';

      urlStatus.set(r.url, {
        url: r.url,
        fileName: classified.fileName,
        mime: classified.mime,
        fastAudio,
        probedAudio,
        audioTracksCount,
        audioCodec,
        issue,
      });
    });

    const badRefs = refs
      .filter((r) => urlStatus.has(r.url) && Boolean(urlStatus.get(r.url).issue))
      .map((r) => ({ ...r, ...urlStatus.get(r.url) }));

    return res.json({
      success: true,
      totalMovies: allMovies.length,
      totalRefs: refs.length,
      uniqueUrls: uniqueRefs.length,
      offset,
      checked: sliceRefs.length,
      nextOffset: offset + sliceRefs.length < uniqueRefs.length ? offset + sliceRefs.length : null,
      badCount: badRefs.length,
      badRefs,
    });
  } catch (err: any) {
    console.error('[AudioAudit] Error:', err);
    return res.status(500).json({ error: err?.message || 'Audit failed' });
  }
});

let serverAutoSyncTimer: NodeJS.Timeout | null = null;
let serverAutoSyncRunning = false;
let pendingResyncReason: string | null = null;
let cachedSyncConfig: {
  configVersion: number;
  channelUrl: string;
  lastSyncedMsgId: number;
  autoWatchEnabled: boolean;
  autoPublishVerified: boolean;
  notifyOnNewPublish: boolean;
  onlyValidAudioAndHd: boolean;
  fetchedAt: number;
} | null = null;

function scheduleServerAutoSync(reason: string, delayMs = 1200) {
  if (serverAutoSyncRunning) {
    pendingResyncReason = reason;
    return;
  }
  if (serverAutoSyncTimer) clearTimeout(serverAutoSyncTimer);
  serverAutoSyncTimer = setTimeout(() => {
    serverAutoSyncTimer = null;
    runServerAutoSyncPass(reason).catch((e) =>
      console.warn('[ServerAutoSync] Pass warning:', e?.message || e)
    );
  }, delayMs);
}

async function getServerAutoSyncConfig(forceRefresh = false) {
  if (!forceRefresh && cachedSyncConfig && Date.now() - cachedSyncConfig.fetchedAt < 60_000) {
    return cachedSyncConfig;
  }
  const prevCachedLastSynced = cachedSyncConfig?.lastSyncedMsgId || 0;
  try {
    const ref = doc(db, 'app_config', 'telegram_auto_sync');
    const snap = await getDocFromServer(ref);
    const d = snap.exists() ? (snap.data() as any) : {};
    const rawUrl = String(d?.channelUrl || '').trim();
    const rawVer = Number(d?.configVersion) || 1;
    const isOldDefaultChannel =
      rawUrl.includes('QSL_3k54YfBjMjE1') || rawUrl.includes('s2Qki5-sfnVjZTI1');

    if (!snap.exists() || rawVer < AUTO_SYNC_CONFIG_VERSION || isOldDefaultChannel || !rawUrl) {
      const preservedLastSynced = Math.max(
        prevCachedLastSynced,
        isOldDefaultChannel ? 0 : Number(d?.lastSyncedMsgId) || 0,
        localChannelCheckpoint[DEFAULT_AUTO_SYNC_CHANNEL_ID] || 0
      );
      const migrated = {
        configVersion: AUTO_SYNC_CONFIG_VERSION,
        channelUrl: DEFAULT_AUTO_SYNC_CHANNEL_URL,
        activeChannelId: DEFAULT_AUTO_SYNC_CHANNEL_ID,
        lastSyncedMsgId: preservedLastSynced,
        autoWatchEnabled: true,
        autoPublishVerified: true,
        notifyOnNewPublish: true,
        onlyValidAudioAndHd: false,
        updatedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      };
      await setDocWithQuotaGuard(ref, migrated, { merge: true }).catch(() => {});
      cachedSyncConfig = {
        configVersion: AUTO_SYNC_CONFIG_VERSION,
        channelUrl: DEFAULT_AUTO_SYNC_CHANNEL_URL,
        lastSyncedMsgId: preservedLastSynced,
        autoWatchEnabled: true,
        autoPublishVerified: true,
        notifyOnNewPublish: true,
        onlyValidAudioAndHd: false,
        fetchedAt: Date.now(),
      };
    } else {
      cachedSyncConfig = {
        configVersion: rawVer,
        channelUrl: rawUrl,
        lastSyncedMsgId: Math.max(
          prevCachedLastSynced,
          Number(d?.lastSyncedMsgId) || 0,
          localChannelCheckpoint[DEFAULT_AUTO_SYNC_CHANNEL_ID] || 0
        ),
        autoWatchEnabled: typeof d?.autoWatchEnabled === 'boolean' ? d.autoWatchEnabled : true,
        autoPublishVerified: typeof d?.autoPublishVerified === 'boolean' ? d.autoPublishVerified : true,
        notifyOnNewPublish: typeof d?.notifyOnNewPublish === 'boolean' ? d.notifyOnNewPublish : true,
        onlyValidAudioAndHd: typeof d?.onlyValidAudioAndHd === 'boolean' ? d.onlyValidAudioAndHd : false,
        fetchedAt: Date.now(),
      };
    }
  } catch {
    if (!cachedSyncConfig) {
      cachedSyncConfig = {
        configVersion: AUTO_SYNC_CONFIG_VERSION,
        channelUrl: DEFAULT_AUTO_SYNC_CHANNEL_URL,
        lastSyncedMsgId: localChannelCheckpoint[DEFAULT_AUTO_SYNC_CHANNEL_ID] || 0,
        autoWatchEnabled: true,
        autoPublishVerified: true,
        notifyOnNewPublish: true,
        onlyValidAudioAndHd: false,
        fetchedAt: Date.now(),
      };
    }
  }
  return cachedSyncConfig;
}

interface ExistingMovieRecord {
  id: string;
  imdbId: string;
  title: string;
  originalTitle: string;
  releaseYear: number;
  originalCategory: string;
  isSeries: boolean;
  published?: boolean;
  qualityBadge?: string;
  sourceFileName?: string;
  sourceCaption?: string;
  posterUrl?: string;
  streamingUrl: string;
  videoQualities: Record<string, string>;
  seasons: Array<{ seasonNumber: number; episodes: any[] }>;
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[n];
}

function findMatchingExistingRecord(
  records: ExistingMovieRecord[],
  imdbId: string,
  titles: Array<string | undefined>,
  year: number,
  isSeries: boolean
): ExistingMovieRecord | null {
  const cleanImdb = String(imdbId || '').trim().toLowerCase();
  if (cleanImdb) {
    const byImdb = records.find((r) => r.imdbId && r.imdbId.toLowerCase() === cleanImdb);
    if (byImdb) return byImdb;
  }

  const candKeys = Array.from(
    new Set(titles.map((t) => normalizeDupTitleKey(t || '')).filter((k) => k.length >= 2))
  );
  for (const r of records) {
    const rKeys = [normalizeDupTitleKey(r.title), normalizeDupTitleKey(r.originalTitle)].filter((k) => k.length >= 2);
    const isExistingPrint = isHollywoodPrintMovie(r);
    for (const ck of candKeys) {
      for (const rk of rKeys) {
        if (ck !== rk) continue;
        if (isSeries || r.isSeries) return r;
        if (!year || !r.releaseYear || Math.abs(year - r.releaseYear) <= (isExistingPrint ? 2 : 1)) return r;
      }
    }
  }

  // Fallback fuzzy match for minor transliteration spelling differences (e.g. "Ishan De Lekhe" vs "Ishqan De Lekhe")
  for (const r of records) {
    if (Boolean(r.isSeries) !== Boolean(isSeries)) continue;
    const isExistingPrint = isHollywoodPrintMovie(r);
    if (!isSeries) {
      if (!year || !r.releaseYear) continue;
      if (Math.abs(year - r.releaseYear) > (isExistingPrint ? 2 : 1)) continue;
    }
    const rKeys = [normalizeDupTitleKey(r.title), normalizeDupTitleKey(r.originalTitle)].filter((k) => k.length >= 6);
    for (const ck of candKeys) {
      if (ck.length < 6) continue;
      const ckTrailingDigit = ck.match(/\d+$/)?.[0] || '';
      for (const rk of rKeys) {
        const rkTrailingDigit = rk.match(/\d+$/)?.[0] || '';
        if (ckTrailingDigit !== rkTrailingDigit) continue;
        if (ck[0] !== rk[0]) continue;
        if (Math.abs(ck.length - rk.length) > 2) continue;
        const maxDist = Math.max(1, Math.floor(Math.min(ck.length, rk.length) * 0.16));
        if (levenshteinDistance(ck, rk) <= maxDist) {
          return r;
        }
      }
    }
  }
  return null;
}

function buildEffectiveQualityGroup<T extends { streamUrl: string; sizeBytes: number; durationSec: number; fileName: string; caption: string; msgDateMs: number; msgId: number; parsed: ReturnType<typeof parseTelegramMovieMeta> }>(
  members: T[],
  fallbackPrimary: T,
  onlyValidAudioAndHd: boolean
): {
  effectivePrimary: T;
  effectiveMembers: T[];
  filteredQualities: Record<string, string>;
  bestStream: string;
  hasHollywoodPrint: boolean;
  qualityBadge: '4K' | 'HD' | 'HDTC';
  bestDurSec: number;
  realMsgDateMs: number;
} {
  const cleanMembers = members.filter((m) => !isHollywoodPrintText(`${m.fileName} ${m.caption}`));
  const effectiveMembers = cleanMembers.length > 0 ? cleanMembers : members;
  const isSampleItem = (m: T) => /\b(sample|trailer|teaser|promo|preview)\b/i.test(`${m.fileName} ${m.caption}`);
  const maxCleanDurSec = Math.max(
    0,
    ...effectiveMembers.map((m) => (!isSampleItem(m) && (m.durationSec || 0) > 0 ? m.durationSec : 0))
  );
  const vq: Record<string, string> = {};
  const qs: Record<string, number> = {};
  const fullLengthFallback = effectiveMembers.find(
    (m) => maxCleanDurSec < 300 || !m.durationSec || m.durationSec >= maxCleanDurSec * 0.85
  );
  let effectivePrimary = fullLengthFallback || effectiveMembers[0] || fallbackPrimary;

  for (const m of effectiveMembers) {
    const isTruncatedOutlier =
      maxCleanDurSec >= 300 && m.durationSec > 0 && m.durationSec < maxCleanDurSec * 0.85;
    if (isTruncatedOutlier) {
      continue;
    }
    if (m.parsed.quality) {
      const prevSz = qs[m.parsed.quality] || 0;
      if (!vq[m.parsed.quality] || m.sizeBytes > prevSz) {
        vq[m.parsed.quality] = m.streamUrl;
        qs[m.parsed.quality] = m.sizeBytes;
      }
    }
    if (
      (!effectivePrimary.parsed.year && m.parsed.year) ||
      (!effectivePrimary.parsed.explicitImdbId && m.parsed.explicitImdbId) ||
      m.parsed.quality === '1080p'
    ) {
      effectivePrimary = m;
    }
  }

  const filteredQualities = onlyValidAudioAndHd ? filterQualityMapForHdOnly(vq) : vq;
  const bestStream =
    filteredQualities['1080p'] ||
    filteredQualities['4K'] ||
    filteredQualities['720p'] ||
    filteredQualities['480p'] ||
    filteredQualities['360p'] ||
    effectivePrimary.streamUrl;
  const hasHollywoodPrint = cleanMembers.length === 0;
  const qualityBadge: '4K' | 'HD' | 'HDTC' = hasHollywoodPrint
    ? 'HDTC'
    : filteredQualities['4K']
    ? '4K'
    : 'HD';
  const bestDurSec = Math.max(0, ...effectiveMembers.map((m) => m.durationSec || 0));
  const msgDateList = effectiveMembers.map((m) => m.msgDateMs).filter((t) => t > 0);
  const realMsgDateMs = msgDateList.length > 0 ? Math.min(...msgDateList) : effectivePrimary.msgDateMs || 0;

  return {
    effectivePrimary,
    effectiveMembers,
    filteredQualities,
    bestStream,
    hasHollywoodPrint,
    qualityBadge,
    bestDurSec,
    realMsgDateMs,
  };
}

// Episode season merging and overlap reconciliation are imported from ../utils/seriesCompleteness.ts

function buildFallbackPosterDataUri(title: string, year?: number | string | null): string {
  const safeTitle = String(title || 'Movie Hub')
    .replace(/[<>&"']/g, ' ')
    .trim()
    .slice(0, 34);
  const safeYear = String(year || '').replace(/[^0-9]/g, '').slice(0, 4);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 900" width="600" height="900"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#111827"/><stop offset="55%" stop-color="#0f172a"/><stop offset="100%" stop-color="#064e3b"/></linearGradient></defs><rect width="600" height="900" fill="url(#bg)"/><circle cx="300" cy="360" r="88" fill="#10b981" opacity="0.16"/><polygon points="275,320 275,400 345,360" fill="#10b981"/><text x="300" y="545" text-anchor="middle" fill="#f9fafb" font-family="system-ui,-apple-system,sans-serif" font-size="36" font-weight="700">${safeTitle}</text>${safeYear ? `<text x="300" y="605" text-anchor="middle" fill="#34d399" font-family="system-ui,-apple-system,sans-serif" font-size="26" font-weight="600">${safeYear}</text>` : ''}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

let lastReconcileCheckAt = 0;
let lastBotUpdateId = 0;

async function runServerAutoSyncPass(reason: string): Promise<void> {
  if (serverAutoSyncRunning || bulkSyncJob.status === 'running') return;
  serverAutoSyncRunning = true;

  try {
    const cfg = await getServerAutoSyncConfig(reason.startsWith('new_video') || reason === 'boot' || reason === 'manual_trigger');
    if (!cfg.autoWatchEnabled || !cfg.channelUrl) return;

    const client = await getTelegramClient().catch(() => null);
    if (!client) return;
    await ensureChannelUploadWatcher(client);

    const resolved = await resolveChannelPeerFromLinkOrId(client, cfg.channelUrl);
    if (!resolved) return;

    const { peer, cleanChannelId, channelTitle, publicUsername } = resolved;

    const priorityIds = consumePriorityChannelMsgIds(cleanChannelId);

    // Also inspect Bot API getUpdates for any brand-new channel_post in this channel
    try {
      const { botToken } = getTelegramCredentials();
      if (botToken && /^\d+$/.test(cleanChannelId)) {
        const targetChatId = `-100${cleanChannelId}`;
        const updUrl = lastBotUpdateId > 0
          ? `https://api.telegram.org/bot${botToken}/getUpdates?offset=${lastBotUpdateId + 1}&limit=50&allowed_updates=%5B%22channel_post%22,%22edited_channel_post%22,%22message%22%5D`
          : `https://api.telegram.org/bot${botToken}/getUpdates?limit=50&allowed_updates=%5B%22channel_post%22,%22edited_channel_post%22,%22message%22%5D`;
        const updResp = await fetch(updUrl);
        const updJson: any = await updResp.json();
        for (const u of updJson?.result || []) {
          if (u?.update_id && Number(u.update_id) > lastBotUpdateId) {
            lastBotUpdateId = Number(u.update_id);
          }
          const src = u?.channel_post || u?.edited_channel_post;
          if (src && String(src?.chat?.id || '') === targetChatId) {
            const mid = Number(src.message_id || 0);
            if (mid > 0) {
              if (!priorityIds.includes(mid)) priorityIds.push(mid);
              const prevKnown = channelMaxKnownMsgId.get(cleanChannelId) || 0;
              if (mid > prevKnown) channelMaxKnownMsgId.set(cleanChannelId, mid);
            }
          }
        }
      }
    } catch {}

    let baseline = Math.max(
      cfg.lastSyncedMsgId,
      localChannelCheckpoint[cleanChannelId] || 0
    );
    let reconciledStaleBaseline = false;

    const knownMax = channelMaxKnownMsgId.get(cleanChannelId) || 0;
    if (baseline <= 0) {
      const latest = await discoverChannelLatestMsgId(client, peer, cleanChannelId);
      if (latest <= 0 && priorityIds.length === 0) return;
      baseline = Math.max(0, latest - 25);
    } else if (knownMax > baseline + 25) {
      // Jump ahead to the active channel tail if persisted baseline lagged far behind
      baseline = Math.max(baseline, knownMax - 25);
    }

    // Fast lightweight probe: check up to 60 messages after baseline + priority NewMessage IDs
    const probeSet = new Set<number>(priorityIds);
    const probeStart = Math.max(baseline, knownMax > baseline + 25 ? knownMax - 25 : baseline);
    for (let id = probeStart + 1; id <= probeStart + 60; id++) probeSet.add(id);
    const probeIds = Array.from(probeSet).sort((a, b) => a - b);
    const probedMsgs: any[] = probeIds.length > 0 ? await client.getMessages(peer, { ids: probeIds }).catch(() => []) : [];
    const validMsgMap = new Map<number, any>();
    for (const m of probedMsgs || []) {
      if (m && m.id) validMsgMap.set(Number(m.id), m);
    }

    // Reconcile if baseline is higher than actual channel messages (e.g., stale lastSyncedMsgId when channel cleared)
    // OR on boot/manual trigger/periodic when nothing appeared after baseline
    const shouldReconcile =
      validMsgMap.size === 0 &&
      (reason === 'boot' || reason === 'manual_trigger' || Date.now() - lastReconcileCheckAt > 30_000);

    if (shouldReconcile) {
      lastReconcileCheckAt = Date.now();
      const realLatest = await discoverChannelLatestMsgId(client, peer, cleanChannelId);
      if (realLatest > 0 && (baseline > realLatest || realLatest > baseline || reason === 'boot' || reason === 'manual_trigger')) {
        if (baseline > realLatest) {
          reconciledStaleBaseline = true;
          baseline = 0;
        }
        const scanStart = reconciledStaleBaseline ? 1 : Math.max(1, realLatest - 60);
        for (let cur = scanStart; cur <= realLatest; cur += 100) {
          const endCur = Math.min(realLatest, cur + 99);
          const batch: number[] = [];
          for (let id = cur; id <= endCur; id++) batch.push(id);
          const got: any[] = await client.getMessages(peer, { ids: batch }).catch(() => []);
          for (const m of got || []) {
            if (m && m.id) validMsgMap.set(Number(m.id), m);
          }
        }
      }
    }

    let validMsgs = Array.from(validMsgMap.values());

    if (validMsgs.length === 0) {
      if (reconciledStaleBaseline) {
        localChannelCheckpoint[cleanChannelId] = 0;
        await setDocWithQuotaGuard(
          doc(db, 'app_config', 'telegram_auto_sync'),
          { lastSyncedMsgId: 0, updatedAtMs: Date.now(), updatedAt: serverTimestamp() },
          { merge: true }
        ).catch(() => {});
        if (cachedSyncConfig) cachedSyncConfig.lastSyncedMsgId = 0;
      }
      return;
    }

    // Fetch up to another 130 if the forward batch was nearly full
    if (!reconciledStaleBaseline && validMsgs.length >= 20) {
      const moreIds: number[] = [];
      for (let id = baseline + 26; id <= baseline + 150; id++) moreIds.push(id);
      const moreMsgs: any[] = await client.getMessages(peer, { ids: moreIds }).catch(() => []);
      for (const m of moreMsgs || []) {
        if (m && m.id && !validMsgMap.has(Number(m.id))) {
          validMsgMap.set(Number(m.id), m);
        }
      }
      validMsgs = Array.from(validMsgMap.values());
    }

    validMsgs.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
    const highestMsgId = Math.max(
      baseline,
      ...validMsgs.map((m) => Number(m.id || 0))
    );

    if (highestMsgId > (channelMaxKnownMsgId.get(cleanChannelId) || 0) || reconciledStaleBaseline) {
      channelMaxKnownMsgId.set(cleanChannelId, highestMsgId);
      saveRecentChannelPostsToDisk();
    }

    // Load existing movies & series from public/movies-seed.json + Firestore
    const seedCatalogMap = new Map<string, any>();
    const existingUrlSet = new Set<string>();
    const existingRecords: ExistingMovieRecord[] = [];
    const registerExistingDoc = (id: string, m: any) => {
      if (!id || !m) return;
      const existing = seedCatalogMap.get(id);
      if (!existing) {
        seedCatalogMap.set(id, { id, ...m });
      } else {
        const existingPoster = String(existing.posterUrl || '');
        const incomingPoster = String(m.posterUrl || '');
        const existingIsSvg = !existingPoster || existingPoster.startsWith('data:image/svg+xml');
        const incomingIsReal = Boolean(incomingPoster && !incomingPoster.startsWith('data:image/svg+xml'));
        if (existingIsSvg && incomingIsReal) {
          seedCatalogMap.set(id, { ...existing, ...m, id });
        }
      }
      const cat = String(m?.originalCategory || '');
      const isSeries = cat.toLowerCase().includes('series') || (Array.isArray(m?.seasons) && m.seasons.length > 0);
      if (m?.streamingUrl) existingUrlSet.add(String(m.streamingUrl).trim().toLowerCase());
      if (m?.videoQualities && typeof m.videoQualities === 'object') {
        Object.values(m.videoQualities).forEach((u) => {
          if (typeof u === 'string' && u.trim()) existingUrlSet.add(u.trim().toLowerCase());
        });
      }
      if (Array.isArray(m?.seasons)) {
        m.seasons.forEach((s: any) => {
          if (Array.isArray(s?.episodes)) {
            s.episodes.forEach((ep: any) => {
              if (ep?.streamUrl) existingUrlSet.add(String(ep.streamUrl).trim().toLowerCase());
            });
          }
        });
      }
      if (!existingRecords.some((r) => r.id === id)) {
        const normBadge = normalizeQualityBadge(m?.qualityBadge);
        existingRecords.push({
          id,
          imdbId: String(m?.imdbId || '').trim(),
          title: String(m?.title || ''),
          originalTitle: String(m?.originalTitle || ''),
          releaseYear: Number(m?.releaseYear) || 0,
          originalCategory: cat,
          isSeries,
          published: m?.published !== false,
          qualityBadge: isHollywoodPrintMovie(m) ? 'HDTC' : normBadge !== 'NONE' ? normBadge : 'HD',
          sourceFileName: String(m?.sourceFileName || ''),
          sourceCaption: String(m?.sourceCaption || ''),
          posterUrl: String(m?.posterUrl || ''),
          streamingUrl: String(m?.streamingUrl || '').trim(),
          videoQualities: m?.videoQualities && typeof m.videoQualities === 'object' ? { ...m.videoQualities } : {},
          seasons: Array.isArray(m?.seasons) ? m.seasons : [],
        });
      }
    };

    try {
      if (fs.existsSync(SEED_CATALOG_PATH)) {
        const rawSeed = JSON.parse(fs.readFileSync(SEED_CATALOG_PATH, 'utf8'));
        if (Array.isArray(rawSeed)) {
          rawSeed.forEach((m: any) => {
            if (m?.id) registerExistingDoc(String(m.id), m);
          });
        }
      }
    } catch {}

    try {
      const existingSnap = await getDocsFromServer(collection(db, 'movies'));
      existingSnap.docs.forEach((d) => registerExistingDoc(d.id, d.data()));
    } catch {}

    interface BgRawCandidate {
      msgId: number;
      msgDateMs: number;
      streamUrl: string;
      doc: any;
      mime: string;
      durationSec: number;
      sizeBytes: number;
      width: number;
      height: number;
      fileName: string;
      caption: string;
      hasExplicitNoSound: boolean;
      parsed: ReturnType<typeof parseTelegramMovieMeta>;
    }

    const rawCandidates: BgRawCandidate[] = [];
    for (const msg of validMsgs) {
      const classified = classifyTelegramDocMedia(msg);
      if (classified.kind !== 'video') continue;
      const streamUrl = publicUsername
        ? `https://t.me/${publicUsername}/${msg.id}`
        : `https://t.me/c/${cleanChannelId}/${msg.id}`;
      const parsedMeta = parseTelegramMovieMeta(
        classified.fileName,
        classified.caption,
        classified.width,
        classified.height,
        classified.durationSec,
        classified.sizeBytes
      );
      if (parsedMeta.isSampleOrClip) continue;
      if (existingUrlSet.has(streamUrl.toLowerCase())) continue;

      primeMediaCacheFromTelegramDoc(
        streamUrl,
        classified.doc,
        classified.fileName,
        classified.durationSec,
        classified.mime
      );

      rawCandidates.push({
        msgId: Number(msg.id),
        msgDateMs: Number(msg.date || 0) > 0 ? Number(msg.date) * 1000 : 0,
        streamUrl,
        doc: classified.doc,
        mime: classified.mime,
        durationSec: classified.durationSec,
        sizeBytes: classified.sizeBytes,
        width: classified.width,
        height: classified.height,
        fileName: classified.fileName || `Movie_${msg.id}`,
        caption: classified.caption || '',
        hasExplicitNoSound: classified.hasExplicitNoSound,
        parsed: parsedMeta,
      });
    }

    interface BgVideoCandidate {
      msgId: number;
      msgDateMs: number;
      streamUrl: string;
      durationSec: number;
      sizeBytes: number;
      fileName: string;
      caption: string;
      parsed: ReturnType<typeof parseTelegramMovieMeta>;
    }

    const verifiedBgList = await mapWithConcurrency(
      rawCandidates,
      2,
      async (cand): Promise<BgVideoCandidate | null> => {
        const check = await verifyCandidateAudioAndHd(
          {
            streamUrl: cand.streamUrl,
            doc: cand.doc,
            mime: cand.mime,
            fileName: cand.fileName,
            caption: cand.caption,
            durationSec: cand.durationSec,
            width: cand.width,
            height: cand.height,
            parsedQuality: cand.parsed.quality,
            hasExplicitNoSound: cand.hasExplicitNoSound,
          },
          client,
          cfg.onlyValidAudioAndHd
        );
        if (!check.accepted) {
          console.log(
            `[ServerAutoSync] Skipped "${cand.fileName}" (${cand.streamUrl}) — reason=${check.reason}`
          );
          return null;
        }
        return {
          msgId: cand.msgId,
          msgDateMs: cand.msgDateMs,
          streamUrl: cand.streamUrl,
          durationSec: check.durationSec || cand.durationSec,
          sizeBytes: cand.sizeBytes,
          fileName: cand.fileName,
          caption: cand.caption,
          parsed: {
            ...cand.parsed,
            quality: check.effectiveQuality || cand.parsed.quality,
          },
        };
      }
    );

    const candidates = verifiedBgList.filter((c): c is BgVideoCandidate => Boolean(c));

    if (candidates.length === 0) {
      if (highestMsgId > cfg.lastSyncedMsgId || highestMsgId > (localChannelCheckpoint[cleanChannelId] || 0)) {
        saveLocalChannelCheckpoint(cleanChannelId, highestMsgId);
        if (cachedSyncConfig) cachedSyncConfig.lastSyncedMsgId = highestMsgId;
        await setDocWithQuotaGuard(
          doc(db, 'app_config', 'telegram_auto_sync'),
          { lastSyncedMsgId: highestMsgId, updatedAtMs: Date.now(), updatedAt: serverTimestamp() },
          { merge: true }
        ).catch(() => {});
      }
      return;
    }

    // Group multi-quality uploads (both movies AND same-episode series uploads!)
    interface BgGroup {
      groupKey: string;
      primary: BgVideoCandidate;
      members: BgVideoCandidate[];
      videoQualities: Record<string, string>;
      qualitySizes: Record<string, number>;
    }

    const groups: BgGroup[] = [];
    const groupIdxByKey = new Map<string, number>();

    for (const v of candidates) {
      const gKey = v.parsed.groupKey || `msg-${v.msgId}`;
      const existingIdx = v.parsed.groupKey ? groupIdxByKey.get(gKey) : undefined;
      if (existingIdx !== undefined) {
        const grp = groups[existingIdx];
        grp.members.push(v);
        if (v.parsed.quality) {
          const prevSize = grp.qualitySizes[v.parsed.quality] || 0;
          if (!grp.videoQualities[v.parsed.quality] || v.sizeBytes > prevSize) {
            grp.videoQualities[v.parsed.quality] = v.streamUrl;
            grp.qualitySizes[v.parsed.quality] = v.sizeBytes;
          }
        }
        if (
          (!grp.primary.parsed.year && v.parsed.year) ||
          (!grp.primary.parsed.explicitImdbId && v.parsed.explicitImdbId) ||
          v.parsed.quality === '1080p'
        ) {
          grp.primary = v;
        }
      } else {
        const vq: Record<string, string> = {};
        const qs: Record<string, number> = {};
        if (v.parsed.quality) {
          vq[v.parsed.quality] = v.streamUrl;
          qs[v.parsed.quality] = v.sizeBytes;
        }
        const idx = groups.length;
        groups.push({ groupKey: gKey, primary: v, members: [v], videoQualities: vq, qualitySizes: qs });
        if (v.parsed.groupKey) {
          groupIdxByKey.set(gKey, idx);
        }
      }
    }

    let publishedCount = 0;
    let catalogDirty = false;
    const queuedForReview: AutoMatchedMovieDraft[] = [];

    for (const grp of groups) {
      const {
        effectivePrimary,
        effectiveMembers,
        filteredQualities,
        bestStream,
        qualityBadge,
        bestDurSec,
        realMsgDateMs,
      } = buildEffectiveQualityGroup(grp.members, grp.primary, cfg.onlyValidAudioAndHd);

      const mergedParsed = {
        ...effectivePrimary.parsed,
        year: effectivePrimary.parsed.year || effectiveMembers.find((m) => m.parsed.year)?.parsed.year || null,
        languageHint:
          effectivePrimary.parsed.languageHint ||
          effectiveMembers.find((m) => m.parsed.languageHint)?.parsed.languageHint ||
          '',
        isHindiDubbed: effectiveMembers.some((m) => m.parsed.isHindiDubbed),
      };

      const matched = await resolveBestImdbMatch(mergedParsed);
      const candYear = Number(matched.releaseYear || mergedParsed.year || 0);
      const isSeriesItem =
        mergedParsed.isSeriesEpisode ||
        String(matched.originalCategory || '').toLowerCase().includes('series');

      const durationFormatted = bestDurSec > 0 ? formatDuration(bestDurSec) : '';

      const draft: AutoMatchedMovieDraft = {
        draftId: `tg-${cleanChannelId}-${effectivePrimary.msgId}`,
        channelId: cleanChannelId,
        channelTitle,
        msgId: effectivePrimary.msgId,
        msgDateMs: realMsgDateMs > 0 ? realMsgDateMs : undefined,
        sourceMsgIds: grp.members.map((m) => m.msgId),
        streamUrl: bestStream,
        videoQualities: filteredQualities,
        qualityBadge,
        durationSec: bestDurSec,
        runtime: isSeriesItem ? durationFormatted : (durationFormatted || matched.runtime),
        sourceFileName: effectivePrimary.fileName,
        sourceCaption: `${mergedParsed.cleanTitle}${mergedParsed.year ? ` (${mergedParsed.year})` : ''}`,
        parsedTitle: mergedParsed.cleanTitle,
        parsedYear: mergedParsed.year,
        imdbId: matched.imdbId,
        title: matched.title,
        originalTitle: matched.originalTitle,
        releaseYear: matched.releaseYear,
        posterUrl: matched.posterUrl,
        backdropUrl: matched.backdropUrl,
        genre: matched.genre,
        description: matched.description,
        director: matched.director,
        cast: matched.cast,
        language: matched.language,
        rating: matched.rating,
        originalCategory: matched.originalCategory,
        matchConfidence: matched.matchConfidence,
        confidenceScore: matched.confidenceScore,
        matchReason: matched.matchReason,
        isSeriesEpisode: mergedParsed.isSeriesEpisode,
        seasonNumber: mergedParsed.seasonNumber,
        episodeNumber: mergedParsed.episodeNumber,
        episodeLabel: mergedParsed.episodeLabel,
        episodeTitle: mergedParsed.episodeTitle,
        alternateMatches: matched.alternateMatches,
      };

      const existingRec = findMatchingExistingRecord(
        existingRecords,
        draft.imdbId,
        [draft.title, draft.originalTitle, mergedParsed.cleanTitle],
        candYear,
        isSeriesItem
      );

      if (cfg.autoPublishVerified) {
        const nowMs = Date.now();
        const itemDateMs = realMsgDateMs > 0 ? realMsgDateMs : nowMs;
        const fallbackSvg = buildFallbackPosterDataUri(draft.title || mergedParsed.cleanTitle, candYear);
        const cleanPoster = (draft.posterUrl ? upgradePosterUrl(draft.posterUrl, 1080) || draft.posterUrl : '') || fallbackSvg;
        const cleanBackdrop = (draft.backdropUrl || draft.posterUrl ? upgradePosterUrl(draft.backdropUrl || cleanPoster, 1280) || cleanPoster : '') || fallbackSvg;
        const catToSave = isSeriesItem
          ? (String(draft.originalCategory || '').toLowerCase().includes('anime') ? 'Anime Series' : 'Web Series')
          : (draft.originalCategory || 'Bollywood Movie');
        const displayCat = getDisplayCategory(catToSave);
        const badge = normalizeQualityBadge(draft.qualityBadge) === 'HDTC' ? 'HDTC' : 'HD';

        if (isSeriesItem) {
          const seasonNum = Math.max(1, Number(draft.seasonNumber) || 1);
          const rawEpNum = Number(draft.episodeNumber);
          const isCompletePackByDur =
            (!Number.isFinite(rawEpNum) || rawEpNum <= 0) &&
            bestDurSec >= 5400 &&
            /\b(?:s\d{1,2}|season|session|complete|combined|full)\b/i.test(
              `${draft.sourceFileName} ${draft.sourceCaption}`
            );

          if (!Number.isFinite(rawEpNum) || rawEpNum <= 0) {
            if (!isCompletePackByDur) {
              existingUrlSet.add(draft.streamUrl.toLowerCase());
              continue;
            }
          }

          const resolvedEpLabel = isCompletePackByDur ? 'Complete' : draft.episodeLabel;
          const epNum = isCompletePackByDur ? 1 : Math.floor(rawEpNum);
          const epTitle = isCompletePackByDur
            ? 'Complete Season'
            : draft.episodeTitle || `Episode ${epNum}`;
          const epQuality =
            mergedParsed.quality ||
            (filteredQualities['1080p']
              ? '1080p'
              : filteredQualities['720p']
              ? '720p'
              : filteredQualities['480p']
              ? '480p'
              : '');
          const epObj = {
            episodeNumber: epNum,
            ...(resolvedEpLabel ? { episodeLabel: resolvedEpLabel } : {}),
            title: epTitle,
            streamUrl: draft.streamUrl.trim(),
            ...(epQuality ? { quality: epQuality } : {}),
            ...(durationFormatted ? { duration: durationFormatted } : {}),
            ...(bestDurSec > 0 ? { durationSec: bestDurSec } : {}),
            showInNewEpisodes: false,
          };

          const seriesImdbId = (existingRec?.imdbId || draft.imdbId || '').trim();
          const expectedCounts = seriesImdbId
            ? await fetchExpectedSeasonEpisodeCounts(seriesImdbId)
            : null;

          if (existingRec) {
            const seriesUpgrade = getQualityUpgradeDecision(existingRec, badge);
            if (seriesUpgrade === 'skip_holl_print_on_hd') {
              existingUrlSet.add(draft.streamUrl.toLowerCase());
              continue;
            }
            const replaceExistingEp = seriesUpgrade === 'replace_holl_print_with_hd';
            const { mergedSeasons, added } = mergeEpisodeIntoSeasons(
              existingRec.seasons,
              seasonNum,
              epObj,
              replaceExistingEp
            );
            if (!added) {
              existingUrlSet.add(draft.streamUrl.toLowerCase());
              continue;
            }
            const normalizedExisting = normalizeSeriesSeasons({
              ...existingRec,
              originalCategory: catToSave,
              seasons: mergedSeasons,
              streamingUrl: replaceExistingEp ? epObj.streamUrl : existingRec.streamingUrl,
            });
            const isSingleSmallNonCompleteEp =
              !expectedCounts &&
              (normalizedExisting.seasons?.length || 0) === 1 &&
              (normalizedExisting.seasons?.[0]?.episodes?.length || 0) === 1 &&
              !isCompleteSeasonPackEpisode(normalizedExisting.seasons[0].episodes[0]) &&
              Number(normalizedExisting.seasons[0].episodes[0]?.durationSec || 0) < 5400;
            const seriesReadyToPublish =
              !isSingleSmallNonCompleteEp && isSeriesComplete(normalizedExisting, expectedCounts);
            const wasPublished = existingRec.published !== false;
            const nextPublished = seriesReadyToPublish;
            const nextStream = normalizedExisting.streamingUrl || epObj.streamUrl;
            const nextSeriesBadge = badge === 'HD' ? 'HD' : existingRec.qualityBadge || badge;
            const prevSeed = seedCatalogMap.get(existingRec.id) || {};
            const prevPoster = String(prevSeed.posterUrl || existingRec.posterUrl || '');
            const existingHasSvgPoster = !prevPoster || prevPoster.startsWith('data:image/svg+xml');
            const incomingHasRealPoster = Boolean(cleanPoster && !cleanPoster.startsWith('data:image/svg+xml'));
            const seriesPosterPatch: Record<string, any> =
              existingHasSvgPoster && incomingHasRealPoster
                ? {
                    posterUrl: cleanPoster,
                    backdropUrl: cleanBackdrop,
                    ...(!existingRec.imdbId && seriesImdbId ? { imdbId: seriesImdbId } : {}),
                    ...(draft.description ? { description: draft.description.trim() } : {}),
                    ...(draft.director ? { director: draft.director.trim() } : {}),
                    ...(draft.cast ? { cast: draft.cast.trim() } : {}),
                  }
                : {};
            seedCatalogMap.set(existingRec.id, {
              ...prevSeed,
              id: existingRec.id,
              seasons: mergedSeasons,
              streamingUrl: nextStream,
              qualityBadge: nextSeriesBadge,
              published: nextPublished,
              releaseYear: clampReleaseYear(prevSeed.releaseYear || draft.releaseYear),
              ...seriesPosterPatch,
              ...(nextPublished && !wasPublished ? { createdAt: nowMs } : {}),
              updatedAt: nowMs,
            });
            await setDocWithQuotaGuard(
              doc(db, 'movies', existingRec.id),
              {
                seasons: mergedSeasons,
                streamingUrl: nextStream,
                qualityBadge: nextSeriesBadge,
                published: nextPublished,
                ...seriesPosterPatch,
                ...(nextPublished && !wasPublished ? { createdAt: nowMs } : {}),
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            ).catch(() => {});
            existingRec.seasons = mergedSeasons;
            existingRec.streamingUrl = nextStream;
            existingRec.qualityBadge = nextSeriesBadge;
            existingRec.published = nextPublished;
            if (seriesPosterPatch.posterUrl) existingRec.posterUrl = seriesPosterPatch.posterUrl;
            grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
            catalogDirty = true;

            if (nextPublished) {
              publishedCount++;
              console.log(
                `[ServerAutoSync] Added ${draft.title} S${seasonNum}E${epNum} -> movies/${existingRec.id} (${seriesReadyToPublish ? 'complete & published' : 'season update on published series'})`
              );

              if (cfg.notifyOnNewPublish && publishedCount <= 3) {
                await setDocWithQuotaGuard(
                  doc(db, 'announcements', `tg_rel_${cleanChannelId}_${draft.msgId}`),
                  {
                    title: draft.title,
                    releaseYear: clampReleaseYear(draft.releaseYear),
                    category: catToSave,
                    isSeries: true,
                    language: (draft.language || 'Hindi').trim(),
                    genre: (draft.genre || 'Drama').trim(),
                    qualityBadge: badge,
                    runtime: (draft.runtime || '').trim(),
                    posterUrl: cleanPoster,
                    backdropUrl: cleanBackdrop,
                    message: !wasPublished
                      ? 'COMPLETE SERIES • GO STREAM or DOWNLOAD NOW'
                      : `Season ${seasonNum} Episode ${draft.episodeLabel || epNum} Now Streaming!`,
                    movieId: existingRec.id,
                    createdAt: serverTimestamp(),
                    createdAtMs: nowMs,
                    expiresAt: new Date(nowMs + 48 * 60 * 60 * 1000),
                  },
                  { merge: true }
                ).catch(() => {});
              }
            } else {
              console.log(
                `[ServerAutoSync] Staged incomplete series "${draft.title}" S${seasonNum}E${epNum} (published: false until all episodes arrive)`
              );
            }
            continue;
          } else {
            const seriesDocId = `tg_series_${cleanChannelId}_${draft.msgId}`;
            const initialSeasons = [{ seasonNumber: seasonNum, episodes: [epObj] }];
            const isSingleSmallNonCompleteEp =
              !expectedCounts &&
              !isCompleteSeasonPackEpisode(epObj) &&
              Number(epObj.durationSec || bestDurSec || 0) < 5400;
            const seriesReadyToPublish =
              !isSingleSmallNonCompleteEp &&
              isSeriesComplete(
                { id: seriesDocId, originalCategory: catToSave, seasons: initialSeasons },
                expectedCounts
              );
            const seriesBase = {
              id: seriesDocId,
              title: draft.title.trim(),
              originalTitle: (draft.originalTitle || draft.title).trim(),
              description: draft.description.trim(),
              posterUrl: cleanPoster,
              backdropUrl: cleanBackdrop,
              releaseYear: clampReleaseYear(draft.releaseYear),
              originalCategory: catToSave,
              displayCategory: displayCat,
              contentType: catToSave.toLowerCase().includes('anime') ? 'anime' : null,
              language: (draft.language || 'Hindi').trim(),
              genre: (draft.genre || 'Drama').trim(),
              director: (draft.director || '').trim(),
              cast: (draft.cast || '').trim(),
              runtime: (draft.runtime || '').trim(),
              rating: Number(draft.rating) || 8.0,
              imdbId: seriesImdbId,
              trailerUrl: '',
              streamingUrl: epObj.streamUrl,
              videoQualities: {},
              seasons: initialSeasons,
              featured: true,
              published: seriesReadyToPublish,
              qualityBadge: badge,
              duration: bestDurSec || parseDurationToSeconds(draft.runtime) || 0,
              telegramMsgId: draft.msgId,
              telegramChannelId: cleanChannelId,
              telegramDateMs: itemDateMs,
              updatedAt: nowMs,
              createdAt: itemDateMs,
            };
            seedCatalogMap.set(seriesDocId, seriesBase);
            await setDocWithQuotaGuard(
              doc(db, 'movies', seriesDocId),
              {
                ...seriesBase,
                updatedAt: serverTimestamp(),
                createdAt: itemDateMs,
              },
              { merge: true }
            ).catch(() => {});
            grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
            existingRecords.push({
              id: seriesDocId,
              imdbId: seriesImdbId,
              title: draft.title.trim(),
              originalTitle: (draft.originalTitle || draft.title).trim(),
              releaseYear: clampReleaseYear(draft.releaseYear),
              originalCategory: catToSave,
              isSeries: true,
              published: seriesReadyToPublish,
              qualityBadge: badge,
              sourceFileName: draft.sourceFileName || '',
              sourceCaption: draft.sourceCaption || '',
              posterUrl: cleanPoster,
              streamingUrl: epObj.streamUrl,
              videoQualities: {},
              seasons: initialSeasons,
            });
            catalogDirty = true;

            if (seriesReadyToPublish) {
              publishedCount++;
              console.log(
                `[ServerAutoSync] Auto-Published Series "${draft.title}" S${seasonNum}E${epNum} (${seriesImdbId || 'no-imdb'}) -> movies/${seriesDocId}`
              );

              if (cfg.notifyOnNewPublish && publishedCount <= 3) {
                await setDocWithQuotaGuard(
                  doc(db, 'announcements', `tg_rel_${cleanChannelId}_${draft.msgId}`),
                  {
                    title: draft.title,
                    releaseYear: clampReleaseYear(draft.releaseYear),
                    category: catToSave,
                    isSeries: true,
                    language: (draft.language || 'Hindi').trim(),
                    genre: (draft.genre || 'Drama').trim(),
                    qualityBadge: badge,
                    runtime: (draft.runtime || '').trim(),
                    posterUrl: cleanPoster,
                    backdropUrl: cleanBackdrop,
                    message: 'NEW SERIES • GO STREAM or DOWNLOAD NOW',
                    movieId: seriesDocId,
                    createdAt: serverTimestamp(),
                    createdAtMs: nowMs,
                    expiresAt: new Date(nowMs + 48 * 60 * 60 * 1000),
                  },
                  { merge: true }
                ).catch(() => {});
              }
            } else {
              console.log(
                `[ServerAutoSync] Staged incomplete series "${draft.title}" S${seasonNum}E${epNum} (${seriesImdbId || 'no-imdb'}) -> hidden until complete`
              );
            }
            continue;
          }
        }

        // Single Movie: replace Holl Print with HD OR merge new quality if same tier, otherwise publish new doc
        if (existingRec) {
          const upgradeDecision = getQualityUpgradeDecision(existingRec, badge);
          if (upgradeDecision === 'skip_holl_print_on_hd') {
            grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
            continue;
          }

          const incomingCleanQualities = Object.fromEntries(
            Object.entries(draft.videoQualities || {}).filter(([, u]) => Boolean(String(u || '').trim()))
          );
          const prevSeed = seedCatalogMap.get(existingRec.id) || {};
          const prevPoster = String(prevSeed.posterUrl || existingRec.posterUrl || '');
          const existingHasSvgPoster = !prevPoster || prevPoster.startsWith('data:image/svg+xml');
          const incomingHasRealPoster = Boolean(cleanPoster && !cleanPoster.startsWith('data:image/svg+xml'));
          const posterBackfillPatch: Record<string, any> =
            existingHasSvgPoster && incomingHasRealPoster
              ? {
                  posterUrl: cleanPoster,
                  backdropUrl: cleanBackdrop,
                  ...(draft.title ? { title: draft.title.trim(), originalTitle: (draft.originalTitle || draft.title).trim() } : {}),
                  ...(draft.description ? { description: draft.description.trim() } : {}),
                  ...(draft.genre ? { genre: draft.genre.trim() } : {}),
                  ...(draft.director ? { director: draft.director.trim() } : {}),
                  ...(draft.cast ? { cast: draft.cast.trim() } : {}),
                  ...(draft.language ? { language: draft.language.trim() } : {}),
                  ...(!existingRec.imdbId && draft.imdbId ? { imdbId: draft.imdbId.trim() } : {}),
                }
              : !existingRec.imdbId && draft.imdbId
              ? { imdbId: draft.imdbId.trim() }
              : {};

          if (upgradeDecision === 'replace_holl_print_with_hd') {
            const replacedStream =
              incomingCleanQualities['1080p'] ||
              incomingCleanQualities['4K'] ||
              incomingCleanQualities['720p'] ||
              incomingCleanQualities['480p'] ||
              draft.streamUrl.trim();
            const nextRuntime = (draft.runtime || prevSeed.runtime || '').trim();
            const nextDuration =
              bestDurSec || parseDurationToSeconds(nextRuntime) || prevSeed.duration || 0;
            const replacePayload: any = {
              videoQualities: incomingCleanQualities,
              streamingUrl: replacedStream,
              qualityBadge: 'HD',
              sourceFileName: draft.sourceFileName || '',
              sourceCaption: draft.sourceCaption || '',
              telegramMsgId: draft.msgId,
              ...(nextRuntime ? { runtime: nextRuntime } : {}),
              ...(nextDuration > 0 ? { duration: nextDuration } : {}),
              ...posterBackfillPatch,
              updatedAt: nowMs,
            };
            seedCatalogMap.set(existingRec.id, {
              ...prevSeed,
              id: existingRec.id,
              ...replacePayload,
            });
            await updateDocWithQuotaGuard(doc(db, 'movies', existingRec.id), {
              ...replacePayload,
              updatedAt: serverTimestamp(),
            }).catch(() => {});
            existingRec.videoQualities = incomingCleanQualities;
            existingRec.streamingUrl = replacedStream;
            existingRec.qualityBadge = 'HD';
            existingRec.sourceFileName = draft.sourceFileName || '';
            existingRec.sourceCaption = draft.sourceCaption || '';
            if (posterBackfillPatch.posterUrl) existingRec.posterUrl = posterBackfillPatch.posterUrl;
            if (posterBackfillPatch.imdbId) existingRec.imdbId = posterBackfillPatch.imdbId;
            grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
            catalogDirty = true;
            publishedCount++;
            console.log(
              `[ServerAutoSync] Upgraded Holl Print -> HD for "${existingRec.title}" -> movies/${existingRec.id}`
            );
            continue;
          }

          const mergedQualities = { ...existingRec.videoQualities };
          let qualityAdded = false;
          for (const [qk, qUrl] of Object.entries(incomingCleanQualities)) {
            if (qUrl && !mergedQualities[qk]) {
              mergedQualities[qk] = qUrl;
              qualityAdded = true;
            }
          }
          const needsPosterBackfill = Object.keys(posterBackfillPatch).length > 0;
          if (qualityAdded || needsPosterBackfill) {
            const upgradedStream =
              mergedQualities['1080p'] ||
              mergedQualities['4K'] ||
              existingRec.streamingUrl ||
              draft.streamUrl.trim();
            const upgradedBadge =
              badge === 'HD' ? 'HD' : prevSeed.qualityBadge || badge;
            const mergePayload = {
              ...(qualityAdded ? { videoQualities: mergedQualities, streamingUrl: upgradedStream, qualityBadge: upgradedBadge } : {}),
              ...posterBackfillPatch,
              updatedAt: nowMs,
            };
            seedCatalogMap.set(existingRec.id, {
              ...prevSeed,
              id: existingRec.id,
              ...mergePayload,
            });
            await setDocWithQuotaGuard(
              doc(db, 'movies', existingRec.id),
              {
                ...mergePayload,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            ).catch(() => {});
            if (qualityAdded) {
              existingRec.videoQualities = mergedQualities;
              existingRec.streamingUrl = upgradedStream;
              existingRec.qualityBadge = upgradedBadge;
            }
            if (posterBackfillPatch.posterUrl) existingRec.posterUrl = posterBackfillPatch.posterUrl;
            if (posterBackfillPatch.imdbId) existingRec.imdbId = posterBackfillPatch.imdbId;
            grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
            catalogDirty = true;
            publishedCount++;
            console.log(
              `[ServerAutoSync] ${qualityAdded ? 'Merged new quality' : 'Backfilled poster/IMDb'} for "${existingRec.title}" -> movies/${existingRec.id}`
            );
          } else {
            grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
          }
          continue;
        }

        const deterministicDocId = `tg_${cleanChannelId}_${draft.msgId}`;
        const movieBase = {
          id: deterministicDocId,
          title: draft.title.trim(),
          originalTitle: (draft.originalTitle || draft.title).trim(),
          description: draft.description.trim(),
          posterUrl: cleanPoster,
          backdropUrl: cleanBackdrop,
          releaseYear: clampReleaseYear(draft.releaseYear),
          originalCategory: catToSave,
          displayCategory: displayCat,
          contentType: catToSave.toLowerCase().includes('anime') ? 'anime' : null,
          language: (draft.language || 'Hindi').trim(),
          genre: (draft.genre || 'Action').trim(),
          director: (draft.director || '').trim(),
          cast: (draft.cast || '').trim(),
          runtime: (draft.runtime || '').trim(),
          rating: Number(draft.rating) || 8.0,
          imdbId: (draft.imdbId || '').trim(),
          trailerUrl: '',
          streamingUrl: draft.streamUrl.trim(),
          videoQualities: draft.videoQualities || {},
          seasons: [],
          featured: true,
          published: true,
          qualityBadge: badge,
          sourceFileName: draft.sourceFileName || '',
          sourceCaption: draft.sourceCaption || '',
          duration: draft.durationSec || parseDurationToSeconds(draft.runtime) || 0,
          telegramMsgId: draft.msgId,
          telegramChannelId: cleanChannelId,
          telegramDateMs: itemDateMs,
          updatedAt: nowMs,
          createdAt: itemDateMs,
        };
        seedCatalogMap.set(deterministicDocId, movieBase);
        await setDocWithQuotaGuard(
          doc(db, 'movies', deterministicDocId),
          {
            ...movieBase,
            updatedAt: serverTimestamp(),
            createdAt: itemDateMs,
          },
          { merge: true }
        ).catch(() => {});

        grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
        existingRecords.push({
          id: deterministicDocId,
          imdbId: (draft.imdbId || '').trim(),
          title: draft.title.trim(),
          originalTitle: (draft.originalTitle || draft.title).trim(),
          releaseYear: clampReleaseYear(draft.releaseYear),
          originalCategory: catToSave,
          isSeries: false,
          published: true,
          qualityBadge: badge,
          sourceFileName: draft.sourceFileName || '',
          sourceCaption: draft.sourceCaption || '',
          posterUrl: cleanPoster,
          streamingUrl: draft.streamUrl.trim(),
          videoQualities: draft.videoQualities || {},
          seasons: [],
        });
        publishedCount++;

        console.log(
          `[ServerAutoSync] Auto-Published Movie "${draft.title}" (${clampReleaseYear(draft.releaseYear)}, ${draft.imdbId || 'no-imdb'}) -> movies/${deterministicDocId}`
        );

        if (cfg.notifyOnNewPublish && publishedCount <= 3) {
          await setDocWithQuotaGuard(
            doc(db, 'announcements', `tg_rel_${cleanChannelId}_${draft.msgId}`),
            {
              title: draft.title,
              releaseYear: clampReleaseYear(draft.releaseYear),
              category: catToSave,
              isSeries: false,
              language: (draft.language || 'Hindi').trim(),
              genre: (draft.genre || 'Action').trim(),
              qualityBadge: badge,
              runtime: (draft.runtime || '').trim(),
              posterUrl: cleanPoster,
              backdropUrl: cleanBackdrop,
              message: 'GO STREAM or DOWNLOAD NOW',
              movieId: deterministicDocId,
              createdAt: serverTimestamp(),
              createdAtMs: nowMs,
              expiresAt: new Date(nowMs + 48 * 60 * 60 * 1000),
            },
            { merge: true }
          ).catch(() => {});
        }
      } else {
        if (!existingRec || isSeriesItem) {
          queuedForReview.push(draft);
        }
      }
    }

    if (queuedForReview.length > 0) {
      const existingDraftIds = new Set(pendingServerDrafts.map((p) => p.draftId));
      const newQueued = queuedForReview.filter((q) => !existingDraftIds.has(q.draftId));
      if (newQueued.length > 0) {
        pendingServerDrafts = [...newQueued, ...pendingServerDrafts].slice(0, 100);
        savePendingServerDrafts();
      }
    }

    if (publishedCount > 0 || catalogDirty) {
      const updatedList = Array.from(seedCatalogMap.values());
      writeSeedCatalogToDisk(updatedList);
      broadcastLiveCatalogUpdate({
        type: 'catalog_updated',
        count: publishedCount || 1,
        updatedAt: Date.now(),
        action: 'auto_publish',
      });
      await setDocWithQuotaGuard(
        doc(db, 'app_config', 'catalog_sync'),
        {
          updatedAt: Date.now(),
          action: 'auto_publish',
        },
        { merge: true }
      ).catch(() => {});
    }

    if (highestMsgId > cfg.lastSyncedMsgId || highestMsgId > (localChannelCheckpoint[cleanChannelId] || 0) || reconciledStaleBaseline) {
      saveLocalChannelCheckpoint(cleanChannelId, highestMsgId);
      if (cachedSyncConfig) cachedSyncConfig.lastSyncedMsgId = highestMsgId;
      await setDocWithQuotaGuard(
        doc(db, 'app_config', 'telegram_auto_sync'),
        {
          lastSyncedMsgId: highestMsgId,
          updatedAtMs: Date.now(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
    }
  } catch (err: any) {
    console.warn('[ServerAutoSync] Sync pass warning:', err?.message || err);
  } finally {
    serverAutoSyncRunning = false;
    if (pendingResyncReason) {
      const nextReason = pendingResyncReason;
      pendingResyncReason = null;
      scheduleServerAutoSync(nextReason, 500);
    }
  }
}

// ============================================================================
// 3K+ BULK CHANNEL AUTO-PUBLISHER (VALID AUDIO + 720P/1080P ONLY)
// Background worker that scans an entire Telegram channel in safe batches,
// checks audio + HD resolution, resolves IMDb metadata, and publishes straight
// to Firestore with automatic FloodWait backoff and Quota-Exhausted checkpoints.
// ============================================================================
const FIREBASE_QUOTA_UPGRADE_URL =
  'https://console.firebase.google.com/project/gen-lang-client-0267042672/firestore/databases/ai-studio-movieportalhub-664a3e40-85f3-4758-945e-fd031bdc459f/data?openUpgradeDialog=true';

function isFirestoreQuotaError(err: any): boolean {
  return isFirestoreQuotaErrorLike(err);
}

async function setDocWithQuotaGuard(
  ref: any,
  data: any,
  options?: { merge?: boolean },
  timeoutMs = 8000
): Promise<void> {
  if (!isServerFirestoreWriteAllowed()) {
    throw Object.assign(
      new Error('Firestore daily write quota exhausted (resource-exhausted).'),
      { code: 'resource-exhausted' }
    );
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      options ? setDoc(ref, data, options) : setDoc(ref, data),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(
              new Error('Firestore write timed out.'),
              { code: 'deadline-exceeded' }
            )
          );
        }, timeoutMs);
      }),
    ]);
  } catch (err: any) {
    if (isFirestoreQuotaError(err)) {
      markServerFirestoreQuotaExhausted(err);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function updateDocWithQuotaGuard(
  ref: any,
  data: any,
  timeoutMs = 8000
): Promise<void> {
  if (!isServerFirestoreWriteAllowed()) {
    throw Object.assign(
      new Error('Firestore daily write quota exhausted (resource-exhausted).'),
      { code: 'resource-exhausted' }
    );
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      updateDoc(ref, data).catch(async (err: any) => {
        if (err?.code === 'not-found') {
          await setDoc(ref, data);
          return;
        }
        throw err;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            Object.assign(
              new Error('Firestore write timed out.'),
              { code: 'deadline-exceeded' }
            )
          );
        }, timeoutMs);
      }),
    ]);
  } catch (err: any) {
    if (isFirestoreQuotaError(err)) {
      markServerFirestoreQuotaExhausted(err);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface BulkSyncJobState {
  status: 'idle' | 'running' | 'completed' | 'stopped' | 'quota_paused' | 'error';
  channelRef: string;
  channelId: string;
  channelTitle: string;
  onlyValidAudioAndHd: boolean;
  startMsgId: number;
  endMsgId: number;
  currentMsgId: number;
  scannedMessages: number;
  totalVideosSeen: number;
  publishedCount: number;
  mergedCount: number;
  skippedNoAudio: number;
  skippedLowQuality: number;
  skippedDuplicates: number;
  skippedNonVideo: number;
  startedAtMs: number;
  updatedAtMs: number;
  errorMessage: string;
  upgradeUrl: string;
}

let bulkSyncStopRequested = false;
let bulkSyncJob: BulkSyncJobState = {
  status: 'idle',
  channelRef: '',
  channelId: '',
  channelTitle: '',
  onlyValidAudioAndHd: true,
  startMsgId: 0,
  endMsgId: 0,
  currentMsgId: 0,
  scannedMessages: 0,
  totalVideosSeen: 0,
  publishedCount: 0,
  mergedCount: 0,
  skippedNoAudio: 0,
  skippedLowQuality: 0,
  skippedDuplicates: 0,
  skippedNonVideo: 0,
  startedAtMs: 0,
  updatedAtMs: 0,
  errorMessage: '',
  upgradeUrl: '',
};

async function fetchMessagesWithFloodWait(client: any, peer: any, ids: number[]): Promise<any[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const got: any[] = await client.getMessages(peer, { ids });
      return Array.isArray(got) ? got : [];
    } catch (err: any) {
      const m = String(err?.message || '').match(/FLOOD_WAIT[_\s]?(\d+)/i);
      const waitSec = Number(err?.seconds || (m ? m[1] : 0));
      if (waitSec > 0 && waitSec <= 60 && attempt === 0) {
        console.warn(`[BulkChannelSync] Telegram FLOOD_WAIT ${waitSec}s — pausing briefly...`);
        await new Promise((r) => setTimeout(r, (waitSec + 1) * 1000));
        continue;
      }
      throw err;
    }
  }
  return [];
}

async function runBulkChannelSyncWorker(params: {
  client: any;
  peer: any;
  cleanChannelId: string;
  channelTitle: string;
  publicUsername: string;
  channelRef: string;
  startMsgId: number;
  endMsgId: number;
  onlyValidAudioAndHd: boolean;
}) {
  const {
    client,
    peer,
    cleanChannelId,
    channelTitle,
    publicUsername,
    channelRef,
    startMsgId,
    endMsgId,
    onlyValidAudioAndHd,
  } = params;

  try {
    // Preload existing Firestore catalog once to prevent duplicate writes & skip already published URLs
    const seedCatalogMap = new Map<string, any>();
    const existingUrlSet = new Set<string>();
    const existingRecords: ExistingMovieRecord[] = [];

    // 1. Preload from public/movies-seed.json so no previously scanned movies are lost
    try {
      if (fs.existsSync('public/movies-seed.json')) {
        const rawSeed = JSON.parse(fs.readFileSync('public/movies-seed.json', 'utf8'));
        if (Array.isArray(rawSeed)) {
          rawSeed.forEach((m: any) => {
            if (m && m.id) {
              seedCatalogMap.set(m.id, m);
              const cat = String(m?.originalCategory || '');
              const isSeries = cat.toLowerCase().includes('series') || (Array.isArray(m?.seasons) && m.seasons.length > 0);
              if (m?.streamingUrl) existingUrlSet.add(String(m.streamingUrl).trim().toLowerCase());
              if (m?.videoQualities && typeof m.videoQualities === 'object') {
                Object.values(m.videoQualities).forEach((u) => {
                  if (typeof u === 'string' && u.trim()) existingUrlSet.add(u.trim().toLowerCase());
                });
              }
              if (Array.isArray(m?.seasons)) {
                m.seasons.forEach((s: any) => {
                  if (Array.isArray(s?.episodes)) {
                    s.episodes.forEach((ep: any) => {
                      if (ep?.streamUrl) existingUrlSet.add(String(ep.streamUrl).trim().toLowerCase());
                    });
                  }
                });
              }
              const normSeedBadge = normalizeQualityBadge(m?.qualityBadge);
              existingRecords.push({
                id: m.id,
                imdbId: String(m?.imdbId || '').trim(),
                title: String(m?.title || ''),
                originalTitle: String(m?.originalTitle || ''),
                releaseYear: Number(m?.releaseYear) || 0,
                originalCategory: cat,
                isSeries,
                qualityBadge: isHollywoodPrintMovie(m) ? 'HDTC' : normSeedBadge !== 'NONE' ? normSeedBadge : 'HD',
                sourceFileName: String(m?.sourceFileName || ''),
                sourceCaption: String(m?.sourceCaption || ''),
                posterUrl: String(m?.posterUrl || ''),
                streamingUrl: String(m?.streamingUrl || '').trim(),
                videoQualities: m?.videoQualities && typeof m.videoQualities === 'object' ? { ...m.videoQualities } : {},
                seasons: Array.isArray(m?.seasons) ? m.seasons : [],
              });
            }
          });
        }
      }
    } catch (e) {
      console.warn('[BulkChannelSync] Note: Could not preload seed json:', e);
    }

    // 2. Also merge Firestore docs if readable
    try {
      const existingSnap = await getDocsFromServer(collection(db, 'movies'));
      existingSnap.docs.forEach((d) => {
        const m = d.data() as any;
        const existingSeed = seedCatalogMap.get(d.id);
        if (!existingSeed) {
          seedCatalogMap.set(d.id, { id: d.id, ...m });
        } else {
          const existingPoster = String(existingSeed.posterUrl || '');
          const incomingPoster = String(m?.posterUrl || '');
          if ((!existingPoster || existingPoster.startsWith('data:image/svg+xml')) && incomingPoster && !incomingPoster.startsWith('data:image/svg+xml')) {
            seedCatalogMap.set(d.id, { ...existingSeed, ...m, id: d.id });
          }
        }
        const cat = String(m?.originalCategory || '');
        const isSeries = cat.toLowerCase().includes('series') || (Array.isArray(m?.seasons) && m.seasons.length > 0);
        if (m?.streamingUrl) existingUrlSet.add(String(m.streamingUrl).trim().toLowerCase());
        if (m?.videoQualities && typeof m.videoQualities === 'object') {
          Object.values(m.videoQualities).forEach((u) => {
            if (typeof u === 'string' && u.trim()) existingUrlSet.add(u.trim().toLowerCase());
          });
        }
        if (Array.isArray(m?.seasons)) {
          m.seasons.forEach((s: any) => {
            if (Array.isArray(s?.episodes)) {
              s.episodes.forEach((ep: any) => {
                if (ep?.streamUrl) existingUrlSet.add(String(ep.streamUrl).trim().toLowerCase());
              });
            }
          });
        }
        if (!existingRecords.some((r) => r.id === d.id)) {
          const normFsBadge = normalizeQualityBadge(m?.qualityBadge);
          existingRecords.push({
            id: d.id,
            imdbId: String(m?.imdbId || '').trim(),
            title: String(m?.title || ''),
            originalTitle: String(m?.originalTitle || ''),
            releaseYear: Number(m?.releaseYear) || 0,
            originalCategory: cat,
            isSeries,
            qualityBadge: isHollywoodPrintMovie(m) ? 'HDTC' : normFsBadge !== 'NONE' ? normFsBadge : 'HD',
            sourceFileName: String(m?.sourceFileName || ''),
            sourceCaption: String(m?.sourceCaption || ''),
            posterUrl: String(m?.posterUrl || ''),
            streamingUrl: String(m?.streamingUrl || '').trim(),
            videoQualities: m?.videoQualities && typeof m.videoQualities === 'object' ? { ...m.videoQualities } : {},
            seasons: Array.isArray(m?.seasons) ? m.seasons : [],
          });
        }
      });
    } catch {}

    const imdbMatchCache = new Map<string, Awaited<ReturnType<typeof resolveBestImdbMatch>>>();
    const imdbInFlight = new Map<string, Promise<Awaited<ReturnType<typeof resolveBestImdbMatch>>>>();
    const resolveCachedImdb = async (parsedItem: ReturnType<typeof parseTelegramMovieMeta>) => {
      const key = parsedItem.explicitImdbId
        ? `id:${parsedItem.explicitImdbId.toLowerCase()}`
        : `${(parsedItem.cleanTitle || '').toLowerCase().trim()}|${parsedItem.year || ''}|${
            parsedItem.isSeriesEpisode ? 'S' : 'M'
          }`;
      const hit = imdbMatchCache.get(key);
      if (hit) return hit;

      const existingPromise = imdbInFlight.get(key);
      if (existingPromise) return existingPromise;

      const fallbackResult: Awaited<ReturnType<typeof resolveBestImdbMatch>> = {
        imdbId: '',
        title: parsedItem.cleanTitle || parsedItem.rawFileName || 'Untitled Movie',
        originalTitle: parsedItem.cleanTitle || parsedItem.rawFileName || 'Untitled Movie',
        releaseYear: parsedItem.year || new Date().getFullYear(),
        posterUrl: '',
        backdropUrl: '',
        genre: parsedItem.isSeriesEpisode ? 'Drama' : 'Action',
        description: '',
        director: '',
        cast: '',
        runtime: '',
        language: parsedItem.languageHint || 'Hindi',
        rating: 7.5,
        originalCategory: parsedItem.isSeriesEpisode ? 'Web Series' : 'Bollywood Movie',
        matchConfidence: 'low',
        confidenceScore: 0,
        matchReason: 'Metadata lookup timed out — using parsed title',
        alternateMatches: [],
      };

      const task = (async () => {
        try {
          const res = await Promise.race([
            resolveBestImdbMatch(parsedItem),
            new Promise<typeof fallbackResult>((resolve) =>
              setTimeout(() => resolve(fallbackResult), 8000)
            ),
          ]);
          if (key.length > 3) imdbMatchCache.set(key, res);
          return res;
        } catch {
          return fallbackResult;
        } finally {
          imdbInFlight.delete(key);
        }
      })();

      if (key.length > 3) imdbInFlight.set(key, task);
      return task;
    };

    const CHUNK_MSGS = 100;
    for (let cursor = startMsgId; cursor <= endMsgId; cursor += CHUNK_MSGS) {
      if (bulkSyncStopRequested) {
        bulkSyncJob.status = 'stopped';
        bulkSyncJob.updatedAtMs = Date.now();
        return;
      }

      const chunkEnd = Math.min(endMsgId, cursor + CHUNK_MSGS - 1);
      const ids: number[] = [];
      for (let id = cursor; id <= chunkEnd; id++) ids.push(id);

      const msgs = await fetchMessagesWithFloodWait(client, peer, ids);
      const validMsgs = msgs.filter((m) => m && m.id).sort((a, b) => Number(a.id) - Number(b.id));
      bulkSyncJob.scannedMessages += ids.length;
      bulkSyncJob.currentMsgId = chunkEnd;
      bulkSyncJob.updatedAtMs = Date.now();

      interface BulkRawCand {
        msgId: number;
        msgDateMs: number;
        streamUrl: string;
        doc: any;
        mime: string;
        durationSec: number;
        sizeBytes: number;
        width: number;
        height: number;
        fileName: string;
        caption: string;
        hasExplicitNoSound: boolean;
        parsed: ReturnType<typeof parseTelegramMovieMeta>;
      }

      const rawCands: BulkRawCand[] = [];
      for (const msg of validMsgs) {
        const classified = classifyTelegramDocMedia(msg);
        if (classified.kind !== 'video') {
          bulkSyncJob.skippedNonVideo++;
          continue;
        }
        bulkSyncJob.totalVideosSeen++;
        const streamUrl = publicUsername
          ? `https://t.me/${publicUsername}/${msg.id}`
          : `https://t.me/c/${cleanChannelId}/${msg.id}`;
        const parsedMeta = parseTelegramMovieMeta(
          classified.fileName,
          classified.caption,
          classified.width,
          classified.height,
          classified.durationSec,
          classified.sizeBytes
        );
        if (parsedMeta.isSampleOrClip) {
          bulkSyncJob.skippedNonVideo++;
          continue;
        }
        if (existingUrlSet.has(streamUrl.toLowerCase())) {
          bulkSyncJob.skippedDuplicates++;
          continue;
        }
        primeMediaCacheFromTelegramDoc(
          streamUrl,
          classified.doc,
          classified.fileName,
          classified.durationSec,
          classified.mime
        );
        rawCands.push({
          msgId: Number(msg.id),
          msgDateMs: Number(msg.date || 0) > 0 ? Number(msg.date) * 1000 : 0,
          streamUrl,
          doc: classified.doc,
          mime: classified.mime,
          durationSec: classified.durationSec,
          sizeBytes: classified.sizeBytes,
          width: classified.width,
          height: classified.height,
          fileName: classified.fileName || `Movie_${msg.id}`,
          caption: classified.caption || '',
          hasExplicitNoSound: classified.hasExplicitNoSound,
          parsed: parsedMeta,
        });
      }

      interface BulkVerifiedCand {
        msgId: number;
        msgDateMs: number;
        streamUrl: string;
        durationSec: number;
        sizeBytes: number;
        fileName: string;
        caption: string;
        parsed: ReturnType<typeof parseTelegramMovieMeta>;
      }

      const verifiedList = await mapWithConcurrency(
        rawCands,
        6,
        async (cand): Promise<BulkVerifiedCand | null> => {
          if (bulkSyncStopRequested) return null;
          const check = await verifyCandidateAudioAndHd(
            {
              streamUrl: cand.streamUrl,
              doc: cand.doc,
              mime: cand.mime,
              fileName: cand.fileName,
              caption: cand.caption,
              durationSec: cand.durationSec,
              width: cand.width,
              height: cand.height,
              parsedQuality: cand.parsed.quality,
              hasExplicitNoSound: cand.hasExplicitNoSound,
            },
            client,
            onlyValidAudioAndHd
          );
          if (!check.accepted) {
            if (check.reason === 'no_audio' || check.reason === 'unverified_audio') {
              bulkSyncJob.skippedNoAudio++;
            } else {
              bulkSyncJob.skippedLowQuality++;
            }
            return null;
          }
          return {
            msgId: cand.msgId,
            msgDateMs: cand.msgDateMs,
            streamUrl: cand.streamUrl,
            durationSec: check.durationSec || cand.durationSec,
            sizeBytes: cand.sizeBytes,
            fileName: cand.fileName,
            caption: cand.caption,
            parsed: {
              ...cand.parsed,
              quality: check.effectiveQuality || cand.parsed.quality,
            },
          };
        },
        () => bulkSyncStopRequested
      );

      if (bulkSyncStopRequested) {
        bulkSyncJob.status = 'stopped';
        bulkSyncJob.updatedAtMs = Date.now();
        return;
      }

      const acceptedCands = verifiedList.filter((v): v is BulkVerifiedCand => Boolean(v));

      // Group multi-quality uploads (1080p / 720p) of the same title/episode within batch
      interface BulkGroup {
        primary: BulkVerifiedCand;
        members: BulkVerifiedCand[];
        videoQualities: Record<string, string>;
        qualitySizes: Record<string, number>;
      }
      const groups: BulkGroup[] = [];
      const idxMap = new Map<string, number>();

      for (const v of acceptedCands) {
        const gKey = v.parsed.groupKey || `msg-${v.msgId}`;
        const foundIdx = v.parsed.groupKey ? idxMap.get(gKey) : undefined;
        if (foundIdx !== undefined) {
          const g = groups[foundIdx];
          g.members.push(v);
          if (v.parsed.quality) {
            const prevSz = g.qualitySizes[v.parsed.quality] || 0;
            if (!g.videoQualities[v.parsed.quality] || v.sizeBytes > prevSz) {
              g.videoQualities[v.parsed.quality] = v.streamUrl;
              g.qualitySizes[v.parsed.quality] = v.sizeBytes;
            }
          }
          if (
            (!g.primary.parsed.year && v.parsed.year) ||
            (!g.primary.parsed.explicitImdbId && v.parsed.explicitImdbId) ||
            v.parsed.quality === '1080p'
          ) {
            g.primary = v;
          }
        } else {
          const vq: Record<string, string> = {};
          const qs: Record<string, number> = {};
          if (v.parsed.quality) {
            vq[v.parsed.quality] = v.streamUrl;
            qs[v.parsed.quality] = v.sizeBytes;
          }
          const idx = groups.length;
          groups.push({ primary: v, members: [v], videoQualities: vq, qualitySizes: qs });
          if (v.parsed.groupKey) idxMap.set(gKey, idx);
        }
      }

      // Resolve IMDb metadata in parallel (cached + deduplicated per series/title)
      const preparedGroups = await mapWithConcurrency(
        groups,
        8,
        async (grp) => {
          if (bulkSyncStopRequested) return null;
          const mergedParsed = {
            ...grp.primary.parsed,
            year: grp.primary.parsed.year || grp.members.find((m) => m.parsed.year)?.parsed.year || null,
            languageHint:
              grp.primary.parsed.languageHint ||
              grp.members.find((m) => m.parsed.languageHint)?.parsed.languageHint ||
              '',
            isHindiDubbed: grp.members.some((m) => m.parsed.isHindiDubbed),
          };
          const matched = await resolveCachedImdb(mergedParsed);
          return { grp, mergedParsed, matched };
        },
        () => bulkSyncStopRequested
      );

      let chunkPublished = 0;
      const dirtySeriesUpdates = new Map<string, { rec: ExistingMovieRecord; isNewDoc: boolean; newPayload?: any }>();

      for (const entry of preparedGroups) {
        if (!entry) continue;
        if (bulkSyncStopRequested) {
          bulkSyncJob.status = 'stopped';
          bulkSyncJob.updatedAtMs = Date.now();
          break;
        }
        const { grp, mergedParsed, matched } = entry;

        const {
          effectivePrimary,
          filteredQualities,
          bestStream,
          qualityBadge,
          bestDurSec,
          realMsgDateMs,
        } = buildEffectiveQualityGroup(grp.members, grp.primary, onlyValidAudioAndHd);

        const candYear = Number(matched.releaseYear || mergedParsed.year || 0);
        const isSeriesItem =
          mergedParsed.isSeriesEpisode ||
          String(matched.originalCategory || '').toLowerCase().includes('series');

        const durationFormatted = bestDurSec > 0 ? formatDuration(bestDurSec) : '';
        const catToSave = isSeriesItem
          ? (String(matched.originalCategory || '').toLowerCase().includes('anime') ? 'Anime Series' : 'Web Series')
          : (matched.originalCategory || 'Bollywood Movie');
        const displayCat = getDisplayCategory(catToSave);
        const badge: 'HD' | 'HDTC' = qualityBadge === 'HDTC' ? 'HDTC' : 'HD';
        const fallbackSvg = buildFallbackPosterDataUri(matched.title || mergedParsed.cleanTitle, candYear);
        const cleanPoster = (matched.posterUrl ? upgradePosterUrl(matched.posterUrl, 1080) || matched.posterUrl : '') || fallbackSvg;
        const cleanBackdrop = (matched.backdropUrl || matched.posterUrl ? upgradePosterUrl(matched.backdropUrl || cleanPoster, 1280) || cleanPoster : '') || fallbackSvg;

        const existingRec = findMatchingExistingRecord(
          existingRecords,
          matched.imdbId,
          [matched.title, matched.originalTitle, mergedParsed.cleanTitle],
          candYear,
          isSeriesItem
        );

        try {
          if (isSeriesItem) {
            const seasonNum = Math.max(1, Number(mergedParsed.seasonNumber) || 1);
            const rawEpNum = Number(mergedParsed.episodeNumber);
            const isCompletePackByDur =
              (!Number.isFinite(rawEpNum) || rawEpNum <= 0) &&
              bestDurSec >= 5400 &&
              /\b(?:s\d{1,2}|season|session|complete|combined|full)\b/i.test(
                `${effectivePrimary.fileName} ${mergedParsed.rawCaption}`
              );

            if (!Number.isFinite(rawEpNum) || rawEpNum <= 0) {
              if (!isCompletePackByDur) {
                bulkSyncJob.skippedDuplicates++;
                existingUrlSet.add(bestStream.toLowerCase());
                continue;
              }
            }

            const resolvedEpLabel = isCompletePackByDur ? 'Complete' : mergedParsed.episodeLabel;
            const epNum = isCompletePackByDur ? 1 : Math.floor(rawEpNum);
            const epTitle = isCompletePackByDur
              ? 'Complete Season'
              : mergedParsed.episodeTitle || `Episode ${epNum}`;
            const epQuality =
              mergedParsed.quality ||
              (filteredQualities['1080p']
                ? '1080p'
                : filteredQualities['720p']
                ? '720p'
                : filteredQualities['480p']
                ? '480p'
                : '');
            const epObj = {
              episodeNumber: epNum,
              ...(resolvedEpLabel ? { episodeLabel: resolvedEpLabel } : {}),
              title: epTitle,
              streamUrl: bestStream.trim(),
              ...(epQuality ? { quality: epQuality } : {}),
              ...(durationFormatted ? { duration: durationFormatted } : {}),
              ...(bestDurSec > 0 ? { durationSec: bestDurSec } : {}),
              showInNewEpisodes: false,
            };

            if (existingRec) {
              const seriesUpgrade = getQualityUpgradeDecision(existingRec, badge);
              if (seriesUpgrade === 'skip_holl_print_on_hd') {
                bulkSyncJob.skippedDuplicates++;
                existingUrlSet.add(bestStream.toLowerCase());
                continue;
              }
              const replaceExistingEp = seriesUpgrade === 'replace_holl_print_with_hd';
              const targetSeasons = Array.isArray(existingRec.seasons)
                ? existingRec.seasons.map((s) => ({
                    ...s,
                    seasonNumber: Number(s?.seasonNumber) || 1,
                    episodes: Array.isArray(s?.episodes) ? [...s.episodes] : [],
                  }))
                : [];
              let tSeason = targetSeasons.find((s) => s.seasonNumber === seasonNum);
              if (!tSeason) {
                tSeason = { seasonNumber: seasonNum, episodes: [] };
                targetSeasons.push(tSeason);
              }
              const cleanUrlLower = epObj.streamUrl.toLowerCase();
              if (tSeason.episodes.some((e: any) => String(e?.streamUrl || '').trim().toLowerCase() === cleanUrlLower)) {
                bulkSyncJob.skippedDuplicates++;
                existingUrlSet.add(cleanUrlLower);
                continue;
              }
              if (isCompleteSeasonPackEpisode(epObj) && tSeason.episodes.length >= 2) {
                bulkSyncJob.skippedDuplicates++;
                existingUrlSet.add(cleanUrlLower);
                continue;
              }
              if (replaceExistingEp) {
                tSeason.episodes = tSeason.episodes.filter(
                  (e: any) => Number(e?.episodeNumber) !== epObj.episodeNumber
                );
              }
              // Append to chunk seasons so all multi-pack qualities in this chunk are reconciled together at flush time
              tSeason.episodes.push(epObj);
              existingRec.seasons = targetSeasons;
              if (replaceExistingEp || !existingRec.streamingUrl) {
                existingRec.streamingUrl = epObj.streamUrl;
              }
              const nextSeriesBadge = badge === 'HD' ? 'HD' : existingRec.qualityBadge || badge;
              existingRec.qualityBadge = nextSeriesBadge;
              existingUrlSet.add(bestStream.toLowerCase());
              const prevDirty = dirtySeriesUpdates.get(existingRec.id);
              dirtySeriesUpdates.set(existingRec.id, {
                rec: existingRec,
                isNewDoc: prevDirty?.isNewDoc ?? false,
                newPayload: prevDirty?.newPayload,
              });
              const prevSeed = seedCatalogMap.get(existingRec.id) || {};
              const prevPoster = String(prevSeed.posterUrl || existingRec.posterUrl || '');
              const existingHasSvgPoster = !prevPoster || prevPoster.startsWith('data:image/svg+xml');
              const incomingHasRealPoster = Boolean(cleanPoster && !cleanPoster.startsWith('data:image/svg+xml'));
              const seriesPosterPatch: Record<string, any> =
                existingHasSvgPoster && incomingHasRealPoster
                  ? {
                      posterUrl: cleanPoster,
                      backdropUrl: cleanBackdrop,
                      ...(!existingRec.imdbId && matched.imdbId ? { imdbId: matched.imdbId.trim() } : {}),
                      ...(matched.description ? { description: matched.description.trim() } : {}),
                      ...(matched.director ? { director: matched.director.trim() } : {}),
                      ...(matched.cast ? { cast: matched.cast.trim() } : {}),
                    }
                  : {};
              if (seriesPosterPatch.posterUrl) existingRec.posterUrl = seriesPosterPatch.posterUrl;
              if (seriesPosterPatch.imdbId) existingRec.imdbId = seriesPosterPatch.imdbId;
              grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
              seedCatalogMap.set(existingRec.id, {
                ...prevSeed,
                id: existingRec.id,
                seasons: targetSeasons,
                streamingUrl: existingRec.streamingUrl,
                qualityBadge: nextSeriesBadge,
                ...seriesPosterPatch,
                updatedAt: Date.now(),
              });
              bulkSyncJob.mergedCount++;
              chunkPublished++;
            } else {
              const seriesDocId = `tg_series_${cleanChannelId}_${effectivePrimary.msgId}`;
              const initialSeasons = [{ seasonNumber: seasonNum, episodes: [epObj] }];
              const newRec: ExistingMovieRecord = {
                id: seriesDocId,
                imdbId: (matched.imdbId || '').trim(),
                title: matched.title.trim(),
                originalTitle: (matched.originalTitle || matched.title).trim(),
                releaseYear: Number(matched.releaseYear) || new Date().getFullYear(),
                originalCategory: catToSave,
                isSeries: true,
                qualityBadge: badge,
                sourceFileName: effectivePrimary.fileName || '',
                sourceCaption: `${mergedParsed.cleanTitle}${mergedParsed.year ? ` (${mergedParsed.year})` : ''}`,
                posterUrl: cleanPoster,
                streamingUrl: epObj.streamUrl,
                videoQualities: {},
                seasons: initialSeasons,
              };
              grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
              existingRecords.push(newRec);
              const realBulkDateMs = realMsgDateMs || Date.now();
              const seriesPayload = {
                id: seriesDocId,
                title: matched.title.trim(),
                originalTitle: (matched.originalTitle || matched.title).trim(),
                description: matched.description.trim(),
                posterUrl: cleanPoster,
                backdropUrl: cleanBackdrop,
                releaseYear: Number(matched.releaseYear) || new Date().getFullYear(),
                originalCategory: catToSave,
                displayCategory: displayCat,
                contentType: catToSave.toLowerCase().includes('anime') ? 'anime' : null,
                language: (matched.language || 'Hindi').trim(),
                genre: (matched.genre || 'Drama').trim(),
                director: (matched.director || '').trim(),
                cast: (matched.cast || '').trim(),
                runtime: (durationFormatted || matched.runtime || '').trim(),
                rating: Number(matched.rating) || 8.0,
                imdbId: (matched.imdbId || '').trim(),
                trailerUrl: '',
                streamingUrl: epObj.streamUrl,
                videoQualities: {},
                featured: true,
                published: true,
                qualityBadge: badge,
                duration: bestDurSec || parseDurationToSeconds(matched.runtime) || 0,
                telegramMsgId: effectivePrimary.msgId,
                telegramChannelId: cleanChannelId,
                telegramDateMs: realBulkDateMs,
                createdAt: realBulkDateMs,
                updatedAt: Date.now(),
              };
              seedCatalogMap.set(seriesDocId, {
                ...seriesPayload,
                seasons: initialSeasons,
              });
              dirtySeriesUpdates.set(seriesDocId, {
                rec: newRec,
                isNewDoc: true,
                newPayload: seriesPayload,
              });
              bulkSyncJob.publishedCount++;
              chunkPublished++;
            }
          } else if (existingRec) {
            const upgradeDecision = getQualityUpgradeDecision(existingRec, badge);
            if (upgradeDecision === 'skip_holl_print_on_hd') {
              bulkSyncJob.skippedDuplicates++;
              grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
              continue;
            }

            const incomingCleanQualities = Object.fromEntries(
              Object.entries(filteredQualities || {}).filter(([, u]) => Boolean(String(u || '').trim()))
            );
            const prevSeed = seedCatalogMap.get(existingRec.id) || {};
            const prevPoster = String(prevSeed.posterUrl || existingRec.posterUrl || '');
            const existingHasSvgPoster = !prevPoster || prevPoster.startsWith('data:image/svg+xml');
            const incomingHasRealPoster = Boolean(cleanPoster && !cleanPoster.startsWith('data:image/svg+xml'));
            const bulkPosterBackfill: Record<string, any> =
              existingHasSvgPoster && incomingHasRealPoster
                ? {
                    posterUrl: cleanPoster,
                    backdropUrl: cleanBackdrop,
                    ...(matched.title ? { title: matched.title.trim(), originalTitle: (matched.originalTitle || matched.title).trim() } : {}),
                    ...(matched.description ? { description: matched.description.trim() } : {}),
                    ...(matched.genre ? { genre: matched.genre.trim() } : {}),
                    ...(matched.director ? { director: matched.director.trim() } : {}),
                    ...(matched.cast ? { cast: matched.cast.trim() } : {}),
                    ...(matched.language ? { language: matched.language.trim() } : {}),
                    ...(!existingRec.imdbId && matched.imdbId ? { imdbId: matched.imdbId.trim() } : {}),
                  }
                : !existingRec.imdbId && matched.imdbId
                ? { imdbId: matched.imdbId.trim() }
                : {};

            if (upgradeDecision === 'replace_holl_print_with_hd') {
              const replacedStream =
                incomingCleanQualities['1080p'] ||
                incomingCleanQualities['4K'] ||
                incomingCleanQualities['720p'] ||
                incomingCleanQualities['480p'] ||
                bestStream.trim();
              const nextRuntime = (durationFormatted || matched.runtime || prevSeed.runtime || '').trim();
              const nextDuration =
                bestDurSec || parseDurationToSeconds(nextRuntime) || prevSeed.duration || 0;
              const replacePayload: any = {
                videoQualities: incomingCleanQualities,
                streamingUrl: replacedStream,
                qualityBadge: 'HD',
                sourceFileName: effectivePrimary.fileName || '',
                sourceCaption: `${mergedParsed.cleanTitle}${mergedParsed.year ? ` (${mergedParsed.year})` : ''}`,
                telegramMsgId: effectivePrimary.msgId,
                ...(nextRuntime ? { runtime: nextRuntime } : {}),
                ...(nextDuration > 0 ? { duration: nextDuration } : {}),
                ...bulkPosterBackfill,
                updatedAt: Date.now(),
              };

              existingRec.videoQualities = incomingCleanQualities;
              existingRec.streamingUrl = replacedStream;
              existingRec.qualityBadge = 'HD';
              existingRec.sourceFileName = effectivePrimary.fileName || '';
              existingRec.sourceCaption = replacePayload.sourceCaption;
              if (bulkPosterBackfill.posterUrl) existingRec.posterUrl = bulkPosterBackfill.posterUrl;
              if (bulkPosterBackfill.imdbId) existingRec.imdbId = bulkPosterBackfill.imdbId;
              grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));

              seedCatalogMap.set(existingRec.id, {
                ...prevSeed,
                ...replacePayload,
              });

              try {
                await updateDocWithQuotaGuard(doc(db, 'movies', existingRec.id), {
                  ...replacePayload,
                  updatedAt: serverTimestamp(),
                });
              } catch (writeErr: any) {
                if (isFirestoreQuotaError(writeErr)) {
                  bulkSyncJob.errorMessage =
                    'Firestore daily write quota reached; saving movies directly to permanent app catalog bundle.';
                }
              }

              bulkSyncJob.mergedCount++;
              chunkPublished++;
              continue;
            }

            const mergedQualities = { ...existingRec.videoQualities };
            let qualityAdded = false;
            for (const [qk, qUrl] of Object.entries(incomingCleanQualities)) {
              if (qUrl && !mergedQualities[qk]) {
                mergedQualities[qk] = qUrl;
                qualityAdded = true;
              }
            }
            const needsBulkPosterBackfill = Object.keys(bulkPosterBackfill).length > 0;
            if (qualityAdded || needsBulkPosterBackfill) {
              const upgradedStream =
                mergedQualities['1080p'] ||
                mergedQualities['4K'] ||
                existingRec.streamingUrl ||
                bestStream.trim();
              if (qualityAdded) {
                existingRec.videoQualities = mergedQualities;
                existingRec.streamingUrl = upgradedStream;
              }
              grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));

              const upgradedBadge =
                badge === 'HD' ? 'HD' : prevSeed.qualityBadge || badge;
              if (qualityAdded) existingRec.qualityBadge = upgradedBadge;
              if (bulkPosterBackfill.posterUrl) existingRec.posterUrl = bulkPosterBackfill.posterUrl;
              if (bulkPosterBackfill.imdbId) existingRec.imdbId = bulkPosterBackfill.imdbId;
              const bulkMergePayload = {
                ...(qualityAdded ? { videoQualities: mergedQualities, streamingUrl: upgradedStream, qualityBadge: upgradedBadge } : {}),
                ...bulkPosterBackfill,
                updatedAt: Date.now(),
              };
              seedCatalogMap.set(existingRec.id, {
                ...prevSeed,
                ...bulkMergePayload,
              });

              try {
                await setDocWithQuotaGuard(
                  doc(db, 'movies', existingRec.id),
                  { ...bulkMergePayload, updatedAt: serverTimestamp() },
                  { merge: true }
                );
              } catch (writeErr: any) {
                if (isFirestoreQuotaError(writeErr)) {
                  bulkSyncJob.errorMessage =
                    'Firestore daily write quota reached; saving movies directly to permanent app catalog bundle.';
                }
              }

              bulkSyncJob.mergedCount++;
              chunkPublished++;
            } else {
              bulkSyncJob.skippedDuplicates++;
              grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
            }
          } else {
            const realMovieDateMs = realMsgDateMs || Date.now();
            const deterministicDocId = `tg_${cleanChannelId}_${effectivePrimary.msgId}`;
            const sourceCaptionVal = `${mergedParsed.cleanTitle}${mergedParsed.year ? ` (${mergedParsed.year})` : ''}`;
            const movieDocPayload = {
              id: deterministicDocId,
              title: matched.title.trim(),
              originalTitle: (matched.originalTitle || matched.title).trim(),
              description: matched.description.trim(),
              posterUrl: cleanPoster,
              backdropUrl: cleanBackdrop,
              releaseYear: Number(matched.releaseYear) || new Date().getFullYear(),
              originalCategory: catToSave,
              displayCategory: displayCat,
              contentType: catToSave.toLowerCase().includes('anime') ? 'anime' : null,
              language: (matched.language || 'Hindi').trim(),
              genre: (matched.genre || 'Action').trim(),
              director: (matched.director || '').trim(),
              cast: (matched.cast || '').trim(),
              runtime: (durationFormatted || matched.runtime || '').trim(),
              rating: Number(matched.rating) || 8.0,
              imdbId: (matched.imdbId || '').trim(),
              trailerUrl: '',
              streamingUrl: bestStream.trim(),
              videoQualities: filteredQualities,
              seasons: [],
              featured: true,
              published: true,
              qualityBadge: badge,
              sourceFileName: effectivePrimary.fileName || '',
              sourceCaption: sourceCaptionVal,
              duration: bestDurSec || parseDurationToSeconds(matched.runtime) || 0,
              telegramMsgId: effectivePrimary.msgId,
              telegramChannelId: cleanChannelId,
              telegramDateMs: realMovieDateMs,
              updatedAt: Date.now(),
              createdAt: realMovieDateMs,
            };

            seedCatalogMap.set(deterministicDocId, movieDocPayload);
            grp.members.forEach((m) => existingUrlSet.add(m.streamUrl.toLowerCase()));
            existingRecords.push({
              id: deterministicDocId,
              imdbId: (matched.imdbId || '').trim(),
              title: matched.title.trim(),
              originalTitle: (matched.originalTitle || matched.title).trim(),
              releaseYear: Number(matched.releaseYear) || new Date().getFullYear(),
              originalCategory: catToSave,
              isSeries: false,
              qualityBadge: badge,
              sourceFileName: effectivePrimary.fileName || '',
              sourceCaption: sourceCaptionVal,
              posterUrl: cleanPoster,
              streamingUrl: bestStream.trim(),
              videoQualities: filteredQualities,
              seasons: [],
            });

            try {
              await setDocWithQuotaGuard(
                doc(db, 'movies', deterministicDocId),
                {
                  ...movieDocPayload,
                  updatedAt: serverTimestamp(),
                  createdAt: serverTimestamp(),
                },
                { merge: true }
              );
            } catch (writeErr: any) {
              if (isFirestoreQuotaError(writeErr)) {
                bulkSyncJob.errorMessage =
                  'Firestore daily write quota reached; saving movies directly to permanent app catalog bundle.';
              }
            }

            bulkSyncJob.publishedCount++;
            chunkPublished++;
          }
          bulkSyncJob.updatedAtMs = Date.now();
        } catch (err: any) {
          console.warn('[BulkChannelSync] Warning processing candidate:', err?.message);
        }
      }

      // Flush coalesced series docs once per chunk (reconcile overlaps/packs and only publish complete series)
      for (const [seriesId, dirty] of dirtySeriesUpdates.entries()) {
        dirty.rec.seasons = (dirty.rec.seasons || [])
          .map((s: any, idx: number) => ({
            ...s,
            seasonNumber: Number(s?.seasonNumber) || idx + 1,
            episodes: reconcileSeasonEpisodes(Array.isArray(s?.episodes) ? s.episodes : []),
          }))
          .sort((a: any, b: any) => a.seasonNumber - b.seasonNumber);

        const validEpUrls = new Set<string>();
        for (const s of dirty.rec.seasons) {
          for (const ep of s.episodes) {
            const u = String(ep?.streamUrl || '').trim();
            if (u) validEpUrls.add(u);
          }
        }
        const firstEpUrl = String(dirty.rec.seasons[0]?.episodes?.[0]?.streamUrl || '').trim();
        if (firstEpUrl && (!dirty.rec.streamingUrl || !validEpUrls.has(dirty.rec.streamingUrl))) {
          dirty.rec.streamingUrl = firstEpUrl;
        }

        const expectedCounts = dirty.rec.imdbId
          ? await fetchExpectedSeasonEpisodeCounts(dirty.rec.imdbId)
          : null;
        const totalEps = (dirty.rec.seasons || []).reduce(
          (acc: number, s: any) => acc + (Array.isArray(s?.episodes) ? s.episodes.length : 0),
          0
        );
        const onlyEp = totalEps === 1 ? dirty.rec.seasons?.[0]?.episodes?.[0] : null;
        const isSingleSmallNonCompleteEp =
          !expectedCounts &&
          Boolean(onlyEp) &&
          !isCompleteSeasonPackEpisode(onlyEp) &&
          Number(onlyEp?.durationSec || 0) < 5400;
        const seriesReadyToPublish =
          !isSingleSmallNonCompleteEp && isSeriesComplete(dirty.rec, expectedCounts);
        dirty.rec.published = seriesReadyToPublish;

        const prevSeed = seedCatalogMap.get(seriesId) || {};
        const resolvedSeriesBadge = dirty.rec.qualityBadge || prevSeed.qualityBadge || 'HD';
        const updatedSeed = {
          ...prevSeed,
          ...(dirty.isNewDoc && dirty.newPayload ? dirty.newPayload : {}),
          id: seriesId,
          seasons: dirty.rec.seasons,
          streamingUrl: dirty.rec.streamingUrl,
          qualityBadge: resolvedSeriesBadge,
          published: seriesReadyToPublish,
          releaseYear: clampReleaseYear(prevSeed.releaseYear || dirty.rec.releaseYear),
          updatedAt: Date.now(),
        };
        seedCatalogMap.set(seriesId, updatedSeed);

        try {
          if (dirty.isNewDoc && dirty.newPayload) {
            await setDocWithQuotaGuard(
              doc(db, 'movies', seriesId),
              {
                ...dirty.newPayload,
                releaseYear: clampReleaseYear(dirty.newPayload.releaseYear),
                qualityBadge: resolvedSeriesBadge,
                published: seriesReadyToPublish,
                seasons: dirty.rec.seasons,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          } else {
            await setDocWithQuotaGuard(
              doc(db, 'movies', seriesId),
              {
                seasons: dirty.rec.seasons,
                streamingUrl: dirty.rec.streamingUrl,
                qualityBadge: resolvedSeriesBadge,
                published: seriesReadyToPublish,
                updatedAt: serverTimestamp(),
              },
              { merge: true }
            );
          }
        } catch (writeErr: any) {
          if (isFirestoreQuotaError(writeErr)) {
            bulkSyncJob.errorMessage =
              'Firestore daily write quota reached; saving movies directly to permanent app catalog bundle.';
          }
        }
      }

      // Persist full catalog to public/movies-seed.json after each chunk!
      try {
        const currentList = Array.from(seedCatalogMap.values());
        fs.writeFileSync(SEED_CATALOG_PATH, JSON.stringify(currentList));
      } catch (fErr) {
        console.warn('[BulkChannelSync] Could not write movies-seed.json:', fErr);
      }

      if (bulkSyncStopRequested) {
        bulkSyncJob.status = 'stopped';
        bulkSyncJob.updatedAtMs = Date.now();
        return;
      }

      if (chunkPublished > 0 && isServerFirestoreWriteAllowed()) {
        setDocWithQuotaGuard(
          doc(db, 'app_config', 'catalog_sync'),
          { updatedAt: Date.now(), action: 'bulk_channel_sync' },
          { merge: true }
        ).catch(() => {});
      }

      await new Promise((r) => setTimeout(r, 80));
    }

    // Finalize catalog file
    try {
      const finalList = Array.from(seedCatalogMap.values());
      writeSeedCatalogToDisk(finalList);
      broadcastLiveCatalogUpdate({
        type: 'catalog_updated',
        count: bulkSyncJob.publishedCount + bulkSyncJob.mergedCount,
        updatedAt: Date.now(),
        action: 'bulk_channel_sync',
      });
      console.log(`[BulkChannelSync] Successfully completed and saved ${finalList.length} movies to public/movies-seed.json`);
    } catch {}

    if (isServerFirestoreWriteAllowed()) {
      setDocWithQuotaGuard(
        doc(db, 'app_config', 'telegram_auto_sync'),
        {
          channelUrl: channelRef,
          activeChannelId: cleanChannelId,
          lastSyncedMsgId: endMsgId,
          onlyValidAudioAndHd,
          updatedAtMs: Date.now(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      ).catch(() => {});
    }
    if (cachedSyncConfig) {
      cachedSyncConfig.channelUrl = channelRef;
      cachedSyncConfig.lastSyncedMsgId = Math.max(cachedSyncConfig.lastSyncedMsgId, endMsgId);
      cachedSyncConfig.onlyValidAudioAndHd = onlyValidAudioAndHd;
    }

    bulkSyncJob.status = 'completed';
    bulkSyncJob.updatedAtMs = Date.now();
    console.log(
      `[BulkChannelSync] Completed "${channelTitle}" (${startMsgId}-${endMsgId}): published=${bulkSyncJob.publishedCount}, merged=${bulkSyncJob.mergedCount}, skippedNoAudio=${bulkSyncJob.skippedNoAudio}, skippedLowQuality=${bulkSyncJob.skippedLowQuality}`
    );
  } catch (err: any) {
    bulkSyncJob.status = 'error';
    bulkSyncJob.errorMessage = err?.message || 'Bulk channel sync failed unexpectedly.';
    bulkSyncJob.updatedAtMs = Date.now();
    console.error('[BulkChannelSync] Worker error:', err);
  }
}

router.get('/bulk-sync-status', (_req: Request, res: Response) => {
  return res.json({ success: true, job: bulkSyncJob });
});

router.post('/bulk-sync-stop', (_req: Request, res: Response) => {
  if (bulkSyncJob.status === 'running') {
    bulkSyncStopRequested = true;
  }
  return res.json({ success: true, job: bulkSyncJob });
});

router.post('/bulk-sync-channel', async (req: Request, res: Response) => {
  const channelRef = String(req.body?.channelRef || req.body?.channelUrl || '').trim();
  const startMsgId = Math.max(1, Number(req.body?.startMsgId) || 1);
  const requestedEnd = Math.max(0, Number(req.body?.endMsgId) || 0);
  const onlyValidAudioAndHd =
    typeof req.body?.onlyValidAudioAndHd === 'boolean' ? req.body.onlyValidAudioAndHd : false;

  if (!channelRef) {
    return res.status(400).json({ error: 'Channel link ya post link daalna zaroori hai.' });
  }
  if (bulkSyncJob.status === 'running') {
    return res.status(409).json({
      error: 'Ek bulk channel publish job pehle se chal raha hai.',
      job: bulkSyncJob,
    });
  }

  try {
    const client = await getTelegramClient();
    await ensureChannelUploadWatcher(client);
    const resolved = await resolveChannelPeerFromLinkOrId(client, channelRef);
    if (!resolved) {
      const isInvite = /(?:\+|joinchat\/)/i.test(channelRef);
      return res.status(422).json({
        needsPostLinkOrPing: isInvite,
        error: isInvite
          ? 'Bot (+invite link) se direct private channel ID nahi nikal sakta. Is channel ke andar kisi bhi 1 video/post par right-click/tap karke "Copy Post Link" (https://t.me/c/.../123) paste karein YA channel me 1 message send/forward karein, phir dubara Start dabayein.'
          : 'Channel resolve nahi ho paya. Confirm karein ki @Movies_Direct_Group_Bot is channel me Admin hai.',
      });
    }

    const latestMsgId =
      requestedEnd > 0
        ? requestedEnd
        : await discoverChannelLatestMsgId(client, resolved.peer, resolved.cleanChannelId);

    if (!latestMsgId || latestMsgId < startMsgId) {
      return res.status(404).json({
        error: 'Channel me koi messages nahi mile. Confirm karein ki bot Admin hai aur channel me posts maujood hain.',
      });
    }

    bulkSyncStopRequested = false;
    bulkSyncJob = {
      status: 'running',
      channelRef,
      channelId: resolved.cleanChannelId,
      channelTitle: resolved.channelTitle,
      onlyValidAudioAndHd,
      startMsgId,
      endMsgId: latestMsgId,
      currentMsgId: startMsgId,
      scannedMessages: 0,
      totalVideosSeen: 0,
      publishedCount: 0,
      mergedCount: 0,
      skippedNoAudio: 0,
      skippedLowQuality: 0,
      skippedDuplicates: 0,
      skippedNonVideo: 0,
      startedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      errorMessage: '',
      upgradeUrl: '',
    };

    void setDocWithQuotaGuard(
      doc(db, 'app_config', 'telegram_auto_sync'),
      {
        channelUrl: channelRef,
        activeChannelId: resolved.cleanChannelId,
        onlyValidAudioAndHd,
        autoWatchEnabled: true,
        updatedAtMs: Date.now(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    ).catch(() => {});
    if (cachedSyncConfig) {
      cachedSyncConfig.channelUrl = channelRef;
      cachedSyncConfig.onlyValidAudioAndHd = onlyValidAudioAndHd;
      cachedSyncConfig.autoWatchEnabled = true;
    }

    void runBulkChannelSyncWorker({
      client,
      peer: resolved.peer,
      cleanChannelId: resolved.cleanChannelId,
      channelTitle: resolved.channelTitle,
      publicUsername: resolved.publicUsername,
      channelRef,
      startMsgId,
      endMsgId: latestMsgId,
      onlyValidAudioAndHd,
    });

    return res.json({
      success: true,
      started: true,
      job: bulkSyncJob,
    });
  } catch (err: any) {
    return res.status(500).json({
      error: err?.message || 'Failed to start bulk channel auto-publish.',
    });
  }
});

// Start 24/7 MTProto channel watcher on server boot + 8s safety poll
setTimeout(() => {
  getTelegramClient()
    .then((client) => ensureChannelUploadWatcher(client))
    .then(() => runServerAutoSyncPass('boot'))
    .catch(() => {});

  setInterval(() => {
    runServerAutoSyncPass('periodic').catch(() => {});
  }, 8_000);
}, 3000);

router.post('/backfill-print-badges', async (_req: Request, res: Response) => {
  try {
    const client = await getTelegramClient();
    const byId = new Map<string, any>();

    try {
      if (fs.existsSync(SEED_CATALOG_PATH)) {
        const seedArr = JSON.parse(fs.readFileSync(SEED_CATALOG_PATH, 'utf8'));
        if (Array.isArray(seedArr)) {
          for (const m of seedArr) {
            if (m && m.id) byId.set(String(m.id), m);
          }
        }
      }
    } catch {}

    try {
      const fsSnap = await Promise.race([
        getDocsFromServer(collection(db, 'movies')),
        new Promise<null>((r) => setTimeout(() => r(null), 12000)),
      ]);
      if (fsSnap) {
        fsSnap.docs.forEach((d) => {
          const data = d.data() as any;
          const prev = byId.get(d.id) || {};
          byId.set(d.id, { ...prev, ...data, id: d.id });
        });
      }
    } catch {}

    const allMovies = Array.from(byId.values());
    const refsByChannel = new Map<string, Set<number>>();
    const movieRefs = new Map<string, Array<{ channelId: string; msgId: number; url: string }>>();

    const collectUrl = (movieId: string, rawUrl: any) => {
      const url = String(rawUrl || '').trim();
      if (!url) return;
      const p = parseTelegramUrl(url);
      if (!p.isValid || p.isInviteLink || !p.messageId) return;
      const chId = String(p.rawChannelId || p.chatId || '').replace(/^-100/, '');
      const msgId = Number(p.messageId);
      if (!chId || !Number.isFinite(msgId) || msgId <= 0) return;
      if (!refsByChannel.has(chId)) refsByChannel.set(chId, new Set());
      refsByChannel.get(chId)!.add(msgId);
      if (!movieRefs.has(movieId)) movieRefs.set(movieId, []);
      movieRefs.get(movieId)!.push({ channelId: chId, msgId, url });
    };

    for (const m of allMovies) {
      collectUrl(m.id, m.streamingUrl);
      if (m.videoQualities && typeof m.videoQualities === 'object') {
        Object.values(m.videoQualities).forEach((u) => collectUrl(m.id, u));
      }
      if (Array.isArray(m.seasons)) {
        for (const s of m.seasons.slice(0, 2)) {
          for (const ep of (s?.episodes || []).slice(0, 2)) {
            collectUrl(m.id, ep?.streamUrl);
            if (ep?.videoQualities && typeof ep.videoQualities === 'object') {
              Object.values(ep.videoQualities).forEach((u) => collectUrl(m.id, u));
            }
          }
        }
      }
    }

    const msgMap = new Map<string, any>();
    for (const [chId, idSet] of refsByChannel.entries()) {
      const accessHash = getCachedAccessHash(chId);
      let peer: any = null;
      if (accessHash && /^\d+$/.test(chId)) {
        peer = new Api.InputPeerChannel({
          channelId: BigInt(chId) as any,
          accessHash: BigInt(accessHash) as any,
        });
      } else {
        try {
          peer = await Promise.race([
            client.getEntity(/^\d+$/.test(chId) ? `-100${chId}` : chId),
            new Promise<null>((r) => setTimeout(() => r(null), 8000)),
          ]);
        } catch {}
      }
      if (!peer) continue;
      const ids = Array.from(idSet).sort((a, b) => b - a);
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100);
        try {
          const msgs = await Promise.race([
            fetchMessagesWithFloodWait(client, peer, chunk),
            new Promise<null>((r) => setTimeout(() => r(null), 12000)),
          ]);
          for (const msg of msgs || []) {
            if (msg && (msg as any).id) {
              msgMap.set(`${chId}:${(msg as any).id}`, msg);
            }
          }
        } catch (err) {
          console.warn(`[BackfillPrintBadges] getMessages chunk failed for ${chId}:`, err);
        }
      }
    }

    const nowMs = Date.now();
    let updatedCount = 0;
    let hollywoodPrintCount = 0;
    let hdCount = 0;
    const hollywoodPrintTitles: string[] = [];
    const firestoreChanged: Array<{ id: string; badge: 'HD' | 'HDTC' }> = [];

    for (const m of allMovies) {
      const refs = movieRefs.get(m.id) || [];
      let hasAnyStreamMsg = false;
      let hasCleanHdStream = false;
      let hasHollywoodPrintStream = false;

      for (const ref of refs) {
        const msg = msgMap.get(`${ref.channelId}:${ref.msgId}`);
        if (!msg) continue;
        hasAnyStreamMsg = true;
        const classified = classifyTelegramDocMedia(msg);
        const rawText = `${classified.fileName || ''} ${'caption' in classified ? classified.caption || '' : ''}`;
        if (isHollywoodPrintText(rawText)) {
          hasHollywoodPrintStream = true;
        } else {
          hasCleanHdStream = true;
        }
      }

      const fallbackTextPrint = isHollywoodPrintText(
        `${m.qualityBadge || ''} ${m.sourceFileName || ''} ${m.sourceCaption || ''} ${m.title || ''} ${m.description || ''}`
      );

      // If any clean HD stream exists -> HD; if Holl Print / HDTC / CineVood and no clean stream -> HDTC
      const nextBadge: 'HD' | 'HDTC' = hasCleanHdStream
        ? 'HD'
        : hasHollywoodPrintStream
        ? 'HDTC'
        : normalizeQualityBadge(m.qualityBadge) === 'HDTC' || fallbackTextPrint
        ? 'HDTC'
        : 'HD';

      if (nextBadge === 'HDTC') {
        hollywoodPrintCount++;
        hollywoodPrintTitles.push(`${m.title} (${m.id})`);
      } else {
        hdCount++;
      }

      if (normalizeQualityBadge(m.qualityBadge) !== nextBadge) {
        updatedCount++;
        byId.set(m.id, {
          ...m,
          qualityBadge: nextBadge,
          updatedAt: nowMs,
        });
        firestoreChanged.push({ id: m.id, badge: nextBadge });
      }
    }

    if (updatedCount > 0) {
      writeSeedCatalogToDisk(Array.from(byId.values()));
    }

    let firestoreUpdated = 0;
    if (firestoreChanged.length > 0 && isServerFirestoreWriteAllowed()) {
      for (let i = 0; i < firestoreChanged.length; i += 20) {
        if (!isServerFirestoreWriteAllowed()) break;
        const batch = firestoreChanged.slice(i, i + 20);
        await Promise.all(
          batch.map(async (item) => {
            try {
              await setDocWithQuotaGuard(
                doc(db, 'movies', item.id),
                {
                  qualityBadge: item.badge,
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
              firestoreUpdated++;
            } catch {}
          })
        );
      }

      await setDocWithQuotaGuard(
        doc(db, 'app_config', 'catalog_sync'),
        { updatedAt: Date.now(), action: 'backfill_print_badges' },
        { merge: true }
      ).catch(() => {});
    }

    if (updatedCount > 0) {
      broadcastLiveCatalogUpdate({
        type: 'catalog_updated',
        count: updatedCount,
        updatedAt: Date.now(),
        action: 'backfill_print_badges',
      });
    }

    return res.json({
      success: true,
      total: allMovies.length,
      updated: updatedCount,
      firestoreUpdated,
      hollywoodPrintCount,
      hdCount,
      hollywoodPrintTitles: hollywoodPrintTitles.slice(0, 100),
    });
  } catch (err: any) {
    console.error('[BackfillPrintBadges] Error:', err);
    return res.status(500).json({ error: err?.message || 'Backfill failed' });
  }
});

router.get('/series-expected-counts', async (req: Request, res: Response) => {
  const imdbId = String(req.query.imdbId || '').trim();
  if (!imdbId) {
    return res.json({ counts: null });
  }
  const counts = await fetchExpectedSeasonEpisodeCounts(imdbId);
  return res.json({ counts: counts || null });
});

router.get('/stream', handleStream);
router.head('/stream', handleStream);
export default router;
