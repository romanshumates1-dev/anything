/**
 * Build-time generator for the legal document corpus.
 *
 * WHY THIS EXISTS (2026-10-01, found in PRODUCTION)
 * ------------------------------------------------
 * `lib/legal.ts` read `content/legal/*.md` with Node's `fs` on every call.
 * Cloudflare Workers has no filesystem, so in production:
 *
 *   GET /api/legal      -> 200 []            (readdirSync returned nothing)
 *   GET /legal/privacy  -> 404               (notFound(), because read threw)
 *   ... all 9 docs      -> 404
 *
 * `content/legal/` does ship inside the deployed bundle, but nothing can READ
 * it there, so shipping it was not enough.
 *
 * The fix inverts the direction: the markdown stays the single source of truth
 * on disk, and this script bakes it into a plain TypeScript module at build
 * time. `lib/legal.ts` then imports that module instead of `fs`, so the runtime
 * has no filesystem dependency at all - on Workers, on Node, anywhere.
 *
 * Run via `npm run legal:generate`, and automatically by `cf:build` (see
 * package.json) so it can never drift from the markdown in a deploy.
 *
 * Placeholders ({{LEGAL_ENTITY_NAME}} etc.) are deliberately NOT substituted
 * here. `lib/legal.ts` still performs that substitution at request time, so a
 * deployment can override the entity name via env without a rebuild.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// scripts/ -> src/
const srcDir = join(here, '..', 'src');
const contentDir = join(srcDir, '..', 'content', 'legal');
const outFile = join(srcDir, 'lib', 'legal-docs.generated.ts');

/** Mirrors the minimal frontmatter parser in lib/legal.ts: `key: value` lines. */
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return {};
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return {};
  const out = {};
  for (const line of raw.slice(3, end).trim().split('\n')) {
    const i = line.indexOf(':');
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

if (!existsSync(contentDir)) {
  console.error(`[legal:generate] no content directory at ${contentDir}`);
  process.exit(1);
}

const slugs = readdirSync(contentDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => f.replace(/\.md$/, ''))
  .sort();

if (slugs.length === 0) {
  console.error(`[legal:generate] no .md files in ${contentDir}`);
  process.exit(1);
}

const entries = slugs.map((slug) => {
  const raw = readFileSync(join(contentDir, `${slug}.md`), 'utf8');
  const { data, body } = (() => {
    const end = raw.indexOf('\n---', 3);
    if (!raw.startsWith('---') || end === -1) return { data: {}, body: raw };
    return {
      data: parseFrontmatter(raw),
      body: raw.slice(end + 4).replace(/^\s*\n/, ''),
    };
  })();
  return { slug, frontmatter: data, body };
});

const header = `/**
 * GENERATED FILE - DO NOT EDIT.
 *
 * Produced by scripts/generate-legal-docs.mjs from content/legal/*.md.
 * Run \`npm run legal:generate\` after editing any legal document; \`cf:build\`
 * does it automatically. See that script for the full rationale.
 *
 * Regenerating instead of hand-editing is what keeps the published legal text
 * and the on-disk source from ever diverging.
 */
import type { LegalDocSeed } from './legal-types';

/** Raw documents, before env placeholder substitution (done in lib/legal.ts). */
export const LEGAL_DOC_SEEDS: LegalDocSeed[] = [`;

const body = entries
  .map(
    (e) => `  {
    slug: ${JSON.stringify(e.slug)},
    frontmatter: ${JSON.stringify(e.frontmatter)},
    body: ${JSON.stringify(e.body)},
  },`
  )
  .join('\n');

const out = `${header}${body}\n];\n`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, out, 'utf8');
console.log(`[legal:generate] wrote ${slugs.length} document(s) -> ${outFile}`);
