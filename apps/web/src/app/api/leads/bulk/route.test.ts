/**
 * Wiring recordStageTransitionsBulk into CSV import (BREAKAGE_TABLE.md
 * session (s): funnel analytics was permanently empty — nothing ever wrote to
 * stage_transitions). Every imported lead enters the funnel at NEW, recorded
 * with ONE bulk INSERT per chunk (not one recordStageTransition() call per
 * row — up to MAX_IMPORT_ROWS/INSERT_CHUNK_SIZE rows per import).
 *
 * Mutation-proven RED: with the recordStageTransitionsBulk call removed from
 * the route (the original, unfixed code), this test fails because the mock
 * is never invoked. Restoring the call makes it pass.
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

vi.mock('../../utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../../utils/execution-ledger', () => ({ recordRun: vi.fn(async () => {}) }));

const { recordStageTransitionsBulk } = vi.hoisted(() => ({ recordStageTransitionsBulk: vi.fn(async () => {}) }));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({ recordStageTransitionsBulk }));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/leads/bulk', { method: 'POST', body: JSON.stringify(body) }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('POST /api/leads/bulk', () => {
  it('records a bulk NEW transition for every inserted chunk of leads (one call, not one per row)', async () => {
    mockSql
      .mockResolvedValueOnce([]) // dedupe-hash SELECT against existing leads
      .mockResolvedValueOnce([{ id: 5 }]) // INSERT imports RETURNING id
      .mockResolvedValueOnce([{ id: 101 }, { id: 102 }]) // INSERT leads RETURNING id (single chunk)
      .mockResolvedValueOnce([]); // UPDATE imports (finalize)

    const csv = 'name,phone\nJane Seller,+15025551111\nJohn Buyer,+15025552222';
    const res = await POST(req({ text: csv }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(2);

    expect(recordStageTransitionsBulk).toHaveBeenCalledTimes(1);
    expect(recordStageTransitionsBulk).toHaveBeenCalledWith(
      [101, 102],
      'NEW',
      expect.objectContaining({ channel: 'system' })
    );
  });

  it('does not call recordStageTransitionsBulk when every row fails validation (nothing inserted)', async () => {
    // Every row missing both phone and email -> zero valid rows -> zero chunks.
    mockSql
      .mockResolvedValueOnce([{ id: 6 }]); // INSERT imports RETURNING id
    const csv = 'name\nJane Seller\nJohn Buyer';
    const res = await POST(req({ text: csv }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(0);
    expect(recordStageTransitionsBulk).not.toHaveBeenCalled();
  });
});
