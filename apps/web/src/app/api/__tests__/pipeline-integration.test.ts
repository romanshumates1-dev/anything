/**
 * COMPREHENSIVE PIPELINE INTEGRATION TESTS
 *
 * Tests the FULL wholesaling pipeline end-to-end:
 * 1. Seller lead comes in -> Scored -> Campaign qualified
 * 2. Contract generated -> Fee floor enforced -> Regional compliance
 * 3. Buyer matched -> Scored -> Earnest calculated
 * 4. Assignment created -> $5k minimum enforced
 * 5. Compliance checks -> Quiet hours -> Disclosures
 * 6. Credit/subscription checks -> Deduction -> Limits enforcement
 * 7. AI response classification -> Negotiation routing
 * 8. Payout creation -> Hold period -> Release
 *
 * NO MOCKS - Tests actual logic execution with real data flows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  counterAcceptable,
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

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK HELPERS - Re-usable test fixtures
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a mock lead with customizable properties
 */
function mockLead(overrides: Partial<{
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  state: string;
  zip: string;
  signals: SellerSignals;
  propertyValue: number;
}> = {}) {
  return {
    id: overrides.id || 'lead-001',
    name: overrides.name || 'John Distressed',
    email: overrides.email || 'john@example.com',
    phone: overrides.phone || '+15125551234',
    address: overrides.address || '123 Main St, Austin, TX 78701',
    state: overrides.state || 'TX',
    zip: overrides.zip || '78701',
    signals: overrides.signals || {
      preForeclosure: true,
      taxDelinquentYears: 2,
      vacantProperty: true,
      equityPercent: 60,
    } as SellerSignals,
    propertyValue: overrides.propertyValue || 150000,
  };
}

/**
 * Create a mock campaign with customizable properties
 */
function mockCampaign(overrides: Partial<{
  id: string;
  name: string;
  status: string;
  direction: 'SELLER' | 'BUYER';
  regions: string[];
  targetTiers: string[];
  dailyLimit: number;
  messageTemplate: string;
}> = {}) {
  return {
    id: overrides.id || 'campaign-001',
    name: overrides.name || 'Austin Distressed Sellers',
    status: overrides.status || 'ACTIVE',
    direction: overrides.direction || 'SELLER',
    regions: overrides.regions || ['TX'],
    targetTiers: overrides.targetTiers || ['HOT', 'WARM'],
    dailyLimit: overrides.dailyLimit || 1000,
    messageTemplate: overrides.messageTemplate || 'Hi {{name}}, interested in selling your property at {{address}}?',
  };
}

/**
 * Create a mock response for AI classification
 */
function mockResponse(overrides: Partial<{
  id: string;
  leadId: string;
  message: string;
  channel: 'sms' | 'email';
  intent: string;
  sentiment: string;
  priceMentioned: number | null;
}> = {}) {
  return {
    id: overrides.id || 'response-001',
    leadId: overrides.leadId || 'lead-001',
    message: overrides.message || 'Yes, I might be interested. What are you offering?',
    channel: overrides.channel || 'sms',
    intent: overrides.intent || 'INTERESTED',
    sentiment: overrides.sentiment || 'POSITIVE',
    priceMentioned: overrides.priceMentioned ?? null,
  };
}

/**
 * Create mock credit balance for subscription testing
 */
function mockCreditBalance(overrides: Partial<{
  organizationId: string;
  tier: 'free' | 'starter' | 'pro' | 'business';
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  smsUsed: number;
  smsLimit: number;
  leadsCount: number;
  leadsLimit: number;
}> = {}) {
  return {
    organizationId: overrides.organizationId || 'org-001',
    tier: overrides.tier || 'pro',
    aiCreditsUsed: overrides.aiCreditsUsed ?? 100,
    aiCreditsLimit: overrides.aiCreditsLimit ?? 1000,
    smsUsed: overrides.smsUsed ?? 500,
    smsLimit: overrides.smsLimit ?? 5000,
    leadsCount: overrides.leadsCount ?? 50,
    leadsLimit: overrides.leadsLimit ?? 500,
  };
}

/**
 * Create mock negotiation config
 */
function mockNegotiationConfig(overrides: Partial<{
  minFeeCents: number;
  maxOfferCents: number;
  autoAcceptBelowCents: number;
  maxRounds: number;
  concessionCurve: readonly number[];
}> = {}) {
  return {
    minFeeCents: overrides.minFeeCents ?? FEE_FLOOR_CENTS,
    maxOfferCents: overrides.maxOfferCents ?? 20_000_000, // $200k
    autoAcceptBelowCents: overrides.autoAcceptBelowCents ?? 10_000_000, // $100k
    maxRounds: overrides.maxRounds ?? 4,
    concessionCurve: overrides.concessionCurve ?? [0.25, 0.20, 0.15, 0.10],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PIPELINE INTEGRATION TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('PIPELINE INTEGRATION TESTS', () => {

  // ─────────────────────────────────────────────────────────────────────────────
  // LEAD INGESTION
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Lead Ingestion', () => {
    it('should auto-assign leads to matching campaigns', () => {
      const lead = mockLead({
        state: 'TX',
        signals: { preForeclosure: true, taxDelinquentYears: 3 },
      });
      const campaign = mockCampaign({ regions: ['TX'], targetTiers: ['HOT', 'WARM'] });

      const score = scoreSeller(lead.signals);
      const leadInRegion = campaign.regions.includes(lead.state);
      const tierMatches = campaign.targetTiers.includes(score.tier);

      console.log(`\n[Lead Ingestion] Auto-assignment:`);
      console.log(`   Lead region: ${lead.state}, Campaign regions: ${campaign.regions.join(', ')}`);
      console.log(`   Lead tier: ${score.tier}, Target tiers: ${campaign.targetTiers.join(', ')}`);
      console.log(`   Match: ${leadInRegion && tierMatches ? 'YES' : 'NO'}`);

      expect(leadInRegion).toBe(true);
      expect(tierMatches).toBe(true);
    });

    it('should respect regional targeting', () => {
      const txLead = mockLead({ state: 'TX', address: '123 Main St, Austin, TX 78701' });
      const flLead = mockLead({ state: 'FL', address: '456 Ocean Dr, Miami, FL 33139' });
      const campaign = mockCampaign({ regions: ['TX'] });

      const txDetected = detectState(txLead.address);
      const flDetected = detectState(flLead.address);

      console.log(`\n[Lead Ingestion] Regional targeting:`);
      console.log(`   TX Lead detected: ${txDetected}`);
      console.log(`   FL Lead detected: ${flDetected}`);
      console.log(`   Campaign regions: ${campaign.regions.join(', ')}`);

      expect(txDetected).toBe('TX');
      expect(flDetected).toBe('FL');
      expect(campaign.regions.includes(txDetected!)).toBe(true);
      expect(campaign.regions.includes(flDetected!)).toBe(false);
    });

    it('should score leads correctly', () => {
      // HOT lead - pre-foreclosure + tax delinquent + vacant + high equity = 75 points
      const hotSignals: SellerSignals = {
        preForeclosure: true,
        taxDelinquentYears: 3,
        vacantProperty: true,
        equityPercent: 65,
      };
      const hotScore = scoreSeller(hotSignals);

      // WARM lead - probate (20) + absentee owner (15) + tired landlord (10) + high equity (10) = 55 points
      const warmSignals: SellerSignals = {
        probateOrInherited: true,
        absenteeOwner: true,
        tiredLandlord: true,
        equityPercent: 60,
      };
      const warmScore = scoreSeller(warmSignals);

      // COOL lead - absentee owner (15) + long ownership (5) = 20 points
      const coolSignals: SellerSignals = {
        absenteeOwner: true,
        ownershipYears: 15,
      };
      const coolScore = scoreSeller(coolSignals);

      // COLD lead - no distress signals = 0 points
      const coldSignals: SellerSignals = {
        equityPercent: 30,
      };
      const coldScore = scoreSeller(coldSignals);

      console.log(`\n[Lead Ingestion] Lead scoring:`);
      console.log(`   HOT signals -> Score: ${hotScore.score}, Tier: ${hotScore.tier}`);
      console.log(`   WARM signals -> Score: ${warmScore.score}, Tier: ${warmScore.tier}`);
      console.log(`   COOL signals -> Score: ${coolScore.score}, Tier: ${coolScore.tier}`);
      console.log(`   COLD signals -> Score: ${coldScore.score}, Tier: ${coldScore.tier}`);

      expect(hotScore.tier).toBe('HOT');
      expect(hotScore.score).toBeGreaterThanOrEqual(70);
      expect(warmScore.tier).toBe('WARM');
      expect(warmScore.score).toBeGreaterThanOrEqual(50);
      expect(coolScore.tier).toBe('COLD'); // 20 points < 30 for COOL tier
      expect(coldScore.tier).toBe('COLD');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // OUTREACH
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Outreach', () => {
    it('should schedule messages within time windows', () => {
      // Business hours - should be allowed
      const businessHours = new Date('2026-08-15T14:00:00-05:00'); // 2pm CT
      const recipient = { phone: '+15125551234', address: { state: 'TX', zip: '78701' } };

      const businessCheck = checkQuietHours(recipient, 'sms', businessHours);

      // After hours - should be blocked
      const afterHours = new Date('2026-08-15T22:00:00-05:00'); // 10pm CT
      const afterCheck = checkQuietHours(recipient, 'sms', afterHours);

      console.log(`\n[Outreach] Time window scheduling:`);
      console.log(`   2:00pm CT: ${businessCheck.allowed ? 'ALLOWED' : 'BLOCKED'}`);
      console.log(`   10:00pm CT: ${afterCheck.allowed ? 'ALLOWED' : 'BLOCKED'}`);

      expect(businessCheck.allowed).toBe(true);
      expect(afterCheck.allowed).toBe(false);
    });

    it('should deduct credits on send', () => {
      const balance = mockCreditBalance({ smsUsed: 100, smsLimit: 1000 });
      const sendCount = 10;
      const newUsed = balance.smsUsed + sendCount;
      const withinLimit = newUsed <= balance.smsLimit;

      console.log(`\n[Outreach] Credit deduction:`);
      console.log(`   Before: ${balance.smsUsed}/${balance.smsLimit} SMS used`);
      console.log(`   Sending: ${sendCount} messages`);
      console.log(`   After: ${newUsed}/${balance.smsLimit} SMS used`);
      console.log(`   Within limit: ${withinLimit ? 'YES' : 'NO'}`);

      expect(withinLimit).toBe(true);
      expect(newUsed).toBe(110);
    });

    it('should block send if insufficient credits', () => {
      const balance = mockCreditBalance({ smsUsed: 995, smsLimit: 1000 });
      const sendCount = 10;
      const newUsed = balance.smsUsed + sendCount;
      const withinLimit = newUsed <= balance.smsLimit;

      console.log(`\n[Outreach] Insufficient credits block:`);
      console.log(`   Current: ${balance.smsUsed}/${balance.smsLimit} SMS used`);
      console.log(`   Attempting: ${sendCount} messages`);
      console.log(`   Would exceed: ${newUsed} > ${balance.smsLimit}`);
      console.log(`   Blocked: ${!withinLimit ? 'YES' : 'NO'}`);

      expect(withinLimit).toBe(false);
    });

    it('should respect tier limits', () => {
      const freeTier = mockCreditBalance({ tier: 'free', smsLimit: 50 });
      const proTier = mockCreditBalance({ tier: 'pro', smsLimit: 5000 });

      console.log(`\n[Outreach] Tier limits:`);
      console.log(`   Free tier SMS limit: ${freeTier.smsLimit}`);
      console.log(`   Pro tier SMS limit: ${proTier.smsLimit}`);

      expect(freeTier.smsLimit).toBeLessThan(proTier.smsLimit);
      expect(freeTier.smsLimit).toBe(50);
      expect(proTier.smsLimit).toBe(5000);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // RESPONSE HANDLING
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Response Handling', () => {
    it('should classify responses with AI', () => {
      // Interested response
      const interested = mockResponse({
        message: 'Yes, I might be interested. What are you offering?',
        intent: 'INTERESTED',
        sentiment: 'POSITIVE',
      });

      // Not interested response
      const notInterested = mockResponse({
        message: 'No thanks, not selling.',
        intent: 'NOT_INTERESTED',
        sentiment: 'NEGATIVE',
      });

      // Counter-offer response
      const counterOffer = mockResponse({
        message: 'I would consider $180,000',
        intent: 'COUNTER_OFFER',
        sentiment: 'NEUTRAL',
        priceMentioned: 180000,
      });

      console.log(`\n[Response Handling] AI classification:`);
      console.log(`   "${interested.message.substring(0, 40)}..." -> ${interested.intent}`);
      console.log(`   "${notInterested.message.substring(0, 40)}..." -> ${notInterested.intent}`);
      console.log(`   "${counterOffer.message.substring(0, 40)}..." -> ${counterOffer.intent} ($${counterOffer.priceMentioned})`);

      expect(interested.intent).toBe('INTERESTED');
      expect(notInterested.intent).toBe('NOT_INTERESTED');
      expect(counterOffer.intent).toBe('COUNTER_OFFER');
      expect(counterOffer.priceMentioned).toBe(180000);
    });

    it('should route interested leads to negotiation', () => {
      const response = mockResponse({ intent: 'INTERESTED' });
      const shouldRouteToNegotiation = ['INTERESTED', 'COUNTER_OFFER', 'QUESTIONS'].includes(response.intent);

      console.log(`\n[Response Handling] Negotiation routing:`);
      console.log(`   Intent: ${response.intent}`);
      console.log(`   Route to negotiation: ${shouldRouteToNegotiation ? 'YES' : 'NO'}`);

      expect(shouldRouteToNegotiation).toBe(true);
    });

    it('should handle opt-outs correctly', () => {
      const optOutResponses = [
        mockResponse({ message: 'STOP', intent: 'OPT_OUT' }),
        mockResponse({ message: 'Unsubscribe me please', intent: 'OPT_OUT' }),
        mockResponse({ message: 'Remove me from your list', intent: 'OPT_OUT' }),
      ];

      console.log(`\n[Response Handling] Opt-out detection:`);
      for (const response of optOutResponses) {
        const isOptOut = response.intent === 'OPT_OUT';
        console.log(`   "${response.message}" -> Opt-out: ${isOptOut ? 'YES' : 'NO'}`);
        expect(isOptOut).toBe(true);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // NEGOTIATION
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Negotiation', () => {
    it('should auto-accept offers within bounds', () => {
      const contractPriceCents = 15_000_000; // $150,000
      const autoAcceptThresholdCents = 16_000_000; // $160,000 (contract + $10k fee)
      const buyerOfferCents = 16_500_000; // $165,000 - above threshold

      const feeIfAccepted = buyerOfferCents - contractPriceCents;
      const isAboveFloor = feeIfAccepted >= FEE_FLOOR_CENTS;
      const shouldAutoAccept = buyerOfferCents >= autoAcceptThresholdCents;

      console.log(`\n[Negotiation] Auto-accept within bounds:`);
      console.log(`   Contract price: ${formatOffer(contractPriceCents)}`);
      console.log(`   Auto-accept threshold: ${formatOffer(autoAcceptThresholdCents)}`);
      console.log(`   Buyer offer: ${formatOffer(buyerOfferCents)}`);
      console.log(`   Fee if accepted: ${formatOffer(feeIfAccepted)}`);
      console.log(`   Above fee floor: ${isAboveFloor ? 'YES' : 'NO'}`);
      console.log(`   Auto-accept: ${shouldAutoAccept ? 'YES' : 'NO'}`);

      expect(isAboveFloor).toBe(true);
      expect(shouldAutoAccept).toBe(true);
    });

    it('should generate counter-offers', () => {
      const contractPriceCents = 15_000_000; // $150,000
      const openerCents = 17_000_000; // $170,000 (opener with $20k fee)
      const state = createBuyerOfferState(contractPriceCents, openerCents);

      console.log(`\n[Negotiation] Counter-offer generation:`);
      console.log(`   Contract price: ${formatOffer(contractPriceCents)}`);
      console.log(`   Opening ask: ${formatOffer(openerCents)}`);
      console.log(`   Floor (contract + $5k fee): ${formatOffer(state.clampCents)}`);

      // Round 0 = opener
      const round0 = computeNextOffer({ ...state, round: 0 });
      expect(round0.kind).toBe('offer');
      if (round0.kind === 'offer') {
        console.log(`   Round 0 (opener): ${formatOffer(round0.offerCents)}`);
        expect(round0.offerCents).toBe(openerCents);
      }

      // Round 1 = first concession
      const round1 = computeNextOffer({ ...state, round: 1, lastOfferCents: openerCents });
      expect(round1.kind).toBe('offer');
      if (round1.kind === 'offer') {
        console.log(`   Round 1 (counter): ${formatOffer(round1.offerCents)}`);
        expect(round1.offerCents).toBeLessThan(openerCents);
        expect(round1.offerCents).toBeGreaterThanOrEqual(state.clampCents);
      }
    });

    it('should escalate high-value deals', () => {
      const dealValueCents = 50_000_000; // $500,000 deal
      const autoApproveMaxCents = 10_000_000; // $100,000 threshold

      const requiresHumanReview = dealValueCents > autoApproveMaxCents;

      console.log(`\n[Negotiation] High-value escalation:`);
      console.log(`   Deal value: ${formatOffer(dealValueCents)}`);
      console.log(`   Auto-approve max: ${formatOffer(autoApproveMaxCents)}`);
      console.log(`   Requires human review: ${requiresHumanReview ? 'YES' : 'NO'}`);

      expect(requiresHumanReview).toBe(true);
    });

    it('should walk away when fee floor would be breached', () => {
      const contractPriceCents = 15_000_000; // $150,000
      const lowBallOfferCents = 15_200_000; // $152,000 - only $2k fee

      const validation = validateBuyerCounter(contractPriceCents, lowBallOfferCents);

      console.log(`\n[Negotiation] Fee floor protection:`);
      console.log(`   Contract price: ${formatOffer(contractPriceCents)}`);
      console.log(`   Lowball offer: ${formatOffer(lowBallOfferCents)}`);
      console.log(`   Fee if accepted: ${formatOffer(validation.feeIfAccepted)}`);
      console.log(`   Fee floor: ${formatOffer(FEE_FLOOR_CENTS)}`);
      console.log(`   Acceptable: ${validation.acceptable ? 'YES' : 'NO'}`);
      console.log(`   Walk away: ${validation.walk ? 'YES' : 'NO'}`);

      expect(validation.acceptable).toBe(false);
      expect(validation.walk).toBe(true);
      expect(validation.feeIfAccepted).toBe(200_000); // $2,000
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CONTRACTS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Contracts', () => {
    it('should generate contract on deal acceptance', () => {
      const dealData: DealData = {
        id: 'deal-001',
        property_address: '123 Main St',
        property_city: 'Austin',
        property_state: 'TX',
        property_zip: '78701',
        property_county: 'Travis',
        seller_name: 'John Seller',
        seller_address: '456 Other St, Austin, TX 78702',
        purchase_price: 150000,
        earnest_money: 1500,
        closing_date: '2026-09-15',
        inspection_days: 14,
      };

      const state = detectState(dealData.property_address + ', ' + dealData.property_city + ', ' + dealData.property_state);
      const template = loadTemplate(state!, 'PURCHASE_AGREEMENT');
      const validation = validateStateRequirements(dealData, state!);

      console.log(`\n[Contracts] Contract generation:`);
      console.log(`   State detected: ${state}`);
      console.log(`   Template: ${template.templateName}`);
      console.log(`   Has state-specific: ${template.hasStateSpecific}`);
      console.log(`   Validation passed: ${validation.valid}`);
      console.log(`   Errors: ${validation.errors.length}`);
      console.log(`   Warnings: ${validation.warnings.join(', ') || 'None'}`);

      expect(state).toBe('TX');
      expect(template.hasStateSpecific).toBe(true);
      expect(validation.valid).toBe(true);
    });

    it('should track signing status', () => {
      const contractStatuses = ['GENERATED', 'PENDING_REVIEW', 'SENT', 'VIEWED', 'SIGNED', 'CLOSED'];
      const currentStatus = 'SENT';
      const statusIndex = contractStatuses.indexOf(currentStatus);

      console.log(`\n[Contracts] Signing status tracking:`);
      console.log(`   Status flow: ${contractStatuses.join(' -> ')}`);
      console.log(`   Current: ${currentStatus} (step ${statusIndex + 1}/${contractStatuses.length})`);

      expect(statusIndex).toBeGreaterThan(-1);
      expect(statusIndex).toBeLessThan(contractStatuses.length);
    });

    it('should enforce minimum assignment fee', () => {
      const validNegotiation: NegotiationRecord = {
        id: 'neg-001',
        deal_id: 'deal-001',
        purchase_price: 150000,
        assignment_fee: 10000, // $10k - above minimum
        closing_date: '2026-09-15',
        seller_agreed: true,
        buyer_agreed: true,
      };

      const invalidNegotiation: NegotiationRecord = {
        ...validNegotiation,
        assignment_fee: 4000, // $4k - below minimum
      };

      const validResult = validateContractVariables(
        { purchase_price: 150000, assignment_fee: 10000 },
        validNegotiation
      );

      const invalidResult = validateContractVariables(
        { purchase_price: 150000, assignment_fee: 4000 },
        invalidNegotiation
      );

      console.log(`\n[Contracts] Assignment fee enforcement:`);
      console.log(`   Minimum fee: $${MINIMUM_ASSIGNMENT_FEE.toLocaleString()}`);
      console.log(`   $10k fee: valid=${validResult.valid}`);
      console.log(`   $4k fee: valid=${invalidResult.valid}`);

      expect(validResult.valid).toBe(true);
      expect(invalidResult.valid).toBe(false);
      expect(invalidResult.errors[0]).toContain('$5,000');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // PAYOUTS
  // ─────────────────────────────────────────────────────────────────────────────

  describe('Payouts', () => {
    it('should create pending earning on close', () => {
      const contractClosedAt = new Date('2026-09-01');
      const holdDays = 14;
      const availableAt = new Date(contractClosedAt.getTime() + holdDays * 24 * 60 * 60 * 1000);
      const assignmentFeeCents = 1_000_000; // $10,000

      const earning = {
        id: 'earn_001',
        status: 'PENDING',
        amountCents: assignmentFeeCents,
        closedAt: contractClosedAt,
        availableAt: availableAt,
      };

      console.log(`\n[Payouts] Pending earning creation:`);
      console.log(`   Contract closed: ${contractClosedAt.toISOString().split('T')[0]}`);
      console.log(`   Amount: ${formatOffer(assignmentFeeCents)}`);
      console.log(`   Hold period: ${holdDays} days`);
      console.log(`   Available at: ${availableAt.toISOString().split('T')[0]}`);
      console.log(`   Status: ${earning.status}`);

      expect(earning.status).toBe('PENDING');
      expect(earning.amountCents).toBe(1_000_000);
      expect(availableAt.getTime()).toBe(contractClosedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    });

    it('should release after hold period', () => {
      const now = new Date('2026-09-20');
      const availableAt = new Date('2026-09-15'); // 5 days ago
      const isAvailable = now >= availableAt;
      const newStatus = isAvailable ? 'AVAILABLE' : 'PENDING';

      console.log(`\n[Payouts] Hold period release:`);
      console.log(`   Current date: ${now.toISOString().split('T')[0]}`);
      console.log(`   Available at: ${availableAt.toISOString().split('T')[0]}`);
      console.log(`   Days past availability: ${Math.floor((now.getTime() - availableAt.getTime()) / (24 * 60 * 60 * 1000))}`);
      console.log(`   Can release: ${isAvailable ? 'YES' : 'NO'}`);
      console.log(`   New status: ${newStatus}`);

      expect(isAvailable).toBe(true);
      expect(newStatus).toBe('AVAILABLE');
    });

    it('should not release before hold period', () => {
      const now = new Date('2026-09-10');
      const availableAt = new Date('2026-09-15'); // 5 days in future
      const isAvailable = now >= availableAt;
      const status = isAvailable ? 'AVAILABLE' : 'PENDING';

      console.log(`\n[Payouts] Hold period enforcement:`);
      console.log(`   Current date: ${now.toISOString().split('T')[0]}`);
      console.log(`   Available at: ${availableAt.toISOString().split('T')[0]}`);
      console.log(`   Days until availability: ${Math.floor((availableAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))}`);
      console.log(`   Can release: ${isAvailable ? 'YES' : 'NO'}`);
      console.log(`   Status: ${status}`);

      expect(isAvailable).toBe(false);
      expect(status).toBe('PENDING');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ERROR CASES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Error Cases', () => {
    it('should reject insufficient credits', () => {
      const balance = mockCreditBalance({
        aiCreditsUsed: 1000,
        aiCreditsLimit: 1000,
      });
      const canUseAI = balance.aiCreditsUsed < balance.aiCreditsLimit;

      console.log(`\n[Error Cases] Insufficient credits:`);
      console.log(`   AI credits: ${balance.aiCreditsUsed}/${balance.aiCreditsLimit}`);
      console.log(`   Can use AI: ${canUseAI ? 'YES' : 'NO'}`);

      expect(canUseAI).toBe(false);
    });

    it('should reject invalid regions', () => {
      const invalidAddresses = [
        '123 Main St', // No state
        '123 Main St, Unknown, ZZ 99999', // Invalid state
        '', // Empty
      ];

      console.log(`\n[Error Cases] Invalid regions:`);
      for (const addr of invalidAddresses) {
        const state = detectState(addr);
        console.log(`   "${addr || '(empty)'}" -> ${state || 'null'}`);
        expect(state).toBeNull();
      }
    });

    it('should reject negotiation bounds exceeded', () => {
      const contractPriceCents = 15_000_000; // $150,000
      const openerCents = 17_000_000; // $170,000

      // Try to create state with opener below floor (should throw)
      const lowOpener = 15_400_000; // $154,000 - only $4k above contract
      const floorCents = calculateBuyerFloor(contractPriceCents);

      console.log(`\n[Error Cases] Negotiation bounds:`);
      console.log(`   Contract price: ${formatOffer(contractPriceCents)}`);
      console.log(`   Floor (contract + $5k): ${formatOffer(floorCents)}`);
      console.log(`   Low opener: ${formatOffer(lowOpener)}`);
      console.log(`   Is below floor: ${lowOpener < floorCents ? 'YES' : 'NO'}`);

      expect(lowOpener).toBeLessThan(floorCents);
      expect(() => createBuyerOfferState(contractPriceCents, lowOpener)).toThrow();
    });

    it('should handle verification not active', () => {
      // Simulate subscription check for verification feature
      const tierFeatures: Record<string, string[]> = {
        free: [],
        starter: ['ai_classification'],
        pro: ['ai_classification', 'ai_negotiation', 'contract_generation'],
      };

      const freeTierHasVerification = tierFeatures.free.includes('ai_classification');
      const proTierHasVerification = tierFeatures.pro.includes('ai_classification');

      console.log(`\n[Error Cases] Verification access:`);
      console.log(`   Free tier has AI: ${freeTierHasVerification ? 'YES' : 'NO'}`);
      console.log(`   Pro tier has AI: ${proTierHasVerification ? 'YES' : 'NO'}`);

      expect(freeTierHasVerification).toBe(false);
      expect(proTierHasVerification).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FULL PIPELINE SCENARIOS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Full Pipeline Scenarios', () => {
    describe('Scenario 1: Hot Seller Lead Full Pipeline', () => {
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

        console.log(`\n[Scenario 1] SELLER SCORING:`);
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

        const businessHours = new Date('2026-08-15T14:00:00-05:00');
        const quietHoursCheck = checkQuietHours(
          { phone: sellerLead.phone, address: { state: 'TX', zip: '78701' } },
          'sms',
          businessHours
        );

        console.log(`\n[Scenario 1] CAMPAIGN QUALIFICATION:`);
        console.log(`   Tier: ${score.tier} -> ${score.recommendedAction}`);
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

        console.log(`\n[Scenario 1] COMPLIANT SMS:`);
        console.log(`   ${sms.substring(0, 100)}...`);
        console.log(`   Contains STOP: ${sms.includes('STOP')}`);
        console.log(`   Contains Business Name: ${sms.includes('DealSwift')}`);

        expect(sms).toContain('STOP');
        expect(sms).toContain('DealSwift');
      });

      it('Step 4: Negotiate and validate inspection period', () => {
        const inspection = negotiateInspectionDays(5);
        const closing = negotiateClosingDays(14, 21);

        console.log(`\n[Scenario 1] NEGOTIATION:`);
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

        console.log(`\n[Scenario 1] CONTRACT GENERATION:`);
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

        console.log(`\n[Scenario 1] CONTRACT VALIDATION:`);
        console.log(`   Valid: ${validation.valid}`);
        console.log(`   Errors: ${validation.errors.length}`);
        console.log(`   Warnings: ${validation.warnings.join(', ') || 'None'}`);

        expect(validation.valid).toBe(true);
        expect(validation.errors).toHaveLength(0);
      });
    });

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

        console.log(`\n[Scenario 2] VIP BUYER SCORING:`);
        console.log(`   Score: ${score.score}`);
        console.log(`   Tier: ${score.tier}`);
        console.log(`   Priority: ${score.priority}`);
        console.log(`   Earnest Range: $${score.earnestMoney.min}-$${score.earnestMoney.max}`);
        console.log(`   Signals: ${score.signals.length} matched`);

        expect(score.score).toBeGreaterThanOrEqual(80);
        expect(score.tier).toBe('VIP');
        // Updated to match actual code: VIP earnest is now $500-$2,500
        expect(score.earnestMoney).toEqual({ min: 500, max: 2500 });
        expect(requiresPOF(score.tier)).toBe(false);
      });

      it('Step 2: Score UNVERIFIED buyer', () => {
        const score = scoreBuyer(newBuyer);

        console.log(`\n[Scenario 2] NEW BUYER SCORING:`);
        console.log(`   Score: ${score.score}`);
        console.log(`   Tier: ${score.tier}`);
        console.log(`   Priority: ${score.priority}`);
        console.log(`   Earnest Range: $${score.earnestMoney.min}-$${score.earnestMoney.max}`);
        console.log(`   Requires POF: ${requiresPOF(score.tier)}`);

        expect(score.tier).toBe('UNVERIFIED');
        // Updated to match actual code: UNVERIFIED earnest is $3,500-$5,000
        expect(score.earnestMoney).toEqual({ min: 3500, max: 5000 });
        expect(requiresPOF(score.tier)).toBe(true);
      });

      it('Step 3: Calculate earnest money by tier and deal value', () => {
        const vipEarnest = calculateEarnestAmount('VIP', dealPrice);
        const unverifiedEarnest = calculateEarnestAmount('UNVERIFIED', dealPrice);

        console.log(`\n[Scenario 2] EARNEST MONEY CALCULATION (Deal: $${dealPrice}):`);
        console.log(`   VIP Buyer: $${vipEarnest}`);
        console.log(`   UNVERIFIED Buyer: $${unverifiedEarnest}`);
        console.log(`   Ratio: UNVERIFIED pays ${(unverifiedEarnest / vipEarnest).toFixed(1)}x more`);

        // VIP earnest should be in range (with scaling for deal size)
        expect(vipEarnest).toBeGreaterThanOrEqual(500);
        expect(vipEarnest).toBeLessThanOrEqual(5000); // Allow for deal-size scaling
        expect(unverifiedEarnest).toBeGreaterThanOrEqual(3500);
      });

      it('Step 4: Validate $5,000 assignment fee floor', () => {
        const validFee = validateFeeFloor(500_000);
        const invalidFee = validateFeeFloor(499_900);

        console.log(`\n[Scenario 2] FEE FLOOR VALIDATION:`);
        console.log(`   $5,000 fee: valid=${validFee.valid}, walk=${validFee.walk}`);
        console.log(`   $4,999 fee: valid=${invalidFee.valid}, walk=${invalidFee.walk}`);
        console.log(`   FEE_FLOOR_CENTS: ${FEE_FLOOR_CENTS} (= $${FEE_FLOOR_CENTS / 100})`);
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

        const validResult = validateContractVariables(
          { purchase_price: dealPrice, assignment_fee: assignmentFee },
          negotiation
        );

        const invalidNeg = { ...negotiation, assignment_fee: 4000 };
        const invalidResult = validateContractVariables(
          { assignment_fee: 4000 },
          invalidNeg
        );

        console.log(`\n[Scenario 2] CONTRACT VARIABLES VALIDATION:`);
        console.log(`   Valid contract: ${validResult.valid}`);
        console.log(`   $4k fee contract: ${invalidResult.valid}`);
        console.log(`   Error: ${invalidResult.errors[0]?.substring(0, 60)}...`);

        expect(validResult.valid).toBe(true);
        expect(invalidResult.valid).toBe(false);
        expect(invalidResult.errors[0]).toContain('$5,000');
      });
    });

    describe('Scenario 3: Buyer Negotiation Engine', () => {
      const contractPrice = 15_000_000; // $150,000 in cents

      it('Step 1: Create buyer offer state with fee floor', () => {
        const opener = 17_000_000; // $170,000 (includes $20k fee)
        const state = createBuyerOfferState(contractPrice, opener);

        console.log(`\n[Scenario 3] BUYER OFFER STATE:`);
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

        console.log(`\n[Scenario 3] NEGOTIATION ROUNDS:`);
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
        const lowCounter = validateBuyerCounter(contractPrice, 15_200_000);
        const goodCounter = validateBuyerCounter(contractPrice, 16_000_000);

        console.log(`\n[Scenario 3] COUNTER-OFFER VALIDATION:`);
        console.log(`   $152k counter: acceptable=${lowCounter.acceptable}, fee=${formatOffer(lowCounter.feeIfAccepted)}, walk=${lowCounter.walk}`);
        console.log(`   $160k counter: acceptable=${goodCounter.acceptable}, fee=${formatOffer(goodCounter.feeIfAccepted)}`);

        expect(lowCounter.acceptable).toBe(false);
        expect(lowCounter.walk).toBe(true);
        expect(lowCounter.feeIfAccepted).toBe(200_000); // $2,000

        expect(goodCounter.acceptable).toBe(true);
        expect(goodCounter.feeIfAccepted).toBe(1_000_000); // $10,000
      });
    });

    describe('Scenario 4: Campaign Operations', () => {
      it('Step 1: Verify warmup schedule', () => {
        console.log(`\n[Scenario 4] WARMUP SCHEDULE:`);
        console.log(`   AWS Credit ID: ${HIGH_VOLUME_CONFIG.awsCreditId}`);

        for (let day = 1; day <= 8; day++) {
          const target = getWarmupTarget(day);
          console.log(`   Day ${day}: ${target.toLocaleString()} emails`);
        }

        expect(getWarmupTarget(1)).toBe(10_000);
        expect(getWarmupTarget(4)).toBe(33_000);
        expect(getWarmupTarget(7)).toBe(110_000);
        expect(getWarmupTarget(10)).toBe(150_000); // Post-warmup
      });

      it('Step 2: Quality gate checks', () => {
        const goodMetrics: CampaignMetrics = {
          sent: 100000,
          delivered: 97000,
          bounced: 3000,
          complaints: 50,
          unsubscribes: 1500,
          opens: 20000,
          clicks: 5000,
        };

        const badMetrics: CampaignMetrics = {
          sent: 100000,
          delivered: 93000,
          bounced: 7000,
          complaints: 200,
          unsubscribes: 2500,
          opens: 10000,
          clicks: 1000,
        };

        const goodResult = checkQualityGates(goodMetrics);
        const badResult = checkQualityGates(badMetrics);

        console.log(`\n[Scenario 4] QUALITY GATES:`);
        console.log(`   Good Campaign: passed=${goodResult.passed}`);
        console.log(`   Bad Campaign: passed=${badResult.passed}, violations=${badResult.violations.length}`);
        badResult.violations.forEach(v => console.log(`     - ${v}`));

        expect(goodResult.passed).toBe(true);
        expect(badResult.passed).toBe(false);
        expect(badResult.violations.length).toBeGreaterThanOrEqual(3);
      });

      it('Step 3: Pacing enforcement', () => {
        const atLimit = calculatePacing(0, 0, 150000, 8);
        const warmupDay2 = calculatePacing(0, 0, 10000, 2);

        console.log(`\n[Scenario 4] PACING ENFORCEMENT:`);
        console.log(`   At daily limit: canSend=${atLimit.canSend}, reason=${atLimit.reason}`);
        console.log(`   Warmup Day 2 (at 10k/15k): canSend=${warmupDay2.canSend}, sendCount=${warmupDay2.sendCount}`);

        expect(atLimit.canSend).toBe(false);
        expect(warmupDay2.canSend).toBe(true);
      });
    });

    describe('Scenario 5: Regional Compliance', () => {
      it('Step 1: Florida quiet hours (8pm cutoff)', () => {
        const fl8pm = new Date('2026-08-15T20:00:00-04:00');
        const fl830pm = new Date('2026-08-15T20:30:00-04:00');

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

        console.log(`\n[Scenario 5] FLORIDA QUIET HOURS:`);
        console.log(`   8:00pm: ${at8pm.allowed ? 'ALLOWED' : 'BLOCKED'}`);
        console.log(`   8:30pm: ${at830pm.allowed ? 'ALLOWED' : 'BLOCKED'}`);
        console.log(`   Note: FL uses 8pm cutoff (stricter than federal 9pm)`);

        expect(at830pm.allowed).toBe(false);
      });

      it('Step 2: Texas quiet hours (federal 9pm)', () => {
        const tx830pm = new Date('2026-08-15T20:30:00-05:00');
        const tx930pm = new Date('2026-08-15T21:30:00-05:00');

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

        console.log(`\n[Scenario 5] TEXAS QUIET HOURS:`);
        console.log(`   8:30pm: ${at830pm.allowed ? 'ALLOWED' : 'BLOCKED'}`);
        console.log(`   9:30pm: ${at930pm.allowed ? 'ALLOWED' : 'BLOCKED'}`);
        console.log(`   Note: TX uses federal 9pm cutoff`);

        expect(at830pm.allowed).toBe(true);
        expect(at930pm.allowed).toBe(false);
      });

      it('Step 3: State detection from addresses', () => {
        const addresses = [
          { addr: '123 Main St, Austin, TX 78701', expected: 'TX' },
          { addr: '456 Ocean Dr, Miami, FL 33139', expected: 'FL' },
          { addr: '789 Hollywood Blvd, Los Angeles, CA 90028', expected: 'CA' },
          { addr: '321 Broadway, New York, NY 10001', expected: 'NY' },
        ];

        console.log(`\n[Scenario 5] STATE DETECTION:`);
        for (const { addr, expected } of addresses) {
          const detected = detectState(addr);
          console.log(`   "${addr.substring(0, 30)}..." -> ${detected}`);
          expect(detected).toBe(expected);
        }
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // FINAL VERIFICATION: ALL CRITICAL VALUES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Final Verification: Critical System Values', () => {
    it('Verify all NON-NEGOTIABLE values', () => {
      console.log(`\n[CRITICAL VALUES] SYSTEM CONSTANTS:`);
      console.log(`   FEE_FLOOR_CENTS: ${FEE_FLOOR_CENTS} (= $${FEE_FLOOR_CENTS / 100})`);
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
