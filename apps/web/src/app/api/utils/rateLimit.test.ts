/**
 * Durable Postgres-backed rate limiter (replaces the prior in-memory Map —
 * FINAL_STATE.md "durable rate limiting NOT DONE" / docs/AUDIT_2026-07-21.md).
 *
 * Two layers:
 *  - Mocked unit tests: count/allow/deny/remaining logic, always run.
 *  - Live-gated concurrency test (RUN_LIVE_FLOWS=1 + DATABASE_URL, same
 *    pattern as numberPoolStore.test.ts): proves the ON CONFLICT upsert
 *    actually serializes concurrent racers against a real Postgres — a JS
 *    mock can't prove atomicity, only the real row-level lock can.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql, buckets } = vi.hoisted(() => {
  const buckets = new Map<string, number>();
  const fn: any = vi.fn(async (strings: TemplateStringsArray, ...values: any[]) => {
    const text = strings.join('?');
    if (text.includes('INSERT INTO rate_limits')) {
      const [identifier, action, windowStart] = values;
      const key = `${identifier}:${action}:${(windowStart as Date).getTime()}`;
      const next = (buckets.get(key) || 0) + 1;
      buckets.set(key, next);
      return [{ count: next }];
    }
    if (text.includes('DELETE FROM rate_limits')) {
      return [];
    }
    return [];
  });
  return { mockSql: fn, buckets };
});
vi.mock('./sql', () => ({ default: mockSql }));

import { rateLimitByUser } from './rateLimit';

beforeEach(() => {
  buckets.clear();
  mockSql.mockClear();
});

describe('rateLimitByUser', () => {
  it('allows requests up to the limit, blocks the next one', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await rateLimitByUser('1.2.3.4', 'contact', 5);
      expect(r.allowed).toBe(true);
    }
    const sixth = await rateLimitByUser('1.2.3.4', 'contact', 5);
    expect(sixth.allowed).toBe(false);
    expect(sixth.remaining).toBe(0);
  });

  it('remaining decrements correctly within the window', async () => {
    const r1 = await rateLimitByUser('9.9.9.9', 'review', 3);
    expect(r1.remaining).toBe(2);
    const r2 = await rateLimitByUser('9.9.9.9', 'review', 3);
    expect(r2.remaining).toBe(1);
    const r3 = await rateLimitByUser('9.9.9.9', 'review', 3);
    expect(r3.remaining).toBe(0);
  });

  it('different identifiers do not share a bucket', async () => {
    for (let i = 0; i < 3; i++) await rateLimitByUser('user-a', 'review', 3);
    const blocked = await rateLimitByUser('user-a', 'review', 3);
    expect(blocked.allowed).toBe(false);

    // user-b, same action — independent budget
    const other = await rateLimitByUser('user-b', 'review', 3);
    expect(other.allowed).toBe(true);
    expect(other.remaining).toBe(2);
  });

  it('different actions on the same identifier do not share a bucket', async () => {
    for (let i = 0; i < 5; i++) await rateLimitByUser('shared-ip', 'contact', 5);
    const contactBlocked = await rateLimitByUser('shared-ip', 'contact', 5);
    expect(contactBlocked.allowed).toBe(false);

    const reviewStillOpen = await rateLimitByUser('shared-ip', 'review', 3);
    expect(reviewStillOpen.allowed).toBe(true);
  });

  it('resetAt lands at the end of the current fixed window, in the future', async () => {
    const before = Date.now();
    const r = await rateLimitByUser('1.1.1.1', 'contact', 5, 3600);
    expect(r.resetAt.getTime()).toBeGreaterThan(before);
    expect(r.resetAt.getTime() - before).toBeLessThanOrEqual(3600 * 1000);
  });

  it('issues a single atomic upsert per call (no separate read-then-write)', async () => {
    await rateLimitByUser('atomic-check', 'contact', 5);
    const insertCalls = mockSql.mock.calls.filter((c: any) => c[0].join('?').includes('INSERT INTO rate_limits'));
    expect(insertCalls.length).toBe(1);
  });
});

// ─── Live concurrency proof ──────────────────────────────────────────────────

const LIVE = process.env.RUN_LIVE_FLOWS === '1' && !!process.env.DATABASE_URL;

describe.skipIf(!LIVE)('rateLimitByUser — concurrency (live DB)', () => {
  it('5 concurrent callers on a limit-of-2 bucket: exactly 2 allowed, never over-grants', async () => {
    vi.doUnmock('./sql');
    vi.resetModules();
    const { default: sql } = await import('./sql');
    const { rateLimitByUser: liveRateLimit } = await import('./rateLimit');

    const identifier = `live-test-${crypto.randomUUID()}`;
    await sql`DELETE FROM rate_limits WHERE identifier = ${identifier}`;

    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, () => liveRateLimit(identifier, 'contact', 2, 3600))
      );
      const allowedCount = results.filter((r) => r.allowed).length;
      expect(allowedCount).toBe(2);

      const [row] = await sql`
        SELECT count FROM rate_limits WHERE identifier = ${identifier} AND action = 'contact'
      `;
      expect(Number(row.count)).toBe(5);
    } finally {
      await sql`DELETE FROM rate_limits WHERE identifier = ${identifier}`;
    }
  });
});

describe.skipIf(LIVE)('rateLimitByUser — live concurrency test skipped', () => {
  it('is intentionally skipped without RUN_LIVE_FLOWS=1 + DATABASE_URL', () => {
    expect(LIVE).toBe(false);
  });
});
