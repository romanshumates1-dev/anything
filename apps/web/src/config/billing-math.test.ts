import { describe, expect, it } from 'vitest';

import {
  includedSegmentsForBudget,
  profitSplit,
  PROFIT_SPLIT_POLICIES,
  remainingAllowance,
  retailForTrueCost,
  retainedMarginCents,
  trueTwilioCostCents,
  wouldExceedCap,
  type ProfitSplitPolicyId,
} from './billing-math';

describe('retailForTrueCost — the 2x–3x markup', () => {
  it('doubles at 2x and triples at 3x', () => {
    expect(retailForTrueCost(100, 2)).toBe(200);
    expect(retailForTrueCost(100, 3)).toBe(300);
  });
  it('rounds UP to a whole cent so we never under-charge', () => {
    expect(retailForTrueCost(33, 2.5)).toBe(Math.ceil(33 * 2.5)); // 82.5 -> 83
    expect(retailForTrueCost(33, 2.5)).toBe(83);
  });
  it('rejects nonsense inputs', () => {
    expect(() => retailForTrueCost(-1, 2)).toThrow();
    expect(() => retailForTrueCost(100, 0)).toThrow();
  });
});

describe('trueTwilioCostCents', () => {
  it('is segments * per-segment cost', () => {
    expect(trueTwilioCostCents(1000, 1.1)).toBeCloseTo(1100, 6);
    expect(trueTwilioCostCents(0, 1.1)).toBe(0);
  });
});

describe('includedSegmentsForBudget + CAP-BEFORE-SPEND invariant', () => {
  it('floors the allowance so realized cost never exceeds funded budget', () => {
    const budget = 6000;
    const markup = 3;
    const cost = 1.1;
    const seg = includedSegmentsForBudget(budget, markup, cost);
    expect(seg).toBe(1818); // floor(6000/3/1.1)
    const realized = trueTwilioCostCents(seg, cost);
    // The owner rule made mechanical: at the cap, we have spent AT MOST
    // budget/markup on Twilio, which is <= the budget itself.
    expect(realized).toBeLessThanOrEqual(budget / markup);
    expect(realized).toBeLessThanOrEqual(budget);
  });

  it('holds for a spread of budgets/markups (2x–3x)', () => {
    const cost = 1.1;
    for (let budget = 1000; budget <= 40000; budget += 137) {
      for (const markup of [2, 2.25, 2.5, 2.75, 3]) {
        const seg = includedSegmentsForBudget(budget, markup, cost);
        const realized = trueTwilioCostCents(seg, cost);
        expect(realized).toBeLessThanOrEqual(budget / markup + 1e-9);
        expect(retainedMarginCents(budget, seg, cost)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('rejects invalid inputs', () => {
    expect(() => includedSegmentsForBudget(-1, 2, 1.1)).toThrow();
    expect(() => includedSegmentsForBudget(6000, 0, 1.1)).toThrow();
    expect(() => includedSegmentsForBudget(6000, 2, 0)).toThrow();
  });
});

describe('wouldExceedCap / remainingAllowance', () => {
  it('null cap is unlimited', () => {
    expect(wouldExceedCap(1e9, 1e9, null)).toBe(false);
    expect(remainingAllowance(1e9, null)).toBe(Number.POSITIVE_INFINITY);
  });
  it('trips exactly at the boundary', () => {
    expect(wouldExceedCap(900, 100, 1000)).toBe(false); // lands on cap
    expect(wouldExceedCap(1000, 0, 1000)).toBe(false);
    expect(wouldExceedCap(1000, 1, 1000)).toBe(true); // one over
    expect(wouldExceedCap(950, 100, 1000)).toBe(true);
  });
  it('remaining floors at zero', () => {
    expect(remainingAllowance(300, 1000)).toBe(700);
    expect(remainingAllowance(1200, 1000)).toBe(0);
  });
});

describe('profitSplit — 25/75, 50/50, 90/10', () => {
  it('splits cleanly on round numbers', () => {
    expect(profitSplit(10000, '25_75')).toMatchObject({ companyCents: 2500, partnerCents: 7500 });
    expect(profitSplit(10000, '50_50')).toMatchObject({ companyCents: 5000, partnerCents: 5000 });
    expect(profitSplit(10000, '90_10')).toMatchObject({ companyCents: 9000, partnerCents: 1000 });
  });

  it('company absorbs the rounding remainder — no cent created or lost', () => {
    const policies = Object.keys(PROFIT_SPLIT_POLICIES) as ProfitSplitPolicyId[];
    for (let gross = 0; gross <= 5000; gross += 7) {
      for (const p of policies) {
        const r = profitSplit(gross, p);
        expect(r.companyCents + r.partnerCents).toBe(gross);
        expect(r.companyCents).toBeGreaterThanOrEqual(0);
        expect(r.partnerCents).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('company share honors policy direction', () => {
    // 999 @ 50/50: partner = floor(499.5) = 499, company = 500 (remainder cent)
    expect(profitSplit(999, '50_50')).toMatchObject({ companyCents: 500, partnerCents: 499 });
    // 90/10 keeps the vast majority for the company
    const r = profitSplit(12345, '90_10');
    expect(r.companyCents).toBeGreaterThan(r.partnerCents * 5);
  });

  it('rejects bad input', () => {
    expect(() => profitSplit(-1, '50_50')).toThrow();
    expect(() => profitSplit(10.5, '50_50')).toThrow();
    // @ts-expect-error unknown policy
    expect(() => profitSplit(100, 'bogus')).toThrow();
  });
});
