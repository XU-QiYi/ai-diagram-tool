/**
 * Pixel comparison for the golden-image regression gate.
 *
 * Zero dependencies: reads the PNG header for dimensions (see `pngDimensions`), then
 * compares the IDAT stream as raw bytes after decoding with the Node built-in zlib.
 * PNG filter types 0-4 are per-scanline, so each scanline is unfiltered independently —
 * this is a real decoder, not a byte comparison, and it survives benign re-encodes.
 *
 * Why not sharp: it is a native binary not shipped as a dependency, and CI must run
 * without it. Why not a byte-equality check: draw.io may re-encode the same image with a
 * different compression level, which would fail spuriously and make the gate useless.
 */
import { inflateSync } from 'node:zlib';
import { pngDimensions } from '../src/render/png.js';

export interface PngDiff {
  width: number;
  height: number;
  /** Pixels whose sampled RGBA differs by more than tolerance. */
  differingPixels: number;
  /** Largest per-channel difference seen, 0-255. */
  maxDelta: number;
  /** Share of differing pixels, 0-1. */
  ratio: number;
}

interface Decoded {
  width: number;
  height: number;
  /** Raw RGBA, four bytes per pixel. */
  data: Buffer;
}

const CHANNELS = 4;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Unfilters one scanline in place. PNG filters are per-scanline, so each is handled alone. */
function unfilterLine(line: Buffer, bpp: number, previous: Buffer | null): void {
  const type = line[0];
  const pixels = line.subarray(1);
  for (let i = 0; i < pixels.length; i++) {
    const left = i >= bpp ? pixels[i - bpp] : 0;
    const up = previous ? previous[i] : 0;
    const upperLeft = previous && i >= bpp ? previous[i - bpp] : 0;
    switch (type) {
      case 1:
        pixels[i] = (pixels[i] + left) & 0xff;
        break;
      case 2:
        pixels[i] = (pixels[i] + up) & 0xff;
        break;
      case 3:
        pixels[i] = (pixels[i] + ((left + up) >> 1)) & 0xff;
        break;
      case 4:
        pixels[i] = (pixels[i] + paeth(left, up, upperLeft)) & 0xff;
        break;
      default:
        break; // 0 = None
    }
  }
}

/**
 * Decodes a PNG into RGBA. Supports the colour types the gate actually produces:
 * 8-bit truecolour with and without alpha (types 2 and 6), plus greyscale (0). An
 * interlaced or palette image fails loudly rather than comparing nonsense.
 */
export function decodePng(bytes: Buffer): Decoded {
  const { width, height } = pngDimensions(bytes);
  if (width <= 0 || height <= 0) throw new Error(`[visual-diff] invalid dimensions ${width}x${height}`);

  let at = 8;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];

  while (at + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.subarray(at + 4, at + 8).toString('ascii');
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      bitDepth = body[8];
      colorType = body[9];
      interlace = body[12];
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body));
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }

  if (interlace) throw new Error('[visual-diff] interlaced PNG is not supported by the golden gate');
  if (bitDepth !== 8) throw new Error(`[visual-diff] only 8-bit PNGs are supported, got bit depth ${bitDepth}`);
  if (!idat.length) throw new Error('[visual-diff] PNG has no IDAT data');

  const raw = inflateSync(Buffer.concat(idat));
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : 0;
  if (!channels)
    throw new Error(
      `[visual-diff] unsupported colour type ${colorType} (supported: 0 greyscale, 2 truecolour, 6 truecolour+alpha)`,
    );
  if (colorType === 3) throw new Error('[visual-diff] palette PNGs are not supported by the golden gate');

  const stride = width * channels;
  if (raw.length < (stride + 1) * height)
    throw new Error(`[visual-diff] truncated PNG data: ${raw.length} bytes for ${width}x${height}`);

  const data = Buffer.alloc(width * height * CHANNELS);
  let previous: Buffer | null = null;
  for (let y = 0; y < height; y++) {
    const line = raw.subarray(y * (stride + 1), (y + 1) * (stride + 1));
    unfilterLine(line, channels, previous);
    previous = line.subarray(1);
    for (let x = 0; x < width; x++) {
      const target = (y * width + x) * CHANNELS;
      if (colorType === 0) {
        const grey = line[1 + x];
        data[target] = data[target + 1] = data[target + 2] = grey;
        data[target + 3] = 255;
      } else {
        for (let c = 0; c < 3; c++) data[target + c] = line[1 + x * channels + c];
        data[target + 3] = colorType === 6 ? line[1 + x * channels + 3] : 255;
      }
    }
  }
  return { width, height, data };
}

/**
 * Compares two PNGs with an anti-aliasing tolerance, scanning **every** pixel.
 * `tolerance` is the per-channel delta below which two pixels count as identical —
 * text edges re-render differently between draw.io versions, and a gate at tolerance 0
 * would fail on every run. A size mismatch fails outright: the diagram changed shape,
 * not just colour.
 *
 * No sampling: a sampled scan skips pixels, and a gate that can miss a real change is
 * worse than a slower one. The largest baseline (~5000x825) still compares in well under
 * a second, which is nothing next to the draw.io render that produced it.
 */
export function diffPng(baseline: Buffer, actual: Buffer, tolerance = 24): PngDiff {
  const a = decodePng(baseline);
  const b = decodePng(actual);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(
      `[visual-diff] size mismatch: baseline ${a.width}x${a.height}, actual ${b.width}x${b.height} — the diagram changed shape, regenerate the baseline`,
    );
  }

  let differing = 0;
  let maxDelta = 0;
  for (let at = 0; at < a.data.length; at += CHANNELS) {
    for (let c = 0; c < 3; c++) {
      const delta = Math.abs(a.data[at + c] - b.data[at + c]);
      if (delta > maxDelta) maxDelta = delta;
    }
    if (
      Math.abs(a.data[at] - b.data[at]) > tolerance ||
      Math.abs(a.data[at + 1] - b.data[at + 1]) > tolerance ||
      Math.abs(a.data[at + 2] - b.data[at + 2]) > tolerance ||
      Math.abs(a.data[at + 3] - b.data[at + 3]) > tolerance
    ) {
      differing++;
    }
  }

  const pixels = a.width * a.height;
  return {
    width: a.width,
    height: a.height,
    differingPixels: differing,
    maxDelta,
    ratio: differing / Math.max(1, pixels),
  };
}
