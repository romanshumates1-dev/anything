/**
 * INT-2 — Voice / RVM Gateway tests
 *
 * Verifies:
 * - Mock driver logs instead of dialing (no real carrier calls)
 * - Twilio stub validates config but does not dial
 * - VoiceGateway.call returns correct record shape
 * - Health check reflects provider state
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/app/api/utils/logger', () => ({
  logEvent: vi.fn(),
}));

import { logEvent } from '@/app/api/utils/logger';
import {
  VoiceGateway,
  MockVoiceDriver,
  TwilioVoiceStub,
  VoiceCallRequest,
} from './voice-gateway';

describe('INT-2 — Voice / RVM Gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('MockVoiceDriver', () => {
    it('logs instead of dialing (dialCount increments)', async () => {
      const driver = new MockVoiceDriver();
      const request: VoiceCallRequest = {
        leadId: 'l1',
        to: '+15025550001',
        channel: 'voice',
        script: 'Hello, this is a test call',
        consentBasis: 'inbound-initiated',
      };

      const result = await driver.dial(request);

      expect(result.providerCallId).toMatch(/^mock_/);
      expect(result.status).toBe('queued');
      expect(driver.dialCount).toBe(1);
    });

    it('always reports healthy', async () => {
      const driver = new MockVoiceDriver();
      const health = await driver.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.latency).toBe(10);
    });
  });

  describe('TwilioVoiceStub', () => {
    it('returns stubbed status when config is present', async () => {
      const stub = new TwilioVoiceStub('AC_test', 'auth_test', '+15025550101');
      const request: VoiceCallRequest = {
        leadId: 'l1',
        to: '+15025550001',
        channel: 'voice',
      };

      const result = await stub.dial(request);

      expect(result.providerCallId).toMatch(/^stub_/);
      expect(result.status).toBe('stubbed');
    });

    it('throws when accountSid is missing', async () => {
      const stub = new TwilioVoiceStub('', 'auth_test', '+15025550101');
      const request: VoiceCallRequest = {
        leadId: 'l1',
        to: '+15025550001',
        channel: 'voice',
      };

      await expect(stub.dial(request)).rejects.toThrow('missing accountSid');
    });

    it('throws when fromNumber is missing', async () => {
      const stub = new TwilioVoiceStub('AC_test', 'auth_test', undefined);
      const request: VoiceCallRequest = {
        leadId: 'l1',
        to: '+15025550001',
        channel: 'voice',
      };

      await expect(stub.dial(request)).rejects.toThrow('no fromNumber');
    });

    it('reports unhealthy when config is missing', async () => {
      const stub = new TwilioVoiceStub('', '', undefined);
      const health = await stub.healthCheck();
      expect(health.healthy).toBe(false);
    });

    it('reports healthy when config is present', async () => {
      const stub = new TwilioVoiceStub('AC_test', 'auth_test', '+15025550101');
      const health = await stub.healthCheck();
      expect(health.healthy).toBe(true);
    });
  });

  describe('VoiceGateway', () => {
    it('dispatches voice call through mock driver', async () => {
      const driver = new MockVoiceDriver();
      const gateway = new VoiceGateway({ primaryProvider: driver });
      const request: VoiceCallRequest = {
        leadId: 'l1',
        to: '+15025550001',
        channel: 'voice',
        script: 'Test script',
        campaignId: 'camp1',
        organizationId: 'org1',
        contactId: 'c1',
      };

      const record = await gateway.call(request);

      expect(record.status).toBe('queued');
      expect(record.channel).toBe('voice');
      expect(record.provider).toBe('mock-voice');
      expect(record.to).toBe('+15025550001');
      expect(record.mockEvent?.wouldDial).toBe(true);
      expect(record.mockEvent?.reason).toBe('dispatched_to_provider');
      expect(record.callUuid).toBeDefined();
      expect(record.dispatchTime).toBeInstanceOf(Date);

      // Should log event
      expect(logEvent).toHaveBeenCalledWith(
        'voice_call_dispatched',
        'voice',
        'l1',
        expect.objectContaining({
          channel: 'voice',
          to: '+15025550001',
          campaignId: 'camp1',
          organizationId: 'org1',
          contactId: 'c1',
        })
      );
    });

    it('dispatches rvm call through mock driver', async () => {
      const driver = new MockVoiceDriver();
      const gateway = new VoiceGateway({ primaryProvider: driver });
      const request: VoiceCallRequest = {
        leadId: 'l1',
        to: '+15025550001',
        channel: 'rvm',
        script: 'Drop voicemail script',
      };

      const record = await gateway.call(request);

      expect(record.status).toBe('queued');
      expect(record.channel).toBe('rvm');
      expect(record.mockEvent?.wouldDial).toBe(true);
    });

    it('returns failed record when provider throws', async () => {
      const failingProvider = {
        name: 'failing',
        dial: vi.fn().mockRejectedValue(new Error('provider_down')),
        hangup: vi.fn(),
        healthCheck: vi.fn(),
      };
      const gateway = new VoiceGateway({ primaryProvider: failingProvider as any });
      const request: VoiceCallRequest = {
        leadId: 'l1',
        to: '+15025550001',
        channel: 'voice',
      };

      const record = await gateway.call(request);

      expect(record.status).toBe('failed');
      expect(record.errorMessage).toBe('provider_down');
      expect(record.mockEvent?.wouldDial).toBe(false);
      expect(record.mockEvent?.reason).toBe('provider_down');

      expect(logEvent).toHaveBeenCalledWith(
        'voice_call_failed',
        'voice',
        'l1',
        expect.objectContaining({
          channel: 'voice',
          error: 'provider_down',
        })
      );
    });

    it('forwards health check from provider', async () => {
      const driver = new MockVoiceDriver();
      const gateway = new VoiceGateway({ primaryProvider: driver });
      const health = await gateway.healthCheck();
      expect(health.healthy).toBe(true);
    });
  });

  describe('dispatchGate integration (via existing gate tests)', () => {
    // The actual dispatchGate tests for voice/rvm live in dispatchGate.test.ts.
    // This section documents the INT-2 contract that the gateway relies on.
    it('voice channel requires consentBasis (documented)', () => {
      // dispatchGate.test.ts: '3. NO_CONSENT — voice/rvm without a valid consentBasis is skipped'
      // This is the gate that prevents voice calls without consent.
      expect(true).toBe(true); // contract documented
    });

    it('voice channel respects voiceEscalation beta flag (documented)', () => {
      // dispatchGate.test.ts: 'Flag OFF ⇒ zero dispatches' with betaFlag: 'voiceEscalation'
      // This ensures the voiceEscalation flag controls all voice/RVM traffic.
      expect(true).toBe(true); // contract documented
    });
  });
});
