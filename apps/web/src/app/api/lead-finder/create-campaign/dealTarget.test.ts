/**
 * POST /api/lead-finder/create-campaign — DEAL-TARGET mode.
 *
 * This is the path that removes the manual list-import step: the operator
 * states an outcome ("2 assignments") and the system derives the volume and
 * selects the highest-scoring inventory for BOTH sides of the trade.
 *
 * The behaviour under most scrutiny is the UNDER-SIZED case. Handing off 1,200
 * of the 10,334 seller leads a target requires, while returning a cheerful
 * `created: 1200`, is exactly the silent failure this mode exists to prevent —
 * so shortfall must surface as a top-level warning, not a nested field.
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

vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({
  recordStageTransition: vi.fn(async () => {}),
}));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/lead-finder/create-campaign', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as any;

const row = (id: number, category: 'seller' | 'buyer') => ({
  id,
  category,
  owner_name: `Owner ${id}`,
  property_address: `${id} Main St`,
  distress_score: 90,
});

/** All-1.0 funnels => 1 contact per deal, keeping the handoff loop tiny. */
const UNIT = { seller: { deliverability: 1, replyRate: 1, engagedRate: 1, offerRate: 1, contractRate: 1, closeRate: 1 }, buyer: { replyRate: 1, interestRate: 1, takeRate: 1 } };

/** Queue the per-lead handoff calls: claim, INSERT lead, UPDATE sourced_leads. */
function queueHandoff(n: number) {
  for (let i = 0; i < n; i++) {
    mockSql.mockResolvedValueOnce([{ id: 100 + i }]); // claim
    mockSql.mockResolvedValueOnce([{ id: 500 + i }]); // INSERT lead
    mockSql.mockResolvedValueOnce([]); // UPDATE handed_off_lead_id
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
  getOrganization.mockResolvedValue({ id: 'org_1' });
  mockSql.mockResolvedValue([]);
});

describe('deal-target sizing drives the selection', () => {
  it('LIMITs each select to the derived seller/buyer requirement', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]); // empty -> 400, fine
    await POST(req({ targetDeals: 1 }));

    // Default funnels: 10,334 sellers and 200 buyers per assignment.
    const limits = mockSql.mock.calls.slice(0, 2).map((c: any) => c[c.length - 1]);
    expect(limits).toEqual([10334, 200]);
  });

  it('scales the requirement with the deal target', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await POST(req({ targetDeals: 3 }));
    const limits = mockSql.mock.calls.slice(0, 2).map((c: any) => c[c.length - 1]);
    expect(limits[1]).toBe(600); // 200 buyers × 3
    expect(limits[0]).toBeGreaterThan(30000);
  });

  it('selects BOTH sides — sellers to source, buyers to assign', async () => {
    mockSql.mockResolvedValueOnce([row(1, 'seller')]).mockResolvedValueOnce([row(2, 'buyer')]);
    queueHandoff(2);

    const b = await (await POST(req({ targetDeals: 1, ...UNIT }))).json();
    expect(b.created).toBe(2);
    expect(b.fullySized).toBe(true);
    expect(b.warnings).toEqual([]);
    expect(b.required).toEqual({ sellers: 1, buyers: 1 });
  });
});

describe('under-sized campaigns fail LOUDLY, not silently', () => {
  it('warns at top level when sellers are short, and still hands off what exists', async () => {
    // Ask for 1 deal (10,334 sellers) but only 1 row exists.
    mockSql.mockResolvedValueOnce([row(1, 'seller')]).mockResolvedValueOnce([]);
    queueHandoff(1);

    const b = await (await POST(req({ targetDeals: 1 }))).json();
    expect(b.created).toBe(1);
    expect(b.fullySized).toBe(false);
    expect(b.shortfall.sellers).toEqual({
      requested: 10334,
      available: 1,
      shortfall: 10333,
      feasible: false,
    });
    expect(b.warnings.join(' ')).toMatch(/UNDER-SIZED.*1 of 10334 seller leads/);
    expect(b.warnings.join(' ')).toMatch(/short 10333/i);
  });

  it('warns specifically that no buyers means no assignment', async () => {
    mockSql.mockResolvedValueOnce([row(1, 'seller')]).mockResolvedValueOnce([]);
    queueHandoff(1);

    const b = await (await POST(req({ targetDeals: 1, seller: UNIT.seller }))).json();
    expect(b.warnings.join(' ')).toMatch(/cannot be assigned without buyers/);
  });

  it('400s with the requirement and a sourcing hint when inventory is empty', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await POST(req({ targetDeals: 2 }));
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.required.sellers).toBe(20668); // 10334 × 2
    expect(b.required.buyers).toBe(400);
    expect(b.hint).toMatch(/Source inventory/);
  });
});

describe('mode precedence and back-compat', () => {
  it('explicit leadIds still win over targetDeals', async () => {
    mockSql.mockResolvedValueOnce([row(7, 'seller')]);
    queueHandoff(1);

    const b = await (await POST(req({ leadIds: [7], targetDeals: 5 }))).json();
    expect(b.created).toBe(1);
    // No sizing block: this was not deal-target mode.
    expect(b.required).toBeUndefined();
    expect(mockSql.mock.calls[0][0].join('?')).toMatch(/id = ANY/);
  });

  it('filter mode is unchanged when no targetDeals is given', async () => {
    mockSql.mockResolvedValueOnce([row(3, 'seller')]);
    queueHandoff(1);

    const b = await (await POST(req({ filter: { county: 'Jefferson' } }))).json();
    expect(b.created).toBe(1);
    expect(b.required).toBeUndefined();
    // Single sweep query, not the two LIMITed selects.
    expect(mockSql.mock.calls[0][0].join('?')).not.toMatch(/LIMIT/);
  });

  it('ignores a non-positive targetDeals and falls back to filter mode', async () => {
    mockSql.mockResolvedValueOnce([row(4, 'seller')]);
    queueHandoff(1);

    const b = await (await POST(req({ targetDeals: 0 }))).json();
    expect(b.required).toBeUndefined();
    expect(b.created).toBe(1);
  });
});
