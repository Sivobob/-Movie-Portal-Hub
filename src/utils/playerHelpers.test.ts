import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveEpisodePlaybackDurationSec,
  normalizeEpisodeForSave,
  resolveStreamBuildPlan,
} from './playerHelpers';
import { getNewEpisodesWithin24h, isEpisodeNewActive } from '../services/movieStorage';
import { isAppUpdateRequired, pickHigherRemoteUpdateConfig } from '../services/appUpdateConfig';

test('resolveEpisodePlaybackDurationSec never falls back to parent series IMDb runtime', () => {
  // Episode has 23m stored in durationSec, parent movie runtime might be 31m elsewhere -> returns 23m
  assert.equal(resolveEpisodePlaybackDurationSec({ durationSec: 1380 }), 1380);
  assert.equal(resolveEpisodePlaybackDurationSec({ duration: '23m' }), 1380);
  // Episode missing duration returns 0 rather than series runtime (when not initial prop fallback)
  assert.equal(resolveEpisodePlaybackDurationSec({}, 0, false, 1860), 0);
  // Uses probed duration when available
  assert.equal(resolveEpisodePlaybackDurationSec({}, 1385, false, 0), 1385);
});

test('normalizeEpisodeForSave suppresses New Episode flags and timestamps unless explicitly enabled', () => {
  const now = 1_700_000_000_000;
  const savedEp = normalizeEpisodeForSave(
    {
      episodeNumber: 5,
      title: 'Episode 5',
      streamUrl: 'https://t.me/c/12345/55',
      duration: '23m',
      durationSec: 1380,
    },
    1,
    now
  );

  assert.equal(savedEp.showInNewEpisodes, false);
  assert.equal(savedEp.newEpisodeEnabledAt, undefined);
  assert.equal(savedEp.createdAt, undefined);
  assert.equal(savedEp.addedAt, undefined);
  assert.equal(isEpisodeNewActive(savedEp, now), false);

  const movies = [
    {
      id: 'series_1',
      title: 'Test Series',
      posterUrl: 'https://example.com/p.jpg',
      releaseYear: 2026,
      originalCategory: 'Web Series',
      displayCategory: 'Web Series',
      published: true,
      seasons: [{ seasonNumber: 1, episodes: [savedEp] }],
    },
  ];
  assert.equal(getNewEpisodesWithin24h(movies, now).length, 0);

  // When admin explicitly enables New Episode, it DOES appear within 24h
  const adminEnabledEp = normalizeEpisodeForSave(
    {
      episodeNumber: 6,
      title: 'Episode 6',
      streamUrl: 'https://t.me/c/12345/56',
      showInNewEpisodes: true,
    },
    6,
    now
  );
  assert.equal(adminEnabledEp.showInNewEpisodes, true);
  assert.equal(adminEnabledEp.newEpisodeEnabledAt, now);
  assert.equal(isEpisodeNewActive(adminEnabledEp, now), true);
  assert.equal(
    getNewEpisodesWithin24h(
      [{ ...movies[0], seasons: [{ seasonNumber: 1, episodes: [savedEp, adminEnabledEp] }] }],
      now
    ).length,
    1
  );
});

test('resolveStreamBuildPlan routes 360P/480P/720P to scaled HLS transcode and keeps 1080P fast direct when compatible', () => {
  const baseInput = {
    rawUrl: 'https://t.me/c/12345/99',
    videoQualities: {},
    recommendedMode: 'direct' as const,
    streamFallbackMode: 'direct' as const,
    canScaleRemote: true,
    isNativePlatform: true,
    isIosWeb: false,
    userPickedQuality: true,
    audioIdx: 0,
    durationSec: 1380,
    startHint: 120,
    streamStartOffset: 120,
  };

  const plan360 = resolveStreamBuildPlan({ ...baseInput, selectedQuality: '360P' });
  assert.equal(plan360.effectiveMode, 'transcode');
  assert.equal(plan360.needsScaledTranscode, true);
  assert.equal(plan360.useHlsPipeline, true);
  assert.equal(plan360.qualityParam, '360p');

  const plan480 = resolveStreamBuildPlan({ ...baseInput, selectedQuality: '480P' });
  assert.equal(plan480.effectiveMode, 'transcode');
  assert.equal(plan480.qualityParam, '480p');

  const plan720 = resolveStreamBuildPlan({ ...baseInput, selectedQuality: '720P' });
  assert.equal(plan720.effectiveMode, 'transcode');
  assert.equal(plan720.qualityParam, '720p');

  const plan1080 = resolveStreamBuildPlan({ ...baseInput, selectedQuality: '1080P' });
  assert.equal(plan1080.effectiveMode, 'direct');
  assert.equal(plan1080.needsScaledTranscode, false);

  // Explicit quality URL must play directly with that quality stream
  const planExplicit360 = resolveStreamBuildPlan({
    ...baseInput,
    selectedQuality: '360P',
    videoQualities: { '360p': 'https://t.me/c/12345/100' },
  });
  assert.equal(planExplicit360.explicitUrl, 'https://t.me/c/12345/100');
  assert.equal(planExplicit360.sourceUrl, 'https://t.me/c/12345/100');
  assert.equal(planExplicit360.effectiveMode, 'direct');

  // Auto-detected 720P / 480P display labels (userPickedQuality: false) must NOT force transcode
  const planAuto720 = resolveStreamBuildPlan({ ...baseInput, selectedQuality: '720P', userPickedQuality: false });
  assert.equal(planAuto720.effectiveMode, 'direct');
  assert.equal(planAuto720.needsScaledTranscode, false);

  const planAuto480 = resolveStreamBuildPlan({ ...baseInput, selectedQuality: '480P', userPickedQuality: false });
  assert.equal(planAuto480.effectiveMode, 'direct');
  assert.equal(planAuto480.needsScaledTranscode, false);

  // Auto-slow 360P fallback (streamFallbackMode: 'transcode') still enables scaled 360p HLS
  const planAutoSlow360 = resolveStreamBuildPlan({
    ...baseInput,
    selectedQuality: '360P',
    userPickedQuality: false,
    streamFallbackMode: 'transcode',
  });
  assert.equal(planAutoSlow360.effectiveMode, 'transcode');
  assert.equal(planAutoSlow360.needsScaledTranscode, true);
  assert.equal(planAutoSlow360.qualityParam, '360p');
});

test('App update prompt detects v3.5.277 update for v3.5.275 and v3.5.276 APK users', () => {
  const firestoreOld = {
    latestVersion: '3.5.276',
    minimumRequiredVersion: '3.5.276',
    latestVersionCode: 35276,
    minimumRequiredVersionCode: 35276,
    apkDownloadUrl: 'https://github.com/Sivobob/-Movie-Portal-Hub/releases/latest/download/Movie-Portal.apk',
    updateMessage: 'Old',
  };
  const githubNew = {
    latestVersion: '3.5.277',
    minimumRequiredVersion: '3.5.277',
    latestVersionCode: 35277,
    minimumRequiredVersionCode: 35277,
    apkDownloadUrl: 'https://github.com/Sivobob/-Movie-Portal-Hub/releases/latest/download/Movie-Portal.apk',
    updateMessage: 'New v3.5.277',
  };

  const picked = pickHigherRemoteUpdateConfig(firestoreOld, githubNew);
  assert.equal(picked?.latestVersion, '3.5.277');
  assert.equal(picked?.latestVersionCode, 35277);

  // Installed v3.5.275 and v3.5.276 must both be prompted to update
  assert.equal(isAppUpdateRequired({ versionName: '3.5.275', versionCode: 35275 }, picked), true);
  assert.equal(isAppUpdateRequired({ versionName: '3.5.276', versionCode: 35276 }, picked), true);
  // Installed v3.5.277 must NOT be prompted
  assert.equal(isAppUpdateRequired({ versionName: '3.5.277', versionCode: 35277 }, picked), false);
});
