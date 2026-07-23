import sql from '@/app/api/utils/sql';
import { requireAdmin } from '@/app/api/utils/authz';
import { getBetaFlags } from '@/app/api/utils/betaFlags';
import { getAiConfig } from '@/app/api/utils/ai-settings';
import { getTwilioConfig } from '@/app/api/utils/twilio-adapter';
import { getRollingP95 } from '@/app/api/utils/sla';
import { listPoolUsage } from '@/app/api/utils/numberPoolStore';
import { QUIET_HOURS } from '@/app/api/utils/dispatchGate';

/**
 * Phase H — System Health aggregation (ADMIN). One call powering every tile on
 * /system-health so the page makes a single request per refresh. Reads the same
 * data the individual admin endpoints expose; nothing here is published on the
 * public liveness probe (the split is preserved).
 *
 * Every tile carries a `status` of 'green' | 'amber' | 'red' with the threshold
 * documented inline. Thresholds are deliberately conservative for a beta.
 */
type Tile = { status: 'green' | 'amber' | 'red'; [k: string]: unknown };

async function dbTile(): Promise<Tile> {
  const start = Date.now();
  try {
    await sql`SELECT 1`;
    const latencyMs = Date.now() - start;
    // green <300ms · amber <1500ms · red otherwise (Neon over HTTP is ~100-400ms)
    const status = latencyMs < 300 ? 'green' : latencyMs < 1500 ? 'amber' : 'red';
    return { status, latencyMs };
  } catch (e: any) {
    return { status: 'red', error: 'unreachable' };
  }
}

async function jobsTile(): Promise<Tile> {
  try {
    // Depth = due-but-undrained work. Oldest lag = how overdue the oldest due
    // job is. A dead worker makes lag climb — this IS the kill-worker signal.
    const [row] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status IN ('pending','failed') AND run_at <= now())::int AS due,
        COUNT(*) FILTER (WHERE status IN ('pending','failed'))::int AS total_open,
        EXTRACT(EPOCH FROM (now() - MIN(run_at) FILTER (WHERE status IN ('pending','failed') AND run_at <= now())))::int AS oldest_lag_sec,
        MAX(updated_at) FILTER (WHERE status = 'completed') AS last_completed_at
      FROM jobs
    `;
    const lag = row?.oldest_lag_sec ?? 0;
    // green: nothing overdue >30s · amber: 30-120s (transient backlog) · red: >120s (worker likely down)
    const status = !row?.due || lag <= 30 ? 'green' : lag <= 120 ? 'amber' : 'red';
    return {
      status,
      due: row?.due ?? 0,
      openTotal: row?.total_open ?? 0,
      oldestLagSec: lag,
      lastDrainHeartbeat: row?.last_completed_at ?? null,
    };
  } catch {
    return { status: 'red', error: 'queue unreadable' };
  }
}

function workerTile(): Tile {
  // Always-on worker (container) vs Vercel Cron (every-minute). We can't see the
  // worker process from here; the jobs tile is the live liveness signal. This
  // reports the configured mode + poll interval.
  const mode = process.env.WORKER_MODE || (process.env.VERCEL ? 'cron (~60s)' : 'dev/always-on');
  const pollMs = Number(process.env.JOB_POLL_INTERVAL_MS || 3000);
  return { status: 'green', mode, pollIntervalMs: pollMs };
}

async function aiTile(): Promise<Tile> {
  try {
    const cfg = await getAiConfig();
    const configured = cfg.provider === 'ollama' ? Boolean(cfg.ollamaBaseUrl) : Boolean(process.env.ANTHROPIC_API_KEY);
    const p95 = await getRollingP95().catch(() => null);
    // green: provider configured · red: unconfigured
    const status = !configured ? 'red' : 'green';
    return {
      status,
      provider: cfg.provider,
      configured,
      replyP95Ms: p95?.p95Ms ?? null,
      p95Completed: p95?.completed ?? 0,
    };
  } catch {
    return { status: 'red', error: 'ai config unreadable' };
  }
}

function smsTile(flags: Record<string, boolean>): Tile {
  const twilio = getTwilioConfig();
  // Modes: mock | twilio-demo | twilio-live. twilioDemo flag (Phase T) selects demo.
  const mode = !twilio ? 'mock' : flags.twilioDemo ? 'twilio-demo' : 'twilio-live';
  // amber for live (real sends possible pre-A2P is a caution), green otherwise.
  const status = mode === 'twilio-live' ? 'amber' : 'green';
  return { status, mode, configured: Boolean(twilio) };
}

function voiceTile(flags: Record<string, boolean>): Tile {
  // Voice stays mock/stub until A2P; flag OFF = nothing dials.
  return { status: 'green', driver: 'mock', escalationEnabled: Boolean(flags.voiceEscalation) };
}

function quietHoursTile(): Tile {
  // Server-clock window state. NOTE: the gate enforces per-lead LOCAL time; this
  // tile is a general indicator (server tz), labeled as such in the UI.
  const hour = new Date().getHours();
  const withinWindow = hour >= QUIET_HOURS.startHour && hour < QUIET_HOURS.endHour;
  return {
    status: 'green',
    withinSendWindow: withinWindow,
    windowLabel: `${QUIET_HOURS.startHour}:00–${QUIET_HOURS.endHour}:00 (lead-local, per-send)`,
    serverHour: hour,
  };
}

async function poolTile(flags: Record<string, boolean>): Promise<Tile> {
  try {
    const usage = await listPoolUsage();
    const numbers = usage.numbers.length;
    const worstRemaining = numbers ? Math.min(...usage.numbers.map((n) => n.remaining)) : null;
    const capped = usage.numbers.filter((n) => n.remaining === 0).length;
    // amber if localPresence is ON but pool is empty (feature can't function),
    // or all numbers capped; green otherwise.
    let status: Tile['status'] = 'green';
    if (flags.localPresence && numbers === 0) status = 'amber';
    else if (numbers > 0 && capped === numbers) status = 'amber';
    return { status, numbers, capped, worstRemaining, rotationCap: usage.rotationCap, flagOn: Boolean(flags.localPresence) };
  } catch {
    return { status: 'red', error: 'pool unreadable' };
  }
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;

  const flags = await getBetaFlags().catch(() => ({} as Record<string, boolean>));

  const [db, jobs, ai, pool] = await Promise.all([dbTile(), jobsTile(), aiTile(), poolTile(flags)]);

  const tiles = {
    db,
    jobs,
    worker: workerTile(),
    ai,
    sms: smsTile(flags),
    voice: voiceTile(flags),
    quietHours: quietHoursTile(),
    numberPool: pool,
  };

  const worst = Object.values(tiles).some((t) => t.status === 'red')
    ? 'red'
    : Object.values(tiles).some((t) => t.status === 'amber')
      ? 'amber'
      : 'green';

  return Response.json({ overall: worst, tiles, flags, timestamp: new Date().toISOString() });
}
