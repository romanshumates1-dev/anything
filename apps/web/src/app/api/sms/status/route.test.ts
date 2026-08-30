/**
 * Twilio delivery-status callback receiver tests (BREAKAGE_TABLE #33 — this
 * route did not exist at all; message_events could never advance past its
 * dispatch-time status).
 *
 * Proves:
 *  1. Valid signature + known MessageSid -> message_events row updated, 200 TwiML
 *  2. Invalid signature -> 403, no DB write
 *  3. Valid signature but unmatched MessageSid -> still 200 (ack, no retry storm)
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import crypto from 'node:crypto';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('../../utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const AUTH_TOKEN = 'test-auth-token-123';
vi.mock('../../utils/twilio-adapter', () => ({
  getTwilioConfig: vi.fn(() => ({
    accountSid: 'ACtest',
    authToken: AUTH_TOKEN,
    messagingServiceSid: 'MGtest',
    ownerNumber: '+15025241638',
  })),
}));

import { POST } from './route';

const PUBLIC_URL = 'https://test.ngrok.io/api/sms/status';

beforeAll(() => {
  process.env.PUBLIC_WEBHOOK_URL = 'https://test.ngrok.io';
});

function signParams(params: Record<string, string>, url: string, authToken: string): string {
  const sorted = Object.keys(params)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});
  const data = Object.entries(sorted).map(([k, v]) => `${k}${v}`).join('');
  return crypto.createHmac('sha1', authToken).update(`${url}${data}`).digest('base64');
}

function formReq(params: Record<string, string>, signature: string) {
  const body = new URLSearchParams(params).toString();
  return new Request('http://localhost:4000/api/sms/status', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-twilio-signature': signature,
    },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/sms/status', () => {
  it('valid signature + known MessageSid updates message_events and acks with TwiML', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'evt-1' }]); // UPDATE ... RETURNING id

    const params = { MessageSid: 'SM123', MessageStatus: 'delivered' };
    const sig = signParams(params, PUBLIC_URL, AUTH_TOKEN);

    const res = await POST(formReq(params, sig));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<Response/>');

    // The UPDATE query bound provider_message_id and the mapped status.
    const call = mockSql.mock.calls[0];
    const query = call[0].join('?');
    expect(query).toContain('UPDATE message_events');
    expect(call).toContain('SM123');
    expect(call).toContain('delivered');
  });

  it('invalid signature -> 403, no DB write', async () => {
    const params = { MessageSid: 'SM123', MessageStatus: 'delivered' };
    const res = await POST(formReq(params, 'bogus-signature'));
    expect(res.status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('valid signature but unmatched MessageSid still acks 200 (no retry storm)', async () => {
    mockSql.mockResolvedValueOnce([]); // UPDATE matches zero rows

    const params = { MessageSid: 'SM_UNKNOWN', MessageStatus: 'failed' };
    const sig = signParams(params, PUBLIC_URL, AUTH_TOKEN);

    const res = await POST(formReq(params, sig));
    expect(res.status).toBe(200);
  });

  it('maps Twilio MessageStatus vocabulary correctly (undelivered stays undelivered)', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'evt-2' }]);
    const params = { MessageSid: 'SM456', MessageStatus: 'undelivered', ErrorCode: '30003' };
    const sig = signParams(params, PUBLIC_URL, AUTH_TOKEN);

    await POST(formReq(params, sig));
    const call = mockSql.mock.calls[0];
    expect(call).toContain('undelivered');
  });
});
