/**
 * Phase N — profiles API is flag-gated. Flag OFF ⇒ 403 (UI then renders
 * nothing, matching pre-phase behaviour); flag ON + admin ⇒ list/create work.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin }));
const { isBetaFlagOn } = vi.hoisted(() => ({ isBetaFlagOn: vi.fn() }));
vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
const { listProfiles, createProfile } = vi.hoisted(() => ({ listProfiles: vi.fn(), createProfile: vi.fn() }));
vi.mock('@/app/api/utils/negotiationProfiles', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  listProfiles,
  createProfile,
}));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin1' });
});

describe('GET /api/negotiation/profiles — flag gate', () => {
  it('flag OFF → 403, store never touched', async () => {
    isBetaFlagOn.mockResolvedValue(false);
    const res = await GET();
    expect(res.status).toBe(403);
    expect(listProfiles).not.toHaveBeenCalled();
  });

  it('flag ON → 200 with profiles', async () => {
    isBetaFlagOn.mockResolvedValue(true);
    listProfiles.mockResolvedValue([{ id: 'standard_distressed', name: 'Standard Distressed' }]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).profiles).toHaveLength(1);
  });

  it('non-admin → auth response, flag not even checked', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'no' }, { status: 401 }) });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(isBetaFlagOn).not.toHaveBeenCalled();
  });
});

describe('POST /api/negotiation/profiles — validation + flag gate', () => {
  it('flag OFF → 403', async () => {
    isBetaFlagOn.mockResolvedValue(false);
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(403);
  });

  it('flag ON + invalid arvMultiplier → 400', async () => {
    isBetaFlagOn.mockResolvedValue(true);
    const res = await POST(new Request('http://x', {
      method: 'POST', body: JSON.stringify({ name: 'X', arvMultiplier: 2, minFee: 1, feeTargetMax: 2, openerPctOfMax: 0.8 }),
    }));
    expect(res.status).toBe(400);
    expect(createProfile).not.toHaveBeenCalled();
  });

  it('flag ON + valid → 201', async () => {
    isBetaFlagOn.mockResolvedValue(true);
    createProfile.mockResolvedValue({ id: 'x', name: 'X' });
    const res = await POST(new Request('http://x', {
      method: 'POST', body: JSON.stringify({ name: 'X', arvMultiplier: 0.7, minFee: 10000, feeTargetMax: 15000, openerPctOfMax: 0.82 }),
    }));
    expect(res.status).toBe(201);
    expect(createProfile).toHaveBeenCalled();
  });
});
