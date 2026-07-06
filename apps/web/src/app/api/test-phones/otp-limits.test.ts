/**
 * Item 3 — OTP / test-phone verification limits (behavioral).
 *
 * Asserts the ACTUAL shipped behavior (which differs from the sprint wording):
 *  - 4th send within an hour -> 429 (sends 1-3 allowed; guard is COUNT >= 3)
 *  - wrong code invalidation -> the 4th verify attempt is blocked 429 once
 *    attempts >= 3, even with the correct code (sprint said "5th"; it is 4th)
 *  - expired code -> 400 "OTP expired"
 *  - 6th verified number for an org -> 400 (guard is verified COUNT >= 5); note
 *    this is a 400 at send-time, not a 429.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

const { gwSend } = vi.hoisted(() => ({ gwSend: vi.fn(async () => ({ status: 'dispatched' })) }));
vi.mock('@/app/api/utils/jobs', () => ({ getGateway: vi.fn(async () => ({ send: gwSend })) }));

import { POST as sendOtp } from './route';
import { POST as verifyOtp } from './[id]/verify/route';

const sha = (code: string) => crypto.createHash('sha256').update(String(code)).digest('hex');
const sendReq = (phone: unknown) =>
  new Request('http://t/api/test-phones', { method: 'POST', body: JSON.stringify({ phone }) }) as any;
const verifyReq = (code: unknown) =>
  new Request('http://t/api/test-phones/p1/verify', { method: 'POST', body: JSON.stringify({ code }) }) as any;

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'org-1' } });
});

describe('Item 3 — OTP send rate limit (4th send/hour blocked)', () => {
  it('blocks the 4th send in an hour with 429 and does NOT dispatch', async () => {
    mockSql.mockResolvedValueOnce([{ cnt: 3 }]); // recentSends >= 3
    const res = await sendOtp(sendReq('+15551230000'));
    expect(res.status).toBe(429);
    expect(gwSend).not.toHaveBeenCalled();
  });

  it('allows the 3rd send (boundary: cnt=2) and dispatches', async () => {
    mockSql
      .mockResolvedValueOnce([{ cnt: 2 }]) // recentSends
      .mockResolvedValueOnce([{ cnt: 0 }]) // verifiedCount
      .mockResolvedValueOnce([]) // insert otp_log
      .mockResolvedValueOnce([{ id: 'p1', phone: '+15551230000' }]); // upsert record
    const res = await sendOtp(sendReq('+15551230000'));
    expect(res.status).toBe(200);
    expect(gwSend).toHaveBeenCalledTimes(1);
  });
});

describe('Item 3 — verified-number cap (6th number rejected)', () => {
  it('rejects when org already has 5 verified numbers (400) and does NOT dispatch', async () => {
    mockSql
      .mockResolvedValueOnce([{ cnt: 0 }]) // recentSends ok
      .mockResolvedValueOnce([{ cnt: 5 }]); // verifiedCount >= 5
    const res = await sendOtp(sendReq('+15559990000'));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Maximum verified test phones (5)') });
    expect(gwSend).not.toHaveBeenCalled();
  });

  it('allows sending to the 5th number (boundary: cnt=4)', async () => {
    mockSql
      .mockResolvedValueOnce([{ cnt: 0 }])
      .mockResolvedValueOnce([{ cnt: 4 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'p1' }]);
    const res = await sendOtp(sendReq('+15559990000'));
    expect(res.status).toBe(200);
  });
});

describe('Item 3 — wrong-code invalidation', () => {
  it('increments attempts and returns 400 on a wrong code', async () => {
    mockSql
      .mockResolvedValueOnce([
        { id: 'p1', organization_id: 'org-1', verified: false, otp_expires_at: new Date(Date.now() + 60_000).toISOString(), attempts: 0, otp_code: sha('111111') },
      ])
      .mockResolvedValueOnce([]); // UPDATE attempts+1
    const res = await verifyOtp(verifyReq('000000'), { params: { id: 'p1' } } as any);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Invalid code' });
    // the increment UPDATE was issued
    const updated = mockSql.mock.calls.some(
      (c: any) => Array.isArray(c[0]) && c[0].join('?').includes('SET attempts = attempts + 1')
    );
    expect(updated).toBe(true);
  });

  it('blocks with 429 once attempts >= 3, even for the correct code (code invalidated)', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 'p1', organization_id: 'org-1', verified: false, otp_expires_at: new Date(Date.now() + 60_000).toISOString(), attempts: 3, otp_code: sha('123456') },
    ]);
    const res = await verifyOtp(verifyReq('123456'), { params: { id: 'p1' } } as any);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining('Maximum attempts exceeded') });
    // no verify UPDATE should have fired
    const verifiedUpdate = mockSql.mock.calls.some(
      (c: any) => Array.isArray(c[0]) && c[0].join('?').includes('SET verified = true')
    );
    expect(verifiedUpdate).toBe(false);
  });
});

describe('Item 3 — expired code rejected', () => {
  it('rejects an expired code with 400 and does not verify', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 'p1', organization_id: 'org-1', verified: false, otp_expires_at: new Date(Date.now() - 1000).toISOString(), attempts: 0, otp_code: sha('123456') },
    ]);
    const res = await verifyOtp(verifyReq('123456'), { params: { id: 'p1' } } as any);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'OTP expired' });
  });

  it('positive control: valid, unexpired, correct code -> verified 200', async () => {
    mockSql
      .mockResolvedValueOnce([
        { id: 'p1', organization_id: 'org-1', verified: false, otp_expires_at: new Date(Date.now() + 60_000).toISOString(), attempts: 0, otp_code: sha('654321') },
      ])
      .mockResolvedValueOnce([{ id: 'p1', phone: '+15551230000', verified: true }]); // verify UPDATE
    const res = await verifyOtp(verifyReq('654321'), { params: { id: 'p1' } } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verified: true });
  });
});
