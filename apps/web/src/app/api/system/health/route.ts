import sql from '@/app/api/utils/sql';
import { getTwilioConfig } from '@/app/api/utils/twilio-adapter';
import { getAiConfig } from '@/app/api/utils/ai-settings';

/**
 * PUBLIC health probe — used by uptime checks, the Shell status dot, and the
 * P1 launcher's readiness loop (which is unauthenticated, so this must stay
 * public). Deliberately booleans-only: no counts, no error text, no internals.
 * (Detailed ops data lives in the ADMIN-gated /api/system/{readiness,database,
 * metrics,queue-status}.)
 *
 * `ok` = the app is USABLE (db + job queue reachable). ai/sms are reported for
 * the launcher's status table but do NOT gate `ok` — an unconfigured Twilio or
 * a $0 AI balance is degraded, not broken, and must not block a dev launch.
 *
 * Flags are NOT exposed here (admin route only) — see the response comment.
 */
const START_TIME = Date.now();
const VERSION = process.env.APP_VERSION || '0.1.0';

export async function GET() {
  const services = { db: false, jobs: false, ai: false, sms: false };

  try {
    await sql`SELECT 1`;
    services.db = true;
  } catch {
    services.db = false;
  }

  // Job queue reachable (the drain loop itself is exercised by /api/jobs/process;
  // this only asserts the queue table is usable).
  try {
    await sql`SELECT 1 FROM jobs LIMIT 1`;
    services.jobs = true;
  } catch {
    services.jobs = false;
  }

  // AI = a provider is CONFIGURED (no live ping — a health probe must stay fast).
  try {
    const ai = await getAiConfig();
    services.ai = ai.provider === 'ollama' ? Boolean(ai.ollamaBaseUrl) : Boolean(process.env.ANTHROPIC_API_KEY);
  } catch {
    services.ai = false;
  }

  services.sms = getTwilioConfig() !== null;

  const ok = services.db && services.jobs;

  // LIVENESS ONLY — booleans + uptime/version. Deliberately NO config:
  // no provider/driver names, no beta flags, no latency numbers, no number
  // type. This endpoint is unauthenticated and internet-facing in prod, so
  // publishing feature/vendor config here would re-open the Phase-5
  // info-disclosure. Config-bearing views live behind admin gates:
  //   flags   → GET /api/settings/beta-flags   (requireAdmin)
  //   ops     → /api/system/{readiness,database,metrics,queue-status} (requireAdmin)
  //   local   → scripts/launch-status.mjs (reads .env + DB directly, dev only)
  return Response.json(
    {
      ok,
      status: ok ? 'healthy' : 'degraded',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version: VERSION,
      services,
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
