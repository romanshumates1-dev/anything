/**
 * Unit tests for POST /api/referrals/signup — referral attribution at signup.
 *
 * The critical behaviours (found broken during the final acceptance audit):
 *  - the signup page posts ONLY { referralCode } right after registration, so
 *    the route must default the referred user to the authenticated session;
 *  - a supplied referredUserId must still equal the session user (no
 *    attributing strangers to yourself);
 *  - self-referral and unknown codes are rejected;
 *  - the legacy no-code purchase path keeps its previous contract.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { default: mockSql } = vi.hoisted(() => {
  const m: any = vi.fn(async () => []);
  m.transaction = vi.fn(async () => []);
  m.query = m;
  return { default: m };
});
vi.mock('@/app/api/utils/sql', () => ({ default: mockSql }));

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: (...a: any[]) => getSession(...a) } },
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { lookupReferralCode, recordReferralSignup, awardReferralCredits } =
  vi.hoisted(() => ({
    lookupReferralCode: vi.fn(),
    recordReferralSignup: vi.fn(),
    awardReferralCredits: vi.fn(),
  }));
vi.mock('@/app/api/utils/referralRewards', () => ({
  lookupReferralCode,
  recordReferralSignup,
  awardReferralCredits,
}));

import { POST } from '../signup/route';

function mockRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as Request;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: 'user-1' } });
  lookupReferralCode.mockResolvedValue({ userId: 'referrer-9' });
  recordReferralSignup.mockResolvedValue(true);
  awardReferralCredits.mockResolvedValue({ creditsAwarded: 0, bonusAwarded: 0 });
});

describe('POST /api/referrals/signup', () => {
  it('401s without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(mockRequest({ referralCode: 'ABC123' }) as any);
    expect(res.status).toBe(401);
    expect(recordReferralSignup).not.toHaveBeenCalled();
  });

  it('defaults the referred user to the session user (signup-page path)', async () => {
    const res = await POST(mockRequest({ referralCode: 'ABC123' }) as any);
    expect(res.status).toBe(200);
    expect(recordReferralSignup).toHaveBeenCalledWith(
      'referrer-9',
      'user-1',
      'ABC123',
    );
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.referrerId).toBe('referrer-9');
  });

  it('rejects attributing a different user than the session (403)', async () => {
    const res = await POST(
      mockRequest({ referralCode: 'ABC123', referredUserId: 'someone-else' }) as any,
    );
    expect(res.status).toBe(403);
    expect(recordReferralSignup).not.toHaveBeenCalled();
  });

  it('rejects an unknown referral code (400)', async () => {
    lookupReferralCode.mockResolvedValue(null);
    const res = await POST(mockRequest({ referralCode: 'NOPE' }) as any);
    expect(res.status).toBe(400);
    expect(recordReferralSignup).not.toHaveBeenCalled();
  });

  it('rejects self-referral (400)', async () => {
    lookupReferralCode.mockResolvedValue({ userId: 'user-1' });
    const res = await POST(mockRequest({ referralCode: 'OWNCODE' }) as any);
    expect(res.status).toBe(400);
    expect(recordReferralSignup).not.toHaveBeenCalled();
  });

  it('keeps the legacy no-code purchase path (404 when nothing to award)', async () => {
    const res = await POST(mockRequest({}) as any);
    expect(res.status).toBe(404);
    expect(awardReferralCredits).toHaveBeenCalledWith('user-1');
  });
});
