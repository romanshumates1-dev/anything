/**
 * Regression coverage for the billing fail-closed guarantees around the
 * SCALE credit-gap (see UNIFIED-REQUIREMENTS-MATRIX.md — G2 / SCALE rows).
 *
 * WHY THIS TEST EXISTS
 * --------------------
 * `check-credit-pricing-readiness.mjs` exits HOLD (2) while the `scale`
 * subscription tier has NO `credit_costs` rows: getCreditCost('scale') throws
 * (unknown tier) -> checkCredits MUST translate that throw into
 *   { allowed: false, cost: 0, balance: 0, error: 'Pricing is not configured…' }
 * i.e. a clean HTTP 402 with ZERO debit and ZERO ledger/write impact.
 *
 * There is today NO creditGuard.* test (credits.test.ts / tierResilience cover
 * getCreditCost/getAllCosts; the readiness gate covers the script). This closes
 * the gap precisely at the enforcement boundary for the single tier that is
 * currently unpriced (SCALE), so a future "add SCALE rates" change cannot
 * regress fail-closed into a silent FREE price or a debit-less misleading
 * success.
 *
 * This is CHARACTERIZATION coverage of EXISTING correct behavior (the gate
 * already proves getCreditCost throws for 'scale'); it pins that boundary at
 * the route-facing guard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextResponse } from 'next/server';

vi.mock('../subscriptionGuard', () => ({
  getSubscriptionStatus: vi.fn(),
}));
vi.mock('../credits', () => ({
  canAffordAction: vi.fn(),
  deductCreditsForAction: vi.fn(),
  refundCredits: vi.fn(),
}));
vi.mock('../logger', () => ({
  logEvent: vi.fn(),
}));

import { getSubscriptionStatus } from '../subscriptionGuard';
import { canAffordAction, deductCreditsForAction } from '../credits';
import { checkCredits, requireCredits } from '../creditGuard';

const PRICING_THROW = new Error(
  '[CREDITS] Unknown subscription tier "scale" — refusing to price it at FREE. ' +
    'Known tiers with credit costs: FREE, STARTER, PRO, BUSINESS, ENTERPRISE.',
);

beforeEach(() => {
  vi.clearAllMocks();
  // A SCALE org's subscription tier resolves to 'scale', which has no
  // credit_costs rows — the exact unpriced-tier case this pins.
  (getSubscriptionStatus as any).mockResolvedValue({ tier: 'scale' });
});

describe('creditGuard fail-closed for the unpriced SCALE tier', () => {
  it('returns allowed:false, cost:0, balance:0 and a pricing-not-configured message', async () => {
    (canAffordAction as any).mockRejectedValue(PRICING_THROW);

    const result = await checkCredits('org-scale-1', 'SMS_SEND');

    expect(result.allowed).toBe(false);
    expect(result.cost).toBe(0); // never reports a price it could not compute
    expect(result.balance).toBe(0); // fails before any balance read
    expect(result.tier).toBe('scale');
    expect(result.error).toMatch(/Pricing is not configured for your plan/);
  });

  it('requireCredits returns a clean 402 and NEVER deducts on a pricing failure', async () => {
    (canAffordAction as any).mockRejectedValue(PRICING_THROW);
    // Even if the (mocked) debit path existed, it must not be reached on a
    // pricing failure — no row is written and no balance changes.
    (deductCreditsForAction as any).mockRejectedValue(new Error('must-not-be-called'));

    const response = await requireCredits('org-scale-1', 'CONTRACT_GENERATE');
    expect((response as NextResponse).status).toBe(402);
    const body = await (response as NextResponse).json();
    expect(body.code).toBe('INSUFFICIENT_CREDITS');
    expect(body.details.balance).toBe(0);
    expect(body.details.cost).toBe(0);
    expect(deductCreditsForAction).not.toHaveBeenCalled();
  });
});

