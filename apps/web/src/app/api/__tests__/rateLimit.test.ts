/**
 * Item 4 — per-KEY rate limiting (behavioral).
 *
 * The prior implementation was inert (never wired) and keyed per-IP. This
 * verifies the rebuilt limiter:
 *  - buckets are per API KEY, not per IP (key B unaffected while key A is maxed
 *    on the SAME ip) — the definitive per-KEY vs per-IP assertion
 *  - the 121st request for a 120/min key -> 429 with Retry-After + X-RateLimit-*
 *    headers ON THE RETURNED RESPONSE
 *  - the limit is read from the key record (limit 2 -> 3rd request fails)
 *  - missing/invalid/revoked key -> 401 BEFORE any rate-limit budget is spent
 *  - the matcher is scoped to /api/v1/* only (health endpoint untouched)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

import { enforceRateLimit, slidingWindow, _resetRateLimitState } from '@/middleware';

function v1Req(key: string, ip = '10.0.0.1') {
  return new NextRequest('http://localhost/api/v1/contacts', {
    headers: { authorization: `Bearer ${key}`, 'x-forwarded-for': ip },
  });
}

function keyRecord(limit = 120, revoked = false, owner: Partial<{ email: string; role: string }> = {}) {
  // Domain lock layer 4: the limiter also verifies the key OWNER, so a valid
  // owner is part of the default fixture.
  return [
    {
      id: 'k1',
      revoked,
      rate_limit_per_min: limit,
      owner_email: owner.email ?? 'ops@dealswiftautomation.com',
      owner_role: owner.role ?? 'ADMIN',
    },
  ];
}

beforeEach(() => {
  _resetRateLimitState();
  mockSql.mockReset();
  mockSql.mockResolvedValue(keyRecord(120));
});

describe('Item 4 — per-KEY sliding window', () => {
  it('allows 120 then blocks the 121st for the same key with 429 + headers', async () => {
    let last: any;
    for (let i = 0; i < 120; i++) last = await enforceRateLimit(v1Req('df_test_alpha'));
    expect(last.status).toBe(200); // 120th allowed
    const blocked = await enforceRateLimit(v1Req('df_test_alpha'));
    expect(blocked.status).toBe(429); // 121st blocked
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(blocked.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(blocked.headers.get('X-RateLimit-Reset')).toBeTruthy();
  });

  it('is per-KEY: a different key on the SAME ip is unaffected', async () => {
    for (let i = 0; i < 121; i++) await enforceRateLimit(v1Req('df_test_alpha', '10.0.0.1'));
    // key B, same ip — if this were per-IP it would already be blocked
    const other = await enforceRateLimit(v1Req('df_test_beta', '10.0.0.1'));
    expect(other.status).toBe(200);
    expect(other.headers.get('X-RateLimit-Remaining')).toBe('119');
  });

  it('attaches X-RateLimit-* headers to allowed responses', async () => {
    const res = await enforceRateLimit(v1Req('df_test_gamma'));
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('120');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('119');
  });

  it('reads the limit from the key record (limit 2 -> 3rd request 429)', async () => {
    mockSql.mockResolvedValue(keyRecord(2));
    expect((await enforceRateLimit(v1Req('df_test_small'))).status).toBe(200);
    expect((await enforceRateLimit(v1Req('df_test_small'))).status).toBe(200);
    const third = await enforceRateLimit(v1Req('df_test_small'));
    expect(third.status).toBe(429);
    expect(third.headers.get('X-RateLimit-Limit')).toBe('2');
  });
});

describe('Item 4 — auth is checked before budget', () => {
  it('returns 401 with no Bearer header and never touches the DB or a bucket', async () => {
    const req = new NextRequest('http://localhost/api/v1/contacts');
    const res = await enforceRateLimit(req);
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns 401 for a revoked key', async () => {
    mockSql.mockResolvedValue(keyRecord(120, true));
    const res = await enforceRateLimit(v1Req('df_test_revoked'));
    expect(res.status).toBe(401);
  });

  it('returns 401 for an unknown key (no record)', async () => {
    mockSql.mockResolvedValue([]);
    const res = await enforceRateLimit(v1Req('df_test_unknown'));
    expect(res.status).toBe(401);
  });
});

describe('Domain lock layer 4 — key OWNER must be an allowed-domain user with an approved role', () => {
  it('403 when the owner email domain is not allowlisted (default dealswiftautomation.com)', async () => {
    mockSql.mockResolvedValue(keyRecord(120, false, { email: 'evil@gmail.com', role: 'ADMIN' }));
    const res = await enforceRateLimit(v1Req('df_live_outsider'));
    expect(res.status).toBe(403);
  });

  it('403 when the owner is below MIN_ACCESS_ROLE (default ADMIN)', async () => {
    mockSql.mockResolvedValue(
      keyRecord(120, false, { email: 'member@dealswiftautomation.com', role: 'MEMBER' })
    );
    const res = await enforceRateLimit(v1Req('df_live_member'));
    expect(res.status).toBe(403);
  });

  it('403 when the key has no resolvable owner (fail closed)', async () => {
    mockSql.mockResolvedValue([
      { id: 'k1', revoked: false, rate_limit_per_min: 120, owner_email: null, owner_role: null },
    ]);
    const res = await enforceRateLimit(v1Req('df_live_orphan'));
    expect(res.status).toBe(403);
  });

  it('non-vacuous: the same owner shape passes when the domain IS allowed', async () => {
    mockSql.mockResolvedValue(
      keyRecord(120, false, { email: 'owner@dealswiftautomation.com', role: 'ADMIN' })
    );
    const res = await enforceRateLimit(v1Req('df_live_owner_ok'));
    expect(res.status).toBe(200);
  });
});

describe('Item 4 — matcher scope', () => {
  it('leaves non-v1 routes (e.g. /api/system/health) completely untouched', async () => {
    const req = new NextRequest('http://localhost/api/system/health');
    const res = await enforceRateLimit(req);
    // passthrough (never 429), no auth required, no DB call, no bucket consumed
    expect(res.status).not.toBe(429);
    expect(res.status).not.toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
    // hammering it never trips the limiter
    for (let i = 0; i < 200; i++) {
      const r = await enforceRateLimit(new NextRequest('http://localhost/api/system/health'));
      expect(r.status).not.toBe(429);
    }
  });
});

describe('Item 4 — slidingWindow unit', () => {
  it('blocks only after the window is full and frees up as timestamps age out', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(slidingWindow('bucket-x', 3, t0 + i).allowed).toBe(true);
    }
    // 4th within window -> blocked
    const blocked = slidingWindow('bucket-x', 3, t0 + 3);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
    // after 60s the earliest hit ages out -> allowed again
    const later = slidingWindow('bucket-x', 3, t0 + 60_001);
    expect(later.allowed).toBe(true);
  });
});
