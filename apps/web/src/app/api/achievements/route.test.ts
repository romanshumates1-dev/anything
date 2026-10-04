/**
 * Tests for /api/achievements POST — the write path.
 *
 * Covers the defect this file exists for: `POST` credited `user_stats.points`
 * whenever the REQUEST said `unlock`, not when the row actually transitioned
 * from locked to unlocked. Two POSTs of `{ unlock: true }` therefore paid the
 * achievement's points twice, from an endpoint any authenticated user can call
 * directly. Progress could also be walked backwards, or past `max_progress`,
 * because nothing clamped it.
 *
 * `GET` is gated on the gamification setting; `POST` was not, so a user who had
 * switched the feature off could still mint progress through it. Both are fixed
 * here. The gamification toggle semantics themselves are covered by
 * `gamification.test.ts` and are not re-tested.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn() }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireSession } = vi.hoisted(() => ({ requireSession: vi.fn() }));
vi.mock('@/app/api/utils/auth', () => ({
  requireSession: (...a: unknown[]) => requireSession(...a),
}));

const { requireGamificationEnabled } = vi.hoisted(() => ({
  requireGamificationEnabled: vi.fn(async () => null as Response | null),
}));
vi.mock('@/app/api/utils/gamification.server', () => ({
  requireGamificationEnabled: (...a: unknown[]) => requireGamificationEnabled(...a),
}));

import { POST } from './route';

const USER_ID = 'user-1';

/** The achievement definition row the route looks up by key. */
function achievementRow(over: Record<string, unknown> = {}) {
  return { id: 7, max_progress: 5, points: 150, ...over };
}

/**
 * Reads the SQL text out of a tagged-template call so tests can assert on the
 * statement the route actually sent, rather than on call ordering alone.
 */
function sqlText(callIndex: number): string {
  const call = mockSql.mock.calls[callIndex];
  return String(call?.[0]?.join(' ') ?? '');
}

/**
 * True when the statement at `callIndex` is the points write. Matches both the
 * INSERT..ON CONFLICT form (the real one) and a bare UPDATE, so the assertion is
 * about "a payout statement was issued", not about one particular spelling.
 */
function isStatsUpdate(callIndex: number): boolean {
  return /(update\s+user_stats|into\s+user_stats)/i.test(sqlText(callIndex));
}

function body(payload: unknown): Request {
  return {
    json: async () => payload,
  } as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ userId: USER_ID });
  requireGamificationEnabled.mockResolvedValue(null);
  // 1: achievement lookup. 2: the upsert, which now reports whether this call
  // was the one that transitioned the row to unlocked.
  mockSql.mockResolvedValueOnce([achievementRow()]).mockResolvedValueOnce([]);
});

describe('POST /api/achievements — authentication and gating', () => {
  it('401s without a session', async () => {
    requireSession.mockResolvedValue(null);
    const res = await POST(body({ achievementKey: 'first_steps' }));
    expect(res.status).toBe(401);
  });

  it('honours the gamification OFF gate (404, not 403)', async () => {
    requireGamificationEnabled.mockResolvedValue(Response.json({ error: 'Not found' }, { status: 404 }));
    const res = await POST(body({ achievementKey: 'first_steps' }));
    expect(res.status).toBe(404);
    // Must not write anything when the feature is off.
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('400s without an achievement key', async () => {
    const res = await POST(body({ progress: 1 }));
    expect(res.status).toBe(400);
  });

  it('404s for an unknown achievement key', async () => {
    mockSql.mockReset();
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(body({ achievementKey: 'nope' }));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/achievements — progress validation', () => {
  it('rejects a non-numeric progress value', async () => {
    const res = await POST(body({ achievementKey: 'first_steps', progress: 'lots' }));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects negative progress', async () => {
    const res = await POST(body({ achievementKey: 'first_steps', progress: -5 }));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('clamps progress to max_progress rather than rejecting it', async () => {
    // A caller that overshoots has still satisfied the achievement; refusing the
    // write would leave a genuinely-earned unlock unwritable.
    const res = await POST(body({ achievementKey: 'first_steps', progress: 999 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.progress).toBe(5);
  });
});

describe('POST /api/achievements — points are awarded exactly once', () => {
  it('credits points on the transition that unlocks', async () => {
    // Row reports it just became unlocked -> this call is the first one.
    // `just_unlocked` is what the upsert's RETURNING clause produces; it is the
    // whole basis of the "awarded exactly once" rule.
    mockSql.mockReset();
    mockSql.mockResolvedValueOnce([achievementRow()]).mockResolvedValueOnce([{ unlocked: true, just_unlocked: true }]);

    const res = await POST(body({ achievementKey: 'first_steps', progress: 5 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.unlocked).toBe(true);
    expect(data.pointsAwarded).toBe(150);
    expect(mockSql.mock.calls.some((_, i) => isStatsUpdate(i))).toBe(true);
  });

  it('does NOT credit points again on a repeat unlock', async () => {
    // Row was already unlocked before this call -> the upsert reports no
    // transition, so nothing may be paid out. This is the exact double-award.
    mockSql.mockReset();
    mockSql.mockResolvedValueOnce([achievementRow()]).mockResolvedValueOnce([]);

    const res = await POST(body({ achievementKey: 'first_steps', progress: 5, unlock: true }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pointsAwarded).toBe(0);
    expect(mockSql.mock.calls.some((_, i) => isStatsUpdate(i))).toBe(false);
  });

  it('stays idempotent across a burst of identical repeat calls', async () => {
    // Simulates the database rather than replaying a hand-counted queue: the
    // award-bearing statement fires only the first time, because after that the
    // stored row is already unlocked. Keying off the SQL text also means the
    // test cannot silently break if the route's statement ORDER changes.
    let unlocked = false;
    mockSql.mockReset();
    mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = String(strings.join(' '));
      if (/from\s+achievements/i.test(text)) return [achievementRow()];
      if (/insert\s+into\s+user_achievements/i.test(text)) {
        const justUnlocked = !unlocked;
        unlocked = true;
        return [{ progress: 5, unlocked: true, just_unlocked: justUnlocked }];
      }
      if (/into\s+user_stats/i.test(text)) return [];
      return [];
    });

    const awards: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await POST(body({ achievementKey: 'first_steps', progress: 5 }));
      expect(res.status).toBe(200);
      awards.push((await res.json()).pointsAwarded);
    }

    expect(awards[0]).toBe(150);
    // Exactly one payout across the whole burst.
    expect(awards.slice(1).every((a) => a === 0)).toBe(true);
    expect(awards.filter((a) => a > 0)).toHaveLength(1);
  });

  it('never decreases already-recorded progress', async () => {
    mockSql.mockReset();
    mockSql.mockResolvedValueOnce([achievementRow()]).mockResolvedValueOnce([{ progress: 4 }]);

    const res = await POST(body({ achievementKey: 'first_steps', progress: 1 }));
    const data = await res.json();
    expect(data.progress).toBe(4);
  });
});