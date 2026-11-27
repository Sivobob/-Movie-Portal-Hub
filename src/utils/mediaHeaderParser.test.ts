import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasCompleteMediaTrackHeaders,
  inspectMediaHeaderBytes,
} from './mediaHeaderParser.ts';

function buildBytes(...parts: Array<number[] | Uint8Array | string>): Uint8Array {
  const arrays: Uint8Array[] = parts.map((p) => {
    if (typeof p === 'string') {
      return Uint8Array.from(Array.from(p, (c) => c.charCodeAt(0)));
    }
    return p instanceof Uint8Array ? p : Uint8Array.from(p);
  });
  const total = arrays.reduce((acc, a) => acc + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

test('hasCompleteMediaTrackHeaders returns false when EBML lacks Tracks due to font attachments', () => {
  const incompleteMkv = buildBytes(
    [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01],
    'matroska',
    new Uint8Array(256)
  );
  assert.equal(hasCompleteMediaTrackHeaders(incompleteMkv), false);
});

test('parseEbmlHeader detects 10-bit HEVC via BitsPerChannel (0x55 0xB2) inside Tracks', () => {
  const tracksPayload = buildBytes(
    'V_MPEGH/ISO/HEVC',
    [0x55, 0xb2, 0x81, 0x0a], // BitsPerChannel = 10
    'A_EAC3'
  );
  // Tracks element ID 0x16 0x54 0xAE 0x6B + VINT length (0x80 | len)
  const tracksEl = buildBytes(
    [0x16, 0x54, 0xae, 0x6b, 0x80 | tracksPayload.length],
    tracksPayload
  );
  const mkv = buildBytes(
    [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01],
    'matroska',
    tracksEl
  );

  assert.equal(hasCompleteMediaTrackHeaders(mkv), true);
  const probe = inspectMediaHeaderBytes(mkv, 'Mushoku.Tensei.S02E01.mkv');
  assert.equal(probe.container, 'matroska');
  assert.equal(probe.videoCodec, 'hevc');
  assert.equal(probe.audioCodec, 'eac3');
  assert.equal(probe.is10Bit, true);
  assert.equal(probe.isHi10P, false);
  assert.equal(probe.hasUnsupportedAudio, true);
});

test('parseEbmlHeader detects H.264 Hi10P via CodecPrivate (avcC profile_idc=110)', () => {
  // AVCDecoderConfigurationRecord starting with version=1, profile_idc=110 (High 10)
  const avccPrivate = [0x01, 110, 0x00, 0x28, 0xff, 0xe1];
  const tracksPayload = buildBytes(
    'V_MPEG4/ISO/AVC',
    [0x63, 0xa2, 0x80 | avccPrivate.length],
    avccPrivate,
    'A_AAC'
  );
  const tracksEl = buildBytes(
    [0x16, 0x54, 0xae, 0x6b, 0x80 | tracksPayload.length],
    tracksPayload
  );
  const mkv = buildBytes(
    [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01],
    'matroska',
    tracksEl
  );

  const probe = inspectMediaHeaderBytes(mkv, 'Episode01.mkv');
  assert.equal(probe.videoCodec, 'h264');
  assert.equal(probe.is10Bit, true);
  assert.equal(probe.isHi10P, true);
});

test('parseMp4Header detects tail moov + hvcC Main10 + mvhd duration', () => {
  const ftypHead = buildBytes([0x00, 0x00, 0x00, 0x18], 'ftyp', 'isom', new Uint8Array(32));
  assert.equal(hasCompleteMediaTrackHeaders(ftypHead), false);

  // Build synthetic hvcC box with general_profile_idc = 2 (Main 10) and bitDepthLumaMinus8 = 2 (10-bit)
  const hvccPayload = new Uint8Array(23);
  hvccPayload[0] = 1;
  hvccPayload[1] = 2; // Main 10
  hvccPayload[17] = 2; // 8 + 2 = 10-bit

  // mvhd v0 with timescale=1000, duration=1440000 (1440s)
  const mvhd = new Uint8Array(24);
  mvhd.set([0x6d, 0x76, 0x68, 0x64], 0); // 'mvhd'
  mvhd[4] = 0; // version 0
  // timescale = 1000 (0x000003E8) at offset 16
  mvhd[16] = 0; mvhd[17] = 0; mvhd[18] = 0x03; mvhd[19] = 0xe8;
  // duration = 1440000 (0x0015F900) at offset 20
  mvhd[20] = 0x00; mvhd[21] = 0x15; mvhd[22] = 0xf9; mvhd[23] = 0x00;

  const combined = buildBytes(
    ftypHead,
    'moov',
    'trak',
    mvhd,
    'hev1',
    'hvcC',
    hvccPayload,
    'mp4a'
  );

  assert.equal(hasCompleteMediaTrackHeaders(combined), true);
  const probe = inspectMediaHeaderBytes(combined, 'Series.S01E05.mp4');
  assert.equal(probe.container, 'mp4');
  assert.equal(probe.videoCodec, 'hevc');
  assert.equal(probe.audioCodec, 'aac');
  assert.equal(probe.is10Bit, true);
  assert.equal(probe.durationSec, 1440);
});
