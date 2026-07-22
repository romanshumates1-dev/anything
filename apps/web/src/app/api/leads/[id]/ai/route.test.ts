/**
 * POST /api/leads/[id]/ai — pause-AI toggle route (behavioral).
 * The inbox UI called this route; it was a 404 ghost. Verifies it toggles /
 * sets leads.ai_paused and is org/session guarded.
 *
 * IDOR fix (bug #35, explicitly named "/api/leads/[id]/ai"): this route
 * previously had NO organization filter at all — any authenticated user from
 * ANY org could pause/unpause AI on another org's lead by guessing its
 * sequential id. Both the SELECT and the UPDATE are now org-scoped.
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
vi.mock('../../../utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

import { POST } from './route';

const bodyReq = (body?: unknown) =>
  new Request('http://t/api/leads/5/ai', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }) as any;

const setText = () =>
  mockSql.mock.calls.find((c: any) => Array.isArray(c[0]) && c[0].join('?').includes('SET ai_paused'));

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'u1' } });
  getOrganization.mockResolvedValue({ id: 'org-A' });
});

describe('POST /api/leads/[id]/ai', () => {
  it('toggles ai_paused from false -> true when no body is sent', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 5, ai_paused: false }]) // SELECT lead
      .mockResolvedValueOnce([]); // UPDATE
    const res = await POST(bodyReq(), { params: Promise.resolve({ id: '5' }) } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ leadId: '5', aiPaused: true });
    const upd = setText();
    expect(upd).toBeTruthy();
    expect(upd![1]).toBe(true); // interpolated next value (first placeholder)
  });

  it('sets an explicit paused value from the body', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 5, ai_paused: true }])
      .mockResolvedValueOnce([]);
    const res = await POST(bodyReq({ paused: false }), { params: Promise.resolve({ id: '5' }) } as any);
    expect(await res.json()).toMatchObject({ aiPaused: false });
    expect(setText()![1]).toBe(false);
  });

  it('404 when the lead does not exist', async () => {
    mockSql.mockResolvedValueOnce([]); // SELECT lead -> none
    const res = await POST(bodyReq({ paused: true }), { params: Promise.resolve({ id: '999' }) } as any);
    expect(res.status).toBe(404);
  });

  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(bodyReq(), { params: Promise.resolve({ id: '5' }) } as any);
    expect(res.status).toBe(401);
  });

  it('403 when the caller has no resolvable organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(bodyReq(), { params: Promise.resolve({ id: '5' }) } as any);
    expect(res.status).toBe(403);
  });

  it('IDOR: scopes both the lookup and the UPDATE to the caller\'s own org', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 5, ai_paused: false }])
      .mockResolvedValueOnce([]);
    await POST(bodyReq({ paused: true }), { params: Promise.resolve({ id: '5' }) } as any);

    const lookupCall = mockSql.mock.calls[0];
    expect(lookupCall).toContain('org-A');
    const updateCall = mockSql.mock.calls[1];
    expect(updateCall).toContain('org-A');
  });

  it('IDOR: 404s (never toggles) when the lead belongs to a different org', async () => {
    // Once org-scoped, a lead owned by org B never matches
    // `organization_id = 'org-A'` — the SELECT returns empty exactly as if
    // the lead did not exist, and no UPDATE is ever issued.
    mockSql.mockResolvedValueOnce([]);
    const res = await POST(bodyReq({ paused: true }), { params: Promise.resolve({ id: '77' }) } as any);
    expect(res.status).toBe(404);
    expect(mockSql).toHaveBeenCalledTimes(1);
  });
});
