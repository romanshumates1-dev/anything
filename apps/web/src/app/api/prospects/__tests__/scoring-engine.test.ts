/**
 * Comprehensive Tests for Prospect Scoring Engine
 *
 * Tests ACTUAL LOGIC EXECUTION for seller and buyer scoring,
 * tier classification, and earnest money calculation.
 */

import { describe, it, expect } from 'vitest';
import {
  scoreSeller,
  scoreBuyer,
  calculateEarnestMoney,
  calculateEarnestAmount,
  getSellerTierInfo,
  getBuyerTierInfo,
  isContactable,
  requiresPOF,
  calculateEquityPercent,
  getLeadSourceQuality,
  type SellerSignals,
  type BuyerSignals,
  type SellerTier,
  type BuyerTier,
} from '../scoring-engine';

describe('Prospect Scoring Engine', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // SELLER SCORING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Seller Scoring', () => {
    describe('Individual Signal Weights', () => {
      it('pre-foreclosure adds +30 points', () => {
        const result = scoreSeller({ preForeclosure: true });
        expect(result.score).toBe(30);
        expect(result.signals).toContain('Pre-foreclosure/NOD (+30)');
        console.log(`✓ Pre-foreclosure: score=${result.score}, tier=${result.tier}`);
      });

      it('tax delinquent 2+ years adds +25 points', () => {
        const result = scoreSeller({ taxDelinquentYears: 2 });
        expect(result.score).toBe(25);
        expect(result.signals).toContain('Tax delinquent 2+ years (+25)');
        console.log(`✓ Tax delinquent 2yr: score=${result.score}`);
      });

      it('tax delinquent 1 year adds 0 points (threshold is 2)', () => {
        const result = scoreSeller({ taxDelinquentYears: 1 });
        expect(result.score).toBe(0);
        console.log(`✓ Tax delinquent 1yr: score=${result.score} (below threshold)`);
      });

      it('probate/inherited adds +20 points', () => {
        const result = scoreSeller({ probateOrInherited: true });
        expect(result.score).toBe(20);
        expect(result.signals).toContain('Probate/Inherited property (+20)');
      });

      it('code violations adds +15 points', () => {
        const result = scoreSeller({ codeViolations: true });
        expect(result.score).toBe(15);
      });

      it('absentee owner adds +15 points', () => {
        const result = scoreSeller({ absenteeOwner: true });
        expect(result.score).toBe(15);
      });

      it('high equity (>50%) adds +10 points', () => {
        const result = scoreSeller({ equityPercent: 60 });
        expect(result.score).toBe(10);
        expect(result.signals).toContain('High equity 60% (+10)');
      });

      it('equity at 50% adds 0 points (threshold is >50)', () => {
        const result = scoreSeller({ equityPercent: 50 });
        expect(result.score).toBe(0);
        console.log(`✓ Equity 50%: score=${result.score} (not above threshold)`);
      });

      it('vacant property adds +10 points', () => {
        const result = scoreSeller({ vacantProperty: true });
        expect(result.score).toBe(10);
      });

      it('long ownership (10+ years) adds +5 points', () => {
        const result = scoreSeller({ ownershipYears: 15 });
        expect(result.score).toBe(5);
        expect(result.signals).toContain('Long ownership 15 years (+5)');
      });

      it('ownership 9 years adds 0 points (threshold is 10)', () => {
        const result = scoreSeller({ ownershipYears: 9 });
        expect(result.score).toBe(0);
      });

      it('tired landlord adds +10 points', () => {
        const result = scoreSeller({ tiredLandlord: true });
        expect(result.score).toBe(10);
      });

      it('recent divorce adds +10 points', () => {
        const result = scoreSeller({ recentDivorce: true });
        expect(result.score).toBe(10);
      });

      // Motivated seller indicators
      it('urgent sale adds +20 points', () => {
        const result = scoreSeller({ urgentSale: true });
        expect(result.score).toBe(20);
        expect(result.signals).toContain('Urgent sale indicated (+20)');
      });

      it('behind on mortgage adds +15 points', () => {
        const result = scoreSeller({ behindOnMortgage: true });
        expect(result.score).toBe(15);
        expect(result.signals).toContain('Behind on mortgage (+15)');
      });

      it('property deteriorating adds +10 points', () => {
        const result = scoreSeller({ propertyDeteriorating: true });
        expect(result.score).toBe(10);
        expect(result.signals).toContain('Property deteriorating (+10)');
      });

      it('multiple listings adds +5 points', () => {
        const result = scoreSeller({ multipleListings: true });
        expect(result.score).toBe(5);
        expect(result.signals).toContain('Multiple listings (+5)');
      });

      it('price drops add +10 per drop (max 3)', () => {
        const result1 = scoreSeller({ priceDrops: 1 });
        expect(result1.score).toBe(10);
        expect(result1.signals).toContain('1 price drop(s) (+10)');

        const result2 = scoreSeller({ priceDrops: 2 });
        expect(result2.score).toBe(20);

        const result3 = scoreSeller({ priceDrops: 5 }); // capped at 3
        expect(result3.score).toBe(30);
        expect(result3.signals).toContain('5 price drop(s) (+30)');
      });

      // Lead source quality
      it('high quality lead source adds +10 points', () => {
        const result = scoreSeller({ leadSourceQuality: 'high' });
        expect(result.score).toBe(10);
      });

      it('medium quality lead source adds +5 points', () => {
        const result = scoreSeller({ leadSourceQuality: 'medium' });
        expect(result.score).toBe(5);
      });

      it('low quality lead source adds 0 points', () => {
        const result = scoreSeller({ leadSourceQuality: 'low' });
        expect(result.score).toBe(0);
      });

      it('lead source name is mapped to quality', () => {
        const result = scoreSeller({ leadSource: 'pre_foreclosure_list' });
        expect(result.score).toBe(10); // high quality
        expect(result.signals.some(s => s.includes('High-quality source'))).toBe(true);
      });
    });

    describe('Combined Signals', () => {
      it('pre-foreclosure + tax delinquent = 55 (WARM tier)', () => {
        const signals: SellerSignals = {
          preForeclosure: true, // +30
          taxDelinquentYears: 3, // +25
        };
        const result = scoreSeller(signals);
        expect(result.score).toBe(55);
        expect(result.tier).toBe('WARM');
        console.log(`✓ Pre-foreclosure + Tax delinquent: score=${result.score}, tier=${result.tier}`);
      });

      it('pre-foreclosure + probate + vacant = 60 (WARM tier)', () => {
        const signals: SellerSignals = {
          preForeclosure: true, // +30
          probateOrInherited: true, // +20
          vacantProperty: true, // +10
        };
        const result = scoreSeller(signals);
        expect(result.score).toBe(60);
        expect(result.tier).toBe('WARM');
      });

      it('pre-foreclosure + tax + code violations = 70 (HOT tier)', () => {
        const signals: SellerSignals = {
          preForeclosure: true, // +30
          taxDelinquentYears: 2, // +25
          codeViolations: true, // +15
        };
        const result = scoreSeller(signals);
        expect(result.score).toBe(70);
        expect(result.tier).toBe('HOT');
        console.log(`✓ Pre-foreclosure + Tax + Code: score=${result.score}, tier=${result.tier}`);
      });
    });

    describe('Score Capping', () => {
      it('caps score at 100 even with all signals', () => {
        const signals: SellerSignals = {
          preForeclosure: true, // +30
          taxDelinquentYears: 5, // +25
          probateOrInherited: true, // +20
          codeViolations: true, // +15
          absenteeOwner: true, // +15
          equityPercent: 80, // +10
          vacantProperty: true, // +10
          ownershipYears: 20, // +5
          tiredLandlord: true, // +10
          recentDivorce: true, // +10
        };
        // Total would be 150, but capped at 100
        const result = scoreSeller(signals);
        expect(result.score).toBe(100);
        expect(result.tier).toBe('HOT');
        console.log(`✓ All signals (raw=150) → capped score=${result.score}`);
      });
    });

    describe('Tier Thresholds', () => {
      it('score 70+ = HOT tier', () => {
        expect(scoreSeller({ preForeclosure: true, taxDelinquentYears: 2, codeViolations: true }).tier).toBe('HOT');
      });

      it('score 50-69 = WARM tier', () => {
        expect(scoreSeller({ preForeclosure: true, taxDelinquentYears: 2 }).tier).toBe('WARM');
        expect(scoreSeller({ preForeclosure: true, probateOrInherited: true }).tier).toBe('WARM');
      });

      it('score 30-49 = COOL tier', () => {
        expect(scoreSeller({ preForeclosure: true }).tier).toBe('COOL');
        expect(scoreSeller({ taxDelinquentYears: 2, codeViolations: true }).tier).toBe('COOL');
      });

      it('score < 30 = COLD tier', () => {
        expect(scoreSeller({ ownershipYears: 15 }).tier).toBe('COLD');
        expect(scoreSeller({}).tier).toBe('COLD');
      });
    });

    describe('Enhanced Equity Calculation', () => {
      it('calculates equity from ARV and debt', () => {
        const result = scoreSeller({
          estimatedArv: 200000,
          estimatedDebt: 80000,
        });
        // equity = (200000 - 80000) / 200000 = 60%
        expect(result.score).toBe(10); // High equity boost
        expect(result.signals.some(s => s.includes('High equity 60%'))).toBe(true);
      });

      it('includes repairs in equity calculation', () => {
        const result = scoreSeller({
          estimatedArv: 200000,
          estimatedDebt: 80000,
          estimatedRepairs: 40000,
        });
        // equity = (200000 - 80000 - 40000) / 200000 = 40%
        expect(result.score).toBe(0); // Not above 50% threshold
      });

      it('gives bonus for very high equity (>70%)', () => {
        const result = scoreSeller({
          estimatedArv: 200000,
          estimatedDebt: 40000,
        });
        // equity = (200000 - 40000) / 200000 = 80%
        expect(result.score).toBe(15); // 10 (high equity) + 5 (very high equity)
        expect(result.signals.some(s => s.includes('Very high equity'))).toBe(true);
      });

      it('prefers calculated equity over raw equityPercent', () => {
        const result = scoreSeller({
          equityPercent: 30, // Would not qualify
          estimatedArv: 200000,
          estimatedDebt: 80000, // 60% calculated
        });
        expect(result.score).toBe(10); // Uses calculated 60%, not the 30%
      });
    });

    describe('Recommended Actions', () => {
      it('HOT tier gets immediate outreach', () => {
        const result = scoreSeller({ preForeclosure: true, taxDelinquentYears: 2, codeViolations: true });
        expect(result.recommendedAction).toBe('Immediate outreach, priority follow-up');
      });

      it('WARM tier gets standard cadence', () => {
        const result = scoreSeller({ preForeclosure: true, taxDelinquentYears: 2 });
        expect(result.recommendedAction).toBe('Standard campaign cadence');
      });

      it('COOL tier gets low-priority drip', () => {
        const result = scoreSeller({ preForeclosure: true });
        expect(result.recommendedAction).toBe('Low-priority drip only');
      });

      it('COLD tier marked do not contact', () => {
        const result = scoreSeller({});
        expect(result.recommendedAction).toBe('Do not contact');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BUYER SCORING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Buyer Scoring', () => {
    describe('Individual Signal Weights', () => {
      it('cash purchases adds +30 points', () => {
        const result = scoreBuyer({ cashPurchases: true });
        expect(result.score).toBe(30);
        expect(result.signals).toContain('Cash purchases (+30)');
        console.log(`✓ Cash buyer: score=${result.score}, tier=${result.tier}`);
      });

      it('2+ purchases in 12mo adds +25 points', () => {
        const result = scoreBuyer({ purchasesLast12Months: 3 });
        expect(result.score).toBe(25);
        expect(result.signals).toContain('3 purchases in 12mo (+25)');
      });

      it('1 purchase in 12mo adds 0 points (threshold is 2)', () => {
        const result = scoreBuyer({ purchasesLast12Months: 1 });
        expect(result.score).toBe(0);
        console.log(`✓ 1 purchase: score=${result.score} (below threshold)`);
      });

      it('previous closed deal adds +20 points', () => {
        const result = scoreBuyer({ previousClosedDeal: true });
        expect(result.score).toBe(20);
        expect(result.signals).toContain('Previous closed deal with us (+20)');
      });

      it('verified POF adds +20 points', () => {
        const result = scoreBuyer({ verifiedProofOfFunds: true });
        expect(result.score).toBe(20);
        expect(result.signals).toContain('Verified proof of funds (+20)');
      });

      it('LLC/entity buyer adds +15 points', () => {
        const result = scoreBuyer({ llcOrEntity: true });
        expect(result.score).toBe(15);
        expect(result.signals).toContain('LLC/Entity buyer (+15)');
      });

      it('zip code match adds +10 points', () => {
        const result = scoreBuyer({ zipCodeMatch: true });
        expect(result.score).toBe(10);
      });

      it('price range match adds +10 points', () => {
        const result = scoreBuyer({ priceRangeMatch: true });
        expect(result.score).toBe(10);
      });

      it('property type match adds +5 points', () => {
        const result = scoreBuyer({ propertyTypeMatch: true });
        expect(result.score).toBe(5);
      });

      it('fast response <1hr adds +5 points', () => {
        const result = scoreBuyer({ avgResponseTimeHours: 0.5 });
        expect(result.score).toBe(5);
        expect(result.signals).toContain('Fast response time <1hr (+5)');
      });

      it('response time 1hr adds 0 points (threshold is <1)', () => {
        const result = scoreBuyer({ avgResponseTimeHours: 1 });
        expect(result.score).toBe(0);
      });
    });

    describe('VIP Tier Achievement', () => {
      it('cash + multiple purchases + POF + closed = 95 (VIP)', () => {
        const signals: BuyerSignals = {
          cashPurchases: true, // +30
          purchasesLast12Months: 5, // +25
          previousClosedDeal: true, // +20
          verifiedProofOfFunds: true, // +20
        };
        const result = scoreBuyer(signals);
        expect(result.score).toBe(95);
        expect(result.tier).toBe('VIP');
        console.log(`✓ Full VIP profile: score=${result.score}, tier=${result.tier}`);
      });

      it('minimum VIP = 80 points (cash + purchases + POF)', () => {
        const signals: BuyerSignals = {
          cashPurchases: true, // +30
          purchasesLast12Months: 2, // +25
          verifiedProofOfFunds: true, // +20
          llcOrEntity: true, // +15 → total 90 but need 80+
        };
        const result = scoreBuyer(signals);
        expect(result.score).toBeGreaterThanOrEqual(80);
        expect(result.tier).toBe('VIP');
      });
    });

    describe('Tier Thresholds', () => {
      it('score 80+ = VIP tier', () => {
        const result = scoreBuyer({
          cashPurchases: true, // +30
          purchasesLast12Months: 3, // +25
          verifiedProofOfFunds: true, // +20
          llcOrEntity: true, // +15 = 90 total (VIP)
        });
        expect(result.tier).toBe('VIP');
      });

      it('score 60-79 = VERIFIED tier', () => {
        const result = scoreBuyer({
          cashPurchases: true,
          purchasesLast12Months: 2,
        });
        expect(result.score).toBe(55); // Actually 55
        // Let's try a combo that hits 60-79
        const result2 = scoreBuyer({
          cashPurchases: true,
          purchasesLast12Months: 3,
          llcOrEntity: true,
        });
        expect(result2.score).toBe(70);
        expect(result2.tier).toBe('VERIFIED');
        console.log(`✓ VERIFIED tier: score=${result2.score}`);
      });

      it('score 40-59 = PROSPECT tier', () => {
        const result = scoreBuyer({
          cashPurchases: true,
          llcOrEntity: true,
        });
        expect(result.score).toBe(45);
        expect(result.tier).toBe('PROSPECT');
        console.log(`✓ PROSPECT tier: score=${result.score}`);
      });

      it('score < 40 = UNVERIFIED tier', () => {
        const result = scoreBuyer({ cashPurchases: true });
        expect(result.score).toBe(30);
        expect(result.tier).toBe('UNVERIFIED');
        console.log(`✓ UNVERIFIED tier: score=${result.score}`);
      });

      it('no signals = 0 points (UNVERIFIED)', () => {
        const result = scoreBuyer({});
        expect(result.score).toBe(0);
        expect(result.tier).toBe('UNVERIFIED');
        console.log(`✓ No signals: score=${result.score}, tier=${result.tier}`);
      });
    });

    describe('Earnest Money Ranges', () => {
      it('VIP tier: $100-$500', () => {
        const result = scoreBuyer({
          cashPurchases: true, // +30
          purchasesLast12Months: 3, // +25
          verifiedProofOfFunds: true, // +20
          llcOrEntity: true, // +15 = 90 total (VIP)
        });
        expect(result.tier).toBe('VIP');
        expect(result.earnestMoney).toEqual({ min: 100, max: 500 });
        console.log(`✓ VIP earnest: $${result.earnestMoney.min}-$${result.earnestMoney.max}`);
      });

      it('VERIFIED tier: $500-$1500', () => {
        const result = scoreBuyer({
          cashPurchases: true,
          purchasesLast12Months: 3,
          llcOrEntity: true,
        });
        expect(result.tier).toBe('VERIFIED');
        expect(result.earnestMoney).toEqual({ min: 500, max: 1500 });
        console.log(`✓ VERIFIED earnest: $${result.earnestMoney.min}-$${result.earnestMoney.max}`);
      });

      it('PROSPECT tier: $1500-$3000', () => {
        const result = scoreBuyer({
          cashPurchases: true,
          llcOrEntity: true,
        });
        expect(result.tier).toBe('PROSPECT');
        expect(result.earnestMoney).toEqual({ min: 1500, max: 3000 });
        console.log(`✓ PROSPECT earnest: $${result.earnestMoney.min}-$${result.earnestMoney.max}`);
      });

      it('UNVERIFIED tier: $3000-$5000', () => {
        const result = scoreBuyer({});
        expect(result.tier).toBe('UNVERIFIED');
        expect(result.earnestMoney).toEqual({ min: 3000, max: 5000 });
        console.log(`✓ UNVERIFIED earnest: $${result.earnestMoney.min}-$${result.earnestMoney.max}`);
      });
    });

    describe('Priority Messages', () => {
      it('VIP gets first look exclusive', () => {
        const result = scoreBuyer({
          cashPurchases: true, // +30
          purchasesLast12Months: 3, // +25
          verifiedProofOfFunds: true, // +20
          llcOrEntity: true, // +15 = 90 total (VIP)
        });
        expect(result.priority).toBe('First look, 2hr exclusive');
      });

      it('VERIFIED gets standard blasts', () => {
        const result = scoreBuyer({
          cashPurchases: true,
          purchasesLast12Months: 3,
          llcOrEntity: true,
        });
        expect(result.priority).toBe('Standard deal blasts');
      });

      it('PROSPECT gets deals after 24hr', () => {
        const result = scoreBuyer({
          cashPurchases: true,
          llcOrEntity: true,
        });
        expect(result.priority).toBe('Deals after 24hr if unsold');
      });

      it('UNVERIFIED requires POF first', () => {
        const result = scoreBuyer({});
        expect(result.priority).toBe('Require POF first');
      });
    });

    describe('Score Capping', () => {
      it('caps at 100 even with all signals', () => {
        const signals: BuyerSignals = {
          cashPurchases: true, // +30
          purchasesLast12Months: 10, // +25
          llcOrEntity: true, // +15
          verifiedProofOfFunds: true, // +20
          previousClosedDeal: true, // +20
          zipCodeMatch: true, // +10
          priceRangeMatch: true, // +10
          propertyTypeMatch: true, // +5
          avgResponseTimeHours: 0.1, // +5
        };
        // Total would be 140, capped at 100
        const result = scoreBuyer(signals);
        expect(result.score).toBe(100);
        expect(result.tier).toBe('VIP');
        console.log(`✓ All signals (raw=140) → capped score=${result.score}`);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EARNEST MONEY CALCULATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Earnest Money Calculation', () => {
    describe('calculateEarnestMoney by tier', () => {
      it('VIP returns $100-$500', () => {
        expect(calculateEarnestMoney('VIP')).toEqual({ min: 100, max: 500 });
      });

      it('VERIFIED returns $500-$1500', () => {
        expect(calculateEarnestMoney('VERIFIED')).toEqual({ min: 500, max: 1500 });
      });

      it('PROSPECT returns $1500-$3000', () => {
        expect(calculateEarnestMoney('PROSPECT')).toEqual({ min: 1500, max: 3000 });
      });

      it('UNVERIFIED returns $3000-$5000', () => {
        expect(calculateEarnestMoney('UNVERIFIED')).toEqual({ min: 3000, max: 5000 });
      });

      it('unknown tier defaults to UNVERIFIED range', () => {
        // @ts-expect-error testing invalid input
        expect(calculateEarnestMoney('UNKNOWN')).toEqual({ min: 3000, max: 5000 });
      });
    });

    describe('calculateEarnestAmount by deal value', () => {
      it('VIP + $40k deal = $100 (min)', () => {
        const amount = calculateEarnestAmount('VIP', 40000);
        expect(amount).toBe(100);
        console.log(`✓ VIP $40k deal → earnest $${amount}`);
      });

      it('VIP + $75k deal = ~$232 (33% into range)', () => {
        const amount = calculateEarnestAmount('VIP', 75000);
        // Range $100-$500. 33% of $400 gap = $132. $100 + $132 = $232
        expect(amount).toBe(232);
        console.log(`✓ VIP $75k deal → earnest $${amount}`);
      });

      it('VIP + $150k deal = ~$364 (66% into range)', () => {
        const amount = calculateEarnestAmount('VIP', 150000);
        // Range $100-$500. 66% of $400 gap = $264. $100 + $264 = $364
        expect(amount).toBe(364);
        console.log(`✓ VIP $150k deal → earnest $${amount}`);
      });

      it('VIP + $250k deal = $500 (max)', () => {
        const amount = calculateEarnestAmount('VIP', 250000);
        expect(amount).toBe(500);
        console.log(`✓ VIP $250k deal → earnest $${amount}`);
      });

      it('UNVERIFIED + $40k deal = $3000 (min)', () => {
        const amount = calculateEarnestAmount('UNVERIFIED', 40000);
        expect(amount).toBe(3000);
        console.log(`✓ UNVERIFIED $40k deal → earnest $${amount}`);
      });

      it('UNVERIFIED + $250k deal = $5000 (max)', () => {
        const amount = calculateEarnestAmount('UNVERIFIED', 250000);
        expect(amount).toBe(5000);
        console.log(`✓ UNVERIFIED $250k deal → earnest $${amount}`);
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TIER UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Tier Utilities', () => {
    describe('getSellerTierInfo', () => {
      it('returns correct info for HOT', () => {
        const info = getSellerTierInfo('HOT');
        expect(info).toEqual({
          tier: 'HOT',
          min: 70,
          action: 'Immediate outreach, priority follow-up',
        });
      });

      it('returns correct info for COLD', () => {
        const info = getSellerTierInfo('COLD');
        expect(info).toEqual({
          tier: 'COLD',
          min: 0,
          action: 'Do not contact',
        });
      });
    });

    describe('getBuyerTierInfo', () => {
      it('returns correct info for VIP', () => {
        const info = getBuyerTierInfo('VIP');
        expect(info).toEqual({
          tier: 'VIP',
          min: 80,
          earnest: { min: 100, max: 500 },
          priority: 'First look, 2hr exclusive',
        });
      });

      it('returns correct info for UNVERIFIED', () => {
        const info = getBuyerTierInfo('UNVERIFIED');
        expect(info).toEqual({
          tier: 'UNVERIFIED',
          min: 0,
          earnest: { min: 3000, max: 5000 },
          priority: 'Require POF first',
        });
      });
    });

    describe('isContactable', () => {
      it('HOT is contactable', () => {
        expect(isContactable('HOT')).toBe(true);
      });

      it('WARM is contactable', () => {
        expect(isContactable('WARM')).toBe(true);
      });

      it('COOL is contactable', () => {
        expect(isContactable('COOL')).toBe(true);
      });

      it('COLD is NOT contactable', () => {
        expect(isContactable('COLD')).toBe(false);
        console.log('✓ COLD tier is not contactable');
      });
    });

    describe('requiresPOF', () => {
      it('VIP does not require POF', () => {
        expect(requiresPOF('VIP')).toBe(false);
      });

      it('VERIFIED does not require POF', () => {
        expect(requiresPOF('VERIFIED')).toBe(false);
      });

      it('PROSPECT does not require POF', () => {
        expect(requiresPOF('PROSPECT')).toBe(false);
      });

      it('UNVERIFIED requires POF', () => {
        expect(requiresPOF('UNVERIFIED')).toBe(true);
        console.log('✓ UNVERIFIED tier requires POF');
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EQUITY CALCULATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Equity Calculation', () => {
    it('calculates equity from ARV and debt', () => {
      const result = calculateEquityPercent({
        estimatedArv: 200000,
        estimatedDebt: 80000,
      });
      expect(result).toBe(60);
    });

    it('includes repairs in calculation', () => {
      const result = calculateEquityPercent({
        estimatedArv: 200000,
        estimatedDebt: 80000,
        estimatedRepairs: 40000,
      });
      expect(result).toBe(40);
    });

    it('returns undefined when ARV is missing', () => {
      const result = calculateEquityPercent({
        estimatedDebt: 80000,
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined when ARV is zero', () => {
      const result = calculateEquityPercent({
        estimatedArv: 0,
        estimatedDebt: 80000,
      });
      expect(result).toBeUndefined();
    });

    it('treats missing debt as zero', () => {
      const result = calculateEquityPercent({
        estimatedArv: 200000,
      });
      expect(result).toBe(100);
    });

    it('caps at 0% for underwater properties', () => {
      const result = calculateEquityPercent({
        estimatedArv: 100000,
        estimatedDebt: 150000,
      });
      expect(result).toBe(0);
    });

    it('caps at 100%', () => {
      const result = calculateEquityPercent({
        estimatedArv: 200000,
        estimatedDebt: -50000, // Weird edge case
      });
      expect(result).toBe(100);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // LEAD SOURCE QUALITY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lead Source Quality', () => {
    it('identifies high quality sources', () => {
      expect(getLeadSourceQuality('pre_foreclosure_list')).toBe('high');
      expect(getLeadSourceQuality('tax_delinquent_list')).toBe('high');
      expect(getLeadSourceQuality('probate_filing')).toBe('high');
      expect(getLeadSourceQuality('code_violation')).toBe('high');
      expect(getLeadSourceQuality('eviction_filing')).toBe('high');
      expect(getLeadSourceQuality('divorce_filing')).toBe('high');
    });

    it('identifies medium quality sources', () => {
      expect(getLeadSourceQuality('absentee_owner_list')).toBe('medium');
      expect(getLeadSourceQuality('vacant_property_list')).toBe('medium');
      expect(getLeadSourceQuality('pva_records')).toBe('medium');
      expect(getLeadSourceQuality('driving_for_dollars')).toBe('medium');
      expect(getLeadSourceQuality('direct_mail_response')).toBe('medium');
    });

    it('identifies low quality sources', () => {
      expect(getLeadSourceQuality('cold_list')).toBe('low');
      expect(getLeadSourceQuality('purchased_list')).toBe('low');
      expect(getLeadSourceQuality('website_form')).toBe('low');
    });

    it('defaults unknown sources to low', () => {
      expect(getLeadSourceQuality('random_source')).toBe('low');
      expect(getLeadSourceQuality('')).toBe('low');
    });

    it('normalizes source names with special characters', () => {
      expect(getLeadSourceQuality('Pre-Foreclosure List')).toBe('high');
      expect(getLeadSourceQuality('TAX_DELINQUENT_LIST')).toBe('high');
    });
  });
});
