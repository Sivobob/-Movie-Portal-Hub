export interface LocalHeaderProbeResult {
  container: 'mp4' | 'matroska' | 'webm' | 'avi' | 'unknown';
  videoCodec: string;
  audioCodec: string;
  is10Bit: boolean;
  durationSec: number;
  width: number;
  height: number;
  hasUnsupportedAudio: boolean;
}

function readUint32BE(buf: Uint8Array, off: number): number {
  if (off + 4 > buf.length) return 0;
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function readUint64BE(buf: Uint8Array, off: number): number {
  if (off + 8 > buf.length) return 0;
  const hi = readUint32BE(buf, off);
  const lo = readUint32BE(buf, off + 4);
  return hi * 4294967296 + lo;
}

function readAscii(buf: Uint8Array, off: number, len: number): string {
  if (off < 0 || off + len > buf.length) return '';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += String.fromCharCode(buf[i + off]);
  }
  return out;
}

function containsBytes(buf: Uint8Array, needle: string): number {
  if (!needle || buf.length < needle.length) return -1;
  const nLen = needle.length;
  const first = needle.charCodeAt(0);
  outer: for (let i = 0; i <= buf.length - nLen; i++) {
    if (buf[i] !== first) continue;
    for (let j = 1; j < nLen; j++) {
      if (buf[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

function parseMp4Header(buf: Uint8Array): Partial<LocalHeaderProbeResult> {
  const out: Partial<LocalHeaderProbeResult> = {
    container: 'mp4',
  };

  // Detect video codec atoms
  const hasHvc1 = containsBytes(buf, 'hvc1');
  const hasHev1 = containsBytes(buf, 'hev1');
  const hasAvc1 = containsBytes(buf, 'avc1');
  const hasAvc3 = containsBytes(buf, 'avc3');
  const hasAv01 = containsBytes(buf, 'av01');
  const hasVp09 = containsBytes(buf, 'vp09');
  const hasVp08 = containsBytes(buf, 'vp08');
  const hasMp4v = containsBytes(buf, 'mp4v');

  if (hasHvc1 >= 0 || hasHev1 >= 0) {
    out.videoCodec = 'hevc';
    // Inspect hvcC box if present to read exact general_profile_idc & bitDepthLumaMinus8
    const hvccIdx = containsBytes(buf, 'hvcC');
    if (hvccIdx >= 0 && hvccIdx + 24 < buf.length) {
      // hvcC payload starts at hvccIdx + 4:
      // byte 0: configurationVersion (1)
      // byte 1: general_profile_space(2) | general_tier_flag(1) | general_profile_idc(5)
      const pStart = hvccIdx + 4;
      const profileIdc = buf[pStart + 1] & 0x1f;
      // byte 17: bitDepthLumaMinus8 in lower 3 bits
      const bitDepthLumaMinus8 = buf[pStart + 17] & 0x07;
      if (profileIdc === 2 || profileIdc === 4 || bitDepthLumaMinus8 >= 2) {
        out.is10Bit = true;
      }
    }
  } else if (hasAvc1 >= 0 || hasAvc3 >= 0) {
    out.videoCodec = 'h264';
    const avccIdx = containsBytes(buf, 'avcC');
    if (avccIdx >= 0 && avccIdx + 8 < buf.length) {
      const profileIdc = buf[avccIdx + 5];
      if (profileIdc === 110 || profileIdc === 122 || profileIdc === 244) {
        out.is10Bit = true;
      }
    }
  } else if (hasAv01 >= 0) {
    out.videoCodec = 'av1';
    const av1cIdx = containsBytes(buf, 'av1C');
    if (av1cIdx >= 0 && av1cIdx + 6 < buf.length) {
      const flags = buf[av1cIdx + 5];
      if ((flags & 0x40) !== 0) {
        out.is10Bit = true;
      }
    }
  } else if (hasVp09 >= 0) {
    out.videoCodec = 'vp9';
  } else if (hasVp08 >= 0) {
    out.videoCodec = 'vp8';
  } else if (hasMp4v >= 0) {
    out.videoCodec = 'mpeg4';
  }

  // Detect audio codec atoms
  if (containsBytes(buf, 'mp4a') >= 0) {
    out.audioCodec = 'aac';
  } else if (containsBytes(buf, 'ec-3') >= 0) {
    out.audioCodec = 'eac3';
    out.hasUnsupportedAudio = true;
  } else if (containsBytes(buf, 'ac-3') >= 0) {
    out.audioCodec = 'ac3';
    out.hasUnsupportedAudio = true;
  } else if (containsBytes(buf, 'dtsc') >= 0 || containsBytes(buf, 'dtsh') >= 0 || containsBytes(buf, 'dtse') >= 0) {
    out.audioCodec = 'dts';
    out.hasUnsupportedAudio = true;
  } else if (containsBytes(buf, 'Opus') >= 0) {
    out.audioCodec = 'opus';
  } else if (containsBytes(buf, 'fLaC') >= 0) {
    out.audioCodec = 'flac';
  } else if (containsBytes(buf, '.mp3') >= 0) {
    out.audioCodec = 'mp3';
  }

  // Try parsing mvhd box duration
  const mvhdIdx = containsBytes(buf, 'mvhd');
  if (mvhdIdx >= 4 && mvhdIdx + 28 < buf.length) {
    const version = buf[mvhdIdx + 4];
    if (version === 0 && mvhdIdx + 24 <= buf.length) {
      const timescale = readUint32BE(buf, mvhdIdx + 16);
      const durUnits = readUint32BE(buf, mvhdIdx + 20);
      if (timescale > 0 && durUnits > 0) {
        out.durationSec = Math.round(durUnits / timescale);
      }
    } else if (version === 1 && mvhdIdx + 36 <= buf.length) {
      const timescale = readUint32BE(buf, mvhdIdx + 24);
      const durUnits = readUint64BE(buf, mvhdIdx + 28);
      if (timescale > 0 && durUnits > 0) {
        out.durationSec = Math.round(durUnits / timescale);
      }
    }
  }

  return out;
}

function readFloat32BE(buf: Uint8Array, off: number): number {
  if (off + 4 > buf.length) return 0;
  const view = new DataView(buf.buffer, buf.byteOffset + off, 4);
  return view.getFloat32(0, false);
}

function readFloat64BE(buf: Uint8Array, off: number): number {
  if (off + 8 > buf.length) return 0;
  const view = new DataView(buf.buffer, buf.byteOffset + off, 8);
  return view.getFloat64(0, false);
}

function readEbmlVintSize(buf: Uint8Array, off: number): { size: number; len: number } {
  if (off >= buf.length) return { size: 0, len: 0 };
  const first = buf[off];
  if (first === 0) return { size: 0, len: 0 };
  let mask = 0x80;
  let len = 1;
  while (len <= 8 && (first & mask) === 0) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || off + len > buf.length) return { size: 0, len: 0 };
  let size = first & ~mask;
  for (let i = 1; i < len; i++) {
    size = size * 256 + buf[off + i];
  }
  return { size, len };
}

function parseEbmlHeader(buf: Uint8Array): Partial<LocalHeaderProbeResult> {
  const isWebm = containsBytes(buf, 'webm') >= 0;
  const out: Partial<LocalHeaderProbeResult> = {
    container: isWebm ? 'webm' : 'matroska',
  };

  if (containsBytes(buf, 'V_MPEGH/ISO/HEVC') >= 0) {
    out.videoCodec = 'hevc';
  } else if (containsBytes(buf, 'V_MPEG4/ISO/AVC') >= 0) {
    out.videoCodec = 'h264';
  } else if (containsBytes(buf, 'V_AV1') >= 0) {
    out.videoCodec = 'av1';
  } else if (containsBytes(buf, 'V_VP9') >= 0) {
    out.videoCodec = 'vp9';
  } else if (containsBytes(buf, 'V_VP8') >= 0) {
    out.videoCodec = 'vp8';
  } else if (containsBytes(buf, 'V_MPEG4/ISO/ASP') >= 0 || containsBytes(buf, 'V_MS/VFW/FOURCC') >= 0) {
    out.videoCodec = 'mpeg4';
  }

  if (containsBytes(buf, 'A_AAC') >= 0) {
    out.audioCodec = 'aac';
  } else if (containsBytes(buf, 'A_EAC3') >= 0) {
    out.audioCodec = 'eac3';
    out.hasUnsupportedAudio = true;
  } else if (containsBytes(buf, 'A_AC3') >= 0) {
    out.audioCodec = 'ac3';
    out.hasUnsupportedAudio = true;
  } else if (containsBytes(buf, 'A_DTS') >= 0) {
    out.audioCodec = 'dts';
    out.hasUnsupportedAudio = true;
  } else if (containsBytes(buf, 'A_TRUEHD') >= 0) {
    out.audioCodec = 'truehd';
    out.hasUnsupportedAudio = true;
  } else if (containsBytes(buf, 'A_OPUS') >= 0) {
    out.audioCodec = 'opus';
  } else if (containsBytes(buf, 'A_VORBIS') >= 0) {
    out.audioCodec = 'vorbis';
  } else if (containsBytes(buf, 'A_MPEG/L3') >= 0) {
    out.audioCodec = 'mp3';
  } else if (containsBytes(buf, 'A_FLAC') >= 0) {
    out.audioCodec = 'flac';
  }

  // Locate Matroska Segment Info element (ID: 0x15 0x49 0xA9 0x66) to extract TimecodeScale & Duration
  for (let i = 0; i <= buf.length - 12; i++) {
    if (
      buf[i] === 0x15 &&
      buf[i + 1] === 0x49 &&
      buf[i + 2] === 0xa9 &&
      buf[i + 3] === 0x66
    ) {
      const { size: infoSize, len: sizeLen } = readEbmlVintSize(buf, i + 4);
      const infoStart = i + 4 + sizeLen;
      const infoEnd = Math.min(buf.length, infoSize > 0 && infoSize < 65536 ? infoStart + infoSize : infoStart + 4096);

      let timecodeScaleNs = 1000000;
      let durationTicks = 0;

      for (let j = infoStart; j <= infoEnd - 6; j++) {
        // TimecodeScale (0x2A 0xD7 0xB1)
        if (buf[j] === 0x2a && buf[j + 1] === 0xd7 && buf[j + 2] === 0xb1) {
          const { size: dLen, len: vLen } = readEbmlVintSize(buf, j + 3);
          const valStart = j + 3 + vLen;
          if (dLen >= 1 && dLen <= 8 && valStart + dLen <= infoEnd) {
            let scale = 0;
            for (let b = 0; b < dLen; b++) {
              scale = scale * 256 + buf[valStart + b];
            }
            if (scale > 0) timecodeScaleNs = scale;
          }
        }
        // Duration (0x44 0x89)
        if (buf[j] === 0x44 && buf[j + 1] === 0x89) {
          const { size: dLen, len: vLen } = readEbmlVintSize(buf, j + 2);
          const valStart = j + 2 + vLen;
          if (dLen === 4 && valStart + 4 <= infoEnd) {
            const val = readFloat32BE(buf, valStart);
            if (Number.isFinite(val) && val > 0) durationTicks = val;
          } else if (dLen === 8 && valStart + 8 <= infoEnd) {
            const val = readFloat64BE(buf, valStart);
            if (Number.isFinite(val) && val > 0) durationTicks = val;
          }
        }
      }

      if (durationTicks > 0) {
        const sec = Math.round((durationTicks * timecodeScaleNs) / 1_000_000_000);
        if (sec > 0 && sec < 86400) {
          out.durationSec = sec;
          break;
        }
      }
    }
  }

  return out;
}

export function inspectMediaHeaderBytes(
  headerBytes: Uint8Array,
  fileName: string = '',
  rawMime: string = '',
  fallbackDurationSec: number = 0,
  fallbackWidth: number = 0,
  fallbackHeight: number = 0
): LocalHeaderProbeResult {
  const lowerName = fileName.toLowerCase();
  const lowerMime = rawMime.toLowerCase();
  const riskyName10Bit = /(^|[^a-z0-9])(10bit|10-bit|hi10p|main10)([^a-z0-9]|$)/i.test(lowerName);
  const riskyNameHevc = /(^|[^a-z0-9])(hevc|x265|h\.?265)([^a-z0-9]|$)/i.test(lowerName);
  const riskyNameAv1 = /(^|[^a-z0-9])(av1)([^a-z0-9]|$)/i.test(lowerName);

  let parsed: Partial<LocalHeaderProbeResult> = {};

  if (headerBytes && headerBytes.length >= 12) {
    const isEbml =
      headerBytes[0] === 0x1a &&
      headerBytes[1] === 0x45 &&
      headerBytes[2] === 0xdf &&
      headerBytes[3] === 0xa3;
    const ftyp = readAscii(headerBytes, 4, 4);
    const isRiff = readAscii(headerBytes, 0, 4) === 'RIFF';

    if (isEbml) {
      parsed = parseEbmlHeader(headerBytes);
    } else if (ftyp === 'ftyp' || containsBytes(headerBytes, 'moov') >= 0 || containsBytes(headerBytes, 'trak') >= 0) {
      parsed = parseMp4Header(headerBytes);
    } else if (isRiff) {
      parsed = { container: 'avi', videoCodec: 'mpeg4' };
    }
  }

  const container: LocalHeaderProbeResult['container'] =
    parsed.container ||
    (lowerName.endsWith('.webm') || lowerMime.includes('webm')
      ? 'webm'
      : lowerName.endsWith('.mkv') || lowerMime.includes('matroska') || lowerMime.includes('mkv')
        ? 'matroska'
        : lowerName.endsWith('.avi') || lowerMime.includes('avi')
          ? 'avi'
          : 'mp4');

  const videoCodec =
    parsed.videoCodec ||
    (riskyNameAv1 ? 'av1' : riskyNameHevc ? 'hevc' : container === 'webm' ? 'vp9' : 'h264');

  const audioCodec = parsed.audioCodec || (container === 'webm' ? 'opus' : 'aac');
  const is10Bit = Boolean(parsed.is10Bit || riskyName10Bit);
  const durationSec = parsed.durationSec && parsed.durationSec > 0 ? parsed.durationSec : fallbackDurationSec;

  return {
    container,
    videoCodec,
    audioCodec,
    is10Bit,
    durationSec,
    width: fallbackWidth,
    height: fallbackHeight,
    hasUnsupportedAudio: Boolean(
      parsed.hasUnsupportedAudio ||
      audioCodec === 'ac3' ||
      audioCodec === 'eac3' ||
      audioCodec === 'dts' ||
      audioCodec === 'truehd'
    ),
  };
}
