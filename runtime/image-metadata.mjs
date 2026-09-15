const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);
export const MAX_IMAGE_DIMENSION = 16384;
export const MAX_IMAGE_PIXELS = 50_000_000;
export const MAX_IMAGE_FRAMES = 300;

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

function uint32le(bytes, offset) {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000;
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
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
  return { animated: false, frameCount: 1 };
}
