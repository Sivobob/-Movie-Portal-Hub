import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

import express from 'express';
import metadataRouter from './src/server/metadataRouter.ts';
import telegramRouter, { handleStream } from './src/server/telegramRouter.ts';
import videoRouter from './src/server/videoRouter.ts';
import downloadCastRouter from './src/server/downloadCastRouter.ts';

const app = express();
// In AI Studio container environment, port 3000 is required for the application.
// process.env.PORT is often set to 8080 by Cloud Run (which is already bound by Nginx).
let PORT = 3000;
if (process.env.APP_PORT) {
  PORT = Number(process.env.APP_PORT) || 3000;
} else if (process.env.RENDER && process.env.PORT) {
  PORT = Number(process.env.PORT) || 3000;
} else if (process.env.PORT && process.env.PORT !== '8080') {
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
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length, X-Video-Duration, Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Ensure API routes (except /api/stream) default to JSON
app.use('/api', (req, res, next) => {
  if (!req.path.startsWith('/stream')) {
    res.setHeader('Content-Type', 'application/json');
  }
  next();
});

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.get('/api/debug-env', (req, res) => {
  res.json({
    nodeEnv: process.env.NODE_ENV,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    projectId: process.env.FIREBASE_PROJECT_ID || 'not set in env'
  });
});

app.use('/api/metadata', metadataRouter);
app.use('/api/telegram', telegramRouter);
app.get('/api/stream', handleStream);
app.head('/api/stream', handleStream);
app.use('/api/video', videoRouter);
app.use('/api', downloadCastRouter);

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

// Development with Vite vs Production
try {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { 
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const staticDir = fs.existsSync(path.resolve(__dirname, 'dist')) 
      ? path.resolve(__dirname, 'dist') 
      : __dirname;
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(staticDir, 'index.html'));
    });
  }
} catch (viteErr) {
  console.warn('[Vite Middleware notice - falling back to static/SPA]', viteErr);
  const staticDir = fs.existsSync(path.resolve(__dirname, 'dist')) 
    ? path.resolve(__dirname, 'dist') 
    : __dirname;
  app.use(express.static(staticDir));
  app.get('*', (_req, res) => {
    res.sendFile(path.resolve(staticDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MOVIE PORTAL server running on port ${PORT}`);
});

