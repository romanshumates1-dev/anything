/**
 * SNS inbound — destination-number routing (independent-review fix).
 *
 * The old general-reply path did `WHERE l.phone = from ORDER BY updated_at DESC
 * LIMIT 1`: a sender number shared by two tenants attributed the reply (AI job +
 * conversation side effects) to whichever tenant touched it last. The fixed path
 * routes by the DESTINATION number through the platform's own send history —
 * server-trusted, not caller-chosen — then scopes the lead lookup to that org.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.AWS_SNS_VERIFY_SIGNATURES = 'false';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

vi.mock('../../utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../../utils/execution-ledger', () => ({ recordRun: vi.fn(async () => {}) }));
vi.mock('../../utils/jobs', () => ({ enqueueJob: vi.fn(async () => 'job-1') }));
vi.mock('../../utils/sla', () => ({ recordReplyReceived: vi.fn(async () => {}) }));
vi.mock('../../utils/cadenceEngine', () => ({ cancelCadence: vi.fn(async () => {}) }));
vi.mock('../../services/humanRequestDetector', () => ({
  detectHumanRequest: vi.fn(() => ({ isHumanRequest: false, method: 'none' as const })),
  handleHumanRequest: vi.fn(async () => {}),
}));
vi.mock('../../services/optOutDetection', () => ({ isOptOutMessage: vi.fn(() => false) }));
vi.mock('../../utils/compliance', () => ({ registerOptOut: vi.fn(async () => {}) }));

const { recordStageTransitionsBulk, resolveLeadIdsByPhoneGlobal } = vi.hoisted(() => ({
  recordStageTransitionsBulk: vi.fn(async () => {}),
  resolveLeadIdsByPhoneGlobal: vi.fn(async () => [] as string[]),
}));
vi.mock('../../services/stageTransitionRecorder', () => ({
  recordStageTransitionsBulk,
  resolveLeadIdsByPhoneGlobal,
}));

import { POST } from './route';
import { enqueueJob } from '../../utils/jobs';

const snsBody = (sms: Record<string, unknown>) => ({
  Type: 'Notification',
  MessageId: 'msg-1',
  TopicArn: 'arn:aws:sns:us-east-1:123:topic',
  Timestamp: new Date().toISOString(),
  SignatureVersion: '1',
  Signature: 'sig',
  SigningCertURL: 'https://sns.us-east-1.amazonaws.com/cert.pem',
  Message: JSON.stringify(sms),
});

const req = (sms: Record<string, unknown>) =>
  new Request('http://t/api/sms/sns-inbound', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(snsBody(sms)),
  }) as any;

const sms = (from: string, to: string, body = 'yes interested') => ({
  originationNumber: from,
  destinationNumber: to,
  messageKeyword: '',
  messageBody: body,
  inboundMessageId: `in-${from}-${to}`,
});

beforeEach(() => {
  vi.clearAllMocks();
  // mockClear does NOT drain mockResolvedValueOnce queues — without a reset, one
  // test's surplus queue entries leak into the next test's dedup lookup and shift
  // every query by one (this produced phantom 'duplicate' statuses while debugging).
  mockSql.mockReset();
});

// Every POST first hits the at-least-once dedup lookup (audit_logs). Queue "no
// duplicate" first inside each test, then the test's own queries after it.
// (A beforeEach default would be wiped by clearAllMocks ordering, so this is explicit.)
const noDuplicate = () => mockSql.mockResolvedValueOnce([]);

describe('SNS general reply — destination-number routing', () => {
  it('RED-proof: no outbound to the destination number means no attribution, even when the sender is a known lead', async () => {
    // Campaign-contact lookup (platform send history) returns NOTHING — the platform
    // never sent to this destination number. The sender IS a known lead, but the route
    // must not reach the leads table at all. Under the old code the same body
    // returned { status: 'processed' } against that lead.
    noDuplicate(); // dedup lookup runs FIRST — queue it before the test's own queries
    mockSql.mockResolvedValueOnce([]); // campaign lookup -> no match
    const res = await POST(req(sms('+15025550100', '+19998887777')));
    expect(await res.json()).toEqual({ status: 'no_matching_lead' });
    // sql called twice: dedup lookup + campaign lookup. No leads query, no INSERT, no job.
    expect(mockSql).toHaveBeenCalledTimes(2);
    expect(vi.mocked(enqueueJob)).not.toHaveBeenCalled();
  });

  it('routes a shared sender to the org that owns the destination number', async () => {
    noDuplicate();
    mockSql
      .mockResolvedValueOnce([{ campaignId: 'camp-a', organizationId: 'org_a' }])
      .mockResolvedValueOnce([{ id: 'lead_a', name: 'A', organization_id: 'org_a' }])
      .mockResolvedValueOnce([]); // message_events INSERT
    const res = await POST(req(sms('+15025550100', '+19998887777')));
    const body = await res.json();
    expect(body).toEqual({ status: 'processed', leadId: 'lead_a' });
    expect(vi.mocked(enqueueJob)).toHaveBeenCalledWith(
      'ai_reply',
      expect.objectContaining({ leadId: 'lead_a', organizationId: 'org_a' }),
      expect.anything(),
    );
  });

  it('the lead lookup is bound to the routed org, never the sender alone', async () => {
    noDuplicate();
    mockSql
      .mockResolvedValueOnce([{ campaignId: 'camp-a', organizationId: 'org_a' }])
      .mockResolvedValueOnce([]); // leads lookup -> no match in routed org
    await POST(req(sms('+15025550100', '+19998887777')));
    // Third query (after dedup + campaign): the leads lookup. Its bound values must
    // include the routed org.
    const leadCallArgs = (mockSql.mock.calls[2] ?? []).slice(1);
    expect(leadCallArgs).toContain('org_a');
    expect(leadCallArgs).toContain('+15025550100');
  });

  it('paused/cancelled campaigns are not valid routing anchors', async () => {
    noDuplicate();
    mockSql.mockResolvedValueOnce([]); // nothing active for this destination
    const res = await POST(req(sms('+15025550100', '+19998887777')));
    expect(await res.json()).toEqual({ status: 'no_matching_lead' });
    expect(vi.mocked(enqueueJob)).not.toHaveBeenCalled();
  });
});
