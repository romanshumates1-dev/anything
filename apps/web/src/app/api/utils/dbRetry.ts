/**
 * Bounded retry helper for transient database failures.
 *
 * ROOT CAUSE CONTEXT (random sign-outs): session reads and route queries run
 * over a single Neon WebSocket connection. A transient connection error
 * (cold-start socket reset, pool exhaustion, admin restart, network blip)
 * surfaces as a thrown error — for session reads that becomes a 401, which
 * the client interprets as "signed out". A strictly bounded retry on
 * connection-class errors only turns those blips into successes without
 * masking real query bugs.
 *
 * Design constraints:
 * - NEVER retry non-connection errors (syntax, unique violations, permission
 *   denied) — those are deterministic and retrying would hide real bugs.
 * - NEVER wrap transaction bodies — re-running partially-committed
 *   transaction logic is unsafe. Callers must opt in per-statement.
 * - Strictly bounded attempts (default: 1 retry) with short linear backoff,
 *   so worst-case added latency stays ~150ms per request.
 */

/** Patterns that indicate a connection-class (transient) failure. */
const TRANSIENT_DB_ERROR_PATTERNS: RegExp[] = [
  /connection\s+(terminated|refused|closed|reset|aborted|broken)/i,
  /connection\s+is\s+closed/i,
  /socket\s+connection\s+was\s+closed/i,
  /websocket/i, // neon serverless socket errors
  /terminating\s+connection/i, // Postgres 57P01 / 57P02 admin shutdown
  /too\s+many\s+clients/i, // Postgres 53300 — transient pool exhaustion
  /startup\s+packet/i,
  /ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/,
  /fetch\s+failed/i, // undici network blips (Workers / Node 18+)
  /network\s+error/i,
  /timeout/i,
];

/**
 * Whether an error looks like a transient connection-class failure rather
 * than a deterministic query bug. Never retries non-Error values except via
 * string coercion for safety.
 */
export function isTransientDbError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return TRANSIENT_DB_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export interface RunWithDbRetryOptions {
  /**
   * Total attempts allowed beyond the first. Default 1 (i.e., 2 total).
   * Kept minimal so worst-case added latency stays bounded.
   */
  attempts?: number;
  /** Base backoff in ms; linear (base * attemptIndex). Default 150ms. */
  baseDelayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run an async DB operation with a strictly bounded retry on transient
 * connection errors only. Non-transient errors are rethrown immediately.
 */
export async function runWithDbRetry<T>(
  run: () => Promise<T>,
  options: RunWithDbRetryOptions = {}
): Promise<T> {
  const attempts = options.attempts ?? 1;
  const baseDelayMs = options.baseDelayMs ?? 150;

  let lastError: unknown;
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      if (attempt < attempts && isTransientDbError(error)) {
        const delayMs = baseDelayMs * (attempt + 1);
        console.warn(
          `[dbRetry] transient DB error (attempt ${attempt + 1}/${attempts + 1}), ` +
            `retrying in ${delayMs}ms:`,
          error instanceof Error ? error.message : error
        );
        await sleep(delayMs);
        continue;
      }
      throw error;
    }
  }
  // Unreachable (loop either returns or throws), kept for exhaustiveness.
  throw lastError;
}
