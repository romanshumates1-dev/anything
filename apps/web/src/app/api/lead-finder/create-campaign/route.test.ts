/**
 * Wiring recordStageTransition into the lead-finder segment handoff
 * (BREAKAGE_TABLE.md session (s): funnel analytics was permanently empty —
 * nothing ever wrote to stage_transitions). A handed-off sourced_lead becomes
 * a real `leads` row and enters the funnel at NEW, same as any other lead.
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

const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock('@/app/api/utils/authz', () => ({ requireAdmin }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const { recordStageTransition } = vi.hoisted(() => ({ recordStageTransition: vi.fn(async () => {}) }));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({ recordStageTransition }));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/lead-finder/create-campaign', { method: 'POST', body: JSON.stringify(body) }) as any;

const SOURCED_LEAD = {
  id: 9,
  category: 'seller',
  owner_name: 'Jane Owner',
  property_address: '123 Main St',
  mailing_address: null,
  parcel_id: 'P-1',
  county: 'Jefferson',
  record_type: 'tax_delinquent',
  signals: [],
  distress_score: 80,
  score_reasons: [],
  provenance: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ ok: true, userId: 'admin-1', email: 'admin@dealswiftautomation.com' });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('POST /api/lead-finder/create-campaign', () => {
  it('records a NEW stage transition for every handed-off lead', async () => {
    mockSql
      .mockResolvedValueOnce([SOURCED_LEAD]) // segment SELECT (explicit leadIds)
      .mockResolvedValueOnce([{ id: 9 }]) // claim UPDATE sourced_leads
      .mockResolvedValueOnce([{ id: 500 }]) // INSERT leads RETURNING id
      .mockResolvedValueOnce([]); // UPDATE sourced_leads handed_off_lead_id

    const res = await POST(req({ leadIds: [9] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(1);

    expect(recordStageTransition).toHaveBeenCalledTimes(1);
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 500, fromStage: null, toStage: 'NEW' })
    );
  });

  it('does not call recordStageTransition when the claim loses the race (already handed off)', async () => {
    mockSql
      .mockResolvedValueOnce([SOURCED_LEAD]) // segment SELECT
      .mockResolvedValueOnce([]); // claim UPDATE affected 0 rows (lost race)

    const res = await POST(req({ leadIds: [9] }));
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(recordStageTransition).not.toHaveBeenCalled();
  });
});
