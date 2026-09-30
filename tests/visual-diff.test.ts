import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { diffPng, decodePng } from '../scripts/visual-diff.js';

// The golden gate compares pixels, so its decoder must be a real one: a wrong unfilter
// would produce garbage that still compares "equal to itself". These tests build tiny
// PNGs by hand so every filter type and colour type is exercised deliberately.

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([len, Buffer.from(type, 'ascii'), body, crc]);
}

/** PNG's CRC-32 (IEEE), computed bitwise so the fixture needs no dependency. */
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function png(width: number, height: number, colorType: 0 | 2 | 6, rows: Uint8Array[]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const stride = width * (colorType === 6 ? 4 : colorType === 2 ? 3 : 1);
  // Each row already carries its own filter byte as its first element — the fixtures
  // encode real deltas, so overwriting it here would silently turn every row into None.
  const raw = Buffer.concat(rows.map((row) => Buffer.from(row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Encodes one scanline the way PNG does, so the fixtures exercise the decoder against
 * correctly filtered data. Only filter 0 (None) means "these bytes are the raw values";
 * the other four encode deltas relative to the left / upper / predicted sample.
 */
function encodeRow(filter: number, raw: Uint8Array, bpp: number, previousRaw: Uint8Array | null): Buffer {
  const bytes = [filter];
  for (let i = 0; i < raw.length; i++) {
    const left = i >= bpp ? raw[i - bpp] : 0;
    const up = previousRaw ? previousRaw[i] : 0;
    const upperLeft = previousRaw && i >= bpp ? previousRaw[i - bpp] : 0;
    let prediction = 0;
    if (filter === 1) prediction = left;
    else if (filter === 2) prediction = up;
    else if (filter === 3) prediction = (left + up) >> 1;
    else if (filter === 4) prediction = paeth(left, up, upperLeft);
    bytes.push((raw[i] - prediction) & 0xff);
  }
  return Buffer.from(bytes);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  return Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
}

test('the decoder really unfilters all five PNG filter types, not just None', () => {
  // Four rows over four red pixels, one filter type per row, encoded with real deltas.
  // If any unfilter were wrong, the decoded colour would differ between rows.
  const width = 4;
  const raw = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0]);
  const rows = [1, 2, 3, 4, 0].map((filter, index) =>
    encodeRow(filter, raw, 3, index === 0 ? null : raw),
  );
  const decoded = decodePng(png(width, rows.length, 2, rows));
  for (let x = 0; x < width; x++) {
    const at = x * 4;
    assert.deepEqual([decoded.data[at], decoded.data[at + 1], decoded.data[at + 2]], [255, 0, 0], `filter type ${x} decoded wrong`);
  }
});

test('grey, truecolour and truecolour+alpha all decode to RGBA', () => {
  // Every row carries its own filter byte as its first element; filter 0 means raw values.
  const grey = decodePng(png(2, 1, 0, [Buffer.from([0, 10, 20])]));
  assert.deepEqual([grey.data[0], grey.data[3]], [10, 255], 'greyscale must expand to RGBA with opaque alpha');
  const rgb = decodePng(png(2, 1, 2, [Buffer.from([0, 1, 2, 3, 0, 4, 5, 6])]));
  assert.deepEqual([rgb.data[3], rgb.data[7]], [255, 255], 'no-alpha truecolour must be opaque');
  const rgba = decodePng(png(1, 1, 6, [Buffer.from([0, 9, 8, 7, 128])]));
  assert.equal(rgba.data[3], 128, 'alpha must survive');
});

test('identical images compare clean; a one-channel change is caught; size mismatch fails', () => {
  // Each row is [filter 0] + four RGB pixels; filter 0 means "these bytes are raw values".
  const raw = new Uint8Array([10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30]);
  const row = Buffer.from([0, ...raw]);
  const a = png(4, 4, 2, [row, row, row, row]);
  const same = png(4, 4, 2, [row, row, row, row]);
  assert.equal(diffPng(a, same).differingPixels, 0, 'identical images must differ by zero pixels');

  // One red channel pushed past the default tolerance of 24 must be caught.
  const changed = Buffer.from([0, ...raw.slice(0, 9), 100, 20, 30]);
  const b = png(4, 4, 2, [changed, row, row, row]);
  assert.equal(diffPng(a, b, 24).differingPixels, 1, 'a real colour change must be caught');

  const taller = png(4, 5, 2, [row, row, row, row, row]);
  assert.throws(() => diffPng(a, taller), /size mismatch.*changed shape/, 'a shape change must fail outright');
});

test('sampled comparison still catches a small change anywhere in the image', () => {
  // Every pixel is scanned, so a single changed pixel anywhere must be caught.
  const blank = Buffer.from([0, ...new Uint8Array(120)]);
  const rows = Array.from({ length: 40 }, () => Buffer.from(blank));
  const base = png(40, 40, 2, rows);
  const changed = rows.map((r) => Buffer.from(r));
  changed[20].set([255, 255, 255], 61);
  const other = png(40, 40, 2, changed);
  assert.equal(diffPng(base, other).differingPixels, 1, 'an isolated change must not be missed');
});

test('corrupt PNGs fail loudly instead of comparing nonsense', () => {
  assert.throws(() => decodePng(Buffer.from('not a png')), /not a PNG/);
  const truncated = png(8, 8, 2, [Buffer.from(new Uint8Array(24))]);
  const cut = truncated.subarray(0, truncated.length - 6);
  assert.throws(() => decodePng(cut), /truncated|IDAT|IHDR|not a PNG/);
});
