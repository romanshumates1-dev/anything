/**
 * Tests for POST /api/contracts/generate
 * Covers: auth, CSRF, validation, contract generation, storage
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

const { requireValidCsrf } = vi.hoisted(() => ({ requireValidCsrf: vi.fn(() => null) }));
vi.mock('@/app/api/utils/csrfProtection', () => ({ requireValidCsrf: (...a: any[]) => requireValidCsrf(...a) }));

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: (...a: any[]) => logEvent(...a) }));

import { POST } from './route';
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
  requireValidCsrf.mockReturnValue(null);
});

describe('POST /api/contracts/generate', () => {
  it('returns CSRF error when token invalid', async () => {
    requireValidCsrf.mockReturnValue(Response.json({ error: 'Invalid CSRF' }, { status: 403 }));
    const res = await POST(mockRequest({ dealId: 'd1', type: 'PURCHASE_AGREEMENT' }));
    expect(res.status).toBe(403);
  });

  it('401 without admin auth', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = await POST(mockRequest({ dealId: 'd1', type: 'PURCHASE_AGREEMENT' }));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(mockRequest({ dealId: 'd1', type: 'PURCHASE_AGREEMENT' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'No organization found' });
  });

  it('400 when dealId is missing', async () => {
    const res = await POST(mockRequest({ type: 'PURCHASE_AGREEMENT' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'dealId is required' });
  });

  it('400 when type is invalid', async () => {
    const res = await POST(mockRequest({ dealId: 'd1', type: 'INVALID_TYPE' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'type must be PURCHASE_AGREEMENT or ASSIGNMENT' });
  });

  it('404 when deal not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(mockRequest({ dealId: 'nonexistent', type: 'PURCHASE_AGREEMENT' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Deal not found' });
  });

  it('400 when deal is missing property_address', async () => {
    const mockDeal = { id: 'd1', organization_id: 'org-A', metadata: {} };
    mockSql
      .mockResolvedValueOnce([mockDeal]) // deal
      .mockResolvedValueOnce([]);         // negotiation

    const res = await POST(mockRequest({ dealId: 'd1', type: 'PURCHASE_AGREEMENT' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Deal is missing property_address in metadata' });
  });

  it('400 when deal is missing seller name', async () => {
    const mockDeal = {
      id: 'd1',
      organization_id: 'org-A',
      metadata: { property_address: '123 Main St' },
    };
    mockSql
      .mockResolvedValueOnce([mockDeal])
      .mockResolvedValueOnce([]);

    const res = await POST(mockRequest({ dealId: 'd1', type: 'PURCHASE_AGREEMENT' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Deal is missing seller/owner name' });
  });

  it('400 when deal is missing purchase_price', async () => {
    const mockDeal = {
      id: 'd1',
      organization_id: 'org-A',
      metadata: { property_address: '123 Main St', seller_name: 'John Doe' },
    };
    mockSql
      .mockResolvedValueOnce([mockDeal])
      .mockResolvedValueOnce([]);

    const res = await POST(mockRequest({ dealId: 'd1', type: 'PURCHASE_AGREEMENT' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Deal is missing valid purchase_price' });
  });

  it('generates PURCHASE_AGREEMENT successfully', async () => {
    const mockDeal = {
      id: 'd1',
      organization_id: 'org-A',
      metadata: {
        property_address: '123 Main St',
        property_city: 'Phoenix',
        property_state: 'AZ',
        property_zip: '85001',
        property_county: 'Maricopa',
        seller_name: 'John Doe',
        seller_address: '456 Oak Ave, Phoenix, AZ 85001',
      },
      agreed_price: 150000,
    };
    // Mock the negotiation with closing_date
    const mockNegotiation = {
      id: 'n1',
      deal_id: 'd1',
      purchase_price: 150000,
      closing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    };
    mockSql
      .mockResolvedValueOnce([mockDeal])       // deal
      .mockResolvedValueOnce([mockNegotiation]); // negotiation

    mockSql.transaction.mockResolvedValueOnce([]);

    const res = await POST(mockRequest({ dealId: 'd1', type: 'PURCHASE_AGREEMENT' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.type).toBe('PURCHASE_AGREEMENT');
    expect(body.contractId).toBeDefined();
    expect(logEvent).toHaveBeenCalledWith(
      'contract_generated',
      'contract',
      expect.any(String),
      expect.objectContaining({ type: 'PURCHASE_AGREEMENT', dealId: 'd1' }),
      'org-A'
    );
  });

  it('400 when ASSIGNMENT contract missing assignee name', async () => {
    const mockDeal = {
      id: 'd1',
      organization_id: 'org-A',
      metadata: {
        property_address: '123 Main St',
        property_city: 'Phoenix',
        property_state: 'AZ',
        property_zip: '85001',
        property_county: 'Maricopa',
        seller_name: 'John Doe',
        seller_address: '456 Oak Ave',
        assignment_fee: 10000,
      },
      agreed_price: 150000,
    };
    const mockNegotiation = {
      id: 'n1',
      deal_id: 'd1',
      purchase_price: 150000,
      assignment_fee: 10000,
      closing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    };
    mockSql
      .mockResolvedValueOnce([mockDeal])        // deal
      .mockResolvedValueOnce([mockNegotiation]) // negotiation
      .mockResolvedValueOnce([]);               // assignee lookup (empty)

    const res = await POST(mockRequest({ dealId: 'd1', type: 'ASSIGNMENT' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Assignment contract requires assignee name (provide assigneeId or assigneeName)',
    });
  });

  it('400 when ASSIGNMENT fee is below minimum $5,000', async () => {
    const mockDeal = {
      id: 'd1',
      organization_id: 'org-A',
      metadata: {
        property_address: '123 Main St',
        property_city: 'Phoenix',
        property_state: 'AZ',
        property_zip: '85001',
        property_county: 'Maricopa',
        seller_name: 'John Doe',
        seller_address: '456 Oak Ave',
        assignment_fee: 2000, // Below minimum
      },
      agreed_price: 150000,
    };
    const mockNegotiation = {
      id: 'n1',
      deal_id: 'd1',
      purchase_price: 150000,
      assignment_fee: 2000, // Below minimum
      closing_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    };
    mockSql
      .mockResolvedValueOnce([mockDeal])
      .mockResolvedValueOnce([mockNegotiation]);

    const res = await POST(mockRequest({
      dealId: 'd1',
      type: 'ASSIGNMENT',
      assigneeName: 'Jane Buyer',
      assigneeAddress: '789 Elm St',
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('at least $5,000');
    expect(body.error).toContain('NON-NEGOTIABLE');
  });

  it('scopes deal lookup to organization (IDOR prevention)', async () => {
    mockSql.mockResolvedValueOnce([]); // deal not found due to org filter

    await POST(mockRequest({ dealId: 'other-org-deal', type: 'PURCHASE_AGREEMENT' }));

    const call = mockSql.mock.calls[0];
    expect(call).toContain('other-org-deal');
    expect(call).toContain('org-A');
  });
});
