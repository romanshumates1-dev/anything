/**
 * /api/tax/settings — seller tax-withholding preferences (money-adjacent).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The route's own header documents the security invariant (2026-09-29): the
 * organization comes from the authenticated session context ONLY — never from
 * the body or query — so there is nothing for a caller to tamper with; this is
 * what prevents a cross-tenant rate edit. It also carries a mass-assignment
 * guard (only enabled/rateBps/jurisdiction are read) and a payout-affecting
 * rate validation (0..10000 basis points, REJECTED not clamped, so a client bug
 * is visible instead of silently changing a payout). None of it had a route test.
 *
 * WHAT IS ASSERTED
 * 1. GET/PUT 401 without a session; 403 without an organization.
 * 2. GET returns DISABLED defaults (not an error) for a never-configured seller.
 * 3. GET binds the store lookup to session user + session org (server-derived).
 * 4. PUT 400s invalid JSON.
 * 5. PUT 400s an out-of-range rateBps — rejected, NOT clamped.
 * 6. PUT IGNORES `user_id`/`organization_id` in the body (mass-assignment) —
 *    saveWithholdingSettings is always called with the SESSION's ids.
 * 7. PUT normalizes and saves only the three allowed fields.
 *
 * The real `taxWithholding` utils (isValidRateBps, DISCLAIMER) are used as-is;
 * only the persistence store and the auth/org context are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

const { getWithholdingSettings, saveWithholdingSettings, getWithheldBalance } = vi.hoisted(() => ({
  getWithholdingSettings: vi.fn(),
  saveWithholdingSettings: vi.fn(),
  getWithheldBalance: vi.fn(),
}));
vi.mock('@/app/api/utils/taxWithholdingStore', () => ({
  getWithholdingSettings: (...a: any[]) => getWithholdingSettings(...a),
  saveWithholdingSettings: (...a: any[]) => saveWithholdingSettings(...a),
  getWithheldBalance: (...a: any[]) => getWithheldBalance(...a),
}));

import { GET, PUT } from './route';
import { DISCLAIMER } from '@/app/api/utils/taxWithholding';

const SESSION = { user: { id: 'user-1' } };
const ORG = { id: 'org-1' };

function putReq(body: unknown, raw?: string) {
  return new Request('http://t/api/tax/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  getOrganization.mockResolvedValue(ORG);
  getWithholdingSettings.mockResolvedValue(null);
  getWithheldBalance.mockResolvedValue(0);
  saveWithholdingSettings.mockImplementation(async (u: string, o: string, s: any) => s);
});

describe('GET /api/tax/settings', () => {
  it('401s without a session', async () => {
    getSession.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(getWithholdingSettings).not.toHaveBeenCalled();
  });

  it('403s without an organization', async () => {
    getOrganization.mockResolvedValue(null);
    expect((await GET()).status).toBe(403);
    expect(getWithholdingSettings).not.toHaveBeenCalled();
  });

  it('returns DISABLED defaults for a never-configured seller', async () => {
    getWithholdingSettings.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toEqual({ enabled: false, rateBps: 0, jurisdiction: null });
    expect(body.disclaimer).toBe(DISCLAIMER);
  });

  it('binds the lookup to the SESSION user + org ids (server-derived identity)', async () => {
    await GET();
    expect(getWithholdingSettings).toHaveBeenCalledWith('user-1', 'org-1');
    expect(getWithheldBalance).toHaveBeenCalledWith('user-1', 'org-1');
  });

describe('PUT /api/tax/settings — cross-tenant & mass-assignment guard', () => {
  it('401s without a session', async () => {
    getSession.mockResolvedValue(null);
    expect((await PUT(putReq({}))).status).toBe(401);
    expect(saveWithholdingSettings).not.toHaveBeenCalled();
  });

  it('403s without an organization', async () => {
    getOrganization.mockResolvedValue(null);
    expect((await PUT(putReq({}))).status).toBe(403);
    expect(saveWithholdingSettings).not.toHaveBeenCalled();
  });

  it('400s an invalid JSON body', async () => {
    expect((await PUT(putReq(null, '{not json'))).status).toBe(400);
    expect(saveWithholdingSettings).not.toHaveBeenCalled();
  });

  it('400s an out-of-range rateBps — rejected, NOT clamped', async () => {
    const res = await PUT(putReq({ enabled: true, rateBps: 10001 }));
    expect(res.status).toBe(400);
    expect(saveWithholdingSettings).not.toHaveBeenCalled();

    const neg = await PUT(putReq({ enabled: true, rateBps: -1 }));
    expect(neg.status).toBe(400);

    const nonInt = await PUT(putReq({ enabled: true, rateBps: 12.5 }));
    expect(nonInt.status).toBe(400);
  });

  it('IGNORES user_id/organization_id in the body — saves with SESSION ids (no cross-tenant rate edit)', async () => {
    const res = await PUT(
      putReq({
        enabled: true,
        rateBps: 2500,
        // Tampered identity fields a cross-tenant attacker would try:
        user_id: 'victim-user',
        organization_id: 'victim-org',
      }),
    );
    expect(res.status).toBe(200);
    // saveWithholdingSettings(userId, orgId, settings) — ids come from the
    // session, NOT the body.
    expect(saveWithholdingSettings).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      expect.objectContaining({ enabled: true, rateBps: 2500 }),
    );
    const [, , settings] = saveWithholdingSettings.mock.calls[0];
    // The tampered ids never appear in the saved settings payload either.
    expect(JSON.stringify(settings)).not.toMatch(/victim/);
  });

  it('normalizes and saves only the three allowed fields', async () => {
    const res = await PUT(
      putReq({
        enabled: true,
        rateBps: 150,
        jurisdiction: '  US-CA  ',
        // Extra fields must be dropped, not persisted:
        payout_bank_account: 'attacker-account',
      }),
    );
    expect(res.status).toBe(200);
    expect(saveWithholdingSettings).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      { enabled: true, rateBps: 150, jurisdiction: 'US-CA' },
    );
    const body = await res.json();
    expect(body.settings.jurisdiction).toBe('US-CA');
    expect(body.disclaimer).toBe(DISCLAIMER);
  });
});

});
