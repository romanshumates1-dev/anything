#!/usr/bin/env node
/**
 * Portable `wrangler deploy` wrapper.
 *
 * WHY THIS EXISTS (found while deploying the C4 SSR fix, 2026-10-01)
 * ----------------------------------------------------------------
 * `cf:deploy` used to be:
 *
 *     yarn cf:gate && OPEN_NEXT_DEPLOY=true wrangler deploy
 *
 * The `VAR=value command` form is POSIX-shell syntax. Windows resolves npm
 * lifecycle scripts through cmd.exe, which has no such construct, so it tries
 * to execute the literal string `OPEN_NEXT_DEPLOY=true` as a program:
 *
 *     'OPEN_NEXT_DEPLOY' is not recognized as an internal or external command
 *
 * The gate still passed first, so the failure surfaced only AFTER a full
 * ~4 minute build + size gate + secret scan - i.e. the operator pays the
 * whole cost and then deploys nothing. The runbook already documented the
 * workaround (scripts/rebuild-and-deploy.mjs), which is why the bug went
 * unnoticed, but that script also re-runs the build, doubling the work.
 *
 * Setting the variable in a child's `env` is the portable form: it works
 * identically on cmd.exe, PowerShell, bash and zsh, and it cannot be
 * mis-parsed as a command name.
 *
 * OPEN_NEXT_DEPLOY tells opennextjs-cloudflare's build wrapper to skip its
 * interactive/broken deploy path and let wrangler publish directly.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');
const SRC_ROOT = join(WEB_ROOT, 'src');

const extraArgs = process.argv.slice(2);

/**
 * STALE-ARTIFACT GUARD — the deploy must not silently ship yesterday's bundle.
 *
 * THE BUG THIS FIXES (observed 2026-10-04)
 * -----------------------------------------
 * This script only ever ran `npx wrangler deploy`. It never rebuilt, so running
 * it after a code change published the PREVIOUS `.open-next` and reported
 * success. The evidence: a deploy returned a brand-new Worker version, yet
 * `GET /signup?ref=` still 404'd on both the apex and workers.dev. The built
 * route manifest was timestamped 20:02 against a 01:43 commit and listed 368
 * routes, with neither `/signup/route` nor `/referrals/page` present even though
 * both source files existed and were committed. A rebuild took the manifest to
 * 370 routes and the fix deployed immediately.
 *
 * That failure mode is dangerous precisely because it looks like success. A
 * deploy is the step where you believe your code shipped.
 *
 * HOW THE GUARD WORKS
 * -------------------
 * Compare the newest mtime under `src/` against the newest mtime under
 * `.open-next/`. If any source file is newer than the built output, the artifact
 * cannot contain that change, so refuse and tell the operator to run the build.
 *
 * Overridable for the deliberate "redeploy the same artifact" case:
 *   node scripts/wrangler-deploy.mjs --allow-stale
 */
const FORCE = extraArgs.includes('--allow-stale');
if (FORCE) {
  const i = extraArgs.indexOf('--allow-stale');
  extraArgs.splice(i, 1);
}

function newestMtime(dir, acc = { newest: 0, file: null }) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    if (ent.name === 'node_modules' || ent.name === '.next') continue;
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      newestMtime(full, acc);
    } else if (ent.isFile()) {
      try {
        const m = statSync(full).mtimeMs;
        if (m > acc.newest) {
          acc.newest = m;
          acc.file = full;
        }
      } catch {
        /* unreadable file: skip */
      }
    }
  }
  return acc;
}

const OUT_NEXT = join(WEB_ROOT, '.open-next');

if (!existsSync(OUT_NEXT)) {
  console.error('[cf:deploy] REFUSING: .open-next/ does not exist.');
  console.error('          Run `yarn cf:build` first. There is nothing to deploy.');
  process.exit(1);
}

const src = newestMtime(SRC_ROOT);
const out = newestMtime(OUT_NEXT);

if (src.file && out.file && src.newest > out.newest) {
  const rel = (p) => p.replace(WEB_ROOT, '.').replace(/\\/g, '/');
  console.error('');
  console.error('[cf:deploy] REFUSING TO DEPLOY A STALE ARTIFACT.');
  console.error(`          newest source : ${rel(src.file)}`);
  console.error(`          newest build  : ${rel(out.file)}`);
  console.error('');
  console.error('          The build output is older than src/, so it cannot contain');
  console.error('          your changes. Deploying anyway would publish stale code while');
  console.error('          reporting success. Run:  yarn cf:build');
  console.error('          To deliberately redeploy the existing artifact, pass:');
  console.error('            --allow-stale');
  console.error('');
  process.exit(1);
}

const routesManifest = join(
  OUT_NEXT,
  'server-functions',
  'default',
  'apps',
  'web',
  '.next',
  'app-path-routes-manifest.json',
);
if (existsSync(routesManifest)) {
  try {
    const n = Object.keys(JSON.parse(readFileSync(routesManifest, 'utf8'))).length;
    console.log(`[cf:deploy] artifact has ${n} registered routes`);
  } catch {
    /* manifest is informational only */
  }
}

console.log('[cf:deploy] artifact is current; deploying.');

const child = spawn('npx', ['wrangler', 'deploy', ...extraArgs], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, OPEN_NEXT_DEPLOY: 'true' },
});

child.on('error', (err) => {
  console.error('[cf:deploy] failed to start wrangler:', err.message);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[cf:deploy] wrangler terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
