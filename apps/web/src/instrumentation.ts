/**
 * Next instrumentation — runs once when the server boots (G-4).
 *
 * Validates required env in the Node server runtime. In production a missing
 * required var THROWS from register(), which aborts server startup with the
 * named list (fail fast). In dev it logs the same list but lets the server run,
 * so local work isn't blocked by, e.g., an unset Stripe secret.
 */
import { assertEnv, validateEnv } from '@/app/api/utils/env-validation';

export function register() {
  // Only the Node.js server runtime — skip the edge runtime (middleware).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  if (process.env.NODE_ENV === 'production') {
    assertEnv('web'); // throws EnvValidationError → boot aborts with named vars
    return;
  }

  const { ok, missing } = validateEnv(process.env, 'web');
  if (!ok) {
    console.warn(
      '[env] Missing env (non-fatal in dev):\n' +
        missing.map((m) => `  - ${m.name}: ${m.reason}`).join('\n')
    );
  }
}
