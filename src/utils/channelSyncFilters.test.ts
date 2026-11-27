import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateChannelVideoFilter, filterQualityMapForHdOnly } from './channelSyncFilters';

test('evaluateChannelVideoFilter rejects silent / no-audio videos strictly', () => {
  const explicitSilent = evaluateChannelVideoFilter({
    fileName: 'Movie.2024.1080p.WEB-DL.NoAudio.mkv',
    parsedQuality: '1080p',
    height: 1080,
    hasExplicitNoSound: true,
    hasVideoAttr: true,
  });
  assert.equal(explicitSilent.accepted, false);
  assert.equal(explicitSilent.reason, 'no_audio');

  const probedSilent = evaluateChannelVideoFilter({
    fileName: 'Movie.2024.1080p.mkv',
    parsedQuality: '1080p',
    height: 1080,
    hasVideoAttr: true,
    probe: {
      probedByFfprobe: true,
      height: 1080,
      width: 1920,
      audioCodec: '',
      audioTracks: [],
    },
  });
  assert.equal(probedSilent.accepted, false);
  assert.equal(probedSilent.reason, 'no_audio');
});

test('evaluateChannelVideoFilter accepts 1080p and 720p videos with confirmed audio', () => {
  const valid1080 = evaluateChannelVideoFilter({
    fileName: 'Inception.2010.Hindi.1080p.mkv',
    parsedQuality: '1080p',
    probe: {
      probedByFfprobe: true,
      height: 1080,
      width: 1920,
      audioCodec: 'aac',
      audioTracks: [{ codec: 'aac', channels: 2 }],
    },
  });
  assert.equal(valid1080.accepted, true);
  assert.equal(valid1080.effectiveQuality, '1080p');

  const valid720Cropped = evaluateChannelVideoFilter({
    fileName: 'Pushpa.2.mkv',
    parsedQuality: '',
    probe: {
      probedByFfprobe: true,
      height: 540,
      width: 1280,
      audioCodec: 'eac3',
      audioTracks: [{ codec: 'eac3', channels: 6 }],
    },
  });
  assert.equal(valid720Cropped.accepted, true);
  assert.equal(valid720Cropped.effectiveQuality, '720p');
});

test('evaluateChannelVideoFilter rejects 360p, 480p, and opt-in CAM rips while allowing HDTC 1080p with audio', () => {
  const res480 = evaluateChannelVideoFilter({
    fileName: 'Movie.2024.480p.mp4',
    parsedQuality: '480p',
    height: 480,
    probe: {
      probedByFfprobe: true,
      height: 480,
      width: 854,
      audioCodec: 'aac',
      audioTracks: [{ codec: 'aac', channels: 2 }],
    },
  });
  assert.equal(res480.accepted, false);
  assert.equal(res480.reason, 'low_quality');

  const hdtc1080 = evaluateChannelVideoFilter({
    fileName: 'Ramayana_2026_1080p_HDTC_Hindi.mkv',
    parsedQuality: '1080p',
    height: 1080,
    probe: {
      probedByFfprobe: true,
      height: 1080,
      width: 1920,
      audioCodec: 'aac',
      audioTracks: [{ codec: 'aac', channels: 2 }],
    },
  });
  assert.equal(hdtc1080.accepted, true);
  assert.equal(hdtc1080.effectiveQuality, '1080p');

  const cam = evaluateChannelVideoFilter({
    fileName: 'New.Movie.2026.1080p.HDCAM.mp4',
    parsedQuality: '1080p',
    height: 1080,
    rejectCamRip: true,
    probe: {
      probedByFfprobe: true,
      height: 1080,
      width: 1920,
      audioCodec: 'aac',
      audioTracks: [{ codec: 'aac', channels: 2 }],
    },
  });
  assert.equal(cam.accepted, false);
  assert.equal(cam.reason, 'cam_rip');
});

test('filterQualityMapForHdOnly retains only 1080p and 720p streams', () => {
  const filtered = filterQualityMapForHdOnly({
    '360p': 'https://t.me/c/1/1',
    '480p': 'https://t.me/c/1/2',
    '720p': 'https://t.me/c/1/3',
    '1080p': 'https://t.me/c/1/4',
  });
  assert.deepEqual(filtered, {
    '720p': 'https://t.me/c/1/3',
    '1080p': 'https://t.me/c/1/4',
  });
});
