/**
 * Tests for Regional Min-Max Wholesaling Fee Engine
 */
import { describe, it, expect } from 'vitest';
import {
  calculateRegionalFee,
  getRegionalMarket,
  validateRegionalFee,
  FEE_FLOOR_DOLLARS,
  REGIONAL_MARKETS,
  ANNUAL_INFLATION_RATE,
  BASE_FEE_RATE,
  type USState,
} from '../regional-fee-engine';
import { FEE_FLOOR_CENTS } from '../negotiationEngine';

describe('Regional Fee Engine', () => {
  describe('fee floor enforcement', () => {
    it('never returns fee below $5,000 floor', () => {
      const cheapProperty = calculateRegionalFee({
        state: 'MS',
        propertyValueDollars: 50_000,
      });
      expect(cheapProperty.minFeeCents).toBe(FEE_FLOOR_CENTS);
      expect(cheapProperty.minFeeCents).toBe(500_000);
    });

    it('FEE_FLOOR_DOLLARS equals $5,000', () => {
      expect(FEE_FLOOR_DOLLARS).toBe(5000);
    });

    it('minimum fee is always exactly $5,000', () => {
      const states: USState[] = ['TX', 'FL', 'CA', 'OH', 'MS'];
      for (const state of states) {
        const result = calculateRegionalFee({ state, propertyValueDollars: 100_000 });
        expect(result.minFeeCents).toBe(500_000);
      }
    });
  });

  describe('regional market data', () => {
    it('has data for all major markets', () => {
      const majorStates: USState[] = ['TX', 'FL', 'CA', 'AZ', 'GA', 'NC', 'OH', 'NY'];
      for (const state of majorStates) {
        expect(REGIONAL_MARKETS[state]).toBeDefined();
        expect(REGIONAL_MARKETS[state].medianHomePriceDollars).toBeGreaterThan(0);
      }
    });

    it('California has highest median price', () => {
      const caMed = REGIONAL_MARKETS.CA.medianHomePriceDollars;
      const txMed = REGIONAL_MARKETS.TX.medianHomePriceDollars;
      expect(caMed).toBeGreaterThan(txMed);
      expect(caMed).toBeGreaterThan(700_000);
    });

    it('Midwest states have lower medians', () => {
      const ohMed = REGIONAL_MARKETS.OH.medianHomePriceDollars;
      const msMed = REGIONAL_MARKETS.MS.medianHomePriceDollars;
      expect(ohMed).toBeLessThan(300_000);
      expect(msMed).toBeLessThan(250_000);
    });

    it('Texas has moderate disclosure level', () => {
      expect(REGIONAL_MARKETS.TX.disclosureLevel).toBe('moderate');
    });

    it('California has strict disclosure level', () => {
      expect(REGIONAL_MARKETS.CA.disclosureLevel).toBe('strict');
    });
  });

  describe('fee calculation', () => {
    it('higher property value = higher fee ceiling', () => {
      const low = calculateRegionalFee({ state: 'TX', propertyValueDollars: 200_000 });
      const high = calculateRegionalFee({ state: 'TX', propertyValueDollars: 500_000 });
      expect(high.maxFeeCents).toBeGreaterThan(low.maxFeeCents);
    });

    it('California has higher fees than Mississippi for same property value', () => {
      const ca = calculateRegionalFee({ state: 'CA', propertyValueDollars: 300_000 });
      const ms = calculateRegionalFee({ state: 'MS', propertyValueDollars: 300_000 });
      expect(ca.maxFeeCents).toBeGreaterThan(ms.maxFeeCents);
    });

    it('distressed property gets higher fee', () => {
      const normal = calculateRegionalFee({ state: 'TX', propertyValueDollars: 300_000, isDistressed: false });
      const distressed = calculateRegionalFee({ state: 'TX', propertyValueDollars: 300_000, isDistressed: true });
      expect(distressed.maxFeeCents).toBeGreaterThan(normal.maxFeeCents);
    });

    it('luxury property gets premium', () => {
      const normal = calculateRegionalFee({ state: 'TX', propertyValueDollars: 300_000, isLuxury: false });
      const luxury = calculateRegionalFee({ state: 'TX', propertyValueDollars: 300_000, isLuxury: true });
      expect(luxury.maxFeeCents).toBeGreaterThan(normal.maxFeeCents);
    });

    it('hot market (low DOM) gets higher fee', () => {
      const slow = calculateRegionalFee({ state: 'TX', propertyValueDollars: 300_000, daysOnMarket: 80 });
      const hot = calculateRegionalFee({ state: 'TX', propertyValueDollars: 300_000, daysOnMarket: 25 });
      expect(hot.maxFeeCents).toBeGreaterThan(slow.maxFeeCents);
    });

    it('target fee is between min and max', () => {
      const result = calculateRegionalFee({ state: 'TX', propertyValueDollars: 350_000 });
      expect(result.targetFeeCents).toBeGreaterThanOrEqual(result.minFeeCents);
      expect(result.targetFeeCents).toBeLessThanOrEqual(result.maxFeeCents);
    });
  });

  describe('inflation adjustment', () => {
    it('applies inflation from 2024 baseline', () => {
      const baseDate = new Date('2024-01-01');
      const futureDate = new Date('2026-01-01');

      const base = getRegionalMarket('TX', baseDate);
      const future = getRegionalMarket('TX', futureDate);

      // 2 years of inflation
      const expectedInflation = Math.pow(1 + ANNUAL_INFLATION_RATE, 2);
      const expectedMedian = REGIONAL_MARKETS.TX.medianHomePriceDollars * expectedInflation;

      expect(future.inflatedMedian).toBeCloseTo(expectedMedian, -2); // within $100
      expect(future.inflatedMedian).toBeGreaterThan(base.inflatedMedian);
    });

    it('no negative inflation before baseline', () => {
      const earlyDate = new Date('2023-01-01');
      const market = getRegionalMarket('TX', earlyDate);
      expect(market.inflatedMedian).toBe(REGIONAL_MARKETS.TX.medianHomePriceDollars);
    });
  });

  describe('fee validation', () => {
    it('rejects fee below $5,000 floor', () => {
      const result = validateRegionalFee(400_000, 'TX', 200_000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('below');
      expect(result.reason).toContain('$5,000');
    });

    it('accepts fee at floor', () => {
      const result = validateRegionalFee(500_000, 'TX', 200_000);
      expect(result.valid).toBe(true);
    });

    it('accepts reasonable fee within range', () => {
      const regional = calculateRegionalFee({ state: 'TX', propertyValueDollars: 300_000 });
      const result = validateRegionalFee(regional.targetFeeCents, 'TX', 300_000);
      expect(result.valid).toBe(true);
    });

    it('rejects fee way above ceiling', () => {
      const regional = calculateRegionalFee({ state: 'TX', propertyValueDollars: 300_000 });
      const absurdFee = regional.maxFeeCents * 3;
      const result = validateRegionalFee(absurdFee, 'TX', 300_000);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds');
    });
  });

  describe('realistic fee ranges', () => {
    it('$200k Texas property fee is reasonable', () => {
      const result = calculateRegionalFee({ state: 'TX', propertyValueDollars: 200_000 });
      // Should be $5k-$15k range for a $200k property
      expect(result.minFeeCents).toBe(500_000); // $5k floor
      expect(result.maxFeeCents).toBeGreaterThan(500_000);
      expect(result.maxFeeCents).toBeLessThan(3_000_000); // < $30k
    });

    it('$500k Florida property fee is reasonable', () => {
      const result = calculateRegionalFee({ state: 'FL', propertyValueDollars: 500_000 });
      // Should be $5k-$40k range for a $500k property
      expect(result.minFeeCents).toBe(500_000);
      expect(result.maxFeeCents).toBeGreaterThan(1_500_000); // > $15k
      expect(result.maxFeeCents).toBeLessThan(6_000_000); // < $60k
    });

    it('$1M California property fee is reasonable', () => {
      const result = calculateRegionalFee({ state: 'CA', propertyValueDollars: 1_000_000 });
      // Should be $5k-$80k range for a $1M property in CA
      expect(result.minFeeCents).toBe(500_000);
      expect(result.maxFeeCents).toBeGreaterThan(3_000_000); // > $30k
      expect(result.maxFeeCents).toBeLessThan(12_000_000); // < $120k
    });

    it('fee percentage is typically 3-8% of property value', () => {
      const states: USState[] = ['TX', 'FL', 'CA', 'OH'];
      for (const state of states) {
        const result = calculateRegionalFee({ state, propertyValueDollars: 350_000 });
        expect(result.feePercent).toBeGreaterThan(0.02); // > 2%
        expect(result.feePercent).toBeLessThan(0.12); // < 12%
      }
    });
  });

  describe('explanation output', () => {
    it('provides breakdown explanation', () => {
      const result = calculateRegionalFee({ state: 'TX', propertyValueDollars: 300_000 });
      expect(result.explanation.length).toBeGreaterThan(0);
      expect(result.explanation.some((e) => e.includes('State'))).toBe(true);
      expect(result.explanation.some((e) => e.includes('Base fee'))).toBe(true);
    });

    it('includes distress explanation when distressed', () => {
      const result = calculateRegionalFee({
        state: 'TX',
        propertyValueDollars: 300_000,
        isDistressed: true,
      });
      expect(result.explanation.some((e) => e.includes('Distress'))).toBe(true);
    });
  });

  describe('base fee rate', () => {
    it('base rate is 5%', () => {
      expect(BASE_FEE_RATE).toBe(0.05);
    });

    it('annual inflation rate is 3.5%', () => {
      expect(ANNUAL_INFLATION_RATE).toBe(0.035);
    });
  });
});
