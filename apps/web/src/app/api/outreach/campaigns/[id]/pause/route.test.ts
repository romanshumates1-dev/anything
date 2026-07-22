/**
 * Bug #36 — this route read `params.id` synchronously against a Next 16
 * Promise-shaped `params`, so `campaignId` was always `undefined` and the
 * campaign lookup always came back empty -> always 404, regardless of the
 * real campaign id in the URL.
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
  return new Request('http://t/api/outreach/campaigns/camp-1/pause', { method: 'POST' }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('POST /api/outreach/campaigns/[id]/pause', () => {
  it('resolves campaignId from the awaited (Promise) params and pauses an ACTIVE campaign', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'camp-1', organization_id: 'org-1', status: 'ACTIVE' }]) // lookup
      .mockResolvedValueOnce([]); // UPDATE

    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'camp-1', status: 'PAUSED' });

    // The lookup query must actually be bound with the real campaign id, not
    // `undefined` (which is what the pre-fix sync `params.id` produced).
    const lookupCall = mockSql.mock.calls[0];
    expect(lookupCall).toContain('camp-1');
    expect(lookupCall).not.toContain(undefined);
  });

  it('404s when the campaign genuinely does not exist (not because id was undefined)', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(req(), { params: Promise.resolve({ id: 'missing' }) } as any);
    expect(res.status).toBe(404);
  });

  it('400s when trying to pause a non-ACTIVE campaign', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'camp-1', organization_id: 'org-1', status: 'DRAFT' }]);
    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(400);
  });

  it('401s anonymous callers', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(401);
  });
});
