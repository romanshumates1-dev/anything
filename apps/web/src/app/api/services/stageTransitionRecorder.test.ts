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

describe('resolveLeadIdByPhone (STRICT - organization is required)', () => {
  it('returns the matching lead id for a known organization', async () => {
    mockSql.mockResolvedValueOnce([{ id: 42 }]);
    const id = await resolveLeadIdByPhone('+15025551234', 'org_a');
    expect(id).toBe(42);
    expect(queryText('organization_id')).toBe(true);
  });

  it('scopes the lookup to the supplied organization', async () => {
    mockSql.mockResolvedValueOnce([{ id: 7 }]);
    const id = await resolveLeadIdByPhone('+15025551234', 'org_a');
    expect(id).toBe(7);
  });

  it('FAILS CLOSED without an organization rather than resolving globally', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // No queued result: the strict primitive short-circuits before touching the DB,
    // so a queued value here would leak into the following test.
    expect(await resolveLeadIdByPhone('+15025551234', '')).toBeNull();
    expect(mockSql).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('returns null when no lead matches', async () => {
    mockSql.mockResolvedValueOnce([]);
    const id = await resolveLeadIdByPhone('+19999999999', 'org_a');
    expect(id).toBeNull();
  });

  it('returns null (never throws) for a null/empty phone', async () => {
    expect(await resolveLeadIdByPhone(null, 'org_a')).toBeNull();
    expect(await resolveLeadIdByPhone(undefined, 'org_a')).toBeNull();
    expect(await resolveLeadIdByPhone('', 'org_a')).toBeNull();
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('swallows a DB error and returns null (best-effort, never blocks the caller)', async () => {
    mockSql.mockRejectedValueOnce(new Error('connection lost'));
    const id = await resolveLeadIdByPhone('+15025551234', 'org_a');
    expect(id).toBeNull();
  });
});

