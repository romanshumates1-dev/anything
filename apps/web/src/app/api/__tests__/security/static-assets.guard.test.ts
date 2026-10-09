/**
 * STATIC-ASSET ratchet (2026-10-09, found by a live production audit).
 *
 * THE DEFECT, AS OBSERVED
 * ----------------------
 * `public/favicon.png` - the icon the root layout serves via
 * `metadata.icons.icon`, i.e. the ONLY favicon this product has - is not a
 * PNG. Its magic bytes are `ef bf bd 50 4e 47` (a UTF-8 replacement
 * character where `0x89` belongs), and the file contains 770 further
 * `ef bf bd` sequences: it was decoded as text with invalid UTF-8 replaced
 * and re-encoded, which is LOSSY - the original bytes are gone and no
 * repair can reconstruct them. Verified:
 *
 *   working tree : len 3477, magic ef bf bd 50 4e 47 - System.Drawing refuses
 *                  to open it; sharp reports "unsupported image format"
 *   git history  : EVERY blob of this file since the initial commit is the
 *                  same 3477-byte corrupted payload (committed broken)
 *   production   : https://dealswiftautomation.com/favicon.png serves the
 *                  same 3477 corrupt bytes - browsers get a broken icon today
 *   favicon.ico  : byte-for-byte IDENTICAL to the corrupted PNG - it is not
 *                  an ICO at all (magic `ef bf bd`, not `00 00 01 00`), so
 *                  legacy /favicon.ico requests get garbage too
 *
 * Screenshots were checked with the same walker and are healthy (all chunk
 * CRCs valid) - the corruption is specific to the two favicon files.
 *
 * WHY A BYTE-LEVEL GUARD
 * ----------------------
 * Nothing in `next build`, the unit suite, or the browser QA scripts ever
 * DECODED these files: they are static assets referenced by path only, so
 * every gate passed while the shipped icon was garbage. A structural PNG/ICO
 * check is the only thing that catches this class - a file that is present,
 * committed, served with 200, and not an image.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** Runner cwd is apps/web (yarn test); public/ sits beside src/. */
const PUBLIC = join(process.cwd(), 'public');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_SIG = Buffer.from([0x00, 0x00, 0x01, 0x00]);

// PNG chunk CRC covers the chunk TYPE plus DATA (not data alone) - the
// standard CRC-32 with the usual polynomial, reflected, init/final xor
// 0xffffffff.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Structural walk of a PNG: signature, every chunk's CRC, IHDR dimensions,
 * and a real inflate of the IDAT stream - presence of the file is NOT
 * enough, that is exactly how the corruption shipped.
 */
function inspectPng(file: string): {
  ok: boolean;
  problems: string[];
  width?: number;
  height?: number;
} {
  const problems: string[] = [];
  const buf = readFileSync(file);

  if (!buf.subarray(0, 8).equals(PNG_SIG)) {
    return {
      ok: false,
      problems: [
        `bad signature ${[...buf.subarray(0, 8)].map((b) => b.toString(16)).join(' ')} ` +
          '(expected 89 50 4e 47 0d 0a 1a 0a)',
      ],
    };
  }

  let off = 8;
  let width: number | undefined;
  let height: number | undefined;
  let sawIend = false;
  const idat: Buffer[] = [];

  while (off + 12 <= buf.length && !sawIend) {
    const len = buf.readUInt32BE(off);
    if (off + 12 + len > buf.length) {
      problems.push(`truncated chunk at offset ${off}`);
      break;
    }
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const stored = buf.readUInt32BE(off + 8 + len);
    const calc = crc32(buf.subarray(off + 4, off + 8 + len));
    if (calc !== stored) problems.push(`CRC mismatch in ${type}`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') idat.push(Buffer.from(data));
    if (type === 'IEND') sawIend = true;
    off += 12 + len;
  }

  if (!sawIend) problems.push('missing IEND - file is truncated');
  if (width === undefined) problems.push('missing IHDR');

  // A CRC-valid PNG can still be damaged where the walker does not look:
  // inflate the pixel stream so IDAT corruption cannot hide.
  if (problems.length === 0 && idat.length > 0) {
    try {
      inflateSync(Buffer.concat(idat));
    } catch (e) {
      problems.push(`IDAT inflate failed: ${(e as Error).message}`);
    }
  }

  return { ok: problems.length === 0, problems, width, height };
}

/** Validate ICO container: magic, directory count, every entry in bounds. */
function inspectIco(file: string): { ok: boolean; problems: string[]; count: number } {
  const problems: string[] = [];
  const buf = readFileSync(file);
  if (!buf.subarray(0, 4).equals(ICO_SIG)) {
    return {
      ok: false,
      problems: [
        `bad signature ${[...buf.subarray(0, 4)].map((b) => b.toString(16)).join(' ')} ` +
          '(expected 00 00 01 00 - this file is not an ICO)',
      ],
      count: 0,
    };
  }
  const count = buf.readUInt16LE(4);

  if (count < 1) problems.push('ICO declares zero images');
  if (6 + count * 16 > buf.length) problems.push('ICO directory exceeds file length');
  for (let i = 0; i < count && 6 + i * 16 + 16 <= buf.length; i++) {
    const ent = 6 + i * 16;
    const size = buf.readUInt32LE(ent + 8);
    const offset = buf.readUInt32LE(ent + 12);
    if (offset + size > buf.length) problems.push(`image ${i} payload out of bounds`);
  }
  return { ok: problems.length === 0, problems, count };
}

describe('favicon.png is a structurally valid PNG', () => {
  const file = join(PUBLIC, 'favicon.png');

  it('exists', () => {
    expect(() => readFileSync(file)).not.toThrow();
  });

  it('passes a full structural walk (signature, per-chunk CRC, IDAT inflate)', () => {
    const r = inspectPng(file);
    expect(
      r.ok,
      `favicon.png is corrupt: ${r.problems.join('; ')} - ` +
        'this shipped to production as a broken icon (magic ef bf bd 50 4e 47, ' +
        '770 mangled sequences, live 2026-10-09)'
    ).toBe(true);
  });

  it('is a usable square icon (non-trivial, power-of-two-ish dimensions)', () => {
    const r = inspectPng(file);
    if (!r.ok) return; // reported by the walk above
    expect(r.width!).toBeGreaterThanOrEqual(16);
    expect(r.width!).toBeLessThanOrEqual(512);
    expect(r.width).toBe(r.height);
  });
});

describe('favicon.ico is a real ICO container', () => {
  const file = join(PUBLIC, 'favicon.ico');

  it('exists', () => {
    expect(() => readFileSync(file)).not.toThrow();
  });

  it('has ICO structure, not a renamed copy of the PNG', () => {
    const r = inspectIco(file);
    expect(
      r.ok,
      `favicon.ico: ${r.problems.join('; ')} - ` +
        'it was a byte-for-byte copy of the (corrupt) favicon.png, so ' +
        'legacy /favicon.ico requests were served garbage (live 2026-10-09)'
    ).toBe(true);
    expect(r.count).toBeGreaterThanOrEqual(1);
  });

  it('differs from favicon.png (an .ico that equals the .png is a mislabel)', () => {
    const png = readFileSync(join(PUBLIC, 'favicon.png'));
    const ico = readFileSync(file);
    // After regeneration the .ico embeds PNG payloads, but its 6+16 byte
    // container header must still make it a strictly different file.
    expect(ico.equals(png)).toBe(false);
  });
});

describe('social image asset', () => {
  const file = join(PUBLIC, 'og-image.png');

  it('exists and is a valid PNG', () => {
    const r = inspectPng(file);
    expect(
      r.ok,
      `og-image.png missing or corrupt: ${r.problems.join('; ') || 'file not found'} - ` +
        'twitter:card is summary_large_image with no image to serve'
    ).toBe(true);
  });

  it('matches the 1200x630 Open Graph card ratio', () => {
    const r = inspectPng(file);
    if (!r.ok) return;
    expect(r.width).toBe(1200);
    expect(r.height).toBe(630);
  });
});

describe('every PNG under public/ stays decodable', () => {
  it('all shipped PNGs pass the structural walk', () => {
    const offenders: string[] = [];
    const stack = [PUBLIC];
    let checked = 0;
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (ent.name.endsWith('.png')) {
          checked++;
          const r = inspectPng(p);
          if (!r.ok) offenders.push(`${p.replace(PUBLIC, 'public')}: ${r.problems.join('; ')}`);
        }
      }
    }
    expect(checked, 'public/ PNG scan collapsed').toBeGreaterThanOrEqual(8);
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

