import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase.ts';

const downloadCastRouter = Router();

// In-memory cache for latest GitHub release APK
let cachedApkInfo = {
  url: 'https://github.com/Sivobob/-Movie-Portal-Hub/releases/download/v3.5.2/Movie-Portal-v3.5.2.apk',
  version: '3.5.2',
  fileName: 'Movie-Portal-v3.5.2.apk',
  lastChecked: 0,
};

async function fetchLatestGitHubApk(): Promise<{ url: string; version: string; fileName: string }> {
  const now = Date.now();
  // Cache for 60 seconds to avoid hitting rate limits while keeping new pushes fresh
  if (now - cachedApkInfo.lastChecked < 60000 && cachedApkInfo.url) {
    return cachedApkInfo;
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'MoviePortal-App/3.5',
      'Accept': 'application/vnd.github.v3+json',
    };
    const token = (process.env.GITHUB_TOKEN || '').trim();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch('https://api.github.com/repos/Sivobob/-Movie-Portal-Hub/releases/latest', {
      headers,
    });

    if (response.ok) {
      const data: any = await response.json();
      if (data && Array.isArray(data.assets)) {
        // Look for universal 'Movie-Portal.apk', or highest versioned APK asset
        let preferred = data.assets.find((a: any) => 
          a.name === 'Movie-Portal.apk' || a.name === 'Movie-Portal-latest.apk'
        );

        if (!preferred) {
          const apkAssets = data.assets.filter((a: any) => typeof a.name === 'string' && a.name.endsWith('.apk'));
          // Sort numerically descending so v3.5.2 is chosen before v3.5.0
          apkAssets.sort((a: any, b: any) => b.name.localeCompare(a.name, undefined, { numeric: true }));
          if (apkAssets.length > 0) {
            preferred = apkAssets[0];
          }
        }

        if (preferred && preferred.browser_download_url) {
          const rawTag = (data.tag_name || '3.5.2').replace(/^v/, '');
          cachedApkInfo = {
            url: preferred.browser_download_url,
            version: rawTag,
            fileName: preferred.name || `Movie-Portal-v${rawTag}.apk`,
            lastChecked: now,
          };
          console.log(`[GitHub Releases] Discovered latest APK: ${cachedApkInfo.fileName} (${cachedApkInfo.url})`);
          return cachedApkInfo;
        }
      }
    } else {
      console.warn(`[GitHub Releases] Release API status: ${response.status}`);
    }
  } catch (err: any) {
    console.warn('[GitHub Releases] Could not fetch latest release:', err?.message || err);
  }

  cachedApkInfo.lastChecked = now;
  return cachedApkInfo;
}

const FIRESTORE_ADMINS_BASE =
  'https://firestore.googleapis.com/v1/projects/gen-lang-client-0267042672/databases/ai-studio-movieportalhub-664a3e40-85f3-4758-945e-fd031bdc459f/documents/admins';

async function updateServerInstallStats(opts: {
  deviceId?: string;
  platform?: string;
  versionName?: string;
  isNew?: boolean;
}): Promise<number> {
  try {
    const statsUrl = `${FIRESTORE_ADMINS_BASE}/app_stats`;
    const res = await fetch(statsUrl, { cache: 'no-store' });
    let currentCount = 10;
    if (res.ok) {
      const data: any = await res.json();
      currentCount = Math.max(10, Number(data?.fields?.installedAppUsers?.integerValue) || 10);
    }

    if (opts.isNew) {
      currentCount += 1;
      await fetch(
        `${statsUrl}?updateMask.fieldPaths=installedAppUsers&updateMask.fieldPaths=lastActiveAt&updateMask.fieldPaths=updatedAt`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              installedAppUsers: { integerValue: String(currentCount) },
              lastActiveAt: { timestampValue: new Date().toISOString() },
              updatedAt: { integerValue: String(Date.now()) },
            },
          }),
        }
      );
    }

    if (opts.deviceId) {
      const cleanDevId = opts.deviceId.startsWith('dev_') ? opts.deviceId : `dev_${opts.deviceId}`;
      const devUrl = `${FIRESTORE_ADMINS_BASE}/${cleanDevId}`;
      await fetch(devUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            deviceId: { stringValue: opts.deviceId },
            platform: { stringValue: opts.platform || 'android' },
            versionName: { stringValue: opts.versionName || '3.5.222' },
            updatedAt: { integerValue: String(Date.now()) },
            lastActiveAt: { timestampValue: new Date().toISOString() },
          },
        }),
      });
    }

    return currentCount;
  } catch (e) {
    console.warn('[Install Stats Server Notice]', e);
    return 10;
  }
}

// Route 1: Official Android APK Dynamic Download Endpoint
// Redirects Chrome & mobile browsers directly to high-speed GitHub release CDN
downloadCastRouter.get('/download/apk', async (_req: Request, res: Response) => {
  const latest = await fetchLatestGitHubApk();
  console.log(`[Download Router] User downloading APK: ${latest.url}`);

  // Track download hit asynchronously
  (async () => {
    try {
      const statsUrl = `${FIRESTORE_ADMINS_BASE}/app_stats`;
      const sRes = await fetch(statsUrl, { cache: 'no-store' });
      let clicks = 0;
      if (sRes.ok) {
        const d: any = await sRes.json();
        clicks = Number(d?.fields?.totalApkClicks?.integerValue) || 0;
      }
      clicks += 1;
      await fetch(`${statsUrl}?updateMask.fieldPaths=totalApkClicks&updateMask.fieldPaths=lastDownloadAt`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            totalApkClicks: { integerValue: String(clicks) },
            lastDownloadAt: { timestampValue: new Date().toISOString() },
          },
        }),
      });
    } catch {}
  })().catch(() => {});

  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.redirect(302, latest.url);
});

// Route 1b: Release info for frontend / version checker
downloadCastRouter.get('/download/latest-info', async (_req: Request, res: Response) => {
  const latest = await fetchLatestGitHubApk();
  res.json({
    latestVersion: latest.version,
    apkUrl: latest.url,
    fileName: latest.fileName,
  });
});

// Route 1c: Phone app startup install ping endpoint
downloadCastRouter.post('/app/ping-install', async (req: Request, res: Response) => {
  const { deviceId, platform, versionName, isNew } = req.body || {};
  const currentCount = await updateServerInstallStats({
    deviceId,
    platform,
    versionName,
    isNew: Boolean(isNew),
  });
  res.json({ ok: true, installedAppUsers: currentCount });
});

// Route 1d: Quick stats retrieval endpoint
downloadCastRouter.get('/app/stats', async (_req: Request, res: Response) => {
  try {
    const statsUrl = `${FIRESTORE_ADMINS_BASE}/app_stats`;
    const r = await fetch(statsUrl, { cache: 'no-store' });
    if (r.ok) {
      const d: any = await r.json();
      const installedAppUsers = Math.max(10, Number(d?.fields?.installedAppUsers?.integerValue) || 10);
      return res.json({
        installedAppUsers,
        totalApkClicks: Number(d?.fields?.totalApkClicks?.integerValue) || 0,
        updatedAt: d?.fields?.updatedAt?.integerValue || Date.now(),
      });
    }
  } catch {}
  res.json({ installedAppUsers: 10, totalApkClicks: 0 });
});

let cachedDownloadStats = {
  totalGitHubDownloads: 0,
  latestReleaseTag: '',
  latestReleaseDownloads: 0,
  releaseCount: 0,
  lastChecked: 0,
};

downloadCastRouter.get('/download/stats', async (_req: Request, res: Response) => {
  const now = Date.now();
  if (now - cachedDownloadStats.lastChecked < 120000 && cachedDownloadStats.releaseCount > 0) {
    return res.json(cachedDownloadStats);
  }

  try {
    const headers: Record<string, string> = {
      'User-Agent': 'MoviePortal-App/3.5',
      Accept: 'application/vnd.github.v3+json',
    };
    const token = (process.env.GITHUB_TOKEN || '').trim();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(
      'https://api.github.com/repos/Sivobob/-Movie-Portal-Hub/releases?per_page=100',
      { headers }
    );

    if (response.ok) {
      const releases: any[] = await response.json();
      if (Array.isArray(releases)) {
        let totalGitHubDownloads = 0;
        let latestReleaseTag = '';
        let latestReleaseDownloads = 0;

        for (const rel of releases) {
          if (rel?.draft) continue;
          let relSum = 0;
          for (const asset of rel?.assets || []) {
            if (typeof asset?.name === 'string' && asset.name.endsWith('.apk')) {
              relSum += Number(asset.download_count || 0);
            }
          }
          if (!latestReleaseTag) {
            latestReleaseTag = String(rel?.tag_name || '');
            latestReleaseDownloads = relSum;
          }
          totalGitHubDownloads += relSum;
        }

        cachedDownloadStats = {
          totalGitHubDownloads,
          latestReleaseTag,
          latestReleaseDownloads,
          releaseCount: releases.length,
          lastChecked: now,
        };
      }
    }
  } catch (err: any) {
    console.warn('[GitHub Releases] Could not fetch download stats:', err?.message || err);
  }

  return res.json(cachedDownloadStats);
});

// Route 2: TV Casting Media Proxy Endpoint
// Proxies media streams to TV receivers (Chromecast, DLNA, Smart TVs) with HTTP Range support, redirects & CORS
function proxyCastStream(targetUrlStr: string, req: Request, res: Response, redirectsLeft = 5) {
  let fullUrl = targetUrlStr;
  if (targetUrlStr.startsWith('/')) {
    const host = req.headers.host || 'localhost:3000';
    const protocol = req.protocol || 'http';
    fullUrl = `${protocol}://${host}${targetUrlStr}`;
  }

  try {
    const parsed = new URL(fullUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    const requestHeaders: Record<string, string> = {
      'User-Agent': 'MovieBox-TV-Cast-Proxy/2.5',
    };
    if (req.headers.range) {
      requestHeaders['Range'] = req.headers.range as string;
    }

    const proxyReq = client.request(
      fullUrl,
      { method: req.method === 'HEAD' ? 'HEAD' : 'GET', headers: requestHeaders },
      (proxyRes) => {
        const statusCode = proxyRes.statusCode || 200;
        if (
          (statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308) &&
          proxyRes.headers.location &&
          redirectsLeft > 0
        ) {
          proxyRes.resume();
          const nextUrl = new URL(proxyRes.headers.location, fullUrl).toString();
          proxyCastStream(nextUrl, req, res, redirectsLeft - 1);
          return;
        }

        const rawCt = String(proxyRes.headers['content-type'] || '').toLowerCase();
        const contentType = (!rawCt || rawCt.includes('octet-stream')) ? 'video/mp4' : proxyRes.headers['content-type']!;
        const responseHeaders: Record<string, string | string[] | undefined> = {
          'Content-Type': contentType,
          'Accept-Ranges': proxyRes.headers['accept-ranges'] || 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Range',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, Content-Type',
        };

        if (proxyRes.headers['content-length']) {
          responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
        }
        if (proxyRes.headers['content-range']) {
          responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
        }

        res.writeHead(statusCode, responseHeaders);
        if (req.method === 'HEAD') {
          proxyRes.resume();
          res.end();
        } else {
          proxyRes.pipe(res);
        }
      }
    );

    proxyReq.on('error', (err) => {
      console.error('[Cast Proxy Error]', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to proxy media stream to TV device' });
      }
    });

    req.on('close', () => {
      proxyReq.destroy();
    });
    proxyReq.end();
  } catch (err: any) {
    console.error('[Cast Proxy Invalid URL]', err?.message);
    if (!res.headersSent) {
      res.status(400).json({ error: 'Invalid media URL' });
    }
  }
}

downloadCastRouter.options('/cast/proxy', (_req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  res.status(204).end();
});

downloadCastRouter.head('/cast/proxy', (req: Request, res: Response) => {
  const targetUrlStr = req.query.url as string;
  if (!targetUrlStr) {
    res.status(400).json({ error: 'Missing target stream url parameter' });
    return;
  }
  proxyCastStream(targetUrlStr, req, res);
});

downloadCastRouter.get('/cast/proxy', (req: Request, res: Response) => {
  const targetUrlStr = req.query.url as string;

  if (!targetUrlStr) {
    res.status(400).json({ error: 'Missing target stream url parameter' });
    return;
  }

  proxyCastStream(targetUrlStr, req, res);
});

// Route 3: Direct Download Endpoint with Attachment Content-Disposition
// Forces browsers and Android devices to save directly into user's Downloads folder
downloadCastRouter.get('/download/file', (req: Request, res: Response) => {
  const targetUrlStr = req.query.url as string;
  const rawFilename = (req.query.filename as string) || 'Movie_Portal_Video.mp4';
  const safeFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');

  if (!targetUrlStr) {
    res.status(400).json({ error: 'Missing target download url parameter' });
    return;
  }

  // Handle local proxy stream or external URL
  let fullUrl = targetUrlStr;
  if (targetUrlStr.startsWith('/')) {
    const host = req.headers.host || 'localhost:3000';
    const protocol = req.protocol || 'http';
    fullUrl = `${protocol}://${host}${targetUrlStr}`;
  }

  try {
    const parsed = new URL(fullUrl);
    const client = parsed.protocol === 'https:' ? https : http;

    const requestHeaders: Record<string, string> = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      'Accept': '*/*',
    };
    if (req.headers.range) {
      requestHeaders['Range'] = req.headers.range as string;
    }

    const downloadReq = client.get(
      fullUrl,
      { headers: requestHeaders },
      (downloadRes) => {
        // If redirect, follow redirect once
        if (
          (downloadRes.statusCode === 301 || downloadRes.statusCode === 302 || downloadRes.statusCode === 307) &&
          downloadRes.headers.location
        ) {
          res.redirect(downloadRes.headers.location);
          return;
        }

        const statusCode = downloadRes.statusCode || 200;
        const responseHeaders: Record<string, string | string[] | undefined> = {
          'Content-Type': downloadRes.headers['content-type'] || 'video/mp4',
          'Content-Disposition': `attachment; filename="${safeFilename}"`,
          'Accept-Ranges': downloadRes.headers['accept-ranges'] || 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'Content-Length, Content-Disposition, Content-Range',
        };

        if (downloadRes.headers['content-length']) {
          responseHeaders['Content-Length'] = downloadRes.headers['content-length'];
        }
        if (downloadRes.headers['content-range']) {
          responseHeaders['Content-Range'] = downloadRes.headers['content-range'];
        }

        res.writeHead(statusCode, responseHeaders);
        downloadRes.pipe(res);
      }
    );

    downloadReq.on('error', (err) => {
      console.error('[Download Stream Proxy Error]', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream download file' });
      }
    });

    req.on('close', () => {
      downloadReq.destroy();
    });
  } catch (err: any) {
    console.error('[Download Proxy Invalid URL]', err?.message);
    if (!res.headersSent) {
      res.status(400).json({ error: 'Invalid download media URL' });
    }
  }
});

function toMillisSafe(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val?.toMillis === 'function') {
    try {
      return val.toMillis();
    } catch {
      return 0;
    }
  }
  if (typeof val?.seconds === 'number') return val.seconds * 1000;
  if (typeof val === 'string') {
    const num = Number(val);
    if (Number.isFinite(num) && num > 0 && /^\d+$/.test(val.trim())) return num;
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

let cachedAnnouncements: { fetchedAt: number; items: any[] } = { fetchedAt: 0, items: [] };

// Route 5: Latest active movie/series release announcements for Android background notifications
downloadCastRouter.get('/announcements/latest', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (now - cachedAnnouncements.fetchedAt < 10_000 && cachedAnnouncements.items.length > 0) {
      return res.json({ success: true, serverTimeMs: now, announcements: cachedAnnouncements.items });
    }

    const [annSnap, movieSnap] = await Promise.all([
      getDocs(collection(db, 'announcements')),
      getDocs(collection(db, 'movies')).catch(() => null),
    ]);

    const moviesById = new Map<string, any>();
    if (movieSnap) {
      for (const md of movieSnap.docs) {
        moviesById.set(md.id, { id: md.id, ...md.data() });
      }
    }

    const items = annSnap.docs
      .map((d) => {
        const raw: any = d.data() || {};
        const linkedMovie = raw.movieId ? moviesById.get(String(raw.movieId)) : null;
        if (linkedMovie && linkedMovie.published === false) return null;

        const createdAtMs = toMillisSafe(raw.createdAtMs || raw.createdAt) || now;
        const expiresAtMs = toMillisSafe(raw.expiresAt);
        if (expiresAtMs > 0 && expiresAtMs < now) return null;

        const title = String(raw.title || linkedMovie?.title || 'New Release').trim();
        const releaseYear = String(raw.releaseYear || linkedMovie?.releaseYear || '').trim();
        const category = String(raw.category || linkedMovie?.originalCategory || '').trim();
        const isSeries = Boolean(
          raw.isSeries ||
            category.toLowerCase().includes('series') ||
            linkedMovie?.contentType === 'series' ||
            (Array.isArray(linkedMovie?.seasons) && linkedMovie.seasons.length > 0)
        );
        const language = String(raw.language || linkedMovie?.language || '').trim();
        const genre = String(raw.genre || linkedMovie?.genre || '').trim();
        const qualityBadge = String(raw.qualityBadge || linkedMovie?.qualityBadge || '').trim();
        const runtime = String(raw.runtime || linkedMovie?.runtime || '').trim();
        const posterUrl = String(raw.posterUrl || linkedMovie?.posterUrl || '').trim();
        const backdropUrl = String(raw.backdropUrl || linkedMovie?.backdropUrl || posterUrl).trim();
        const message = String(raw.message || 'GO STREAM or DOWNLOAD NOW').trim();

        const yearPart = releaseYear && releaseYear !== '0' ? ` (${releaseYear})` : '';
        const typeLabel = isSeries ? 'Full Series' : 'Full Movie';
        const notificationTitle = `Watch Now : ${title}${yearPart} ${typeLabel} available now`;
        const detailsParts = [
          qualityBadge && qualityBadge.toUpperCase() !== 'NONE' ? qualityBadge : '',
          language,
          genre,
          runtime,
        ].filter(Boolean);
        const notificationBody = detailsParts.length > 0 ? `${message} • ${detailsParts.join(' • ')}` : message;

        return {
          id: d.id,
          movieId: String(raw.movieId || ''),
          title,
          releaseYear,
          category,
          isSeries,
          language,
          genre,
          qualityBadge,
          runtime,
          posterUrl,
          backdropUrl,
          imageUrl: backdropUrl || posterUrl,
          message,
          notificationTitle,
          notificationBody,
          createdAtMs,
          expiresAtMs,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.createdAtMs - a.createdAtMs)
      .slice(0, 20);

    cachedAnnouncements = { fetchedAt: now, items };
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({ success: true, serverTimeMs: now, announcements: items });
  } catch (err: any) {
    console.error('[Announcements Latest Error]', err?.message || err);
    res.status(500).json({ success: false, error: err?.message || 'Failed to fetch announcements' });
  }
});

export default downloadCastRouter;
