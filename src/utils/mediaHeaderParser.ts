export interface LocalHeaderProbeResult {
  container: 'mp4' | 'matroska' | 'webm' | 'avi' | 'mpegts' | 'unknown';
  videoCodec: string;
  audioCodec: string;
  is10Bit: boolean;
  durationSec: number;
  durationExact?: boolean;
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

export function parseMp4Header(buf: Uint8Array): Partial<LocalHeaderProbeResult> {
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
    const hvccIdx = containsBytes(buf, 'hvcC');
    if (hvccIdx >= 0 && hvccIdx + 24 < buf.length) {
      const pStart = hvccIdx + 4;
      const profileIdc = buf[pStart + 1] & 0x1f;
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

  // Try parsing mvhd box duration (search valid mvhd box with reasonable version & timescale)
  const mvhdIdx = containsBytes(buf, 'mvhd');
  if (mvhdIdx >= 4 && mvhdIdx + 28 < buf.length) {
    const version = buf[mvhdIdx + 4];
    if (version === 0 && mvhdIdx + 24 <= buf.length) {
      const timescale = readUint32BE(buf, mvhdIdx + 16);
      const durUnits = readUint32BE(buf, mvhdIdx + 20);
      if (timescale > 0 && durUnits > 0) {
        const sec = Math.round(durUnits / timescale);
        if (sec > 0 && sec < 86400) {
          out.durationSec = sec;
          out.durationExact = true;
        }
      }
    } else if (version === 1 && mvhdIdx + 36 <= buf.length) {
      const timescale = readUint32BE(buf, mvhdIdx + 24);
      const durUnits = readUint64BE(buf, mvhdIdx + 28);
      if (timescale > 0 && durUnits > 0) {
        const sec = Math.round(durUnits / timescale);
        if (sec > 0 && sec < 86400) {
          out.durationSec = sec;
          out.durationExact = true;
        }
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

function readEbmlElementId(buf: Uint8Array, off: number): { id: number; len: number } {
  if (off >= buf.length) return { id: 0, len: 0 };
  const first = buf[off];
  if (first === 0) return { id: 0, len: 0 };
  let mask = 0x80;
  let len = 1;
  while (len <= 4 && (first & mask) === 0) {
    mask >>= 1;
    len++;
  }
  if (len > 4 || off + len > buf.length) return { id: 0, len: 0 };
  let id = 0;
  for (let i = 0; i < len; i++) {
    id = id * 256 + buf[off + i];
  }
  return { id, len };
}

function readEbmlVintSize(buf: Uint8Array, off: number): { size: number; len: number; unknownSize: boolean } {
  if (off >= buf.length) return { size: 0, len: 0, unknownSize: false };
  const first = buf[off];
  if (first === 0) return { size: 0, len: 0, unknownSize: false };
  let mask = 0x80;
  let len = 1;
  while (len <= 8 && (first & mask) === 0) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || off + len > buf.length) return { size: 0, len: 0, unknownSize: false };
  let size = first & ~mask;
  let allOnes = size === (mask - 1);
  for (let i = 1; i < len; i++) {
    if (buf[off + i] !== 0xff) allOnes = false;
    size = size * 256 + buf[off + i];
  }
  return { size, len, unknownSize: allOnes };
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
  } else if (containsBytes(buf, 'V_MPEG4/ISO/ASP') >= 0 || (containsBytes(buf, 'V_MS/VFW/FOURCC') >= 0 && containsBytes(buf, 'MPNG') < 0 && containsBytes(buf, 'image/png') < 0)) {
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

  // Locate Matroska Segment Info element (ID: 0x15 0x49 0xA9 0x66) and walk child elements strictly by EBML boundaries
  for (let i = 0; i <= buf.length - 12; i++) {
    if (
      buf[i] === 0x15 &&
      buf[i + 1] === 0x49 &&
      buf[i + 2] === 0xa9 &&
      buf[i + 3] === 0x66
    ) {
      const { size: infoSize, len: sizeLen, unknownSize } = readEbmlVintSize(buf, i + 4);
      if (sizeLen === 0 || (!unknownSize && (infoSize <= 0 || infoSize > 65536))) {
        continue;
      }
      const infoStart = i + 4 + sizeLen;
      const infoEnd = Math.min(buf.length, unknownSize ? infoStart + 4096 : infoStart + infoSize);

      let timecodeScaleNs = 1000000;
      let durationTicks = 0;
      let pos = infoStart;
      let steps = 0;

      while (pos < infoEnd - 2 && steps < 256) {
        steps++;
        const { id, len: idLen } = readEbmlElementId(buf, pos);
        if (idLen === 0) break;
        const { size: elemSize, len: elemSizeLen, unknownSize: elemUnknown } = readEbmlVintSize(buf, pos + idLen);
        if (elemSizeLen === 0 || elemUnknown) break;
        const valStart = pos + idLen + elemSizeLen;
        const nextPos = valStart + elemSize;
        if (nextPos > infoEnd) break;

        if (id === 0x2ad7b1 && elemSize >= 1 && elemSize <= 8) {
          // TimecodeScale
          let scale = 0;
          for (let b = 0; b < elemSize; b++) {
            scale = scale * 256 + buf[valStart + b];
          }
          if (scale > 0) timecodeScaleNs = scale;
        } else if (id === 0x4489) {
          // Duration
          if (elemSize === 4) {
            const val = readFloat32BE(buf, valStart);
            if (Number.isFinite(val) && val > 0) durationTicks = val;
          } else if (elemSize === 8) {
            const val = readFloat64BE(buf, valStart);
            if (Number.isFinite(val) && val > 0) durationTicks = val;
          }
        }
        pos = nextPos;
      }

      if (durationTicks > 0) {
        const sec = Math.round((durationTicks * timecodeScaleNs) / 1_000_000_000);
        if (sec > 0 && sec < 86400) {
          out.durationSec = sec;
          out.durationExact = true;
          break;
        }
      }
    }
  }

  return out;
}

function findMpegTsSyncStart(buf: Uint8Array, scanLimit = 752): number {
  if (!buf || buf.length < 188 * 3) return -1;
  const maxStart = Math.min(scanLimit, buf.length - 188 * 2 - 1);
  for (let i = 0; i <= maxStart; i++) {
    if (buf[i] === 0x47 && buf[i + 188] === 0x47 && buf[i + 376] === 0x47) {
      return i;
    }
  }
  return -1;
}

export function isMpegTsBytes(buf: Uint8Array): boolean {
  return findMpegTsSyncStart(buf) >= 0;
}

function readPcrFromTsPacket(buf: Uint8Array, pktOff: number): number | null {
  if (pktOff < 0 || pktOff + 188 > buf.length || buf[pktOff] !== 0x47) return null;
  const afc = (buf[pktOff + 3] >> 4) & 0x03;
  if (afc !== 2 && afc !== 3) return null;
  const afLen = buf[pktOff + 4];
  if (afLen < 7 || pktOff + 12 > buf.length) return null;
  const flags = buf[pktOff + 5];
  if ((flags & 0x10) === 0) return null; // PCR_flag

  const base33 =
    buf[pktOff + 6] * 33554432 +
    buf[pktOff + 7] * 131072 +
    buf[pktOff + 8] * 512 +
    buf[pktOff + 9] * 2 +
    ((buf[pktOff + 10] >> 7) & 1);
  return base33 / 90000;
}

export function extractMpegTsPcrSec(buf: Uint8Array, fromEnd: boolean): number | null {
  if (!buf || buf.length < 188 * 3) return null;

  if (!fromEnd) {
    const start = findMpegTsSyncStart(buf, 1024);
    if (start < 0) return null;
    for (let off = start; off + 188 <= buf.length; off += 188) {
      const pcr = readPcrFromTsPacket(buf, off);
      if (pcr !== null) return pcr;
    }
    return null;
  }

  // Scan backwards for packet sync alignment near the end of tail buffer
  const minScan = Math.max(0, buf.length - 188 * 4 - 64);
  let tailAlignEnd = -1;
  for (let i = buf.length - 188; i >= minScan; i--) {
    if (
      i >= 376 &&
      buf[i] === 0x47 &&
      buf[i - 188] === 0x47 &&
      buf[i - 376] === 0x47
    ) {
      tailAlignEnd = i;
      break;
    }
  }
  if (tailAlignEnd < 0) {
    // Fallback align from buffer start
    const headAlign = findMpegTsSyncStart(buf, 752);
    if (headAlign < 0) return null;
    const totalPkts = Math.floor((buf.length - headAlign) / 188);
    tailAlignEnd = headAlign + Math.max(0, totalPkts - 1) * 188;
  }

  for (let off = tailAlignEnd; off >= 0; off -= 188) {
    if (buf[off] !== 0x47) continue;
    const pcr = readPcrFromTsPacket(buf, off);
    if (pcr !== null) return pcr;
  }
  return null;
}

export function computeMpegTsDurationSec(headBuf: Uint8Array, tailBuf: Uint8Array): number {
  const firstPcr = extractMpegTsPcrSec(headBuf, false);
  const lastPcr = extractMpegTsPcrSec(tailBuf, true);
  if (firstPcr === null || lastPcr === null) return 0;

  let diff = lastPcr - firstPcr;
  if (diff < 0) {
    // Handle 33-bit PCR wrap-around (~26.5 hours)
    diff += 8589934592 / 90000;
  }
  const rounded = Math.round(diff);
  if (rounded >= 2 && rounded < 43200) {
    return rounded;
  }
  return 0;
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
    } else if (isMpegTsBytes(headerBytes)) {
      parsed = { container: 'mpegts', videoCodec: 'h264', audioCodec: 'aac' };
    } else if (ftyp === 'ftyp' || containsBytes(headerBytes, 'moov') >= 0 || containsBytes(headerBytes, 'trak') >= 0) {
      parsed = parseMp4Header(headerBytes);
    } else if (isRiff) {
      parsed = { container: 'avi', videoCodec: 'mpeg4' };
    }
  }

  const container: LocalHeaderProbeResult['container'] =
    parsed.container ||
    (lowerName.endsWith('.ts') || lowerName.endsWith('.m2ts') || lowerMime.includes('mp2t')
      ? 'mpegts'
      : lowerName.endsWith('.webm') || lowerMime.includes('webm')
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
  const durationExact = Boolean(parsed.durationExact && parsed.durationSec && parsed.durationSec > 0);
  const durationSec = parsed.durationSec && parsed.durationSec > 0 ? parsed.durationSec : fallbackDurationSec;

  return {
    container,
    videoCodec,
    audioCodec,
    is10Bit,
    durationSec,
    durationExact,
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
