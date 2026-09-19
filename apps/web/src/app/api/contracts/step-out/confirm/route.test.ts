/**
 * Tests for GET /api/contracts/step-out/confirm
 * Covers: token validation, expiration, status updates, email notifications
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { sendEmailAuto } = vi.hoisted(() => ({ sendEmailAuto: vi.fn(async () => ({ success: true })) }));
vi.mock('@/app/api/utils/emailProviders', () => ({ sendEmailAuto }));

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: (...a: any[]) => logEvent(...a) }));

const { enqueueJob } = vi.hoisted(() => ({ enqueueJob: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/jobs', () => ({ enqueueJob }));

const mockStepOutEngine = vi.hoisted(() => ({
  generateSellerCancellationConfirmedEmail: vi.fn(() => ({
    subject: 'Cancellation Confirmed',
    bodyHtml: '<p>Confirmed</p>',
    bodyText: 'Confirmed',
  })),
  generateBuyerNotificationOfSellerCancellation: vi.fn(() => ({
    subject: 'Seller Cancelled',
    bodyHtml: '<p>Seller cancelled</p>',
    bodyText: 'Seller cancelled',
  })),
  generateSellerNotificationOfBuyerCancellation: vi.fn(() => ({
    subject: 'Buyer Cancelled',
    bodyHtml: '<p>Buyer cancelled</p>',
    bodyText: 'Buyer cancelled',
  })),
  generateDealEndedEmail: vi.fn(() => ({
    subject: 'Deal Ended',
    bodyHtml: '<p>Deal ended</p>',
    bodyText: 'Deal ended',
  })),
}));
vi.mock('@/app/api/utils/step-out-engine', () => mockStepOutEngine);

import { GET } from './route';
import type { NextRequest } from 'next/server';

function mockRequest(token: string | null): NextRequest {
  return {
    nextUrl: {
      searchParams: {
        get: (key: string) => (key === 'token' ? token : null),
      },
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/contracts/step-out/confirm', () => {
  it('400 when token is missing', async () => {
    const res = await GET(mockRequest(null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Confirmation token required' });
  });

  it('404 when token is invalid or not found', async () => {
    mockSql.mockResolvedValueOnce([]); // request not found
    const res = await GET(mockRequest('invalid-token'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Invalid or expired confirmation link');
  });

  it('400 when request already confirmed', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'r1',
      organization_id: 'org-A',
      contract_id: 'c1',
      party: 'seller',
      status: 'confirmed', // Already confirmed
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }]);

    const res = await GET(mockRequest('valid-token'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Already confirmed');
  });

  it('400 when token has expired', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'r1',
      organization_id: 'org-A',
      contract_id: 'c1',
      party: 'seller',
      status: 'pending',
      expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Expired
    }]);

    const res = await GET(mockRequest('expired-token'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Link expired');
  });

  it('404 when contract not found', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'r1',
        organization_id: 'org-A',
        contract_id: 'c1',
        party: 'seller',
        status: 'pending',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }])
      .mockResolvedValueOnce([]); // contract not found

    const res = await GET(mockRequest('valid-token'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Contract not found' });
  });

  it('processes seller step-out: cancels contract, notifies buyer', async () => {
    const mockRequest_ = {
      id: 'r1',
      organization_id: 'org-A',
      contract_id: 'c1',
      party: 'seller',
      reason: 'Changed my mind',
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    const mockContract = {
      id: 'c1',
      status: 'SIGNED',
      seller_lead_id: 'l1',
      buyer_lead_id: 'b1',
      seller_name: 'John Seller',
      seller_email: 'seller@example.com',
      buyer_name: 'Jane Buyer',
      buyer_email: 'buyer@example.com',
      assigned_at: new Date().toISOString(),
      property_address: '123 Main St',
    };

    mockSql
      .mockResolvedValueOnce([mockRequest_])
      .mockResolvedValueOnce([mockContract])
      .mockResolvedValueOnce([]) // update request status
      .mockResolvedValueOnce([]); // update contract status

    const res = await GET(mockRequest('valid-token'));

    // Returns HTML success page
    expect(res.headers.get('Content-Type')).toBe('text/html');
    const html = await res.text();
    expect(html).toContain('Step-Out Confirmed');
    expect(html).toContain('123 Main St');

    // Contract should be CANCELLED for seller step-out
    const updateCall = mockSql.mock.calls.find(c => {
      const query = Array.isArray(c[0]) ? c[0].join('') : String(c[0]);
      return query.includes('CANCELLED');
    });
    expect(updateCall).toBeDefined();

    // Should notify buyer of seller cancellation
    expect(sendEmailAuto).toHaveBeenCalledWith(
      'org-A',
      expect.objectContaining({ to: 'buyer@example.com' })
    );

    // Should queue earnest money refund
    expect(enqueueJob).toHaveBeenCalledWith(
      'process_earnest_money_refund',
      expect.objectContaining({
        contractId: 'c1',
        reason: 'seller_step_out',
      })
    );

    expect(logEvent).toHaveBeenCalledWith(
      'step_out_confirmed',
      'contract',
      'c1',
      expect.objectContaining({ party: 'seller' }),
      'org-A'
    );
  });

  it('processes buyer step-out: queues replacement buyer, keeps contract active', async () => {
    const mockRequest_ = {
      id: 'r1',
      organization_id: 'org-A',
      contract_id: 'c1',
      party: 'buyer',
      reason: 'Found better deal',
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    const mockContract = {
      id: 'c1',
      status: 'SIGNED',
      seller_lead_id: 'l1',
      buyer_lead_id: 'b1',
      seller_name: 'John Seller',
      seller_email: 'seller@example.com',
      buyer_name: 'Jane Buyer',
      buyer_email: 'buyer@example.com',
      assigned_at: new Date().toISOString(),
      property_address: '123 Main St',
    };

    mockSql
      .mockResolvedValueOnce([mockRequest_])
      .mockResolvedValueOnce([mockContract])
      .mockResolvedValueOnce([]) // update request status
      .mockResolvedValueOnce([]); // update contract status

    const res = await GET(mockRequest('valid-token'));

    expect(res.headers.get('Content-Type')).toBe('text/html');

    // Should notify seller that we're finding new buyer
    expect(sendEmailAuto).toHaveBeenCalledWith(
      'org-A',
      expect.objectContaining({ to: 'seller@example.com' })
    );

    // Should queue job to find replacement buyer
    expect(enqueueJob).toHaveBeenCalledWith(
      'find_replacement_buyer',
      expect.objectContaining({
        contractId: 'c1',
        previousBuyerId: 'b1',
        reason: 'buyer_step_out',
      })
    );

    // Contract should be PENDING_BUYER, not CANCELLED
    const updateCall = mockSql.mock.calls.find(c => {
      const query = Array.isArray(c[0]) ? c[0].join('') : String(c[0]);
      return query.includes('PENDING_BUYER');
    });
    expect(updateCall).toBeDefined();
  });

  it('sends deal-ended email to initiator', async () => {
    const mockRequest_ = {
      id: 'r1',
      organization_id: 'org-A',
      contract_id: 'c1',
      party: 'seller',
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    const mockContract = {
      id: 'c1',
      seller_name: 'John Seller',
      seller_email: 'seller@example.com',
      property_address: '123 Main St',
    };

    mockSql
      .mockResolvedValueOnce([mockRequest_])
      .mockResolvedValueOnce([mockContract])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await GET(mockRequest('valid-token'));

    expect(mockStepOutEngine.generateDealEndedEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        party: 'seller',
        initiatedBy: 'seller',
      })
    );
  });

  it('handles contract without assigned buyer (seller step-out)', async () => {
    const mockRequest_ = {
      id: 'r1',
      organization_id: 'org-A',
      contract_id: 'c1',
      party: 'seller',
      status: 'pending',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
    const mockContract = {
      id: 'c1',
      seller_name: 'John Seller',
      seller_email: 'seller@example.com',
      buyer_email: null, // No buyer assigned
      assigned_at: null,
      property_address: '123 Main St',
    };

    mockSql
      .mockResolvedValueOnce([mockRequest_])
      .mockResolvedValueOnce([mockContract])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await GET(mockRequest('valid-token'));
    expect(res.headers.get('Content-Type')).toBe('text/html');

    // Should not queue earnest money refund (no buyer)
    expect(enqueueJob).not.toHaveBeenCalledWith(
      'process_earnest_money_refund',
      expect.anything()
    );
  });
});
