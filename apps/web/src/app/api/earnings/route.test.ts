/**
 * Tests for /api/earnings
 * Covers: GET earnings list with summary, POST create earning
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

// Note: Can't reliably mock crypto.randomUUID in this environment,
// so we'll verify the pattern instead of exact ID

import { GET, POST } from './route';

function mockRequest(body: object) {
  return {
    json: async () => body,
  } as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-A' });
});

describe('GET /api/earnings', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns earnings with summary for user', async () => {
    const mockEarnings = [
      { id: 'earn-1', amount_cents: 500000, status: 'AVAILABLE' },
      { id: 'earn-2', amount_cents: 300000, status: 'PENDING' },
    ];
    const mockSummary = [{
      pending: 300000,
      available: 500000,
      withdrawn: 0,
      refunded: 0,
      total_earned: 500000,
    }];

    mockSql
      .mockResolvedValueOnce(mockEarnings)
      .mockResolvedValueOnce(mockSummary)
      .mockResolvedValueOnce([]) // payout settings
      .mockResolvedValueOnce([]); // bank account

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.earnings).toHaveLength(2);
    expect(body.summary.pending).toBe(300000);
    expect(body.summary.available).toBe(500000);
    expect(body.minimumPayout).toBe(10000);
  });

  it('scopes earnings to user and organization (IDOR prevention)', async () => {
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ pending: 0, available: 0, withdrawn: 0, refunded: 0, total_earned: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await GET();

    // First call should query earnings with user_id and organization_id
    const earningsCall = mockSql.mock.calls[0];
    expect(earningsCall).toContain('user-1');
    expect(earningsCall).toContain('org-A');
  });

  it('returns default summary when no earnings exist', async () => {
    mockSql
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]) // Empty summary
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.summary.pending).toBe(0);
    expect(body.summary.available).toBe(0);
  });
});

describe('POST /api/earnings', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(mockRequest({ contractId: 'c1', amountCents: 50000 }));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(mockRequest({ contractId: 'c1', amountCents: 50000 }));
    expect(res.status).toBe(403);
  });

  it('400 when contractId missing', async () => {
    const res = await POST(mockRequest({ amountCents: 50000 }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'contractId and positive amountCents are required',
    });
  });

  it('400 when amountCents missing or zero', async () => {
    const res = await POST(mockRequest({ contractId: 'c1', amountCents: 0 }));
    expect(res.status).toBe(400);
  });

  it('400 when amountCents is negative', async () => {
    const res = await POST(mockRequest({ contractId: 'c1', amountCents: -1000 }));
    expect(res.status).toBe(400);
  });

  it('404 when contract not found or belongs to different org', async () => {
    mockSql.mockResolvedValueOnce([]); // contract query
    const res = await POST(mockRequest({ contractId: 'other-org-contract', amountCents: 50000 }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Contract not found' });
  });

  it('409 when earning already exists for contract', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'c1', status: 'CLOSED' }]) // contract exists
      .mockResolvedValueOnce([{ id: 'existing-earning' }]); // earning exists

    const res = await POST(mockRequest({ contractId: 'c1', amountCents: 50000 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'Earning already exists for this contract',
    });
  });

  it('creates earning with default hold period', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'c1', status: 'CLOSED' }]) // contract
      .mockResolvedValueOnce([]) // no existing earning
      .mockResolvedValueOnce([]) // no payout settings
      .mockResolvedValueOnce([]); // insert

    const res = await POST(mockRequest({ contractId: 'c1', amountCents: 500000 }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.earningId).toMatch(/^earn_[a-f0-9-]+$/);
    expect(body.amountCents).toBe(500000);
    expect(body.status).toBe('PENDING');
    expect(body.holdDays).toBe(14); // default
  });

  it('uses custom hold period from payout settings', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'c1', status: 'CLOSED' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ default_hold_days: 7 }]) // custom settings
      .mockResolvedValueOnce([]);

    const res = await POST(mockRequest({ contractId: 'c1', amountCents: 500000 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdDays).toBe(7);
  });

  it('uses explicit holdDays when provided', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'c1', status: 'CLOSED' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ default_hold_days: 7 }])
      .mockResolvedValueOnce([]);

    const res = await POST(mockRequest({
      contractId: 'c1',
      amountCents: 500000,
      holdDays: 21,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdDays).toBe(21);
  });
});
