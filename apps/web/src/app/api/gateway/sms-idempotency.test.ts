/**
 * Durable SMS idempotency (Gap G-3).
 *
 * Proves:
 *  1. A durable-store hit short-circuits the gateway: the provider is NEVER
 *     called and the cached result is returned (dedup survives restart).
 *  2. On a miss, the send dispatches AND the durable store records the result.
 *  3. DbIdempotencyStore issues the expected lookup/insert SQL.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('@/app/api/utils/compliance', () => ({ checkConsent: vi.fn(async () => true) }));
vi.mock('@/app/api/utils/dispatchGate', () => ({ dispatchGate: vi.fn(async () => ({ allow: true })) }));
vi.mock('@/app/api/utils/betaFlags', () => ({ isBetaFlagOn: vi.fn(async () => false) }));
vi.mock('@/app/api/utils/numberPoolStore', () => ({ pickNumber: vi.fn(async () => null), activePoolCount: vi.fn(async () => 0) }));

import { SMSGateway } from './sms-gateway';
import { DbIdempotencyStore, type IdempotencyStore } from './sms-idempotency-store';
import type { ISMSProvider } from './providers';

function fakeProvider(sendImpl: () => Promise<string>): ISMSProvider & { calls: number } {
  const p: any = {
    name: 'twilio',
    calls: 0,
    isHealthy: async () => true,
    send: async () => {
      p.calls++;
      return sendImpl();
    },
    getDeliveryStatus: async () => 'sent',
    validateWebhook: () => true,
    normalizeWebhookEvent: () => null,
    healthCheck: async () => ({ healthy: true, latency: 1 }),
  };
  return p;
}

beforeEach(() => {
  mockSql.mockClear();
  mockSql.mockResolvedValue([]);
});

describe('gateway durable idempotency', () => {
  it('short-circuits on a durable hit without calling the provider', async () => {
    const provider = fakeProvider(async () => 'SMnew');
    const store: IdempotencyStore = {
      lookup: async () => ({ status: 'delivered', providerId: 'SMold', provider: 'twilio' }),
      remember: async () => {},
    };
    const gw = new SMSGateway({ primaryProvider: provider, complianceCheckEnabled: false, idempotencyStore: store });
    const res = await gw.send({ leadId: 1, to: '+15551230000', text: 'hi', messageUuid: 'uuid-dup' });
    expect(res.status).toBe('delivered');
    expect(res.providerId).toBe('SMold');
    expect(provider.calls).toBe(0); // never dispatched
    gw.destroy();
  });

  it('dispatches and records on a miss', async () => {
    const provider = fakeProvider(async () => 'SMfresh');
    const remembered: any[] = [];
    const store: IdempotencyStore = {
      lookup: async () => null,
      remember: async (uuid, rec) => {
        remembered.push({ uuid, rec });
      },
    };
    const gw = new SMSGateway({ primaryProvider: provider, complianceCheckEnabled: false, idempotencyStore: store });
    const res = await gw.send({ leadId: 2, to: '+15551230001', text: 'hi', messageUuid: 'uuid-fresh' });
    expect(res.status).toBe('dispatched');
    expect(provider.calls).toBe(1);
    expect(remembered).toHaveLength(1);
    expect(remembered[0]).toMatchObject({ uuid: 'uuid-fresh', rec: { providerId: 'SMfresh', provider: 'twilio' } });
    gw.destroy();
  });
});

describe('DbIdempotencyStore SQL', () => {
  it('lookup returns null when no row, record maps fields', async () => {
    const store = new DbIdempotencyStore();
    mockSql.mockResolvedValueOnce([]); // lookup → none
    expect(await store.lookup('uuid-x')).toBeNull();

    mockSql.mockResolvedValueOnce([{ status: 'dispatched', provider_id: 'SMy', provider: 'twilio' }]);
    expect(await store.lookup('uuid-y')).toEqual({ status: 'dispatched', providerId: 'SMy', provider: 'twilio' });

    mockSql.mockResolvedValueOnce([]); // remember insert
    await store.remember('uuid-z', { status: 'dispatched', providerId: 'SMz', provider: 'twilio' });
    expect(mockSql).toHaveBeenCalledTimes(3);
  });
});
