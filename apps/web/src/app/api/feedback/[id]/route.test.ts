/**
 * Tests for /api/feedback/[id]
 * Covers: GET single feedback, PATCH update, DELETE
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

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('../../utils/logger', () => ({ logEvent: (...a: any[]) => logEvent(...a) }));

import { GET, PATCH, DELETE } from './route';

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
  getSession.mockResolvedValue({ user: { id: 'user-1', role: 'MEMBER' } });
});

describe('GET /api/feedback/[id]', () => {
  it('404 when feedback not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await GET({} as Request, mockParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('returns public feedback to anonymous users', async () => {
    getSession.mockResolvedValue(null);
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        title: 'Public Feedback',
        is_public: true,
        user_id: 'other-user',
      }])
      .mockResolvedValueOnce([]); // responses

    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe('Public Feedback');
  });

  it('hides private feedback from non-owners', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-2', role: 'MEMBER' } });
    mockSql.mockResolvedValueOnce([{
      id: 'fb-1',
      title: 'Private Feedback',
      is_public: false,
      user_id: 'user-1', // different user
    }]);

    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(404);
  });

  it('owner can view their private feedback', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        title: 'My Private Feedback',
        is_public: false,
        user_id: 'user-1',
      }])
      .mockResolvedValueOnce([]) // responses
      .mockResolvedValueOnce([]); // vote check

    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
  });

  it('admin can view all feedback', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        is_public: false,
        user_id: 'other-user',
      }])
      .mockResolvedValueOnce([]) // responses (all for admin)
      .mockResolvedValueOnce([]); // vote check

    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/feedback/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await PATCH(mockRequest({ title: 'Updated' }), mockParams('fb-1'));
    expect(res.status).toBe(401);
  });

  it('404 when feedback not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await PATCH(mockRequest({ title: 'Updated' }), mockParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('403 when non-admin non-owner tries to update', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-2', role: 'MEMBER' } });
    mockSql.mockResolvedValueOnce([{
      id: 'fb-1',
      user_id: 'user-1', // different user
      status: 'SUBMITTED',
    }]);

    const res = await PATCH(mockRequest({ title: 'Hacked' }), mockParams('fb-1'));
    expect(res.status).toBe(403);
  });

  it('owner can update content when status is SUBMITTED', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        user_id: 'user-1',
        status: 'SUBMITTED',
      }])
      .mockResolvedValueOnce([]) // update title
      .mockResolvedValueOnce([{ id: 'fb-1', title: 'Updated Title' }]) // return updated
      ;

    const res = await PATCH(mockRequest({ title: 'Updated Title' }), mockParams('fb-1'));
    expect(res.status).toBe(200);
    expect(logEvent).toHaveBeenCalled();
  });

  it('owner cannot update content when status is not SUBMITTED', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        user_id: 'user-1',
        status: 'UNDER_REVIEW', // not SUBMITTED
      }])
      .mockResolvedValueOnce([{ id: 'fb-1' }]); // return unchanged

    const res = await PATCH(mockRequest({ title: 'Updated Title' }), mockParams('fb-1'));
    expect(res.status).toBe(200);
    // Title update should not have been called (only 2 sql calls total)
    expect(mockSql).toHaveBeenCalledTimes(2);
  });

  it('admin can update status', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        user_id: 'other-user',
        status: 'SUBMITTED',
      }])
      .mockResolvedValueOnce([]) // update status
      .mockResolvedValueOnce([{ id: 'fb-1', status: 'PLANNED' }]);

    const res = await PATCH(mockRequest({ status: 'PLANNED' }), mockParams('fb-1'));
    expect(res.status).toBe(200);
    expect(logEvent).toHaveBeenCalledWith(
      'feedback_status_changed',
      'feedback',
      'fb-1',
      expect.objectContaining({ from: 'SUBMITTED', to: 'PLANNED' }),
      'admin-1'
    );
  });

  it('admin can add admin_notes', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockSql
      .mockResolvedValueOnce([{ id: 'fb-1', status: 'SUBMITTED', user_id: 'u1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'fb-1' }]);

    const res = await PATCH(mockRequest({ admin_notes: 'Internal note' }), mockParams('fb-1'));
    expect(res.status).toBe(200);
  });

  it('admin can mark as duplicate', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockSql
      .mockResolvedValueOnce([{ id: 'fb-1', status: 'SUBMITTED', user_id: 'u1' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'fb-1', duplicate_of_id: 'fb-original' }]);

    const res = await PATCH(mockRequest({ duplicate_of_id: 'fb-original' }), mockParams('fb-1'));
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/feedback/[id]', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await DELETE({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(401);
  });

  it('404 when feedback not found', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await DELETE({} as Request, mockParams('nonexistent'));
    expect(res.status).toBe(404);
  });

  it('403 when non-admin non-owner tries to delete', async () => {
    getSession.mockResolvedValue({ user: { id: 'user-2', role: 'MEMBER' } });
    mockSql.mockResolvedValueOnce([{
      id: 'fb-1',
      user_id: 'user-1',
      status: 'SUBMITTED',
    }]);

    const res = await DELETE({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(403);
  });

  it('403 when owner tries to delete non-SUBMITTED feedback', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'fb-1',
      user_id: 'user-1',
      status: 'PLANNED', // not SUBMITTED
    }]);

    const res = await DELETE({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(403);
  });

  it('owner can delete their SUBMITTED feedback', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        user_id: 'user-1',
        status: 'SUBMITTED',
      }])
      .mockResolvedValueOnce([]); // DELETE

    const res = await DELETE({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(logEvent).toHaveBeenCalledWith(
      'feedback_deleted',
      'feedback',
      'fb-1',
      { by_admin: false },
      'user-1'
    );
  });

  it('admin can delete any feedback', async () => {
    getSession.mockResolvedValue({ user: { id: 'admin-1', role: 'ADMIN' } });
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        user_id: 'other-user',
        status: 'PLANNED', // non-SUBMITTED
      }])
      .mockResolvedValueOnce([]);

    const res = await DELETE({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    expect(logEvent).toHaveBeenCalledWith(
      'feedback_deleted',
      'feedback',
      'fb-1',
      { by_admin: true },
      'admin-1'
    );
  });
});
