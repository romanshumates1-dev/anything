import { NextRequest, NextResponse } from 'next/server';
import sql from '@/app/api/utils/sql';

/**
 * Per-KEY rate limiter for the public v1 API.
 *
 * Ghost-feature note (verification sprint 2026-07): the prior implementation
 * was inert dead code — never wired as Next middleware, keyed per-IP
 * (`pathname:ip`), and set X-RateLimit-* headers on a response object it never
 * returned. It has been rebuilt as a real, wired, per-KEY sliding-window
 * limiter. SaaS customers share NATs, so per-IP buckets would let one tenant
 * starve another; the bucket MUST be the API key.
 */

const WINDOW_MS = 60 * 1000;
const DEFAULT_LIMIT = 120;

// In-memory sliding-window log: hashed API key -> ascending request timestamps
// within the current window. Module-level, so it survives across requests in a
// single runtime instance (the same lifetime model as the original map).
const buckets = new Map<string, number[]>();

/** Test-only: clear all rate-limit state between cases. */
export function _resetRateLimitState(): void {
  buckets.clear();
}

async function sha256Hex(input: string): Promise<string> {
  // Web Crypto so this works in both the edge and node runtimes (node:crypto
  // is unavailable on the edge, where middleware runs by default).
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface SlidingWindowResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number; // epoch ms when the window frees up
  retryAfter: number; // seconds
}

/**
 * Pure sliding-window check. Records the hit only when allowed, so a blocked
 * caller cannot indefinitely push its own reset forward. Exported for direct
 * unit testing with a controlled `now`.
 */
export function slidingWindow(bucketId: string, limit: number, now: number): SlidingWindowResult {
  const windowStart = now - WINDOW_MS;
  const hits = (buckets.get(bucketId) ?? []).filter((t) => t > windowStart);

  if (hits.length >= limit) {
    buckets.set(bucketId, hits);
    const resetAt = hits[0] + WINDOW_MS;
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetAt,
      retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  hits.push(now);
  buckets.set(bucketId, hits);
  return {
    allowed: true,
    remaining: Math.max(0, limit - hits.length),
    limit,
    resetAt: hits[0] + WINDOW_MS,
    retryAfter: 0,
  };
}

/**
 * Enforce per-KEY rate limiting for /api/v1/* requests. Returns:
 *  - the passthrough response (`NextResponse.next()`) carrying X-RateLimit-*
 *    headers when the request is allowed,
 *  - a 401 when the key is missing/invalid/revoked (checked BEFORE consuming
 *    any rate-limit budget, so anonymous traffic can't burn a bucket),
 *  - a 429 with Retry-After + X-RateLimit-* when the key is over its limit.
 * Non-v1 paths pass through untouched (no auth, no budget, no DB call).
 */
export async function enforceRateLimit(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  // The Swagger UI docs page lives under /api/v1/docs but is a public HTML page,
  // not a keyed API endpoint — never rate-limit or 401 it.
  if (!pathname.startsWith('/api/v1/') || pathname === '/api/v1/docs') {
    return NextResponse.next();
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
  }
  const key = authHeader.slice(7).trim();
  if (!key) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  const keyHash = await sha256Hex(key);
  const prefix = key.split('_').slice(0, 2).join('_') + '_';

  const [record] = await sql`
    SELECT id, revoked, rate_limit_per_min
    FROM api_keys
    WHERE key_hash = ${keyHash} AND prefix = ${prefix}
    LIMIT 1
  `;

  if (!record || record.revoked) {
    return NextResponse.json({ error: 'Invalid or revoked API key' }, { status: 401 });
  }

  const limit = Number(record.rate_limit_per_min) || DEFAULT_LIMIT;
  const result = slidingWindow(keyHash, limit, Date.now());

  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };

  if (!result.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retryAfter: result.retryAfter },
      { status: 429, headers: { ...headers, 'Retry-After': String(result.retryAfter) } }
    );
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export function middleware(req: NextRequest): Promise<NextResponse> {
  return enforceRateLimit(req);
}

// Scope the limiter to the public v1 API ONLY. It must not intercept
// /api/system/health, provider webhooks, or app/page routes.
export const config = {
  matcher: '/api/v1/:path*',
};
