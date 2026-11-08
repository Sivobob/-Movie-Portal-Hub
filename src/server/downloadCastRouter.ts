import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const downloadCastRouter = Router();

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
