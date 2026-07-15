import sql from '@/app/api/utils/sql';
import { getTwilioConfig } from '@/app/api/utils/twilio-adapter';
import { getBetaFlags } from '@/app/api/utils/betaFlags';
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
 * betaFlags are non-secret feature toggles; exposing them here is what lets the
 * launcher print the flag table and satisfies "toggling a flag is reflected in
 * /api/health within 1s" (flag cache TTL is 500ms + bust-on-write).
 */
const START_TIME = Date.now();
const VERSION = process.env.APP_VERSION || '0.1.0';

export async function GET() {
  const services = { db: false, jobs: false, ai: false, sms: false };
  let dbLatency: number | null = null;

  try {
    const dbStart = Date.now();
    await sql`SELECT 1`;
    dbLatency = Date.now() - dbStart;
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
  const drivers = { ai: 'unknown' as string, sms: 'mock' as string };
  try {
    const ai = await getAiConfig();
    drivers.ai = ai.provider;
    services.ai = ai.provider === 'ollama' ? Boolean(ai.ollamaBaseUrl) : Boolean(process.env.ANTHROPIC_API_KEY);
  } catch {
    services.ai = false;
  }

  const twilioConfig = getTwilioConfig();
  services.sms = twilioConfig !== null;
  drivers.sms = twilioConfig !== null ? 'twilio' : 'mock';

  let betaFlags;
  try {
    betaFlags = await getBetaFlags();
  } catch {
    betaFlags = undefined;
  }

  const ok = services.db && services.jobs;

  return Response.json(
    {
      ok,
      status: ok ? 'healthy' : 'degraded',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version: VERSION,
      services,
      drivers,
      betaFlags,
      database: { connected: services.db, latencyMs: dbLatency },
      twilio: { configured: services.sms, numberType: twilioConfig?.numberType || null },
      timestamp: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 }
  );
}
