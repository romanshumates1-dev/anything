/**
 * Wiring recordStageTransition into lead creation (BREAKAGE_TABLE.md session
 * (s): funnel analytics was permanently empty — nothing ever wrote to
 * stage_transitions). A newly created lead is the funnel's NEW stage.
 *
 * Mutation-proven RED: with the recordStageTransition call removed from the
 * route (the original, unfixed code), this test fails because the mock is
 * never invoked. Restoring the call makes it pass.
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

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

vi.mock('../utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const { recordStageTransition } = vi.hoisted(() => ({ recordStageTransition: vi.fn(async () => {}) }));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({ recordStageTransition }));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/leads', { method: 'POST', body: JSON.stringify(body) }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('POST /api/leads', () => {
  it('records a NEW stage transition for the newly created lead', async () => {
    mockSql.mockResolvedValueOnce([{ id: 77, name: 'Jane Seller', type: 'seller' }]);

    const res = await POST(req({ name: 'Jane Seller', type: 'seller', phone: '+15025551234' }));
    expect(res.status).toBe(200);

    expect(recordStageTransition).toHaveBeenCalledTimes(1);
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 77, fromStage: null, toStage: 'NEW' })
    );
  });

  it('does not call recordStageTransition when validation fails (no lead created)', async () => {
    const res = await POST(req({ name: '' }));
    expect(res.status).toBe(400);
    expect(recordStageTransition).not.toHaveBeenCalled();
  });
});
