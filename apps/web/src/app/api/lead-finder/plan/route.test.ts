/**
 * POST /api/lead-finder/plan — deal target -> seller/buyer requirement,
 * reconciled against real sourced_leads inventory.
 *
 * The behaviour that matters most here is the SHORTFALL being reported rather
 * than the segment being quietly truncated: an operator who asks for 1 deal and
 * silently receives 1,200 of the 5,752 leads it needs will believe the campaign
 * is sized when it is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({
  getOrganization: (...a: any[]) => getOrganization(...a),
}));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/lead-finder/plan', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any;

/** Inventory row shape returned by the single COUNT query. */
const inventory = (sellers: number, buyers: number) => [{ sellers, buyers }];

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
  getOrganization.mockResolvedValue({ id: 'org_1' });
  mockSql.mockResolvedValue([]);
});

describe('sizing', () => {
  it('turns a 1-deal target into the seller/buyer requirement', async () => {
    mockSql.mockResolvedValueOnce(inventory(10000, 500));
    const res = await POST(req({ targetDeals: 1 }));
    expect(res.status).toBe(200);
    const b = await res.json();

    expect(b.required.sellers).toBe(5752);
    expect(b.required.buyers).toBe(100);
    expect(b.model.source).toBe('default');
    expect(b.feasible).toBe(true);
  });

  it('scales the requirement with the deal target', async () => {
    mockSql.mockResolvedValueOnce(inventory(100000, 5000));
    const b = await (await POST(req({ targetDeals: 4 }))).json();
    expect(b.required.buyers).toBe(400);
    expect(b.required.sellers).toBeGreaterThan(23000);
  });

  it('returns the stage walk-down so the total is inspectable', async () => {
    mockSql.mockResolvedValueOnce(inventory(10000, 500));
    const b = await (await POST(req({ targetDeals: 1 }))).json();
    expect(b.funnel.seller.map((s: any) => s.stage)).toEqual([
      'delivered',
      'replied',
      'engaged',
      'offer_discussed',
      'under_contract',
      'closed',
    ]);
  });

  it('accepts per-stage overrides and reports source=override', async () => {
    mockSql.mockResolvedValueOnce(inventory(10000, 500));
    const b = await (await POST(req({ targetDeals: 1, seller: { replyRate: 0.12 } }))).json();
    expect(b.model.source).toBe('override');
    expect(b.required.sellers).toBeLessThan(5752);
  });
});

describe('inventory reconciliation', () => {
  it('reports the exact SHORTFALL instead of silently truncating', async () => {
    mockSql.mockResolvedValueOnce(inventory(1200, 12));
    const b = await (await POST(req({ targetDeals: 1 }))).json();

    expect(b.feasible).toBe(false);
    expect(b.inventory.sellers).toEqual({
      requested: 5752,
      available: 1200,
      shortfall: 4552,
      feasible: false,
    });
    expect(b.inventory.buyers.shortfall).toBe(88);
    expect(b.warnings.join(' ')).toMatch(/Short 4552 seller leads/);
  });

  it('warns specifically that no buyers means no assignment', async () => {
    mockSql.mockResolvedValueOnce(inventory(10000, 0));
    const b = await (await POST(req({ targetDeals: 1 }))).json();
    expect(b.warnings.join(' ')).toMatch(/signed contract cannot be assigned/);
  });

  it('is feasible only when BOTH sides are covered', async () => {
    mockSql.mockResolvedValueOnce(inventory(10000, 5)); // sellers fine, buyers short
    const b = await (await POST(req({ targetDeals: 1 }))).json();
    expect(b.feasible).toBe(false);
  });
});

describe('observed mode', () => {
  it('REFUSES observed rates on an under-powered sample and says why', async () => {
    // SIGNED/ASSIGNED currently have no writers (contractGeneration.ts has zero
    // callers), so assigned=0 — the honest answer today is "not enough data".
    mockSql
      .mockResolvedValueOnce([
        { contacted: 5000, engaged: 300, negotiating: 40, signed: 3, assigned: 1 },
      ])
      .mockResolvedValueOnce(inventory(10000, 500));

    const b = await (await POST(req({ targetDeals: 1, useObserved: true }))).json();
    expect(b.model.source).toBe('default');
    expect(b.warnings.join(' ')).toMatch(/observed rates unavailable/);
    expect(b.warnings.join(' ')).toMatch(/only 1 observed closes/);
  });

  it('uses observed rates once the sample is large enough', async () => {
    mockSql
      .mockResolvedValueOnce([
        { contacted: 60000, engaged: 3300, negotiating: 345, signed: 41, assigned: 30 },
      ])
      .mockResolvedValueOnce(inventory(1000000, 5000));

    const b = await (await POST(req({ targetDeals: 1, useObserved: true }))).json();
    expect(b.model.source).toBe('observed');
    expect(b.warnings.join(' ')).not.toMatch(/observed rates unavailable/);
  });
});

describe('validation and authz', () => {
  it('400s a missing or non-positive targetDeals', async () => {
    for (const bad of [undefined, 0, -3, 'lots']) {
      const res = await POST(req({ targetDeals: bad }));
      expect(res.status, `targetDeals=${String(bad)}`).toBe(400);
    }
  });

  it('400s an out-of-range rate override rather than 500ing', async () => {
    const res = await POST(req({ targetDeals: 1, seller: { replyRate: 0 } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/replyRate/);
  });

  it('rejects non-admin callers', async () => {
    requireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await POST(req({ targetDeals: 1 }))).status).toBe(403);
  });

  it('403s when no organization resolves', async () => {
    getOrganization.mockResolvedValue(null);
    expect((await POST(req({ targetDeals: 1 }))).status).toBe(403);
  });
});
