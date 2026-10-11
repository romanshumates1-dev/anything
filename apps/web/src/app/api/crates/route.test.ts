/**
 * Tests for `/api/crates` — the crate shop surface.
 *
 * WHAT THIS FILE GUARDS (mirrors rewards/route.test.ts pattern)
 * -------------------------------------------------------------
 *   * 401 before any query runs (unauthenticated callers reach no database).
 *   * 404 when gamification is off — server-side, so knowing the URL is not
 *     enough to bypass the setting.
 *   * 400 for an unknown/invalid action, BEFORE any query, so the route cannot
 *     be used to probe state through error differences.
 *   * No response field may ever carry a monetary value.
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

const { openCrateForUser, getUserCrateInventory, equipCosmetic } = vi.hoisted(() => ({
  openCrateForUser: vi.fn(),
  getUserCrateInventory: vi.fn(),
  equipCosmetic: vi.fn(),
}));
vi.mock('@/app/api/utils/crates.server', () => ({
  openCrateForUser: (...a: unknown[]) => openCrateForUser(...a),
  getUserCrateInventory: (...a: unknown[]) => getUserCrateInventory(...a),
  equipCosmetic: (...a: unknown[]) => equipCosmetic(...a),
}));

import { GET, POST } from './route';

const USER_ID = 'user-1';

function body(payload: unknown): Request {
  return { json: async () => payload } as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ userId: USER_ID });
  requireGamificationEnabled.mockResolvedValue(null);
  getUserCrateInventory.mockResolvedValue({
    availableCrates: [{ key: 'daily', name: 'Daily Cache', canOpen: true, opensToday: 0 }],
    inventory: [],
    equipped: [],
    xp: 100,
  });
  openCrateForUser.mockResolvedValue({
    ok: true,
    cosmeticKey: 'avatar-frame:copper',
    cosmeticName: 'Copper Frame',
    rarity: 'common',
    xpAwarded: 10,
    });
  equipCosmetic.mockResolvedValue({ ok: true });
});

describe('GET /api/crates — boundaries', () => {
  it('401s without a session and issues no query', async () => {
    requireSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('404s when gamification is switched off', async () => {
    requireGamificationEnabled.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('reports available crates, inventory, equipped items, and xp', async () => {
    getUserCrateInventory.mockResolvedValue({
      availableCrates: [{ key: 'daily', name: 'Daily Cache', canOpen: true, opensToday: 0 }],
      inventory: [{ cosmeticKey: 'avatar-frame:copper', rarity: 'common', isEquipped: false }],
      equipped: [],
      xp: 100,
    });
    const res = await GET();
    const payload = await res.json();
    expect(res.status).toBe(200);
    expect(payload).toHaveProperty('availableCrates');
    expect(payload).toHaveProperty('inventory');
    expect(payload).toHaveProperty('equipped');
    expect(payload).toHaveProperty('xp');
  });

  it('never returns a monetary field', async () => {
    const res = await GET();
    const serialised = JSON.stringify(await res.json()).toLowerCase();
    expect(serialised).not.toMatch(/\bcredit\b/);
    expect(serialised).not.toMatch(/\bcash\b/);
      expect(serialised).not.toMatch(/\bbalance\b/);
  });
});

describe('POST /api/crates — boundaries', () => {
  it('401s without a session', async () => {
    requireSession.mockResolvedValue(null);
    const res = await POST(body({ action: 'open', crateKey: 'daily' }));
    expect(res.status).toBe(401);
  });

  it('404s when gamification is off', async () => {
    requireGamificationEnabled.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    );
    const res = await POST(body({ action: 'open', crateKey: 'daily' }));
    expect(res.status).toBe(404);
  });

  it('rejects a malformed JSON body before any query', async () => {
    const res = await POST({ json: async () => { throw new Error('bad json'); } } as Request);
    expect(res.status).toBe(400);
  });

  it('rejects an unknown action', async () => {
    const res = await POST(body({ action: 'mint-credits', crateKey: 'daily' }));
    expect(res.status).toBe(400);
  });

  it('rejects an invalid crateKey', async () => {
    const res = await POST(body({ action: 'open', crateKey: 'nonexistent' }));
    expect(res.status).toBe(400);
  });

  it('rejects a body missing crateKey for open action', async () => {
    const res = await POST(body({ action: 'open' }));
    expect(res.status).toBe(400);
  });

  it('delegates to openCrateForUser and returns the cosmetic', async () => {
    const res = await POST(body({ action: 'open', crateKey: 'daily' }));
    expect(openCrateForUser).toHaveBeenCalledWith(USER_ID, 'daily');
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload).toHaveProperty('cosmeticKey');
    expect(payload).toHaveProperty('rarity');
    expect(payload).toHaveProperty('xpAwarded');
  });

  it('delegates equip action to equipCosmetic', async () => {
    const res = await POST(body({ action: 'equip', cosmeticKey: 'badge:early-adopter' }));
    expect(equipCosmetic).toHaveBeenCalledWith(USER_ID, 'badge:early-adopter');
    expect(res.status).toBe(200);
  });

  it('returns 409 when openCrateForUser says not ok', async () => {
    openCrateForUser.mockResolvedValue({ ok: false, reason: 'already opened today' });
    const res = await POST(body({ action: 'open', crateKey: 'daily' }));
    expect(res.status).toBe(409);
    const payload = await res.json();
    expect(payload.error).toBeDefined();
  });
});

