#!/usr/bin/env node
/**
 * Pipeline Startup Script
 *
 * Starts all pipeline components:
 * 1. Monitor API (port 4001)
 * 2. Job Worker
 * 3. Self-Healing System
 *
 * Run: node --env-file=.env scripts/start-pipeline.mjs
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

console.log('');
console.log('╔════════════════════════════════════════════════════════════════╗');
console.log('║  DEALFLOW AI PIPELINE SYSTEM                                   ║');
console.log('╠════════════════════════════════════════════════════════════════╣');
console.log('║  Starting all pipeline components...                           ║');
console.log('╚════════════════════════════════════════════════════════════════╝');
console.log('');

const processes = [];

function startProcess(name, script, color) {
  const proc = spawn('node', ['--env-file=.env', script], {
    cwd: join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const prefix = `[${name}]`;
  const colors = { blue: '\x1b[34m', green: '\x1b[32m', yellow: '\x1b[33m', reset: '\x1b[0m' };
  const c = colors[color] || colors.reset;

  proc.stdout.on('data', data => {
    data.toString().split('\n').filter(Boolean).forEach(line => {
      console.log(`${c}${prefix}${colors.reset} ${line}`);
    });
  });

  proc.stderr.on('data', data => {
    data.toString().split('\n').filter(Boolean).forEach(line => {
      console.log(`${c}${prefix}${colors.reset} \x1b[31m${line}\x1b[0m`);
    });
  });

  proc.on('exit', code => {
    console.log(`${c}${prefix}${colors.reset} Process exited with code ${code}`);
  });

  processes.push({ name, proc });
  return proc;
}

// Start components
startProcess('MONITOR', 'scripts/monitor-api.mjs', 'blue');
startProcess('WORKER ', 'scripts/job-worker.mjs', 'green');
startProcess('HEALER ', 'scripts/pipeline-healer.mjs', 'yellow');

console.log('');
console.log('Components starting...');
console.log('');
console.log('Dashboards:');
console.log('  Campaign Monitor: http://localhost:4000/monitor.html');
console.log('  Pipeline Monitor: http://localhost:4000/pipeline.html');
console.log('');
console.log('Press Ctrl+C to stop all components');
console.log('');

// Handle shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down all components...');
  processes.forEach(({ name, proc }) => {
    console.log(`  Stopping ${name}...`);
    proc.kill('SIGINT');
  });
  setTimeout(() => process.exit(0), 1000);
});
