/**
 * Boot-time environment validation (Prompt 1 Phase 5).
 *
 * Next.js calls register() once when the server process starts (dev, start,
 * and any custom worker that imports this) — the standard place to fail fast
 * on missing config instead of failing lazily on the first request that
 * touches the missing var.
 *
 * Scope is deliberately narrow: only vars with NO safe runtime fallback are
 * hard-required (exit 1). Twilio/Stripe/AI-provider keys are NOT hard-required
 * here — the app's own design already treats them as optional-with-mock-
 * fallback (getTwilioConfig() returns null gracefully, stripeProvider defaults
 * to 'mock', etc.), and hard-failing boot on their absence would break the
 * normal local-dev mode this repo runs in every day. Those are soft-warned
 * instead, so an operator sees what's NOT configured without the app refusing
 * to start.
 *
 * BETTER_AUTH_SECRET is hard-required despite never being read directly by
 * app code (better-auth reads it implicitly from the env) — a missing signing
 * secret passed every existing check before this (BREAKAGE_TABLE #Phase0 env
 * finding); it's the one var whose absence corrupts every session silently
 * rather than crashing loudly.
 *
 * CLOUDFLARE WORKERS CAVEAT
 * On Workers, a throw from register() happens during module evaluation, i.e.
 * at Worker startup. That does not "fail fast" — it takes down EVERY route with
 * an opaque 500, including /api/system/health, which is what you would use to
 * diagnose it. So on workerd we log the same FATAL line and continue; the
 * individual request surfaces the real error instead. Node (dev/Docker/CI)
 * keeps the original throw-on-boot behaviour.
 */
import { isCloudflareWorkers } from '@/lib/websocket';

const HARD_REQUIRED = ['DATABASE_URL', 'BETTER_AUTH_SECRET'] as const;

const SOFT_RECOMMENDED = [
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY',
  'LEGAL_ENTITY_NAME',
  'SUPPORT_EMAIL',
] as const;

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return; // skip edge/middleware compile

  const missing = HARD_REQUIRED.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(
      `\n[boot] FATAL: missing required environment variable(s): ${missing.join(', ')}\n` +
        `[boot] The app cannot start without these. Set them in apps/web/.env (see .env.example) and retry.\n`
    );

    if (isCloudflareWorkers()) {
      // Do NOT throw — see the CLOUDFLARE WORKERS CAVEAT above. A startup throw
      // kills every route, including the health probe used to diagnose it.
      // eslint-disable-next-line no-console
      console.error(
        `[boot] Running on Cloudflare Workers — continuing instead of throwing so the\n` +
          `[boot] health probe stays reachable. Set these via \`wrangler secret put\`.\n`
      );
      return;
    }

    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const unset = SOFT_RECOMMENDED.filter((name) => !process.env[name]);
  if (unset.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[boot] NOTE: ${unset.join(', ')} not set — related features run in mock/degraded mode.`
    );
  }
}
