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

// P2.0-W: VoiceGateway.call now runs the universal dispatchGate at the dial
// hop. Default ALLOW keeps the driver/record tests deterministic; the wiring
// describe below overrides it to prove denial means zero dials.
const { mockVoiceDispatchGate } = vi.hoisted(() => ({
  mockVoiceDispatchGate: vi.fn(async () => ({ allow: true as const, timezones: [] as string[] })),
}));
vi.mock('@/app/api/utils/dispatchGate', () => ({ dispatchGate: mockVoiceDispatchGate }));

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

});

describe('P2.0-W: dispatchGate wiring at the dial hop', () => {
  beforeEach(() => {
    mockVoiceDispatchGate.mockReset();
    mockVoiceDispatchGate.mockResolvedValue({ allow: true, timezones: [] });
  });

  it('calls the gate with channel + consentBasis BEFORE any dial', async () => {
    const driver = new MockVoiceDriver();
    const gw = new VoiceGateway({ primaryProvider: driver });
    await gw.call({ leadId: 1, to: '+15025550101', channel: 'voice', consentBasis: 'manual-list-attested' });
    expect(mockVoiceDispatchGate).toHaveBeenCalledWith({
      phone: '+15025550101', channel: 'voice',
      betaFlag: 'voiceEscalation', consentBasis: 'manual-list-attested',
    });
    expect(driver.dialCount).toBe(1);
  });

  it('gate denial: ZERO dials, gateCode + retryAt surfaced, suppression logged', async () => {
    const retryAt = new Date(Date.now() + 3600_000);
    mockVoiceDispatchGate.mockResolvedValue({ allow: false, code: 'NO_CONSENT', reason: 'no basis', retryAt, timezones: [] });
    const driver = new MockVoiceDriver();
    const gw = new VoiceGateway({ primaryProvider: driver });
    const rec = await gw.call({ leadId: 1, to: '+15025550101', channel: 'rvm' });
    expect(driver.dialCount).toBe(0); // the carrier is never touched
    expect(rec.status).toBe('failed');
    expect(rec.gateCode).toBe('NO_CONSENT');
    expect(rec.retryAt).toEqual(retryAt);
    expect(vi.mocked(logEvent)).toHaveBeenCalledWith('voice_call_suppressed', 'voice', '1', expect.objectContaining({ reason: 'NO_CONSENT' }));
  });
});
