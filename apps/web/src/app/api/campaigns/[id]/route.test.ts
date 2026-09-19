/**
 * Tests for /api/campaigns/[id]
 * Covers: GET campaign, PATCH update, DELETE (soft delete/archive)
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

describe('GET /api/campaigns/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET({} as NextRequest, mockParams('123'));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET({} as NextRequest, mockParams('123'));
    expect(res.status).toBe(403);
  });

  it('400 for invalid campaign id (non-integer)', async () => {
    const res = await GET({} as NextRequest, mockParams('not-a-number'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid campaign id' });
  });

  it('404 when campaign not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await GET({} as NextRequest, mockParams('999'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Campaign not found' });
  });

  it('returns campaign scoped to organization (IDOR prevention)', async () => {
    const mockCampaign = {
      id: 123,
      name: 'Q4 Outreach',
      status: 'draft',
      lead_count: 150,
    };
    mockSql.mockResolvedValueOnce([mockCampaign]);

    const res = await GET({} as NextRequest, mockParams('123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Q4 Outreach');

    // Verify both id and org scoping
    const call = mockSql.mock.calls[0];
    expect(call).toContain(123);
    expect(call).toContain('org-A');
  });

  it('does not leak campaigns from other organizations', async () => {
    mockSql.mockResolvedValueOnce([]); // org filter excludes it
    const res = await GET({} as NextRequest, mockParams('456'));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/campaigns/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await PATCH(mockRequest({ name: 'Updated' }), mockParams('123'));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await PATCH(mockRequest({ name: 'Updated' }), mockParams('123'));
    expect(res.status).toBe(403);
  });

  it('400 for invalid campaign id', async () => {
    const res = await PATCH(mockRequest({ name: 'Updated' }), mockParams('abc'));
    expect(res.status).toBe(400);
  });

  it('404 when campaign not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await PATCH(mockRequest({ name: 'Updated' }), mockParams('999'));
    expect(res.status).toBe(404);
  });

  it('400 for invalid status', async () => {
    mockSql.mockResolvedValueOnce([{ id: 123, status: 'draft' }]);
    const res = await PATCH(mockRequest({ status: 'INVALID_STATUS' }), mockParams('123'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid status' });
  });

  it('updates campaign name successfully', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 123, status: 'draft' }]) // exists
      .mockResolvedValueOnce([{ id: 123, name: 'Updated Campaign' }]); // update

    const res = await PATCH(mockRequest({ name: 'Updated Campaign' }), mockParams('123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Updated Campaign');
    expect(logEvent).toHaveBeenCalledWith(
      'campaign_updated',
      'campaign',
      '123',
      expect.any(Object),
      'user-1'
    );
  });

  it('updates campaign status successfully', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 123, status: 'draft' }])
      .mockResolvedValueOnce([{ id: 123, status: 'scheduled' }]);

    const res = await PATCH(mockRequest({ status: 'scheduled' }), mockParams('123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('scheduled');
  });

  it('updates campaign template successfully', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 123, status: 'draft' }])
      .mockResolvedValueOnce([{ id: 123, template: { subject: 'New Subject' } }]);

    const res = await PATCH(mockRequest({
      template: { subject: 'New Subject', body: 'New body text' },
    }), mockParams('123'));
    expect(res.status).toBe(200);
  });

  it('validates all status transitions', async () => {
    const validStatuses = ['draft', 'scheduled', 'launched', 'paused', 'completed'];

    for (const status of validStatuses) {
      vi.clearAllMocks();
      mockSql
        .mockResolvedValueOnce([{ id: 123, status: 'draft' }])
        .mockResolvedValueOnce([{ id: 123, status }]);

      const res = await PATCH(mockRequest({ status }), mockParams('123'));
      expect(res.status).toBe(200);
    }
  });
});

describe('DELETE /api/campaigns/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await DELETE({} as NextRequest, mockParams('123'));
    expect(res.status).toBe(401);
  });

  it('403 without organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await DELETE({} as NextRequest, mockParams('123'));
    expect(res.status).toBe(403);
  });

  it('400 for invalid campaign id', async () => {
    const res = await DELETE({} as NextRequest, mockParams('abc'));
    expect(res.status).toBe(400);
  });

  it('404 when campaign not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await DELETE({} as NextRequest, mockParams('999'));
    expect(res.status).toBe(404);
  });

  it('400 when trying to delete launched campaign', async () => {
    mockSql.mockResolvedValueOnce([{ id: 123, status: 'launched', name: 'Active Campaign' }]);
    const res = await DELETE({} as NextRequest, mockParams('123'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Cannot delete active campaign. Pause or complete it first.',
    });
  });

  it('400 when trying to delete scheduled campaign', async () => {
    mockSql.mockResolvedValueOnce([{ id: 123, status: 'scheduled', name: 'Scheduled Campaign' }]);
    const res = await DELETE({} as NextRequest, mockParams('123'));
    expect(res.status).toBe(400);
  });

  it('soft deletes (archives) draft campaign', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 123, status: 'draft', name: 'Draft Campaign' }])
      .mockResolvedValueOnce([]) // archive update
      .mockResolvedValueOnce([]); // cancel jobs

    const res = await DELETE({} as NextRequest, mockParams('123'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe('Campaign archived successfully');
    expect(logEvent).toHaveBeenCalledWith(
      'campaign_deleted',
      'campaign',
      '123',
      expect.objectContaining({ previousStatus: 'draft' }),
      'user-1'
    );
  });

  it('soft deletes paused campaign', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 123, status: 'paused', name: 'Paused Campaign' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await DELETE({} as NextRequest, mockParams('123'));
    expect(res.status).toBe(200);
  });

  it('soft deletes completed campaign', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 123, status: 'completed', name: 'Done Campaign' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await DELETE({} as NextRequest, mockParams('123'));
    expect(res.status).toBe(200);
  });

  it('cancels pending jobs when archiving', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 123, status: 'draft', name: 'Campaign' }])
      .mockResolvedValueOnce([]) // archive
      .mockResolvedValueOnce([]); // cancel jobs

    await DELETE({} as NextRequest, mockParams('123'));

    // Verify jobs cancellation query was called
    expect(mockSql).toHaveBeenCalledTimes(3);
    const jobsCall = mockSql.mock.calls[2];
    const query = jobsCall[0].join('?');
    expect(query).toContain('jobs');
    expect(query).toContain('cancelled');
  });

  it('scopes delete to organization (IDOR prevention)', async () => {
    mockSql.mockResolvedValueOnce([]); // org filter excludes foreign campaign
    const res = await DELETE({} as NextRequest, mockParams('456'));
    expect(res.status).toBe(404);

    // Verify org was in query
    const call = mockSql.mock.calls[0];
    expect(call).toContain('org-A');
  });
});
