/**
 * Wiring recordStageTransition into the real Twilio inbound STOP path
 * (BREAKAGE_TABLE.md session (s): funnel analytics was permanently empty —
 * nothing ever wrote to stage_transitions). A real STOP is a closed-lost
 * event. Exercised via the JSON "simulator" branch (x-sms-secret header) so
 * the test doesn't need to fabricate a Twilio HMAC signature — the opt-out
 * gate itself runs identically on both branches (see route.ts).
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

vi.mock('../../utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../../utils/execution-ledger', () => ({ recordRun: vi.fn(async () => {}) }));
vi.mock('../../utils/twilio-adapter', () => ({ getTwilioConfig: vi.fn(() => null) }));
vi.mock('../../utils/twilio-webhook', () => ({ validateTwilioSignature: vi.fn(() => false) }));
vi.mock('../../utils/jobs', () => ({ enqueueJob: vi.fn(async () => 'job-1') }));
vi.mock('../../utils/sla', () => ({ recordReplyReceived: vi.fn(async () => {}) }));
vi.mock('../../utils/cadenceEngine', () => ({ cancelCadence: vi.fn(async () => {}) }));
vi.mock('../../services/humanRequestDetector', () => ({
  detectHumanRequest: vi.fn(() => ({ isHumanRequest: false })),
  handleHumanRequest: vi.fn(async () => {}),
}));

const { registerOptOut } = vi.hoisted(() => ({ registerOptOut: vi.fn(async () => {}) }));
vi.mock('../../utils/compliance', () => ({ registerOptOut }));

const { recordStageTransition, recordStageTransitionsBulk, resolveLeadIdByPhone, resolveLeadIdsByPhoneGlobal } =
  vi.hoisted(() => ({
    recordStageTransition: vi.fn(async () => {}),
    recordStageTransitionsBulk: vi.fn(async () => {}),
    // The webhook path has no authenticated tenant, so it must NOT use the strict
    // resolver (which requires an organization and would fail closed).
    resolveLeadIdByPhone: vi.fn(async () => null as string | null),
    resolveLeadIdsByPhoneGlobal: vi.fn(async () => [] as string[]),
  }));
vi.mock('../../services/stageTransitionRecorder', () => ({
  recordStageTransition,
  recordStageTransitionsBulk,
  resolveLeadIdByPhone,
  resolveLeadIdsByPhoneGlobal,
}));

import { POST } from './route';

const req = (body: unknown) =>
  new Request('http://t/api/sms/inbound', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sms-secret': 'test-secret' },
    body: JSON.stringify(body),
  }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMS_INBOUND_SECRET = 'test-secret';
});

describe('POST /api/sms/inbound — STOP keyword', () => {
  it('records a CLOSED_LOST stage transition for a real opt-out', async () => {
    // The suppression above is platform-wide, so attribution must cover EVERY lead holding
    // the number - not one arbitrarily-chosen tenant.
    resolveLeadIdsByPhoneGlobal.mockResolvedValueOnce(['321']);
    mockSql.mockResolvedValueOnce([]); // UPDATE campaign_contacts -> OPTED_OUT

    const res = await POST(req({ from: '+15025551234', text: 'STOP' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'opted_out' });

    expect(registerOptOut).toHaveBeenCalledWith('+15025551234', 'sms', expect.objectContaining({ reason: 'stop_keyword' }));
    expect(resolveLeadIdsByPhoneGlobal).toHaveBeenCalledWith('+15025551234');
    expect(recordStageTransitionsBulk).toHaveBeenCalledTimes(1);
    expect(recordStageTransitionsBulk).toHaveBeenCalledWith(
      ['321'],
      'CLOSED_LOST',
      expect.objectContaining({ channel: 'inbound' })
    );
  });

  it('attributes the opt-out to EVERY matching lead, not a single arbitrary tenant', async () => {
    // Same phone held as a lead by two organizations. The old code resolved exactly one
    // via `ORDER BY updated_at DESC`, so a STOP on org A's number could mutate org B's
    // funnel. Attribution must now be symmetric with the global suppression.
    resolveLeadIdsByPhoneGlobal.mockResolvedValueOnce(['lead_a', 'lead_b']);
    mockSql.mockResolvedValueOnce([]);

    const res = await POST(req({ from: '+15025550100', text: 'STOP' }));
    expect(res.status).toBe(200);
    expect(recordStageTransitionsBulk).toHaveBeenCalledWith(
      ['lead_a', 'lead_b'],
      'CLOSED_LOST',
      expect.objectContaining({ channel: 'inbound' })
    );
  });

  it('does not use the strict resolver on a webhook path with no tenant context', async () => {
    resolveLeadIdsByPhoneGlobal.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([]);

    await POST(req({ from: '+15025551234', text: 'STOP' }));
    // resolveLeadIdByPhone requires an organization and fails closed; using it here
    // would silently disable attribution rather than scope it.
    expect(resolveLeadIdByPhone).not.toHaveBeenCalled();
  });

  it('does not record a transition when no lead matches the opted-out phone (best-effort)', async () => {
    resolveLeadIdsByPhoneGlobal.mockResolvedValueOnce([]);
    mockSql.mockResolvedValueOnce([]);

    const res = await POST(req({ from: '+19999999999', text: 'STOP' }));
    expect(res.status).toBe(200);
    expect(recordStageTransitionsBulk).not.toHaveBeenCalled();
  });

  it('does not record a transition (or opt out) for a normal, non-STOP message', async () => {
    mockSql.mockResolvedValueOnce([]); // SELECT leads WHERE phone (no match)

    const res = await POST(req({ from: '+15025551234', text: 'Yes I am interested' }));
    expect(res.status).toBe(200);
    expect(registerOptOut).not.toHaveBeenCalled();
    expect(recordStageTransitionsBulk).not.toHaveBeenCalled();
  });
});
