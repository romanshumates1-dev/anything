#!/usr/bin/env node
/**
 * Neutralises the environment variables that `@opennextjs/cloudflare` bakes
 * into the Worker bundle.
 *
 * THE PROBLEM
 * `@opennextjs/cloudflare`'s build step (`compile-env-files.js`) calls
 * `extractProjectEnvVars(mode, buildOpts)` for each of the modes
 * production/development/test and writes the result into
 * `.open-next/cloudflare/next-env.mjs` as literal object values. That helper
 * reads `.env`, `.env.{mode}`, `.env.local` and `.env.{mode}.local` from BOTH
 * the app directory AND the monorepo root.
 *
 * The generated file is then imported by the adapter's `init.js`, which does:
 *
 *     process.env[key] ??= nextEnvVars[mode][key];
 *
 * So Cloudflare bindings/secrets still win at runtime — but every value from
 * the local `.env` is nonetheless compiled into the deployed artifact in plain
 * text. On this project that leaked the Neon password, BETTER_AUTH_SECRET,
 * CRON_SECRET, JOB_RUNNER_SECRET, SMS_INBOUND_SECRET, TWILIO_AUTH_TOKEN,
 * ANTHROPIC_API_KEY and the AWS key pair, plus a dev-only
 * BETTER_AUTH_URL=http://localhost:4000 that would silently be used in
 * production if the real secret were ever missing.
 *
 * THE FIX
 * Rewrite the file so all three modes export an empty object. The Worker must
 * then receive every value from Cloudflare itself:
 *
 *     wrangler secret bulk .dev.vars     # or `wrangler secret put NAME`
 *
 * This is the correct production model anyway: no build-time env file, no
 * environment-specific values frozen into an artifact, one bundle promoted
 * unchanged between environments.
 *
 * WHY A SCRUB RATHER THAN REMOVING apps/web/.env
 * `extractProjectEnvVars` reads `.env` unconditionally for EVERY mode, and
 * also reads a `.env` at the monorepo root. So the only way to prevent the
 * inlining by file layout alone would be to have no `.env` anywhere during the
 * build — which breaks `next dev` and is easy to regress. Scrubbing after the
 * build is deterministic and cannot be defeated by a stray env file.
 *
 * This script is deliberately fail-safe in the "already safe" direction: if the
 * file is absent (a future adapter may stop generating it), that is not an
 * error. `scripts/check-secrets-in-bundle.mjs` is the actual enforcement — it
 * scans `.open-next` and fails the build if anything slipped through.
 *
 * Never prints a secret's VALUE — only key NAMES, which are not sensitive and
 * are the operator's checklist of what must exist as Worker secrets.
 *
 * Usage (wired into `cf:build`):
 *   node scripts/scrub-opennext-env.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

const TARGET = join(process.cwd(), '.open-next', 'cloudflare', 'next-env.mjs');
const REL = relative(process.cwd(), TARGET);
const MODES = ['production', 'development', 'test'];
const SCRUBBED = MODES.map((mode) => `export const ${mode} = {};`).join('\n') + '\n';

if (!existsSync(TARGET)) {
  console.log(
    `[scrub-opennext-env] ${REL} not found — nothing to scrub. ` +
      '(Either `opennextjs-cloudflare build` has not run, or the adapter no longer inlines env files.)'
  );
  process.exit(0);
}

const original = readFileSync(TARGET, 'utf8');

// Key NAMES only. Values are never captured, so they can never be printed.
const keyNames = [...new Set([...original.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)":/g)].map((m) => m[1]))].sort();

if (keyNames.length === 0) {
  console.log(`[scrub-opennext-env] ${REL} contained no env values — nothing to scrub.`);
  process.exit(0);
}

writeFileSync(TARGET, SCRUBBED, 'utf8');

console.log(`[scrub-opennext-env] Neutralised ${keyNames.length} env key(s) in ${REL}.`);
console.log(`[scrub-opennext-env] Cleared: ${keyNames.join(', ')}`);
console.log(
  '[scrub-opennext-env] These must now be supplied by Cloudflare, not the build: ' +
    '`wrangler secret bulk .dev.vars` (see .dev.vars.example).'
);
