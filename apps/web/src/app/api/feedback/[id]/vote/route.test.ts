/**
 * Tests for /api/feedback/[id]/vote
 * Covers: POST toggle vote, GET vote status, auth, privacy rules
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
vi.mock('@/app/api/utils/logger', () => ({ logEvent: (...a: any[]) => logEvent(...a) }));

import { GET, POST } from './route';

function mockParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('POST /api/feedback/[id]/vote', () => {
  it('401 without session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('404 when feedback not found', async () => {
    mockSql.mockResolvedValueOnce([]); // feedback not found
    const res = await POST({} as Request, mockParams('nonexistent'));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Feedback not found' });
  });

  it('403 when trying to vote on private feedback from another user', async () => {
    mockSql.mockResolvedValueOnce([{
      id: 'fb-1',
      is_public: false,
      user_id: 'other-user', // Different user
      vote_count: 5,
    }]);

    const res = await POST({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Cannot vote on private feedback' });
  });

  it('allows voting on own private feedback', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        is_public: false,
        user_id: 'user-1', // Same user
        vote_count: 5,
      }])
      .mockResolvedValueOnce([]) // no existing vote
      .mockResolvedValueOnce([]) // insert vote
      .mockResolvedValueOnce([]) // update count
      .mockResolvedValueOnce([{ vote_count: 6 }]); // get updated count

    const res = await POST({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voted).toBe(true);
    expect(body.vote_count).toBe(6);
  });

  it('adds vote when user has not voted', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        is_public: true,
        user_id: 'other-user',
        vote_count: 10,
      }])
      .mockResolvedValueOnce([]) // no existing vote
      .mockResolvedValueOnce([]) // insert vote
      .mockResolvedValueOnce([]) // update count
      .mockResolvedValueOnce([{ vote_count: 11 }]);

    const res = await POST({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voted).toBe(true);
    expect(body.vote_count).toBe(11);

    expect(logEvent).toHaveBeenCalledWith(
      'feedback_voted',
      'feedback',
      'fb-1',
      {},
      'user-1'
    );
  });

  it('removes vote when user has already voted (toggle)', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        is_public: true,
        user_id: 'other-user',
        vote_count: 10,
      }])
      .mockResolvedValueOnce([{ id: 'vote-1' }]) // existing vote found
      .mockResolvedValueOnce([]) // delete vote
      .mockResolvedValueOnce([]) // update count
      .mockResolvedValueOnce([{ vote_count: 9 }]);

    const res = await POST({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.voted).toBe(false);
    expect(body.vote_count).toBe(9);

    expect(logEvent).toHaveBeenCalledWith(
      'feedback_unvoted',
      'feedback',
      'fb-1',
      {},
      'user-1'
    );
  });

  it('allows voting on public feedback from any user', async () => {
    mockSql
      .mockResolvedValueOnce([{
        id: 'fb-1',
        is_public: true,
        user_id: 'other-user',
        vote_count: 5,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ vote_count: 6 }]);

    const res = await POST({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
  });

  it('returns 500 on database error', async () => {
    mockSql.mockRejectedValueOnce(new Error('DB error'));
    const res = await POST({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });
});

describe('GET /api/feedback/[id]/vote', () => {
  it('returns voted: false for unauthenticated users', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voted: false });
  });

  it('returns voted: true when user has voted', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'vote-1' }]); // vote exists
    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voted: true });
  });

  it('returns voted: false when user has not voted', async () => {
    mockSql.mockResolvedValueOnce([]); // no vote
    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voted: false });
  });

  it('returns 500 on database error', async () => {
    mockSql.mockRejectedValueOnce(new Error('DB error'));
    const res = await GET({} as Request, mockParams('fb-1'));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });
});
