/**
 * COMPREHENSIVE PIPELINE INTEGRATION TESTS
 *
 * Tests the FULL wholesaling pipeline end-to-end:
 * 1. Seller lead comes in → Scored → Campaign qualified
 * 2. Contract generated → Fee floor enforced → Regional compliance
 * 3. Buyer matched → Scored → Earnest calculated
 * 4. Assignment created → $5k minimum enforced
 * 5. Compliance checks → Quiet hours → Disclosures
 *
 * NO MOCKS - Tests actual logic execution with real data flows.
 */

import { describe, it, expect } from 'vitest';

// Import ALL pipeline components
import {
  scoreSeller,
  scoreBuyer,
  calculateEarnestMoney,
  calculateEarnestAmount,
  isContactable,
  requiresPOF,
  type SellerSignals,
  type BuyerSignals,
} from '@/app/api/prospects/scoring-engine';

import {
  FEE_FLOOR_CENTS,
  TERM_LIMITS,
  negotiateInspectionDays,
  negotiateClosingDays,
  validateFeeFloor,
  calculateBuyerFloor,
  computeNextOffer,
  createBuyerOfferState,
  validateBuyerCounter,
  formatOffer,
  type OfferState,
} from '@/app/api/utils/negotiationEngine';

import {
  HIGH_VOLUME_CONFIG,
  getWarmupTarget,
  checkQualityGates,
  calculatePacing,
  type CampaignMetrics,
} from '@/app/api/campaigns/config/high-volume';

import {
  detectState,
  loadTemplate,
  getRequiredDisclosures,
  validateStateRequirements,
  validateContractVariables,
  MINIMUM_ASSIGNMENT_FEE,
  type DealData,
  type NegotiationRecord,
} from '@/app/api/contracts/engine';

import {
  checkQuietHours,
  getRequiredDisclosures as getMessagingDisclosures,
  generateCompliantSms,
} from '@/app/api/compliance/messaging-gate';

describe('PIPELINE INTEGRATION TESTS', () => {
  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 1: HOT SELLER LEAD → CONTRACT → BUYER MATCH
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scenario 1: Hot Seller Lead Full Pipeline', () => {
    // Simulated lead data
    const sellerLead = {
      id: 'lead-001',
      name: 'John Distressed',
      email: 'john@example.com',
      phone: '+15125551234',
      address: '123 Foreclosure Ave, Austin, TX 78701',
      signals: {
        preForeclosure: true,
        taxDelinquentYears: 3,
        vacantProperty: true,
        equityPercent: 65,
      } as SellerSignals,
      propertyValue: 150000,
    };

    it('Step 1: Score seller and verify HOT tier', () => {
      const score = scoreSeller(sellerLead.signals);

      console.log(`\n📊 SELLER SCORING:`);
      console.log(`   Signals: Pre-foreclosure, Tax delinquent 3yr, Vacant, 65% equity`);
      console.log(`   Score: ${score.score}`);
      console.log(`   Tier: ${score.tier}`);
      console.log(`   Action: ${score.recommendedAction}`);
      console.log(`   Matched: ${score.signals.join(', ')}`);

      // Pre-foreclosure (30) + Tax delinquent (25) + Vacant (10) + High equity (10) = 75
      expect(score.score).toBe(75);
      expect(score.tier).toBe('HOT');
      expect(isContactable(score.tier)).toBe(true);
    });

    it('Step 2: Verify campaign qualification (HOT = immediate outreach)', () => {
      const score = scoreSeller(sellerLead.signals);

      // Check can send during business hours
      const businessHours = new Date('2026-08-15T14:00:00-05:00');
      const quietHoursCheck = checkQuietHours(
        { phone: sellerLead.phone, address: { state: 'TX', zip: '78701' } },
        'sms',
        businessHours
      );

      console.log(`\n📧 CAMPAIGN QUALIFICATION:`);
      console.log(`   Tier: ${score.tier} → ${score.recommendedAction}`);
      console.log(`   Quiet Hours Check: ${quietHoursCheck.allowed ? 'ALLOWED' : 'BLOCKED'}`);

      expect(score.tier).toBe('HOT');
      expect(quietHoursCheck.allowed).toBe(true);
    });

    it('Step 3: Generate compliant SMS with disclosures', () => {
      const sms = generateCompliantSms(
        { phone: sellerLead.phone, address: { state: 'TX', zip: '78701' } },
        'Hi John, interested in selling 123 Foreclosure Ave?',
        {
          businessName: 'DealSwift Investments',
          isRealEstate: true,
          isFirstMessage: true,
        }
      );

      console.log(`\n💬 COMPLIANT SMS:`);
      console.log(`   ${sms.substring(0, 100)}...`);
      console.log(`   Contains STOP: ${sms.includes('STOP')}`);
      console.log(`   Contains Business Name: ${sms.includes('DealSwift')}`);

      expect(sms).toContain('STOP');
      expect(sms).toContain('DealSwift');
    });

    it('Step 4: Negotiate and validate inspection period', () => {
      // Seller wants 5 days - system clamps to minimum 7
      const inspection = negotiateInspectionDays(5);
      const closing = negotiateClosingDays(14, 21);

      console.log(`\n🤝 NEGOTIATION:`);
      console.log(`   Seller requested: 5 days inspection`);
      console.log(`   System clamped to: ${inspection.days} days (min 7)`);
      console.log(`   Negotiated: ${inspection.negotiated}`);
      console.log(`   Closing days: ${closing}`);

      expect(inspection.days).toBe(7);
      expect(inspection.negotiated).toBe(true);
      expect(closing).toBe(21);
    });

    it('Step 5: Detect state and generate regional contract', () => {
      const state = detectState(sellerLead.address);
      const template = loadTemplate(state!, 'PURCHASE_AGREEMENT');
      const disclosures = getRequiredDisclosures(state!, {
        propertyYearBuilt: 1985,
      });

      console.log(`\n📄 CONTRACT GENERATION:`);
      console.log(`   Detected State: ${state}`);
      console.log(`   Template: ${template.templateName}`);
      console.log(`   Has State-Specific: ${template.hasStateSpecific}`);
      console.log(`   Required Disclosures: ${disclosures.length} items`);

      expect(state).toBe('TX');
      expect(template.hasStateSpecific).toBe(true);
      expect(disclosures.length).toBeGreaterThan(0);
    });

    it('Step 6: Validate deal data for contract', () => {
      const dealData: DealData = {
        id: sellerLead.id,
        property_address: '123 Foreclosure Ave',
        property_city: 'Austin',
        property_state: 'TX',
        property_zip: '78701',
        property_county: 'Travis',
        seller_name: sellerLead.name,
        seller_address: sellerLead.address,
        purchase_price: sellerLead.propertyValue,
        earnest_money: 1500,
        closing_date: '2026-09-15',
        inspection_days: 14,
      };

      const validation = validateStateRequirements(dealData, 'TX');

      console.log(`\n✅ CONTRACT VALIDATION:`);
      console.log(`   Valid: ${validation.valid}`);
      console.log(`   Errors: ${validation.errors.length}`);
      console.log(`   Warnings: ${validation.warnings.join(', ') || 'None'}`);

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 2: BUYER MATCHING WITH TIER-BASED EARNEST MONEY
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scenario 2: Buyer Matching & Assignment', () => {
    const dealPrice = 150000;
    const assignmentFee = 10000;

    const vipBuyer: BuyerSignals = {
      cashPurchases: true,
      purchasesLast12Months: 5,
      verifiedProofOfFunds: true,
      previousClosedDeal: true,
      llcOrEntity: true,
      zipCodeMatch: true,
    };

    const newBuyer: BuyerSignals = {
      cashPurchases: false,
      purchasesLast12Months: 0,
    };

    it('Step 1: Score VIP buyer', () => {
      const score = scoreBuyer(vipBuyer);

      console.log(`\n👤 VIP BUYER SCORING:`);
      console.log(`   Score: ${score.score}`);
      console.log(`   Tier: ${score.tier}`);
      console.log(`   Priority: ${score.priority}`);
      console.log(`   Earnest Range: $${score.earnestMoney.min}-$${score.earnestMoney.max}`);
      console.log(`   Signals: ${score.signals.length} matched`);

      expect(score.score).toBeGreaterThanOrEqual(80);
      expect(score.tier).toBe('VIP');
      expect(score.earnestMoney).toEqual({ min: 100, max: 500 });
      expect(requiresPOF(score.tier)).toBe(false);
    });

    it('Step 2: Score UNVERIFIED buyer', () => {
      const score = scoreBuyer(newBuyer);

      console.log(`\n👤 NEW BUYER SCORING:`);
      console.log(`   Score: ${score.score}`);
      console.log(`   Tier: ${score.tier}`);
      console.log(`   Priority: ${score.priority}`);
      console.log(`   Earnest Range: $${score.earnestMoney.min}-$${score.earnestMoney.max}`);
      console.log(`   Requires POF: ${requiresPOF(score.tier)}`);

      expect(score.tier).toBe('UNVERIFIED');
      expect(score.earnestMoney).toEqual({ min: 3000, max: 5000 });
      expect(requiresPOF(score.tier)).toBe(true);
    });

    it('Step 3: Calculate earnest money by tier and deal value', () => {
      const vipEarnest = calculateEarnestAmount('VIP', dealPrice);
      const unverifiedEarnest = calculateEarnestAmount('UNVERIFIED', dealPrice);

      console.log(`\n💰 EARNEST MONEY CALCULATION (Deal: $${dealPrice}):`);
      console.log(`   VIP Buyer: $${vipEarnest}`);
      console.log(`   UNVERIFIED Buyer: $${unverifiedEarnest}`);
      console.log(`   Ratio: UNVERIFIED pays ${(unverifiedEarnest / vipEarnest).toFixed(1)}x more`);

      expect(vipEarnest).toBeLessThanOrEqual(500);
      expect(unverifiedEarnest).toBeGreaterThanOrEqual(3000);
    });

    it('Step 4: Validate $5,000 assignment fee floor', () => {
      // Test fee at floor
      const validFee = validateFeeFloor(500_000); // $5,000 in cents
      const invalidFee = validateFeeFloor(499_900); // $4,999 in cents

      console.log(`\n🚫 FEE FLOOR VALIDATION:`);
      console.log(`   $5,000 fee: valid=${validFee.valid}, walk=${validFee.walk}`);
      console.log(`   $4,999 fee: valid=${invalidFee.valid}, walk=${invalidFee.walk}`);
      console.log(`   FEE_FLOOR_CENTS: ${FEE_FLOOR_CENTS} (= $${FEE_FLOOR_CENTS/100})`);
      console.log(`   MINIMUM_ASSIGNMENT_FEE: $${MINIMUM_ASSIGNMENT_FEE}`);

      expect(validFee.valid).toBe(true);
      expect(validFee.walk).toBe(false);
      expect(invalidFee.valid).toBe(false);
      expect(invalidFee.walk).toBe(true);
      expect(MINIMUM_ASSIGNMENT_FEE).toBe(5000);
    });

    it('Step 5: Validate contract variables against negotiation', () => {
      const negotiation: NegotiationRecord = {
        id: 'neg-001',
        deal_id: 'deal-001',
        purchase_price: dealPrice,
        assignment_fee: assignmentFee,
        closing_date: '2026-09-15',
        seller_agreed: true,
        buyer_agreed: true,
      };

      // Valid contract
      const validResult = validateContractVariables(
        { purchase_price: dealPrice, assignment_fee: assignmentFee },
        negotiation
      );

      // Invalid - fee below floor
      const invalidNeg = { ...negotiation, assignment_fee: 4000 };
      const invalidResult = validateContractVariables(
        { assignment_fee: 4000 },
        invalidNeg
      );

      console.log(`\n📋 CONTRACT VARIABLES VALIDATION:`);
      console.log(`   Valid contract: ${validResult.valid}`);
      console.log(`   $4k fee contract: ${invalidResult.valid}`);
      console.log(`   Error: ${invalidResult.errors[0]?.substring(0, 60)}...`);

      expect(validResult.valid).toBe(true);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors[0]).toContain('$5,000');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 3: BUYER-SIDE NEGOTIATION WITH FEE FLOOR PROTECTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scenario 3: Buyer Negotiation Engine', () => {
    const contractPrice = 15_000_000; // $150,000 in cents

    it('Step 1: Create buyer offer state with fee floor', () => {
      const opener = 17_000_000; // $170,000 (includes $20k fee)
      const state = createBuyerOfferState(contractPrice, opener);

      console.log(`\n🏷️ BUYER OFFER STATE:`);
      console.log(`   Contract Price: ${formatOffer(contractPrice)}`);
      console.log(`   Opening Ask: ${formatOffer(opener)}`);
      console.log(`   Floor (contract + $5k): ${formatOffer(state.clampCents)}`);
      console.log(`   Fee if at floor: ${formatOffer(state.clampCents - contractPrice)}`);

      expect(state.clampCents).toBe(contractPrice + FEE_FLOOR_CENTS);
      expect(state.clampCents).toBe(15_500_000); // $155,000
    });

    it('Step 2: Simulate negotiation rounds', () => {
      const opener = 17_000_000; // $170,000
      const floor = 15_500_000; // $155,000

      console.log(`\n📉 NEGOTIATION ROUNDS:`);
      console.log(`   Opening: ${formatOffer(opener)}`);
      console.log(`   Floor: ${formatOffer(floor)}`);

      let state: OfferState = {
        side: 'buyer',
        openerCents: opener,
        clampCents: floor,
        round: 0,
      };

      for (let round = 0; round <= 4; round++) {
        state = { ...state, round };
        const result = computeNextOffer(state);

        if (result.kind === 'offer') {
          const fee = result.offerCents - contractPrice;
          console.log(`   Round ${round}: ${formatOffer(result.offerCents)} (fee: ${formatOffer(fee)})`);

          // CRITICAL: Fee must NEVER go below $5,000
          expect(fee).toBeGreaterThanOrEqual(FEE_FLOOR_CENTS);

          state.lastOfferCents = result.offerCents;
        } else {
          console.log(`   Round ${round}: WALK AWAY`);
        }
      }
    });

    it('Step 3: Validate buyer counter-offer against fee floor', () => {
      // Buyer counters at $152,000 → fee would be $2,000 (BELOW FLOOR)
      const lowCounter = validateBuyerCounter(contractPrice, 15_200_000);

      // Buyer counters at $160,000 → fee would be $10,000 (ABOVE FLOOR)
      const goodCounter = validateBuyerCounter(contractPrice, 16_000_000);

      console.log(`\n⚠️ COUNTER-OFFER VALIDATION:`);
      console.log(`   $152k counter: acceptable=${lowCounter.acceptable}, fee=${formatOffer(lowCounter.feeIfAccepted)}, walk=${lowCounter.walk}`);
      console.log(`   $160k counter: acceptable=${goodCounter.acceptable}, fee=${formatOffer(goodCounter.feeIfAccepted)}`);

      expect(lowCounter.acceptable).toBe(false);
      expect(lowCounter.walk).toBe(true);
      expect(lowCounter.feeIfAccepted).toBe(200_000); // $2,000

      expect(goodCounter.acceptable).toBe(true);
      expect(goodCounter.feeIfAccepted).toBe(1_000_000); // $10,000
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 4: CAMPAIGN WARMUP & QUALITY GATES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scenario 4: Campaign Operations', () => {
    it('Step 1: Verify warmup schedule', () => {
      console.log(`\n📈 WARMUP SCHEDULE:`);
      console.log(`   AWS Credit ID: ${HIGH_VOLUME_CONFIG.awsCreditId}`);

      for (let day = 1; day <= 8; day++) {
        const target = getWarmupTarget(day);
        console.log(`   Day ${day}: ${target.toLocaleString()} emails`);
      }

      expect(getWarmupTarget(1)).toBe(10_000);
      expect(getWarmupTarget(4)).toBe(75_000);
      expect(getWarmupTarget(7)).toBe(150_000);
      expect(getWarmupTarget(10)).toBe(150_000); // Post-warmup
    });

    it('Step 2: Quality gate checks', () => {
      const goodMetrics: CampaignMetrics = {
        sent: 100000,
        delivered: 97000,
        bounced: 3000, // 3% - OK
        complaints: 50, // 0.05% - OK
        unsubscribes: 1500, // 1.5% - OK
        opens: 20000,
        clicks: 5000,
      };

      const badMetrics: CampaignMetrics = {
        sent: 100000,
        delivered: 93000,
        bounced: 7000, // 7% - FAIL (>5%)
        complaints: 200, // 0.2% - FAIL (>0.1%)
        unsubscribes: 2500, // 2.5% - FAIL (>2%)
        opens: 10000,
        clicks: 1000,
      };

      const goodResult = checkQualityGates(goodMetrics);
      const badResult = checkQualityGates(badMetrics);

      console.log(`\n🚦 QUALITY GATES:`);
      console.log(`   Good Campaign: passed=${goodResult.passed}`);
      console.log(`   Bad Campaign: passed=${badResult.passed}, violations=${badResult.violations.length}`);
      badResult.violations.forEach(v => console.log(`     - ${v}`));

      expect(goodResult.passed).toBe(true);
      expect(badResult.passed).toBe(false);
      expect(badResult.violations.length).toBe(3);
    });

    it('Step 3: Pacing enforcement', () => {
      // Test daily limit
      const atLimit = calculatePacing(0, 0, 150000, 8);
      // Test during warmup
      const warmupDay2 = calculatePacing(0, 0, 20000, 2);

      console.log(`\n⏱️ PACING ENFORCEMENT:`);
      console.log(`   At daily limit: canSend=${atLimit.canSend}, reason=${atLimit.reason}`);
      console.log(`   Warmup Day 2 (at 20k/25k): canSend=${warmupDay2.canSend}, sendCount=${warmupDay2.sendCount}`);

      expect(atLimit.canSend).toBe(false);
      expect(warmupDay2.canSend).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENARIO 5: REGIONAL COMPLIANCE (FL 8PM, TX FEDERAL)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Scenario 5: Regional Compliance', () => {
    it('Step 1: Florida quiet hours (8pm cutoff)', () => {
      const fl8pm = new Date('2026-08-15T20:00:00-04:00'); // 8pm EDT
      const fl830pm = new Date('2026-08-15T20:30:00-04:00'); // 8:30pm EDT

      const at8pm = checkQuietHours(
        { phone: '+13055551234', address: { state: 'FL', zip: '33139' } },
        'sms',
        fl8pm
      );
      const at830pm = checkQuietHours(
        { phone: '+13055551234', address: { state: 'FL', zip: '33139' } },
        'sms',
        fl830pm
      );

      console.log(`\n🌙 FLORIDA QUIET HOURS:`);
      console.log(`   8:00pm: ${at8pm.allowed ? 'ALLOWED' : 'BLOCKED'}`);
      console.log(`   8:30pm: ${at830pm.allowed ? 'ALLOWED' : 'BLOCKED'}`);
      console.log(`   Note: FL uses 8pm cutoff (stricter than federal 9pm)`);

      // FL is stricter - 8pm cutoff
      expect(at830pm.allowed).toBe(false);
    });

    it('Step 2: Texas quiet hours (federal 9pm)', () => {
      const tx830pm = new Date('2026-08-15T20:30:00-05:00'); // 8:30pm CDT
      const tx930pm = new Date('2026-08-15T21:30:00-05:00'); // 9:30pm CDT

      const at830pm = checkQuietHours(
        { phone: '+15125551234', address: { state: 'TX', zip: '78701' } },
        'sms',
        tx830pm
      );
      const at930pm = checkQuietHours(
        { phone: '+15125551234', address: { state: 'TX', zip: '78701' } },
        'sms',
        tx930pm
      );

      console.log(`\n🌙 TEXAS QUIET HOURS:`);
      console.log(`   8:30pm: ${at830pm.allowed ? 'ALLOWED' : 'BLOCKED'}`);
      console.log(`   9:30pm: ${at930pm.allowed ? 'ALLOWED' : 'BLOCKED'}`);
      console.log(`   Note: TX uses federal 9pm cutoff`);

      expect(at830pm.allowed).toBe(true); // Before 9pm
      expect(at930pm.allowed).toBe(false); // After 9pm
    });

    it('Step 3: State detection from addresses', () => {
      const addresses = [
        { addr: '123 Main St, Austin, TX 78701', expected: 'TX' },
        { addr: '456 Ocean Dr, Miami, FL 33139', expected: 'FL' },
        { addr: '789 Hollywood Blvd, Los Angeles, CA 90028', expected: 'CA' },
        { addr: '321 Broadway, New York, NY 10001', expected: 'NY' },
      ];

      console.log(`\n🗺️ STATE DETECTION:`);
      for (const { addr, expected } of addresses) {
        const detected = detectState(addr);
        console.log(`   "${addr.substring(0, 30)}..." → ${detected}`);
        expect(detected).toBe(expected);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL VERIFICATION: ALL CRITICAL VALUES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Final Verification: Critical System Values', () => {
    it('Verify all NON-NEGOTIABLE values', () => {
      console.log(`\n🔒 CRITICAL SYSTEM VALUES:`);
      console.log(`   FEE_FLOOR_CENTS: ${FEE_FLOOR_CENTS} (= $${FEE_FLOOR_CENTS/100})`);
      console.log(`   MINIMUM_ASSIGNMENT_FEE: $${MINIMUM_ASSIGNMENT_FEE}`);
      console.log(`   MIN_INSPECTION_DAYS: ${TERM_LIMITS.inspectionDays.min}`);
      console.log(`   MAX_INSPECTION_DAYS: ${TERM_LIMITS.inspectionDays.max}`);
      console.log(`   AWS_CREDIT_ID: ${HIGH_VOLUME_CONFIG.awsCreditId}`);
      console.log(`   DAILY_TARGET: ${HIGH_VOLUME_CONFIG.dailyTarget.toLocaleString()}`);
      console.log(`   BOUNCE_LIMIT: ${HIGH_VOLUME_CONFIG.qualityGates.maxBounceRate * 100}%`);
      console.log(`   COMPLAINT_LIMIT: ${HIGH_VOLUME_CONFIG.qualityGates.maxComplaintRate * 100}%`);

      // These are NON-NEGOTIABLE
      expect(FEE_FLOOR_CENTS).toBe(500_000);
      expect(MINIMUM_ASSIGNMENT_FEE).toBe(5000);
      expect(TERM_LIMITS.inspectionDays.min).toBe(7);
      expect(TERM_LIMITS.inspectionDays.max).toBe(21);
      expect(HIGH_VOLUME_CONFIG.awsCreditId).toBe('10064436819');
      expect(HIGH_VOLUME_CONFIG.dailyTarget).toBe(150_000);
      expect(HIGH_VOLUME_CONFIG.qualityGates.maxBounceRate).toBe(0.05);
      expect(HIGH_VOLUME_CONFIG.qualityGates.maxComplaintRate).toBe(0.001);
    });
  });
});
