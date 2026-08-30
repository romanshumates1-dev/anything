/**
 * Bug #36 — same class of defect: synchronous `params.id` against a
 * Promise-shaped params object always resolved to `undefined`.
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
  return new Request('http://t/api/outreach/campaigns/camp-1/cancel', { method: 'POST' }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('POST /api/outreach/campaigns/[id]/cancel', () => {
  it('resolves campaignId from the awaited params and cancels an ACTIVE campaign', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'camp-1', organization_id: 'org-1', status: 'ACTIVE' }])
      .mockResolvedValueOnce([]);

    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ id: 'camp-1', status: 'CANCELLED' });

    const lookupCall = mockSql.mock.calls[0];
    expect(lookupCall).toContain('camp-1');
  });

  it('404s when the campaign does not exist', async () => {
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(req(), { params: Promise.resolve({ id: 'missing' }) } as any);
    expect(res.status).toBe(404);
  });

  it('400s on a terminal-state campaign (already COMPLETED/CANCELLED)', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'camp-1', organization_id: 'org-1', status: 'COMPLETED' }]);
    const res = await POST(req(), { params: Promise.resolve({ id: 'camp-1' }) } as any);
    expect(res.status).toBe(400);
  });
});
