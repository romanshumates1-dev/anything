#!/usr/bin/env node
/**
 * Prompt 1 Phase 2 CI guard: fail the build if ALLOW_DEMO_SEED appears in any
 * production env file. ALLOW_DEMO_SEED=true unlocks scripts/seed-demo-reviews.mjs,
 * which fabricates ~1000 reviews (is_demo=true) — the script itself also
 * refuses at NODE_ENV=production, but this is a second, independent guard:
 * the variable should never even be DEFINED in a file meant for production,
 * so a future refactor of the runtime check can't silently reopen the door.
 *
 * Scans every .env* file that looks production-targeted (name contains
 * "production" or "prod", e.g. .env.production.template, .env.production).
 * Run from apps/web: node scripts/check-no-demo-seed-in-prod-env.mjs
 */
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const webDir = dirname(dirname(fileURLToPath(import.meta.url)));

const candidates = readdirSync(webDir).filter(
  (f) => f.startsWith('.env') && /prod/i.test(f)
);

if (candidates.length === 0) {
  console.log('[check-no-demo-seed] no production-targeted .env files found — nothing to check.');
  process.exit(0);
}

let failed = false;
for (const file of candidates) {
  const content = readFileSync(join(webDir, file), 'utf8');
  if (/ALLOW_DEMO_SEED/.test(content)) {
    console.error(`\x1b[31m✗ ${file} references ALLOW_DEMO_SEED — remove it from any production env file.\x1b[0m`);
    failed = true;
  } else {
    console.log(`✓ ${file} clean`);
  }
}

if (failed) process.exit(1);
console.log('[check-no-demo-seed] all production env files clean.');
