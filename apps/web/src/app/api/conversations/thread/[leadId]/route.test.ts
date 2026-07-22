/**
 * IDOR fix (bug #35, "conversations routes (no org filter)"): the lead
 * lookup here had no organization check — any authenticated user from ANY
 * org could read another org's lead thread by guessing a sequential id.
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
  return new Request('http://t/api/conversations/thread/42') as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-A' });
});

describe('GET /api/conversations/thread/[leadId]', () => {
  it('binds the lead lookup to the caller\'s own org', async () => {
    mockSql
      .mockResolvedValueOnce([{ phone: '+15551234567' }]) // lead lookup
      .mockResolvedValueOnce([{ id: 1, lead_id: 42, history: [], status: 'active' }]); // conversation

    const res = await GET(req(), { params: Promise.resolve({ leadId: '42' }) } as any);
    expect(res.status).toBe(200);

    const leadCall = mockSql.mock.calls[0];
    const query = leadCall[0].join('?');
    expect(query).toMatch(/organization_id/);
    expect(leadCall).toContain('org-A');
    expect(leadCall).toContain(42);
  });

  it('returns an empty thread (never another org\'s messages) when the lead belongs to a different org', async () => {
    mockSql.mockResolvedValueOnce([]); // lead lookup excludes org B's lead
    const res = await GET(req(), { params: Promise.resolve({ leadId: '99' }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
    // Must short-circuit before ever querying ai_conversations for that lead.
    expect(mockSql).toHaveBeenCalledTimes(1);
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
