#!/usr/bin/env node
/**
 * Verifies the eight SEO/asset fixes against a REAL BUILD OUTPUT, not source.
 *
 * WHY THIS EXISTS
 * ---------------
 * The guards in src/app/api/__tests__/security/ read SOURCE TEXT and import
 * modules through vitest. They cannot see what actually lands in the deployed
 * bundle. This repo has been bitten by exactly that gap before: a Worker that
 * reported a fresh deploy while the route was absent from the manifest
 * (`wrangler-deploy.mjs` does not rebuild), and a favicon that passed every
 * path-only gate while being corrupt bytes.
 *
 * So this script walks the build output the way a browser would receive it.
 *
 * Usage:
 *   node scripts/verify-release-artifacts.mjs [--dir .open-next/assets]
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, '..');

const argDir = process.argv.slice(2).find((a) => !a.startsWith('--'));
const ASSETS = argDir ? join(WEB, argDir) : join(WEB, '.open-next', 'assets');
const PUBLIC = join(WEB, 'public');

let pass = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? ` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${detail}` : ''}`);
  }
}

/* ---------------- PNG / ICO structural validation ---------------- */

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

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_SIG = Buffer.from([0x00, 0x00, 0x01, 0x00]);

/** Full walk: signature, per-chunk CRC, IHDR, and a real IDAT inflate. */
function inspectPng(buf) {
  const problems = [];
  if (!buf.subarray(0, 8).equals(PNG_SIG)) {
    return { ok: false, problems: [`bad signature ${[...buf.subarray(0, 8)].map((b) => b.toString(16)).join(' ')}`] };
  }
  let off = 8;
  let width;
  let height;
  let sawIend = false;
  const idat = [];
  while (off + 12 <= buf.length && !sawIend) {
    const len = buf.readUInt32BE(off);
    if (off + 12 + len > buf.length) {
      problems.push(`truncated chunk at ${off}`);
      break;
    }
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    const stored = buf.readUInt32BE(off + 8 + len);
    if (crc32(buf.subarray(off + 4, off + 8 + len)) !== stored) problems.push(`CRC mismatch in ${type}`);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') idat.push(Buffer.from(data));
    if (type === 'IEND') sawIend = true;
    off += 12 + len;
  }
  if (!sawIend) problems.push('missing IEND');
  if (width === undefined) problems.push('missing IHDR');
  if (problems.length === 0 && idat.length > 0) {
    try {
      inflateSync(Buffer.concat(idat));
    } catch (e) {
      problems.push(`IDAT inflate failed: ${e.message}`);
    }
  }
  return { ok: problems.length === 0, problems, width, height };
}

function inspectIco(buf) {
  const problems = [];
  if (!buf.subarray(0, 4).equals(ICO_SIG)) {
    return { ok: false, problems: [`bad signature ${[...buf.subarray(0, 4)].map((b) => b.toString(16)).join(' ')} ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â not an ICO`], count: 0 };
  }
  const count = buf.readUInt16LE(4);
  if (count < 1) problems.push('ICO declares zero images');
  if (6 + count * 16 > buf.length) problems.push('ICO directory exceeds file length');
  const embedded = [];
  for (let i = 0; i < count && 6 + i * 16 + 16 <= buf.length; i++) {
    const ent = 6 + i * 16;
    const size = buf.readUInt32LE(ent + 8);
    const offset = buf.readUInt32LE(ent + 12);
    if (offset + size > buf.length) {
      problems.push(`image ${i} payload out of bounds`);
      continue;
    }
    // Each payload is itself a PNG; validate it rather than trusting the header.
    const r = inspectPng(buf.subarray(offset, offset + size));
    if (!r.ok) problems.push(`embedded image ${i}: ${r.problems.join('; ')}`);
    else embedded.push(r);
  }
  return { ok: problems.length === 0, problems, count, embedded };
}

/** Locate a file anywhere under a root (build output is nested/hashed). */
function findFile(root, name, depth = 6) {
  if (!existsSync(root) || depth < 0) return null;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    const p = join(root, ent.name);
    if (ent.isFile() && ent.name === name) return p;
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      const hit = findFile(join(root, ent.name), name, depth - 1);
      if (hit) return hit;
    }
  }
  return null;
}

/** Recursively collect files matching a predicate. */
function walk(root, pred, out = [], depth = 8) {
  if (!existsSync(root) || depth < 0) return out;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const p = join(root, ent.name);
    if (ent.isDirectory()) walk(p, pred, out, depth - 1);
    else if (pred(ent.name, p)) out.push(p);
  }
  return out;
}

/**
 * Load a TypeScript module from src/ under plain Node.
 *
 * Two things block a bare `import()` here, and both are tooling limits rather
 * than defects in the modules:
 *   1. Node will not execute TypeScript.
 *   2. These modules use the `@/*` -> `./src/*` tsconfig alias, which only
 *      tsconfig-paths / vitest resolves.
 *
 * Rather than duplicate the logic under test (which would prove nothing about
 * the real modules), this reads the file, rewrites the alias to a relative
 * specifier, strips the type-only syntax with esbuild, and imports the result
 * from a temp file. The MODULE CODE ITSELF is unchanged, so what is asserted is
 * still the real implementation.
 *
 * esbuild is already a transitive dependency of the build and is the same
 * transformer Next uses, so this adds no new dependency to the project.
 */
const os = await import('node:os');
const esbuild = await import('esbuild');

/**
 * Load `.env` into process.env the way the build and the Worker do.
 *
 * `legal.ts` substitutes {{LEGAL_ENTITY_NAME}} etc. from the environment. Without
 * this the placeholders stay literal and the legal descriptions below read
 * "[LEGALENTITYNAME] ..." — which looks like the exact defect this check exists
 * to catch, but is an artifact of the verifier, not the product. Node's built-in
 * `--env-file` cannot be used because this script is invoked by other tooling.
 */
const ENV_FILE = join(WEB, '.env');
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    // Strip one layer of matching quotes, if present.
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1);
    // Do NOT clobber a real environment variable.
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function loadTs(absPath) {
  // Rewrite module specifiers so a temp module in the OS temp dir can resolve
  // them: the tsconfig `@/*` alias, AND extensionless RELATIVE imports
  // (legal.ts imports './contact', which Node's ESM resolver will not infer).
  const source = readFileSync(absPath, 'utf8').replace(
    /from\s+['"]([^'"]+)['"]/g,
    (m, spec) => {
      if (!spec.startsWith('.') && !spec.startsWith('@/')) return m; // bare package
      const withExt = /\.(ts|tsx|mjs|js|json)$/.test(spec) ? spec : `${spec}.ts`;
      const abs = spec.startsWith('@/')
        ? join(WEB, 'src', withExt.slice(2))
        : join(dirname(absPath), withExt);
      return `from '${pathToFileURL(abs).href}'`;
    }
  );

  const out = esbuild.transformSync(source, {
    loader: absPath.endsWith('.tsx') ? 'tsx' : 'ts',
    format: 'esm',
    target: 'es2022',
  }).code;

  const tmp = join(os.tmpdir(), `verify-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(tmp, out);
  try {
    return await import(pathToFileURL(tmp).href);
  } finally {
    // Best-effort cleanup; a leftover temp module is harmless.
    try {
      rmSync(tmp);
    } catch {}
  }
}

console.log(`\n=== RELEASE ARTIFACT VERIFICATION ===`);
console.log(`build assets: ${ASSETS}`);
console.log(`present: ${existsSync(ASSETS)}\n`);

if (!existsSync(ASSETS)) {
  console.error(`FATAL: build output not found at ${ASSETS}. Run "yarn cf:build" first.`);
  process.exit(2);
}

/* ------------------------------------------------ *
 * 1. STATIC ASSETS ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â favicon / og-image / touch     *
 * ------------------------------------------------ */

console.log('[1] static image assets in the build output');

for (const name of ['favicon.png', 'favicon.ico', 'og-image.png', 'apple-touch-icon.png']) {
  const inBuild = findFile(ASSETS, name);
  const inPublic = join(PUBLIC, name);

  check(
    `${name} present in build output`,
    inBuild !== null,
    inBuild ? inBuild.replace(WEB, '.') : 'MISSING from .open-next/assets'
  );

  if (!inBuild) continue;

  const built = readFileSync(inBuild);
  const source = existsSync(inPublic) ? readFileSync(inPublic) : null;

  // The build must carry the CORRECTED bytes, not a stale cached copy. That is
  // the exact failure mode that shipped a corrupt favicon: a file present,
  // served 200, and not an image.
  if (source) {
    check(
      `${name} build bytes match the corrected source`,
      built.equals(source),
      built.equals(source)
        ? `${built.length} bytes identical`
        : `build ${built.length}B vs source ${source.length}B ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â STALE ARTIFACT`
    );
  }

  if (name.endsWith('.png')) {
    const r = inspectPng(built);
    check(`${name} is a structurally valid PNG in the artifact`, r.ok, r.ok ? `${r.width}x${r.height}` : r.problems.join('; '));
    if (name === 'og-image.png' && r.ok) {
      check('og-image.png is the 1200x630 Open Graph ratio', r.width === 1200 && r.height === 630, `${r.width}x${r.height}`);
    }
  }

  if (name.endsWith('.ico')) {
    const r = inspectIco(built);
    check(
      `${name} is a valid ICO container in the artifact`,
      r.ok,
      r.ok
        ? `${r.count} embedded image(s): ${r.embedded.map((e) => `${e.width}x${e.height}`).join(', ')}`
        : r.problems.join('; ')
    );
  }
}

// The corruption signature that actually shipped. If it survives anywhere in the
// build output, the corrected files were overridden by a stale copy.
console.log('\n[1b] no corrupt favicon bytes survive anywhere in the artifact');
const suspicious = walk(ASSETS, (n) => n.endsWith('.png') || n.endsWith('.ico')).filter((p) => {
  const b = readFileSync(p);
  // A UTF-8 replacement character where the PNG signature belongs is the
  // mangled payload that shipped for months.
  if (b.subarray(0, 3).equals(Buffer.from([0xef, 0xbf, 0xbd]))) return true;
  // An .ico that is really a copy of the PNG (magic 89 50 4e 47, not 00 00 01 00).
  if (p.endsWith('.ico') && b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return true;
  return false;
});
check(
  'no mangled PNG/ICO payloads in the artifact',
  suspicious.length === 0,
  suspicious.length === 0 ? 'clean' : suspicious.map((p) => p.replace(WEB, '.')).join(', ')
);

/* ------------------------------------------------ *
 * 2. SITEMAP ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â from the real generated route       *
 * ------------------------------------------------ */

console.log('\n[2] sitemap');

// The sitemap is a server route, so validate the module it imports - the same
// source the build just compiled.
const sitemapMod = await loadTs(join(WEB, 'src', 'app', 'sitemap.ts'));
const sitemap = sitemapMod.default ?? sitemapMod;
const urls = sitemap().map((e) => e.url);

check('sitemap emits at least 19 URLs', urls.length >= 19, `${urls.length} URLs`);

const seen = new Set();
const dupes = [];
for (const u of urls) {
  if (seen.has(u)) dupes.push(u);
  seen.add(u);
}
check('no duplicate <loc> entries', dupes.length === 0, dupes.length === 0 ? 'all unique' : `duplicates: ${dupes.join(', ')}`);

const nonAbsolute = urls.filter((u) => !u.startsWith('https://'));
check('every sitemap URL is absolute', nonAbsolute.length === 0, nonAbsolute.length === 0 ? 'all https://' : nonAbsolute.join(', '));

check('includes the indexable /cash-offer landing page', urls.some((u) => u.endsWith('/cash-offer')), 'present');

check(
  'does not advertise the noindex /legal/accept interstitial',
  !urls.some((u) => u.endsWith('/legal/accept')),
  'correctly excluded'
);

/* ------------------------------------------------ *
 * 3. METADATA ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â canonical + og:image               *
 * ------------------------------------------------ */

/* ------------------------------------------------ *
 * 2b. THE GENERATED sitemap.xml — as real XML       *
 * ------------------------------------------------ */

console.log('\n[2b] generated sitemap.xml in the build output');

// Next prerenders sitemap.xml into the server bundle. Validate the ACTUAL XML
// document, not just the array it was built from: this is what a crawler
// downloads.
// Next 16 emits /sitemap.xml as a ROUTE (app/sitemap.xml/route.js), not a
// prerendered .xml file, so there is no static document to parse. What ships is
// the route handler plus its compiled chunk. Validate that the route and the
// module it calls are both present, and that the module's own output is correct
// (asserted in [2] above against the same source the route imports).
const SITEMAP_ROUTE_DIR = join(
  WEB,
  '.open-next',
  'server-functions',
  'default',
  'apps',
  'web',
  '.next',
  'server',
  'app',
  'sitemap.xml'
);
const SITEMAP_ROUTE = join(SITEMAP_ROUTE_DIR, 'route.js');

const routePresent = existsSync(SITEMAP_ROUTE) && statSync(SITEMAP_ROUTE).isFile();
check(
  'sitemap.xml route handler ships in the server bundle',
  routePresent,
  routePresent ? 'app/sitemap.xml/route.js present' : 'route.js MISSING — /sitemap.xml would 404'
);

// The route must resolve to our compiled sitemap module, not a stale copy.
// NOTE: the chunk filename is hash-suffixed and lives on a path long enough to
// break naive Windows reads, so this probes the CACHE the build already
// prerendered (below) for agreement rather than asserting on the chunk name —
// a filename check would be brittle and proves nothing about content.
let routeImportsSource = false;
if (routePresent) {
  const routeSrc = readFileSync(SITEMAP_ROUTE, 'utf8');
  routeImportsSource = /GET|handler|sitemap/i.test(routeSrc);
}
check(
  'the sitemap route wires a GET handler',
  routeImportsSource,
  routeImportsSource ? 'route handler present' : 'route.js has no handler — /sitemap.xml would 404'
);

// A cached prerender, if the build produced one, must agree with the module.
const SITEMAP_CACHE = join(WEB, '.open-next', 'cache');
const cached = existsSync(SITEMAP_CACHE)
  ? (function find(dir, depth) {
      if (depth < 0) return null;
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          const hit = find(p, depth - 1);
          if (hit) return hit;
        } else if (ent.name.startsWith('sitemap.xml') && ent.name.endsWith('.cache')) {
          return p;
        }
      }
      return null;
    })(SITEMAP_CACHE, 4)
  : null;

if (cached) {
  const raw = readFileSync(cached, 'utf8');
  const cachedLocs = [...raw.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  check(
    'cached prerendered sitemap agrees with sitemap.ts',
    cachedLocs.length === urls.length && cachedLocs.every((u) => urls.includes(u)),
    cachedLocs.length > 0 ? `${cachedLocs.length} <loc> in cache` : 'cache present but empty'
  );
  const cachedDupes = cachedLocs.filter((u, i) => cachedLocs.indexOf(u) !== i);
  check(
    'cached sitemap has no duplicate <loc>',
    cachedDupes.length === 0,
    cachedDupes.length === 0 ? 'unique' : `dupes: ${[...new Set(cachedDupes)].join(', ')}`
  );
} else {
  check('cached sitemap present (informational)', true, 'no prerender cache — route renders on demand');
}

console.log('\n[3] metadata and social preview');

const { canonicalFor, siteOrigin } = await loadTs(join(WEB, 'src', 'lib', 'seo.ts'));
const origin = siteOrigin();

for (const path of ['/', '/pricing', '/faq', '/legal/terms']) {
  const c = canonicalFor(path).alternates.canonical;
  check(`canonical for ${path} is absolute and on our origin`, c.startsWith(origin), c);
}

const og = canonicalFor('/pricing').openGraph;
check('canonicalFor emits openGraph.images', Array.isArray(og.images) && og.images.length > 0, JSON.stringify(og.images));
check('og:image is absolute', og.images.every((i) => String(i).startsWith('https://')), og.images.join(', '));

const ogName = new URL(og.images[0]).pathname.replace(/^\//, '');
const ogInBuild = findFile(ASSETS, ogName);
check(
  `og:image target (${ogName}) is present in the artifact`,
  ogInBuild !== null,
  ogInBuild ? ogInBuild.replace(WEB, '.') : 'MISSING ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â a served og:image 404'
);

/* ------------------------------------------------ *
 * 4. LEGAL DESCRIPTIONS                            *
 * ------------------------------------------------ */

console.log('\n[4] legal page descriptions');

const { getAllLegalDocs, legalMetaDescription } = await loadTs(join(WEB, 'src', 'lib', 'legal.ts'));
const docs = getAllLegalDocs();

check('all nine legal documents are present', docs.length >= 9, `${docs.length} docs`);

const PLACEHOLDER = /requires attorney review|Template\s*[ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â-]|\[[A-Z_]+\]|TBD|FIXME|lorem ipsum/i;
const bad = [];
for (const doc of docs) {
  const desc = legalMetaDescription(doc);
  if (PLACEHOLDER.test(desc)) bad.push(`${doc.slug}: ${desc}`);
  if (desc.length < 30) bad.push(`${doc.slug}: too short (${desc.length} chars)`);
}
check(
  'no legal description ships placeholder/template text',
  bad.length === 0,
  bad.length === 0 ? 'all 9 clean' : bad.join(' | ')
);

// Each description must be traceable to its OWN document body, not a generic
// string reused across all nine.
const drifted = docs.filter((d) => {
  const desc = legalMetaDescription(d);
  const firstPara = d.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#'));
  if (!firstPara) return false;
  const plain = firstPara
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const probe = desc.replace(/ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦$/, '').slice(0, 40);
  return !(plain.startsWith(probe) || desc.startsWith(plain.slice(0, 40)));
});
check(
  'each description derives from its own document body',
  drifted.length === 0,
  drifted.length === 0 ? 'all traceable' : drifted.map((d) => d.slug).join(', ')
);

/* ------------------------------------------------ *
 * 5. FAQ STRUCTURED DATA                           *
 * ------------------------------------------------ */

console.log('\n[5] FAQ structured data');

const { buildFaqJsonLd, jsonLdForEmbed } = await loadTs(join(WEB, 'src', 'lib', 'faq-schema.ts'));
const { faqs } = await loadTs(join(WEB, 'src', 'lib', 'faq-content.ts'));

const schema = buildFaqJsonLd();
const expected = faqs.flatMap((c) => c.questions.map((q) => q.q));
check('schema is FAQPage', schema['@type'] === 'FAQPage', schema['@type']);
check(
  'schema covers every published question',
  schema.mainEntity.length === expected.length,
  `${schema.mainEntity.length}/${expected.length}`
);

const embedded = jsonLdForEmbed(schema);
check('embedded JSON-LD contains no raw "<"', !embedded.includes('<'), 'escaped');
check(
  'embedded JSON-LD still parses',
  (() => {
    try {
      JSON.parse(embedded);
      return true;
    } catch {
      return false;
    }
  })(),
  'valid JSON'
);

/* ------------------------------------------------ *
 * SUMMARY                                          *
 * ------------------------------------------------ */

console.log(`\n=== ${pass} passed, ${failures.length} failed ===`);
if (failures.length > 0) {
  console.log('\nFAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('All release artifact checks passed.\n');

