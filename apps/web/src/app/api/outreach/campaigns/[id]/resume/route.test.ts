/**
 * Bug #36 — same class of defect as pause/route.ts: synchronous `params.id`
 * against a Promise-shaped params object always resolved to `undefined`.
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

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent }));

import { POST } from './route';

function req() {
  return new Request('http://t/api/outreach/campaigns/camp-1/resume', { method: 'POST' }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('POST /api/outreach/campaigns/[id]/resume', () => {
  it('resolves campaignId from the awaited params and resumes a PAUSED campaign to ACTIVE', async () => {
    const start = new Date();
    mockSql
      .mockResolvedValueOnce([
        { id: 'camp-1', organization_id: 'org-1', status: 'PAUSED', start_date: start, duration_days: 30 },
      ])
      .mockResolvedValueOnce([]);

    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('camp-1');
    expect(body.status).toBe('ACTIVE');

    const lookupCall = mockSql.mock.calls[0];
    expect(lookupCall).toContain('camp-1');
  });

  it('flips to COMPLETED when the duration window has already elapsed', async () => {
    const longAgo = new Date(Date.now() - 60 * 24 * 3600_000);
    mockSql
      .mockResolvedValueOnce([
        { id: 'camp-1', organization_id: 'org-1', status: 'PAUSED', start_date: longAgo, duration_days: 7 },
      ])
      .mockResolvedValueOnce([]);

    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    const body = await res.json();
    expect(body.status).toBe('COMPLETED');
  });

  it('404s when the campaign does not exist', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(req(), { params: Promise.resolve({ id: 'missing' }) } as any);
    expect(res.status).toBe(404);
  });

  it('400s when trying to resume a non-PAUSED campaign', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'camp-1', organization_id: 'org-1', status: 'ACTIVE' }]);
    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(400);
  });
});
