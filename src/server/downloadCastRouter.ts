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

export default downloadCastRouter;
