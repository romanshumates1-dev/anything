/**
 * Tests for /api/territories
 * Covers: GET list, POST create territory
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

// Note: Can't reliably mock crypto.randomUUID in this environment

import { GET, POST } from './route';
import type { NextRequest } from 'next/server';

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

describe('GET /api/territories', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET({} as NextRequest);
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET({} as NextRequest);
    expect(res.status).toBe(403);
  });

  it('returns territories scoped to organization', async () => {
    const mockTerritories = [
      {
        id: 't1',
        name: 'Phoenix Metro',
        regionCount: 15,
        isDefault: true,
      },
      {
        id: 't2',
        name: 'Tucson Area',
        regionCount: 8,
        isDefault: false,
      },
    ];
    mockSql.mockResolvedValueOnce(mockTerritories);

    const res = await GET({} as NextRequest);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0].name).toBe('Phoenix Metro');

    // Verify org scoping
    const call = mockSql.mock.calls[0];
    expect(call).toContain('org-A');
  });

  it('returns empty array when no territories exist', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await GET({} as NextRequest);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });
});

describe('POST /api/territories', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(mockRequest({
      name: 'Test Territory',
      regions: [{ type: 'ZIP', value: '85001', include: true }],
    }));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(mockRequest({
      name: 'Test Territory',
      regions: [{ type: 'ZIP', value: '85001', include: true }],
    }));
    expect(res.status).toBe(403);
  });

  it('400 when name is missing', async () => {
    const res = await POST(mockRequest({
      regions: [{ type: 'ZIP', value: '85001', include: true }],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Name is required' });
  });

  it('400 when name is empty string', async () => {
    const res = await POST(mockRequest({
      name: '   ',
      regions: [{ type: 'ZIP', value: '85001', include: true }],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Name is required' });
  });

  it('400 when name exceeds 100 characters', async () => {
    const res = await POST(mockRequest({
      name: 'A'.repeat(101),
      regions: [{ type: 'ZIP', value: '85001', include: true }],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Name must be 100 characters or less' });
  });

  it('400 when regions is empty', async () => {
    const res = await POST(mockRequest({
      name: 'Test Territory',
      regions: [],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'At least one region is required' });
  });

  it('400 when regions exceeds 500', async () => {
    const regions = Array.from({ length: 501 }, (_, i) => ({
      type: 'ZIP',
      value: String(85000 + i),
      include: true,
    }));
    const res = await POST(mockRequest({
      name: 'Huge Territory',
      regions,
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Maximum 500 regions per territory' });
  });

  it('400 for invalid region type', async () => {
    const res = await POST(mockRequest({
      name: 'Test Territory',
      regions: [{ type: 'INVALID', value: '85001', include: true }],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid region type: INVALID' });
  });

  it('400 when region value is missing', async () => {
    const res = await POST(mockRequest({
      name: 'Test Territory',
      regions: [{ type: 'ZIP', value: '', include: true }],
    }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Region value is required' });
  });

  it('409 when territory name already exists (case insensitive)', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'existing-t1' }]); // duplicate check
    const res = await POST(mockRequest({
      name: 'Phoenix Metro',
      regions: [{ type: 'ZIP', value: '85001', include: true }],
    }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'A territory with this name already exists' });
  });

  it('creates territory successfully', async () => {
    const created = {
      id: 'test-territory-uuid',
      name: 'New Territory',
      regionCount: 2,
      isDefault: false,
    };
    mockSql
      .mockResolvedValueOnce([]) // no duplicate
      .mockResolvedValueOnce([created]); // insert

    const res = await POST(mockRequest({
      name: 'New Territory',
      regions: [
        { type: 'ZIP', value: '85001', include: true },
        { type: 'ZIP', value: '85002', include: true },
      ],
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('New Territory');
    expect(logEvent).toHaveBeenCalledWith(
      'territory_created',
      'territory',
      expect.stringMatching(/^[a-f0-9-]+$/),
      expect.objectContaining({ regionCount: 2 }),
      'user-1'
    );
  });

  it('clears other defaults when setting isDefault', async () => {
    mockSql
      .mockResolvedValueOnce([]) // no duplicate
      .mockResolvedValueOnce([]) // clear other defaults
      .mockResolvedValueOnce([{ id: 'new', isDefault: true }]); // insert

    const res = await POST(mockRequest({
      name: 'Default Territory',
      regions: [{ type: 'STATE', value: 'AZ', include: true }],
      isDefault: true,
    }));

    expect(res.status).toBe(201);
    // Verify clear defaults was called (3 total calls)
    expect(mockSql).toHaveBeenCalledTimes(3);
  });

  it('supports all region types', async () => {
    mockSql
      .mockResolvedValueOnce([]) // no duplicate
      .mockResolvedValueOnce([{ id: 'new' }]); // insert

    const res = await POST(mockRequest({
      name: 'Multi-Type Territory',
      regions: [
        { type: 'ZIP', value: '85001', include: true },
        { type: 'COUNTY', value: 'Maricopa', include: true },
        { type: 'STATE', value: 'AZ', include: true },
        { type: 'CITY', value: 'Phoenix', include: true },
        { type: 'MSA', value: 'Phoenix-Mesa-Chandler', include: true },
      ],
    }));

    expect(res.status).toBe(201);
  });
});
