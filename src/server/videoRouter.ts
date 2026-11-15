import express from 'express';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../../');
const transcodedDir = path.join(rootDir, 'public', 'transcoded');

// Ensure directory exists
if (!fs.existsSync(transcodedDir)) {
  fs.mkdirSync(transcodedDir, { recursive: true });
}

import { requireAdmin } from './authMiddleware.ts';

const router = express.Router();

interface TranscodeRequest {
  url: string;
  imdbId: string;
  targetQualities: string[]; // ['480p', '720p']
}

router.post('/transcode', requireAdmin, async (req, res) => {
  const { url, imdbId, targetQualities } = req.body as TranscodeRequest;

  if (!url || !imdbId) {
    return res.status(400).json({ error: 'Source URL and IMDb ID are required' });
  }

  const results: Record<string, string> = {};
  const tasks = targetQualities.map(async (quality) => {
    const filename = `${imdbId}_${quality}.mp4`;
    const outputPath = path.join(transcodedDir, filename);
    const publicUrl = `/transcoded/${filename}`;

    if (fs.existsSync(outputPath)) {
      results[quality] = publicUrl;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      let width = 1280;
      let bitrate = '2500k';

      if (quality === '480p') {
        width = 854;
        bitrate = '1000k';
      } else if (quality === '720p') {
        width = 1280;
        bitrate = '2500k';
      }

      ffmpeg(url)
        .size(`${width}x?`)
        .videoBitrate(bitrate)
        .format('mp4')
        .on('start', (commandLine) => {
          console.log(`Started transcoding ${quality} for ${imdbId}: ${commandLine}`);
        })
        .on('error', (err) => {
          console.error(`Error transcoding ${quality} for ${imdbId}:`, err);
          reject(err);
        })
        .on('end', () => {
          console.log(`Finished transcoding ${quality} for ${imdbId}`);
          results[quality] = publicUrl;
          resolve();
        })
        .save(outputPath);
    });
  });

  try {
    // We don't want to block the response for long transcoding jobs
    // But for now, let's just respond that it started
    res.json({ message: 'Transcoding started', status: 'processing' });
    
    // Continue in background
    Promise.all(tasks).then(() => {
      console.log(`All transcoding tasks completed for ${imdbId}`);
      // In a real app, we would update Firestore here
    }).catch(err => {
      console.error(`Transcoding failed for ${imdbId}:`, err);
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to initiate transcoding' });
  }
});

router.get('/status/:imdbId', (req, res) => {
  const { imdbId } = req.params;
  const qualities = ['480p', '720p'];
  const status: Record<string, any> = {};

  qualities.forEach(q => {
    const filename = `${imdbId}_${q}.mp4`;
    const outputPath = path.join(transcodedDir, filename);
    if (fs.existsSync(outputPath)) {
      status[q] = {
        ready: true,
        url: `/transcoded/${filename}`
      };
    } else {
      status[q] = { ready: false };
    }
  });

  res.json(status);
});

export default router;
