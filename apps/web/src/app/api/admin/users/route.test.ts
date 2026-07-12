/**
 * /api/admin/users — admin-only user listing (behavioral).
 * requireAdmin re-reads the role from the DB (cookie-cached sessions must not
 * outlive a demotion), so the sql mock feeds both the guard and the listing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'u-admin' } });
});

describe('GET /api/admin/users', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('403 for a MEMBER (server-enforced, not UI-hidden)', async () => {
    mockSql.mockResolvedValueOnce([{ email: 'member@dealswiftautomation.com', role: 'MEMBER' }]);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('403 for an admin on a non-allowed domain (domain outranks role)', async () => {
    mockSql.mockResolvedValueOnce([{ email: 'admin@gmail.com', role: 'ADMIN' }]);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('200 with the user list for an allowed-domain ADMIN', async () => {
    mockSql
      .mockResolvedValueOnce([{ email: 'roman.shumate@dealswiftautomation.com', role: 'ADMIN' }])
      .mockResolvedValueOnce([
        {
          id: 'u1',
          name: 'Roman',
          email: 'roman.shumate@dealswiftautomation.com',
          role: 'ADMIN',
          created_at: '2026-07-01',
          last_login_at: null,
          active_sessions: 1,
        },
      ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].role).toBe('ADMIN');
  });
});
