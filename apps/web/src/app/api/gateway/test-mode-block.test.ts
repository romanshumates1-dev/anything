/**
 * Item 6a — test-mode allowlist hard-abort at the gateway (behavioral).
 *
 * The allowlist enforcement lives in SMSGateway.send() (last hop before
 * dispatch), NOT in the conversations/message route. This asserts that when a
 * campaign is in test_mode and the recipient is NOT a verified test number, the
 * gateway blocks the send (status 'failed', BLOCKED_TEST_MODE) and records a
 * BLOCKED_TEST_MODE message_events row — and that a recipient ON the allowlist
 * is allowed through to a provider.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

import { SMSGateway } from './sms-gateway';
import { ISMSProvider, DeliveryStatus, ProviderNormalizedEvent } from './providers';

class MockProvider implements ISMSProvider {
  name = 'primary';
  async isHealthy() { return true; }
  async send(to: string, text: string, uuid: string) { return `primary_${uuid.slice(0, 8)}`; }
  async getDeliveryStatus(_id: string): Promise<DeliveryStatus> { return 'sent'; }
  validateWebhook(body: any) { return !!body?.messageId; }
  normalizeWebhookEvent(body: any): ProviderNormalizedEvent | null {
    return body?.messageId ? { messageId: body.messageId, status: 'delivered', timestamp: new Date() } : null;
  }
  async healthCheck() { return { healthy: true, latency: 1 }; }
}

function makeGateway() {
  // compliance disabled so we isolate the test-mode gate; idempotency disabled
  // so repeated uuids don't hit the in-memory cache across cases.
  return new SMSGateway({ primaryProvider: new MockProvider(), complianceCheckEnabled: false, idempotencyEnabled: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue([]);
});

describe('Item 6a — gateway test-mode allowlist', () => {
  it('BLOCKS a non-allowlisted recipient in a test_mode campaign', async () => {
    mockSql
      .mockResolvedValueOnce([{ test_mode: true }]) // campaign lookup
      .mockResolvedValueOnce([]); // allowlist lookup -> empty (not verified)

    const result = await makeGateway().send({
      leadId: 1,
      to: '+15550009999',
      text: 'hi',
      campaignId: 'camp-1',
      organizationId: 'org-1',
      contactId: 'contact-1',
    });

    expect(result.status).toBe('failed');
    expect(result.provider).toBe('gateway');
    expect(result.errorMessage).toContain('BLOCKED_TEST_MODE');

    // a BLOCKED_TEST_MODE message_events row was recorded (status is a SQL
    // string literal in the template, so assert on the query text)
    const blockedInsert = mockSql.mock.calls.some(
      (c: any) => Array.isArray(c[0]) &&
        c[0].join('?').includes('INSERT INTO message_events') &&
        c[0].join('?').includes('BLOCKED_TEST_MODE')
    );
    expect(blockedInsert).toBe(true);
  });

  it('ALLOWS a verified allowlisted recipient through to a provider', async () => {
    mockSql
      .mockResolvedValueOnce([{ test_mode: true }]) // campaign lookup
      .mockResolvedValueOnce([{ id: 'allow-1' }]); // allowlist lookup -> verified

    const result = await makeGateway().send({
      leadId: 2,
      to: '+15551234567',
      text: 'hi',
      campaignId: 'camp-1',
      organizationId: 'org-1',
      contactId: 'contact-2',
    });

    expect(result.provider).not.toBe('gateway'); // not blocked by the gateway
    expect(result.errorMessage ?? '').not.toContain('BLOCKED_TEST_MODE');
    expect(result.status).toBe('dispatched');
  });

  it('does NOT gate when the campaign is not in test_mode', async () => {
    mockSql.mockResolvedValueOnce([{ test_mode: false }]); // campaign lookup

    const result = await makeGateway().send({
      leadId: 3,
      to: '+15550001111',
      text: 'hi',
      campaignId: 'camp-2',
      organizationId: 'org-1',
      contactId: 'contact-3',
    });

    expect(result.provider).not.toBe('gateway');
    expect(result.status).toBe('dispatched');
  });
});
