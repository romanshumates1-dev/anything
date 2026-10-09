#!/usr/bin/env node
/**
 * Generates the brand image assets under public/.
 *
 * WHY A GENERATOR AND NOT COMMITTED BINARIES ALONE
 * -------------------------------------------------
 * The favicon that shipped before 2026-10-09 was not a PNG at all: its first
 * bytes were `ef bf bd 50 4e 47` - a UTF-8 replacement character where 0x89
 * belongs - because the file had been decoded as text and re-encoded, which is
 * lossy and unrecoverable. Every git blob of it was the same 3477 corrupt
 * bytes, and production served them. favicon.ico was a byte-for-byte copy of
 * that same corrupt PNG, so legacy /favicon.ico requests got garbage too.
 *
 * Nothing caught it because every gate referenced these files by PATH only -
 * `next build`, the unit suite and the browser QA scripts never decoded them.
 * So they are generated here from code, reproducibly, and pinned structurally
 * by src/app/api/__tests__/security/static-assets.guard.test.ts (signature,
 * per-chunk CRC, IDAT inflate, ICO directory bounds).
 *
 * DELIBERATELY DEPENDENCY-FREE
 * ----------------------------
 * PNG is a tiny format and Node ships `zlib`. Encoding it here avoids adding an
 * image library to a production bundle for a build-time asset - sharp is
 * present in node_modules only as a TRANSITIVE dependency and must not become
 * an undeclared load-bearing one.
 *
 * Usage: node scripts/generate-brand-assets.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', 'public');

/* ------------------------------------------------------------------ *
 * PNG encoding                                                       *
 * ------------------------------------------------------------------ */

// CRC-32 (reflected, poly 0xedb88320) over a chunk's TYPE + DATA.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC. */
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/**
 * Encode RGBA pixels as a non-interlaced, 8-bit truecolour-with-alpha PNG.
 * Filter type 0 (None) per scanline: no filtering is needed for this content
 * and it keeps the encoder auditable.
 */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = truecolour + alpha
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering method
  ihdr[12] = 0; // no interlace

  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter byte
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Wrap PNG payloads in an ICO container: a 6-byte header, one 16-byte directory
 * entry per image, then the payloads. Embedding PNGs is valid (Vista+) and is
 * what browsers expect from a modern favicon; the old favicon.ico was not an
 * ICO in any sense - it was the corrupt PNG copied over a .ico extension.
 */
function encodeIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(count * 16);
  let offset = 6 + count * 16;

  pngs.forEach((png, i) => {
    const ent = i * 16;
    dir[ent] = png.width >= 256 ? 0 : png.width; // 256 encodes as 0
    dir[ent + 1] = png.height >= 256 ? 0 : png.height;
    dir[ent + 2] = 0; // palette entries (0 = truecolour)
    dir[ent + 3] = 0; // reserved
    dir.writeUInt16LE(1, ent + 4); // colour planes
    dir.writeUInt16LE(32, ent + 6); // bits per pixel
    dir.writeUInt32LE(png.data.length, ent + 8);
    dir.writeUInt32LE(offset, ent + 12);
    offset += png.data.length;
  });

  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

/* ------------------------------------------------------------------ *
 * Drawing                                                             *
 * ------------------------------------------------------------------ */

/** A tiny RGBA canvas with source-over compositing. */
function createCanvas(width, height) {
  const data = Buffer.alloc(width * height * 4);
  return {
    width,
    height,
    data,
    set(x, y, [r, g, b, a]) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = (y * width + x) * 4;
      const sa = a / 255;
      const da = data[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa === 0) return;
      data[i] = Math.round((r * sa + data[i] * da * (1 - sa)) / oa);
      data[i + 1] = Math.round((g * sa + data[i + 1] * da * (1 - sa)) / oa);
      data[i + 2] = Math.round((b * sa + data[i + 2] * da * (1 - sa)) / oa);
      data[i + 3] = Math.round(oa * 255);
    },
  };
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Brand ramp: blue -> violet, matching the in-app gradient. */
const BRAND_A = [0x3b, 0x82, 0xf6];
const BRAND_B = [0x8b, 0x5c, 0xf6];

function ramp(t) {
  return [lerp(BRAND_A[0], BRAND_B[0], t), lerp(BRAND_A[1], BRAND_B[1], t), lerp(BRAND_A[2], BRAND_B[2], t)];
}

/** Filled rounded rectangle via a rounded-box SDF. */
function fillRoundedRect(canvas, x, y, w, h, radius, color) {
  const r = Math.min(radius, w / 2, h / 2);
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      const cx = Math.min(Math.max(px + 0.5, x + r), x + w - r);
      const cy = Math.min(Math.max(py + 0.5, y + r), y + h - r);
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      if (Math.sqrt(dx * dx + dy * dy) <= r) canvas.set(px, py, color);
    }
  }
}

/** 5x7 block glyphs - enough for the "DF" monogram. */
const GLYPHS = {
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
};

/** Draw a 5x7 glyph at (x, y) scaled by `scale`. */
function drawGlyph(canvas, glyph, x, y, scale, color) {
  glyph.forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) {
      if (row[rx] !== '1') continue;
      for (let sy = 0; sy < scale; sy++) {
        for (let sx = 0; sx < scale; sx++) {
          canvas.set(x + rx * scale + sx, y + ry * scale + sy, color);
        }
      }
    }
  });
}

const WHITE = [255, 255, 255, 255];
const SLATE_900 = [0x0f, 0x17, 0x2a, 255]; // the app's page background

/** Paint the "DF" monogram centred inside a tile of the given size. */
function drawMonogram(canvas, tileX, tileY, tile, scale) {
  const cell = Math.max(1, Math.floor((tile * scale) / 11));
  const glyphW = cell * 5;
  const gap = cell;
  const glyphH = cell * 7;
  const totalW = glyphW * 2 + gap;
  const startX = tileX + Math.round((tile - totalW) / 2);
  const startY = tileY + Math.round((tile - glyphH) / 2);
  drawGlyph(canvas, GLYPHS.D, startX, startY, cell, WHITE);
  drawGlyph(canvas, GLYPHS.F, startX + glyphW + gap, startY, cell, WHITE);
}

/** A brand-gradient rounded square with a white "DF". Used for the icons. */
function drawIconMark(size) {
  const c = createCanvas(size, size);
  const pad = Math.max(1, Math.round(size * 0.06));
  const radius = Math.round(size * 0.22);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.min(Math.max(x + 0.5, pad + radius), size - pad - radius);
      const cy = Math.min(Math.max(y + 0.5, pad + radius), size - pad - radius);
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (Math.sqrt(dx * dx + dy * dy) > radius) continue;
      c.set(x, y, [...ramp((x + y) / (2 * (size - 1))), 255]);
    }
  }

  drawMonogram(c, pad, pad, size - pad * 2, 0.52);
  return c;
}

/**
 * The 1200x630 Open Graph card.
 *
 * summary_large_image promised a large image while the site served none
 * (og:image and twitter:image both NOT FOUND live 2026-10-09), so every shared
 * marketing link rendered as a bare text link.
 *
 * NOTE ON TEXT: the card is drawn with the brand monogram plus geometric rules
 * rather than the wordmark, because setting real type would mean embedding a
 * font. To put "DealFlow AI" on it, render with a font and replace the bar
 * geometry below - keep the 1200x630 dimensions, which
 * static-assets.guard.test.ts pins.
 */
function drawOgCard() {
  const W = 1200;
  const H = 630;
  const c = createCanvas(W, H);

  // Base slate with a soft diagonal brand wash, kept low-contrast so the
  // monogram and rules stay legible over it.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = (x / W) * 0.65 + (y / H) * 0.35;
      const [r, g, b] = ramp(t);
      const mix = 0.16;
      c.set(x, y, [
        Math.round(lerp(SLATE_900[0], r, mix)),
        Math.round(lerp(SLATE_900[1], g, mix)),
        Math.round(lerp(SLATE_900[2], b, mix)),
        255,
      ]);
    }
  }

  // Accent bar down the left edge.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < 14; x++) c.set(x, y, [...ramp(y / H), 255]);
  }

  // Monogram tile, then the wordmark/subtitle rules (see NOTE ON TEXT).
  const tile = 168;
  fillRoundedRect(c, 96, 96, tile, tile, 36, [...ramp(0.5), 255]);
  drawMonogram(c, 96, 96, tile, 0.52);

  fillRoundedRect(c, 96, 330, 760, 46, 23, WHITE);
  fillRoundedRect(c, 96, 404, 560, 22, 11, [148, 163, 184, 255]);
  fillRoundedRect(c, 96, 448, 468, 22, 11, [100, 116, 139, 255]);

  return c;
}

/* ------------------------------------------------------------------ *
 * Emit                                                                *
 * ------------------------------------------------------------------ */

function writeAsset(name, buffer) {
  writeFileSync(join(PUBLIC, name), buffer);
  console.log(`${name.padEnd(16)} ${String(buffer.length).padStart(7)} bytes`);
}

mkdirSync(PUBLIC, { recursive: true });

// favicon.ico embeds 16/32/48; favicon.png is the frame the root layout serves
// via metadata.icons.icon.
const iconPngs = [16, 32, 48].map((size) => ({
  width: size,
  height: size,
  data: encodePng(size, size, drawIconMark(size).data),
}));

writeAsset('favicon.png', iconPngs[1].data);
writeAsset('favicon.ico', encodeIco(iconPngs));

// 180x180 Apple touch icon. iOS uses it for home-screen bookmarks and
// "Add to Home Screen"; without one it falls back to a screenshot of the page.
// The root layout declares it via metadata.appleWebApp, so it is a real
// referenced asset rather than a spare file.
writeAsset('apple-touch-icon.png', encodePng(180, 180, drawIconMark(180).data));

const og = drawOgCard();
writeAsset('og-image.png', encodePng(og.width, og.height, og.data));

console.log(
  '\nStructural check: npx vitest run --config src/app/api/vitest.config.ts static-assets.guard'
);


