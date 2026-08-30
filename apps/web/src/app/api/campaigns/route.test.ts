/**
 * GET/POST /api/campaigns — legacy campaign list/create (behavioral).
 *
 * Tenant-isolation gap: these tables (public.campaigns / campaign_leads,
 * db/schema.sql:48-70) have never had an organization_id column and this
 * route did zero organization filtering — any authenticated user, in any
 * org, could list every org's campaigns and create rows with no owner at
 * all. Fixed by migration 042 (adds organization_id to both tables) +
 * getOrganization() scoping here, matching the established pattern in
 * apps/web/src/app/api/outreach/campaigns/route.ts.
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
vi.mock('../utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

import { GET, POST } from './route';

const jsonReq = (body: unknown) =>
  new Request('http://t/api/campaigns', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'u1' } });
  getOrganization.mockResolvedValue({ id: 'org-A', name: 'Org A', slug: 'org-a' });
});

describe('POST /api/campaigns', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(jsonReq({ name: 'Q1', message_template: 'hi' }));
    expect(res.status).toBe(401);
  });

  it('403 when the caller has no resolvable organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(jsonReq({ name: 'Q1', message_template: 'hi' }));
    expect(res.status).toBe(403);
  });

  it('IDOR: the INSERT stamps the campaign with the caller\'s organization_id', async () => {
    mockSql.mockResolvedValueOnce([{ id: 1, name: 'Q1', organization_id: 'org-A' }]);
    const res = await POST(jsonReq({ name: 'Q1', message_template: 'hi' }));
    expect(res.status).toBe(200);
    // The org-scoping fix must pass organizationId into the INSERT so every
    // legacy campaign has a real owner from creation onward.
    expect(mockSql.mock.calls[0]).toContain('org-A');
  });
});

describe('GET /api/campaigns', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('403 when the caller has no resolvable organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('IDOR: scopes the list query to the caller\'s own organization', async () => {
    mockSql.mockResolvedValueOnce([{ id: 1, name: 'Q1' }]);
    await GET();
    // Pre-fix, this route had no organization filter at all, so 'org-A'
    // never appears among the bound query parameters.
    expect(mockSql.mock.calls[0]).toContain('org-A');
  });
});
