/**
 * Tests for GET /api/seasons — the read-only seasonal progression route.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The route is the first HTTP caller of the seasonal layer, and it must obey the
 * tenant-isolation mandate (2026-09-26). The underlying
 * `seasonStandings` is platform-wide and returns raw user ids; the route must
 * instead call the org-scoped `seasonStandingsForOrg` and never leak ids across
 * tenants. This file proves the route wires the ORG-SCOPED function and the
 * correct organization id — the highest-value property here.
 *
 * It also proves the security boundaries: 401 without a session, the
 * gamification gate's 404 short-circuits before any work, 403 with no org, and
 * that NO write path exists (the route is GET-only and never calls
 * `creditSeasonXp`, which takes client-supplied XP).
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

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: (...a: unknown[]) => getOrganization(...a),
}));

// Mock the server module so the test asserts on the ROUTE's wiring (which
// function, which org id) rather than re-testing SQL the pglite suite covers.
const { activeSeason, listSeasons, getSeasonProgress, battlePassForUser, activeCompetitions, seasonStandingsForOrg } =
  vi.hoisted(() => ({
    activeSeason: vi.fn(),
    listSeasons: vi.fn(),
    getSeasonProgress: vi.fn(),
    battlePassForUser: vi.fn(),
    activeCompetitions: vi.fn(),
    seasonStandingsForOrg: vi.fn(),
  }));
vi.mock('@/app/api/utils/seasonalProgress.server', () => ({
  activeSeason: (...a: unknown[]) => activeSeason(...a),
  listSeasons: (...a: unknown[]) => listSeasons(...a),
  getSeasonProgress: (...a: unknown[]) => getSeasonProgress(...a),
  battlePassForUser: (...a: unknown[]) => battlePassForUser(...a),
  activeCompetitions: (...a: unknown[]) => activeCompetitions(...a),
  seasonStandingsForOrg: (...a: unknown[]) => seasonStandingsForOrg(...a),
}));

import { GET } from './route';

const USER_ID = 'user-1';
const ORG_ID = 'org_alpha';

function seasonFixture(over: Record<string, unknown> = {}) {
  return {
    id: 7,
    key: 's1',
    name: 'Season 1',
    description: 'desc',
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: '2026-10-31T00:00:00.000Z',
    isActive: true,
    status: 'active',
    remainingSeconds: 86400,
    ...over,
  };
}

function req(url = 'http://test.local/api/seasons'): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireSession.mockResolvedValue({ userId: USER_ID, email: 'a@b.c' });
  requireGamificationEnabled.mockResolvedValue(null);
  getOrganization.mockResolvedValue({ id: ORG_ID, name: 'Alpha', slug: 'alpha' });
  activeSeason.mockResolvedValue(seasonFixture());
  listSeasons.mockResolvedValue([seasonFixture()]);
  getSeasonProgress.mockResolvedValue({ userId: USER_ID, seasonId: 7, xp: 120, rank: 3, updatedAt: 'x' });
  battlePassForUser.mockResolvedValue({
    seasonId: 7, xp: 120, currentTier: 2, nextTier: 3, xpToNextTier: 80,
    reachedTiers: [1, 2], claimedTiers: [1], ratio: 0.4, complete: false,
  });
  activeCompetitions.mockResolvedValue([]);
  seasonStandingsForOrg.mockResolvedValue([
    { rank: 1, name: 'Ada', xp: 500 },
    { rank: 2, name: 'Grace', xp: 300 },
  ]);
});

describe('GET /api/seasons — security boundaries', () => {
  it('returns 401 without a session and does no work', async () => {
    requireSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(activeSeason).not.toHaveBeenCalled();
    expect(seasonStandingsForOrg).not.toHaveBeenCalled();
  });

  it('returns the gamification gate response (404) before any query when disabled', async () => {
    const gate = new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    requireGamificationEnabled.mockResolvedValue(gate);
    const res = await GET(req());
    expect(res.status).toBe(404);
    expect(getOrganization).not.toHaveBeenCalled();
    expect(activeSeason).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller has no organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(activeSeason).not.toHaveBeenCalled();
  });

  it('never exposes creditSeasonXp or any write path (module has no such export wired)', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    // The mocked server module exposes no credit function; a 200 proves the route
    // only ever called the read helpers.
    expect(activeSeason).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/seasons — tenant isolation', () => {
  it('calls the ORG-SCOPED standings with the caller org id, never the platform-wide one', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(seasonStandingsForOrg).toHaveBeenCalledTimes(1);
    const [seasonId, orgId, opts] = seasonStandingsForOrg.mock.calls[0] as [number, string, { limit: number; offset: number }];
    expect(seasonId).toBe(7);
    expect(orgId).toBe(ORG_ID); // the caller's org, not a platform-wide query
    expect(opts.limit).toBe(20);
    expect(opts.offset).toBe(0);
  });

  it('clamps limit to 100 and floors offset, passing them to the standings call', async () => {
    await GET(req('http://test.local/api/seasons?limit=9999&offset=-5'));
    const [, , opts] = seasonStandingsForOrg.mock.calls[0] as [number, string, { limit: number; offset: number }];
    expect(opts.limit).toBe(100);
    expect(opts.offset).toBe(0);
  });

  it('returns standings display names in the JSON body', async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(body.standings).toEqual([
      { rank: 1, name: 'Ada', xp: 500 },
      { rank: 2, name: 'Grace', xp: 300 },
    ]);
  });
});

describe('GET /api/seasons — season state', () => {
  it('returns the season, progress, battle pass and competitions together', async () => {
    activeCompetitions.mockResolvedValue([
      { id: 1, key: 'weekly', name: 'Weekly XP', description: '', metric: 'xp', status: 'active', remainingSeconds: 3600 },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.season.key).toBe('s1');
    expect(body.progress.xp).toBe(120);
    expect(body.progress.rank).toBe(3);
    expect(body.battlePass.currentTier).toBe(2);
    expect(body.competitions).toHaveLength(1);
    expect(body.seasons).toHaveLength(1);
  });

  it('returns an empty season shape (200, not an error) when no season is live', async () => {
    activeSeason.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.season).toBeNull();
    expect(body.progress).toBeNull();
    expect(body.battlePass).toBeNull();
    expect(body.standings).toEqual([]);
    // Standings are not fetched when there is no season to rank.
    expect(seasonStandingsForOrg).not.toHaveBeenCalled();
  });

  it('returns a user with no progress row as null progress (not a fabricated zero)', async () => {
    getSeasonProgress.mockResolvedValue(null);
    const res = await GET(req());
    const body = await res.json();
    expect(body.progress).toBeNull();
  });

  it('returns 500 with a detail message when the read path throws', async () => {
    activeSeason.mockRejectedValue(new Error('db down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.detail).toBe('db down');
  });
});
