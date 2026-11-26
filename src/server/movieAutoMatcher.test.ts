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
