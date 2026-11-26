import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getQualityUpgradeDecision,
  getWatchNowQualityLabel,
  isHollywoodPrintMovie,
  isHollywoodPrintText,
  normalizeQualityBadge,
} from './qualityBadge';

test('isHollywoodPrintText detects HDTC, TC, HQ-Rip, 1XBET, Line, CineVood, CAM, PreDVD, and Holl Print', () => {
  assert.equal(isHollywoodPrintText('Ramayana_2026_1080p_HDTC_Hindi.mkv'), true);
  assert.equal(isHollywoodPrintText('Godzilla.Minus.Zero.2026.1080p.HEVC.TC.HIN.ENG.SUB.1XBET.mkv'), true);
  assert.equal(isHollywoodPrintText('Godzilla.Minus.Zero.2026.720p.TC.HIN.ENG.SUB.1XBET.mkv'), true);
  assert.equal(isHollywoodPrintText('Godzilla Minus Zero (2026) Japanese (Line) HDTC 480p x26.mkv'), true);
  assert.equal(isHollywoodPrintText('Movie.2026.1080p.HQ-Rip.V2-HDTC.Hindi-LiNE.mkv'), true);
  assert.equal(isHollywoodPrintText('Movie.2026.720p.PreHD.Hindi.mkv'), true);
  assert.equal(isHollywoodPrintText('Movie.2026.720p.TS.Hindi.mkv'), true);
  assert.equal(isHollywoodPrintText('Dhurandhar_2026_CineVood_1080p.mkv'), true);
  assert.equal(isHollywoodPrintText('Movie.2026.Cinvood.Hindi.mp4'), true);
  assert.equal(isHollywoodPrintText('Action.2026.Hollywood.Print.720p.mkv'), true);
  assert.equal(isHollywoodPrintText('Action.2026.Holl.Print.720p.mkv'), true);
  assert.equal(isHollywoodPrintText('Hero.2026.Hall.Print.mkv'), true);
  assert.equal(isHollywoodPrintText('New.Film.2026.HDCAM.mp4'), true);
  assert.equal(isHollywoodPrintText('New.Film.2026.PreDVD.mkv'), true);

  assert.equal(isHollywoodPrintText('Inception.2010.1080p.WEB-DL.Hindi.mkv'), false);
  assert.equal(isHollywoodPrintText('Cameo.2026.1080p.BluRay.mkv'), false);
  assert.equal(isHollywoodPrintText('Scam.1992.S01E01.1080p.mkv'), false);
  assert.equal(isHollywoodPrintText('Walk.the.Line.2005.1080p.BluRay.mkv'), false);
  assert.equal(isHollywoodPrintText('Love.Between.Lines.2026.1080p.WEB-DL.ts'), false);
});

test('getWatchNowQualityLabel returns Holl Print vs HD', () => {
  assert.equal(getWatchNowQualityLabel({ title: 'Test', qualityBadge: 'HDTC' }), 'Holl Print');
  assert.equal(
    getWatchNowQualityLabel({ title: 'Test', sourceFileName: 'Film.2026.CineVood.1080p.mkv' }),
    'Holl Print'
  );
  assert.equal(getWatchNowQualityLabel({ title: 'Test', qualityBadge: 'HD' }), 'HD');
  assert.equal(
    getWatchNowQualityLabel({
      title: 'Test',
      qualityBadge: 'HD',
      sourceFileName: 'Old.Film.2026.CineVood.720p.mkv',
    }),
    'HD'
  );
  assert.equal(getWatchNowQualityLabel({ title: 'Test', qualityBadge: 'NONE' }), 'HD');
  assert.equal(normalizeQualityBadge('HOLL PRINT'), 'HDTC');
  assert.equal(normalizeQualityBadge('HOLLYWOOD PRINT'), 'HDTC');
  assert.equal(isHollywoodPrintMovie({ title: 'Test', qualityBadge: 'HDTC' }), true);
});

test('getQualityUpgradeDecision replaces Holl Print with HD cleanly without downgrading HD', () => {
  assert.equal(
    getQualityUpgradeDecision({ title: 'Test', qualityBadge: 'HDTC' }, 'HD'),
    'replace_holl_print_with_hd'
  );
  assert.equal(
    getQualityUpgradeDecision({ title: 'Test', qualityBadge: 'HD' }, 'HDTC'),
    'skip_holl_print_on_hd'
  );
  assert.equal(
    getQualityUpgradeDecision({ title: 'Test', qualityBadge: 'HD' }, 'HD'),
    'merge_same_tier'
  );
  assert.equal(
    getQualityUpgradeDecision({ title: 'Test', qualityBadge: 'HDTC' }, 'HDTC'),
    'merge_same_tier'
  );
});
