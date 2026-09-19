#!/usr/bin/env node
/**
 * Clean rebuild + repatch + gate + deploy orchestrator.
 *
 * Runs `cf:build` (opennextjs-cloudflare build -- scrub -- patch), then
 * re-runs the size gate and secret guard against the fresh dry-run output,
 * then deploys with OPEN_NEXT_DEPLOY=true to bypass the broken wrapper.
 */
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';

const logFile = '/tmp/rebuild-deploy.log';

function ts() { return `[${new Date().toISOString()}]`; }
function log(msg) { const line = `${ts()} ${msg}`; console.log(line); writeFileSync(logFile, line + '\n', { flag: 'a' }); }

async function run(label, cmd, args, opts = {}) {
  log(`${label}: ${cmd} ${args.join(' ')} (cwd: ${opts.cwd || process.cwd()})`);
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: opts.cwd || process.cwd(),
    env: { ...process.env, ...opts.env },
  });
  const code = await new Promise(r => child.on('exit', r));
  if (code !== 0) { log(`ABORT: ${label} failed with code ${code}`); process.exit(code ?? 1); }
  log(`OK: ${label}`);
}

const root = process.cwd();
log('=== rebuild-and-deploy starting (clean) ===');
await run('build', 'npm', ['run', 'cf:build'], { cwd: root });
await run('gate', 'npm', ['run', 'cf:gate'], { cwd: root });
await run('deploy', 'npx', ['wrangler', 'deploy', '--outdir', '.wrangler/dry-run-out'], {
  cwd: root,
  env: { OPEN_NEXT_DEPLOY: 'true' },
});
log('=== rebuild-and-deploy DONE ===');
