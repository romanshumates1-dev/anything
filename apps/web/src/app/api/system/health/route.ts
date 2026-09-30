import sql from '@/app/api/utils/sql';
import { getTwilioConfig } from '@/app/api/utils/twilio-adapter';
import { getAiConfig } from '@/app/api/utils/ai-settings';
import { getBedrockConfig } from '@/app/api/utils/bedrock-client';
import { timingSafeSecretEqual } from '@/app/api/utils/secretCompare';

/**
 * Bedrock is only "configured" when a model id is resolvable as well as AWS
 * credentials being present — a model id alone cannot serve a call.
 */
function aiConfiguredForBedrock(): boolean {
  return getBedrockConfig() !== null;
}

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

export async function GET(request: Request) {
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

  // AI = the ACTIVE provider is CONFIGURED (no live ping — a health probe must
  // stay fast). DEFECT (2026-09-30): this used to be
  //   `provider === 'ollama' ? ollamaBaseUrl : Boolean(ANTHROPIC_API_KEY)`
  // so a BEDROCK deployment was judged by the Anthropic key: it reported the AI
  // service down while Bedrock was configured, or up while Bedrock's AWS token
  // was invalid. The check now follows the provider that would actually serve.
  try {
    const ai = await getAiConfig();
    if (ai.provider === 'ollama') {
      services.ai = Boolean(ai.ollamaBaseUrl);
    } else if (ai.provider === 'bedrock') {
      services.ai = Boolean(
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && aiConfiguredForBedrock()
      );
    } else {
      services.ai = Boolean(process.env.ANTHROPIC_API_KEY);
    }
  } catch {
    services.ai = false;
  }

  services.sms = getTwilioConfig() !== null;

  const ok = services.db && services.jobs;

  // LIVENESS ONLY by default — booleans + status. Deliberately NO config:
  // no provider/driver names, no beta flags, no latency numbers, no number
  // type. This endpoint is unauthenticated and internet-facing in prod, so
  // publishing feature/vendor config here would re-open the Phase-5
  // info-disclosure. Config-bearing views live behind admin gates:
  //   flags   → GET /api/settings/beta-flags   (requireAdmin)
  //   ops     → /api/system/{readiness,database,metrics,queue-status} (requireAdmin)
  //   local   → scripts/launch-status.mjs (reads .env + DB directly, dev only)
  //
  // SECURITY (2026-09-27 live sweep): the public payload additionally carried
  // `version`, `uptime` and the per-service map. Each is reconnaissance:
  //   - `version` is an exact fingerprint for matching published CVEs
  //   - `services: {ai, sms}` discloses which integrations are CONFIGURED, and
  //     so which subsystems are worth attacking
  //   - `uptime` reveals how freshly the process was restarted
  // An uptime checker and a status dot only need `ok`, so the detail is
  // released solely to a caller presenting the ops secret. The local launcher
  // reads .env and the database directly, so it never needed it from here.
  const opsSecret = process.env.CRON_SECRET;
  const isOps =
    !!opsSecret && timingSafeSecretEqual(request.headers.get('x-cron-secret'), opsSecret);

  const base = {
    ok,
    status: ok ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
  };

  const payload = isOps
    ? { ...base, uptime: Math.floor((Date.now() - START_TIME) / 1000), version: VERSION, services }
    : base;

  return Response.json(payload, { status: ok ? 200 : 503 });
}
