/**
 * POST/GET /api/campaigns/[id]/leads — legacy campaign membership (behavioral).
 *
 * IDOR fix: both handlers looked up/joined on `campaign_id` with NO
 * organization filter (GET didn't even check the campaign existed at all)
 * — any authenticated user in ANY org could add leads to, or read the full
 * lead roster (name/phone/email) of, another org's campaign just by
 * guessing its small sequential integer id. Fixed by migration 042
 * (organization_id on campaigns/campaign_leads) + getOrganization()
 * scoping the campaign-ownership check in both handlers here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('../../../utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

import { GET, POST } from './route';

const postReq = (body: unknown) =>
  new Request('http://t/api/campaigns/1/leads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const getReq = () => new Request('http://t/api/campaigns/1/leads');

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'u1' } });
  getOrganization.mockResolvedValue({ id: 'org-A', name: 'Org A', slug: 'org-a' });
});

describe('POST /api/campaigns/[id]/leads', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(postReq({ leadId: 9 }), { params: Promise.resolve({ id: '1' }) } as any);
    expect(res.status).toBe(401);
  });

  it('403 when the caller has no resolvable organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(postReq({ leadId: 9 }), { params: Promise.resolve({ id: '1' }) } as any);
    expect(res.status).toBe(403);
  });

  it('IDOR: scopes the campaign-ownership check to the caller\'s own organization', async () => {
    mockSql.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([{ id: 5 }]);
    await POST(postReq({ leadId: 9 }), { params: Promise.resolve({ id: '1' }) } as any);
    const lookupCall = mockSql.mock.calls[0];
    expect(lookupCall).toContain('org-A');
  });

  it('IDOR: 404s (never inserts) when the campaign belongs to a different org', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(postReq({ leadId: 9 }), { params: Promise.resolve({ id: '77' }) } as any);
    expect(res.status).toBe(404);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/campaigns/[id]/leads', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(getReq(), { params: Promise.resolve({ id: '1' }) } as any);
    expect(res.status).toBe(401);
  });

  it('403 when the caller has no resolvable organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET(getReq(), { params: Promise.resolve({ id: '1' }) } as any);
    expect(res.status).toBe(403);
  });

  it('IDOR: 404s (never lists members) when the campaign belongs to a different org', async () => {
    // Pre-fix, GET never even checked the campaign existed — it just ran
    // the campaign_leads join for whatever id was in the URL, regardless
    // of owner. Post-fix, a foreign-org id 404s before any member query.
    mockSql.mockResolvedValueOnce([]);
    const res = await GET(getReq(), { params: Promise.resolve({ id: '77' }) } as any);
    expect(res.status).toBe(404);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });

  it('IDOR: scopes the campaign-ownership check to the caller\'s own organization', async () => {
    mockSql.mockResolvedValueOnce([{ id: 1 }]).mockResolvedValueOnce([]);
    await GET(getReq(), { params: Promise.resolve({ id: '1' }) } as any);
    const lookupCall = mockSql.mock.calls[0];
    expect(lookupCall).toContain('org-A');
  });
});
