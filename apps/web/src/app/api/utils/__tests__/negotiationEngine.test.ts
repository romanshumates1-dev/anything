/**
 * Comprehensive Tests for Negotiation Engine
 *
 * CRITICAL: $5,000 FEE FLOOR (500_000 cents) is NON-NEGOTIABLE
 * These tests verify ACTUAL LOGIC EXECUTION, not just file existence.
 */

import { describe, it, expect } from 'vitest';
import {
  FEE_FLOOR_CENTS,
  TERM_LIMITS,
  DEFAULT_CONCESSION_CURVE,
  negotiateInspectionDays,
  negotiateAttorneyModDays,
  negotiateClosingDays,
  defaultTerms,
  validateFeeFloor,
  calculateBuyerFloor,
  computeNextOffer,
  createBuyerOfferState,
  validateBuyerCounter,
  counterAcceptable,
  formatOffer,
  injectOffer,
  extractDollarAmountsCents,
  containsSpelledAmount,
  numericGuard,
  OFFER_SLOT,
  type OfferState,
} from '../negotiationEngine';

describe('Negotiation Engine', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // FEE FLOOR ENFORCEMENT - THE MOST CRITICAL TESTS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Fee Floor Enforcement ($5,000 HARD MINIMUM)', () => {
    it('FEE_FLOOR_CENTS equals 500,000 (= $5,000)', () => {
      expect(FEE_FLOOR_CENTS).toBe(500_000);
      console.log(`✓ FEE_FLOOR_CENTS = ${FEE_FLOOR_CENTS} cents = $${FEE_FLOOR_CENTS / 100}`);
    });

    it('validateFeeFloor rejects $4,999 (below floor)', () => {
      const result = validateFeeFloor(499_900); // $4,999
      expect(result.valid).toBe(false);
      expect(result.walk).toBe(true);
      console.log(`✓ $4,999 fee rejected: valid=${result.valid}, walk=${result.walk}`);
    });

    it('validateFeeFloor accepts exactly $5,000', () => {
      const result = validateFeeFloor(500_000); // $5,000
      expect(result.valid).toBe(true);
      expect(result.walk).toBe(false);
      console.log(`✓ $5,000 fee accepted: valid=${result.valid}, walk=${result.walk}`);
    });

    it('validateFeeFloor accepts $10,000 (above floor)', () => {
      const result = validateFeeFloor(1_000_000); // $10,000
      expect(result.valid).toBe(true);
      expect(result.walk).toBe(false);
      console.log(`✓ $10,000 fee accepted: valid=${result.valid}, walk=${result.walk}`);
    });

    it('calculateBuyerFloor adds $5,000 to contract price', () => {
      const contractPrice = 10_000_000; // $100,000
      const floor = calculateBuyerFloor(contractPrice);
      expect(floor).toBe(contractPrice + FEE_FLOOR_CENTS);
      expect(floor).toBe(10_500_000); // $105,000
      console.log(`✓ Contract $100,000 → Buyer floor $${floor / 100} (includes $5k fee)`);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TERM LIMITS - INSPECTION, ATTORNEY, CLOSING, EARNEST
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Term Limits Configuration', () => {
    it('TERM_LIMITS has correct inspection days range', () => {
      expect(TERM_LIMITS.inspectionDays).toEqual({ min: 7, max: 21, default: 14 });
      console.log(`✓ Inspection: min=${TERM_LIMITS.inspectionDays.min}, max=${TERM_LIMITS.inspectionDays.max}, default=${TERM_LIMITS.inspectionDays.default}`);
    });

    it('TERM_LIMITS has correct attorney mod days range', () => {
      expect(TERM_LIMITS.attorneyModDays).toEqual({ min: 3, max: 10, default: 5 });
      console.log(`✓ Attorney mod: min=${TERM_LIMITS.attorneyModDays.min}, max=${TERM_LIMITS.attorneyModDays.max}, default=${TERM_LIMITS.attorneyModDays.default}`);
    });

    it('TERM_LIMITS has correct closing days range', () => {
      expect(TERM_LIMITS.closingDays).toEqual({ min: 7, max: 45, default: 21 });
      console.log(`✓ Closing: min=${TERM_LIMITS.closingDays.min}, max=${TERM_LIMITS.closingDays.max}, default=${TERM_LIMITS.closingDays.default}`);
    });

    it('TERM_LIMITS has correct earnest money range', () => {
      expect(TERM_LIMITS.earnestMoneyDollars).toEqual({ min: 500, max: 5000, default: 1000 });
      console.log(`✓ Earnest: min=$${TERM_LIMITS.earnestMoneyDollars.min}, max=$${TERM_LIMITS.earnestMoneyDollars.max}, default=$${TERM_LIMITS.earnestMoneyDollars.default}`);
    });
  });

  describe('Inspection Days Negotiation', () => {
    it('clamps seller request of 5 days up to minimum 7', () => {
      const result = negotiateInspectionDays(5);
      expect(result.days).toBe(7);
      expect(result.negotiated).toBe(true);
      console.log(`✓ Seller requested 5 days → clamped to ${result.days}, negotiated=${result.negotiated}`);
    });

    it('clamps seller request of 30 days down to maximum 21', () => {
      const result = negotiateInspectionDays(30);
      expect(result.days).toBe(21);
      expect(result.negotiated).toBe(true);
      console.log(`✓ Seller requested 30 days → clamped to ${result.days}, negotiated=${result.negotiated}`);
    });

    it('accepts seller request of 10 days (within range)', () => {
      const result = negotiateInspectionDays(10);
      expect(result.days).toBe(10);
      expect(result.negotiated).toBe(false);
      console.log(`✓ Seller requested 10 days → accepted as ${result.days}, negotiated=${result.negotiated}`);
    });

    it('uses buyer preference when no seller request', () => {
      const result = negotiateInspectionDays(undefined, 18);
      expect(result.days).toBe(18);
      expect(result.negotiated).toBe(false);
      console.log(`✓ Buyer preference 18 days → ${result.days}, negotiated=${result.negotiated}`);
    });

    it('returns default 14 when no preferences', () => {
      const result = negotiateInspectionDays();
      expect(result.days).toBe(14);
      expect(result.negotiated).toBe(false);
      console.log(`✓ No preferences → default ${result.days} days`);
    });
  });

  describe('Attorney Mod Days Negotiation', () => {
    it('clamps request of 1 day up to minimum 3', () => {
      expect(negotiateAttorneyModDays(1)).toBe(3);
    });

    it('clamps request of 15 days down to maximum 10', () => {
      expect(negotiateAttorneyModDays(15)).toBe(10);
    });

    it('returns default 5 when no request', () => {
      expect(negotiateAttorneyModDays()).toBe(5);
    });
  });

  describe('Closing Days Negotiation', () => {
    it('uses maximum of seller and buyer requests when both provided', () => {
      // Seller wants 14, buyer can do minimum 21 → use 21
      expect(negotiateClosingDays(14, 21)).toBe(21);
    });

    it('clamps to minimum 7 days', () => {
      expect(negotiateClosingDays(3)).toBe(7);
    });

    it('clamps to maximum 45 days', () => {
      expect(negotiateClosingDays(60)).toBe(45);
    });

    it('returns default 21 when no request', () => {
      expect(negotiateClosingDays()).toBe(21);
    });
  });

  describe('Default Terms', () => {
    it('returns all default values', () => {
      const terms = defaultTerms();
      expect(terms).toEqual({
        inspectionDays: 14,
        attorneyModDays: 5,
        closingDays: 21,
        earnestMoneyDollars: 1000,
      });
      console.log('✓ Default terms:', JSON.stringify(terms));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // OFFER COMPUTATION - CONCESSION CURVE AND BOUNDS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Offer Computation', () => {
    it('DEFAULT_CONCESSION_CURVE is [0.4, 0.25, 0.15, 0.1]', () => {
      expect(DEFAULT_CONCESSION_CURVE).toEqual([0.4, 0.25, 0.15, 0.1]);
    });

    describe('Seller Side (opens LOW, concedes UP)', () => {
      it('round 0 returns opener', () => {
        const state: OfferState = {
          side: 'seller',
          openerCents: 8_000_000, // $80,000 opener
          clampCents: 10_000_000, // $100,000 ceiling
          round: 0,
        };
        const result = computeNextOffer(state);
        expect(result).toEqual({ kind: 'offer', offerCents: 8_000_000 });
        console.log(`✓ Seller round 0: $${result.kind === 'offer' ? result.offerCents / 100 : 'walk'}`);
      });

      it('round 1 concedes 40% of gap', () => {
        const state: OfferState = {
          side: 'seller',
          openerCents: 8_000_000,
          clampCents: 10_000_000,
          round: 1,
          lastOfferCents: 8_000_000,
        };
        const result = computeNextOffer(state);
        // Gap = $100k - $80k = $20k. 40% of $20k = $8k. New offer = $80k + $8k = $88k
        expect(result).toEqual({ kind: 'offer', offerCents: 8_800_000 });
        console.log(`✓ Seller round 1: gap=$20k, 40%=$8k → $${result.kind === 'offer' ? result.offerCents / 100 : 'walk'}`);
      });

      it('round 2 concedes 25% of remaining gap', () => {
        const state: OfferState = {
          side: 'seller',
          openerCents: 8_000_000,
          clampCents: 10_000_000,
          round: 2,
          lastOfferCents: 8_800_000,
        };
        const result = computeNextOffer(state);
        // Remaining gap = $100k - $88k = $12k. 25% of $12k = $3k. New offer = $88k + $3k = $91k
        expect(result).toEqual({ kind: 'offer', offerCents: 9_100_000 });
        console.log(`✓ Seller round 2: remaining gap=$12k, 25%=$3k → $${result.kind === 'offer' ? result.offerCents / 100 : 'walk'}`);
      });

      it('never exceeds ceiling', () => {
        const state: OfferState = {
          side: 'seller',
          openerCents: 9_900_000,
          clampCents: 10_000_000,
          round: 1,
          lastOfferCents: 9_900_000,
        };
        const result = computeNextOffer(state);
        // Gap = $1k. 40% = $400. But clamped to ceiling.
        expect(result.kind).toBe('offer');
        if (result.kind === 'offer') {
          expect(result.offerCents).toBeLessThanOrEqual(10_000_000);
        }
      });

      it('walks away after curve exhausted', () => {
        const state: OfferState = {
          side: 'seller',
          openerCents: 8_000_000,
          clampCents: 10_000_000,
          round: 5, // Curve only has 4 entries
          lastOfferCents: 9_500_000,
        };
        const result = computeNextOffer(state);
        expect(result).toEqual({ kind: 'walk_away' });
        console.log('✓ Seller walks away after round 5 (curve exhausted)');
      });

      it('walks away if opener > ceiling (invalid geometry)', () => {
        const state: OfferState = {
          side: 'seller',
          openerCents: 12_000_000, // Opener above ceiling - invalid
          clampCents: 10_000_000,
          round: 0,
        };
        const result = computeNextOffer(state);
        expect(result).toEqual({ kind: 'walk_away' });
      });
    });

    describe('Buyer Side (opens HIGH, concedes DOWN to floor)', () => {
      it('round 0 returns opener', () => {
        const state: OfferState = {
          side: 'buyer',
          openerCents: 12_000_000, // $120,000 opener
          clampCents: 10_500_000, // $105,000 floor (includes $5k fee)
          round: 0,
        };
        const result = computeNextOffer(state);
        expect(result).toEqual({ kind: 'offer', offerCents: 12_000_000 });
        console.log(`✓ Buyer round 0: $${result.kind === 'offer' ? result.offerCents / 100 : 'walk'}`);
      });

      it('round 1 concedes 40% of gap DOWN', () => {
        const state: OfferState = {
          side: 'buyer',
          openerCents: 12_000_000,
          clampCents: 10_500_000,
          round: 1,
          lastOfferCents: 12_000_000,
        };
        const result = computeNextOffer(state);
        // Gap = $120k - $105k = $15k. 40% of $15k = $6k. New offer = $120k - $6k = $114k
        expect(result).toEqual({ kind: 'offer', offerCents: 11_400_000 });
        console.log(`✓ Buyer round 1: gap=$15k, 40%=$6k down → $${result.kind === 'offer' ? result.offerCents / 100 : 'walk'}`);
      });

      it('NEVER goes below floor (fee floor protection)', () => {
        const state: OfferState = {
          side: 'buyer',
          openerCents: 10_600_000, // Very close to floor
          clampCents: 10_500_000, // Floor
          round: 1,
          lastOfferCents: 10_600_000,
        };
        const result = computeNextOffer(state);
        expect(result.kind).toBe('offer');
        if (result.kind === 'offer') {
          expect(result.offerCents).toBeGreaterThanOrEqual(10_500_000);
          console.log(`✓ Buyer never below floor: offer=$${result.offerCents / 100}, floor=$105,000`);
        }
      });

      it('walks away if opener < floor (invalid geometry)', () => {
        const state: OfferState = {
          side: 'buyer',
          openerCents: 10_000_000, // Opener below floor - invalid
          clampCents: 10_500_000,
          round: 0,
        };
        const result = computeNextOffer(state);
        expect(result).toEqual({ kind: 'walk_away' });
        console.log('✓ Buyer walks away if opener below floor');
      });
    });
  });

  describe('Buyer Offer State Creation', () => {
    it('creates state with correct floor calculation', () => {
      const contractPrice = 10_000_000; // $100,000
      const opener = 12_000_000; // $120,000
      const state = createBuyerOfferState(contractPrice, opener);

      expect(state.side).toBe('buyer');
      expect(state.openerCents).toBe(12_000_000);
      expect(state.clampCents).toBe(10_500_000); // $100k + $5k = $105k
      expect(state.round).toBe(0);
      console.log(`✓ Buyer state: opener=$${state.openerCents / 100}, floor=$${state.clampCents / 100}`);
    });

    it('throws if opener below fee floor', () => {
      const contractPrice = 10_000_000; // $100,000
      const opener = 10_400_000; // $104,000 - below $105k floor

      expect(() => createBuyerOfferState(contractPrice, opener))
        .toThrow(/below fee floor/);
      console.log('✓ Throws error when opener below fee floor');
    });
  });

  describe('Buyer Counter Validation', () => {
    it('rejects counter that would result in < $5k fee', () => {
      const contractPrice = 10_000_000; // $100,000
      const counter = 10_400_000; // $104,000 → fee = $4k (below floor)

      const result = validateBuyerCounter(contractPrice, counter);
      expect(result.acceptable).toBe(false);
      expect(result.feeIfAccepted).toBe(400_000); // $4,000
      expect(result.walk).toBe(true);
      console.log(`✓ Counter $104k rejected: fee=$${result.feeIfAccepted / 100}, walk=${result.walk}`);
    });

    it('accepts counter that results in >= $5k fee', () => {
      const contractPrice = 10_000_000; // $100,000
      const counter = 10_800_000; // $108,000 → fee = $8k (above floor)

      const result = validateBuyerCounter(contractPrice, counter);
      expect(result.acceptable).toBe(true);
      expect(result.feeIfAccepted).toBe(800_000); // $8,000
      expect(result.walk).toBe(false);
      console.log(`✓ Counter $108k accepted: fee=$${result.feeIfAccepted / 100}, acceptable=${result.acceptable}`);
    });
  });

  describe('Counter Acceptability', () => {
    it('seller accepts counter at or below ceiling', () => {
      expect(counterAcceptable('seller', 9_000_000, 10_000_000)).toBe(true);
      expect(counterAcceptable('seller', 10_000_000, 10_000_000)).toBe(true);
    });

    it('seller rejects counter above ceiling', () => {
      expect(counterAcceptable('seller', 11_000_000, 10_000_000)).toBe(false);
    });

    it('buyer accepts counter at or above floor', () => {
      expect(counterAcceptable('buyer', 11_000_000, 10_500_000)).toBe(true);
      expect(counterAcceptable('buyer', 10_500_000, 10_500_000)).toBe(true);
    });

    it('buyer rejects counter below floor', () => {
      expect(counterAcceptable('buyer', 10_000_000, 10_500_000)).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // OFFER FORMATTING AND INJECTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Offer Formatting', () => {
    it('formatOffer converts cents to dollar string', () => {
      expect(formatOffer(8_750_000)).toBe('$87,500');
      expect(formatOffer(10_000_000)).toBe('$100,000');
      expect(formatOffer(500_000)).toBe('$5,000');
      console.log('✓ formatOffer: 8,750,000 cents → $87,500');
    });

    it('OFFER_SLOT is {OFFER}', () => {
      expect(OFFER_SLOT).toBe('{OFFER}');
    });

    it('injectOffer substitutes slot', () => {
      const template = 'Our offer is {OFFER} for the property.';
      const result = injectOffer(template, 8_750_000);
      expect(result).toBe('Our offer is $87,500 for the property.');
      console.log('✓ injectOffer: "Our offer is {OFFER}" → "Our offer is $87,500"');
    });

    it('injectOffer throws if no slot', () => {
      expect(() => injectOffer('No slot here', 8_750_000))
        .toThrow(/exactly one/);
    });

    it('injectOffer throws if multiple slots', () => {
      expect(() => injectOffer('{OFFER} and {OFFER}', 8_750_000))
        .toThrow(/exactly one/);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // NUMERIC GUARD - SECURITY AGAINST PROMPT INJECTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Dollar Amount Extraction', () => {
    it('extracts standard dollar amounts', () => {
      const amounts = extractDollarAmountsCents('The price is $87,500.');
      expect(amounts).toEqual([8_750_000]);
      console.log('✓ "$87,500" → 8,750,000 cents');
    });

    it('extracts k notation', () => {
      const amounts = extractDollarAmountsCents('We can do 87.5k for this.');
      expect(amounts).toEqual([8_750_000]);
      console.log('✓ "87.5k" → 8,750,000 cents');
    });

    it('extracts multiple amounts', () => {
      const amounts = extractDollarAmountsCents('Between $80,000 and $90,000');
      expect(amounts).toContain(8_000_000);
      expect(amounts).toContain(9_000_000);
    });

    it('extracts bare large numbers', () => {
      const amounts = extractDollarAmountsCents('The number 87500 represents the price');
      expect(amounts).toContain(8_750_000);
    });
  });

  describe('Spelled Amount Detection', () => {
    it('detects "thousand"', () => {
      expect(containsSpelledAmount('eighty seven thousand dollars')).toBe(true);
    });

    it('detects "million"', () => {
      expect(containsSpelledAmount('one million dollars')).toBe(true);
    });

    it('detects spelled numbers', () => {
      expect(containsSpelledAmount('fifty thousand')).toBe(true);
      expect(containsSpelledAmount('ninety grand')).toBe(true);
    });

    it('allows normal text', () => {
      expect(containsSpelledAmount('I will call you back')).toBe(false);
    });
  });

  describe('Numeric Guard', () => {
    const ctx = {
      computedOfferCents: 8_750_000,
      approvedMinCents: 8_000_000,
      approvedMaxCents: 10_000_000,
    };

    it('passes when amount matches computed offer', () => {
      const result = numericGuard('Our offer is $87,500', ctx);
      expect(result.ok).toBe(true);
      console.log('✓ "$87,500" matches computed offer → ok');
    });

    it('fails when amount differs from computed offer', () => {
      const result = numericGuard('Our offer is $90,000', ctx);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('$90,000');
      console.log('✓ "$90,000" differs from computed $87,500 → blocked');
    });

    it('fails when amount outside approved range', () => {
      const narrowCtx = { ...ctx, approvedMaxCents: 8_500_000 };
      const result = numericGuard('Our offer is $87,500', narrowCtx);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('outside approved range');
    });

    it('fails when spelled amounts detected', () => {
      const result = numericGuard('Our offer is eighty seven thousand five hundred', ctx);
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('spelled-amount');
      console.log('✓ Spelled "eighty seven thousand" → blocked');
    });

    it('passes text with no amounts', () => {
      const result = numericGuard('Thank you for considering our offer.', ctx);
      expect(result.ok).toBe(true);
    });
  });
});
