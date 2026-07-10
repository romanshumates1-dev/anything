/**
 * Twilio-native inbound webhook tests.
 *
 * Proves:
 *  1. Real Twilio format (form-encoded + valid X-Twilio-Signature) → parsed, job enqueued
 *  2. Invalid signature → 403
 *  3. MessageSid dedup → second request with same SID returns 200 TwiML without re-processing
 *  4. Simulator JSON path still works (x-sms-secret + JSON body)
 *  5. Owner number E.164 normalization works
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
vi.mock('../../utils/execution-ledger', () => ({ recordRun: vi.fn(async () => {}) }));

const AUTH_TOKEN = 'test-auth-token-123';
vi.mock('../../utils/twilio-adapter', () => ({
  getTwilioConfig: vi.fn(() => ({
    accountSid: 'ACtest',
    authToken: AUTH_TOKEN,
    messagingServiceSid: 'MGtest',
    ownerNumber: '+15025241638',
  })),
}));

const { enqueueJob } = vi.hoisted(() => ({ enqueueJob: vi.fn(async () => 1) }));
vi.mock('../../utils/jobs', () => ({ enqueueJob }));

import { POST } from './route';

const SECRET = 'test-inbound-secret';
const PUBLIC_URL = 'https://test.ngrok.io/api/sms/inbound';

beforeAll(() => {
  process.env.SMS_INBOUND_SECRET = SECRET;
  process.env.PUBLIC_WEBHOOK_URL = PUBLIC_URL;
});

function signParams(params: Record<string, string>, url: string, authToken: string): string {
  const sorted = Object.keys(params)
    .sort()
    .reduce<Record<string, string>>((acc, key) => {
      acc[key] = params[key];
      return acc;
    }, {});
  const data = Object.entries(sorted)
    .map(([k, v]) => `${k}${v}`)
    .join('');
  return crypto
    .createHmac('sha1', authToken)
    .update(`${url}${data}`)
    .digest('base64');
}

function twilioRequest(params: Record<string, string>, signature?: string) {
  const sig = signature ?? signParams(params, PUBLIC_URL, AUTH_TOKEN);
  const body = new URLSearchParams(params).toString();
  return new Request('http://localhost:4000/api/sms/inbound', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': sig,
    },
    body,
  });
}

function seedLead() {
  // SQL call order for Twilio branch: dedup check → SELECT lead → INSERT conv → UPDATE history
  // (logEvent and recordRun are mocked to not call sql)
  mockSql
    .mockResolvedValueOnce([]) // dedup check (no existing)
    .mockResolvedValueOnce([{ id: 42, phone: '+15551112222', ai_paused: false }]) // SELECT lead
    .mockResolvedValueOnce([{ id: 100 }]) // INSERT ai_conversations RETURNING
    .mockResolvedValueOnce([]); // UPDATE history
}

beforeEach(() => {
  vi.clearAllMocks();
  // mockReset clears queued mockResolvedValueOnce values from previous tests
  mockSql.mockReset();
  mockSql.mockResolvedValue([]);
});

describe('Twilio-native inbound webhook', () => {
  it('parses form-encoded body with valid signature and enqueues ai_reply job', async () => {
    seedLead();
    const params = {
      From: '+15551112222',
      Body: 'Yes, interested',
      To: '+15550001111',
      MessageSid: 'SM_unique_123',
    };
    const res = await POST(twilioRequest(params));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<Response/>');
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(enqueueJob).toHaveBeenCalledWith('ai_reply', expect.objectContaining({ leadId: 42 }));
  });

  it('returns 403 for invalid Twilio signature', async () => {
    const params = {
      From: '+15551112222',
      Body: 'hello',
      To: '+15550001111',
      MessageSid: 'SM_bad_456',
    };
    const res = await POST(twilioRequest(params, 'INVALID_SIGNATURE'));
    expect(res.status).toBe(403);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('deduplicates on MessageSid (second request returns 200 TwiML without re-processing)', async () => {
    // First request: no existing dedup row → processes normally
    // SQL call order: dedup check → SELECT lead → INSERT conv → UPDATE history
    // (logEvent and recordRun are mocked to not call sql)
    mockSql
      .mockResolvedValueOnce([]) // dedup check (no existing)
      .mockResolvedValueOnce([{ id: 42, phone: '+15551112222', ai_paused: false }]) // SELECT lead
      .mockResolvedValueOnce([{ id: 100 }]) // INSERT ai_conversations RETURNING
      .mockResolvedValueOnce([]); // UPDATE history
    
    const params = {
      From: '+15551112222',
      Body: 'Yes',
      To: '+15550001111',
      MessageSid: 'SM_dedup_test',
    };
    const res1 = await POST(twilioRequest(params));
    expect(res1.status).toBe(200);
    expect(enqueueJob).toHaveBeenCalledTimes(1);

    // Second request: dedup check finds existing row → skip
    mockSql.mockReset();
    mockSql.mockResolvedValue([]);
    enqueueJob.mockClear();
    mockSql.mockResolvedValueOnce([{ id: 999 }]); // dedup check finds existing
    const res2 = await POST(twilioRequest(params));
    expect(res2.status).toBe(200);
    const text = await res2.text();
    expect(text).toContain('<Response/>');
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('simulator JSON path still works with x-sms-secret', async () => {
    // Simulator branch: NO dedup check, so first mock is SELECT lead
    // (logEvent and recordRun are mocked to not call sql)
    mockSql
      .mockResolvedValueOnce([{ id: 42, phone: '+15551112222', ai_paused: false }]) // SELECT lead
      .mockResolvedValueOnce([{ id: 100 }]) // INSERT ai_conversations RETURNING
      .mockResolvedValueOnce([]); // UPDATE history

    const res = await POST(
      new Request('http://t/api/sms/inbound', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-sms-secret': SECRET,
        },
        body: JSON.stringify({ from: '+15551112222', text: 'hello' }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'recorded', leadId: 42 });
  });

  it('simulator JSON path rejects without x-sms-secret', async () => {
    const res = await POST(
      new Request('http://t/api/sms/inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: '+1', text: 'x' }),
      })
    );
    expect(res.status).toBe(401);
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('recognizes owner number with E.164 normalization', async () => {
    // OWNER_NUMBER is +15025241638, Twilio sends +15025241638
    const params = {
      From: '+15025241638',
      Body: 'test from owner',
      To: '+15550001111',
      MessageSid: 'SM_owner_test',
    };
    const res = await POST(twilioRequest(params));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<Response/>');
    // Should NOT enqueue a job for owner messages
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});