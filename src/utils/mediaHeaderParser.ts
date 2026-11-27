export interface LocalHeaderProbeResult {
  container: 'mp4' | 'matroska' | 'webm' | 'avi' | 'unknown';
  videoCodec: string;
  audioCodec: string;
  is10Bit: boolean;
  isHi10P?: boolean;
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

function findSequence(buf: Uint8Array, seq: number[], fromIdx = 0): number {
  if (seq.length === 0 || buf.length < seq.length) return -1;
  const first = seq[0];
  outer: for (let i = Math.max(0, fromIdx); i <= buf.length - seq.length; i++) {
    if (buf[i] !== first) continue;
    for (let j = 1; j < seq.length; j++) {
      if (buf[i + j] !== seq[j]) continue outer;
    }
    return i;
  }
  return -1;
}

export function hasCompleteMediaTrackHeaders(buf: Uint8Array): boolean {
  if (!buf || buf.length < 16) return false;
  const isEbml =
    buf[0] === 0x1a &&
    buf[1] === 0x45 &&
    buf[2] === 0xdf &&
    buf[3] === 0xa3;

  if (isEbml) {
    // EBML/Matroska Tracks element ID: 0x16 0x54 0xAE 0x6B
    const tracksIdx = findSequence(buf, [0x16, 0x54, 0xae, 0x6b]);
    if (tracksIdx < 0) return false;
    const { size: tracksSize, len: sizeLen } = readEbmlVintSize(buf, tracksIdx + 4);
    const tracksEnd = sizeLen > 0 && tracksSize > 0 && tracksSize < 32 * 1024 * 1024
      ? tracksIdx + 4 + sizeLen + tracksSize
      : -1;
    if (tracksEnd > 0 && tracksEnd <= buf.length) {
      return true;
    }
    // Fallback if Tracks size is unknown/huge: check if first Cluster started after Tracks
    const clusterIdx = findSequence(buf, [0x1f, 0x43, 0xb6, 0x75], tracksIdx + 8);
    if (clusterIdx > tracksIdx) return true;
    return false;
  }

  const ftyp = readAscii(buf, 4, 4);
  if (ftyp === 'ftyp' || containsBytes(buf, 'moov') >= 0) {
    const moovIdx = containsBytes(buf, 'moov');
    if (moovIdx < 0) return false;
    const hasTrak = containsBytes(buf, 'trak') >= 0;
    const hasCodecAtom =
      containsBytes(buf, 'hvc1') >= 0 ||
      containsBytes(buf, 'hev1') >= 0 ||
      containsBytes(buf, 'avc1') >= 0 ||
      containsBytes(buf, 'avc3') >= 0 ||
      containsBytes(buf, 'av01') >= 0 ||
      containsBytes(buf, 'vp09') >= 0 ||
      containsBytes(buf, 'mp4a') >= 0;
    return hasTrak && (hasCodecAtom || moovIdx + 64 <= buf.length);
  }

  return true;
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
        out.isHi10P = true;
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
  } else if (
    containsBytes(buf, 'V_MPEG4/ISO/ASP') >= 0 ||
    (containsBytes(buf, 'V_MS/VFW/FOURCC') >= 0 && containsBytes(buf, 'MPNG') < 0 && containsBytes(buf, 'image/png') < 0)
  ) {
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

  // Inspect Matroska Tracks element (0x16 0x54 0xAE 0x6B) for exact bit depth (BitsPerChannel / CodecPrivate)
  const tracksIdx = findSequence(buf, [0x16, 0x54, 0xae, 0x6b]);
  if (tracksIdx >= 0) {
    const { size: tracksSize, len: tSizeLen } = readEbmlVintSize(buf, tracksIdx + 4);
    const tracksStart = tracksIdx + 4 + tSizeLen;
    const tracksEnd = Math.min(
      buf.length,
      tracksSize > 0 && tracksSize < 4 * 1024 * 1024 ? tracksStart + tracksSize : tracksStart + 131072
    );

    for (let i = tracksStart; i <= tracksEnd - 4; i++) {
      // Matroska Colour -> BitsPerChannel (0x55 0xB2)
      if (buf[i] === 0x55 && buf[i + 1] === 0xb2) {
        const { size: dLen, len: vLen } = readEbmlVintSize(buf, i + 2);
        const valStart = i + 2 + vLen;
        if (dLen >= 1 && dLen <= 2 && valStart + dLen <= tracksEnd) {
          let bpc = 0;
          for (let b = 0; b < dLen; b++) bpc = bpc * 256 + buf[valStart + b];
          if (bpc === 10 || bpc === 12) {
            out.is10Bit = true;
            if (out.videoCodec === 'h264') {
              out.isHi10P = true;
            }
          }
        }
      }

      // Matroska TrackEntry -> CodecPrivate (0x63 0xA2)
      if (buf[i] === 0x63 && buf[i + 1] === 0xa2) {
        const { size: dLen, len: vLen } = readEbmlVintSize(buf, i + 2);
        const valStart = i + 2 + vLen;
        if (dLen >= 4 && dLen < 65536 && valStart + dLen <= tracksEnd) {
          // HEVC CodecPrivate (HEVCDecoderConfigurationRecord)
          if (out.videoCodec === 'hevc' && dLen >= 18 && buf[valStart] === 1) {
            const profileIdc = buf[valStart + 1] & 0x1f;
            const bitDepthLumaMinus8 = buf[valStart + 17] & 0x07;
            if (profileIdc === 2 || profileIdc === 4 || bitDepthLumaMinus8 >= 2) {
              out.is10Bit = true;
            }
          }
          // AVC CodecPrivate (AVCDecoderConfigurationRecord: High 10 profile_idc = 110 / 122 / 244)
          else if (out.videoCodec === 'h264' && dLen >= 4 && buf[valStart] === 1) {
            const profileIdc = buf[valStart + 1];
            if (profileIdc === 110 || profileIdc === 122 || profileIdc === 244) {
              out.is10Bit = true;
              out.isHi10P = true;
            }
          }
          // AV1 CodecPrivate (av1C: marker bit 0x80 | version 1 = 0x81, byte 1 flag 0x40 = high_bitdepth)
          else if (out.videoCodec === 'av1' && dLen >= 4 && (buf[valStart] & 0x80) !== 0) {
            if ((buf[valStart + 1] & 0x40) !== 0) {
              out.is10Bit = true;
            }
          }
        }
      }
    }
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
  const riskyName10Bit = /(^|[^a-z0-9])(10bit|10-bit|10\s*bi|hi10p|main10)([^a-z0-9]|$)/i.test(lowerName);
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
  const isHi10P = Boolean(parsed.isHi10P || (is10Bit && (videoCodec === 'h264' || videoCodec === 'avc')));
  const durationSec = parsed.durationSec && parsed.durationSec > 0 ? parsed.durationSec : fallbackDurationSec;

  return {
    container,
    videoCodec,
    audioCodec,
    is10Bit,
    isHi10P,
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
