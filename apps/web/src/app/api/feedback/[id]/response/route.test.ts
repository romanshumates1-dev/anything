/**
 * Tests for /api/feedback/[id]/response
 * Covers: POST add admin response, GET responses, visibility rules
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
vi.mock('../../../utils/authz', () => ({ requireAdmin }));

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('../../../utils/logger', () => ({ logEvent: (...a: any[]) => logEvent(...a) }));

import { GET, POST } from './route';

function mockParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function mockRequest(body?: object) {
  return {
    json: async () => body || {},
  } as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1' });
});

describe('POST /api/feedback/[id]/response', () => {
  it('401/403 without admin auth', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    const res = await POST(mockRequest({ response: 'Admin response' }), mockParams('fb-1'));
    expect(res.status).toBe(401);
  });

  it('404 when feedback not found', async () => {
    mockSql.mockResolvedValueOnce([]); // feedback not found
    const res = await POST(mockRequest({ response: 'Admin response' }), mockParams('nonexistent'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Feedback not found' });
  });

  it('400 when response is missing', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'fb-1' }]); // feedback exists
    const res = await POST(mockRequest({}), mockParams('fb-1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Response is required (min 5 characters)' });
  });

  it('400 when response is too short', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'fb-1' }]);
    const res = await POST(mockRequest({ response: 'Hi' }), mockParams('fb-1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Response is required (min 5 characters)' });
  });

  it('400 when response is not a string', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'fb-1' }]);
    const res = await POST(mockRequest({ response: 12345 }), mockParams('fb-1'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Response is required (min 5 characters)' });
  });

  it('creates public response successfully', async () => {
    const createdResponse = {
      id: 'resp-1',
      feedback_id: 'fb-1',
      admin_id: 'admin-1',
      response: 'Thank you for your feedback',
      is_public: true,
      created_at: new Date().toISOString(),
    };

    mockSql
      .mockResolvedValueOnce([{ id: 'fb-1' }]) // feedback exists
      .mockResolvedValueOnce([createdResponse]) // insert response
      .mockResolvedValueOnce([]); // update feedback status

    const res = await POST(mockRequest({
      response: 'Thank you for your feedback',
      is_public: true,
    }), mockParams('fb-1'));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.response).toBe('Thank you for your feedback');
    expect(body.is_public).toBe(true);

    expect(logEvent).toHaveBeenCalledWith(
      'feedback_response_added',
      'feedback',
      'fb-1',
      { response_id: 'resp-1', is_public: true },
      'admin-1'
    );
  });

  it('creates private response (admin-only visibility)', async () => {
    const createdResponse = {
      id: 'resp-1',
      feedback_id: 'fb-1',
      admin_id: 'admin-1',
      response: 'Internal notes here',
      is_public: false,
      created_at: new Date().toISOString(),
    };

    mockSql
      .mockResolvedValueOnce([{ id: 'fb-1' }])
      .mockResolvedValueOnce([createdResponse])
      .mockResolvedValueOnce([]);

    const res = await POST(mockRequest({
      response: 'Internal notes here',
      is_public: false,
    }), mockParams('fb-1'));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.is_public).toBe(false);
  });

  it('defaults to public response when is_public not specified', async () => {
    const createdResponse = {
      id: 'resp-1',
      response: 'Public by default',
      is_public: true,
    };

    mockSql
      .mockResolvedValueOnce([{ id: 'fb-1' }])
      .mockResolvedValueOnce([createdResponse])
      .mockResolvedValueOnce([]);

    const res = await POST(mockRequest({
      response: 'Public by default',
    }), mockParams('fb-1'));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.is_public).toBe(true);
  });

  it('trims whitespace from response', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'fb-1' }])
      .mockResolvedValueOnce([{ response: 'Trimmed response' }])
      .mockResolvedValueOnce([]);

    const res = await POST(mockRequest({
      response: '   Trimmed response   ',
    }), mockParams('fb-1'));

    expect(res.status).toBe(201);
  });

  it('updates feedback status to UNDER_REVIEW if SUBMITTED', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'fb-1' }])
      .mockResolvedValueOnce([{ id: 'resp-1', response: 'Response' }])
      .mockResolvedValueOnce([]);

    await POST(mockRequest({ response: 'We are looking into this' }), mockParams('fb-1'));

    // Verify the update call was made
    expect(mockSql).toHaveBeenCalledTimes(3);
  });
});

describe('GET /api/feedback/[id]/response', () => {
  it('returns public responses for non-admin users', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });

    const mockResponses = [
      {
        id: 'resp-1',
        response: 'Public response',
        is_public: true,
        created_at: new Date().toISOString(),
        admin_name: 'Admin User',
      },
    ];
    mockSql.mockResolvedValueOnce(mockResponses);

    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].response).toBe('Public response');
  });

  it('returns all responses (including private) for admins', async () => {
    const mockResponses = [
      { id: 'resp-1', response: 'Public response', is_public: true },
      { id: 'resp-2', response: 'Private notes', is_public: false },
    ];
    mockSql.mockResolvedValueOnce(mockResponses);

    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
  });

  it('returns empty array when no responses exist', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns responses in chronological order', async () => {
    const mockResponses = [
      { id: 'resp-1', response: 'First', created_at: '2026-01-01' },
      { id: 'resp-2', response: 'Second', created_at: '2026-01-02' },
    ];
    mockSql.mockResolvedValueOnce(mockResponses);

    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].response).toBe('First');
    expect(body[1].response).toBe('Second');
  });

  it('returns 500 on database error', async () => {
    mockSql.mockRejectedValueOnce(new Error('DB error'));
    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });

  it('includes admin name in response', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'resp-1',
      response: 'Response text',
      is_public: true,
      admin_name: 'John Admin',
    }]);

    const res = await GET({} as Request, mockParams('fb-1'));
    const body = await res.json();
    expect(body[0].admin_name).toBe('John Admin');
  });
});
