/**
 * Bug #36 — same class of defect: synchronous `params.id` against a
 * Promise-shaped params object always resolved to `undefined`, so every
 * stats request 404'd regardless of the real campaign.
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
  return new Request('http://t/api/outreach/campaigns/camp-1/stats') as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('GET /api/outreach/campaigns/[id]/stats', () => {
  it('resolves campaignId from the awaited params and returns stats for a real campaign', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'camp-1', organization_id: 'org-1', daily_volume_max: 100, end_date: new Date(Date.now() + 86400_000) }]) // campaign lookup
      .mockResolvedValueOnce([{ status: 'SENT', cnt: 10 }, { status: 'ENGAGED', cnt: 3 }]) // byStatus
      .mockResolvedValueOnce([{ sent_count: 5 }]) // sentToday
      .mockResolvedValueOnce([]); // history

    const res = await GET(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalContacts).toBe(13);
    expect(body.byStatus.SENT).toBe(10);

    const lookupCall = mockSql.mock.calls[0];
    expect(lookupCall).toContain('camp-1');
  });

  it('404s when the campaign does not exist', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await GET(req(), { params: Promise.resolve({ id: 'missing' }) } as any);
    expect(res.status).toBe(404);
  });

  it('401s anonymous callers', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(401);
  });
});
