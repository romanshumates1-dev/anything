/**
 * Phase V — two-sided deal economics + assignability (pure, deterministic).
 * This is the "$3k floor / realistic fee / assignable in the inspection window"
 * math. No AI, no prospect exposure — owner-facing suggestions only.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDealEconomics,
  feeEconomics,
  DEFAULT_FEE_FLOOR,
  DEFAULT_FEE_TARGET,
  DEFAULT_FEE_STRETCH,
  type NegotiationProfileParams,
} from '../valuationEngine';

const STANDARD: NegotiationProfileParams = {
  arvMultiplier: 0.7,
  repairLightPsf: 20, repairModeratePsf: 38, repairHeavyPsf: 60,
  bigTicketAdders: {},
  minFee: 10000, feeTargetMax: 15000, openerPctOfMax: 0.82,
  requiresManualComps: false,
};

describe('feeEconomics — realistic wholesale defaults + overrides', () => {
  it('defaults to $3k floor / $10k target / $30k stretch', () => {
    const bare: NegotiationProfileParams = { ...STANDARD, minFee: 0, feeTargetMax: 0 };
    const f = feeEconomics(bare);
    expect(f.floor).toBe(DEFAULT_FEE_FLOOR);
    expect(f.target).toBe(DEFAULT_FEE_TARGET);
    expect(f.stretch).toBe(DEFAULT_FEE_STRETCH);
  });

  it('explicit profile bands win (luxury keeps its own)', () => {
    const lux: NegotiationProfileParams = { ...STANDARD, feeFloor: 50000, feeTarget: 100000, feeStretch: 200000 };
    expect(feeEconomics(lux)).toEqual({ floor: 50000, target: 100000, stretch: 200000 });
  });

  it('market_multiplier calibrates state-level (e.g. 1.5×)', () => {
    const f = feeEconomics({ ...STANDARD, feeFloor: 3000, feeTarget: 10000, feeStretch: 30000 }, 1.5);
    expect(f).toEqual({ floor: 4500, target: 15000, stretch: 45000 });
  });
});

describe('computeDealEconomics — two-sided seller/buyer math', () => {
  // ARV 200k, repairs 40k → buyer_max = 200k×.7 − 40k = 100k
  const base = { arv: 200000, repairs: 40000 };
  const profile: NegotiationProfileParams = { ...STANDARD, feeFloor: 3000, feeTarget: 10000, feeStretch: 30000 };

  it('seller side: max clears the floor, suggest hits the target, opener discounts', () => {
    const e = computeDealEconomics(base, profile);
    expect(e.buyerMax).toBe(100000);
    expect(e.sellerMax).toBe(97000);      // 100k − 3k floor
    expect(e.sellerSuggest).toBe(90000);  // 100k − 10k target
    expect(e.sellerOpener).toBe(73800);   // 90k × .82
    expect(e.valid).toBe(true);
  });

  it('buyer side (after contract): ask_min = contract + floor; ask_open capped at buyer_max', () => {
    const e = computeDealEconomics({ ...base, contractPrice: 85000 }, profile);
    expect(e.buyerAskMin).toBe(88000);              // 85k + 3k floor
    expect(e.buyerAskOpen).toBe(100000);            // min(85k + 30k stretch, 100k buyer_max) = 100k
  });

  it('buyer ask_open uses stretch when below buyer_max', () => {
    const e = computeDealEconomics({ arv: 400000, repairs: 40000, contractPrice: 100000 }, profile);
    // buyer_max = 400k×.7 − 40k = 240k ; 100k + 30k = 130k < 240k → 130k
    expect(e.buyerAskOpen).toBe(130000);
  });
});

describe('computeDealEconomics — the 7-14-day assignability guarantee', () => {
  const profile: NegotiationProfileParams = { ...STANDARD, feeFloor: 3000, feeTarget: 10000, feeStretch: 30000 };
  const base = { arv: 200000, repairs: 40000 }; // buyer_max 100k, seller_max 97k

  it('contract at seller_suggest → ASSIGNABLE (fee well above floor)', () => {
    const e = computeDealEconomics({ ...base, contractPrice: 90000 }, profile);
    expect(e.assignable).toBe(true);
    expect(e.thinDeal).toBe(false);
  });

  it('contract exactly at seller_max (fee == floor) → still ASSIGNABLE (boundary)', () => {
    const e = computeDealEconomics({ ...base, contractPrice: 97000 }, profile); // 97k + 3k = 100k == buyer_max
    expect(e.assignable).toBe(true);
    expect(e.thinDeal).toBe(false);
  });

  it('override above seller_max → THIN DEAL + not assignable', () => {
    const e = computeDealEconomics({ ...base, contractPrice: 98500 }, profile); // 98.5k + 3k = 101.5k > 100k
    expect(e.assignable).toBe(false);
    expect(e.thinDeal).toBe(true);
    expect(e.formulaTrace.some((l) => /THIN DEAL/i.test(l))).toBe(true);
  });

  it('pre-contract (no contractPrice): buyer side null, assignable null, seller side still computed', () => {
    const e = computeDealEconomics(base, profile);
    expect(e.buyerAskMin).toBeNull();
    expect(e.assignable).toBeNull();
    expect(e.sellerSuggest).toBe(90000);
  });
});

describe('computeDealEconomics — garbage rejection (never NaN)', () => {
  it('invalid ARV → valid:false, no numbers', () => {
    const e = computeDealEconomics({ arv: 0, repairs: 40000 }, STANDARD);
    expect(e.valid).toBe(false);
    expect(e.assignable).toBeNull();
  });
  it('negative repairs → valid:false', () => {
    const e = computeDealEconomics({ arv: 200000, repairs: -5 }, STANDARD);
    expect(e.valid).toBe(false);
  });
});
