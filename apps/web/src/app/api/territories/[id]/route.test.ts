/**
 * Tests for /api/territories/[id]
 * Covers: GET single territory, PATCH update, DELETE
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

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: (...a: any[]) => logEvent(...a) }));

import { GET, PATCH, DELETE } from './route';
import type { NextRequest } from 'next/server';

function mockParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function mockRequest(body?: object): NextRequest {
  return {
    json: async () => body || {},
  } as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-A' });
});

describe('GET /api/territories/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET({} as NextRequest, mockParams('t1'));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET({} as NextRequest, mockParams('t1'));
    expect(res.status).toBe(403);
  });

  it('404 when territory not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await GET({} as NextRequest, mockParams('nonexistent'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Territory not found' });
  });

  it('returns territory scoped to organization (IDOR prevention)', async () => {
    const mockTerritory = {
      id: 't1',
      name: 'Phoenix Metro',
      regions: [{ type: 'ZIP', value: '85001', include: true }],
      regionCount: 1,
    };
    mockSql.mockResolvedValueOnce([mockTerritory]);

    const res = await GET({} as NextRequest, mockParams('t1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Phoenix Metro');

    // Verify both id and org scoping
    const call = mockSql.mock.calls[0];
    expect(call).toContain('t1');
    expect(call).toContain('org-A');
  });

  it('does not leak territories from other organizations', async () => {
    mockSql.mockResolvedValueOnce([]); // org filter excludes it
    const res = await GET({} as NextRequest, mockParams('other-org-territory'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/territories/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await PATCH(mockRequest({ name: 'Updated' }), mockParams('t1'));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await PATCH(mockRequest({ name: 'Updated' }), mockParams('t1'));
    expect(res.status).toBe(403);
  });

  it('404 when territory not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await PATCH(mockRequest({ name: 'Updated' }), mockParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('400 when name is empty', async () => {
    mockSql.mockResolvedValueOnce([{ id: 't1' }]); // exists
    const res = await PATCH(mockRequest({ name: '' }), mockParams('t1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Name cannot be empty' });
  });

  it('400 when name exceeds 100 characters', async () => {
    mockSql.mockResolvedValueOnce([{ id: 't1' }]);
    const res = await PATCH(mockRequest({ name: 'A'.repeat(101) }), mockParams('t1'));
    expect(res.status).toBe(400);
  });

  it('409 when name conflicts with another territory', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 't1' }]) // exists
      .mockResolvedValueOnce([{ id: 't2' }]); // duplicate name

    const res = await PATCH(mockRequest({ name: 'Existing Name' }), mockParams('t1'));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'A territory with this name already exists' });
  });

  it('400 when regions array is empty', async () => {
    mockSql.mockResolvedValueOnce([{ id: 't1' }]);
    const res = await PATCH(mockRequest({ regions: [] }), mockParams('t1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'At least one region is required' });
  });

  it('400 when regions exceed 500', async () => {
    mockSql.mockResolvedValueOnce([{ id: 't1' }]);
    const regions = Array.from({ length: 501 }, () => ({ type: 'ZIP', value: '85001', include: true }));
    const res = await PATCH(mockRequest({ regions }), mockParams('t1'));
    expect(res.status).toBe(400);
  });

  it('400 for invalid region type in update', async () => {
    mockSql.mockResolvedValueOnce([{ id: 't1' }]);
    const res = await PATCH(mockRequest({
      regions: [{ type: 'INVALID', value: '85001', include: true }],
    }), mockParams('t1'));
    expect(res.status).toBe(400);
  });

  it('updates territory name successfully', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 't1' }]) // exists
      .mockResolvedValueOnce([]) // no duplicate name
      .mockResolvedValueOnce([{ id: 't1', name: 'Updated Name' }]); // update

    const res = await PATCH(mockRequest({ name: 'Updated Name' }), mockParams('t1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Name');
    expect(logEvent).toHaveBeenCalledWith(
      'territory_updated',
      'territory',
      't1',
      expect.any(Object),
      'user-1'
    );
  });

  it('updates regions successfully', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 't1' }])
      .mockResolvedValueOnce([{ id: 't1', regionCount: 3 }]);

    const res = await PATCH(mockRequest({
      regions: [
        { type: 'ZIP', value: '85001', include: true },
        { type: 'ZIP', value: '85002', include: true },
        { type: 'ZIP', value: '85003', include: true },
      ],
    }), mockParams('t1'));

    expect(res.status).toBe(200);
  });

  it('clears other defaults when setting isDefault', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 't1' }]) // exists
      .mockResolvedValueOnce([]) // clear others
      .mockResolvedValueOnce([{ id: 't1', isDefault: true }]); // update

    const res = await PATCH(mockRequest({ isDefault: true }), mockParams('t1'));
    expect(res.status).toBe(200);
    expect(mockSql).toHaveBeenCalledTimes(3);
  });
});

describe('DELETE /api/territories/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await DELETE({} as NextRequest, mockParams('t1'));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await DELETE({} as NextRequest, mockParams('t1'));
    expect(res.status).toBe(403);
  });

  it('404 when territory not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await DELETE({} as NextRequest, mockParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('does not allow deleting territory from different org (IDOR prevention)', async () => {
    mockSql.mockResolvedValueOnce([]); // org filter excludes it
    const res = await DELETE({} as NextRequest, mockParams('other-org-territory'));
    expect(res.status).toBe(404);
  });

  it('deletes territory successfully', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 't1', name: 'Phoenix Metro' }]) // exists
      .mockResolvedValueOnce([]); // delete

    const res = await DELETE({} as NextRequest, mockParams('t1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deleted).toBe('t1');
    expect(logEvent).toHaveBeenCalledWith(
      'territory_deleted',
      'territory',
      't1',
      { name: 'Phoenix Metro' },
      'user-1'
    );
  });
});
