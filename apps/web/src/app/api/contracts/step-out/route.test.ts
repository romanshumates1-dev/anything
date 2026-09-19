/**
 * Tests for POST /api/contracts/step-out
 * Covers: auth, validation, inspection period checks, email sending
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

const { sendEmailAuto } = vi.hoisted(() => ({ sendEmailAuto: vi.fn(async () => ({ success: true })) }));
vi.mock('@/app/api/utils/emailProviders', () => ({ sendEmailAuto }));

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: (...a: any[]) => logEvent(...a) }));

const { clockState } = vi.hoisted(() => ({
  clockState: vi.fn(() => ({ stage: 'active', daysRemaining: 10 })),
}));
vi.mock('@/app/api/utils/inspectionClockCore', () => ({ clockState }));

const { generateStepOutConfirmationEmail } = vi.hoisted(() => ({
  generateStepOutConfirmationEmail: vi.fn(() => ({
    subject: 'Confirm Step-Out',
    bodyHtml: '<p>Please confirm</p>',
    bodyText: 'Please confirm',
  })),
}));
vi.mock('@/app/api/utils/step-out-engine', () => ({ generateStepOutConfirmationEmail }));

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
  clockState.mockReturnValue({ stage: 'active', daysRemaining: 10 });
});

describe('POST /api/contracts/step-out', () => {
  it('401 without admin auth', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = await POST(mockRequest({ contractId: 'c1', party: 'seller' }));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(mockRequest({ contractId: 'c1', party: 'seller' }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'No organization found' });
  });

  it('400 when contractId is missing', async () => {
    const res = await POST(mockRequest({ party: 'seller' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'contractId and party (seller/buyer) required' });
  });

  it('400 when party is invalid', async () => {
    const res = await POST(mockRequest({ contractId: 'c1', party: 'agent' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'contractId and party (seller/buyer) required' });
  });

  it('404 when contract not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(mockRequest({ contractId: 'nonexistent', party: 'seller' }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Contract not found' });
  });

  it('400 when inspection period has expired', async () => {
    const mockContract = {
      id: 'c1',
      status: 'SIGNED',
      inspection_days: 14,
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      seller_name: 'John Seller',
      seller_email: 'seller@example.com',
    };
    mockSql.mockResolvedValueOnce([mockContract]);
    clockState.mockReturnValue({ stage: 'expired', daysRemaining: 0 });

    const res = await POST(mockRequest({ contractId: 'c1', party: 'seller' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Inspection period has expired');
  });

  it('400 when party has no email on file', async () => {
    const mockContract = {
      id: 'c1',
      status: 'SIGNED',
      inspection_days: 14,
      created_at: new Date().toISOString(),
      seller_name: 'John Seller',
      seller_email: null, // No email
    };
    mockSql.mockResolvedValueOnce([mockContract]);

    const res = await POST(mockRequest({ contractId: 'c1', party: 'seller' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No email on file for seller' });
  });

  it('initiates seller step-out successfully', async () => {
    const mockContract = {
      id: 'c1',
      status: 'SIGNED',
      inspection_days: 14,
      created_at: new Date().toISOString(),
      seller_name: 'John Seller',
      seller_email: 'seller@example.com',
      property_address: '123 Main St',
    };
    mockSql
      .mockResolvedValueOnce([mockContract])
      .mockResolvedValueOnce([]); // insert step_out_request

    const res = await POST(mockRequest({
      contractId: 'c1',
      party: 'seller',
      reason: 'Changed my mind',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.message).toContain('seller@example.com');
    expect(body.inspectionDaysRemaining).toBe(10);

    expect(sendEmailAuto).toHaveBeenCalledWith(
      'org-A',
      expect.objectContaining({
        to: 'seller@example.com',
        subject: 'Confirm Step-Out',
      })
    );

    expect(logEvent).toHaveBeenCalledWith(
      'step_out_requested',
      'contract',
      'c1',
      expect.objectContaining({ party: 'seller', reason: 'Changed my mind' }),
      'org-A'
    );
  });

  it('initiates buyer step-out successfully', async () => {
    const mockContract = {
      id: 'c1',
      status: 'SIGNED',
      inspection_days: 14,
      created_at: new Date().toISOString(),
      seller_name: 'John Seller',
      seller_email: 'seller@example.com',
      buyer_name: 'Jane Buyer',
      buyer_email: 'buyer@example.com',
      property_address: '123 Main St',
    };
    mockSql
      .mockResolvedValueOnce([mockContract])
      .mockResolvedValueOnce([]);

    const res = await POST(mockRequest({
      contractId: 'c1',
      party: 'buyer',
      reason: 'Found better deal',
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toContain('buyer@example.com');

    expect(sendEmailAuto).toHaveBeenCalledWith(
      'org-A',
      expect.objectContaining({
        to: 'buyer@example.com',
      })
    );

    expect(generateStepOutConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        party: 'buyer',
        partyEmail: 'buyer@example.com',
      })
    );
  });

  it('scopes contract lookup to organization (IDOR prevention)', async () => {
    mockSql.mockResolvedValueOnce([]); // contract not found due to org filter
    await POST(mockRequest({ contractId: 'other-org-contract', party: 'seller' }));

    const call = mockSql.mock.calls[0];
    expect(call).toContain('other-org-contract');
    expect(call).toContain('org-A');
  });

  it('stores step-out request with expiration', async () => {
    const mockContract = {
      id: 'c1',
      status: 'SIGNED',
      inspection_days: 14,
      created_at: new Date().toISOString(),
      seller_name: 'John Seller',
      seller_email: 'seller@example.com',
    };
    mockSql
      .mockResolvedValueOnce([mockContract])
      .mockResolvedValueOnce([]);

    const res = await POST(mockRequest({ contractId: 'c1', party: 'seller' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.expiresAt).toBeDefined();

    // Verify step_out_request insert was called
    expect(mockSql).toHaveBeenCalledTimes(2);
  });
});
