/**
 * Phase T-safety — demo-mode allowlist gate. The safety property: in
 * twilio-demo mode a recipient NOT in the verified-numbers allowlist is
 * SKIPPED before any provider/SDK is touched. Cold lists physically cannot
 * receive demo traffic. Verified pre-A2P (no real send).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({ mockSql: vi.fn(async () => [] as any) }));
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
const { isBetaFlagOn } = vi.hoisted(() => ({ isBetaFlagOn: vi.fn(async () => true) }));
vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn }));
const { getTwilioConfig } = vi.hoisted(() => ({ getTwilioConfig: vi.fn(() => ({ accountSid: 'AC', authToken: 't' })) }));
vi.mock('@/app/api/utils/twilio-adapter', () => ({ getTwilioConfig }));
const { isVerifiedDemoRecipient } = vi.hoisted(() => ({ isVerifiedDemoRecipient: vi.fn(async () => false) }));
vi.mock('@/app/api/utils/smsMode', () => ({ isVerifiedDemoRecipient, resolveSmsMode: vi.fn() }));

import { dispatchGate } from '../dispatchGate';

const noon = new Date('2026-07-15T16:00:00Z'); // legal hour

beforeEach(() => {
  mockSql.mockReset();
  mockSql.mockResolvedValue([]); // not suppressed
  isBetaFlagOn.mockReset();
  isBetaFlagOn.mockResolvedValue(true); // twilioDemo ON (+ any req.betaFlag on)
  getTwilioConfig.mockReturnValue({ accountSid: 'AC', authToken: 't' });
  isVerifiedDemoRecipient.mockReset();
});

describe('demo allowlist gate', () => {
  it('demo ON + recipient NOT verified → DEMO_NOT_VERIFIED (skipped)', async () => {
    isVerifiedDemoRecipient.mockResolvedValue(false);
    const d = await dispatchGate({ phone: '+15025550123', channel: 'sms', now: noon });
    expect(d.allow).toBe(false);
    expect((d as any).code).toBe('DEMO_NOT_VERIFIED');
    expect((d as any).reason).toMatch(/demo mode, recipient not verified/i);
  });

  it('demo ON + recipient verified → allowed', async () => {
    isVerifiedDemoRecipient.mockResolvedValue(true);
    const d = await dispatchGate({ phone: '+15025550123', channel: 'sms', now: noon });
    expect(d.allow).toBe(true);
  });

  it('demo OFF → allowlist not consulted (any recipient passes)', async () => {
    isBetaFlagOn.mockImplementation(async (f: string) => f !== 'twilioDemo'); // demo off
    const d = await dispatchGate({ phone: '+15025550123', channel: 'sms', now: noon });
    expect(d.allow).toBe(true);
    expect(isVerifiedDemoRecipient).not.toHaveBeenCalled();
  });

  it('no Twilio config (mock mode) → allowlist not consulted', async () => {
    getTwilioConfig.mockReturnValue(null);
    const d = await dispatchGate({ phone: '+15025550123', channel: 'sms', now: noon });
    expect(d.allow).toBe(true);
    expect(isVerifiedDemoRecipient).not.toHaveBeenCalled();
  });

  it('DNC still outranks the demo gate (opted-out unverified → DNC, not DEMO_NOT_VERIFIED)', async () => {
    mockSql.mockResolvedValue([{ 1: 1 }]); // suppressed
    isVerifiedDemoRecipient.mockResolvedValue(false);
    const d = await dispatchGate({ phone: '+15025550123', channel: 'sms', now: noon });
    expect((d as any).code).toBe('DNC');
  });

  it('voice/rvm are not demo-gated (SMS-only allowlist)', async () => {
    isVerifiedDemoRecipient.mockResolvedValue(false);
    const d = await dispatchGate({ phone: '+15025550123', channel: 'voice', consentBasis: 'manual-list-attested', now: noon });
    expect((d as any).code).not.toBe('DEMO_NOT_VERIFIED');
  });
});

describe('SDK boundary: a skipped demo send touches ZERO Twilio client calls', () => {
  it('gateway send with a DEMO_NOT_VERIFIED gate never calls the provider SDK', async () => {
    // The gate returns the denial; the gateway must short-circuit before any
    // provider.send / messages.create. Proven here by a spy provider.
    const { SMSGateway } = await import('../../gateway/sms-gateway');
    let sdkCalls = 0;
    const spyProvider: any = {
      name: 'twilio',
      isHealthy: async () => true,
      send: async () => { sdkCalls++; return 'sid'; }, // stands in for messages.create
      getDeliveryStatus: async () => 'sent',
      validateWebhook: () => true,
      normalizeWebhookEvent: () => null,
      healthCheck: async () => ({ healthy: true, latency: 1 }),
    };
    isVerifiedDemoRecipient.mockResolvedValue(false); // unverified → gate denies

    const gw = new SMSGateway({ primaryProvider: spyProvider, idempotencyEnabled: false });
    const r = await gw.send({ leadId: 1, to: '+15025550123', text: 'demo hello' });

    expect(sdkCalls).toBe(0); // ZERO SDK calls on the skipped send
    expect(r.gateCode).toBe('DEMO_NOT_VERIFIED');
  });
});
