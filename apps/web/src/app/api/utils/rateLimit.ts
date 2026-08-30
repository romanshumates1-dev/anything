import sql from './sql';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Postgres-backed fixed-window rate limiter for public/semi-public endpoints
 * (contact form, review submission). Durable across restarts and safe across
 * many serverless instances — an in-memory Map (the prior implementation)
 * resets on every process restart and gives ~zero protection under Vercel,
 * where each invocation can land on a fresh isolate with no shared memory.
 *
 * Fixed-window buckets: `window_start` is `floor(now / windowSeconds)`, so a
 * concurrent burst on the same (identifier, action, window) serializes on
 * the row's primary key via `INSERT ... ON CONFLICT DO UPDATE` — a single
 * atomic round trip, no read-then-write race. Tradeoff (explicit, accepted):
 * fixed windows allow up to ~2x the limit across a window boundary (a burst
 * at the tail of one window plus the head of the next); a sliding window
 * would close that gap at the cost of a second query per call. Not worth it
 * for these low-frequency guards (5/hour, 3/day).
 */
export async function rateLimitByUser(
  identifier: string,
  action: string,
  maxRequests: number,
  windowSeconds: number = 3600
): Promise<RateLimitResult> {
  const windowMs = windowSeconds * 1000;
  const windowStartMs = Math.floor(Date.now() / windowMs) * windowMs;
  const windowStart = new Date(windowStartMs);
  const resetAt = new Date(windowStartMs + windowMs);

  const [row] = await sql`
    INSERT INTO rate_limits (identifier, action, window_start, count, updated_at)
    VALUES (${identifier}, ${action}, ${windowStart}, 1, now())
    ON CONFLICT (identifier, action, window_start)
    DO UPDATE SET count = rate_limits.count + 1, updated_at = now()
    RETURNING count
  `;
  const count = Number(row.count);

  // Opportunistic cleanup of expired windows (~1% of calls) — no cron
  // dependency; keeps the table from growing unbounded on a long-running
  // local deployment. Best-effort: failure here must never block the caller.
  if (Math.random() < 0.01) {
    sql`DELETE FROM rate_limits WHERE window_start < now() - interval '7 days'`.catch(
      (err: unknown) => console.error('rateLimit: cleanup failed', err)
    );
  }

  return {
    allowed: count <= maxRequests,
    remaining: Math.max(0, maxRequests - count),
    resetAt,
  };
}
