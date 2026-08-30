/**
 * IDOR fix (bug #35, "conversations routes (no org filter)"): this route
 * joined ai_conversations to leads but never checked the lead's
 * organization_id — any authenticated user from ANY org could read another
 * org's lead conversation (name, phone, full message history) just by
 * guessing a sequential lead id.
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

import { GET } from './route';

function req() {
  return new Request('http://t/api/conversations/42') as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-A' });
});

describe('GET /api/conversations/[leadId]', () => {
  it('binds the query to the caller\'s own org, not just the lead id', async () => {
    mockSql.mockResolvedValueOnce([{ id: 1, lead_id: 42, lead_name: 'Alice' }]);
    const res = await GET(req(), { params: Promise.resolve({ leadId: '42' }) } as any);
    expect(res.status).toBe(200);

    const call = mockSql.mock.calls[0];
    const query = call[0].join('?');
    expect(query).toMatch(/l\.organization_id/);
    expect(call).toContain('org-A');
    expect(call).toContain(42);
  });

  it('404s when the lead belongs to a different org (the join+filter excludes it)', async () => {
    // Real Postgres behavior once the org filter is present: a lead owned by
    // org B never matches `l.organization_id = 'org-A'`, so the row is
    // excluded from the join regardless of how ai_conversations is populated.
    mockSql.mockResolvedValueOnce([]);
    const res = await GET(req(), { params: Promise.resolve({ leadId: '99' }) } as any);
    expect(res.status).toBe(404);
  });

  it('401s anonymous callers', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ leadId: '42' }) } as any);
    expect(res.status).toBe(401);
  });

  it('403s when the caller has no resolvable organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ leadId: '42' }) } as any);
    expect(res.status).toBe(403);
  });
});
