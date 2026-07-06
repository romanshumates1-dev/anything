/**
 * Item 6b — pause-AI (behavioral).
 *
 * pause-AI was a ghost feature (no column, no toggle route, inbound enqueued no
 * AI job). Now the inbound SMS handler enqueues an `ai_reply` job ONLY when the
 * matched lead is not paused. This asserts:
 *  - lead.ai_paused = true  -> NO ai_reply job enqueued (parked for a human)
 *  - lead.ai_paused = false -> exactly one ai_reply job enqueued for that lead
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('../../utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));
vi.mock('../../utils/execution-ledger', () => ({ recordRun: vi.fn(async () => {}) }));
vi.mock('../../utils/twilio-adapter', () => ({ getTwilioConfig: vi.fn(() => null) }));
vi.mock('../../utils/twilio-webhook', () => ({ validateTwilioSignature: vi.fn(() => true) }));

const { enqueueJob } = vi.hoisted(() => ({ enqueueJob: vi.fn(async () => 1) }));
vi.mock('../../utils/jobs', () => ({ enqueueJob }));

import { POST } from './route';

const SECRET = 'test-inbound-secret';
beforeAll(() => {
  process.env.SMS_INBOUND_SECRET = SECRET;
});

function inboundReq(from: string, text = 'hello there') {
  return new Request('http://t/api/sms/inbound', {
    method: 'POST',
    headers: { 'x-sms-secret': SECRET, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, text }),
  });
}

function seedLead(ai_paused: boolean) {
  mockSql
    .mockResolvedValueOnce([{ id: 42, phone: '+15551112222', ai_paused }]) // SELECT lead
    .mockResolvedValueOnce([{ id: 100 }]) // INSERT ai_conversations RETURNING
    .mockResolvedValueOnce([]); // UPDATE history
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSql.mockResolvedValue([]);
});

describe('Item 6b — pause-AI suppresses the inbound AI reply', () => {
  it('does NOT enqueue an ai_reply job when the lead is paused', async () => {
    seedLead(true);
    const res = await POST(inboundReq('+15551112222'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'recorded', leadId: 42, aiQueued: false });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('enqueues exactly one ai_reply job when the lead is NOT paused', async () => {
    seedLead(false);
    const res = await POST(inboundReq('+15551112222'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ aiQueued: true });
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(enqueueJob).toHaveBeenCalledWith('ai_reply', expect.objectContaining({ leadId: 42 }));
  });

  it('rejects an unauthenticated webhook (no ai job)', async () => {
    const res = await POST(
      new Request('http://t/api/sms/inbound', { method: 'POST', body: JSON.stringify({ from: '+1', text: 'x' }) })
    );
    expect(res.status).toBe(401);
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});
