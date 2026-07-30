/**
 * MockSmsProvider + delivery-callback simulator (Gap G-2).
 *
 * Proves the zero-cost loop runs through the REAL pieces, no bypass:
 *  1. send() returns a Twilio-shaped SID (SM + 32 hex) and logs an event
 *  2. the simulated callbacks are signed with the mock token and ACCEPTED by the
 *     REAL /api/sms/status route (signature verification runs), advancing a
 *     seeded message_events row queued→…→delivered
 *  3. a bad token is rejected by the same real route (403)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
// No Twilio creds → mock mode; the status route uses the mock token.
vi.mock('@/app/api/utils/twilio-adapter', () => ({ getTwilioConfig: vi.fn(() => null) }));

import { MockSmsProvider, buildMockStatusCallback, simulateDeliveryProgression } from './mock-provider';
import { POST as statusPOST } from '@/app/api/sms/status/route';

const CALLBACK_URL = 'https://mock.example/api/sms/status';

beforeAll(() => {
  process.env.SMS_MODE = 'mock';
  process.env.MOCK_TWILIO_AUTH_TOKEN = 'mock-token-unit';
  process.env.TWILIO_STATUS_CALLBACK_URL = CALLBACK_URL;
});
afterAll(() => {
  // SMS_MODE affects routing globally — don't leak it into other test files.
  delete process.env.SMS_MODE;
  delete process.env.MOCK_TWILIO_AUTH_TOKEN;
  delete process.env.TWILIO_STATUS_CALLBACK_URL;
});
beforeEach(() => {
  mockSql.mockClear();
  mockSql.mockResolvedValue([]);
});

describe('MockSmsProvider', () => {
  it('returns a Twilio-shaped SID and reports healthy', async () => {
    const p = new MockSmsProvider();
    const sid = await p.send('+15551230000', 'hello', 'uuid-1');
    expect(sid).toMatch(/^SM[0-9a-f]{32}$/);
    expect(await p.isHealthy()).toBe(true);
  });
});

describe('simulated delivery callbacks hit the real /api/sms/status route', () => {
  it('advances a seeded message_events row to delivered via a valid signature', async () => {
    // Every callback: SELECT current row, then UPDATE. Seed 'dispatched' first.
    mockSql.mockResolvedValue([{ id: 'evt-1', status: 'dispatched' }]);
    const captured: any[] = [];
    const deliver = async (req: any) => {
      const res = await statusPOST(
        new Request(CALLBACK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': req.signature },
          body: new URLSearchParams(req.params).toString(),
        })
      );
      captured.push({ status: res.status, body: await res.json() });
    };
    await simulateDeliveryProgression({ sid: 'SMabc', to: '+15551230000', statuses: ['sent', 'delivered'], deliver });

    expect(captured.every((c) => c.status === 200)).toBe(true);
    expect(captured[captured.length - 1].body).toMatchObject({ received: true, applied: true, status: 'delivered' });
  });

  it('rejects a forged signature at the real route (403)', async () => {
    const cb = buildMockStatusCallback({ sid: 'SMabc', to: '+15551230000', status: 'delivered' });
    const direct = await statusPOST(
      new Request(CALLBACK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'forged' },
        body: new URLSearchParams(cb.params).toString(),
      })
    );
    expect(direct.status).toBe(403);
  });
});
