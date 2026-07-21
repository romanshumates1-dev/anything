import sql from './sql';

interface RateLimitResult {
  allowed: boolean;
  remaining?: number;
  resetAt?: Date;
}

/**
 * Simple in-memory rate limiter for contact form and auth endpoints.
 * Uses a Map keyed by action+identifier, with automatic cleanup.
 * For production, consider Redis-backed implementation.
 */
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
const CLEANUP_INTERVAL = 60 * 1000; // 1 minute

// Cleanup expired entries
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now > value.resetAt) {
      rateLimitStore.delete(key);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Rate limit by IP address (key). Simple in-memory implementation.
 * For IP-based rate limiting (contact forms, public endpoints).
 */
export async function rateLimitByUser(
  key: string,
  action: string,
  maxRequests: number,
  windowSeconds: number = 3600
): Promise<RateLimitResult> {
  const storeKey = `${action}:${key}`;
  const now = Date.now();
  const resetAt = now + windowSeconds * 1000;

  const current = rateLimitStore.get(storeKey);
  if (!current || now > current.resetAt) {
    rateLimitStore.set(storeKey, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt: new Date(resetAt) };
  }

  if (current.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: new Date(current.resetAt) };
  }

  current.count++;
  rateLimitStore.set(storeKey, current);
  return { allowed: true, remaining: maxRequests - current.count, resetAt: new Date(current.resetAt) };
}

/**
 * Database-backed rate limiter for authenticated actions.
 * Uses a dedicated rate_limits table.
 */
export async function rateLimitDb(
  userId: string,
  action: string,
  maxRequests: number,
  windowSeconds: number = 60
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - windowSeconds * 1000);
  
  const [{ count }] = await sql`
    SELECT COUNT(*)::int as count FROM rate_limits
    WHERE user_id = ${userId} AND action = ${action} AND created_at > ${windowStart}
  `;
  
  const canProceed = count < maxRequests;
  
  // Record this request if allowed
  if (canProceed) {
    await sql`
      INSERT INTO rate_limits (id, user_id, action, created_at)
      VALUES ('rl_' || gen_random_uuid()::text, ${userId}, ${action}, now())
    `;
  }
  
  return {
    allowed: canProceed,
    remaining: Math.max(0, maxRequests - count - (canProceed ? 1 : 0)),
    resetAt: new Date(Date.now() + windowSeconds * 1000),
  };
}