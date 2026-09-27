/**
 * DURABLE per-key rate limiting for the /api/v1 API.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `middleware.ts` already enforces a per-KEY sliding window on /api/v1/* and
 * returns 429 + Retry-After + X-RateLimit-*. That limiter is correct in shape
 * (keyed by key, not by IP, so NAT-sharing tenants cannot starve each other)
 * and it is genuinely wired. It is NOT sufficient alone, because its state is a
 * module-level Map:
 *
 *     const buckets = new Map<string, number[]>();
 *
 * This project deploys to Cloudflare Workers (`npm run cf:deploy` ->
 * opennextjs-cloudflare). Middleware runs on the edge runtime, where that Map is
 * per-isolate: not shared between isolates or PoPs, and discarded on eviction.
 * An attacker spreading requests across isolates resets the counter every time.
 * The codebase already documents this exact hazard in `utils/rateLimit.ts`:
 * "an in-memory Map ... gives ~zero protection under Vercel, where each
 * invocation can land on a fresh isolate with no shared memory."
 *
 * So this adds the AUTHORITATIVE, durable check in the route layer, where a
 * Postgres round trip already happens for the key lookup: one extra atomic
 * upsert on a path that is already doing I/O. The edge limiter stays as a cheap
 * fast path that sheds bursts without touching the database.
 *
 * FAIL-OPEN, DELIBERATELY
 * -----------------------
 * If the limiter query fails we allow the request through. A rate limiter is an
 * abuse-shedding control, not an authorization control. Failing closed would
 * turn a partial outage of one table into a total outage of the whole v1 API for
 * every customer, while the controls that actually protect data (api_keys
 * lookup, revoked check, owner domain + role check) have already succeeded.
 *
 * This would be the WRONG choice on a money-movement endpoint, where an
 * unbounded retry window is itself a financial risk. None of the /api/v1/*
 * routes move money (contacts, campaigns, conversations, analytics, approvals),
 * so fail-open is safe here. A financial route added under /api/v1 must pass
 * `{ failClosed: true }`.
 */
import { NextResponse } from 'next/server';
import { rateLimitByUser } from '@/app/api/utils/rateLimit';

const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = 120;

export interface ApiKeyLimitOptions {
  /** Deny the request when the limiter itself errors. Default false (fail-open). */
  failClosed?: boolean;
}

export interface ApiKeyLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: Date;
  retryAfterSeconds: number;
}

/**
 * Count this request against the key's per-minute budget.
 *
 * The bucket identifier is the key's database id, never secret material, so
 * nothing sensitive lands in the `rate_limits` table and one key can never
 * consume another key's budget.
 */
export async function consumeApiKeyRateLimit(
  keyId: string,
  limit: number | null | undefined,
  options: ApiKeyLimitOptions = {}
): Promise<ApiKeyLimitResult> {
  const effectiveLimit = Number(limit) > 0 ? Number(limit) : DEFAULT_LIMIT;

  try {
    const result = await rateLimitByUser(
      `apikey:${keyId}`,
      'v1_api',
      effectiveLimit,
      WINDOW_SECONDS
    );
    return {
      allowed: result.allowed,
      limit: effectiveLimit,
      remaining: result.remaining,
      resetAt: result.resetAt,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((result.resetAt.getTime() - Date.now()) / 1000)
      ),
    };
  } catch (error) {
    if (options.failClosed) throw error;
    console.error('[api-key-rate-limit] limiter unavailable, failing open', error);
    return {
      allowed: true,
      limit: effectiveLimit,
      remaining: effectiveLimit,
      resetAt: new Date(Date.now() + WINDOW_SECONDS * 1000),
      retryAfterSeconds: 0,
    };
  }
}

/** Standard rate-limit headers so clients can self-throttle correctly. */
export function rateLimitHeaders(result: ApiKeyLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt.getTime() / 1000)),
  };
}

/** 429 body + headers. Returns null when the request is within budget. */
export function rateLimitRejection(result: ApiKeyLimitResult): NextResponse | null {
  if (result.allowed) return null;
  return NextResponse.json(
    {
      error: 'Rate limit exceeded',
      code: 'RATE_LIMIT_EXCEEDED',
      details: {
        limit: result.limit,
        remaining: result.remaining,
        retryAfterSeconds: result.retryAfterSeconds,
      },
    },
    {
      status: 429,
      headers: {
        ...rateLimitHeaders(result),
        'Retry-After': String(result.retryAfterSeconds),
      },
    }
  );
}