/**
 * /api/admin/users/[id] PATCH — role assignment + access revocation.
 * Covers: member 403, promote, demote-with-session-revoke, the ≥1-admin
 * lockout guard (incl. self-demotion), and input validation.
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
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

import { PATCH } from './route';

function patchReq(body: unknown) {
  return new Request('http://localhost/api/admin/users/u-target', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
const params = { params: Promise.resolve({ id: 'u-target' }) };
const ADMIN_GUARD_ROW = [{ email: 'roman.shumate@dealswiftautomation.com', role: 'ADMIN' }];

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'u-admin' } });
});

describe('PATCH /api/admin/users/[id]', () => {
  it('403 for a MEMBER caller', async () => {
    mockSql.mockResolvedValueOnce([{ email: 'member@dealswiftautomation.com', role: 'MEMBER' }]);
    const res = await PATCH(patchReq({ role: 'ADMIN' }), params);
    expect(res.status).toBe(403);
  });

  it('400 on an unknown role value', async () => {
    mockSql.mockResolvedValueOnce(ADMIN_GUARD_ROW);
    const res = await PATCH(patchReq({ role: 'SUPERUSER' }), params);
    expect(res.status).toBe(400);
  });

  it('404 when the target user does not exist', async () => {
    mockSql
      .mockResolvedValueOnce(ADMIN_GUARD_ROW) // requireAdmin
      .mockResolvedValueOnce([]); // target lookup
    const res = await PATCH(patchReq({ role: 'ADMIN' }), params);
    expect(res.status).toBe(404);
  });

  it('promotes MEMBER → ADMIN', async () => {
    mockSql
      .mockResolvedValueOnce(ADMIN_GUARD_ROW)
      .mockResolvedValueOnce([{ id: 'u-target', email: 't@dealswiftautomation.com', role: 'MEMBER' }])
      .mockResolvedValueOnce([{ id: 'u-target', email: 't@dealswiftautomation.com', role: 'ADMIN' }]); // UPDATE
    const res = await PATCH(patchReq({ role: 'ADMIN' }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('ADMIN');
    expect(body.sessionsRevoked).toBe(false);
  });

  it('refuses to demote the LAST admin (no self-lockout; ≥1 admin invariant)', async () => {
    mockSql
      .mockResolvedValueOnce(ADMIN_GUARD_ROW)
      .mockResolvedValueOnce([
        { id: 'u-target', email: 'roman.shumate@dealswiftautomation.com', role: 'ADMIN' },
      ])
      .mockResolvedValueOnce([{ admins: 1 }]); // admin count
    const res = await PATCH(patchReq({ role: 'MEMBER' }), params);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/last admin/i);
    // and the UPDATE was never issued
    const updates = mockSql.mock.calls.filter((c: any) => c[0].join('?').includes('UPDATE'));
    expect(updates).toHaveLength(0);
  });

  it('demotes an ADMIN when another admin remains, revoking their sessions', async () => {
    mockSql
      .mockResolvedValueOnce(ADMIN_GUARD_ROW)
      .mockResolvedValueOnce([{ id: 'u-target', email: 'x@dealswiftautomation.com', role: 'ADMIN' }])
      .mockResolvedValueOnce([{ admins: 2 }])
      .mockResolvedValueOnce([{ id: 'u-target', email: 'x@dealswiftautomation.com', role: 'MEMBER' }]) // UPDATE
      .mockResolvedValueOnce([]); // DELETE sessions
    const res = await PATCH(patchReq({ role: 'MEMBER' }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('MEMBER');
    expect(body.sessionsRevoked).toBe(true);
    const deletes = mockSql.mock.calls.filter((c: any) => c[0].join('?').includes('DELETE FROM session'));
    expect(deletes).toHaveLength(1);
  });

  it('revokeSessions alone deletes sessions without touching the role', async () => {
    mockSql
      .mockResolvedValueOnce(ADMIN_GUARD_ROW)
      .mockResolvedValueOnce([{ id: 'u-target', email: 't@dealswiftautomation.com', role: 'MEMBER' }])
      .mockResolvedValueOnce([]); // DELETE sessions
    const res = await PATCH(patchReq({ revokeSessions: true }), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('MEMBER');
    expect(body.sessionsRevoked).toBe(true);
    const updates = mockSql.mock.calls.filter((c: any) => c[0].join('?').includes('UPDATE'));
    expect(updates).toHaveLength(0);
  });

  it('400 when the body asks for nothing', async () => {
    mockSql.mockResolvedValueOnce(ADMIN_GUARD_ROW);
    const res = await PATCH(patchReq({}), params);
    expect(res.status).toBe(400);
  });
});
