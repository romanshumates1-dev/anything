#!/usr/bin/env node
/**
 * Hard gate: the Cloudflare Worker bundle must fit the Workers script limit.
 *
 * WHY THIS EXISTS
 * Cloudflare meters a Worker's SCRIPT size AFTER COMPRESSION (gzip):
 *   3 MB  — Workers Free
 *   10 MB — Workers Paid
 * A build that exceeds the plan's cap is rejected at deploy time. Because the
 * failure surfaces only on `wrangler deploy`, it is easy to merge a change that
 * silently makes the app undeployable. This script moves that check to build
 * time so the build fails closed instead.
 *
 * WHAT IS MEASURED
 * `wrangler deploy --dry-run --outdir <dir>` emits exactly the files it would
 * upload, so this gzips those files (level 9) and sums them. Static assets are
 * NOT counted: on Workers they are served by the assets binding and are free
 * and unmetered on every plan, so only the script bytes count against the cap.
 *
 * NOTE ON WINDOWS: wrangler is invoked through this Node process
 * (`process.execPath` + the local wrangler bin) rather than via a shell, so the
 * gate behaves identically in PowerShell, cmd, bash and CI.
 *
 * Usage:
 *   node scripts/check-worker-size.mjs
 * Override the cap when a different plan is targeted:
 *   WORKER_SIZE_LIMIT_BYTES=10485760 node scripts/check-worker-size.mjs
 */
import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'fs';
import { gzipSync } from 'zlib';
import { join, relative } from 'path';

// 3 MiB — the Workers Free script limit, measured after compression.
// Override by plan: WORKER_SIZE_LIMIT_BYTES env var, or the first CLI argument
// (the argument form exists because `VAR=x cmd` syntax is not portable to the
// cmd shell npm uses on Windows).
const CONFIGURED = Number(process.argv[2] || process.env.WORKER_SIZE_LIMIT_BYTES || 0);
const LIMIT_BYTES = CONFIGURED || 3 * 1024 * 1024;
const PLAN_LABEL = CONFIGURED ? 'configured limit' : 'Workers Free';

const CWD = process.cwd();
// Inside .wrangler/ so it is already gitignored and never confused with output.
const OUTDIR = join(CWD, '.wrangler', 'dry-run-out');

const WRANGLER_BIN = join(CWD, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

if (!existsSync(WRANGLER_BIN)) {
  console.error(`[check-worker-size] wrangler not found at ${relative(CWD, WRANGLER_BIN)} — run \`yarn install\`.`);
  process.exit(1);
}

rmSync(OUTDIR, { recursive: true, force: true });

console.log('[check-worker-size] running `wrangler deploy --dry-run` to emit the exact upload payload ...');
let wranglerOut = '';
try {
  wranglerOut = execFileSync(process.execPath, [WRANGLER_BIN, 'deploy', '--dry-run', '--outdir', OUTDIR], {
    cwd: CWD,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN ?? 'dry-run' },
  });
} catch (err) {
  // Capture failed but wrangler still explains itself — show that first.
  if (err.stdout) process.stdout.write(String(err.stdout));
  if (err.stderr) process.stderr.write(String(err.stderr));
  console.error('[check-worker-size] `wrangler deploy --dry-run` failed — fix the build before measuring size.');
  process.exit(1);
}

// Echo the parts of wrangler's report that matter, so a failing gate is
// self-explanatory in CI.
process.stdout.write(
  wranglerOut
    .split('\n')
    .filter((line) => /Total Upload|Read \d+ files|ASSETS|bindings/i.test(line))
    .join('\n') + '\n'
);

// wrangler's own figure is ground truth: it is exactly what Cloudflare meters
// (the compiled script, AFTER compression). Note it does NOT include the
// sourcemap — an outdir contains custom-worker.js.map, which is ~10 MB gzip and
// is not uploaded as the Worker.
const reported = /gzip:\s*([\d.]+)\s*KiB/i.exec(wranglerOut);
const reportedBytes = reported ? Math.round(Number(reported[1]) * 1024) : null;

if (!existsSync(OUTDIR)) {
  console.error(`[check-worker-size] wrangler produced no output at ${relative(CWD, OUTDIR)}.`);
  process.exit(1);
}

// README.md is a human-readable note wrangler always writes, and .map files are
// not part of the metered Worker script — exclude both from the local recount.
const files = collectFiles(OUTDIR).filter((f) => !f.endsWith('README.md') && !f.endsWith('.map'));
if (files.length === 0) {
  console.error('[check-worker-size] no uploaded files found in the dry-run output.');
  process.exit(1);
}

let totalGzip = 0;
let totalRaw = 0;
console.log('[check-worker-size] Worker script files (compressed):');
for (const file of files) {
  const raw = readFileSync(file);
  const gz = gzipSync(raw, { level: 9 }).length;
  totalRaw += raw.length;
  totalGzip += gz;
  console.log(`  ${(gz / 1048576).toFixed(2).padStart(7)} MB gzip  ${(raw.length / 1048576).toFixed(2).padStart(7)} MB raw   ${relative(CWD, file)}`);
}

// Prefer wrangler's number; fall back to our own measurement if its output
// format ever changes, so the gate can never silently stop enforcing.
const metered = reportedBytes ?? totalGzip;
const source = reportedBytes ? "wrangler's reported" : 'locally measured';

console.log(
  `[check-worker-size] metered ${(metered / 1048576).toFixed(2)} MB gzip (${source}), ` +
    `raw ${(totalRaw / 1048576).toFixed(2)} MB = ${((metered / LIMIT_BYTES) * 100).toFixed(1)}% of the ` +
    `${(LIMIT_BYTES / 1048576).toFixed(0)} MB ${PLAN_LABEL} limit`
);

if (reportedBytes && Math.abs(reportedBytes - totalGzip) / reportedBytes > 0.05) {
  console.log(
    `[check-worker-size] note: local recount differs from wrangler by ` +
      `${(Math.abs(reportedBytes - totalGzip) / 1048576).toFixed(2)} MB (different gzip settings); ` +
      "wrangler's figure is the one that governs."
  );
}

if (metered > LIMIT_BYTES) {
  console.error(
    `[check-worker-size] FAILED — exceeds the ${PLAN_LABEL} limit by ` +
      `${((metered - LIMIT_BYTES) / 1048576).toFixed(2)} MB. ` +
      'Remove or lazily load bundled dependencies, or move to the Workers Paid plan.'
  );
  process.exit(1);
}

console.log(`[check-worker-size] PASS — ${((LIMIT_BYTES - metered) / 1048576).toFixed(2)} MB of headroom.`);
