/**
 * POST /api/leads/[id]/ai — pause-AI toggle route (behavioral).
 * The inbox UI called this route; it was a 404 ghost. Verifies it toggles /
 * sets leads.ai_paused and is org/session guarded.
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

import { POST } from './route';

const bodyReq = (body?: unknown) =>
  new Request('http://t/api/leads/5/ai', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }) as any;

const setText = () =>
  mockSql.mock.calls.find((c: any) => Array.isArray(c[0]) && c[0].join('?').includes('SET ai_paused'));

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'u1' } });
});

describe('POST /api/leads/[id]/ai', () => {
  it('toggles ai_paused from false -> true when no body is sent', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 5, ai_paused: false }]) // SELECT lead
      .mockResolvedValueOnce([]); // UPDATE
    const res = await POST(bodyReq(), { params: { id: '5' } } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ leadId: '5', aiPaused: true });
    const upd = setText();
    expect(upd).toBeTruthy();
    expect(upd![1]).toBe(true); // interpolated next value
  });

  it('sets an explicit paused value from the body', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 5, ai_paused: true }])
      .mockResolvedValueOnce([]);
    const res = await POST(bodyReq({ paused: false }), { params: { id: '5' } } as any);
    expect(await res.json()).toMatchObject({ aiPaused: false });
    expect(setText()![1]).toBe(false);
  });

  it('404 when the lead does not exist', async () => {
    mockSql.mockResolvedValueOnce([]); // SELECT lead -> none
    const res = await POST(bodyReq({ paused: true }), { params: { id: '999' } } as any);
    expect(res.status).toBe(404);
  });

  it('401 without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(bodyReq(), { params: { id: '5' } } as any);
    expect(res.status).toBe(401);
  });
});
