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
 *
 * Migration 102 closes the documented double-award race: `award_achievement()`
 * serializes concurrent callers on a row lock and pays points only on a real
 * locked→unlocked transition. The concurrency test below pins that behaviour.
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

function body(payload: unknown): Request {
  return {
    json: async () => payload,
  } as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ userId: USER_ID });
  requireGamificationEnabled.mockResolvedValue(null);
  // 1: achievement lookup. 2: award_achievement() result (progress/unlocked/
  // just_unlocked/points_awarded from the stored function).
  mockSql.mockResolvedValueOnce([achievementRow()]).mockResolvedValueOnce([
    { progress: 5, unlocked: true, just_unlocked: true, points_awarded: 150 },
  ]);
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
    // `award_achievement()` reports this call as the one that transitioned the
    // row to unlocked, so the full points are paid.
    mockSql.mockReset();
    mockSql.mockResolvedValueOnce([achievementRow()]).mockResolvedValueOnce([
      { progress: 5, unlocked: true, just_unlocked: true, points_awarded: 150 },
    ]);

    const res = await POST(body({ achievementKey: 'first_steps', progress: 5 }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.unlocked).toBe(true);
    expect(data.pointsAwarded).toBe(150);
    expect(data.progress).toBe(5);
  });

  it('does NOT credit points again on a repeat unlock', async () => {
    // Row was already unlocked before this call -> the stored function reports
    // no transition, so nothing may be paid out. This is the exact double-award
    // the race fix prevents.
    mockSql.mockReset();
    mockSql.mockResolvedValueOnce([achievementRow()]).mockResolvedValueOnce([
      { progress: 5, unlocked: true, just_unlocked: false, points_awarded: 0 },
    ]);

    const res = await POST(body({ achievementKey: 'first_steps', progress: 5, unlock: true }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pointsAwarded).toBe(0);
    expect(data.unlocked).toBe(true);
  });

  it('stays idempotent across a burst of identical repeat calls', async () => {
    // Simulates the database rather than replaying a hand-counted queue: the
    // award-bearing statement fires only the first time, because after that the
    // stored row is already unlocked. Keying off the SQL text also means the
    // test cannot silently break if the route's statement ORDER changes.
    let callCount = 0;
    mockSql.mockReset();
    mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = String(strings.join(' '));
      if (/from\s+achievements/i.test(text)) return [achievementRow()];
      if (/award_achievement/i.test(text)) {
        callCount += 1;
        const justUnlocked = callCount === 1;
        return [
          {
            progress: 5,
            unlocked: true,
            just_unlocked: justUnlocked,
            points_awarded: justUnlocked ? 150 : 0,
          },
        ];
      }
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

  it('awards points exactly once under concurrent repeat calls', async () => {
    // Two simultaneous POSTs for a never-touched achievement: the stored
    // function serializes them on the row lock, so exactly one caller gets
    // the transition and the points. The mock has no yield point between
    // reading and flipping `unlockSeen`, so it faithfully serializes like the
    // real row lock does.
    let unlockSeen = false;
    mockSql.mockReset();
    mockSql.mockImplementation(async (strings: TemplateStringsArray) => {
      const text = String(strings.join(' '));
      if (/from\s+achievements/i.test(text)) return [achievementRow()];
      if (/award_achievement/i.test(text)) {
        const justUnlocked = !unlockSeen;
        unlockSeen = true;
        return [
          {
            progress: 5,
            unlocked: true,
            just_unlocked: justUnlocked,
            points_awarded: justUnlocked ? 150 : 0,
          },
        ];
      }
      return [];
    });

    // Fire both POSTs concurrently (no await between them).
    const [resA, resB] = await Promise.all([
      POST(body({ achievementKey: 'first_steps', progress: 5 })),
      POST(body({ achievementKey: 'first_steps', progress: 5 })),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const [dataA, dataB] = await Promise.all([resA.json(), resB.json()]);
    const awards = [dataA.pointsAwarded, dataB.pointsAwarded];
    // Exactly one payout across the two concurrent calls.
    expect(awards.filter((a) => a > 0)).toHaveLength(1);
    expect(awards.reduce((sum, a) => sum + a, 0)).toBe(150);
  });

  it('never decreases already-recorded progress', async () => {
    mockSql.mockReset();
    mockSql.mockResolvedValueOnce([achievementRow()]).mockResolvedValueOnce([
      { progress: 4, unlocked: false, just_unlocked: false, points_awarded: 0 },
    ]);

    const res = await POST(body({ achievementKey: 'first_steps', progress: 1 }));
    const data = await res.json();
    expect(data.progress).toBe(4);
  });
});
