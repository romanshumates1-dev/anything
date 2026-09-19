/**
 * Tests for /api/contracts/[id]
 * Covers: GET single contract, PATCH status updates, earning creation on close
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

const { onContractClosed } = vi.hoisted(() => ({ onContractClosed: vi.fn() }));
vi.mock('@/app/api/utils/earningsEscrow', () => ({ onContractClosed: (...a: any[]) => onContractClosed(...a) }));

import { GET, PATCH } from './route';

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
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-A' });
});

describe('GET /api/contracts/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET({} as Request, mockParams('contract-1'));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET({} as Request, mockParams('contract-1'));
    expect(res.status).toBe(403);
  });

  it('404 when contract not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await GET({} as Request, mockParams('nonexistent'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Contract not found' });
  });

  it('returns contract scoped to organization (IDOR prevention)', async () => {
    const mockContract = {
      id: 'contract-1',
      direction: 'acquisition',
      status: 'SIGNED',
      organization_id: 'org-A',
    };
    mockSql.mockResolvedValueOnce([mockContract]);

    const res = await GET({} as Request, mockParams('contract-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('contract-1');

    // Verify org scoping in query
    const call = mockSql.mock.calls[0];
    expect(call).toContain('org-A');
    expect(call).toContain('contract-1');
  });

  it('does not leak contracts from other organizations', async () => {
    // Simulate query returning nothing due to org filter
    mockSql.mockResolvedValueOnce([]);
    const res = await GET({} as Request, mockParams('contract-from-other-org'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/contracts/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await PATCH(mockRequest({ status: 'SIGNED' }), mockParams('contract-1'));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await PATCH(mockRequest({ status: 'SIGNED' }), mockParams('contract-1'));
    expect(res.status).toBe(403);
  });

  it('404 when contract not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await PATCH(mockRequest({ status: 'SIGNED' }), mockParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('400 for invalid status', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'c1', status: 'DRAFT', organization_id: 'org-A' }]);
    const res = await PATCH(mockRequest({ status: 'INVALID_STATUS' }), mockParams('c1'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid status');
  });

  it('400 when no updates provided', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'c1', status: 'DRAFT', organization_id: 'org-A' }]);
    const res = await PATCH(mockRequest({}), mockParams('c1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No updates provided' });
  });

  it('updates contract status successfully', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'c1', status: 'DRAFT', organization_id: 'org-A' }])
      .mockResolvedValueOnce([]) // UPDATE
      .mockResolvedValueOnce([]); // audit log

    const res = await PATCH(mockRequest({ status: 'SIGNED' }), mockParams('c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.newStatus).toBe('SIGNED');
  });

  it('triggers earning creation when status changes to CLOSED', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'c1',
        status: 'SIGNED',
        assignment_fee_cents: 500000,
        organization_id: 'org-A',
      }])
      .mockResolvedValueOnce([]) // UPDATE
      .mockResolvedValueOnce([]) // earning audit log
      .mockResolvedValueOnce([]); // status audit log

    onContractClosed.mockResolvedValueOnce(undefined);

    const res = await PATCH(mockRequest({ status: 'CLOSED' }), mockParams('c1'));
    expect(res.status).toBe(200);

    expect(onContractClosed).toHaveBeenCalledWith({
      contractId: 'c1',
      organizationId: 'org-A',
      userId: 'user-1',
      assignmentFeeCents: 500000,
    });
  });

  it('does not trigger earning when already CLOSED', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'c1',
        status: 'CLOSED', // Already closed
        assignment_fee_cents: 500000,
        organization_id: 'org-A',
      }])
      .mockResolvedValueOnce([]) // UPDATE
      .mockResolvedValueOnce([]); // audit log

    const res = await PATCH(mockRequest({ status: 'CLOSED' }), mockParams('c1'));
    expect(res.status).toBe(200);
    expect(onContractClosed).not.toHaveBeenCalled();
  });
});
