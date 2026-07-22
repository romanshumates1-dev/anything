/**
 * POST /api/campaigns/[id]/launch — legacy campaign launch (behavioral).
 *
 * IDOR fix: this route did `SELECT * FROM campaigns WHERE id = ${campaignId}`
 * with NO organization filter — any authenticated user in ANY org could
 * launch (i.e. trigger real SMS sends through the job queue) another org's
 * campaign just by guessing its small sequential integer id. Fixed by
 * migration 042 (organization_id on campaigns/campaign_leads) +
 * getOrganization() scoping the campaign lookup here.
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
vi.mock('../../../utils/execution-ledger', () => ({ recordRun: vi.fn(async () => {}) }));
vi.mock('../../../utils/jobs', () => ({ enqueueJob: vi.fn(async () => 1) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

const { hasAcceptedMessagingAgreement } = vi.hoisted(() => ({ hasAcceptedMessagingAgreement: vi.fn() }));
vi.mock('@/lib/legal-acceptance', () => ({
  hasAcceptedMessagingAgreement: (...a: any[]) => hasAcceptedMessagingAgreement(...a),
}));

import { POST } from './route';

const req = () => new Request('http://t/api/campaigns/1/launch', { method: 'POST' });

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'u1' } });
  getOrganization.mockResolvedValue({ id: 'org-A', name: 'Org A', slug: 'org-a' });
  hasAcceptedMessagingAgreement.mockResolvedValue(true);
});

describe('POST /api/campaigns/[id]/launch', () => {
  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(req(), { params: Promise.resolve({ id: '1' }) } as any);
    expect(res.status).toBe(401);
  });

  it('403 when the caller has no resolvable organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(req(), { params: Promise.resolve({ id: '1' }) } as any);
    expect(res.status).toBe(403);
  });

  it('IDOR: scopes the campaign lookup to the caller\'s own organization', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 1, message_template: 'hi', daily_cap: 100, throttle_per_minute: 10 }])
      .mockResolvedValueOnce([]);
    await POST(req(), { params: Promise.resolve({ id: '1' }) } as any);
    // Pre-fix, the SELECT only ever bound campaignId — 'org-A' never
    // appeared among its parameters, so any org's campaign matched.
    const lookupCall = mockSql.mock.calls[0];
    expect(lookupCall).toContain('org-A');
  });

  it('IDOR: 404s (never launches) when the campaign belongs to a different org', async () => {
    // Once org-scoped, a campaign owned by org B never matches
    // `organization_id = 'org-A'` — the SELECT returns empty exactly as if
    // the campaign did not exist, and no members/jobs query ever runs.
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(req(), { params: Promise.resolve({ id: '77' }) } as any);
    expect(res.status).toBe(404);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});
