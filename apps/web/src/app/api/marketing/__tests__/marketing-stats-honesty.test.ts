/**
 * Data-integrity / deceptive-practice regression for GET /api/marketing/stats.
 *
 * This endpoint is PUBLIC and its output is rendered directly to end users by
 * LiveSocialProof.tsx, LimitedTimeOffer.tsx and ScarcityBadge.tsx.
 *
 * Two defects were found by adversarial review:
 *
 *  1. FABRICATED SOCIAL PROOF — the route picked a RANDOM city
 *     (`locations[Math.floor(Math.random()*locations.length)]`) and returned it as
 *     "last signup location", which the UI renders as a live notification
 *     ("someone in Miami just signed up 3 minutes ago"). Real users were shown
 *     invented events. The route must never invent data.
 *
 *  2. BUSINESS-DATA LEAK — the route published the exact total customer count
 *     (`activeUsers`) to anonymous visitors, letting anyone enumerate the
 *     business's real size.
 *
 * The endpoint must report only what it can actually verify, and must say
 * `dataVerified: false` when it cannot.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = m;
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/lib/db', () => ({ sql: mockSql }));

import { GET } from '@/app/api/marketing/stats/route';

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockReset();
  mockSql.mockResolvedValue([]);
});

describe('GET /api/marketing/stats — honesty and data minimisation', () => {
  it('NEVER invents a signup location', async () => {
    // Call repeatedly: a random picker would eventually return a value.
    for (let i = 0; i < 25; i++) {
      mockSql.mockReset();
      mockSql
        .mockResolvedValueOnce([{ count: '42' }])                        // total users
        .mockResolvedValueOnce([{ count: '7' }])                         // signups this week
        .mockResolvedValueOnce([{ createdAt: new Date().toISOString() }]); // last signup

      const res = await GET();
      const body = await res.json();

      // The location is not knowable from the user table, so it must be absent.
      expect(body.lastSignupLocation ?? null).toBeNull();
    }
  });

  it('does not publish the exact customer count to anonymous visitors', async () => {
    mockSql
      .mockResolvedValueOnce([{ count: '1234' }])
      .mockResolvedValueOnce([{ count: '9' }])
      .mockResolvedValueOnce([{ createdAt: new Date().toISOString() }]);

    const res = await GET();
    const body = await res.json();

    expect(body.activeUsers).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('1234');
  });

  it('reports dataVerified:false when the database cannot be read', async () => {
    mockSql.mockRejectedValue(new Error('db down'));

    const res = await GET();
    const body = await res.json();

    expect(body.dataVerified).toBe(false);
    expect(body.signupsThisWeek).toBe(0);
    expect(body.lastSignupLocation ?? null).toBeNull();
  });

  // The route queried `created_at` on the Better Auth "user" table, which is
  // camelCase ("createdAt"). Postgres threw `column "created_at" does not
  // exist`, the bare catch swallowed it, and every landing-page load was told
  // verified-looking zeros. The mock now mirrors the real column so the
  // verified path is actually exercised, not just the failure path.
  it('reports verified values and a real time-ago from the camelCase user columns', async () => {
    mockSql
      .mockResolvedValueOnce([{ count: '42' }])
      .mockResolvedValueOnce([{ count: '7' }])
      .mockResolvedValueOnce([{ createdAt: new Date().toISOString() }]);

    const res = await GET();
    const body = await res.json();

    expect(body.dataVerified).toBe(true);
    expect(body.signupsThisWeek).toBe(7);
    expect(body.lastSignupTimeAgo).toBe('just now');
  });

  it('never inverts a missing signup time into an invented one', async () => {
    // '3 minutes ago' was hardcoded whenever no signup time could be read -
    // an invented timestamp rendered to real visitors as live activity.
    mockSql
      .mockResolvedValueOnce([{ count: '42' }])
      .mockResolvedValueOnce([{ count: '7' }])
      .mockResolvedValueOnce([]);

    const res = await GET();
    const body = await res.json();

    expect(body.lastSignupTimeAgo).toBeNull();
  });
});
