import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = fs.existsSync(path.resolve(__dirname, '.env'))
  ? path.resolve(__dirname, '.env')
  : path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

import express from 'express';
import { spawnSync } from 'child_process';
import metadataRouter from './src/server/metadataRouter.ts';
import telegramRouter, { handleStream } from './src/server/telegramRouter.ts';
import videoRouter from './src/server/videoRouter.ts';
import downloadCastRouter from './src/server/downloadCastRouter.ts';
import pushRouter from './src/server/pushRouter.ts';
import { getTelegramCredentials, isTelegramConnected } from './src/utils/telegramClient.ts';
import {
  getServerFirestoreQuotaStatus,
  markServerFirestoreQuotaExhausted,
} from './src/server/firestoreQuotaFlag.ts';
import { hasPlayableContent } from './src/utils/seriesCompleteness.ts';

function checkBinaryAvailable(bin: string): boolean {
  try {
    const res = spawnSync(bin, ['-version'], { stdio: 'ignore', timeout: 3000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

const FFMPEG_AVAILABLE = checkBinaryAvailable('ffmpeg');
const FFPROBE_AVAILABLE = checkBinaryAvailable('ffprobe');

const app = express();
// In AI Studio dev container, Nginx listens on 8080 (NGINX_PORT=8080, DEFAULT_APP_PORT=3000) and proxies to 3000.
// In standalone Cloud Run publish (ais-pre), PORT=8080 is passed directly without NGINX_PORT.
let PORT = 3000;
if (process.env.APP_PORT) {
  PORT = Number(process.env.APP_PORT) || 3000;
} else if (process.env.NGINX_PORT || process.env.DEFAULT_APP_PORT) {
  PORT = Number(process.env.DEFAULT_APP_PORT) || 3000;
} else if (process.env.RENDER && process.env.PORT) {
  PORT = Number(process.env.PORT) || 3000;
} else if (process.env.PORT) {
  PORT = Number(process.env.PORT) || 3000;
}
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    PORT = Number(args[i + 1]) || PORT;
  }
}
process.env.INTERNAL_APP_PORT = String(PORT);

app.use(express.json());

// Request logging middleware
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Universal CORS middleware for Android APK and web
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Range');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, X-Stream-Mode, Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Ensure API routes (except /api/stream, /api/telegram/hls, and /api/ios-profile) default to JSON
app.use('/api', (req, res, next) => {
  if (
    !req.path.startsWith('/stream') &&
    !req.path.startsWith('/telegram/hls') &&
    !req.path.startsWith('/telegram/live-events') &&
    !req.path.startsWith('/telegram/subtitles.vtt') &&
    !req.path.startsWith('/ios-profile')
  ) {
    res.setHeader('Content-Type', 'application/json');
  }
  next();
});

// API Routes
app.get('/api/health', (req, res) => {
  const creds = getTelegramCredentials();
  const telegramConfigured = Boolean(creds.apiId && creds.apiHash && (creds.botToken || creds.sessionStr));
  let appVersion = '3.5.289';
  try {
    const vPath = path.resolve(__dirname, 'public/version.json');
    if (fs.existsSync(vPath)) {
      const vj = JSON.parse(fs.readFileSync(vPath, 'utf8'));
      if (vj?.latestVersion) appVersion = String(vj.latestVersion);
    }
  } catch {}
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    version: appVersion,
    ffmpegAvailable: FFMPEG_AVAILABLE,
    ffprobeAvailable: FFPROBE_AVAILABLE,
    telegramConfigured,
    telegramConnected: isTelegramConnected(),
    hlsSupported: FFMPEG_AVAILABLE && FFPROBE_AVAILABLE,
    transcodeSupported: FFMPEG_AVAILABLE && FFPROBE_AVAILABLE && telegramConfigured,
  });
});

app.get('/api/debug-env', (req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    projectId: process.env.FIREBASE_PROJECT_ID || 'not set in env',
    ffmpegAvailable: FFMPEG_AVAILABLE,
    ffprobeAvailable: FFPROBE_AVAILABLE,
  });
});

// Direct Apple iOS WebClip Configuration Profile download (all iPhones & iOS versions)
app.get('/api/ios-profile', (req, res) => {
  try {
    const rawHost = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const rawProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(rawHost);
    const scheme = isLocal ? rawProto : 'https';
    const appOrigin = rawHost ? `${scheme}://${rawHost}/` : 'https://ais-pre-yaniwuwl6wc7ivl5tz2bbo-755452514312.asia-northeast1.run.app/';

    const escapeXml = (str: string) =>
      str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');

    const iconCandidates = [
      path.resolve(process.cwd(), 'public/apple-touch-icon.png'),
      path.resolve(process.cwd(), 'dist/apple-touch-icon.png'),
      path.resolve(__dirname, 'public/apple-touch-icon.png'),
      path.resolve(__dirname, 'dist/apple-touch-icon.png'),
      path.resolve(__dirname, 'apple-touch-icon.png'),
      path.resolve(process.cwd(), 'public/assets/icons/master_icon.png'),
      path.resolve(__dirname, 'public/assets/icons/master_icon.png'),
    ];
    let iconBase64 = '';
    for (const candidate of iconCandidates) {
      if (fs.existsSync(candidate)) {
        iconBase64 = fs.readFileSync(candidate).toString('base64');
        break;
      }
    }

    const iconEntry = iconBase64
      ? `        <key>Icon</key>
        <data>
${iconBase64.replace(/.{1,76}/g, '          $&\n').trimEnd()}
        </data>\n`
      : '';

    const mobileConfigPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>PayloadContent</key>
    <array>
      <dict>
        <key>FullScreen</key>
        <true/>
${iconEntry}        <key>IgnoreManifestScope</key>
        <false/>
        <key>IsRemovable</key>
        <true/>
        <key>Label</key>
        <string>Movie Hub</string>
        <key>PayloadDescription</key>
        <string>Adds Movie Hub to your iPhone Home Screen in fullscreen app mode.</string>
        <key>PayloadDisplayName</key>
        <string>Movie Hub Web App</string>
        <key>PayloadIdentifier</key>
        <string>com.moviebox.stream.webclip.v1</string>
        <key>PayloadType</key>
        <string>com.apple.webClip.managed</string>
        <key>PayloadUUID</key>
        <string>8F3A9C12-4E21-4B89-9D7A-10C8B5A2E301</string>
        <key>PayloadVersion</key>
        <integer>1</integer>
        <key>Precomposed</key>
        <true/>
        <key>URL</key>
        <string>${escapeXml(appOrigin)}</string>
      </dict>
    </array>
    <key>PayloadDescription</key>
    <string>Install Movie Hub on your iPhone or iPad Home Screen. Compatible with all iPhone models and iOS versions.</string>
    <key>PayloadDisplayName</key>
    <string>Movie Hub</string>
    <key>PayloadIdentifier</key>
    <string>com.moviebox.stream.profile.ios</string>
    <key>PayloadOrganization</key>
    <string>Movie Hub</string>
    <key>PayloadRemovalDisallowed</key>
    <false/>
    <key>PayloadType</key>
    <string>Configuration</string>
    <key>PayloadUUID</key>
    <string>4B7D2E90-1A34-4F12-B8C3-7D9E0F12A402</string>
    <key>PayloadVersion</key>
    <integer>1</integer>
  </dict>
</plist>
`;

    res.setHeader('Content-Type', 'application/x-apple-aspen-config');
    res.setHeader('Content-Disposition', 'attachment; filename="Movie-Hub.mobileconfig"');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(mobileConfigPlist);
  } catch (err: any) {
    res.status(500).setHeader('Content-Type', 'application/json').json({
      error: err?.message || 'Failed to generate iOS profile',
    });
  }
});

app.use('/api/metadata', metadataRouter);
app.use('/api/telegram', telegramRouter);
app.get('/api/stream', handleStream);
app.head('/api/stream', handleStream);
app.use('/api/video', videoRouter);
app.use('/api/push', pushRouter);
app.use('/api', downloadCastRouter);

app.get('/api/firestore/quota-status', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json(getServerFirestoreQuotaStatus());
});

app.post('/api/firestore/quota-exhausted', (req, res) => {
  const exhaustedUntilMs = markServerFirestoreQuotaExhausted(
    req.body?.reason || 'client-reported-resource-exhausted'
  );
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ writeAllowed: false, exhaustedUntilMs });
});
app.get('/api/movies/catalog', (_req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    const candidates = [
      path.resolve(process.cwd(), 'public/movies-seed.json'),
      path.resolve(process.cwd(), 'dist/movies-seed.json'),
      path.resolve(__dirname, 'public/movies-seed.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        const filtered = Array.isArray(parsed)
          ? parsed
              .filter((m: any) => m && m.id && m.published !== false && hasPlayableContent(m))
              .map((m: any) =>
                Number(m.releaseYear) > currentYear ? { ...m, releaseYear: currentYear } : m
              )
          : [];
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.json(filtered);
      }
    }
    return res.json([]);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to read movies catalog' });
  }
});

let cachedCatalogMeta: { filePath: string; mtimeMs: number; size: number; count: number } | null = null;

app.get('/api/movies/catalog-meta', (_req, res) => {
  try {
    const candidates = [
      path.resolve(process.cwd(), 'public/movies-seed.json'),
      path.resolve(process.cwd(), 'dist/movies-seed.json'),
      path.resolve(__dirname, 'public/movies-seed.json'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const stat = fs.statSync(p);
        if (
          !cachedCatalogMeta ||
          cachedCatalogMeta.filePath !== p ||
          cachedCatalogMeta.mtimeMs !== stat.mtimeMs ||
          cachedCatalogMeta.size !== stat.size
        ) {
          let count = 0;
          try {
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
            count = Array.isArray(parsed)
              ? parsed.filter((m: any) => m && m.id && m.published !== false && hasPlayableContent(m)).length
              : 0;
          } catch {}
          cachedCatalogMeta = { filePath: p, mtimeMs: stat.mtimeMs, size: stat.size, count };
        }
        res.setHeader('Cache-Control', 'no-store');
        return res.json({
          count: cachedCatalogMeta.count,
          size: cachedCatalogMeta.size,
          mtimeMs: Math.round(cachedCatalogMeta.mtimeMs),
        });
      }
    }
    return res.json({ count: 0, size: 0, mtimeMs: 0 });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Failed to read catalog meta' });
  }
});

// API 404 Handler (Guaranteed JSON)
app.use('/api', (req, res) => {
  console.warn(`[API 404] ${req.method} ${req.url}`);
  res.status(404).json({ error: `API route not found: /api${req.url}` });
});

// Global Error Handler for API (Guaranteed JSON)
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Global Error Handler]', err);
  res.setHeader('Content-Type', 'application/json');
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Global error handlers to prevent process crashes
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

// Development with Vite vs Production Static Serving
const isRunningFromDist = import.meta.url.includes('/dist/') || (process.argv[1] && process.argv[1].includes('/dist/'));
const isProduction = process.env.NODE_ENV === 'production' || isRunningFromDist;

const getStaticDir = () => {
  const candidates = [
    path.resolve(process.cwd(), 'dist'),
    path.resolve(__dirname, 'dist'),
    __dirname,
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.resolve(dir, 'index.html'))) {
      return dir;
    }
  }
  return __dirname;
};

const applyFreshHtmlCacheHeaders = (res: express.Response, filePath?: string) => {
  const clean = (filePath || '').toLowerCase();
  if (
    !clean ||
    clean.endsWith('.html') ||
    clean.endsWith('/sw.js') ||
    clean.endsWith('/sw-push.js') ||
    clean.endsWith('/version.json') ||
    clean.endsWith('/manifest.webmanifest') ||
    clean.endsWith('/manifest.json')
  ) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (clean.includes(`${path.sep}assets${path.sep}`)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
};

if (!isProduction) {
  try {
    app.use((req, res, next) => {
      const p = (req.path || '').toLowerCase();
      const accept = String(req.headers.accept || '').toLowerCase();
      if (
        p === '/' ||
        p.endsWith('.html') ||
        p === '/sw.js' ||
        p === '/sw-push.js' ||
        p === '/version.json' ||
        p === '/manifest.webmanifest' ||
        p === '/manifest.json' ||
        (!p.startsWith('/api/') && !p.startsWith('/src/') && !p.startsWith('/node_modules/') && accept.includes('text/html'))
      ) {
        applyFreshHtmlCacheHeaders(res);
      }
      next();
    });
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { 
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
      },
      optimizeDeps: {
        entries: ['index.html'],
        include: [
          'react',
          'react-dom',
          'react-dom/client',
          'react/jsx-runtime',
          'react/jsx-dev-runtime',
          'framer-motion',
          'lucide-react',
          'react-router-dom',
          'hls.js',
        ],
      },
      appType: 'spa',
    });
    // HMR is disabled in this environment (hmr: false); serve a clean no-socket @vite/client
    // so CSS style injection and import.meta.hot stubs work without failing WebSocket errors.
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(`
const sheetsMap = new Map();
if (typeof document !== 'undefined') {
  document.querySelectorAll('style[data-vite-dev-id]').forEach((el) => {
    sheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
}
const cspNonce = typeof document !== 'undefined' ? document.querySelector('meta[property=csp-nonce]')?.nonce : undefined;
let lastInsertedStyle;
export function updateStyle(id, content) {
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    if (cspNonce) style.setAttribute('nonce', cspNonce);
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = undefined; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement('afterend', style);
    }
    lastInsertedStyle = style;
  } else {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (!url || (url[0] !== '.' && url[0] !== '/')) return url;
  const pathname = url.replace(/[?#].*$/, '');
  const parsed = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (parsed.search ? '&' + parsed.search.slice(1) : '') + (parsed.hash || '');
}
const BaseEl = typeof globalThis !== 'undefined' && globalThis.HTMLElement ? globalThis.HTMLElement : class {};
export class ErrorOverlay extends BaseEl {}
`);
    });
    app.use(vite.middlewares);
  } catch (viteErr) {
    console.warn('[Vite Middleware notice - falling back to static/SPA]', viteErr);
    const staticDir = getStaticDir();
    app.use(express.static(staticDir, { setHeaders: (res, filePath) => applyFreshHtmlCacheHeaders(res, filePath) }));
    if (fs.existsSync(path.resolve(process.cwd(), 'public'))) {
      app.use(express.static(path.resolve(process.cwd(), 'public'), { setHeaders: (res, filePath) => applyFreshHtmlCacheHeaders(res, filePath) }));
    }
    app.get('*', (_req, res) => {
      applyFreshHtmlCacheHeaders(res);
      res.sendFile(path.resolve(staticDir, 'index.html'));
    });
  }
} else {
  const staticDir = getStaticDir();
  console.log(`[Production] Serving static files from: ${staticDir}`);
  app.use(express.static(staticDir, { setHeaders: (res, filePath) => applyFreshHtmlCacheHeaders(res, filePath) }));
  if (fs.existsSync(path.resolve(process.cwd(), 'public'))) {
    app.use(express.static(path.resolve(process.cwd(), 'public'), { setHeaders: (res, filePath) => applyFreshHtmlCacheHeaders(res, filePath) }));
  }
  app.get('*', (_req, res) => {
    applyFreshHtmlCacheHeaders(res);
    res.sendFile(path.resolve(staticDir, 'index.html'));
  });
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`MOVIE PORTAL server running on port ${PORT}`);
});
// Prevent Node 22 default 300s requestTimeout from cutting off long video streams mid-playback
server.requestTimeout = 0;
server.timeout = 0;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
