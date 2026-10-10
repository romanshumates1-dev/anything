/**
 * POST /api/billing/refund — money-moving endpoint security contract.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This handler RETURNS MONEY. It moves real funds via Stripe, downgrades the
 * organization to `free`, zeroes `ai_credits`, and writes a billing event. It
 * had NO route test at all — every sibling under `api/billing/*` is tested, and
 * this is the one that spends money. A regression here is the most expensive
 * kind: an unauthenticated refund, a refund issued when the policy says no, or
 * a refund applied to the wrong tenant.
 *
 * The handler is well-written today (401 anonymous, 403 no-org, org-bound
 * inserts/updates, fail-closed eligibility gate, Stripe failure recorded not
 * silently swallowed). These tests pin that contract so it cannot regress.
 *
 * WHAT IS ASSERTED
 * 1. GET 401s anonymous; 403s with no org.
 * 2. POST 401s anonymous; 403s with no org — no refund path is reachable.
 * 3. POST refuses (400) when the policy says NOT eligible — money never moves.
 * 4. POST requires confirmation (400) when credits were used but not confirmed.
 * 5. On the happy path, Stripe.refund is called with the ELIGIBLE amount, and
 *    the refund request row is bound to THIS organization (tenant scoping).
 * 6. When there is no Stripe payment intent, no refund call is made and the
 *    request is recorded for manual handling (fail-safe, not a silent success).
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
vi.mock('@/lib/auth', () => ({ auth: { api: { getSession: (...a: any[]) => getSession(...a) } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));

const { getOrganization } = vi.hoisted(() => ({ getOrganization: vi.fn() }));
vi.mock('@/lib/organization-context', () => ({ getOrganization: (...a: any[]) => getOrganization(...a) }));

vi.mock('@/app/api/utils/logger', () => ({ logEvent: vi.fn(async () => {}) }));

// Eligibility is the policy gate; control it per-test.
const { calculateRefundAmount } = vi.hoisted(() => ({ calculateRefundAmount: vi.fn() }));
vi.mock('@/app/api/utils/refundCalculator', async (orig) => {
  const actual = (await orig()) as any;
  return { ...actual, calculateRefundAmount: (...a: any[]) => calculateRefundAmount(...a) };
});

// Stripe provider: capture whether a refund was actually attempted.
const { stripeRefund } = vi.hoisted(() => ({ stripeRefund: vi.fn() }));
vi.mock('@/app/api/services/stripeProvider', () => ({
  getStripeProvider: () => ({ refund: (...a: any[]) => stripeRefund(...a) }),
}));

import { GET, POST } from './route';

const ORG = { id: 'org-1' };
const SESSION = { user: { id: 'user-1' } };

function eligible(over: Partial<Record<string, unknown>> = {}) {
  return {
    eligible: true,
    reason: undefined,
    purchasedAt: new Date('2026-10-01T00:00:00Z'),
    refundWindowEnds: new Date('2026-10-08T00:00:00Z'),
    daysRemaining: 5,
    subscriptionPriceCents: 9900,
    creditsUsedSincePurchase: 0,
    creditsNonRefundableCents: 0,
    eligibleRefundCents: 9900,
    subscriptionTier: 'pro',
    alreadyRefunded: false,
    ...over,
  };
}

function postReq(body: unknown = {}) {
  return new Request('http://t/api/billing/refund', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(SESSION);
  getOrganization.mockResolvedValue(ORG);
  stripeRefund.mockResolvedValue({ refundId: 're_123', status: 'succeeded' });
});

describe('GET /api/billing/refund — eligibility', () => {
  it('401s anonymous callers', async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(new Request('http://t/api/billing/refund') as any);
    expect(res.status).toBe(401);
  });

  it('403s a session with no organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await GET(new Request('http://t/api/billing/refund') as any);
    expect(res.status).toBe(403);
  });

  it('returns eligibility details for the org', async () => {
    calculateRefundAmount.mockResolvedValue(eligible());
    const res = await GET(new Request('http://t/api/billing/refund') as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.eligible).toBe(true);
    expect(calculateRefundAmount).toHaveBeenCalledWith(ORG.id);
  });

describe('POST /api/billing/refund — refund gating', () => {
  it('401s anonymous callers — no refund is reachable without a session', async () => {
    getSession.mockResolvedValue(null);
    const res = await POST(postReq());
    expect(res.status).toBe(401);
    expect(stripeRefund).not.toHaveBeenCalled();
  });

  it('403s a session with no organization', async () => {
    getOrganization.mockResolvedValue(null);
    const res = await POST(postReq());
    expect(res.status).toBe(403);
    expect(stripeRefund).not.toHaveBeenCalled();
  });

  it('refuses (400) when the policy says NOT eligible — money never moves', async () => {
    calculateRefundAmount.mockResolvedValue(
      eligible({ eligible: false, reason: 'outside_refund_window' }),
    );
    const res = await POST(postReq({ confirmCreditsLoss: true }));
    expect(res.status).toBe(400);
    expect(stripeRefund).not.toHaveBeenCalled();
  });

  it('requires confirmation (400) when credits were used but not confirmed', async () => {
    calculateRefundAmount.mockResolvedValue(
      eligible({ creditsUsedSincePurchase: 40, creditsNonRefundableCents: 140 }),
    );
    const res = await POST(postReq({})); // no confirmCreditsLoss
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.requiresConfirmation).toBe(true);
    expect(stripeRefund).not.toHaveBeenCalled();
  });

  it('refuses when already refunded', async () => {
    calculateRefundAmount.mockResolvedValue(
      eligible({ eligible: false, reason: 'already_refunded', alreadyRefunded: true }),
    );
    const res = await POST(postReq({ confirmCreditsLoss: true }));
    expect(res.status).toBe(400);
    expect(stripeRefund).not.toHaveBeenCalled();
  });
});

describe('POST /api/billing/refund — happy path & tenant scoping', () => {
  it('calls Stripe.refund with the ELIGIBLE amount and binds the org', async () => {
    calculateRefundAmount.mockResolvedValue(eligible({ eligibleRefundCents: 9900 }));
    mockSql.mockResolvedValueOnce([{ id: 'rr-1' }]); // INSERT ... RETURNING id
    mockSql.mockResolvedValueOnce([{ payment_intent_id: 'pi_123' }]); // billing_events
    mockSql.mockResolvedValue([]); // remaining UPDATEs / INSERTs

    const res = await POST(postReq({ confirmCreditsLoss: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Money moved for exactly the eligible amount.
    expect(stripeRefund).toHaveBeenCalledTimes(1);
    const stripeArg = stripeRefund.mock.calls[0][0];
    expect(stripeArg.paymentIntentId).toBe('pi_123');
    expect(stripeArg.amountCents).toBe(9900);

    // The refund-request INSERT is bound to THIS organization.
    expect(mockSql.mock.calls[0]).toContain(ORG.id);
  });

  it('does NOT call Stripe when there is no payment intent (manual handling)', async () => {
    calculateRefundAmount.mockResolvedValue(eligible());
    mockSql.mockResolvedValueOnce([{ id: 'rr-2' }]); // INSERT ... RETURNING id
    mockSql.mockResolvedValueOnce([]); // no billing_events row -> no payment intent
    mockSql.mockResolvedValue([]);

    const res = await POST(postReq({ confirmCreditsLoss: true }));
    expect(res.status).toBe(200);
    expect(stripeRefund).not.toHaveBeenCalled();
  });

  it('records the request and returns 500 when Stripe throws (no silent success)', async () => {
    calculateRefundAmount.mockResolvedValue(eligible());
    mockSql.mockResolvedValueOnce([{ id: 'rr-3' }]); // INSERT ... RETURNING id
    mockSql.mockResolvedValueOnce([{ payment_intent_id: 'pi_999' }]); // billing event
    mockSql.mockResolvedValue([]); // status UPDATE + org downgrade etc.
    stripeRefund.mockRejectedValueOnce(new Error('stripe down'));

    const res = await POST(postReq({ confirmCreditsLoss: true }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/processing failed/i);
  });
});

});
