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

const { recordStageTransition, resolveLeadIdByPhone } = vi.hoisted(() => ({
  recordStageTransition: vi.fn(async () => {}),
  resolveLeadIdByPhone: vi.fn(async () => null as number | null),
}));
vi.mock('../../services/stageTransitionRecorder', () => ({ recordStageTransition, resolveLeadIdByPhone }));

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
    resolveLeadIdByPhone.mockResolvedValueOnce(321);
    mockSql.mockResolvedValueOnce([]); // UPDATE campaign_contacts -> OPTED_OUT

    const res = await POST(req({ from: '+15025551234', text: 'STOP' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'opted_out' });

    expect(registerOptOut).toHaveBeenCalledWith('+15025551234', 'sms', expect.objectContaining({ reason: 'stop_keyword' }));
    expect(resolveLeadIdByPhone).toHaveBeenCalledWith('+15025551234');
    expect(recordStageTransition).toHaveBeenCalledTimes(1);
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 321, toStage: 'CLOSED_LOST', channel: 'inbound' })
    );
  });

  it('does not record a transition when no lead matches the opted-out phone (best-effort)', async () => {
    resolveLeadIdByPhone.mockResolvedValueOnce(null);
    mockSql.mockResolvedValueOnce([]);

    const res = await POST(req({ from: '+19999999999', text: 'STOP' }));
    expect(res.status).toBe(200);
    expect(recordStageTransition).not.toHaveBeenCalled();
  });

  it('does not record a transition (or opt out) for a normal, non-STOP message', async () => {
    mockSql.mockResolvedValueOnce([]); // SELECT leads WHERE phone (no match)

    const res = await POST(req({ from: '+15025551234', text: 'Yes I am interested' }));
    expect(res.status).toBe(200);
    expect(registerOptOut).not.toHaveBeenCalled();
    expect(recordStageTransition).not.toHaveBeenCalled();
  });
});
