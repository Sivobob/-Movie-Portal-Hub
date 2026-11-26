import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getWatchNowQualityLabel,
  isHollywoodPrintMovie,
  isHollywoodPrintText,
  normalizeQualityBadge,
} from './qualityBadge';

test('isHollywoodPrintText detects HDTC, CineVood, CAM, PreDVD, and Hollywood Print', () => {
  assert.equal(isHollywoodPrintText('Ramayana_2026_1080p_HDTC_Hindi.mkv'), true);
  assert.equal(isHollywoodPrintText('Dhurandhar_2026_CineVood_1080p.mkv'), true);
  assert.equal(isHollywoodPrintText('Movie.2026.Cinvood.Hindi.mp4'), true);
  assert.equal(isHollywoodPrintText('Action.2026.Hollywood.Print.720p.mkv'), true);
  assert.equal(isHollywoodPrintText('Hero.2026.Hall.Print.mkv'), true);
  assert.equal(isHollywoodPrintText('New.Film.2026.HDCAM.mp4'), true);
  assert.equal(isHollywoodPrintText('New.Film.2026.PreDVD.mkv'), true);

  assert.equal(isHollywoodPrintText('Inception.2010.1080p.WEB-DL.Hindi.mkv'), false);
  assert.equal(isHollywoodPrintText('Cameo.2026.1080p.BluRay.mkv'), false);
  assert.equal(isHollywoodPrintText('Scam.1992.S01E01.1080p.mkv'), false);
});

test('getWatchNowQualityLabel returns Hollywood Print vs HD', () => {
  assert.equal(getWatchNowQualityLabel({ title: 'Test', qualityBadge: 'HDTC' }), 'Hollywood Print');
  assert.equal(
    getWatchNowQualityLabel({ title: 'Test', sourceFileName: 'Film.2026.CineVood.1080p.mkv' }),
    'Hollywood Print'
  );
  assert.equal(getWatchNowQualityLabel({ title: 'Test', qualityBadge: 'HD' }), 'HD');
  assert.equal(getWatchNowQualityLabel({ title: 'Test', qualityBadge: 'NONE' }), 'HD');
  assert.equal(normalizeQualityBadge('HOLLYWOOD PRINT'), 'HDTC');
  assert.equal(isHollywoodPrintMovie({ title: 'Test', qualityBadge: 'HDTC' }), true);
});
