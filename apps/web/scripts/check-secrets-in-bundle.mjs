#!/usr/bin/env node
/**
 * Build-time guard: fails if any server-only secret ends up in a SHIPPED
 * artifact.
 *
 * Two shipped artifacts are scanned:
 *
 *   .next/static  — the client bundle actually served to browsers.
 *   .open-next    — the Cloudflare Worker bundle (`opennextjs-cloudflare
 *                   build`). This IS what `wrangler deploy` uploads, so a
 *                   secret found here ships to production.
 *
 * WHY .open-next IS IN SCOPE (added after a real leak):
 * `@opennextjs/cloudflare` generates `.open-next/cloudflare/next-env.mjs` via
 * its `compile-env-files.js`, which calls `extractProjectEnvVars()` once per
 * mode (production/development/test). That helper reads `.env`, `.env.{mode}`,
 * `.env.local` and `.env.{mode}.local` from BOTH the app directory and the
 * monorepo root, and the result is inlined as literal object values inside the
 * Worker. So ANY `.env` present at build time is baked into the deploy —
 * including localhost URLs. scripts/scrub-opennext-env.mjs neutralises that
 * file; this guard is what proves the neutralisation held.
 *
 * Two independent checks, applied to every scanned file:
 *  1. The literal VALUE of every secret currently configured in the
 *     environment (DATABASE_URL, STRIPE_SECRET_KEY, etc.) — the most
 *     precise check possible, but only catches secrets present in THIS
 *     run's env.
 *  2. Secret-SHAPED literal prefixes (sk_live_, sk_test_, whsec_, sk-ant-,
 *     an AKIA AWS access key id, a postgres:// URL with embedded
 *     credentials) — catches a real key hardcoded/pasted somewhere even if
 *     it isn't the one configured here.
 *
 * Never prints a secret's actual value — only PASS/FAIL and the file path.
 *
 * Run AFTER `next build` (client) and/or `opennextjs-cloudflare build`
 * (worker). Roots that do not exist are reported and skipped, so this is safe
 * to run at either point:
 *   node --env-file=.env scripts/check-secrets-in-bundle.mjs
 *
 * Optional extra roots can be passed as arguments — used by the deploy gate to
 * also inspect the final esbuild output that `wrangler deploy --dry-run`
 * writes to an outdir:
 *   node --env-file=.env scripts/check-secrets-in-bundle.mjs /tmp/wrangler-out
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const CWD = process.cwd();

const SCAN_ROOTS = [
  { dir: join(CWD, '.next', 'static'), label: 'client bundle' },
  { dir: join(CWD, '.open-next'), label: 'Cloudflare Worker bundle' },
  // Extra roots (e.g. a wrangler --outdir) supplied on the command line.
  ...process.argv.slice(2).map((dir) => ({ dir, label: 'wrangler output' })),
];

/** Extensions that can carry an inlined literal in either artifact. */
const SCAN_EXTENSIONS = ['.js', '.mjs', '.cjs', '.json'];

// Server-only secret env vars that must NEVER appear in client-shipped code.
const SECRET_ENV_VARS = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TWILIO_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'JOB_RUNNER_SECRET',
  // Added alongside the .open-next coverage: all of these were found in the
  // Worker bundle during the leak that motivated this rewrite.
  'CRON_SECRET',
  'SMS_INBOUND_SECRET',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
];

/**
 * AWS's own documentation placeholder key (e.g. an
 * `<Input placeholder="AKIA…">` in a settings form). Without this allowlist
 * the pattern below reports a false positive on a perfectly safe UI string and
 * blocks every build.
 */
const AWS_ACCESS_KEY_PLACEHOLDER = /^AKIAIOSFODNN7EXAMPLE$/;

const SHAPE_PATTERNS = [
  { name: 'Stripe live secret key', re: /sk_live_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe test secret key', re: /sk_test_[A-Za-z0-9]{10,}/ },
  { name: 'Stripe webhook secret', re: /whsec_[A-Za-z0-9]{10,}/ },
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9-]{10,}/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/, allow: [AWS_ACCESS_KEY_PLACEHOLDER] },
  {
    name: 'Postgres URL with embedded credentials',
    re: /postgres(?:ql)?:\/\/[^:\s'"]+:[^@\s'"]+@/,
    // Benign occurrences of the same shape, both from @neondatabase/serverless:
    //  - "… should be: postgresql://user:password@host.tld/dbname?option=value"
    //    (a format hint inside an Error message)
    //  - `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pw)}@…`
    //    (library code assembling a URL from variables, not a literal secret)
    // A real credential has neither a literal `user:password` nor a `${` right
    // after the scheme, so both rules stay deliberately narrow.
    allow: [/^postgres(?:ql)?:\/\/user:password@/, /^postgres(?:ql)?:\/\/\$\{/],
  },
];

/**
 * True when `content` holds at least one match that is not explicitly allowed.
 *
 * Returns a boolean, never the matched text — this script must not print secret
 * values. A fresh RegExp is built per call so the lastIndex state of a shared
 * `g` regex cannot leak between files.
 */
function hasSuspiciousLiteral(content, pattern) {
  const scoped = new RegExp(
    pattern.re.source,
    pattern.re.flags.includes('g') ? pattern.re.flags : `${pattern.re.flags}g`
  );
  for (const match of content.matchAll(scoped)) {
    const allowed = (pattern.allow ?? []).some((a) => a.test(match[0]));
    if (!allowed) return true;
  }
  return false;
}

/**
 * Collects scannable files under `dir`.
 *
 * `node_modules` directories are skipped. Inside `.open-next` those are
 * verbatim copies of published packages (OpenNext emits a full dependency tree)
 * — they cannot contain this project's env values, and walking them costs tens
 * of thousands of stat calls. The artifacts that CAN carry a leaked value are
 * still fully scanned: the concatenated server bundle
 * (`server-functions/default/apps/web/handler.mjs`), the generated
 * `cloudflare/next-env.mjs`, and any extra root passed on the command line
 * (e.g. wrangler's --outdir).
 */
function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...collectFiles(full));
    } else if (SCAN_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

// Computed once, not per root.
const valueChecks = SECRET_ENV_VARS
  .map((name) => ({ name, value: process.env[name] }))
  .filter((c) => c.value && c.value.length >= 8);

let failed = false;
let scannedRoots = 0;
let scannedFiles = 0;

for (const { dir, label } of SCAN_ROOTS) {
  const rel = relative(CWD, dir) || dir;

  if (!existsSync(dir)) {
    console.log(`[check-secrets-in-bundle] SKIP ${label} — ${rel} not found (run the matching build first).`);
    continue;
  }

  scannedRoots++;

  const files = collectFiles(dir);
  scannedFiles += files.length;
  console.log(`[check-secrets-in-bundle] ${label}: scanning ${files.length} files under ${rel} ...`);

  // One read per file, checked against every pattern — not one re-read per check.
  const valueHits = new Map(valueChecks.map((c) => [c.name, null]));
  const shapeHits = new Map(SHAPE_PATTERNS.map((p) => [p.name, null]));

  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const { name, value } of valueChecks) {
      if (!valueHits.get(name) && content.includes(value)) valueHits.set(name, file);
    }
    for (const pattern of SHAPE_PATTERNS) {
      if (!shapeHits.get(pattern.name) && hasSuspiciousLiteral(content, pattern)) {
        shapeHits.set(pattern.name, file);
      }
    }
  }

  if (valueChecks.length === 0) {
    console.log(`  [${label}] no secret env vars configured in this run — value-based check skipped.`);
  } else {
    for (const { name } of valueChecks) {
      const hit = valueHits.get(name);
      if (hit) {
        console.error(`\x1b[31mFAIL ${label}: ${name}'s configured value was found in ${relative(CWD, hit)}\x1b[0m`);
        failed = true;
      } else {
        console.log(`  [${label}] PASS ${name} value not present`);
      }
    }
  }

  for (const { name } of SHAPE_PATTERNS) {
    const hit = shapeHits.get(name);
    if (hit) {
      console.error(`\x1b[31mFAIL ${label}: ${name}-shaped literal found in ${relative(CWD, hit)}\x1b[0m`);
      failed = true;
    } else {
      console.log(`  [${label}] PASS no ${name}-shaped literal found`);
    }
  }
}

if (scannedRoots === 0) {
  console.error('[check-secrets-in-bundle] nothing to scan — run `next build` and/or `opennextjs-cloudflare build` first.');
  process.exit(1);
}

console.log(`[check-secrets-in-bundle] scanned ${scannedFiles} files across ${scannedRoots} shipped artifact(s).`);

if (failed) {
  console.error('[check-secrets-in-bundle] FAILED — a secret is present in a shipped artifact. See above.');
  process.exit(1);
}
console.log('[check-secrets-in-bundle] PASS — no secret values or secret-shaped literals found in shipped artifacts.');
