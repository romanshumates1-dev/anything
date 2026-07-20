import { describe, expect, it } from 'vitest';

import { trueTwilioCostCents } from './billing-math';
import {
  getPlan,
  getPublicPlans,
  includedSmsRetailValueCents,
  includedSmsSegments,
  isPlanId,
  PLAN_IDS,
  tierRetainedMarginCents,
  twilioCostPerSegmentCents,
} from './plans';

const COST = 1.1; // pin the cost basis for deterministic assertions

describe('plan registry', () => {
  it('has exactly the three tiers', () => {
    expect(PLAN_IDS).toEqual(['starter', 'professional', 'enterprise']);
  });
  it('isPlanId guards unknown ids', () => {
    expect(isPlanId('starter')).toBe(true);
    expect(isPlanId('gold')).toBe(false);
    expect(isPlanId(42)).toBe(false);
  });
  it('getPlan throws on unknown', () => {
    // @ts-expect-error invalid id
    expect(() => getPlan('gold')).toThrow();
  });
});

describe('every tier markup is within the owner-mandated 2x–3x band', () => {
  it.each(PLAN_IDS)('%s markup in [2,3]', (id) => {
    const p = getPlan(id);
    expect(p.smsMarkup).toBeGreaterThanOrEqual(2);
    expect(p.smsMarkup).toBeLessThanOrEqual(3);
  });
});

describe('CAP-BEFORE-SPEND holds for every metered tier', () => {
  const metered = PLAN_IDS.filter((id) => getPlan(id).smsBudgetCents !== null);

  it.each(metered)('%s: realized Twilio cost at cap <= funded budget', (id) => {
    const p = getPlan(id);
    const seg = includedSmsSegments(id, COST);
    expect(seg).not.toBeNull();
    const realized = trueTwilioCostCents(seg as number, COST);
    // Never spend more than the fee funded, and in fact stay under budget/markup.
    expect(realized).toBeLessThanOrEqual(p.smsBudgetCents as number);
    expect(realized).toBeLessThanOrEqual((p.smsBudgetCents as number) / p.smsMarkup + 1e-9);
    // Positive retained margin — the fee out-covers the Twilio cost.
    expect(tierRetainedMarginCents(id, COST) as number).toBeGreaterThan(0);
  });

  it('starter derives 1818 included segments at 1.1c', () => {
    expect(includedSmsSegments('starter', COST)).toBe(1818);
  });
  it('professional derives 6181 included segments at 1.1c', () => {
    expect(includedSmsSegments('professional', COST)).toBe(6181);
  });
  it('enterprise is unmetered (null allowance + null margin)', () => {
    expect(includedSmsSegments('enterprise', COST)).toBeNull();
    expect(tierRetainedMarginCents('enterprise', COST)).toBeNull();
  });
});

describe('getPublicPlans — the single source the /pricing page reads', () => {
  it('exposes display-safe data for all three tiers', () => {
    const pub = getPublicPlans(COST);
    expect(pub.map((p) => p.id)).toEqual(['starter', 'professional', 'enterprise']);
    const starter = pub.find((p) => p.id === 'starter')!;
    expect(starter.priceMonthly).toBe(99);
    expect(starter.includedSmsSegments).toBe(1818);
    expect(starter.byoAiKeyAllowed).toBe(false);
    const ent = pub.find((p) => p.id === 'enterprise')!;
    expect(ent.priceMonthly).toBeNull();
    expect(ent.includedSmsSegments).toBeNull();
    expect(ent.byoAiKeyAllowed).toBe(true);
  });
});

describe('includedSmsRetailValueCents — bundled-messaging retail value', () => {
  it('is the marked-up value of the included allowance', () => {
    // starter: ceil(1818 * 1.1 * 3)
    expect(includedSmsRetailValueCents('starter', COST)).toBe(Math.ceil(1818 * 1.1 * 3));
    expect(includedSmsRetailValueCents('enterprise', COST)).toBeNull();
  });
});

describe('twilioCostPerSegmentCents env override', () => {
  it('falls back to the default when env is unset/invalid', () => {
    const prev = process.env.TWILIO_COST_PER_SEGMENT_CENTS;
    delete process.env.TWILIO_COST_PER_SEGMENT_CENTS;
    expect(twilioCostPerSegmentCents()).toBeGreaterThan(0);
    process.env.TWILIO_COST_PER_SEGMENT_CENTS = 'not-a-number';
    expect(twilioCostPerSegmentCents()).toBeGreaterThan(0);
    process.env.TWILIO_COST_PER_SEGMENT_CENTS = '2.0';
    expect(twilioCostPerSegmentCents()).toBe(2.0);
    if (prev === undefined) delete process.env.TWILIO_COST_PER_SEGMENT_CENTS;
    else process.env.TWILIO_COST_PER_SEGMENT_CENTS = prev;
  });
});
