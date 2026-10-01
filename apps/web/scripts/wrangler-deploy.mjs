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

const extraArgs = process.argv.slice(2);

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
