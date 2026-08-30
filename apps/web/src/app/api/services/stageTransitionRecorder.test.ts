/**
 * Unit tests for the new helpers added when wiring recordStageTransition into
 * the real lead lifecycle (funnel analytics was permanently empty — nothing
 * ever called recordStageTransition, see BREAKAGE_TABLE.md session (s)).
 *
 * recordStageTransition() and backfillStageTransitions() already existed and
 * are covered indirectly by the call-site tests. These are the two new
 * exports this fix adds:
 *   - resolveLeadIdByPhone: the only reliable lead_id lookup available at
 *     campaign_contacts transition points (seller_lead_id/buyer_lead_id are
 *     never populated by any contact-creation path in this codebase).
 *   - recordStageTransitionsBulk: one INSERT for many leads (bulk CSV import),
 *     instead of one recordStageTransition() round trip per row.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

import { resolveLeadIdByPhone, recordStageTransitionsBulk } from './stageTransitionRecorder';

const queryText = (needle: string) =>
  mockSql.mock.calls.some((c: any) => Array.isArray(c[0]) && c[0].join('?').includes(needle));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveLeadIdByPhone', () => {
  it('returns the matching lead id', async () => {
    mockSql.mockResolvedValueOnce([{ id: 42 }]);
    const id = await resolveLeadIdByPhone('+15025551234');
    expect(id).toBe(42);
    expect(queryText('SELECT id FROM leads WHERE phone')).toBe(true);
  });

  it('returns null when no lead matches', async () => {
    mockSql.mockResolvedValueOnce([]);
    const id = await resolveLeadIdByPhone('+19999999999');
    expect(id).toBeNull();
  });

  it('returns null (never throws) for a null/empty phone', async () => {
    expect(await resolveLeadIdByPhone(null)).toBeNull();
    expect(await resolveLeadIdByPhone(undefined)).toBeNull();
    expect(await resolveLeadIdByPhone('')).toBeNull();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('swallows a DB error and returns null (best-effort, never blocks the caller)', async () => {
    mockSql.mockRejectedValueOnce(new Error('connection lost'));
    const id = await resolveLeadIdByPhone('+15025551234');
    expect(id).toBeNull();
  });
});

describe('recordStageTransitionsBulk', () => {
  it('issues one INSERT for the whole batch of lead ids', async () => {
    mockSql.mockResolvedValueOnce([]);
    await recordStageTransitionsBulk([1, 2, 3], 'NEW', { channel: 'system' });
    expect(mockSql).toHaveBeenCalledTimes(1);
    expect(queryText('INSERT INTO stage_transitions')).toBe(true);
  });

  it('is a no-op for an empty id list (no wasted round trip)', async () => {
    await recordStageTransitionsBulk([], 'NEW');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('swallows a DB error (best-effort, never throws)', async () => {
    mockSql.mockRejectedValueOnce(new Error('db down'));
    await expect(recordStageTransitionsBulk([1], 'NEW')).resolves.toBeUndefined();
  });
});
