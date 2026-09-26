/**
 * Phase 11 — tests for the server-side AI credit gate used by AI-consuming routes.
 *
 * The gate is the single place that turns "an AI request was requested" into
 * "which credit bucket pays for it, or a denial". It must:
 *   - resolve the plan's monthly included allowance
 *   - treat an unlimited allowance (-1) as unlimited, with no counters touched
 *   - delegate included-credit capping to the pure policy module
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../subscriptionGuard', () => ({
  getSubscriptionStatus: vi.fn(),
}));

// The default dependency chain reaches the real database, so mock both layers.
vi.mock('../sql', () => ({
  default: vi.fn(),
}));

vi.mock('../credits', () => ({
  deductCredits: vi.fn(),
  refundCredits: vi.fn(),
}));

import { getSubscriptionStatus } from '../subscriptionGuard';
import sql from '../sql';
import { deductCredits } from '../credits';
import { createAiCreditGateDeps, authorizeAiRequest } from '../aiCreditGate';
import type { AiCreditUsageDeps } from '../aiCreditLimits';

const TEST_ORG_ID = '12345678-1234-1234-1234-123456789012';

function fakeDeps(overrides: Partial<AiCreditUsageDeps> = {}): AiCreditUsageDeps {
  return {
    consumeIncludedPeriods: vi.fn().mockResolvedValue({
      ok: true,
      used: { day: 1, week: 1, month: 1 },
    }),
    debitPurchasedCredits: vi.fn().mockResolvedValue({ ok: true, remaining: 5 }),
    releaseIncludedPeriods: vi.fn().mockResolvedValue(undefined),
    refundPurchasedCredits: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as AiCreditUsageDeps;
}

describe('authorizeAiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('consumes included credits using the plan monthly allowance', async () => {
    (getSubscriptionStatus as any).mockResolvedValue({
      tier: 'pro',
      active: true,
      limits: { monthly_ai_credits: 200 },
    });
    const usage = fakeDeps();

    const result = await authorizeAiRequest(
      TEST_ORG_ID,
      { requestId: 'req-1' },
      createAiCreditGateDeps({ getMonthlyAllowance: async () => 200, usageDeps: usage }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.caps).toEqual({ monthly: 200, weekly: 50, daily: 10 });
    expect(result.ok === true && result.bucket).toBe('included');
  });

  it('allows an unlimited plan without touching any credit counter', async () => {
    (getSubscriptionStatus as any).mockResolvedValue({
      tier: 'enterprise',
      active: true,
      limits: { monthly_ai_credits: -1 },
    });
    const usage = fakeDeps();

    const result = await authorizeAiRequest(
      TEST_ORG_ID,
      {},
      createAiCreditGateDeps({ getMonthlyAllowance: async () => -1, usageDeps: usage }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.bucket).toBe('unlimited');
    expect(usage.consumeIncludedPeriods).not.toHaveBeenCalled();
    expect(usage.debitPurchasedCredits).not.toHaveBeenCalled();
  });

  it('reads the allowance from subscription status through the default dependency', async () => {
    (getSubscriptionStatus as any).mockResolvedValue({
      tier: 'starter',
      active: true,
      limits: { monthly_ai_credits: 40 },
    });
    (sql as any).mockResolvedValue([{ result: { ok: true, day: 1, week: 1, month: 1 } }]);

    const result = await authorizeAiRequest(TEST_ORG_ID, {});

    expect(getSubscriptionStatus).toHaveBeenCalledWith(TEST_ORG_ID);
    expect(result.ok === true && result.caps).toEqual({ monthly: 40, weekly: 10, daily: 2 });
  });

  it('does not silently grant free credits when there is no subscription or allowance', async () => {
    // A missing subscription means no INCLUDED allowance. The gate must still consult the
    // purchased bucket (credits the customer paid for are not gated by included caps) and
    // only deny when that is empty too.
    (getSubscriptionStatus as any).mockResolvedValue(null);
    const usage = fakeDeps({
      consumeIncludedPeriods: vi.fn().mockResolvedValue({ ok: false, reason: 'allowance_exhausted' }),
      debitPurchasedCredits: vi.fn().mockResolvedValue({ ok: false, reason: 'insufficient_purchased' }),
    });

    const result = await authorizeAiRequest(
      TEST_ORG_ID,
      {},
      createAiCreditGateDeps({ getMonthlyAllowance: async () => 0, usageDeps: usage }),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('no_credits');
    // The included bucket must be skipped entirely, not probed.
    expect(usage.consumeIncludedPeriods).not.toHaveBeenCalled();
  });

  it('still honours PURCHASED credits when the plan includes no AI credits (regression)', async () => {
    // Regression guard: a zero allowance must not lock a paying customer out of credits
    // they already bought.
    (getSubscriptionStatus as any).mockResolvedValue(null);
    const usage = fakeDeps({
      consumeIncludedPeriods: vi.fn().mockResolvedValue({ ok: true, used: { day: 1, week: 1, month: 1 } }),
      debitPurchasedCredits: vi.fn().mockResolvedValue({ ok: true, remaining: 3 }),
    });

    const result = await authorizeAiRequest(
      TEST_ORG_ID,
      { requestId: 'paid' },
      createAiCreditGateDeps({ getMonthlyAllowance: async () => 0, usageDeps: usage }),
    );

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.bucket).toBe('purchased');
    expect(usage.consumeIncludedPeriods).not.toHaveBeenCalled();
    expect(usage.debitPurchasedCredits).toHaveBeenCalledTimes(1);
  });

  it('surfaces the purchased-credit fallback when included caps are exhausted', async () => {
    (getSubscriptionStatus as any).mockResolvedValue({
      tier: 'pro',
      active: true,
      limits: { monthly_ai_credits: 100 },
    });

    const result = await authorizeAiRequest(
      TEST_ORG_ID,
      {},
      createAiCreditGateDeps({ getMonthlyAllowance: async () => 100, usageDeps: fakeDeps() }),
    );

    expect(result.ok === true && result.bucket).toBe('included');
  });
});
