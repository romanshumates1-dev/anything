/**
 * Tests for /api/contracts/validate
 * Covers: POST validation, GET rules, assignment fee floor enforcement
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { requireAdmin } = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ ok: true, userId: 'admin-1' })),
}));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

import { POST, GET } from './route';
import type { NextRequest } from 'next/server';

function mockRequest(body: object): NextRequest {
  return {
    json: async () => body,
  } as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
  getOrganization.mockResolvedValue({ id: 'org-A' });
});

describe('POST /api/contracts/validate', () => {
  it('401 without admin auth', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = await POST(mockRequest({ purchase_price: 100000 }));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(mockRequest({ purchase_price: 100000 }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'No organization found' });
  });

  it('returns valid=true for compliant contract variables', async () => {
    const res = await POST(mockRequest({
      purchase_price: 150000,
      assignment_fee: 10000, // Above $5,000 minimum
      closing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.errors).toEqual([]);
    expect(body.validated.assignment_fee_valid).toBe(true);
  });

  it('returns valid=false when assignment fee below $5,000 minimum', async () => {
    const res = await POST(mockRequest({
      purchase_price: 150000,
      assignment_fee: 3000, // Below minimum
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.some((e: string) => e.includes('MINIMUM') && e.includes('5,000'))).toBe(true);
    expect(body.validated.assignment_fee_valid).toBe(false);
  });

  it('returns valid=false when purchase_price is zero or negative', async () => {
    const res = await POST(mockRequest({
      purchase_price: 0,
      assignment_fee: 10000,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.some((e: string) => e.includes('positive number'))).toBe(true);
  });

  it('returns warning when closing_date is in the past', async () => {
    const res = await POST(mockRequest({
      purchase_price: 150000,
      assignment_fee: 10000,
      closing_date: '2020-01-01',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true); // Warning only, not error
    expect(body.warnings.some((w: string) => w.includes('past'))).toBe(true);
  });

  it('validates against negotiation record when dealId provided', async () => {
    const mockDeal = {
      id: 'd1',
      organization_id: 'org-A',
      metadata: { property_address: '123 Main St' },
    };
    const mockNegotiation = {
      id: 'n1',
      deal_id: 'd1',
      purchase_price: 150000,
      assignment_fee: 10000,
      closing_date: '2027-01-01',
      seller_agreed: true,
      buyer_agreed: true,
    };

    mockSql
      .mockResolvedValueOnce([mockDeal])
      .mockResolvedValueOnce([mockNegotiation]);

    const res = await POST(mockRequest({
      dealId: 'd1',
      purchase_price: 150000, // Matches negotiation
      assignment_fee: 10000,  // Matches negotiation
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.negotiationRecord).toBeDefined();
    expect(body.negotiationRecord.purchase_price).toBe(150000);
  });

  it('returns errors when contract vars mismatch negotiation record', async () => {
    const mockDeal = { id: 'd1', organization_id: 'org-A', metadata: {} };
    const mockNegotiation = {
      id: 'n1',
      deal_id: 'd1',
      purchase_price: 150000,
      assignment_fee: 10000,
      closing_date: '2027-01-01',
      seller_agreed: true,
      buyer_agreed: false,
    };

    mockSql
      .mockResolvedValueOnce([mockDeal])
      .mockResolvedValueOnce([mockNegotiation]);

    const res = await POST(mockRequest({
      dealId: 'd1',
      purchase_price: 200000, // Different from negotiation
      assignment_fee: 10000,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.warnings.some((w: string) => w.includes('Buyer has not agreed'))).toBe(true);
  });

  it('404 when dealId not found', async () => {
    mockSql.mockResolvedValueOnce([]); // deal not found
    const res = await POST(mockRequest({ dealId: 'nonexistent' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Deal not found' });
  });

  it('404 when contractId not found', async () => {
    mockSql.mockResolvedValueOnce([]); // contract not found
    const res = await POST(mockRequest({ contractId: 'nonexistent' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Contract not found' });
  });

  it('validates existing contract by contractId', async () => {
    const mockContract = {
      id: 'c1',
      organization_id: 'org-A',
      lead_id: 'd1',
      variables: JSON.stringify({
        purchase_price: 150000,
        assignment_fee: 10000,
        closing_date: '2027-01-01',
      }),
    };
    const mockDeal = { id: 'd1', organization_id: 'org-A', metadata: {} };

    mockSql
      .mockResolvedValueOnce([mockContract])
      .mockResolvedValueOnce([mockDeal])
      .mockResolvedValueOnce([]); // no negotiation

    const res = await POST(mockRequest({ contractId: 'c1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.validated.purchase_price).toBe(150000);
  });

  it('scopes deal lookup to organization (IDOR prevention)', async () => {
    mockSql.mockResolvedValueOnce([]); // deal not found due to org filter
    await POST(mockRequest({ dealId: 'other-org-deal' }));

    const call = mockSql.mock.calls[0];
    expect(call).toContain('other-org-deal');
    expect(call).toContain('org-A');
  });

  it('warns when no negotiation record found', async () => {
    const mockDeal = {
      id: 'd1',
      organization_id: 'org-A',
      agreed_price: 150000,
      metadata: { property_address: '123 Main St' },
    };

    mockSql
      .mockResolvedValueOnce([mockDeal])
      .mockResolvedValueOnce([]); // no negotiation

    const res = await POST(mockRequest({
      dealId: 'd1',
      purchase_price: 150000,
      assignment_fee: 10000,
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings.some((w: string) => w.includes('No negotiation record'))).toBe(true);
  });
});

describe('GET /api/contracts/validate', () => {
  it('returns validation rules', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.rules.assignment_fee.minimum).toBe(5000);
    expect(body.rules.assignment_fee.enforced).toBe(true);
    expect(body.negotiation_matching.fields).toContain('purchase_price');
    expect(body.state_requirements.supported_states).toContain('TX');
  });
});
