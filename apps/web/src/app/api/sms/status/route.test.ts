/**
 * Twilio delivery-status callback route tests (Gap G-1).
 *
 * Proves against the REAL route + REAL signature util (no bypass):
 *  1. Invalid X-Twilio-Signature → 403 (no DB write)
 *  2. Valid signature + MessageStatus=delivered on a 'dispatched' row → 200,
 *     status advanced (SELECT + UPDATE both issued)
 *  3. Out-of-order 'sent' after 'delivered' → not downgraded (applied:false)
 *  4. Unknown MessageSid → 200 applied:false (Twilio won't retry forever)
 *  5. Unmapped status → 200 applied:false before any DB read
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import crypto from 'node:crypto';

const { mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  return { mockSql: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const AUTH_TOKEN = 'test-auth-token-xyz';
vi.mock('@/app/api/utils/twilio-adapter', () => ({
  getTwilioConfig: vi.fn(() => ({ accountSid: 'ACtest', authToken: AUTH_TOKEN, fromNumber: '+15005550006' })),
}));

import { POST } from './route';

const CALLBACK_URL = 'https://test.example/api/sms/status';

beforeAll(() => {
  process.env.TWILIO_STATUS_CALLBACK_URL = CALLBACK_URL;
});
beforeEach(() => {
  mockSql.mockClear();
  mockSql.mockResolvedValue([]);
});

function sign(params: Record<string, string>, url: string, authToken: string): string {
  const data = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return crypto.createHmac('sha1', authToken).update(`${url}${data}`).digest('base64');
}

function req(params: Record<string, string>, signature?: string) {
  const sig = signature ?? sign(params, CALLBACK_URL, AUTH_TOKEN);
  return new Request('http://localhost:4000/api/sms/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'X-Twilio-Signature': sig,
    },
    body: new URLSearchParams(params).toString(),
  });
}

describe('POST /api/sms/status — Twilio delivery callback', () => {
  it('rejects an invalid signature with 403 and writes nothing', async () => {
    const res = await POST(req({ MessageSid: 'SM123', MessageStatus: 'delivered' }, 'not-a-valid-signature'));
    expect(res.status).toBe(403);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('advances a dispatched message to delivered on a valid signature', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'uuid-1', status: 'dispatched' }]); // SELECT
    mockSql.mockResolvedValueOnce([]); // UPDATE
    const res = await POST(req({ MessageSid: 'SM123', MessageStatus: 'delivered', To: '+15551230000' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ received: true, applied: true, status: 'delivered' });
    expect(mockSql).toHaveBeenCalledTimes(2); // SELECT + UPDATE
  });

  it('does not downgrade a delivered message when a stale sent arrives', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'uuid-1', status: 'delivered' }]); // SELECT only
    const res = await POST(req({ MessageSid: 'SM123', MessageStatus: 'sent' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ applied: false, reason: 'stale' });
    expect(mockSql).toHaveBeenCalledTimes(1); // SELECT only, no UPDATE
  });

  it('acknowledges an unknown MessageSid without applying', async () => {
    mockSql.mockResolvedValueOnce([]); // SELECT → no row
    const res = await POST(req({ MessageSid: 'SMunknown', MessageStatus: 'delivered' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ applied: false });
  });

  it('ignores an unmapped status before touching the DB', async () => {
    const res = await POST(req({ MessageSid: 'SM123', MessageStatus: 'accepted' }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ applied: false });
    expect(mockSql).not.toHaveBeenCalled();
  });
});
