/**
 * Boot-time environment validation (Gap G-4).
 *
 * Fail fast with a NAMED list of what's missing instead of a late, cryptic
 * runtime error deep in a request. Pure `validateEnv` (unit-testable) + an
 * `assertEnv` that throws. Wired into Next's instrumentation `register()` for
 * the web app; the worker (scripts/worker.mjs) already fail-fasts on its own
 * required var. Hand-rolled to match the repo's manual-validation style (no zod
 * dependency).
 *
 * Conditional requirements: a var is only required when the feature that needs
 * it is switched on — enabling Stripe requires the whole Stripe set; running SMS
 * in live/twilio_test mode requires real Twilio creds + a sender. This is what
 * makes "flip a flag, forget a secret" fail at boot rather than mid-campaign.
 */
export type EnvContext = 'web' | 'worker';

export interface MissingVar {
  name: string;
  reason: string;
}

export function validateEnv(
  env: NodeJS.ProcessEnv = process.env,
  context: EnvContext = 'web'
): { ok: boolean; missing: MissingVar[] } {
  const missing: MissingVar[] = [];
  const req = (name: string, reason: string) => {
    if (!env[name]) missing.push({ name, reason });
  };

  if (context === 'web') {
    req('DATABASE_URL', 'Postgres connection string (Neon)');
    req('BETTER_AUTH_SECRET', 'session signing secret');
    req('BETTER_AUTH_URL', 'auth base URL');

    const provider = (env.AI_PROVIDER || 'anthropic').toLowerCase();
    if (provider === 'anthropic') {
      req('ANTHROPIC_API_KEY', 'AI_PROVIDER=anthropic requires a funded key');
    } else if (provider === 'ollama') {
      req('OLLAMA_BASE_URL', 'AI_PROVIDER=ollama requires a reachable host');
    }

    // Stripe is required as a complete set once the secret key is present.
    if (env.STRIPE_SECRET_KEY) {
      req('STRIPE_WEBHOOK_SECRET', 'Stripe webhook signature verification');
      req('STRIPE_PRICE_STARTER', 'checkout needs the starter price id');
      req('STRIPE_PRICE_PROFESSIONAL', 'checkout needs the professional price id');
    }

    // SMS: live / twilio_test (or Twilio creds present without an explicit mode)
    // requires real creds + a sender. mock mode requires nothing.
    const mode = (env.SMS_MODE || '').toLowerCase();
    const smsReal = mode === 'live' || mode === 'twilio_test' || (!mode && Boolean(env.TWILIO_ACCOUNT_SID));
    if (smsReal) {
      req('TWILIO_ACCOUNT_SID', 'live/twilio_test SMS requires a Twilio Account SID');
      req('TWILIO_AUTH_TOKEN', 'live/twilio_test SMS requires a Twilio Auth Token');
      if (!env.TWILIO_MESSAGING_SERVICE_SID && !env.TWILIO_FROM_NUMBER) {
        missing.push({
          name: 'TWILIO_MESSAGING_SERVICE_SID|TWILIO_FROM_NUMBER',
          reason: 'a sender is required (messaging service or from number)',
        });
      }
    }
  }

  if (context === 'worker') {
    req('JOB_RUNNER_SECRET', 'matches the /api/jobs/process gate');
    req('APP_URL', 'the app service URL the worker drains');
  }

  return { ok: missing.length === 0, missing };
}

export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/** Throw a named error listing every missing var. Call at boot. */
export function assertEnv(context: EnvContext = 'web', env: NodeJS.ProcessEnv = process.env): void {
  const { ok, missing } = validateEnv(env, context);
  if (!ok) {
    const list = missing.map((m) => `  - ${m.name}: ${m.reason}`).join('\n');
    throw new EnvValidationError(
      `Missing required environment variable(s) for the ${context} process:\n${list}`
    );
  }
}
