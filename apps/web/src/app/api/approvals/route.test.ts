/**
 * /api/approvals GET — the app-facing approvals queue (behavioral).
 * Unions owner_range_requests (as type 'owner_range') + human_approvals,
 * org-scoped. Ghost route built during the verification sprint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
// Phase 5: the route resolves org via getOrganization() (real membership
// lookup), not session.user.organizationId (which better-auth never sets --
// that was bug #35, the tenant-scoping fallback-to-'default' bug).
const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'u1' } });
  getOrganization.mockResolvedValue({ id: 'org-1', name: 'Org One', slug: 'org-one' });
});

describe('GET /api/approvals', () => {
  it('returns a bare array unioning owner-range + contract approvals, org-scoped', async () => {
    mockSql
      .mockResolvedValueOnce([
        { id: 'orr-1', negotiation_id: 'cc-1', direction: 'SELLER', property_context: { address: '12 Oak St', ai_min: 100000, ai_max: 120000 }, status: 'PENDING', requested_at: '2026-07-05T10:00:00Z' },
      ]) // owner_range_requests
      .mockResolvedValueOnce([
        { id: 'ha-1', type: 'CONTRACT_SEND', negotiation_id: 'cc-2', contract_id: 'k-1', context: { agreedPrice: 115000 }, status: 'PENDING', created_at: '2026-07-05T09:00:00Z' },
      ]); // human_approvals

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    const range = body.find((a: any) => a.type === 'owner_range');
    expect(range.id).toBe('orr-1');
    expect(range.context).toMatchObject({ address: '12 Oak St', ai_min: 100000, ai_max: 120000 });
    const contract = body.find((a: any) => a.type === 'CONTRACT_SEND');
    expect(contract.id).toBe('ha-1');

    // both queries are org-scoped
    const orgScoped = mockSql.mock.calls.every(
      (c: any) => c.includes('org-1') || !c[0].join('?').includes('organization_id')
    );
    expect(orgScoped).toBe(true);
    expect(mockSql.mock.calls.some((c: any) => c.includes('org-1'))).toBe(true);
  });

  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
