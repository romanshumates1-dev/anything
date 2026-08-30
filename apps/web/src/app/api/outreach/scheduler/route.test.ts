/**
 * Bug #36 — "outreach scheduler marks contacts SENT without sending/
 * enqueueing anything": the old implementation pulled QUEUED contacts and
 * flipped their status straight to SENT with zero calls to enqueueJob (or
 * any other dispatch mechanism) — contacts were marked SENT but never
 * actually received a message. Fixed: the scheduler now enqueues a real
 * send_message job per contact (dispatchGate + provider run inside the job
 * processor at transmit time) and only marks SENT when the enqueue actually
 * succeeded.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

const { logEvent } = vi.hoisted(() => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent }));

const { enqueueJob } = vi.hoisted(() => ({ enqueueJob: vi.fn() }));
vi.mock('@/app/api/utils/jobs', () => ({ enqueueJob: (...a: any[]) => enqueueJob(...a) }));

vi.mock('@/app/api/utils/cadenceEngine', () => ({ CONSENT_BASIS_ATTESTED: 'manual-list-attested' }));

const { recordStageTransition, resolveLeadIdByPhone } = vi.hoisted(() => ({
  recordStageTransition: vi.fn(async () => {}),
  resolveLeadIdByPhone: vi.fn(async () => null as number | null),
}));
vi.mock('@/app/api/services/stageTransitionRecorder', () => ({ recordStageTransition, resolveLeadIdByPhone }));

import { POST } from './route';

function req() {
  return new Request('http://t/api/outreach/scheduler/run', { method: 'POST' }) as any;
}

const CAMPAIGN = { id: 'camp-1', organization_id: 'org-1', daily_volume_max: 10, consent_confirmed_at: null };
const CONTACTS = [
  { id: 'c1', phone: '+15550001', seller_lead_id: null, buyer_lead_id: null },
  { id: 'c2', phone: '+15550002', seller_lead_id: null, buyer_lead_id: null },
];
const OPENING = { id: 'tmpl-1', body: 'Hi {name}, interested in your property?' };

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  getOrganization.mockResolvedValue({ id: 'org-1' });
});

describe('POST /api/outreach/scheduler/run', () => {
  it('enqueues a real send_message job per selected contact instead of no-op SENT flips', async () => {
    enqueueJob.mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');
    mockSql
      .mockResolvedValueOnce([CAMPAIGN]) // active campaigns
      .mockResolvedValueOnce([]) // daily log (none yet)
      .mockResolvedValueOnce(CONTACTS) // queued contacts
      .mockResolvedValueOnce([OPENING]) // opening template
      .mockResolvedValueOnce([]) // UPDATE campaign_contacts (c1)
      .mockResolvedValueOnce([]) // UPDATE campaign_contacts (c2)
      .mockResolvedValueOnce([]); // INSERT campaign_daily_send_logs

    const res = await POST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([{ campaignId: 'camp-1', queued: 2 }]);

    expect(enqueueJob).toHaveBeenCalledTimes(2);
    expect(enqueueJob).toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({ to: '+15550001', text: OPENING.body, campaignId: 'camp-1', contactId: 'c1', channel: 'sms' }),
      expect.objectContaining({ dedupeKey: expect.stringContaining('scheduler:camp-1:c1:') })
    );
    expect(enqueueJob).toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({ to: '+15550002', contactId: 'c2' }),
      expect.anything()
    );

    // Every SENT flip must be preceded by a successful enqueue — assert the
    // UPDATE calls happened (there are exactly 2, one per contact whose
    // enqueue succeeded).
    const updateCalls = mockSql.mock.calls.filter(
      (c: any) => Array.isArray(c[0]) && c[0].join('?').includes("SET status = 'SENT'")
    );
    expect(updateCalls.length).toBe(2);
  });

  it('does NOT mark a contact SENT when its enqueue is deduped/fails (returns null)', async () => {
    enqueueJob.mockResolvedValueOnce('job-1').mockResolvedValueOnce(null);
    mockSql
      .mockResolvedValueOnce([CAMPAIGN])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(CONTACTS)
      .mockResolvedValueOnce([OPENING])
      .mockResolvedValueOnce([]) // UPDATE for c1 only
      .mockResolvedValueOnce([]); // INSERT daily log (queued=1)

    const res = await POST(req());
    const body = await res.json();
    expect(body.results).toEqual([{ campaignId: 'camp-1', queued: 1 }]);

    const updateCalls = mockSql.mock.calls.filter(
      (c: any) => Array.isArray(c[0]) && c[0].join('?').includes("SET status = 'SENT'")
    );
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0]).toContain('c1');
  });

  it('skips a campaign with no OPENING template and enqueues nothing', async () => {
    mockSql
      .mockResolvedValueOnce([CAMPAIGN])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(CONTACTS)
      .mockResolvedValueOnce([]); // no opening template found

    const res = await POST(req());
    const body = await res.json();
    expect(body.results).toEqual([{ campaignId: 'camp-1', queued: 0, reason: 'no_opening_template' }]);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('skips campaigns that already hit their daily volume cap', async () => {
    mockSql
      .mockResolvedValueOnce([CAMPAIGN])
      .mockResolvedValueOnce([{ sent_count: 10 }]); // already at daily_volume_max (10)

    const res = await POST(req());
    const body = await res.json();
    expect(body.results).toEqual([{ campaignId: 'camp-1', queued: 0 }]);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  // BREAKAGE_TABLE.md session (s) follow-up: recordStageTransition was never
  // called anywhere (funnel analytics permanently empty). QUEUED -> SENT is
  // the real "contacted" event.
  it('records a CONTACTED stage transition for every contact actually marked SENT', async () => {
    enqueueJob.mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');
    resolveLeadIdByPhone.mockResolvedValueOnce(501).mockResolvedValueOnce(502);
    mockSql
      .mockResolvedValueOnce([CAMPAIGN])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(CONTACTS)
      .mockResolvedValueOnce([OPENING])
      .mockResolvedValueOnce([]) // UPDATE campaign_contacts (c1)
      .mockResolvedValueOnce([]) // UPDATE campaign_contacts (c2)
      .mockResolvedValueOnce([]); // INSERT campaign_daily_send_logs

    const res = await POST(req());
    expect(res.status).toBe(200);

    expect(resolveLeadIdByPhone).toHaveBeenCalledWith('+15550001');
    expect(resolveLeadIdByPhone).toHaveBeenCalledWith('+15550002');
    expect(recordStageTransition).toHaveBeenCalledTimes(2);
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 501, fromStage: 'NEW', toStage: 'CONTACTED', campaignId: 'camp-1', channel: 'sms' })
    );
    expect(recordStageTransition).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 502, toStage: 'CONTACTED' })
    );
  });

  it('does not record a transition when no lead matches the contact phone (best-effort)', async () => {
    enqueueJob.mockResolvedValueOnce('job-1').mockResolvedValueOnce('job-2');
    resolveLeadIdByPhone.mockResolvedValue(null);
    mockSql
      .mockResolvedValueOnce([CAMPAIGN])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(CONTACTS)
      .mockResolvedValueOnce([OPENING])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(recordStageTransition).not.toHaveBeenCalled();
  });
});
