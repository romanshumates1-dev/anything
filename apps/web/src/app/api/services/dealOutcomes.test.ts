/**
 * Wiring recordStageTransition into markDealNoAgreement (BREAKAGE_TABLE.md
 * session (s): funnel analytics was permanently empty — nothing ever wrote to
 * stage_transitions). A negotiation that ends without agreement is the real
 * closed-lost event.
 *
 * Mutation-proven RED: with the recordStageTransition call removed from the
 * function (the original, unfixed code), this test fails because the mock is
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
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const { recordStageTransition, resolveLeadIdByPhone } = vi.hoisted(() => ({
  recordStageTransition: vi.fn(async () => {}),
  resolveLeadIdByPhone: vi.fn(async () => null as number | null),
}));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({ recordStageTransition, resolveLeadIdByPhone }));

import { markDealNoAgreement, finalizeDeal } from './dealOutcomes';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('markDealNoAgreement', () => {
  it('records a CLOSED_LOST stage transition for the resolved lead', async () => {
    resolveLeadIdByPhone.mockResolvedValueOnce(15);
    mockSql.mockResolvedValueOnce([]); // UPDATE campaign_contacts

    await markDealNoAgreement({
      organizationId: 'org-1',
      negotiationId: 'cc-1',
      contactId: 'cc-1',
      contactPhone: '+15025551234',
    });

    expect(resolveLeadIdByPhone).toHaveBeenCalledWith('+15025551234');
    expect(recordStageTransition).toHaveBeenCalledTimes(1);
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 15, fromStage: 'NEGOTIATING', toStage: 'CLOSED_LOST' })
    );
  });

  it('does not record a transition when no lead matches the phone (best-effort)', async () => {
    resolveLeadIdByPhone.mockResolvedValueOnce(null);
    mockSql.mockResolvedValueOnce([]);

    await markDealNoAgreement({
      organizationId: 'org-1',
      negotiationId: 'cc-1',
      contactId: 'cc-1',
      contactPhone: '+19999999999',
    });

    expect(recordStageTransition).not.toHaveBeenCalled();
  });
});

describe('finalizeDeal (unrelated to this fix — must be unaffected)', () => {
  it('still marks the contact DEAL_AGREED and creates the contract-send approval', async () => {
    mockSql.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await finalizeDeal({
      organizationId: 'org-1',
      negotiationId: 'cc-1',
      contactId: 'cc-1',
      campaignId: 'camp-1',
      direction: 'SELLER',
      agreedPrice: 100000,
      contactPhone: '+15025551234',
    });
    expect(recordStageTransition).not.toHaveBeenCalled();
  });
});
