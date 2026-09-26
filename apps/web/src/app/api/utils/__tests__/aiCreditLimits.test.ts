import { describe, expect, it, vi } from 'vitest';

import {
  AI_CREDIT_DAILY_DIVISOR,
  AI_CREDIT_WEEKLY_DIVISOR,
  authorizeAiCreditUsage,
  deriveAiCreditPeriodCaps,
  getAiCreditPeriodKeys,
  type AiCreditUsageDeps,
} from '../aiCreditLimits';

const ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001';

function buildDeps(overrides: Partial<AiCreditUsageDeps> = {}): AiCreditUsageDeps {
  return {
    consumeIncludedPeriods: vi
      .fn()
      .mockResolvedValue({ ok: true, used: { day: 1, week: 1, month: 1 } }),
    debitPurchasedCredits: vi.fn().mockResolvedValue({ ok: true }),
    now: () => new Date('2026-03-04T10:00:00.000Z'),
    ...overrides,
  };
}

describe('deriveAiCreditPeriodCaps', () => {
  it('derives weekly = floor(M/4) and daily = floor(M/20) for a 400 credit allowance', () => {
    expect(deriveAiCreditPeriodCaps(400)).toEqual({ monthly: 400, weekly: 100, daily: 20 });
  });

  it('floors fractional caps so the caps never exceed the documented fractions', () => {
    const caps = deriveAiCreditPeriodCaps(250);
    expect(caps.weekly).toBe(62);
    expect(caps.daily).toBe(12);
    expect(caps.weekly).toBeLessThanOrEqual(250 / AI_CREDIT_WEEKLY_DIVISOR);
    expect(caps.daily).toBeLessThanOrEqual(250 / AI_CREDIT_DAILY_DIVISOR);
  });

  it('returns zero caps for zero, negative or non-finite allowances', () => {
    expect(deriveAiCreditPeriodCaps(0)).toEqual({ monthly: 0, weekly: 0, daily: 0 });
    expect(deriveAiCreditPeriodCaps(-50)).toEqual({ monthly: 0, weekly: 0, daily: 0 });
    expect(deriveAiCreditPeriodCaps(Number.NaN)).toEqual({ monthly: 0, weekly: 0, daily: 0 });
  });

  it('keeps the documented divisor constants in sync with the mission requirement', () => {
    expect(AI_CREDIT_WEEKLY_DIVISOR).toBe(4);
    expect(AI_CREDIT_DAILY_DIVISOR).toBe(20);
  });
});

describe('getAiCreditPeriodKeys', () => {
  it('produces UTC day, ISO week and month keys', () => {
    expect(getAiCreditPeriodKeys(new Date('2026-03-04T10:00:00.000Z'))).toEqual({
      day: '2026-03-04',
      week: '2026-W10',
      month: '2026-03',
    });
  });

  it('uses ISO week numbering across a year boundary (2025-12-29 is 2026-W01)', () => {
    expect(getAiCreditPeriodKeys(new Date('2025-12-29T00:00:00.000Z')).week).toBe('2026-W01');
    expect(getAiCreditPeriodKeys(new Date('2026-01-01T00:00:00.000Z')).week).toBe('2026-W01');
    expect(getAiCreditPeriodKeys(new Date('2024-12-30T12:00:00.000Z')).week).toBe('2025-W01');
  });

  it('changes the day and month keys exactly at the UTC boundary', () => {
    const before = getAiCreditPeriodKeys(new Date('2026-01-31T23:59:59.999Z'));
    const after = getAiCreditPeriodKeys(new Date('2026-02-01T00:00:00.000Z'));
    expect(before.day).toBe('2026-01-31');
    expect(before.month).toBe('2026-01');
    expect(after.day).toBe('2026-02-01');
    expect(after.month).toBe('2026-02');
    expect(before.day).not.toBe(after.day);
  });

  it('is timezone independent for the same instant', () => {
    const instant = new Date(Date.parse('2026-06-30T23:30:00.000Z'));
    expect(getAiCreditPeriodKeys(instant)).toEqual(getAiCreditPeriodKeys(new Date(instant.getTime())));
  });
});

describe('authorizeAiCreditUsage', () => {
  it('consumes included credits first when the period caps allow it', async () => {
    const deps = buildDeps();
    const result = await authorizeAiCreditUsage(
      { organizationId: ORGANIZATION_ID, monthlyAllowance: 400, requestId: 'req-included' },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected authorization');
    expect(result.bucket).toBe('included');
    expect(result.caps).toEqual({ monthly: 400, weekly: 100, daily: 20 });
    expect(result.keys).toEqual({ day: '2026-03-04', week: '2026-W10', month: '2026-03' });
    expect(deps.consumeIncludedPeriods).toHaveBeenCalledTimes(1);
    expect(deps.debitPurchasedCredits).not.toHaveBeenCalled();
  });

  it('falls back to purchased credits when an included period cap is hit', async () => {
    const deps = buildDeps({
      consumeIncludedPeriods: vi.fn().mockResolvedValue({ ok: false, reason: 'daily_limit' }),
    });

    const result = await authorizeAiCreditUsage(
      { organizationId: ORGANIZATION_ID, monthlyAllowance: 400, requestId: 'req-fallback' },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected authorization');
    expect(result.bucket).toBe('purchased');
    expect(deps.consumeIncludedPeriods).toHaveBeenCalledTimes(1);
    expect(deps.debitPurchasedCredits).toHaveBeenCalledTimes(1);
  });

  it('never gates purchased credits behind weekly or monthly included caps', async () => {
    for (const reason of ['weekly_limit', 'monthly_limit', 'allowance_exhausted'] as const) {
      const deps = buildDeps({
        consumeIncludedPeriods: vi.fn().mockResolvedValue({ ok: false, reason }),
      });
      const result = await authorizeAiCreditUsage(
        { organizationId: ORGANIZATION_ID, monthlyAllowance: 100, requestId: `req-${reason}` },
        deps,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('expected authorization');
      expect(result.bucket).toBe('purchased');
    }
  });

  it('uses purchased credits directly when the plan includes no AI credits', async () => {
    const deps = buildDeps();
    const result = await authorizeAiCreditUsage(
      { organizationId: ORGANIZATION_ID, monthlyAllowance: 0, requestId: 'req-none' },
      deps,
    );

    expect(deps.consumeIncludedPeriods).not.toHaveBeenCalled();
    expect(deps.debitPurchasedCredits).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected authorization');
    expect(result.bucket).toBe('purchased');
    expect(result.caps).toEqual({ monthly: 0, weekly: 0, daily: 0 });
  });

  it('denies with no_credits when the purchased bucket is empty and included caps are hit', async () => {
    const deps = buildDeps({
      consumeIncludedPeriods: vi.fn().mockResolvedValue({ ok: false, reason: 'weekly_limit' }),
      debitPurchasedCredits: vi
        .fn()
        .mockResolvedValue({ ok: false, reason: 'insufficient_purchased' }),
    });

    const result = await authorizeAiCreditUsage(
      { organizationId: ORGANIZATION_ID, monthlyAllowance: 400, requestId: 'req-denied' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected denial');
    expect(result.reason).toBe('no_credits');
    expect(typeof result.message).toBe('string');
  });

  it('fails closed when included-credit accounting throws (never silently grants credits)', async () => {
    const deps = buildDeps({
      consumeIncludedPeriods: vi.fn().mockRejectedValue(new Error('database unavailable')),
    });

    const result = await authorizeAiCreditUsage(
      { organizationId: ORGANIZATION_ID, monthlyAllowance: 400, requestId: 'req-error' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected denial');
    expect(result.reason).toBe('accounting_error');
    expect(deps.debitPurchasedCredits).not.toHaveBeenCalled();
  });

  it('fails closed when purchased-credit accounting throws', async () => {
    const deps = buildDeps({
      consumeIncludedPeriods: vi.fn().mockResolvedValue({ ok: false, reason: 'daily_limit' }),
      debitPurchasedCredits: vi.fn().mockRejectedValue(new Error('accounting exploded')),
    });

    const result = await authorizeAiCreditUsage(
      { organizationId: ORGANIZATION_ID, monthlyAllowance: 400, requestId: 'req-error-2' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected denial');
    expect(result.reason).toBe('accounting_error');
  });

  it('rejects requests without an organization to keep accounting tenant-scoped', async () => {
    const deps = buildDeps();
    const result = await authorizeAiCreditUsage(
      { organizationId: '', monthlyAllowance: 400, requestId: 'req-no-org' },
      deps,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected denial');
    expect(result.reason).toBe('missing_organization');
    expect(deps.consumeIncludedPeriods).not.toHaveBeenCalled();
    expect(deps.debitPurchasedCredits).not.toHaveBeenCalled();
  });
});

describe('authorizeAiCreditUsage compensation', () => {
  it('releases consumed included credits exactly once when the AI call fails', async () => {
    const releaseIncludedPeriods = vi.fn().mockResolvedValue(undefined);
    const deps = buildDeps({ releaseIncludedPeriods });

    const result = await authorizeAiCreditUsage(
      { organizationId: ORGANIZATION_ID, monthlyAllowance: 400, requestId: 'req-release' },
      deps,
    );
    if (!result.ok) throw new Error('expected authorization');

    await result.release();
    await result.release();

    expect(releaseIncludedPeriods).toHaveBeenCalledTimes(1);
    expect(releaseIncludedPeriods).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        requestId: 'req-release',
        keys: { day: '2026-03-04', week: '2026-W10', month: '2026-03' },
      }),
    );
  });

  it('refunds purchased credits exactly once when the AI call fails', async () => {
    const refundPurchasedCredits = vi.fn().mockResolvedValue(undefined);
    const deps = buildDeps({
      consumeIncludedPeriods: vi.fn().mockResolvedValue({ ok: false, reason: 'daily_limit' }),
      refundPurchasedCredits,
    });

    const result = await authorizeAiCreditUsage(
      { organizationId: ORGANIZATION_ID, monthlyAllowance: 400, requestId: 'req-refund' },
      deps,
    );
    if (!result.ok) throw new Error('expected authorization');
    expect(result.bucket).toBe('purchased');

    await result.release();
    await result.release();

    expect(refundPurchasedCredits).toHaveBeenCalledTimes(1);
    expect(refundPurchasedCredits).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION_ID, requestId: 'req-refund' }),
    );
  });

  it('release is a no-op when the deps expose no compensation hook', async () => {
    const deps = buildDeps();
    const result = await authorizeAiCreditUsage(
      { organizationId: ORGANIZATION_ID, monthlyAllowance: 400, requestId: 'req-no-hook' },
      deps,
    );
    if (!result.ok) throw new Error('expected authorization');
    await expect(result.release()).resolves.toBeUndefined();
  });
});
