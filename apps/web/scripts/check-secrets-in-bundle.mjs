#!/usr/bin/env node
/**
 * Build-time guard: fails if any server-only secret ends up in the CLIENT
 * bundle (.next/static — the JS actually shipped to browsers; .next/server
 * is server-only code that never reaches a user and is out of scope here).
 *
 * Two independent checks, both against every file in .next/static:
 *  1. The literal VALUE of every secret currently configured in the
 *     environment (DATABASE_URL, STRIPE_SECRET_KEY, etc.) — the most
 *     precise check possible, but only catches secrets present in THIS run's
 *     env.
 *  2. Secret-SHAPED literal prefixes (sk_live_, sk_test_, whsec_, sk-ant-,
 *     a postgres:// URL with embedded credentials) — catches a real key
 *     hardcoded/pasted somewhere even if it isn't the one configured here.
 *
 * Never prints a secret's actual value — only PASS/FAIL per check.
 *
 * Run AFTER `next build` (needs .next/static to exist):
 *   node --env-file=.env scripts/check-secrets-in-bundle.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const STATIC_DIR = join(process.cwd(), '.next', 'static');

if (!existsSync(STATIC_DIR)) {
  console.error('[check-secrets-in-bundle] .next/static not found — run `next build` first.');
  process.exit(1);
}

// Server-only secret env vars that must NEVER appear in client-shipped code.
const SECRET_ENV_VARS = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TWILIO_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'JOB_RUNNER_SECRET',
];

const SHAPE_PATTERNS = [
  { name: 'Stripe live secret key', re: /sk_live_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe test secret key', re: /sk_test_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe webhook secret', re: /whsec_[A-Za-z0-9]{10,}/ },
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9-]{10,}/ },
  { name: 'Postgres URL with embedded credentials', re: /postgres(?:ql)?:\/\/[^:\s'"]+:[^@\s'"]+@/ },
];

function collectJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = collectJsFiles(STATIC_DIR);
console.log(`[check-secrets-in-bundle] scanning ${files.length} client bundle files under .next/static ...`);

// One read per file, checked against every pattern — not one re-read per check.
const valueChecks = SECRET_ENV_VARS
  .map((name) => ({ name, value: process.env[name] }))
  .filter((c) => c.value && c.value.length >= 8);

const valueHits = new Map(valueChecks.map((c) => [c.name, null]));
const shapeHits = new Map(SHAPE_PATTERNS.map((p) => [p.name, null]));

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const { name, value } of valueChecks) {
    if (!valueHits.get(name) && content.includes(value)) valueHits.set(name, file);
  }
  for (const { name, re } of SHAPE_PATTERNS) {
    if (!shapeHits.get(name) && re.test(content)) shapeHits.set(name, file);
  }
}

let failed = false;

if (valueChecks.length === 0) {
  console.log('[check-secrets-in-bundle] no secret env vars configured in this run — value-based check skipped.');
} else {
  for (const { name } of valueChecks) {
    const hit = valueHits.get(name);
    if (hit) {
      console.error(`\x1b[31mFAIL ${name}'s configured value was found in the client bundle: ${hit}\x1b[0m`);
      failed = true;
    } else {
      console.log(`PASS ${name} value not present in client bundle`);
    }
  }
}

for (const { name } of SHAPE_PATTERNS) {
  const hit = shapeHits.get(name);
  if (hit) {
    console.error(`\x1b[31mFAIL ${name}-shaped literal found in the client bundle: ${hit}\x1b[0m`);
    failed = true;
  } else {
    console.log(`PASS no ${name}-shaped literal found`);
  }
}

if (failed) {
  console.error('[check-secrets-in-bundle] FAILED — see above.');
  process.exit(1);
}
console.log('[check-secrets-in-bundle] PASS — no secret values or secret-shaped literals found in the client bundle.');
