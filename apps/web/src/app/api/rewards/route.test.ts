/**
 * Tests for `/api/rewards` — the only place the V3 reward economy is reachable.
 *
 * WHAT THIS FILE GUARDS
 * ---------------------
 * The route is the attack surface for the reward layer, so the assertions are
 * about BOUNDARIES rather than happy paths:
 *
 *   * 401 before any query runs (unauthenticated callers reach no database).
 *   * 404 when gamification is off — server-side, so knowing the URL is not
 *     enough to bypass the setting (roman.agent.md V: "hide gamification").
 *   * 400 for an unknown action, issued BEFORE any query, so the route cannot be
 *     used to probe for state through differing error responses.
 *   * No response field may ever carry a monetary value. Credits, cash and
 *     balances are the only things in this app with money behind them, and
 *     nothing in the reward path may expose or alter them.
 *
 * The exactly-once concurrency guarantees are proven separately against a real
 * Postgres engine in `gamificationRewards.pglite.test.ts`; re-testing them here
 * with mocks would prove nothing the PGlite suite does not already prove
 * more convincingly.
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

import { GET, POST } from './route';

const USER_ID = 'user-1';

function body(payload: unknown): Request {
  return { json: async () => payload } as Request;
}

/** Route every `sql` call by matching the statement text. */
function routeSql(call: [unknown, ...unknown[]]): unknown[] {
  const text = String((call[0] as unknown[] | undefined)?.join(' ') ?? call[0] ?? '');

  if (/SELECT points FROM public\.user_stats/.test(text)) return [{ points: 0 }];
  if (/SELECT COALESCE\(SUM\(a\.points\)/.test(text)) return [{ total: 0 }];
  if (/INSERT INTO public\.user_spin_wallet/.test(text)) return [{ spins_remaining: 0 }];
  if (/SELECT spins_remaining FROM public\.user_spin_wallet/.test(text)) {
    return [{ spins_remaining: 0 }];
  }
  if (/FROM public\.battle_pass_tiers/.test(text)) return [];
  if (/FROM public\.giveaways/.test(text)) return [];
  if (/spins_remaining = spins_remaining - 1/.test(text)) return [];
  if (/INSERT INTO public\.spin_wheel_spins/.test(text)) return [{ id: 1 }];
  if (/FROM public\.use_codes/.test(text)) return [];
  if (/UPDATE public\.use_codes/.test(text)) return [{ id: 1 }];
  if (/INSERT INTO public\.user_use_code_redemptions/.test(text)) return [{ id: 1 }];
  if (/INSERT INTO public\.giveaway_entries/.test(text)) return [];
  if (/SELECT t\.id, t\.tier/.test(text)) return [];
  return [];
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ userId: USER_ID });
  requireGamificationEnabled.mockResolvedValue(null);
  mockSql.mockImplementation(async (strings: unknown, ...values: unknown[]) =>
    routeSql([strings as unknown, ...values]),
  );
});

describe('GET /api/rewards — boundaries', () => {
  it('401s without a session and issues no query', async () => {
    requireSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('404s when gamification is switched off', async () => {
    requireGamificationEnabled.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('never returns a monetary field', async () => {
    const res = await GET();
    const payload = await res.json();

    // Credits/cash/balance are the only monetary surfaces in this app.
    const serialised = JSON.stringify(payload).toLowerCase();
    expect(serialised).not.toMatch(/\bcredit/);
    expect(serialised).not.toMatch(/\bcash\b/);
    expect(serialised).not.toMatch(/\bbalance\b/);
    expect(serialised).not.toMatch(/\bwithdraw/);
  });

  it('reports XP, level and spins for an authenticated user', async () => {
    const res = await GET();
    const payload = await res.json();
    expect(res.status).toBe(200);
    expect(payload).toHaveProperty('xp');
    expect(payload).toHaveProperty('level');
    expect(payload).toHaveProperty('spinsRemaining');
    expect(payload).toHaveProperty('battlePass');
    expect(payload).toHaveProperty('giveaways');
  });
});

describe('POST /api/rewards — boundaries', () => {
  it('401s without a session', async () => {
    requireSession.mockResolvedValue(null);
    const res = await POST(body({ action: 'spin' }));
    expect(res.status).toBe(401);
  });

  it('404s when gamification is switched off, even for a mutation', async () => {
    requireGamificationEnabled.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );
    const res = await POST(body({ action: 'spin' }));
    expect(res.status).toBe(404);
  });

  it('rejects a malformed JSON body before any query', async () => {
    const res = await POST({ json: async () => { throw new Error('bad json'); } } as Request);
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects an unknown action before any query', async () => {
    // If this reached the database, an attacker could use error differences to
    // probe for state. 400 without a query closes that channel.
    const res = await POST(body({ action: 'mint-credits' }));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects a non-integer tierId', async () => {
    const res = await POST(body({ action: 'claim-tier', tierId: 'abc' }));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('rejects a non-integer giveawayId', async () => {
    const res = await POST(body({ action: 'enter-giveaway', giveawayId: -3 }));
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns 409 rather than 500 when a spin is refused', async () => {
    // An exhausted wallet is an expected outcome, not a server fault, and the
    // client must be able to distinguish the two.
    const res = await POST(body({ action: 'spin' }));
    expect(res.status).toBe(409);
    const payload = await res.json();
    expect(payload.error).toBeTruthy();
  });

  it('returns 409 for an unknown use code', async () => {
    const res = await POST(body({ action: 'redeem', code: 'NOPE' }));
    expect(res.status).toBe(409);
  });

  it('never accepts a request that mints credits', async () => {
    // No action name may carry monetary intent. If someone adds one, this
    // fails until the action list and this test are both updated deliberately.
    for (const action of ['mint-credits', 'credit', 'cash-out', 'withdraw', 'buy-spins']) {
      const res = await POST(body({ action }));
      expect(res.status).toBe(400);
    }
  });
});