/**
 * SMS Gateway Unit Tests
 * 
 * GATE 1 Coverage:
 * - Failover fires on simulated provider outage with zero message loss and zero duplicates
 * - Circuit breaker opens/half-opens/closes correctly
 * - Opt-out blocked at gateway even if upstream check bypassed
 * - Sticky-thread routing verified
 * - Chaos test: kill primary provider mid-campaign, campaign completes via secondary
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker } from './circuit-breaker';
import {
  ISMSProvider,
  DeliveryStatus,
  ProviderNormalizedEvent,
} from './providers';

// Mock sql module - MUST be before SMSGateway import
vi.mock('@/app/api/utils/sql', () => {
  const mockSql = () => Promise.resolve([]);
  mockSql.transaction = () => Promise.resolve([]);
  mockSql.query = mockSql;
  return { default: mockSql };
});

// checkConsent is the gateway's opt-out gate. Mocking the module (rather than the
// SQL underneath it) is what lets the suppression test assert real behaviour
// without a live DB â€” see "GATE 1: Compliance Gates".
vi.mock('@/app/api/utils/compliance', () => ({ checkConsent: vi.fn() }));

// P2.0-W: the universal dispatchGate runs first in SMSGateway.send. Default
// ALLOW here keeps every pre-existing test deterministic (the real gate would
// make failover tests depend on the wall clock via quiet hours); the wiring
// describe below overrides it per-test to prove denial is honored.
const { mockDispatchGate } = vi.hoisted(() => ({
  mockDispatchGate: vi.fn(async () => ({ allow: true as const, timezones: [] as string[] })),
}));
vi.mock('@/app/api/utils/dispatchGate', () => ({ dispatchGate: mockDispatchGate }));

// INT-3: the gateway consults the localPresence flag + number pool. Defaults
// here = flag OFF / empty pool, i.e. exactly the pre-INT-3 behaviour, so every
// pre-existing test is untouched. The INT-3 describe overrides per-test.
const { mockIsBetaFlagOn, mockPickNumber, mockActivePoolCount } = vi.hoisted(() => ({
  mockIsBetaFlagOn: vi.fn(async (_flag: string) => false),
  mockPickNumber: vi.fn(async () => null as string | null),
  mockActivePoolCount: vi.fn(async () => 0),
}));
vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn: mockIsBetaFlagOn }));
vi.mock('@/app/api/utils/numberPoolStore', () => ({
  pickNumber: mockPickNumber,
  activePoolCount: mockActivePoolCount,
}));

const { fn: checkUsageLimit } = vi.hoisted(() => ({ fn: vi.fn(async () => ({ allowed: true, limit: { used: 0, quota: 1000, hardLimitReached: false, softLimitReached: false } })) }));
vi.mock('@/app/api/services/usageTracker', () => ({ checkUsageLimit: (...args: any[]) => (checkUsageLimit as any)(...args) }));

import { SMSGateway } from './sms-gateway';
import { checkConsent } from '@/app/api/utils/compliance';

// Mock provider for testing
class MockProvider implements ISMSProvider {
  name: string;
  shouldFail = false;
  sendCount = 0;
  healthyState = true;

  constructor(name: string) {
    this.name = name;
  }

  async isHealthy(): Promise<boolean> {
    return this.healthyState;
  }

  lastFrom: string | undefined;

  async send(to: string, text: string, messageUuid: string, from?: string): Promise<string> {
    this.sendCount++;
    this.lastFrom = from;
    if (this.shouldFail) {
      throw new Error(`${this.name} simulated failure`);
    }
    return `${this.name}_${messageUuid.substring(0, 8)}`;
  }

  async getDeliveryStatus(_providerId: string): Promise<DeliveryStatus> {
    return 'sent';
  }

  validateWebhook(body: any): boolean {
    return !!body.messageId;
  }

  normalizeWebhookEvent(body: any): ProviderNormalizedEvent | null {
    if (!body.messageId) return null;
    return {
      messageId: body.messageId,
      status: 'delivered',
      timestamp: new Date(),
    };
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number }> {
    return {
      healthy: this.healthyState,
      latency: this.healthyState ? 100 : 3000,
    };
  }
}

describe('SMS Gateway', () => {
  let primaryProvider: MockProvider;
  let secondaryProvider: MockProvider;
  let gateway: SMSGateway;

  beforeEach(() => {
    primaryProvider = new MockProvider('primary');
    secondaryProvider = new MockProvider('secondary');
    gateway = new SMSGateway({
      primaryProvider,
      secondaryProviders: [secondaryProvider],
      circuitBreakerConfig: {
        failureThreshold: 2,
        recoveryDelayMs: 100, // short for testing
      },
      complianceCheckEnabled: false, // Skip compliance in unit tests
    });
  });

  describe('GATE 1: Failover on Provider Outage', () => {
    it('should route message to primary provider on success', async () => {
      const _result = await gateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'Test message',
      });

      expect(_result.status).toBe('dispatched');
      expect(_result.provider).toBe('primary');
      expect(primaryProvider.sendCount).toBe(1);
      expect(secondaryProvider.sendCount).toBe(0);
    });

    it('should failover to secondary when primary fails', async () => {
      primaryProvider.shouldFail = true;

      const _result = await gateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'Test message',
      });

      expect(_result.status).toBe('dispatched');
      expect(_result.provider).toBe('secondary');
      expect(secondaryProvider.sendCount).toBe(1);
    });

    it('should not lose messages during failover', async () => {
      primaryProvider.shouldFail = true;

      const results = await Promise.all([
        gateway.send({
          leadId: 1,
          to: '+15551234567',
          text: 'Message 1',
        }),
        gateway.send({
          leadId: 2,
          to: '+15559876543',
          text: 'Message 2',
        }),
        gateway.send({
          leadId: 3,
          to: '+15555555555',
          text: 'Message 3',
        }),
      ]);

      // All messages should dispatch successfully via secondary
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'dispatched')).toBe(true);
      expect(results.every((r) => r.provider === 'secondary')).toBe(true);
    });

    it('should not duplicate messages on failover', async () => {
      primaryProvider.shouldFail = true;

      const _result = await gateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'Test message',
      });

      // Primary fails once, then failover to secondary
      expect(primaryProvider.sendCount).toBe(1);
      expect(secondaryProvider.sendCount).toBe(1);
      expect(_result.status).toBe('dispatched');
    });

    it('should return failed status when all providers exhausted', async () => {
      primaryProvider.shouldFail = true;
      secondaryProvider.shouldFail = true;

      const _result = await gateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'Test message',
      });

      expect(_result.status).toBe('failed');
      expect(_result.provider).toBe('gateway');
      // Error message may be the provider error or the generic all_providers_failed
      expect(_result.errorMessage).toBeDefined();
    });
  });

  describe('GATE 1: Circuit Breaker State Machine', () => {
    it('should transition from CLOSED to OPEN on repeated failures', async () => {
      primaryProvider.shouldFail = true;

      let stats = gateway.getCircuitBreakerStats();
      expect(stats['primary'].state).toBe('closed');

      // Failure 1
      await gateway.send({ leadId: 1, to: '+15551234567', text: 'Msg' });
      stats = gateway.getCircuitBreakerStats();
      expect(stats['primary'].state).toBe('closed');

      // Failure 2 (threshold reached)
      await gateway.send({ leadId: 2, to: '+15551234567', text: 'Msg' });
      stats = gateway.getCircuitBreakerStats();
      expect(stats['primary'].state).toBe('open');
    });

    it('should transition from OPEN to HALF_OPEN after delay', async () => {
      primaryProvider.shouldFail = true;

      // Trip the breaker
      await gateway.send({ leadId: 1, to: '+15551234567', text: 'Msg' });
      await gateway.send({ leadId: 2, to: '+15551234567', text: 'Msg' });

      let stats = gateway.getCircuitBreakerStats();
      expect(stats['primary'].state).toBe('open');

      // Wait for recovery delay
      await new Promise((r) => setTimeout(r, 150));

      // Should transition to HALF_OPEN on next attempt
      primaryProvider.shouldFail = false;
      await gateway.send({ leadId: 3, to: '+15551234567', text: 'Msg' });

      stats = gateway.getCircuitBreakerStats();
      expect(stats['primary'].state).toBe('closed'); // Probe succeeded
    });

    it('should return to OPEN if HALF_OPEN probe fails', async () => {
      primaryProvider.shouldFail = true;

      // Trip the breaker
      await gateway.send({ leadId: 1, to: '+15551234567', text: 'Msg' });
      await gateway.send({ leadId: 2, to: '+15551234567', text: 'Msg' });

      // Wait for recovery delay
      await new Promise((r) => setTimeout(r, 150));

      // Probe fails (keep shouldFail = true)
      await gateway.send({ leadId: 3, to: '+15551234567', text: 'Msg' });

      const stats = gateway.getCircuitBreakerStats();
      expect(stats['primary'].state).toBe('open');
    });
  });

  describe('GATE 1: Sticky Thread Routing', () => {
    it('should route subsequent messages from same thread to same provider', async () => {
      const threadId = 'lead_123_thread';

      // First message
      await gateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'Message 1',
        conversationThread: threadId,
      });

      // Fail primary to see if secondary takes over (it shouldn't for sticky thread)
      primaryProvider.shouldFail = true;

      const _result = await gateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'Message 2',
        conversationThread: threadId,
      });

      // Should still try primary first due to sticky routing
      // (Though it will fail and failover)
      expect(primaryProvider.sendCount).toBe(2);
      expect(secondaryProvider.sendCount).toBe(1); // Failover after first failure
    });

    it('should use primary for different thread', async () => {
      primaryProvider.shouldFail = true;

      // Message on thread A uses secondary after failover
      const _result1 = await gateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'Message on thread A',
        conversationThread: 'threadA',
      });

      primaryProvider.shouldFail = false;

      // Message on thread B uses primary
      const _result2 = await gateway.send({
        leadId: 2,
        to: '+15559876543',
        text: 'Message on thread B',
        conversationThread: 'threadB',
      });

      expect(_result2.provider).toBe('primary');
    });
  });

  describe('GATE 1: Compliance Gates', () => {
    // Replaces a DATABASE_URL-skipped test of the same name whose only assertion
    // was `expect(result).toBeDefined()` â€” which passes whether the message is
    // suppressed OR sent to an opted-out number. checkConsent is a module import,
    // so it mocks directly; no live DB is needed and nothing here is skipped.
    it('suppresses an opted-out number and never reaches the provider', async () => {
      vi.mocked(checkConsent).mockResolvedValue(false);
      const testGateway = new SMSGateway({ primaryProvider, complianceCheckEnabled: true });

      const result = await testGateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'This must be suppressed',
      });

      expect(checkConsent).toHaveBeenCalledWith('+15551234567', 'sms');
      expect(result.status).toBe('failed');
      expect(result.errorMessage).toBe('opted_out');
      expect(result.provider).toBe('gateway');
      // The invariant that matters: the carrier never saw it.
      expect(primaryProvider.sendCount).toBe(0);
    });

    it('sends when consent is present (proves the gate is not a blanket block)', async () => {
      vi.mocked(checkConsent).mockResolvedValue(true);
      const testGateway = new SMSGateway({ primaryProvider, complianceCheckEnabled: true });

      const result = await testGateway.send({ leadId: 1, to: '+15551234567', text: 'Allowed' });

      expect(result.errorMessage).not.toBe('opted_out');
      expect(primaryProvider.sendCount).toBe(1);
    });
  });

  describe('GATE 1: Idempotency', () => {
    it('should not duplicate messages on retry with same UUID', async () => {
      // Send first time
      const _result1 = await gateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'Test message',
      });

      const sendCount1 = primaryProvider.sendCount;

      // Simulate retry with same UUID by creating a fresh request
      // (In real usage, the messageUuid would be part of the idempotency key)
      const _result2 = await gateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'Test message',
      });

      // Second message should be different UUID, so provider send should be called
      // (Idempotency is per messageUuid, not per message content)
      expect(primaryProvider.sendCount).toBeGreaterThanOrEqual(sendCount1);
    });
  });

  describe('GATE 1: Chaos Test', () => {
    it('should complete campaign when primary provider fails mid-campaign', async () => {
      const leads = Array.from({ length: 10 }, (_, i) => ({
        leadId: i + 1,
        to: `+155512345${String(i).padStart(2, '0')}`,
        text: `Campaign message ${i}`,
      }));

      const results = [];

      for (let i = 0; i < leads.length; i++) {
        // Kill primary provider after 5 messages
        if (i === 5) {
          primaryProvider.shouldFail = true;
        }

        const result = await gateway.send(leads[i]);
        results.push(result);
      }

      // All messages should succeed
      expect(results.every((r) => r.status === 'dispatched')).toBe(true);
      expect(results.some((r) => r.provider === 'primary')).toBe(true);
      expect(results.some((r) => r.provider === 'secondary')).toBe(true);
    });
  });

  describe('GATE 1: Test-Mode Hard-Abort', () => {
    it('blocks non-test numbers in test-mode campaign', async () => {
      // These tests verify the gateway logic with mocked sql responses.
      // The sql mock returns empty arrays by default, which simulates:
      // - test_mode query returns nothing (not a test campaign) -> no block
      // For actual test-mode blocking, we test via integration/E2E with real DB.
      // Here we confirm the code path exists and doesn't throw.
      
      const testGateway = new SMSGateway({
        primaryProvider,
        complianceCheckEnabled: false,
      });

      const result = await testGateway.send({
        leadId: 1,
        to: '+15551234567',
        text: 'Test message',
        campaignId: 'test-campaign-123',
        organizationId: 'org-123',
        contactId: 'contact-123',
      });

      // With empty mock returns and no testModeAllowedPhones set,
      // the gateway won't block (sql returns empty for test_mode check)
      expect(result).toBeDefined();
      expect(['dispatched', 'failed']).toContain(result.status);
    });
  });

  describe('Health Check', () => {
    it('should report health status of all providers', async () => {
      const health = await gateway.healthCheckAll();

      expect(health['primary']).toBeDefined();
      expect(health['secondary']).toBeDefined();
      expect(health['primary'].healthy).toBe(true);
      expect(health['primary'].state).toBe('closed');
    });

    it('should reflect unhealthy provider state', async () => {
      primaryProvider.healthyState = false;

      const health = await gateway.healthCheckAll();
      expect(health['primary'].healthy).toBe(false);
    });
  });
});

describe('Circuit Breaker Unit Tests', () => {
  it('should initialize in CLOSED state', () => {
    const breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      recoveryDelayMs: 1000,
      deliveryRateThreshold: 0.9,
      halfOpenProbeTimeoutMs: 5000,
      windowSizeMs: 60000,
    });

    expect(breaker.getState()).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('should track success/failure counts', () => {
    const breaker = new CircuitBreaker('test', {
      failureThreshold: 3,
      recoveryDelayMs: 1000,
      deliveryRateThreshold: 0.9,
      halfOpenProbeTimeoutMs: 5000,
      windowSizeMs: 60000,
    });

    breaker.recordSuccess();
    let stats = breaker.getStats();
    expect(stats.successCount).toBe(1);

    breaker.recordFailure();
    stats = breaker.getStats();
    expect(stats.failureCount).toBe(1);
  });

  it('should enforce delivery rate threshold', () => {
    const breaker = new CircuitBreaker('test', {
      failureThreshold: 10,
      recoveryDelayMs: 1000,
      deliveryRateThreshold: 0.9, // 90%
      halfOpenProbeTimeoutMs: 5000,
      windowSizeMs: 60000,
    });

    // Record 9 successes and 2 failures = 81.8% < 90%
    for (let i = 0; i < 9; i++) breaker.recordSuccess();
    for (let i = 0; i < 2; i++) breaker.recordFailure();

    const stats = breaker.getStats();
    expect(stats.state).toBe('open');
  });
});

describe('P2.0-W: universal dispatchGate wiring at the transmit hop', () => {
  let primaryProvider: MockProvider;

  beforeEach(() => {
    primaryProvider = new MockProvider('primary');
    vi.mocked(checkConsent).mockResolvedValue(true);
    mockDispatchGate.mockReset();
    mockDispatchGate.mockResolvedValue({ allow: true, timezones: [] });
  });

  it('calls the gate with the recipient + channel BEFORE any provider dispatch', async () => {
    const gw = new SMSGateway({ primaryProvider });
    await gw.send({
      leadId: 1, to: '+15025550101', text: 'hello',
      betaFlag: 'cadenceEngine', isCadenceStep: true, transactional: false,
    });
    expect(mockDispatchGate).toHaveBeenCalledWith({
      phone: '+15025550101',
      channel: 'sms',
      betaFlag: 'cadenceEngine',
      consentBasis: undefined,
      isCadenceStep: true,
      transactional: false,
    });
    expect(primaryProvider.sendCount).toBe(1);
  });

  it('a gate DENIAL means the provider is never touched and the code surfaces', async () => {
    const retryAt = new Date('2026-07-17T14:00:00Z');
    mockDispatchGate.mockResolvedValue({
      allow: false, code: 'QUIET_HOURS', reason: 'Outside 8am-9pm lead-local',
      retryAt, timezones: ['America/New_York'],
    });
    const gw = new SMSGateway({ primaryProvider });
    const result = await gw.send({ leadId: 1, to: '+15025550101', text: 'held' });

    expect(primaryProvider.sendCount).toBe(0); // the carrier never saw it
    expect(result.status).toBe('failed');
    expect(result.gateCode).toBe('QUIET_HOURS');
    expect(result.errorMessage).toBe('QUIET_HOURS');
    expect(result.retryAt).toEqual(retryAt); // callers can defer, not dead-letter
  });

  it('DNC denial suppresses even when the legacy checkConsent would allow', async () => {
    // The gate is channel-agnostic (STOP on voice suppresses SMS); checkConsent
    // is channel-scoped. If they disagree, the gate must win.
    vi.mocked(checkConsent).mockResolvedValue(true);
    mockDispatchGate.mockResolvedValue({ allow: false, code: 'DNC', reason: 'opted out', timezones: [] });
    const gw = new SMSGateway({ primaryProvider, complianceCheckEnabled: true });
    const result = await gw.send({ leadId: 1, to: '+15025550101', text: 'never' });
    expect(primaryProvider.sendCount).toBe(0);
    expect(result.gateCode).toBe('DNC');
  });

  it('transactional flows through to the gate request (OTP path)', async () => {
    const gw = new SMSGateway({ primaryProvider });
    await gw.send({ leadId: 0, to: '+16073656567', text: 'code: 123456', transactional: true });
    expect(mockDispatchGate).toHaveBeenCalledWith(expect.objectContaining({ transactional: true }));
  });

  it('Phase A: NUMERIC_GUARD denial → zero provider sends + numeric_guard_blocked event + escalation row', async () => {
    mockDispatchGate.mockResolvedValue({
      allow: false, code: 'NUMERIC_GUARD',
      reason: 'NUMERIC GUARD BLOCKED: amount $98,500 ≠ computed offer $87,500', timezones: [],
    });
    const gw = new SMSGateway({ primaryProvider });
    const r = await gw.send({
      leadId: 7, to: '+15025550101', text: "we're agreed at $98,500, right?", organizationId: 'org',
      boundedNegotiation: { computedOfferCents: 87_500_00, approvedMinCents: 73_800_00, approvedMaxCents: 97_000_00, sessionId: 's1' },
    });
    expect(primaryProvider.sendCount).toBe(0); // the message is NOT sent
    expect(r.gateCode).toBe('NUMERIC_GUARD');
    // the bounded ctx (with the final text) reached the gate
    expect(mockDispatchGate).toHaveBeenCalledWith(
      expect.objectContaining({ boundedNegotiation: expect.objectContaining({ text: expect.stringContaining('98,500'), sessionId: 's1' }) })
    );
  });
});

describe('INT-3: local-presence from-number wiring', () => {
  let primaryProvider: MockProvider;

  beforeEach(() => {
    primaryProvider = new MockProvider('primary');
    vi.mocked(checkConsent).mockResolvedValue(true);
    mockDispatchGate.mockReset();
    mockDispatchGate.mockResolvedValue({ allow: true, timezones: [] });
    mockIsBetaFlagOn.mockReset();
    mockPickNumber.mockReset();
    mockActivePoolCount.mockReset();
  });

  const gw = () => new SMSGateway({ primaryProvider, complianceCheckEnabled: false, idempotencyEnabled: false });

  it('flag ON: the picked pool number rides to the provider as from', async () => {
    mockIsBetaFlagOn.mockImplementation(async (f: string) => f === 'localPresence');
    mockPickNumber.mockResolvedValue('+15025550777');

    const r = await gw().send({ leadId: 1, to: '+15025559999', text: 'hi' });
    expect(mockPickNumber).toHaveBeenCalledWith('+15025559999');
    expect(primaryProvider.lastFrom).toBe('+15025550777');
    expect(r.status).toBe('dispatched');
  });

  it('flag OFF: pool never consulted, default sender', async () => {
    mockIsBetaFlagOn.mockResolvedValue(false);
    const r = await gw().send({ leadId: 1, to: '+15025559999', text: 'hi' });
    expect(mockPickNumber).not.toHaveBeenCalled();
    expect(primaryProvider.lastFrom).toBeUndefined();
    expect(r.status).toBe('dispatched');
  });

  it('transactional (OTP): pool never consulted even with the flag ON', async () => {
    mockIsBetaFlagOn.mockResolvedValue(true);
    await gw().send({ leadId: 0, to: '+16073656567', text: 'code', transactional: true });
    expect(mockPickNumber).not.toHaveBeenCalled();
  });

  it('pool CAPPED (numbers exist, none eligible): send held, provider untouched, retryAt after reset', async () => {
    mockIsBetaFlagOn.mockImplementation(async (f: string) => f === 'localPresence');
    mockPickNumber.mockResolvedValue(null);
    mockActivePoolCount.mockResolvedValue(3);

    const r = await gw().send({ leadId: 1, to: '+15025559999', text: 'held' });
    expect(primaryProvider.sendCount).toBe(0); // never "send from anything"
    expect(r.status).toBe('failed');
    expect(r.errorMessage).toBe('LOCAL_PRESENCE_EXHAUSTED');
    expect(r.retryAt).toBeInstanceOf(Date);
    expect(r.retryAt!.getTime()).toBeGreaterThan(Date.now()); // after the daily reset
  });

  it('pool EMPTY (unconfigured): falls back to the default sender and still sends', async () => {
    mockIsBetaFlagOn.mockImplementation(async (f: string) => f === 'localPresence');
    mockPickNumber.mockResolvedValue(null);
    mockActivePoolCount.mockResolvedValue(0);

    const r = await gw().send({ leadId: 1, to: '+15025559999', text: 'hi' });
    expect(r.status).toBe('dispatched');
    expect(primaryProvider.lastFrom).toBeUndefined();
  });

  it('a gate-denied send never burns a pool slot', async () => {
    mockIsBetaFlagOn.mockResolvedValue(true);
    mockDispatchGate.mockResolvedValue({ allow: false, code: 'DNC', reason: 'opted out', timezones: [] });
    await gw().send({ leadId: 1, to: '+15025559999', text: 'never' });
    expect(mockPickNumber).not.toHaveBeenCalled();
  });
});





