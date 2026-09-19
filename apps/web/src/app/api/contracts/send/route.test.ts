/**
 * Tests for POST /api/contracts/send
 * Covers: auth, CSRF, validation, e-sign flow, minimum assignment fee enforcement
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

const { getEsignProvider } = vi.hoisted(() => ({
  getEsignProvider: vi.fn(() => ({
    createSigningLink: vi.fn(async () => ({
      envelopeId: 'env-123',
      signingLink: 'https://esign.example.com/sign/abc',
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
    })),
  })),
}));
vi.mock('@/app/api/services/esignProvider', () => ({ getEsignProvider }));

const { recordStageTransition } = vi.hoisted(() => ({ recordStageTransition: vi.fn() }));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({ recordStageTransition }));

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

describe('POST /api/contracts/send', () => {
  it('returns CSRF error when token invalid', async () => {
    requireValidCsrf.mockReturnValue(Response.json({ error: 'Invalid CSRF' }, { status: 403 }));
    const res = await POST(mockRequest({ contractType: 'purchase_agreement', leadId: 'l1' }));
    expect(res.status).toBe(403);
  });

  it('401 without admin auth', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = await POST(mockRequest({ contractType: 'purchase_agreement', leadId: 'l1' }));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(mockRequest({ contractType: 'purchase_agreement', leadId: 'l1' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'No organization found' });
  });

  it('400 for invalid contractType', async () => {
    const res = await POST(mockRequest({ contractType: 'invalid' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Invalid contractType (purchase_agreement or assignment_contract)',
    });
  });

  describe('purchase_agreement', () => {
    it('400 when leadId is missing', async () => {
      const res = await POST(mockRequest({ contractType: 'purchase_agreement' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'leadId required for purchase_agreement' });
    });

    it('404 when lead not found', async () => {
      mockSql.mockResolvedValueOnce([]);
      const res = await POST(mockRequest({ contractType: 'purchase_agreement', leadId: 'nonexistent' }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Lead not found' });
    });

    it('400 when purchase price not available', async () => {
      mockSql.mockResolvedValueOnce([{
        id: 'l1',
        name: 'Seller Name',
        email: 'seller@example.com',
        metadata: {},
      }]);
      const res = await POST(mockRequest({ contractType: 'purchase_agreement', leadId: 'l1' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'Purchase price required for contract generation',
      });
    });

    it('sends purchase agreement and records stage transition', async () => {
      mockSql
        .mockResolvedValueOnce([{
          id: 'l1',
          name: 'John Seller',
          email: 'seller@example.com',
          agreed_price: 200000,
          metadata: { property_address: '123 Main St' },
        }])
        .mockResolvedValueOnce([]) // insert contract
        .mockResolvedValueOnce([]); // update with envelope

      const res = await POST(mockRequest({ contractType: 'purchase_agreement', leadId: 'l1' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.contractId).toBeDefined();
      expect(body.signingLink).toContain('esign.example.com');

      expect(recordStageTransition).toHaveBeenCalledWith({
        leadId: 'l1',
        fromStage: 'NEGOTIATING',
        toStage: 'CONTRACT_SENT',
        channel: 'email',
      });

      expect(logEvent).toHaveBeenCalledWith(
        'contract_sent',
        'contract',
        expect.any(String),
        expect.objectContaining({ type: 'purchase_agreement', leadId: 'l1' }),
        'org-A'
      );
    });

    it('scopes lead lookup to organization (IDOR prevention)', async () => {
      mockSql.mockResolvedValueOnce([]);
      await POST(mockRequest({ contractType: 'purchase_agreement', leadId: 'other-org-lead' }));

      const call = mockSql.mock.calls[0];
      expect(call).toContain('other-org-lead');
      expect(call).toContain('org-A');
    });
  });

  describe('assignment_contract', () => {
    it('400 when buyerId or negotiationId missing', async () => {
      const res = await POST(mockRequest({ contractType: 'assignment_contract' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: 'buyerId and negotiationId required for assignment_contract',
      });
    });

    it('404 when buyer not found', async () => {
      mockSql.mockResolvedValueOnce([]); // buyer not found
      const res = await POST(mockRequest({
        contractType: 'assignment_contract',
        buyerId: 'b1',
        negotiationId: 'n1',
      }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Buyer not found' });
    });

    it('404 when negotiation not found', async () => {
      mockSql
        .mockResolvedValueOnce([{ id: 'b1', name: 'Buyer', email: 'buyer@example.com' }])
        .mockResolvedValueOnce([]); // negotiation not found

      const res = await POST(mockRequest({
        contractType: 'assignment_contract',
        buyerId: 'b1',
        negotiationId: 'n1',
      }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Negotiation not found' });
    });

    it('400 when assignment fee is below $5,000 minimum', async () => {
      mockSql
        .mockResolvedValueOnce([{ id: 'b1', name: 'Buyer', email: 'buyer@example.com' }])
        .mockResolvedValueOnce([{
          id: 'n1',
          lead_id: 'l1',
          seller_name: 'Seller',
          assignment_fee: 3000, // Below minimum
          metadata: { property_address: '123 Main St' },
        }]);

      const res = await POST(mockRequest({
        contractType: 'assignment_contract',
        buyerId: 'b1',
        negotiationId: 'n1',
      }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('at least $5,000');
    });

    it('sends assignment contract when fee meets minimum', async () => {
      mockSql
        .mockResolvedValueOnce([{ id: 'b1', name: 'Buyer Name', email: 'buyer@example.com' }])
        .mockResolvedValueOnce([{
          id: 'n1',
          lead_id: 'l1',
          seller_name: 'Seller',
          assignment_fee: 10000, // Meets minimum
          created_at: new Date().toISOString(),
          metadata: { property_address: '123 Main St' },
        }])
        .mockResolvedValueOnce([]) // insert contract
        .mockResolvedValueOnce([]); // update with envelope

      const res = await POST(mockRequest({
        contractType: 'assignment_contract',
        buyerId: 'b1',
        negotiationId: 'n1',
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.assignmentFee).toBe(10000);
      expect(body.signingLink).toBeDefined();

      expect(logEvent).toHaveBeenCalledWith(
        'contract_sent',
        'contract',
        expect.any(String),
        expect.objectContaining({
          type: 'assignment_contract',
          buyerId: 'b1',
          assignmentFee: 10000,
        }),
        'org-A'
      );
    });

    it('scopes buyer lookup to organization (IDOR prevention)', async () => {
      mockSql.mockResolvedValueOnce([]);
      await POST(mockRequest({
        contractType: 'assignment_contract',
        buyerId: 'other-org-buyer',
        negotiationId: 'n1',
      }));

      const call = mockSql.mock.calls[0];
      expect(call).toContain('other-org-buyer');
      expect(call).toContain('org-A');
    });
  });
});
