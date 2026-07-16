/**
 * INT-4 — Cadence Engine tests (pure logic, no DB gate).
 *
 * These test the scheduling logic, dedupe key generation, and the
 * processCadenceStep decision tree. The DB I/O layer (scheduleNextStep)
 * is thin; the interesting logic is the state machine and gate integration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('@/app/api/utils/sql', () => ({
  default: vi.fn(),
}));

vi.mock('@/app/api/utils/jobs', () => ({
  enqueueJob: vi.fn(),
}));

vi.mock('@/app/api/utils/dispatchGate', () => ({
  dispatchGate: vi.fn(),
}));

vi.mock('@/app/api/utils/betaFlags', () => ({
  isBetaFlagOn: vi.fn(),
}));

vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(),
}));

import sql from '@/app/api/utils/sql';
import { enqueueJob } from '@/app/api/utils/jobs';
import { dispatchGate } from '@/app/api/utils/dispatchGate';
import { isBetaFlagOn } from '@/app/api/utils/betaFlags';
import { processCadenceStep, scheduleNextStep, cancelCadence } from '../cadenceEngine';

describe('INT-4 — Cadence Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('scheduleNextStep', () => {
    it('returns null when cadenceEngine beta flag is OFF', async () => {
      vi.mocked(isBetaFlagOn).mockResolvedValue(false);
      const result = await scheduleNextStep('c1', 'camp1', 'org1');
      expect(result).toBeNull();
      expect(isBetaFlagOn).toHaveBeenCalledWith('cadenceEngine');
    });

    it('schedules a job with correct dedupe key when flag is ON', async () => {
      vi.mocked(isBetaFlagOn).mockResolvedValue(true);
      vi.mocked(sql).mockImplementation(async (strings: any, ...values: any[]) => {
        const query = typeof strings === 'string' ? strings : strings.join('?');
        if (query.includes('campaign_contacts')) {
          return [{ id: 'c1', follow_ups_sent: 0, phone: '+15025550001', organization_id: 'org1' }];
        }
        if (query.includes('campaign_message_templates')) {
          return [{ id: 't1', delay_hours: 24, body: 'Follow up 1' }];
        }
        return [];
      });
      vi.mocked(enqueueJob).mockResolvedValue('job-123');

      const result = await scheduleNextStep('c1', 'camp1', 'org1');

      expect(result).toBe('job-123');
      expect(enqueueJob).toHaveBeenCalledWith(
        'cadence_step',
        expect.objectContaining({
          contactId: 'c1',
          campaignId: 'camp1',
          sequenceOrder: 1,
          body: 'Follow up 1',
        }),
        expect.objectContaining({
          dedupeKey: 'cadence:c1:1',
        })
      );
      // Verify runAt is roughly 24 hours from now (within 1 minute)
      const callArgs = vi.mocked(enqueueJob).mock.calls[0][2] as any;
      const expectedRunAt = new Date(Date.now() + 24 * 3600_000);
      expect(Math.abs(callArgs.runAt.getTime() - expectedRunAt.getTime())).toBeLessThan(60_000);
    });

    it('returns null when no follow-up template exists', async () => {
      vi.mocked(isBetaFlagOn).mockResolvedValue(true);
      vi.mocked(sql).mockImplementation(async (strings: any, ...values: any[]) => {
        const query = typeof strings === 'string' ? strings : strings.join('?');
        if (query.includes('campaign_contacts')) {
          return [{ id: 'c1', follow_ups_sent: 5, phone: '+15025550001' }];
        }
        if (query.includes('campaign_message_templates')) {
          return []; // no more templates
        }
        return [];
      });

      const result = await scheduleNextStep('c1', 'camp1', 'org1');
      expect(result).toBeNull();
      expect(enqueueJob).not.toHaveBeenCalled();
    });
  });

  describe('cancelCadence', () => {
    it('updates pending cadence jobs to cancelled for the contact', async () => {
      vi.mocked(sql).mockResolvedValue([]);
      await cancelCadence('c1');
      expect(sql).toHaveBeenCalledWith(
        expect.arrayContaining([]),
        'c1'
      );
      // Verify the query targets BOTH cadence_step and voice_call jobs for the
      // contact — a reply 30s after the opening must also kill the T+60s call.
      const call = vi.mocked(sql).mock.calls[0];
      const queryStr = call[0] as any;
      expect(queryStr.join('')).toContain("type IN ('cadence_step', 'voice_call')");
      expect(queryStr.join('')).toContain("payload->>'contactId'");
    });
  });

  describe('processCadenceStep', () => {
    const payload = {
      contactId: 'c1',
      campaignId: 'camp1',
      organizationId: 'org1',
      phone: '+15025550001',
      sequenceOrder: 1,
      templateId: 't1',
      body: 'Follow up 1',
    };

    it('returns flag_off when cadenceEngine is OFF', async () => {
      vi.mocked(isBetaFlagOn).mockResolvedValue(false);
      const result = await processCadenceStep(payload);
      expect(result).toEqual({ sent: false, reason: 'flag_off' });
    });

    it('returns opted_out when contact has opted out', async () => {
      vi.mocked(isBetaFlagOn).mockResolvedValue(true);
      vi.mocked(sql).mockResolvedValue([
        { id: 'c1', status: 'OPTED_OUT', opted_out_at: new Date(), last_reply_at: null },
      ]);
      const result = await processCadenceStep(payload);
      expect(result).toEqual({ sent: false, reason: 'opted_out' });
    });

    it('returns replied when contact has replied', async () => {
      vi.mocked(isBetaFlagOn).mockResolvedValue(true);
      vi.mocked(sql).mockResolvedValue([
        { id: 'c1', status: 'FOLLOWED_UP', opted_out_at: null, last_reply_at: new Date() },
      ]);
      const result = await processCadenceStep(payload);
      expect(result).toEqual({ sent: false, reason: 'replied' });
    });

    it('returns gate:OUTSIDE_WINDOW when dispatchGate denies (with retryAt)', async () => {
      vi.mocked(isBetaFlagOn).mockResolvedValue(true);
      vi.mocked(sql).mockResolvedValue([
        { id: 'c1', status: 'SENT', opted_out_at: null, last_reply_at: null, seller_lead_id: 'l1' },
      ]);
      const retryAt = new Date(Date.now() + 3600_000);
      vi.mocked(dispatchGate).mockResolvedValue({
        allow: false,
        code: 'OUTSIDE_WINDOW',
        reason: 'Outside window',
        retryAt,
        timezones: ['America/New_York'],
      });
      const result = await processCadenceStep(payload);

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('gate:OUTSIDE_WINDOW');
      // Bug #12: it must NOT re-enqueue its own in-flight dedupe key — the
      // unique index spans processing rows, so that insert silently no-ops and
      // the step is lost. Same-row deferral instead: surface deferAt+gateCode
      // and jobs.ts moves THIS job's run_at.
      expect(enqueueJob).not.toHaveBeenCalled();
      expect(result.gateCode).toBe('OUTSIDE_WINDOW');
      expect(result.deferAt).toEqual(retryAt);
    });

    it('returns gate:QUIET_HOURS when dispatchGate denies (no retryAt)', async () => {
      vi.mocked(isBetaFlagOn).mockResolvedValue(true);
      vi.mocked(sql).mockResolvedValue([
        { id: 'c1', status: 'SENT', opted_out_at: null, last_reply_at: null, seller_lead_id: 'l1' },
      ]);
      vi.mocked(dispatchGate).mockResolvedValue({
        allow: false,
        code: 'QUIET_HOURS',
        reason: 'Outside quiet hours',
        timezones: ['America/New_York'],
      });

      const result = await processCadenceStep(payload);

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('gate:QUIET_HOURS');
      expect(result.gateCode).toBe('QUIET_HOURS');
      expect(result.deferAt).toBeUndefined(); // jobs.ts falls back to +1h
      expect(enqueueJob).not.toHaveBeenCalled();
    });

    it('sends message when gate allows (no more follow-ups = nextJobId null)', async () => {
      vi.mocked(isBetaFlagOn).mockResolvedValue(true);
      
      vi.mocked(sql).mockImplementation(async (strings: any, ...values: any[]) => {
        const query = typeof strings === 'string' ? strings : strings.join('?');
        if (query.includes('campaign_contacts WHERE id')) {
          return [{ id: 'c1', status: 'SENT', opted_out_at: null, last_reply_at: null, seller_lead_id: 'l1' }];
        }
        if (query.includes('campaign_message_templates')) {
          return []; // no more follow-ups
        }
        if (query.includes('UPDATE campaign_contacts')) {
          return [];
        }
        return [];
      });
      vi.mocked(dispatchGate).mockResolvedValue({
        allow: true,
        timezones: ['America/New_York'],
      });
      vi.mocked(enqueueJob).mockResolvedValue('job-send');

      const result = await processCadenceStep(payload);

      expect(result.sent).toBe(true);
      expect(result.reason).toBe('sent');
      // No more follow-up templates, so nextJobId is null
      expect(result.nextJobId).toBeNull();

      // Should enqueue send_message
      expect(enqueueJob).toHaveBeenCalledWith(
        'send_message',
        expect.objectContaining({
          to: payload.phone,
          text: payload.body,
          contactId: payload.contactId,
        })
      );
    });

    it('updates contact state after sending', async () => {
      vi.mocked(isBetaFlagOn).mockResolvedValue(true);
      const sqlMock = vi.fn();
      vi.mocked(sql).mockImplementation(sqlMock);
      sqlMock.mockImplementation(async (strings: any, ...values: any[]) => {
        const query = typeof strings === 'string' ? strings : strings.join('?');
        if (query.includes('campaign_contacts WHERE id')) {
          return [{ id: 'c1', status: 'SENT', opted_out_at: null, last_reply_at: null, seller_lead_id: 'l1' }];
        }
        if (query.includes('campaign_message_templates')) {
          return []; // no more follow-ups
        }
        return [];
      });
      vi.mocked(dispatchGate).mockResolvedValue({
        allow: true,
        timezones: ['America/New_York'],
      });
      vi.mocked(enqueueJob).mockResolvedValue('job-456');

      await processCadenceStep(payload);

      // Verify contact update
      const updateCall = sqlMock.mock.calls.find((call: any) => {
        const query = typeof call[0] === 'string' ? call[0] : call[0].join('?');
        return query.includes('UPDATE campaign_contacts');
      });
      expect(updateCall).toBeDefined();
    });
  });
});

// ── INT-4 completion (session l) ─────────────────────────────────────────────

vi.mock('@/app/api/gateway/voice-gateway', () => ({
  getVoiceGateway: vi.fn(() => ({ call: mockVoiceCall })),
}));
const { mockVoiceCall } = vi.hoisted(() => ({
  mockVoiceCall: vi.fn(async () => ({ callUuid: 'u1', status: 'queued', channel: 'voice', provider: 'mock-voice', leadId: 1, to: '+15025550101', dispatchTime: new Date() })),
}));

import { dispatchOpenings, scheduleVoiceStep, processVoiceStep, CONSENT_BASIS_ATTESTED } from '../cadenceEngine';

describe('dispatchOpenings — the T+0 step that STARTS the ladder', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flag OFF: no-op, campaign start behaves exactly as pre-INT-4', async () => {
    vi.mocked(isBetaFlagOn).mockResolvedValue(false);
    const r = await dispatchOpenings('camp1', 'org1');
    expect(r).toEqual({ queued: 0, reason: 'flag_off' });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('no OPENING template: nothing queued, explicit reason', async () => {
    vi.mocked(isBetaFlagOn).mockResolvedValue(true);
    vi.mocked(sql)
      .mockResolvedValueOnce([{ id: 'camp1', consent_confirmed_at: null }]) // campaign
      .mockResolvedValueOnce([]); // no opening template
    const r = await dispatchOpenings('camp1', 'org1');
    expect(r).toEqual({ queued: 0, reason: 'no_opening_template' });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('queues one at-most-once-EVER opening per fresh contact, with consentBasis from the campaign attestation', async () => {
    vi.mocked(isBetaFlagOn).mockResolvedValue(true);
    vi.mocked(sql)
      .mockResolvedValueOnce([{ id: 'camp1', consent_confirmed_at: '2026-07-01' }])
      .mockResolvedValueOnce([{ id: 'tpl-open', body: 'Hi {name}' }])
      .mockResolvedValueOnce([
        { id: 'c1', phone: '+15025550101', seller_lead_id: 7 },
        { id: 'c2', phone: '+12705550102', seller_lead_id: 8 },
      ]);
    vi.mocked(enqueueJob).mockResolvedValue('j1');

    const r = await dispatchOpenings('camp1', 'org1');
    expect(r.queued).toBe(2);
    expect(enqueueJob).toHaveBeenCalledWith(
      'send_message',
      expect.objectContaining({
        contactId: 'c1', channel: 'sms', isOpening: true,
        consentBasis: CONSENT_BASIS_ATTESTED, text: 'Hi {name}',
      }),
      expect.objectContaining({ dedupeKey: 'open:camp1:c1' })
    );
  });

  it('an already-relaunched campaign dedupes to zero (enqueueJob returns null on conflict)', async () => {
    vi.mocked(isBetaFlagOn).mockResolvedValue(true);
    vi.mocked(sql)
      .mockResolvedValueOnce([{ id: 'camp1', consent_confirmed_at: null }])
      .mockResolvedValueOnce([{ id: 'tpl-open', body: 'Hi' }])
      .mockResolvedValueOnce([{ id: 'c1', phone: '+15025550101', seller_lead_id: 7 }]);
    vi.mocked(enqueueJob).mockResolvedValue(null); // ON CONFLICT DO NOTHING
    const r = await dispatchOpenings('camp1', 'org1');
    expect(r.queued).toBe(0); // relaunch resends nothing
  });
});

describe('scheduleVoiceStep — ladder T+60s voice escalation', () => {
  beforeEach(() => vi.clearAllMocks());
  const payload = { contactId: 'c1', campaignId: 'camp1', organizationId: 'org1', phone: '+15025550101', leadId: 7, consentBasis: CONSENT_BASIS_ATTESTED };

  it('voiceEscalation OFF (default): no job, zero events', async () => {
    vi.mocked(isBetaFlagOn).mockResolvedValue(false);
    expect(await scheduleVoiceStep(payload)).toBeNull();
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('ON: schedules voice_call at ~+60s with per-step idempotency key', async () => {
    vi.mocked(isBetaFlagOn).mockResolvedValue(true);
    vi.mocked(enqueueJob).mockResolvedValue('jv1');
    const before = Date.now();
    await scheduleVoiceStep(payload);
    const [type, p, opts] = vi.mocked(enqueueJob).mock.calls[0];
    expect(type).toBe('voice_call');
    expect(p).toEqual(payload);
    expect(opts.dedupeKey).toBe('voice:c1:1');
    const delta = opts.runAt.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(59_000);
    expect(delta).toBeLessThanOrEqual(61_500);
  });
});

describe('processVoiceStep — freshness re-checks + same-row deferral', () => {
  beforeEach(() => vi.clearAllMocks());
  const payload = { contactId: 'c1', campaignId: 'camp1', organizationId: 'org1', phone: '+15025550101', leadId: 7, consentBasis: CONSENT_BASIS_ATTESTED };

  it('replied contact: never dials', async () => {
    vi.mocked(isBetaFlagOn).mockResolvedValue(true);
    vi.mocked(sql).mockResolvedValueOnce([{ id: 'c1', status: 'SENT', opted_out_at: null, last_reply_at: '2026-07-16' }]);
    const r = await processVoiceStep(payload);
    expect(r).toEqual({ dialed: false, reason: 'replied' });
    expect(mockVoiceCall).not.toHaveBeenCalled();
  });

  it('gate denial inside the gateway surfaces deferAt for same-row deferral', async () => {
    vi.mocked(isBetaFlagOn).mockResolvedValue(true);
    vi.mocked(sql).mockResolvedValueOnce([{ id: 'c1', status: 'SENT', opted_out_at: null, last_reply_at: null }]);
    const retryAt = new Date(Date.now() + 3600_000);
    mockVoiceCall.mockResolvedValueOnce({
      callUuid: 'u2', status: 'failed', channel: 'voice', provider: 'mock-voice',
      leadId: 7, to: payload.phone, dispatchTime: new Date(),
      errorMessage: 'QUIET_HOURS', gateCode: 'QUIET_HOURS', retryAt,
    });
    const r = await processVoiceStep(payload);
    expect(r.dialed).toBe(false);
    expect(r.gateCode).toBe('QUIET_HOURS');
    expect(r.deferAt).toEqual(retryAt);
    expect(enqueueJob).not.toHaveBeenCalled(); // never re-enqueue in-flight keys
  });

  it('allowed: dials via the (mock) gateway and reports the outcome', async () => {
    vi.mocked(isBetaFlagOn).mockResolvedValue(true);
    vi.mocked(sql).mockResolvedValueOnce([{ id: 'c1', status: 'SENT', opted_out_at: null, last_reply_at: null }]);
    const r = await processVoiceStep(payload);
    expect(r.dialed).toBe(true);
    expect(mockVoiceCall).toHaveBeenCalledWith(expect.objectContaining({ to: payload.phone, channel: 'voice', consentBasis: CONSENT_BASIS_ATTESTED }));
  });
});

describe('ABSORPTION — a contact mid-ladder fires each remaining step exactly once', () => {
  beforeEach(() => vi.clearAllMocks());

  it('follow_ups_sent=2 with 4 templates: every schedule attempt targets ONLY step 3, same idempotency key', async () => {
    vi.mocked(isBetaFlagOn).mockResolvedValue(true);
    // scheduleNextStep is invoked from MULTIPLE places (launch hook, post-send
    // hook, processCadenceStep) — absorption safety = all of them compute the
    // SAME dedupe key from DB state, so the unique index collapses them to one
    // job. Simulate three concurrent-ish invocations:
    for (let i = 0; i < 3; i++) {
      vi.mocked(sql)
        .mockResolvedValueOnce([{ id: 'c1', follow_ups_sent: 2, phone: '+15025550101', organization_id: 'org1' }])
        .mockResolvedValueOnce([{ id: 'tpl3', delay_hours: 24, body: 'step 3' }]);
    }
    vi.mocked(enqueueJob).mockResolvedValueOnce('j3').mockResolvedValue(null); // first wins, rest conflict

    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await scheduleNextStep('c1', 'camp1', 'org1'));

    expect(ids).toEqual(['j3', null, null]); // exactly one job created
    for (const call of vi.mocked(enqueueJob).mock.calls) {
      expect((call[2] as any).dedupeKey).toBe('cadence:c1:3'); // never :1, :2, or :4
      expect((call[1] as any).sequenceOrder).toBe(3);
    }
  });
});
