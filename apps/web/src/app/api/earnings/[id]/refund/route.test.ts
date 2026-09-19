/**
 * Tests for POST /api/earnings/[id]/refund
 * Covers: auth, status validation, permission checks, refund processing
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

import { POST } from './route';

function mockParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function mockRequest(body: object) {
  return {
    json: async () => body,
  } as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1', role: 'MEMBER' } });
  getOrganization.mockResolvedValue({ id: 'org-A' });
});

describe('POST /api/earnings/[id]/refund', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(mockRequest({ reason: 'Deal fell through' }), mockParams('earn-1'));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(mockRequest({ reason: 'Deal fell through' }), mockParams('earn-1'));
    expect(res.status).toBe(403);
  });

  it('400 when reason is missing', async () => {
    const res = await POST(mockRequest({}), mockParams('earn-1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Refund reason is required' });
  });

  it('404 when earning not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(mockRequest({ reason: 'Deal fell through' }), mockParams('nonexistent'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Earning not found' });
  });

  it('scopes earning lookup to organization (IDOR prevention)', async () => {
    mockSql.mockResolvedValueOnce([]); // earning not found for this org
    const res = await POST(mockRequest({ reason: 'Test' }), mockParams('other-org-earning'));
    expect(res.status).toBe(404);

    // Verify org filter in query
    const call = mockSql.mock.calls[0];
    expect(call).toContain('org-A');
  });

  it('400 when earning status is AVAILABLE (inspection period passed)', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'earn-1',
      status: 'AVAILABLE',
      amount_cents: 500000,
    }]);

    const res = await POST(mockRequest({ reason: 'Deal fell through' }), mockParams('earn-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot refund earning with status AVAILABLE');
  });

  it('400 when earning status is WITHDRAWN (already paid out)', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'earn-1',
      status: 'WITHDRAWN',
      amount_cents: 500000,
    }]);

    const res = await POST(mockRequest({ reason: 'Buyer backed out' }), mockParams('earn-1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Cannot refund earning with status WITHDRAWN');
  });

  it('403 when non-admin non-owner tries to refund', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'earn-1',
        status: 'PENDING',
        amount_cents: 500000,
      }])
      .mockResolvedValueOnce([{ user_id: 'other-user' }]); // earning belongs to different user

    const res = await POST(mockRequest({ reason: 'Test' }), mockParams('earn-1'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('allows earning owner to refund their PENDING earning', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'earn-1',
        status: 'PENDING',
        amount_cents: 500000,
        contract_id: 'c1',
      }])
      .mockResolvedValueOnce([{ user_id: 'user-1' }]) // owner check
      .mockResolvedValueOnce([]) // UPDATE
      .mockResolvedValueOnce([]); // audit log

    const res = await POST(mockRequest({ reason: 'Buyer backed out' }), mockParams('earn-1'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.previousStatus).toBe('PENDING');
    expect(body.newStatus).toBe('REFUNDED');
    expect(body.reason).toBe('Buyer backed out');
  });

  it('allows ADMIN to refund any PENDING earning', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });

    mockSql
      .mockResolvedValueOnce([{
        id: 'earn-1',
        status: 'PENDING',
        amount_cents: 500000,
        contract_id: 'c1',
      }])
      .mockResolvedValueOnce([{ user_id: 'other-user' }]) // belongs to different user
      .mockResolvedValueOnce([]) // UPDATE
      .mockResolvedValueOnce([]); // audit log

    const res = await POST(mockRequest({ reason: 'Admin override: inspection failed' }), mockParams('earn-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('creates audit log entry on refund', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'earn-1',
        status: 'PENDING',
        amount_cents: 500000,
        contract_id: 'c1',
      }])
      .mockResolvedValueOnce([{ user_id: 'user-1' }])
      .mockResolvedValueOnce([]) // UPDATE
      .mockResolvedValueOnce([]); // audit log

    await POST(mockRequest({ reason: 'Deal fell through' }), mockParams('earn-1'));

    // Verify audit log was called
    expect(mockSql).toHaveBeenCalledTimes(4);
    const auditCall = mockSql.mock.calls[3];
    const query = auditCall[0].join('?');
    expect(query).toContain('audit_logs');
    expect(query).toContain('earning_refunded');
  });
});
