// Dependency-free icon generator.
//
// Renders a branded DealFlow AI app mark (gradient rounded square + an ascending
// "deal flow" bar chart) at several resolutions and writes:
//   assets/icon.png          (1024×1024, used by Linux + as a fallback)
//   assets/icon.ico          (Windows, PNG-in-ICO container, multi-size)
//   assets/icon.icns         (macOS, PNG-in-ICNS container, multi-size)
//   assets/trayTemplate.png  (monochrome menubar/tray template, 32×32)
//
// Uses only Node builtins (zlib) — no canvas, ImageMagick, or native deps — so
// it runs identically in CI and on any dev machine.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(__dirname, "..", "assets");
mkdirSync(assets, { recursive: true });

// ---------------------------------------------------------------------------
// Pixel rendering
// ---------------------------------------------------------------------------
function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Distance from point to the nearest edge of a rounded rectangle mask. */
function insideRoundedRect(x, y, size, radius) {
  const min = radius;
  const max = size - radius;
  const cx = Math.min(Math.max(x, min), max);
  const cy = Math.min(Math.max(y, min), max);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/**
 * Produce an RGBA buffer for a given size.
 * @param {number} size
 * @param {"brand"|"mono"} mode
 */
function renderRGBA(size, mode) {
  const buf = Buffer.alloc(size * size * 4);
  const radius = Math.round(size * 0.2);

  // Gradient endpoints (brand blue → violet).
  const c1 = [0x2f, 0x6d, 0xf6];
  const c2 = [0x7b, 0x3f, 0xf2];

  // Ascending bar-chart geometry.
  const innerLeft = size * 0.28;
  const innerRight = size * 0.72;
  const bottom = size * 0.72;
  const gap = size * 0.05;
  const barW = (innerRight - innerLeft - 2 * gap) / 3;
  const bars = [
    { x0: innerLeft, top: size * 0.56 },
    { x0: innerLeft + barW + gap, top: size * 0.44 },
    { x0: innerLeft + 2 * (barW + gap), top: size * 0.3 },
  ];

  function inBar(x, y) {
    for (const b of bars) {
      if (x >= b.x0 && x <= b.x0 + barW && y >= b.top && y <= bottom) return true;
    }
    return false;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const withinCard = insideRoundedRect(x + 0.5, y + 0.5, size, radius);

      if (mode === "mono") {
        // Transparent everywhere except the bars, drawn opaque black so macOS
        // can tint it as a template image.
        if (inBar(x, y)) {
          buf[i] = 0;
          buf[i + 1] = 0;
          buf[i + 2] = 0;
          buf[i + 3] = 255;
        } else {
          buf[i + 3] = 0;
        }
        continue;
      }

      if (!withinCard) {
        buf[i + 3] = 0; // transparent corners
        continue;
      }

      const t = (x + y) / (2 * size); // diagonal gradient
      if (inBar(x, y)) {
        buf[i] = 255;
        buf[i + 1] = 255;
        buf[i + 2] = 255;
        buf[i + 3] = 255;
      } else {
        buf[i] = Math.round(lerp(c1[0], c2[0], t));
        buf[i + 1] = Math.round(lerp(c1[1], c2[1], t));
        buf[i + 2] = Math.round(lerp(c1[2], c2[2], t));
        buf[i + 3] = 255;
      }
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw image data with a 0 (None) filter byte per scanline.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngOf(size, mode = "brand") {
  return encodePNG(size, renderRGBA(size, mode));
}

// ---------------------------------------------------------------------------
// ICO container (embeds PNGs directly — supported by Windows Vista+)
// ---------------------------------------------------------------------------
function encodeICO(sizes) {
  const images = sizes.map((s) => ({ size: s, png: pngOf(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  const datas = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry[0] = img.size >= 256 ? 0 : img.size; // 0 means 256
    entry[1] = img.size >= 256 ? 0 : img.size;
    entry[2] = 0; // colors
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bit count
    entry.writeUInt32LE(img.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    datas.push(img.png);
    offset += img.png.length;
  }
  return Buffer.concat([header, ...entries, ...datas]);
}

// ---------------------------------------------------------------------------
// ICNS container (embeds PNGs directly for retina icon types)
// ---------------------------------------------------------------------------
function encodeICNS(entries) {
  // entries: [{ type: "ic10", png }]
  const blocks = entries.map(({ type, png }) => {
    const header = Buffer.alloc(8);
    Buffer.from(type, "ascii").copy(header, 0);
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const body = Buffer.concat(blocks);
  const fileHeader = Buffer.alloc(8);
  Buffer.from("icns", "ascii").copy(fileHeader, 0);
  fileHeader.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([fileHeader, body]);
}

// ---------------------------------------------------------------------------
// Write everything
// ---------------------------------------------------------------------------
console.log("[icons] rendering app mark…");

writeFileSync(path.join(assets, "icon.png"), pngOf(1024));
console.log("[icons] wrote icon.png (1024×1024)");

writeFileSync(path.join(assets, "icon.ico"), encodeICO([16, 32, 48, 64, 128, 256]));
console.log("[icons] wrote icon.ico");

writeFileSync(
  path.join(assets, "icon.icns"),
  encodeICNS([
    { type: "ic07", png: pngOf(128) },
    { type: "ic08", png: pngOf(256) },
    { type: "ic09", png: pngOf(512) },
    { type: "ic10", png: pngOf(1024) },
  ]),
);
console.log("[icons] wrote icon.icns");

writeFileSync(path.join(assets, "trayTemplate.png"), pngOf(32, "mono"));
console.log("[icons] wrote trayTemplate.png");

console.log("[icons] done.");
