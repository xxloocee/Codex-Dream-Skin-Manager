import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
const MP4_VIDEO_CODECS = new Set(["avc1", "avc3"]);
export const MAX_IMAGE_DIMENSION = 16384;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_IMAGE_FRAMES = 300;
export const MAX_VIDEO_DURATION_SECONDS = 60;
export const MAX_VIDEO_FPS = 60;

function uint16be(bytes, offset) {
  return bytes[offset] * 256 + bytes[offset + 1];
}

function uint16le(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 256;
}

function uint24le(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 256 + bytes[offset + 2] * 65536;
}

function uint32be(bytes, offset) {
  return bytes[offset] * 0x1000000 + bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 + bytes[offset + 3];
}

function uint64be(bytes, offset) {
  const high = uint32be(bytes, offset);
  const low = uint32be(bytes, offset + 4);
  const value = high * 0x100000000 + low;
  return Number.isSafeInteger(value) ? value : null;
}

function uint32le(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000;
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function isoBoxAt(bytes, offset, end) {
  if (offset + 8 > end) return null;
  let size = uint32be(bytes, offset);
  let header = 8;
  if (size === 1) {
    if (offset + 16 > end) return null;
    const high = uint32be(bytes, offset + 8);
    const low = uint32be(bytes, offset + 12);
    size = high * 0x100000000 + low;
    header = 16;
    if (!Number.isSafeInteger(size)) return null;
  } else if (size === 0) {
    size = end - offset;
  }
  if (size < header || offset + size > end) return null;
  return {
    type: ascii(bytes, offset + 4, 4),
    start: offset,
    data: offset + header,
    end: offset + size,
  };
}

function isoBoxes(bytes, start, end) {
  const result = [];
  let offset = start;
  while (offset < end) {
    const box = isoBoxAt(bytes, offset, end);
    if (!box) return null;
    result.push(box);
    offset = box.end;
  }
  return result;
}

function childBox(bytes, parent, type) {
  return isoBoxes(bytes, parent.data, parent.end)?.find((box) => box.type === type) ?? null;
}

function mp4Timescale(bytes, mdhd) {
  if (!mdhd || mdhd.data + 4 > mdhd.end) return null;
  const offset = bytes[mdhd.data] === 1 ? mdhd.data + 20 : mdhd.data + 12;
  if (offset + 4 > mdhd.end) return null;
  const timescale = uint32be(bytes, offset);
  return timescale > 0 ? timescale : null;
}

function mp4AvcConfiguration(bytes, entry) {
  const childrenStart = entry.data + 78;
  if (childrenStart > entry.end) return null;
  const avcC = isoBoxes(bytes, childrenStart, entry.end)
    ?.find((box) => box.type === "avcC");
  if (!avcC || avcC.data + 7 > avcC.end || bytes[avcC.data] !== 1) return null;
  let offset = avcC.data + 5;
  const sequenceCount = bytes[offset++] & 0x1f;
  if (sequenceCount < 1) return null;
  for (let index = 0; index < sequenceCount; index += 1) {
    if (offset + 2 > avcC.end) return null;
    const length = uint16be(bytes, offset);
    offset += 2;
    if (length < 1 || offset + length > avcC.end) return null;
    offset += length;
  }
  if (offset >= avcC.end) return null;
  const pictureCount = bytes[offset++];
  if (pictureCount < 1) return null;
  for (let index = 0; index < pictureCount; index += 1) {
    if (offset + 2 > avcC.end) return null;
    const length = uint16be(bytes, offset);
    offset += 2;
    if (length < 1 || offset + length > avcC.end) return null;
    offset += length;
  }
  return {
    profile: bytes[avcC.data + 1],
    compatibility: bytes[avcC.data + 2],
    level: bytes[avcC.data + 3],
  };
}

function mp4SampleSizes(bytes, stbl) {
  const stsz = childBox(bytes, stbl, "stsz");
  if (!stsz || stsz.data + 12 > stsz.end) return null;
  const fixedSize = uint32be(bytes, stsz.data + 4);
  const sampleCount = uint32be(bytes, stsz.data + 8);
  const maximumSamples = MAX_VIDEO_DURATION_SECONDS * MAX_VIDEO_FPS;
  if (sampleCount < 1 || sampleCount > maximumSamples) return null;
  if (fixedSize > 0) {
    const sampleBytes = fixedSize * sampleCount;
    return Number.isSafeInteger(sampleBytes)
      ? { sampleCount, sampleBytes, sampleSizes: Array(sampleCount).fill(fixedSize) }
      : null;
  }
  if (stsz.data + 12 + sampleCount * 4 > stsz.end) return null;
  let sampleBytes = 0;
  const sampleSizes = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const size = uint32be(bytes, stsz.data + 12 + index * 4);
    if (size < 1) return null;
    sampleSizes.push(size);
    sampleBytes += size;
    if (!Number.isSafeInteger(sampleBytes)) return null;
  }
  return { sampleCount, sampleBytes, sampleSizes };
}

function mp4Timing(bytes, stbl, timescale, expectedSamples) {
  const stts = childBox(bytes, stbl, "stts");
  if (!stts || stts.data + 8 > stts.end) return null;
  const entryCount = uint32be(bytes, stts.data + 4);
  if (entryCount < 1 || stts.data + 8 + entryCount * 8 > stts.end) return null;
  let sampleCount = 0;
  let durationTicks = 0;
  let minimumDelta = Infinity;
  for (let index = 0; index < entryCount; index += 1) {
    const offset = stts.data + 8 + index * 8;
    const count = uint32be(bytes, offset);
    const delta = uint32be(bytes, offset + 4);
    if (count < 1 || delta < 1) return null;
    sampleCount += count;
    durationTicks += count * delta;
    minimumDelta = Math.min(minimumDelta, delta);
    if (!Number.isSafeInteger(sampleCount) || !Number.isSafeInteger(durationTicks)) return null;
  }
  if (sampleCount !== expectedSamples) return null;
  const durationSeconds = durationTicks / timescale;
  const fps = sampleCount / durationSeconds;
  const peakFps = timescale / minimumDelta;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 ||
      durationSeconds > MAX_VIDEO_DURATION_SECONDS || !Number.isFinite(fps) ||
      fps > MAX_VIDEO_FPS + 0.01 || peakFps > MAX_VIDEO_FPS + 0.01) return null;
  return { durationSeconds, fps, peakFps };
}

function mp4ChunkOffsets(bytes, stbl) {
  const box = childBox(bytes, stbl, "stco") || childBox(bytes, stbl, "co64");
  if (!box || box.data + 8 > box.end) return null;
  const count = uint32be(bytes, box.data + 4);
  const width = box.type === "co64" ? 8 : 4;
  if (count < 1 || box.data + 8 + count * width > box.end) return null;
  const offsets = [];
  for (let index = 0; index < count; index += 1) {
    const offset = box.type === "co64"
      ? uint64be(bytes, box.data + 8 + index * width)
      : uint32be(bytes, box.data + 8 + index * width);
    if (!Number.isSafeInteger(offset)) return null;
    offsets.push(offset);
  }
  return offsets;
}

function mp4SampleToChunkInfo(bytes, stbl, chunkCount, expectedSamples, allowedDescriptions) {
  const stsc = childBox(bytes, stbl, "stsc");
  if (!stsc || stsc.data + 8 > stsc.end) return null;
  const count = uint32be(bytes, stsc.data + 4);
  if (count < 1 || stsc.data + 8 + count * 12 > stsc.end) return null;
  const entries = [];
  let previousFirstChunk = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = stsc.data + 8 + index * 12;
    const firstChunk = uint32be(bytes, offset);
    const samplesPerChunk = uint32be(bytes, offset + 4);
    const descriptionIndex = uint32be(bytes, offset + 8);
    if (firstChunk <= previousFirstChunk || samplesPerChunk < 1 ||
        !allowedDescriptions.has(descriptionIndex)) return null;
    previousFirstChunk = firstChunk;
    entries.push({ firstChunk, samplesPerChunk, descriptionIndex });
  }
  if (entries[0].firstChunk !== 1 || entries.at(-1).firstChunk > chunkCount) return null;
  let sampleCount = 0;
  const chunks = [];
  let entryIndex = 0;
  for (let chunkIndex = 1; chunkIndex <= chunkCount; chunkIndex += 1) {
    while (entryIndex + 1 < entries.length && entries[entryIndex + 1].firstChunk <= chunkIndex) {
      entryIndex += 1;
    }
    const entry = entries[entryIndex];
    chunks.push({
      descriptionIndex: entry.descriptionIndex,
      sampleStart: sampleCount,
      sampleCount: entry.samplesPerChunk,
    });
    sampleCount += entry.samplesPerChunk;
    if (!Number.isSafeInteger(sampleCount) || sampleCount > expectedSamples) return null;
  }
  return sampleCount === expectedSamples ? {
    descriptionIndices: new Set(entries.map((entry) => entry.descriptionIndex)),
    chunks,
  } : null;
}

function mp4ChunkRangesAreValid(chunkOffsets, chunking, sampleSizes, mediaBoxes) {
  return chunkOffsets.every((offset, index) => {
    const chunk = chunking.chunks[index];
    let chunkBytes = 0;
    for (let sample = chunk.sampleStart;
      sample < chunk.sampleStart + chunk.sampleCount; sample += 1) {
      chunkBytes += sampleSizes[sample];
    }
    const end = offset + chunkBytes;
    return Number.isSafeInteger(end) && mediaBoxes.some((box) =>
      offset >= box.data && end <= box.end);
  });
}

function mp4VideoMetadata(bytes) {
  const roots = isoBoxes(bytes, 0, bytes.length);
  if (!roots?.some((box) => box.type === "ftyp") ||
      roots.some((box) => box.type === "moof")) return null;
  const mediaBoxes = roots.filter((box) => box.type === "mdat" && box.end > box.data);
  const mediaBytes = mediaBoxes.reduce((total, box) => total + box.end - box.data, 0);
  if (!mediaBoxes.length || mediaBytes < 1) return null;
  const moov = roots.find((box) => box.type === "moov");
  if (!moov || childBox(bytes, moov, "mvex")) return null;
  for (const trak of isoBoxes(bytes, moov.data, moov.end) ?? []) {
    if (trak.type !== "trak") continue;
    const mdia = childBox(bytes, trak, "mdia");
    const hdlr = mdia && childBox(bytes, mdia, "hdlr");
    if (!hdlr || hdlr.data + 12 > hdlr.end || ascii(bytes, hdlr.data + 8, 4) !== "vide") continue;
    const timescale = mp4Timescale(bytes, childBox(bytes, mdia, "mdhd"));
    if (!timescale) continue;
    const minf = childBox(bytes, mdia, "minf");
    const stbl = minf && childBox(bytes, minf, "stbl");
    const stsd = stbl && childBox(bytes, stbl, "stsd");
    if (!stsd || stsd.data + 8 > stsd.end) continue;
    const entryCount = uint32be(bytes, stsd.data + 4);
    const configurations = [];
    let entryOffset = stsd.data + 8;
    for (let index = 0; index < entryCount; index += 1) {
      const entry = isoBoxAt(bytes, entryOffset, stsd.end);
      if (!entry) break;
      const configuration = MP4_VIDEO_CODECS.has(entry.type)
        ? mp4AvcConfiguration(bytes, entry) : null;
      if (configuration && entry.data + 28 <= entry.end) {
        const width = uint16be(bytes, entry.data + 24);
        const height = uint16be(bytes, entry.data + 26);
        if (width > 0 && height > 0) configurations.push({
          index: index + 1,
          width,
          height,
          codec: entry.type,
          ...configuration,
        });
      }
      entryOffset = entry.end;
    }
    if (!configurations.length) continue;
    const sizes = mp4SampleSizes(bytes, stbl);
    const timing = sizes && mp4Timing(bytes, stbl, timescale, sizes.sampleCount);
    const chunkOffsets = mp4ChunkOffsets(bytes, stbl);
    const allowedDescriptions = new Set(configurations.map((entry) => entry.index));
    const chunking = sizes && chunkOffsets
      ? mp4SampleToChunkInfo(bytes, stbl, chunkOffsets.length, sizes.sampleCount, allowedDescriptions)
      : null;
    if (!sizes || !timing || sizes.sampleBytes > mediaBytes || !chunkOffsets ||
        !chunking ||
        !mp4ChunkRangesAreValid(chunkOffsets, chunking, sizes.sampleSizes, mediaBoxes)) continue;
    const selected = configurations.find((entry) => chunking.descriptionIndices.has(entry.index));
    if (selected) return {
      ...selected,
      sampleCount: sizes.sampleCount,
      durationSeconds: timing.durationSeconds,
      fps: timing.fps,
      peakFps: timing.peakFps,
    };
  }
  return null;
}

function gifDimensions(bytes) {
  if (bytes.length < 10 || !["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return null;
  const width = uint16le(bytes, 6);
  const height = uint16le(bytes, 8);
  return width > 0 && height > 0 ? { width, height } : null;
}

function pngDimensions(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((value, index) => bytes[index] !== value) ||
      uint32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== "IHDR") return null;
  const width = uint32be(bytes, 16);
  const height = uint32be(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : null;
}

function jpegDimensions(bytes) {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) break;
    const length = uint16be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (SOF_MARKERS.has(marker) && length >= 7) {
      const height = uint16be(bytes, offset + 3);
      const width = uint16be(bytes, offset + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") {
    return null;
  }
  const riffEnd = Math.min(bytes.length, uint32le(bytes, 4) + 8);
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const type = ascii(bytes, offset, 4);
    const size = bytes[offset + 4] + bytes[offset + 5] * 256 +
      bytes[offset + 6] * 65536 + bytes[offset + 7] * 0x1000000;
    const data = offset + 8;
    if (data + size > riffEnd) break;
    if (type === "VP8X" && size >= 10) {
      return { width: uint24le(bytes, data + 4) + 1, height: uint24le(bytes, data + 7) + 1 };
    }
    if (type === "VP8L" && size >= 5 && bytes[data] === 0x2f) {
      const width = 1 + bytes[data + 1] + ((bytes[data + 2] & 0x3f) << 8);
      const height = 1 + (bytes[data + 2] >> 6) + (bytes[data + 3] << 2) +
        ((bytes[data + 4] & 0x0f) << 10);
      return { width, height };
    }
    if (type === "VP8 " && size >= 10 && bytes[data + 3] === 0x9d &&
      bytes[data + 4] === 0x01 && bytes[data + 5] === 0x2a) {
      return {
        width: uint16le(bytes, data + 6) & 0x3fff,
        height: uint16le(bytes, data + 8) & 0x3fff,
      };
    }
    offset = data + size + (size % 2);
  }
  return null;
}

function skipGifSubBlocks(bytes, offset) {
  while (offset < bytes.length) {
    const size = bytes[offset++];
    if (size === 0) return offset;
    if (offset + size > bytes.length) return null;
    offset += size;
  }
  return null;
}

function gifAnimationInfo(bytes) {
  if (!gifDimensions(bytes)) return null;
  let offset = 13;
  const packed = bytes[10];
  if (packed & 0x80) offset += 3 * (1 << ((packed & 0x07) + 1));
  let frameCount = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      if (offset >= bytes.length) return null;
      const label = bytes[offset++];
      if (label === 0xf9) {
        if (offset >= bytes.length) return null;
        const size = bytes[offset++];
        if (size !== 4 || offset + size >= bytes.length) return null;
        offset += size;
        if (bytes[offset++] !== 0) return null;
      } else if (label === 0x01) {
        if (offset >= bytes.length) return null;
        const size = bytes[offset++];
        if (size !== 12 || offset + size > bytes.length) return null;
        offset += size;
        const next = skipGifSubBlocks(bytes, offset);
        if (next === null) return null;
        offset = next;
      } else {
        const next = skipGifSubBlocks(bytes, offset);
        if (next === null) return null;
        offset = next;
      }
      continue;
    }
    if (marker !== 0x2c || offset + 9 > bytes.length) return null;
    const imagePacked = bytes[offset + 8];
    offset += 9;
    if (imagePacked & 0x80) offset += 3 * (1 << ((imagePacked & 0x07) + 1));
    if (offset >= bytes.length) return null;
    offset += 1;
    const next = skipGifSubBlocks(bytes, offset);
    if (next === null) return null;
    offset = next;
    frameCount += 1;
    if (frameCount > MAX_IMAGE_FRAMES) return { animated: true, frameCount };
  }
  return frameCount > 0 ? { animated: frameCount > 1, frameCount } : null;
}

function pngAnimationInfo(bytes) {
  if (!pngDimensions(bytes)) return null;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  let offset = signature.length;
  let declaredFrameCount = 0;
  let actualFrameCount = 0;
  while (offset + 12 <= bytes.length) {
    const length = uint32be(bytes, offset);
    const data = offset + 8;
    const end = data + length;
    if (end + 4 > bytes.length) return null;
    const type = ascii(bytes, offset + 4, 4);
    if (type === "acTL" && length >= 8) {
      declaredFrameCount = Math.max(declaredFrameCount, uint32be(bytes, data));
      if (declaredFrameCount > MAX_IMAGE_FRAMES) {
        return { animated: true, frameCount: declaredFrameCount };
      }
    }
    if (type === "fcTL") {
      actualFrameCount += 1;
      if (actualFrameCount > MAX_IMAGE_FRAMES) {
        return { animated: true, frameCount: actualFrameCount };
      }
    }
    offset = end + 4;
    if (type === "IEND") break;
  }
  const frameCount = Math.max(1, declaredFrameCount, actualFrameCount);
  return { animated: frameCount > 1, frameCount };
}

function webpAnimationInfo(bytes) {
  if (!webpDimensions(bytes)) return null;
  const riffEnd = Math.min(bytes.length, uint32le(bytes, 4) + 8);
  let offset = 12;
  let frameCount = 0;
  let animated = false;
  while (offset + 8 <= riffEnd) {
    const type = ascii(bytes, offset, 4);
    const size = uint32le(bytes, offset + 4);
    const data = offset + 8;
    if (data + size > riffEnd) return null;
    if (type === "VP8X" && size >= 1) animated = Boolean(bytes[data] & 0x02);
    if (type === "ANMF") {
      frameCount += 1;
      if (frameCount > MAX_IMAGE_FRAMES) return { animated: true, frameCount };
    }
    offset = data + size + (size % 2);
  }
  if (frameCount > 0) animated = true;
  return { animated, frameCount: frameCount || 1 };
}

export function classifyImageDimensions({ width, height }) {
  const ratio = width / height;
  if (
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 1 || height < 1
    || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
    || width * height > MAX_IMAGE_PIXELS
    || !Number.isFinite(ratio)
  ) return null;
  const aspect = ratio >= 2.25 ? "ultrawide" : ratio >= 1.45 ? "wide"
    : ratio >= 1.08 ? "landscape" : ratio >= 0.9 ? "square" : "portrait";
  return {
    width,
    height,
    ratio,
    wide: ratio >= 1.75,
    aspect,
    taskMode: ratio >= 2.25 ? "banner" : "ambient",
  };
}

// Raw pixel dimensions straight from the container header — no decode, and no
// safety-cap classification, so callers can reject oversized images *before*
// anything rasterizes them. Returns null for formats this header parser does
// not recognize (e.g. HEIC/TIFF).
export function readRawDimensions(value, extension = "") {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const normalized = extension.toLowerCase();
  if (normalized === ".gif" || bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return gifDimensions(bytes);
  }
  if (normalized === ".png" || bytes[0] === 0x89) return pngDimensions(bytes);
  if (normalized === ".jpg" || normalized === ".jpeg" ||
    (bytes[0] === 0xff && bytes[1] === 0xd8)) return jpegDimensions(bytes);
  if (normalized === ".webp" || ascii(bytes, 8, 4) === "WEBP") return webpDimensions(bytes);
  if (normalized === ".mp4" || ascii(bytes, 4, 4) === "ftyp") {
    const metadata = mp4VideoMetadata(bytes);
    return metadata ? { width: metadata.width, height: metadata.height } : null;
  }
  return null;
}

export function readImageMetadata(value, extension = "") {
  const dimensions = readRawDimensions(value, extension);
  return dimensions ? classifyImageDimensions(dimensions) : null;
}

export function readImageAnimation(value, extension = "") {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  const normalized = extension.toLowerCase();
  if (normalized === ".gif" || bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return gifAnimationInfo(bytes);
  }
  if (normalized === ".png" || bytes[0] === 0x89) return pngAnimationInfo(bytes);
  if (normalized === ".webp" || ascii(bytes, 8, 4) === "WEBP") return webpAnimationInfo(bytes);
  if (normalized === ".mp4" || ascii(bytes, 4, 4) === "ftyp") {
    const metadata = mp4VideoMetadata(bytes);
    return metadata ? {
      animated: true,
      frameCount: 0,
      video: true,
      codec: metadata.codec,
      sampleCount: metadata.sampleCount,
      durationSeconds: metadata.durationSeconds,
      fps: metadata.fps,
      peakFps: metadata.peakFps,
    } : null;
  }
  return { animated: false, frameCount: 1 };
}

// Keep the PowerShell theme store on the same strict parser as the injector.
// The CLI is intentionally tiny: it only reads a user-selected file and emits
// validated dimensions; it never writes or follows a caller-provided output.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, imagePath] = process.argv.slice(2);
  if (mode !== "--check" || !imagePath) {
    console.error("Usage: image-metadata.mjs --check <image>");
    process.exitCode = 2;
  } else {
    try {
      const resolved = path.resolve(imagePath);
      const bytes = await fs.readFile(resolved);
      const metadata = readImageMetadata(bytes, path.extname(resolved));
      const animation = readImageAnimation(bytes, path.extname(resolved));
      if (!metadata || !animation || animation.frameCount > MAX_IMAGE_FRAMES) {
        throw new Error("Media metadata is invalid or exceeds the image/video safety limits");
      }
      console.log(JSON.stringify({ ...metadata, ...animation }));
    } catch (error) {
      console.error(error?.message ?? String(error));
      process.exitCode = 2;
    }
  }
}
