/**
 * DURABLE per-key rate limiting for /api/v1/*.
 *
 * The edge `middleware.ts` limiter is real and per-key, but its state is a
 * module-level Map and this project deploys to Cloudflare Workers, where that
 * is per-isolate and lost on eviction. These tests pin the route-layer
 * (Postgres-backed) limiter that makes the limit hold across isolates.
 *
 * Strategy applied: equivalence partitioning (under / at / over the limit),
 * boundary values, per-key isolation, and an explicit fail-open assertion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { rateLimitByUser } = vi.hoisted(() => ({ rateLimitByUser: vi.fn() }));
vi.mock('@/app/api/utils/rateLimit', () => ({ rateLimitByUser }));

import {
  consumeApiKeyRateLimit,
  rateLimitRejection,
  rateLimitHeaders,
} from '@/app/api/utils/apiKeyRateLimit';

const FUTURE = () => new Date(Date.now() + 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe('consumeApiKeyRateLimit', () => {
  it('allows a request inside the budget', async () => {
    rateLimitByUser.mockResolvedValue({ allowed: true, remaining: 119, resetAt: FUTURE() });
    const res = await consumeApiKeyRateLimit('k1', 120);
    expect(res.allowed).toBe(true);
    expect(res.limit).toBe(120);
    expect(res.remaining).toBe(119);
  });

  it('denies once the key is over its limit (boundary: N+1)', async () => {
    rateLimitByUser.mockResolvedValue({ allowed: false, remaining: 0, resetAt: FUTURE() });
    const res = await consumeApiKeyRateLimit('k1', 120);
    expect(res.allowed).toBe(false);
  });

  it('buckets by key id, never by secret material', async () => {
    rateLimitByUser.mockResolvedValue({ allowed: true, remaining: 5, resetAt: FUTURE() });
    await consumeApiKeyRateLimit('k_abc123', 120);
    expect(rateLimitByUser).toHaveBeenCalledWith(
      'apikey:k_abc123',
      'v1_api',
      120,
      60
    );
  });

  it('isolates budgets per key — one noisy key cannot starve another', async () => {
    rateLimitByUser.mockImplementation(async (id: string) => ({
      allowed: id !== 'apikey:noisy',
      remaining: id === 'apikey:noisy' ? 0 : 60,
      resetAt: FUTURE(),
    }));
    const noisy = await consumeApiKeyRateLimit('noisy', 120);
    const quiet = await consumeApiKeyRateLimit('quiet', 120);
    expect(noisy.allowed).toBe(false);
    expect(quiet.allowed).toBe(true);
  });

  it('falls back to a safe default when the key has no usable limit', async () => {
    rateLimitByUser.mockResolvedValue({ allowed: true, remaining: 1, resetAt: FUTURE() });
    await consumeApiKeyRateLimit('k1', null);
    expect(rateLimitByUser).toHaveBeenCalledWith('apikey:k1', 'v1_api', 120, 60);
    // 0 and negatives are nonsense config, not "unlimited".
    await consumeApiKeyRateLimit('k1', 0);
    expect(rateLimitByUser).toHaveBeenLastCalledWith('apikey:k1', 'v1_api', 120, 60);
  });

  it('FAILS OPEN when the limiter itself errors (deliberate, documented)', async () => {
    rateLimitByUser.mockRejectedValue(new Error('rate_limits table unreachable'));
    const res = await consumeApiKeyRateLimit('k1', 120);
    expect(res.allowed).toBe(true);
  });

  it('fails CLOSED on request, for money-movement routes', async () => {
    rateLimitByUser.mockRejectedValue(new Error('db down'));
    await expect(
      consumeApiKeyRateLimit('k1', 120, { failClosed: true })
    ).rejects.toThrow('db down');
  });
});

describe('rateLimitRejection', () => {
  it('returns null when within budget so the caller proceeds', () => {
    const res = rateLimitRejection({
      allowed: true, limit: 120, remaining: 5, resetAt: FUTURE(), retryAfterSeconds: 0,
    });
    expect(res).toBeNull();
  });

  it('returns 429 with Retry-After and X-RateLimit-* headers when over', async () => {
    const resetAt = FUTURE();
    const res = rateLimitRejection({
      allowed: false, limit: 120, remaining: 0, resetAt, retryAfterSeconds: 42,
    });
    expect(res!.status).toBe(429);
    expect(res!.headers.get('Retry-After')).toBe('42');
    expect(res!.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(res!.headers.get('X-RateLimit-Remaining')).toBe('0');
    const body = await res!.json();
    expect(body.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});

describe('rateLimitHeaders', () => {
  it('exposes limit/remaining/reset so clients can self-throttle', () => {
    const resetAt = new Date(1_800_000_000_000);
    const h = rateLimitHeaders({ allowed: true, limit: 60, remaining: 7, resetAt, retryAfterSeconds: 0 });
    expect(h['X-RateLimit-Limit']).toBe('60');
    expect(h['X-RateLimit-Remaining']).toBe('7');
    expect(h['X-RateLimit-Reset']).toBe('1800000000');
  });
});