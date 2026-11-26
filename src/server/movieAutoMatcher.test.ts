import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTelegramMovieMeta } from './movieAutoMatcher.ts';

test('parses Solo Leveling Season 1 bullet/comma captions with numeric filenames', () => {
  const caption1 = [
    "• Title'- Solo Leveling session 1",
    '• Episode,- 01',
    '• Audio track,- Hindi Dub | #Official',
    '• Quality - 720p',
    '━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');

  const m1 = parseTelegramMovieMeta('1.mkv', caption1, 1280, 720, 1420);
  assert.equal(m1.cleanTitle, 'Solo Leveling');
  assert.equal(m1.isSeriesEpisode, true);
  assert.equal(m1.seasonNumber, 1);
  assert.equal(m1.episodeNumber, 1);
  assert.equal(m1.quality, '720p');
  assert.equal(m1.isHindiDubbed, true);
  assert.equal(m1.groupKey, 'sololeveling-s1-e1');

  const caption2 = caption1.replace('01', '02');
  const m2 = parseTelegramMovieMeta('2', caption2, 1280, 720, 1420);
  assert.equal(m2.cleanTitle, 'Solo Leveling');
  assert.equal(m2.seasonNumber, 1);
  assert.equal(m2.episodeNumber, 2);
  assert.equal(m2.groupKey, 'sololeveling-s1-e2');

  const caption8 = caption1.replace('01', '08');
  const m8 = parseTelegramMovieMeta(
    "•_Title'_Solo_Leveling_•_Episode,_08_•_Audio_track,_Hindi_Dub_|",
    caption8,
    1280,
    720,
    1420
  );
  assert.equal(m8.cleanTitle, 'Solo Leveling');
  assert.equal(m8.seasonNumber, 1);
  assert.equal(m8.episodeNumber, 8);
  assert.equal(m8.groupKey, 'sololeveling-s1-e8');
});

test('parses Solo Leveling Season 2 Session/Episodes captions overriding reused S1E06 filename tags', () => {
  const s2CaptionEp1 = [
    'Solo Leveling | Session 2',
    '───────────────────',
    '‣ Episodes: 01',
    '‣ Language: [Hindi #Official]',
    '‣ Quality: 720p',
    '───────────────────',
    '📡 Channel:',
    '[ @ ]',
  ].join('\n');

  const s2e1 = parseTelegramMovieMeta(
    '[S1E01] Solo Leveling [720p] [Hindi-Eng-Jap] @Animes_Ocean.mp4',
    s2CaptionEp1,
    1280,
    720,
    1420
  );
  assert.equal(s2e1.cleanTitle, 'Solo Leveling');
  assert.equal(s2e1.isSeriesEpisode, true);
  assert.equal(s2e1.seasonNumber, 2);
  assert.equal(s2e1.episodeNumber, 1);
  assert.equal(s2e1.quality, '720p');
  assert.equal(s2e1.groupKey, 'sololeveling-s2-e1');

  const s2CaptionEp7 = s2CaptionEp1.replace('01', '07');
  const s2e7 = parseTelegramMovieMeta(
    '[S1E06] Solo Leveling [720p] [Hindi-Eng-Jap] @Animes_Ocean.mp4',
    s2CaptionEp7,
    1280,
    720,
    1420
  );
  assert.equal(s2e7.cleanTitle, 'Solo Leveling');
  assert.equal(s2e7.isSeriesEpisode, true);
  assert.equal(s2e7.seasonNumber, 2);
  assert.equal(s2e7.episodeNumber, 7);
  assert.equal(s2e7.groupKey, 'sololeveling-s2-e7');

  const s2CaptionEp13 = s2CaptionEp1.replace('01', '13');
  const s2e13 = parseTelegramMovieMeta(
    'Solo Leveling S02E13 [Hindi]_720p .mkv',
    s2CaptionEp13,
    1280,
    720,
    1420
  );
  assert.equal(s2e13.cleanTitle, 'Solo Leveling');
  assert.equal(s2e13.seasonNumber, 2);
  assert.equal(s2e13.episodeNumber, 13);
  assert.equal(s2e13.groupKey, 'sololeveling-s2-e13');
});

test('supports multi-episode packs, standard series filenames, and keeps standalone Session 9 movie as movie', () => {
  const multiEp = parseTelegramMovieMeta(
    'Blade.Runner.2099.2026.S01.E01-04.1080p.Hindi.WEB-DL.mkv',
    '',
    1920,
    1080
  );
  assert.equal(multiEp.cleanTitle, 'Blade Runner 2099');
  assert.equal(multiEp.year, 2026);
  assert.equal(multiEp.isSeriesEpisode, true);
  assert.equal(multiEp.seasonNumber, 1);
  assert.equal(multiEp.episodeNumber, 1);
  assert.equal(multiEp.episodeLabel, '1-4');

  const dhindora = parseTelegramMovieMeta(
    'Dhindora_S01E03_1080p_Hindi.mp4',
    '',
    1920,
    1080
  );
  assert.equal(dhindora.cleanTitle, 'Dhindora');
  assert.equal(dhindora.isSeriesEpisode, true);
  assert.equal(dhindora.seasonNumber, 1);
  assert.equal(dhindora.episodeNumber, 3);

  const session9Movie = parseTelegramMovieMeta(
    'Session.9.2001.1080p.BluRay.x264.mkv',
    'Session 9 (2001)',
    1920,
    1080,
    6000
  );
  assert.equal(session9Movie.cleanTitle, 'Session 9');
  assert.equal(session9Movie.year, 2001);
  assert.equal(session9Movie.isSeriesEpisode, false);
  assert.equal(session9Movie.seasonNumber, null);
  assert.equal(session9Movie.episodeNumber, null);
});

test('strips leading ripper/channel prefixes such as TheMoviesBoss from movie filenames', () => {
  const taqdeer = parseTelegramMovieMeta(
    'TheMoviesBoss_Taqdeerwala_1995_480p_AMZN_WEB_DL_Hindi_AAC2_0_H_264.mkv',
    '',
    640,
    480,
    9594
  );
  assert.equal(taqdeer.cleanTitle, 'Taqdeerwala');
  assert.equal(taqdeer.year, 1995);
  assert.equal(taqdeer.isSeriesEpisode, false);
});

test('strips channel, bot, and site prefixes cleanly and detects TSRip/TELESYNC Holl Prints', async () => {
  const { isHollywoodPrintText, getQualityUpgradeDecision } = await import('../utils/qualityBadge.ts');
  const { isSeriesComplete } = await import('../utils/seriesCompleteness.ts');

  const aadu = parseTelegramMovieMeta(
    'Join Us [@BoBFiles] -Aadu 3 2026 Malayalam TSRip 1080p.mkv',
    'Join Us [@BoBFiles] -Aadu 3 2026 Malayalam TSRip',
    1920,
    1080
  );
  assert.equal(aadu.cleanTitle, 'Aadu 3');
  assert.equal(aadu.year, 2026);
  assert.equal(aadu.isHollywoodPrint, true);

  const dhurandhar = parseTelegramMovieMeta(
    '[TG ~ @CineHub_Media] Dhurandhar The Revenge (2026) Tamil 1080p HDRip.mkv',
    '[TG ~ @CineHub_Media] Dhurandhar The Revenge 2026',
    1920,
    1080
  );
  assert.equal(dhurandhar.cleanTitle, 'Dhurandhar The Revenge');
  assert.equal(dhurandhar.year, 2026);
  assert.equal(dhurandhar.isHollywoodPrint, false);

  const vishnu = parseTelegramMovieMeta(
    '[@DM_Entertainment] Vishnu Vinyasam (2026) Telugu 720p WEB-DL.mkv',
    '',
    1280,
    720
  );
  assert.equal(vishnu.cleanTitle, 'Vishnu Vinyasam');
  assert.equal(vishnu.year, 2026);

  const quiet2 = parseTelegramMovieMeta(
    '@MoviesClubXyz1_A_Quiet_Place_Part_2_2021_1080p_BluRay.mkv',
    '',
    1920,
    1080
  );
  assert.equal(quiet2.cleanTitle, 'A Quiet Place Part 2');
  assert.equal(quiet2.year, 2021);

  const ishqan = parseTelegramMovieMeta(
    '7HitMovies.lifestyle - Ishqan De Lekhe 2026 Punjabi 720p WEB-DL.mkv',
    '',
    1280,
    720
  );
  assert.equal(ishqan.cleanTitle, 'Ishqan De Lekhe');
  assert.equal(ishqan.year, 2026);

  assert.equal(isHollywoodPrintText('Love.Mocktail.3.2026.720p.TSRip.mkv'), true);
  assert.equal(isHollywoodPrintText('Hoppers.2026.1080p.TELESYNC.V2.mkv'), true);
  assert.equal(
    getQualityUpgradeDecision({ qualityBadge: 'HD', sourceFileName: 'Love.Mocktail.3.2026.720p.TSRip.mkv' }, 'HD'),
    'replace_holl_print_with_hd'
  );
  assert.equal(
    getQualityUpgradeDecision({ qualityBadge: 'HD', sourceFileName: 'Dhurandhar.2026.720p.WEB-DL.mkv' }, 'HDTC'),
    'skip_holl_print_on_hd'
  );

  const cross = parseTelegramMovieMeta('Cross_2026_S02_E01_04_COMBiNED_720p.mkv', '', 1280, 720);
  assert.equal(cross.isSeriesEpisode, true);
  assert.equal(cross.seasonNumber, 2);
  assert.equal(cross.episodeNumber, 1);
  assert.equal(cross.episodeLabel, '1-4');

  const furies = parseTelegramMovieMeta('Furies (2024) 720p HEVC HDRip S01 Complete.mkv', '', 1280, 720);
  assert.equal(furies.isSeriesEpisode, true);
  assert.equal(furies.seasonNumber, 1);
  assert.equal(furies.episodeLabel, 'Complete');

  assert.equal(
    isSeriesComplete({
      originalCategory: 'Web Series',
      seasons: [{ seasonNumber: 1, episodes: [{ episodeNumber: 1, episodeLabel: 'Complete', title: 'Complete Season', streamUrl: 'https://t.me/c/4451036277/3849' }] }],
    }, { 1: 8 }),
    true
  );
});

test('handles EP(01-16), Epi_05_08, S01E0 truncation, and series episode overlap reconciliation', async () => {
  const { reconcileSeasonEpisodes, mergeEpisodeIntoSeasons, normalizeSeriesSeasons } = await import(
    '../utils/seriesCompleteness.ts'
  );

  // S01E0 truncated filename must never yield Episode 0
  const taskareeTruncated = parseTelegramMovieMeta(
    'www.1TamilMV.DO - Taskaree - The Smugglers Web S01E0.mkv',
    'Taskaree (2026)',
    1280,
    720,
    2400
  );
  assert.equal(taskareeTruncated.isSeriesEpisode, true);
  assert.equal(taskareeTruncated.seasonNumber, 1);
  assert.equal(taskareeTruncated.episodeNumber, null);
  assert.equal(taskareeTruncated.episodeTitle, '');

  // Parenthesized EP(01-16) and underscore Epi_05_08
  const doomCombined = parseTelegramMovieMeta(
    'Doom at Your Service (2021) S01 EP(01-16) Hindi 720p.mkv',
    '',
    1280,
    720,
    59801
  );
  assert.equal(doomCombined.isSeriesEpisode, true);
  assert.equal(doomCombined.seasonNumber, 1);
  assert.equal(doomCombined.episodeNumber, 1);
  assert.equal(doomCombined.episodeLabel, '1-16');

  const loveEpi = parseTelegramMovieMeta(
    'Love_Always_S01_Epi_05_08_720p.mkv',
    '',
    1280,
    720
  );
  assert.equal(loveEpi.isSeriesEpisode, true);
  assert.equal(loveEpi.seasonNumber, 1);
  assert.equal(loveEpi.episodeNumber, 5);
  assert.equal(loveEpi.episodeLabel, '5-8');

  // Reconcile Where the Mask Ends (mixed 540p 1-10/11-20/21-30 vs 720p 1-8/9-16/17-23/24-30)
  const maskEps = [
    { episodeNumber: 1, episodeLabel: '1-10', title: 'Episodes 1-10', streamUrl: 'https://t.me/c/4451036277/3271', durationSec: 30861, quality: '540p' },
    { episodeNumber: 9, episodeLabel: '9-16', title: 'Episodes 9-16', streamUrl: 'https://t.me/c/4451036277/3275', durationSec: 24720, quality: '720p' },
    { episodeNumber: 11, episodeLabel: '11-20', title: 'Episodes 11-20', streamUrl: 'https://t.me/c/4451036277/3272', durationSec: 30992, quality: '540p' },
    { episodeNumber: 17, episodeLabel: '17-23', title: 'Episodes 17-23', streamUrl: 'https://t.me/c/4451036277/3276', durationSec: 21540, quality: '720p' },
    { episodeNumber: 21, episodeLabel: '21-30', title: 'Episodes 21-30', streamUrl: 'https://t.me/c/4451036277/3273', durationSec: 28620, quality: '540p' },
    { episodeNumber: 24, episodeLabel: '24-30', title: 'Episodes 24-30', streamUrl: 'https://t.me/c/4451036277/3277', durationSec: 19440, quality: '720p' },
    { episodeNumber: 1, episodeLabel: '1-8', title: 'Episodes 1-8', streamUrl: 'https://t.me/c/4451036277/3274', durationSec: 24700, quality: '720p' },
  ];
  const reconciledMask = reconcileSeasonEpisodes(maskEps);
  assert.deepEqual(
    reconciledMask.map((e: any) => e.episodeLabel),
    ['1-8', '9-16', '17-23', '24-30']
  );

  // Duration-outlier Complete disguised as Ep 1 alongside real singles
  const doomSeries = normalizeSeriesSeasons({
    id: 'tg_series_4451036277_3949',
    originalCategory: 'Web Series',
    streamingUrl: 'https://t.me/c/4451036277/3949',
    seasons: [
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, title: 'Episode 1', streamUrl: 'https://t.me/c/4451036277/3949', durationSec: 59801 },
          { episodeNumber: 1, title: 'Episode 1', streamUrl: 'https://t.me/c/4451036277/3965', durationSec: 3675 },
          { episodeNumber: 2, title: 'Episode 2', streamUrl: 'https://t.me/c/4451036277/3962', durationSec: 3680 },
          { episodeNumber: 3, title: 'Episode 3', streamUrl: 'https://t.me/c/4451036277/3961', durationSec: 3710 },
        ],
      },
    ],
  });
  assert.deepEqual(
    doomSeries.seasons[0].episodes.map((e: any) => e.streamUrl),
    [
      'https://t.me/c/4451036277/3965',
      'https://t.me/c/4451036277/3962',
      'https://t.me/c/4451036277/3961',
    ]
  );
  assert.equal(doomSeries.streamingUrl, 'https://t.me/c/4451036277/3965');

  // Boundary touch typo on multi-episode packs (Halo: Nightfall 51-65 + 65-80) must be preserved
  const halo = reconcileSeasonEpisodes([
    { episodeNumber: 51, episodeLabel: '51-65', title: 'Episodes 51-65', streamUrl: 'https://t.me/c/1/51', durationSec: 9000 },
    { episodeNumber: 65, episodeLabel: '65-80', title: 'Episodes 65-80', streamUrl: 'https://t.me/c/1/65', durationSec: 9200 },
    { episodeNumber: 81, episodeLabel: '81-95', title: 'Episodes 81-95', streamUrl: 'https://t.me/c/1/81', durationSec: 9100 },
  ]);
  assert.deepEqual(
    halo.map((e: any) => e.episodeLabel),
    ['51-65', '65-80', '81-95']
  );

  // mergeEpisodeIntoSeasons refuses Complete pack over existing specific episodes
  const mergedSkipComplete = mergeEpisodeIntoSeasons(
    [
      {
        seasonNumber: 1,
        episodes: [
          { episodeNumber: 1, title: 'Episode 1', streamUrl: 'https://t.me/c/1/1' },
          { episodeNumber: 2, title: 'Episode 2', streamUrl: 'https://t.me/c/1/2' },
        ],
      },
    ],
    1,
    {
      episodeNumber: 1,
      episodeLabel: 'Complete',
      title: 'Complete Season',
      streamUrl: 'https://t.me/c/1/999',
    }
  );
  assert.equal(mergedSkipComplete.added, false);
  assert.equal(mergedSkipComplete.mergedSeasons[0].episodes.length, 2);
});
