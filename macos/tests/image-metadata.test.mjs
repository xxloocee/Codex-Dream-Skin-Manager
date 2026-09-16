import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_FRAMES,
  MAX_IMAGE_PIXELS,
  MAX_VIDEO_DURATION_SECONDS,
  MAX_VIDEO_FPS,
  classifyImageDimensions,
  readImageAnimation,
  readImageMetadata,
  readRawDimensions,
} from "../scripts/image-metadata.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const macosRoot = path.resolve(here, "..");
const mp4 = Buffer.from((await fs.readFile(path.join(
  macosRoot, "..", "tests", "fixtures", "h264-32x18-2fps.mp4.base64",
), "utf8")).trim(), "base64");

const portal = await fs.readFile(path.join(macosRoot, "assets", "portal-hero.png"));
assert.deepEqual(readImageMetadata(portal, ".png"), {
  width: 2168,
  height: 725,
  ratio: 2168 / 725,
  wide: true,
  aspect: "ultrawide",
  taskMode: "banner",
});
const malformedPng = Buffer.from(portal);
malformedPng[0] = 0;
assert.equal(readImageMetadata(malformedPng, ".png"), null);

const gothic = await fs.readFile(path.join(
  macosRoot,
  "presets",
  "preset-gothic-void-crusade",
  "background.jpg",
));
assert.deepEqual(readImageMetadata(gothic, ".jpg"), {
  width: 2560,
  height: 1440,
  ratio: 2560 / 1440,
  wide: true,
  aspect: "wide",
  taskMode: "ambient",
});

assert.deepEqual(classifyImageDimensions({ width: 2400, height: 1350 }), {
  width: 2400,
  height: 1350,
  ratio: 2400 / 1350,
  wide: true,
  aspect: "wide",
  taskMode: "ambient",
});
assert.equal(MAX_IMAGE_DIMENSION, 16384);
assert.equal(MAX_IMAGE_FRAMES, 300);
assert.equal(MAX_IMAGE_PIXELS, 50_000_000);
assert.equal(classifyImageDimensions({ width: 10000, height: 6000 }), null);
assert.equal(classifyImageDimensions({ width: 20000, height: 1 }), null);
assert.equal(classifyImageDimensions({ width: 2560.5, height: 1440 }), null);

const writeAscii = (bytes, offset, value) => {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
};
const writeUint32Le = (bytes, offset, value) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
};
const writeUint24Le = (bytes, offset, value) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
};

const vp8l = new Uint8Array(26);
writeAscii(vp8l, 0, "RIFF");
writeUint32Le(vp8l, 4, vp8l.length - 8);
writeAscii(vp8l, 8, "WEBP");
writeAscii(vp8l, 12, "VP8L");
writeUint32Le(vp8l, 16, 5);
vp8l.set([0x2f, 0x7f, 0xc2, 0x59, 0x00], 20);
assert.deepEqual(readImageMetadata(vp8l, ".webp"), {
  width: 640,
  height: 360,
  ratio: 640 / 360,
  wide: true,
  aspect: "wide",
  taskMode: "ambient",
});

const vp8x = new Uint8Array(30);
writeAscii(vp8x, 0, "RIFF");
writeUint32Le(vp8x, 4, vp8x.length - 8);
writeAscii(vp8x, 8, "WEBP");
writeAscii(vp8x, 12, "VP8X");
writeUint32Le(vp8x, 16, 10);
writeUint24Le(vp8x, 24, 2559);
writeUint24Le(vp8x, 27, 1439);
assert.deepEqual(readImageMetadata(vp8x, ".webp"), {
  width: 2560,
  height: 1440,
  ratio: 2560 / 1440,
  wide: true,
  aspect: "wide",
  taskMode: "ambient",
});

assert.equal(readImageMetadata(new Uint8Array([0, 1, 2, 3]), ".png"), null);

assert.deepEqual(readImageMetadata(mp4, ".mp4"), {
  width: 32,
  height: 18,
  ratio: 32 / 18,
  wide: true,
  aspect: "wide",
  taskMode: "ambient",
});
assert.deepEqual(readImageAnimation(mp4, ".mp4"), {
  animated: true,
  frameCount: 0,
  video: true,
  codec: "avc1",
  sampleCount: 2,
  durationSeconds: 1,
  fps: 2,
  peakFps: 2,
});
assert.equal(MAX_VIDEO_DURATION_SECONDS, 60);
assert.equal(MAX_VIDEO_FPS, 60);
const headerOnlyMp4 = Buffer.from(
  "AAAAHGZ0eXBpc29tAAAAAGlzb21tcDQyYXZjMQAAAMxtb292AAAAxHRyYWsAAABcdGtoZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHgAAABDgAAAAAAGBtZGlhAAAAFGhkbHIAAAAAAAAAAHZpZGUAAABEbWluZgAAADxzdGJsAAAANHN0c2QAAAAAAAAAAQAAACRhdmMxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4AEOA==",
  "base64",
);
assert.equal(readImageMetadata(headerOnlyMp4, ".mp4"), null,
  "MP4 backgrounds must contain real media samples");
const unsupportedCodec = Buffer.from(mp4);
unsupportedCodec.write("hvc1", unsupportedCodec.lastIndexOf(Buffer.from("avc1")), "ascii");
assert.equal(readImageMetadata(unsupportedCodec, ".mp4"), null,
  "MP4 backgrounds must use the Chromium-compatible H.264 codec");
const unsupportedDescription = Buffer.from(mp4);
unsupportedDescription.writeUInt32BE(
  2, unsupportedDescription.indexOf(Buffer.from("stsc")) + 20,
);
assert.equal(readImageMetadata(unsupportedDescription, ".mp4"), null,
  "Every referenced sample description must be a supported H.264 entry");
const missingConfiguration = Buffer.from(mp4);
missingConfiguration.write("junk", missingConfiguration.indexOf(Buffer.from("avcC")), "ascii");
assert.equal(readImageMetadata(missingConfiguration, ".mp4"), null,
  "MP4 backgrounds must contain an AVC decoder configuration");
const chunkPastMedia = Buffer.from(mp4);
const mdatTypeOffset = chunkPastMedia.indexOf(Buffer.from("mdat"));
const mdatBoxOffset = mdatTypeOffset - 4;
const mdatEnd = mdatBoxOffset + chunkPastMedia.readUInt32BE(mdatBoxOffset);
chunkPastMedia.writeUInt32BE(
  mdatEnd - 1, chunkPastMedia.indexOf(Buffer.from("stco")) + 12,
);
assert.equal(readImageMetadata(chunkPastMedia, ".mp4"), null,
  "Every complete MP4 sample must remain inside media data");
const fragmentedMp4 = Buffer.concat([
  mp4,
  Buffer.from([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x66]),
]);
assert.equal(readImageMetadata(fragmentedMp4, ".mp4"), null,
  "Fragmented MP4 backgrounds are outside the supported media contract");
assert.equal(readImageMetadata(mp4.subarray(0, mp4.length - 8), ".mp4"), null,
  "Truncated MP4 media data must be rejected");
const excessiveDuration = Buffer.from(mp4);
excessiveDuration.writeUInt32BE(31 * 16384, excessiveDuration.indexOf(Buffer.from("stts")) + 16);
assert.equal(readImageMetadata(excessiveDuration, ".mp4"), null,
  "MP4 backgrounds must not exceed the duration limit");
const excessiveFps = Buffer.from(mp4);
excessiveFps.writeUInt32BE(136, excessiveFps.indexOf(Buffer.from("stts")) + 16);
assert.equal(readImageMetadata(excessiveFps, ".mp4"), null,
  "MP4 backgrounds must not exceed the frame-rate limit");

const gifHeader = Buffer.from("GIF89a", "ascii");
const gifFrame = Buffer.from([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x02, 0x44, 0x01, 0x00]);
const animatedGif = Buffer.concat([
  gifHeader,
  Buffer.from([1, 0, 1, 0, 0, 0, 0]),
  gifFrame,
  gifFrame,
  Buffer.from([0x3b]),
]);
assert.deepEqual(readImageMetadata(animatedGif, ".gif"), {
  width: 1,
  height: 1,
  ratio: 1,
  wide: false,
  aspect: "square",
  taskMode: "ambient",
});
assert.deepEqual(readImageAnimation(animatedGif, ".gif"), { animated: true, frameCount: 2 });

const animatedPng = Buffer.concat([
  portal.subarray(0, 33),
  Buffer.from([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]),
  portal.subarray(33),
]);
assert.deepEqual(readImageAnimation(animatedPng, ".png"), { animated: true, frameCount: 2 });
assert.deepEqual(readImageAnimation(animatedPng, ".apng"), { animated: true, frameCount: 2 });

const pngChunk = (type, body = Buffer.alloc(0)) => Buffer.concat([
  Buffer.from([0, 0, 0, body.length]),
  Buffer.from(type, "ascii"),
  body,
  Buffer.alloc(4),
]);
const declaredOneButActuallyTooMany = Buffer.concat([
  portal.subarray(0, 33),
  pngChunk("acTL", Buffer.from([0, 0, 0, 1, 0, 0, 0, 0])),
  ...Array.from({ length: MAX_IMAGE_FRAMES + 1 }, () => pngChunk("fcTL")),
  portal.subarray(33),
]);
assert.deepEqual(readImageAnimation(declaredOneButActuallyTooMany, ".png"), {
  animated: true,
  frameCount: MAX_IMAGE_FRAMES + 1,
});

const animatedWebp = new Uint8Array(38);
for (const [index, value] of Array.from("RIFF").entries()) animatedWebp[index] = value.charCodeAt(0);
animatedWebp[4] = 30;
for (const [index, value] of Array.from("WEBPVP8X").entries()) animatedWebp[8 + index] = value.charCodeAt(0);
animatedWebp[16] = 10;
animatedWebp[20] = 0x02;
animatedWebp[24] = 0xff;
animatedWebp[25] = 0x09;
animatedWebp[27] = 0x67;
animatedWebp[28] = 0x05;
for (const [index, value] of Array.from("ANMF").entries()) animatedWebp[30 + index] = value.charCodeAt(0);
assert.deepEqual(readImageAnimation(animatedWebp, ".webp"), { animated: true, frameCount: 1 });

// readRawDimensions returns real pixel dimensions even beyond the safety caps,
// so a preflight can reject decompression bombs before anything decodes them.
assert.deepEqual(readRawDimensions(portal, ".png"), { width: 2168, height: 725 });
const oversized = new Uint8Array(24);
oversized.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
oversized.set([0x00, 0x00, 0x00, 0x0d], 8); // IHDR chunk length
writeAscii(oversized, 12, "IHDR");
oversized.set([0x00, 0x00, 0x4e, 0x20], 16); // width 20000
oversized.set([0x00, 0x00, 0x4e, 0x20], 20); // height 20000
assert.deepEqual(readRawDimensions(oversized, ".png"), { width: 20000, height: 20000 });
assert.equal(readImageMetadata(oversized, ".png"), null); // 400 MP exceeds the cap

console.log("PASS: image/video metadata classifies PNG/JPEG/WebP/GIF/MP4 inputs and enforces safety caps.");
