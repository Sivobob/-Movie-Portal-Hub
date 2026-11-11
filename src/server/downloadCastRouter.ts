import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Route 1: Official Android APK Dynamic Download Endpoint
// Chrome will automatically download the latest APK directly as a full binary file stream
downloadCastRouter.get('/download/apk', async (req: Request, res: Response) => {
  const latest = await fetchLatestGitHubApk();
  console.log(`[Download Router] Processing APK request: ${latest.fileName} from ${latest.url}`);

  if (req.query.redirect === '1' || req.query.direct === '1') {
    return res.redirect(302, latest.url);
  }

  // Stream directly to client so Chrome downloads full APK with correct name & size without cross-origin redirect traps
  const pipeRemoteApk = (targetUrl: string, depth = 0) => {
    if (depth > 5) {
      if (!res.headersSent) res.redirect(302, latest.url);
      return;
    }

    try {
      const parsed = new URL(targetUrl);
      const client = parsed.protocol === 'https:' ? https : http;
      const remoteReq = client.get(
        targetUrl,
        {
          headers: {
            'User-Agent': 'MoviePortal-Downloader/3.5 (Linux; Android; Mobile)',
            'Accept': '*/*',
          },
        },
        (remoteRes) => {
          if (
            (remoteRes.statusCode === 301 || remoteRes.statusCode === 302 || remoteRes.statusCode === 307) &&
            remoteRes.headers.location
          ) {
            return pipeRemoteApk(remoteRes.headers.location, depth + 1);
          }

          if (remoteRes.statusCode && remoteRes.statusCode >= 400) {
            console.warn(`[Download Router] Remote responded with ${remoteRes.statusCode}`);
            if (!res.headersSent) res.redirect(302, latest.url);
            return;
          }

          const fileName = latest.fileName || 'Movie-Portal.apk';
          res.setHeader('Content-Type', 'application/vnd.android.package-archive');
          res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Disposition');
          if (remoteRes.headers['content-length']) {
            res.setHeader('Content-Length', remoteRes.headers['content-length']);
          }

          remoteRes.pipe(res);
        }
      );

      remoteReq.on('error', (err) => {
        console.error('[Download Router] Streaming error:', err?.message || err);
        if (!res.headersSent) {
          res.redirect(302, latest.url);
        }
      });

      req.on('close', () => {
        remoteReq.destroy();
      });
    } catch (e) {
      if (!res.headersSent) {
        res.redirect(302, latest.url);
      }
    }
  };

  pipeRemoteApk(latest.url);
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

// Route 2: TV Casting Media Proxy Endpoint
// Proxies media streams to TV receivers (Chromecast, DLNA, Smart TVs) with HTTP Range support & CORS
downloadCastRouter.get('/cast/proxy', (req: Request, res: Response) => {
  const targetUrlStr = req.query.url as string;

  if (!targetUrlStr) {
    res.status(400).json({ error: 'Missing target stream url parameter' });
    return;
  }

  // Set permissive CORS headers for TV receivers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');

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
      'User-Agent': 'MovieBox-TV-Cast-Proxy/2.5',
    };
    if (req.headers.range) {
      requestHeaders['Range'] = req.headers.range as string;
    }

    const proxyReq = client.get(
      fullUrl,
      { headers: requestHeaders },
      (proxyRes) => {
        const statusCode = proxyRes.statusCode || 200;
        const responseHeaders: Record<string, string | string[] | undefined> = {
          'Content-Type': proxyRes.headers['content-type'] || 'video/mp4',
          'Accept-Ranges': proxyRes.headers['accept-ranges'] || 'bytes',
          'Access-Control-Allow-Origin': '*',
        };

        if (proxyRes.headers['content-length']) {
          responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
        }
        if (proxyRes.headers['content-range']) {
          responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
        }

        res.writeHead(statusCode, responseHeaders);
        proxyRes.pipe(res);
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
  } catch (err: any) {
    console.error('[Cast Proxy Invalid URL]', err?.message);
    if (!res.headersSent) {
      res.status(400).json({ error: 'Invalid media URL' });
    }
  }
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

export default downloadCastRouter;
