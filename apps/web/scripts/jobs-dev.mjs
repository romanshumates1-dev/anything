import { readFileSync, writeFileSync, unlinkSync } from 'fs';

/**
 * Dev-mode job runner.
 *
 * Usage:  yarn jobs:dev   (run in a second terminal alongside yarn dev)
 *
 * Polls POST /api/jobs/process every 3 seconds to drain the job queue.
 * In production, cron or docker-compose owns this — do NOT run this script there.
 *
 * Requires JOB_RUNNER_SECRET in .env (same value the /api/jobs/process route checks).
 */

const BASE = process.env.DEV_BASE_URL || 'http://localhost:4000';
const SECRET = process.env.JOB_RUNNER_SECRET || '';
const INTERVAL_MS = 3000;

if (!SECRET) {
  console.error('[jobs-dev] JOB_RUNNER_SECRET not set in env. Exiting.');
  process.exit(1);
}

const PIDFILE = new URL('../.jobs-dev.pid', import.meta.url);

// Single-instance lock check
function acquireLock() {
  let existingPid = null;
  try {
    const content = readFileSync(PIDFILE, 'utf8');
    existingPid = parseInt(content.trim(), 10);
    if (!Number.isNaN(existingPid)) {
      // Check if process is alive by sending signal 0
      try {
        process.kill(existingPid, 0);
        // Process exists - refuse to start
        console.error(`[jobs-dev] already running, PID ${existingPid}`);
        process.exit(1);
      } catch (e) {
        // Process not alive, stale pidfile - proceed
      }
    }
  } catch (e) {
    // No pidfile exists - proceed
  }
  
  // Write current PID
  writeFileSync(PIDFILE, `${process.pid}\n`);
}

function releaseLock() {
  try {
    unlinkSync(PIDFILE);
  } catch (e) {
    // Ignore cleanup errors
  }
}

acquireLock();

let running = true;

async function tick() {
  try {
    const res = await fetch(`${BASE}/api/jobs/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-job-runner-secret': SECRET,
      },
      body: '{}',
    });
    if (!res.ok) {
      console.error(`[jobs-dev] /api/jobs/process → ${res.status} ${res.statusText}`);
      return;
    }
    const data = await res.json();
    if (data.processed > 0) {
      console.log(`[jobs-dev] processed ${data.processed} job(s)`);
    }
  } catch (err) {
    // Server not ready yet — that's fine, retry next tick
    if (err.cause?.code === 'ECONNREFUSED') {
      console.log('[jobs-dev] server not ready, waiting...');
    } else {
      console.error('[jobs-dev] error:', err.message);
    }
  }
}

async function loop() {
  console.log(`[jobs-dev] polling ${BASE}/api/jobs/process every ${INTERVAL_MS}ms`);
  while (running) {
    await tick();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

function shutdown() {
  console.log('\n[jobs-dev] shutting down');
  running = false;
  releaseLock();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

loop();