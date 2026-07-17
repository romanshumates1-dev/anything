/**
 * Phase N — valuation engine (pure, deterministic, owner-only).
 *
 * This computes SUGGESTIONS for the OWNER. It never touches a prospect and the
 * AI never sees these numbers as something to send. Tested here with no DB and
 * no AI: same formula every time, garbage rejected, never NaN.
 */
import { describe, it, expect } from 'vitest';
import {
  computeValuation,
  type ValuationInputs,
  type NegotiationProfileParams,
} from '../valuationEngine';

const STANDARD: NegotiationProfileParams = {
  arvMultiplier: 0.7,
  repairLightPsf: 20,
  repairModeratePsf: 38,
  repairHeavyPsf: 60,
  bigTicketAdders: { roof20yr: 12500, hvac_dead: 7000, foundation: 'ESCALATE' },
  minFee: 10000,
  feeTargetMax: 15000,
  openerPctOfMax: 0.82,
  requiresManualComps: false,
};

const baseInputs: ValuationInputs = {
  arv: 200000,
  sqft: 1500,
  conditionTier: 'moderate',
  bigTicketFlags: [],
  hasAvm: true,
  compsCount: 4,
};

describe('computeValuation — core formula', () => {
  it('moderate tier: repairs = sqft × tier_psf; max = ARV×mult − repairs − minFee; min = max × opener', () => {
    const r = computeValuation(baseInputs, STANDARD);
    // repairs = 1500 × 38 = 57,000
    // buyer_max = 200000 × 0.70 − 57000 = 83,000
    // suggest_max = 83000 − 10000 = 73,000
    // suggest_min = 73000 × 0.82 = 59,860
    expect(r.suggestMax).toBe(73000);
    expect(r.suggestMin).toBe(59860);
    expect(r.confidence).toBe('HIGH'); // has_avm + comps≥3 + sqft
    expect(r.suggestMin).toBeLessThan(r.suggestMax);
  });

  it('tier selects the right $psf (light < moderate < heavy repairs → lower suggestions)', () => {
    const light = computeValuation({ ...baseInputs, conditionTier: 'light' }, STANDARD);
    const heavy = computeValuation({ ...baseInputs, conditionTier: 'heavy' }, STANDARD);
    expect(light.suggestMax).toBeGreaterThan(heavy.suggestMax);
    // light repairs 1500×20=30000 → max 200000×.7−30000−10000 = 100000
    expect(light.suggestMax).toBe(100000);
  });

  it('big-ticket adders subtract from buyer_max', () => {
    const r = computeValuation({ ...baseInputs, bigTicketFlags: ['roof20yr', 'hvac_dead'] }, STANDARD);
    // repairs 57000 + 12500 + 7000 = 76500 → max 200000×.7−76500−10000 = 53500
    expect(r.suggestMax).toBe(53500);
    expect(r.formulaTrace.some((l) => l.includes('roof20yr') && l.includes('12,500'))).toBe(true);
  });

  it('foundation flag → ESCALATE (no number), confidence forced LOW', () => {
    const r = computeValuation({ ...baseInputs, bigTicketFlags: ['foundation'] }, STANDARD);
    expect(r.escalate).toBe(true);
    expect(r.confidence).toBe('LOW');
    expect(r.formulaTrace.some((l) => /foundation/i.test(l) && /ESCALATE/i.test(l))).toBe(true);
  });

  it('requiresManualComps degrades confidence to LOW even with an AVM', () => {
    const r = computeValuation(baseInputs, { ...STANDARD, requiresManualComps: true });
    expect(r.confidence).toBe('LOW');
  });

  it('confidence: no AVM + no comps → LOW; AVM + comps → HIGH; partial → MED', () => {
    expect(computeValuation({ ...baseInputs, hasAvm: false, compsCount: 0 }, STANDARD).confidence).toBe('LOW');
    expect(computeValuation({ ...baseInputs, hasAvm: true, compsCount: 5 }, STANDARD).confidence).toBe('HIGH');
    expect(computeValuation({ ...baseInputs, hasAvm: false, compsCount: 4 }, STANDARD).confidence).toBe('MED');
  });
});

describe('computeValuation — garbage rejection (never NaN, never negative-as-real)', () => {
  it('missing/zero ARV → escalate, no numeric suggestion', () => {
    const r = computeValuation({ ...baseInputs, arv: 0 }, STANDARD);
    expect(r.escalate).toBe(true);
    expect(r.suggestMax).toBeNull();
    expect(r.suggestMin).toBeNull();
  });

  it('negative / NaN inputs are rejected, not propagated', () => {
    for (const bad of [-100, NaN, Infinity]) {
      const r = computeValuation({ ...baseInputs, arv: bad as number }, STANDARD);
      expect(r.escalate).toBe(true);
      expect(r.suggestMax).toBeNull();
    }
  });

  it('repairs exceeding buyer_max → clamps to escalate, never a negative offer', () => {
    // tiny ARV, heavy repairs → buyer_max goes negative
    const r = computeValuation({ ...baseInputs, arv: 50000, sqft: 3000, conditionTier: 'heavy' }, STANDARD);
    expect(r.suggestMax === null || r.suggestMax >= 0).toBe(true);
    if (r.suggestMax === null) expect(r.escalate).toBe(true);
  });

  it('missing sqft when tier needs it → MED/LOW confidence, still no NaN', () => {
    const r = computeValuation({ ...baseInputs, sqft: 0 }, STANDARD);
    expect(r.suggestMax === null || Number.isFinite(r.suggestMax)).toBe(true);
    expect(['LOW', 'MED']).toContain(r.confidence);
  });
});

describe('computeValuation — luxury (manual comps only)', () => {
  const LUXURY: NegotiationProfileParams = {
    arvMultiplier: 0.82,
    repairLightPsf: 0,
    repairModeratePsf: 0,
    repairHeavyPsf: 0, // owner-entered repairs only
    bigTicketAdders: { foundation: 'ESCALATE' },
    minFee: 50000,
    feeTargetMax: 200000,
    openerPctOfMax: 0.88,
    requiresManualComps: true,
  };

  it('luxury with owner-entered repairs + AVM still degrades to LOW (manual comps required)', () => {
    const r = computeValuation(
      { arv: 1500000, sqft: 5000, conditionTier: 'moderate', bigTicketFlags: [], hasAvm: true, compsCount: 6, manualRepairs: 120000 },
      LUXURY
    );
    expect(r.confidence).toBe('LOW');
    // buyer_max = 1.5M×.82 − 120000 − 50000 = 1,060,000 ; min = ×.88 = 932,800
    expect(r.suggestMax).toBe(1060000);
    expect(r.suggestMin).toBe(932800);
  });
});
