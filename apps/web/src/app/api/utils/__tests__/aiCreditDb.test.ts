/**
 * Phase 11 — DB adapter tests for the AI credit period-limit ledger.
 *
 * Covers the persistence-backed implementation of `AiCreditUsageDeps`:
 *   - included-credit consumption via `consume_ai_included_credit`
 *   - compensating release via `release_ai_included_credit`
 *   - purchased-credit debit/refund via the existing credit ledger
 *   - fail-closed behaviour when the database returns nothing usable
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../sql', () => ({
  default: vi.fn(),
}));

vi.mock('../logger', () => ({
  logEvent: vi.fn(),
}));

vi.mock('../credits', () => ({
  deductCredits: vi.fn(),
  refundCredits: vi.fn(),
}));

import sql from '../sql';
import { deductCredits, refundCredits } from '../credits';
import { createAiCreditUsageDeps } from '../aiCreditDb';
import { authorizeAiCreditUsage } from '../aiCreditLimits';

const TEST_ORG_ID = '12345678-1234-1234-1234-123456789012';

const keys = { day: '2026-03-04', week: '2026-W10', month: '2026-03' };
const caps = { monthly: 100, weekly: 25, daily: 5 };

function input(overrides: Record<string, unknown> = {}) {
  return { organizationId: TEST_ORG_ID, keys, caps, ...overrides } as any;
}

describe('createAiCreditUsageDeps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('consumeIncludedPeriods', () => {
    it('returns the day/week/month totals when the database consumes the credit', async () => {
      (sql as any).mockResolvedValue([
        { result: { ok: true, day: 3, week: 9, month: 41 } },
      ]);

      const deps = createAiCreditUsageDeps();
      const result = await deps.consumeIncludedPeriods(input());

      expect(result).toEqual({ ok: true, used: { day: 3, week: 9, month: 41 } });
    });

    it('passes the organization, period keys and caps as function arguments', async () => {
      (sql as any).mockResolvedValue([{ result: { ok: true } }]);

      await createAiCreditUsageDeps().consumeIncludedPeriods(input());

      const template = (sql as any).mock.calls[0];
      expect(template[0].join('?')).toContain('consume_ai_included_credit');
      expect(template.slice(1)).toEqual([
        TEST_ORG_ID,
        keys.day,
        keys.week,
        keys.month,
        caps.daily,
        caps.weekly,
        caps.monthly,
      ]);
    });

    it('maps each database deny reason onto the typed reason', async () => {
      for (const reason of ['daily_limit', 'weekly_limit', 'monthly_limit'] as const) {
        (sql as any).mockResolvedValue([{ result: { ok: false, reason } }]);

        const result = await createAiCreditUsageDeps().consumeIncludedPeriods(input());

        expect(result).toEqual({ ok: false, reason });
      }
    });

    it('throws when the database returns no row, so the caller can fail closed', async () => {
      (sql as any).mockResolvedValue([]);

      await expect(
        createAiCreditUsageDeps().consumeIncludedPeriods(input()),
      ).rejects.toThrow(/consume_ai_included_credit/i);
    });

    it('throws when the payload carries no ok field', async () => {
      (sql as any).mockResolvedValue([{ result: { unexpected: true } }]);

      await expect(
        createAiCreditUsageDeps().consumeIncludedPeriods(input()),
      ).rejects.toThrow(/consume_ai_included_credit/i);
    });
  });

  describe('releaseIncludedPeriods', () => {
    it('calls the compensating release function with the same period keys', async () => {
      (sql as any).mockResolvedValue([{ result: { ok: true } }]);

      await createAiCreditUsageDeps().releaseIncludedPeriods!(input());

      const template = (sql as any).mock.calls[0];
      expect(template[0].join('?')).toContain('release_ai_included_credit');
      expect(template.slice(1)).toEqual([TEST_ORG_ID, keys.day, keys.week, keys.month]);
    });
  });

  describe('debitPurchasedCredits', () => {
    it('debits a single credit and reports the remaining balance', async () => {
      (deductCredits as any).mockResolvedValue({
        success: true,
        remainingBalance: 7,
        deducted: 1,
      });

      const result = await createAiCreditUsageDeps().debitPurchasedCredits({
        organizationId: TEST_ORG_ID,
      });

      expect(deductCredits).toHaveBeenCalledTimes(1);
      expect((deductCredits as any).mock.calls[0][0]).toBe(TEST_ORG_ID);
      expect((deductCredits as any).mock.calls[0][1]).toBe(1);
      expect(result).toEqual({ ok: true, remaining: 7 });
    });

    it('forwards a request id as the idempotency key', async () => {
      (deductCredits as any).mockResolvedValue({ success: true, remainingBalance: 3, deducted: 1 });

      await createAiCreditUsageDeps().debitPurchasedCredits({
        organizationId: TEST_ORG_ID,
        requestId: 'req-1',
      });

      const args = (deductCredits as any).mock.calls[0];
      expect(args[args.length - 1]).toBe('req-1');
    });

    it('denies when the purchased balance is insufficient', async () => {
      (deductCredits as any).mockResolvedValue({
        success: false,
        remainingBalance: 0,
        deducted: 0,
        errorCode: 'INSUFFICIENT_CREDITS',
      });

      const result = await createAiCreditUsageDeps().debitPurchasedCredits({
        organizationId: TEST_ORG_ID,
      });

      expect(result).toEqual({ ok: false, reason: 'insufficient_purchased' });
    });
  });

  describe('refundPurchasedCredits', () => {
    it('refunds a single credit', async () => {
      (refundCredits as any).mockResolvedValue({ balance: 8 });

      await createAiCreditUsageDeps().refundPurchasedCredits!({
        organizationId: TEST_ORG_ID,
      });

      expect(refundCredits).toHaveBeenCalledTimes(1);
      expect((refundCredits as any).mock.calls[0][0]).toBe(TEST_ORG_ID);
      expect((refundCredits as any).mock.calls[0][1]).toBe(1);
    });
  });
});

describe('authorizeAiCreditUsage with the database-backed deps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('denies closed with accounting_error when the ledger query fails', async () => {
    (sql as any).mockRejectedValue(new Error('connection reset'));

    const result = await authorizeAiCreditUsage(
      { organizationId: TEST_ORG_ID, monthlyAllowance: 100 },
      createAiCreditUsageDeps(),
    );

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('accounting_error');
  });

  it('falls through to purchased credits when the included caps are exhausted', async () => {
    (sql as any).mockResolvedValue([{ result: { ok: false, reason: 'daily_limit' } }]);
    (deductCredits as any).mockResolvedValue({ success: true, remainingBalance: 4, deducted: 1 });

    const result = await authorizeAiCreditUsage(
      { organizationId: TEST_ORG_ID, monthlyAllowance: 100 },
      createAiCreditUsageDeps(),
    );

    expect(result.ok).toBe(true);
    expect(result.ok === true && result.bucket).toBe('purchased');
  });

  it('consumes included credits and derives the expected caps', async () => {
    (sql as any).mockResolvedValue([{ result: { ok: true, day: 1, week: 1, month: 1 } }]);

    const result = await authorizeAiCreditUsage(
      { organizationId: TEST_ORG_ID, monthlyAllowance: 100 },
      createAiCreditUsageDeps(),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.bucket).toBe('included');
      expect(result.caps).toEqual({ monthly: 100, weekly: 25, daily: 5 });
      expect(deductCredits).not.toHaveBeenCalled();
    }
  });
});
