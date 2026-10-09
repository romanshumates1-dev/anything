// Validates + repairs UTF-8-mangled PNG files (0x89 first byte replaced by EF BF BD).
// Usage: node scripts/repair-pngs.mjs [--check]
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Walk chunks; return {valid, width, height} or {valid:false}. */
function inspectPng(buf) {
  if (buf.length < 8) return { valid: false, why: 'too short' };
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIG[i]) return { valid: false, why: `bad signature ${[...buf.slice(0, 8)].map(b => b.toString(16)).join(' ')}` };
  let off = 8;
  let width = 0, height = 0;
  let sawIHDR = false, sawIEND = false;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    if (off + 12 + len > buf.length) return { valid: false, why: `truncated ${type}` };
    const data = buf.subarray(off + 8, off + 8 + len);
    const stored = buf.readUInt32BE(off + 8 + len);
    if (crc32(data) !== stored) return { valid: false, why: `crc mismatch in ${type}` };
    if (type === 'IHDR') { sawIHDR = true; width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IEND') { sawIEND = true; break; }
    off += 12 + len;
  }
  if (!sawIHDR || !sawIEND) return { valid: false, why: `missing ${!sawIHDR ? 'IHDR' : 'IEND'}` };
  return { valid: true, width, height };
}

/** The corruption: EF BF BD (U+FFFD) where 0x89 belonged. Restoring 0x89 yields a valid PNG iff nothing else was mangled. */
function tryRepair(buf) {
  if (!(buf[0] === 0xef && buf[1] === 0xbf && buf[2] === 0xbd)) return null;
  const fixed = Buffer.alloc(buf.length - 2);
  fixed[0] = 0x89;
  buf.copy(fixed, 1, 3);
  const check = inspectPng(fixed);
  return check.valid ? fixed : null;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith('.png')) yield p;
  }
}

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const root = args.find(a => a !== '--check') ?? 'public';
let corrupt = 0, repaired = 0;
for (const file of walk(root)) {
  const buf = readFileSync(file);
  const direct = inspectPng(buf);
  if (direct.valid) continue;
  corrupt++;
  const fixed = tryRepair(buf);
  if (fixed) {
    if (checkOnly) {
      console.log(`CORRUPT (repairable) ${file}`);
    } else {
      writeFileSync(file, fixed);
      repaired++;
      console.log(`REPAIRED ${file} -> ${fixed.length} bytes`);
    }
  } else {
    console.log(`CORRUPT (NOT auto-repairable) ${file}: ${direct.why}`);
  }
}
console.log(`\ncorrupt=${corrupt} repaired=${repaired} checkOnly=${checkOnly}`);
process.exit(corrupt > 0 && checkOnly ? 1 : 0);
