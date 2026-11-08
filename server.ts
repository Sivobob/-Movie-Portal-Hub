import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.env') });
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import metadataRouter from './src/server/metadataRouter.ts';
import telegramRouter, { handleStream } from './src/server/telegramRouter.ts';
import videoRouter from './src/server/videoRouter.ts';
import downloadCastRouter from './src/server/downloadCastRouter.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
let PORT = Number(process.env.PORT) || 3000;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    PORT = Number(args[i + 1]) || PORT;
  }
}

app.use(express.json());

// Request logging middleware
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
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
app.use('/api/video', videoRouter);
app.use('/api', downloadCastRouter);

// API 404 Handler
app.use('/api', (req, res) => {
  console.warn(`[API 404] ${req.method} ${req.url}`);
  res.status(404).json({ error: `API route not found: /api${req.url}` });
});

// Add a catch-all for /api that ensures JSON even for 403s if they fall through
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

// Global Error Handler for API
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Global Error Handler]', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Development with Vite vs Production
if (process.env.NODE_ENV !== 'production') {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { 
      middlewareMode: true,
      hmr: false
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`MOVIE PORTAL server running on port ${PORT}`);
});
