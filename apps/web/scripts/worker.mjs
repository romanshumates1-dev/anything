/**
 * Production job worker — the always-on drain loop for containers/hosts.
 *
 * Unlike scripts/jobs-dev.mjs (which has a dev pidfile single-instance lock and
 * targets localhost), this is the process the `worker` container runs: it polls
 * POST {APP_URL}/api/jobs/process every JOB_POLL_INTERVAL_MS forever, draining
 * the Postgres `jobs` queue at seconds granularity. This is what makes the
 * INT-1 Speed-to-Lead SLA real in prod (the OWNER-BLOCKED item): with this
 * running + AI_PROVIDER=anthropic on the reply path, inbound→dispatch latency
 * is measurable and enforced by the ack fallback.
 *
 * Env:
 *   APP_URL                default http://app:4000  (the app service)
 *   JOB_RUNNER_SECRET      required — matches the /api/jobs/process gate
 *   JOB_POLL_INTERVAL_MS   default 3000
 *   JOB_BATCH              default 25 (max jobs drained per poll)
 *
 * Graceful shutdown on SIGTERM/SIGINT so `docker stop` / a rolling deploy does
 * not sever an in-flight drain.
 */
const APP_URL = process.env.APP_URL || 'http://app:4000';
const SECRET = process.env.JOB_RUNNER_SECRET || '';
const INTERVAL_MS = Number(process.env.JOB_POLL_INTERVAL_MS || 3000);
const BATCH = Number(process.env.JOB_BATCH || 25);

if (!SECRET) {
  console.error('[worker] JOB_RUNNER_SECRET not set — refusing to start (the drain endpoint would reject every call).');
  process.exit(1);
}

let running = true;
let inFlight = false;

async function drainOnce() {
  if (inFlight) return; // never overlap polls
  inFlight = true;
  try {
    const res = await fetch(`${APP_URL}/api/jobs/process`, {
      method: 'POST',
      headers: { 'x-job-runner-secret': SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ batch: BATCH }),
    });
    if (!res.ok) {
      console.error(`[worker] drain HTTP ${res.status}`);
    } else {
      const body = await res.json().catch(() => ({}));
      if (body?.processed) console.log(`[worker] drained ${body.processed} job(s)`);
    }
  } catch (err) {
    // Transient (app not up yet, network blip) — log and keep looping.
    console.error('[worker] drain error:', err?.message || err);
  } finally {
    inFlight = false;
  }
}

function shutdown(sig) {
  console.log(`[worker] ${sig} received — finishing current drain then exiting.`);
  running = false;
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[worker] starting — polling ${APP_URL}/api/jobs/process every ${INTERVAL_MS}ms (batch ${BATCH})`);
while (running) {
  await drainOnce();
  // Sleep in short slices so shutdown is responsive.
  for (let waited = 0; waited < INTERVAL_MS && running; waited += 200) {
    await new Promise((r) => setTimeout(r, Math.min(200, INTERVAL_MS - waited)));
  }
}
console.log('[worker] stopped cleanly.');
process.exit(0);
