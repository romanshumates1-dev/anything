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
      // Verify the query targets cadence_step jobs for the contact
      const call = vi.mocked(sql).mock.calls[0];
      const queryStr = call[0] as any;
      expect(queryStr.join('')).toContain("type = 'cadence_step'");
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
      vi.mocked(enqueueJob).mockResolvedValue('job-retry');

      const result = await processCadenceStep(payload);

      expect(result.sent).toBe(false);
      expect(result.reason).toBe('gate:OUTSIDE_WINDOW');
      // Should reschedule at retryAt
      expect(enqueueJob).toHaveBeenCalledWith(
        'cadence_step',
        payload,
        expect.objectContaining({ runAt: retryAt, dedupeKey: 'cadence:c1:1' })
      );
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
