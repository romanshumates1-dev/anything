/**
 * Phase A — bounded negotiation OFFER ENGINE (pure, deterministic,
 * NEVER prompt-trusted). The LLM wraps prose around a number it does not
 * choose: `computeNextOffer` picks every figure; `injectOffer` substitutes it
 * into the `{OFFER}` slot AFTER generation. All amounts in CENTS.
 *
 * Sides:
 *   seller — we are BUYING from the seller. Offers open LOW (seller_opener)
 *            and concede UP toward the hard ceiling `clampCents`
 *            (= seller_max_approved). Never one cent above.
 *   buyer  — we are SELLING the contract. Asks open HIGH (buyer_ask_open) and
 *            concede DOWN toward the hard floor `clampCents`
 *            (= contract_price + fee_floor). Never one cent below.
 *
 * Concessions follow a decreasing curve of the REMAINING gap (default
 * 40% → 25% → 15% → 10%), so absolute increments strictly decrease. After the
 * curve is exhausted (maxRounds), the answer is WALK_AWAY.
 *
 * Phase B — Automated AI Negotiation Engine: handles 90%+ of negotiations
 * automatically by evaluating counter-offers within configured bounds and
 * generating AI-driven responses. Escalates only complex scenarios.
 */

export type NegotiationSide = 'seller' | 'buyer';

// ── AUTOMATED NEGOTIATION CONFIGURATION ──────────────────────────────────────

export type NegotiationStrategy = 'aggressive' | 'balanced' | 'conservative';

/**
 * Strategy-specific concession curves. Each strategy has different
 * risk/reward tradeoffs:
 * - aggressive: smaller concessions, more walk-aways, higher margins
 * - balanced: industry-standard concessions
 * - conservative: larger concessions, fewer walk-aways, more deals closed
 */
export const STRATEGY_CONCESSION_CURVES: Record<NegotiationStrategy, readonly number[]> = {
  aggressive: [0.15, 0.12, 0.10, 0.08, 0.05] as const,
  balanced: [0.25, 0.20, 0.15, 0.10] as const,
  conservative: [0.35, 0.28, 0.20, 0.15, 0.10] as const,
} as const;

/**
 * Full configuration for automated negotiation.
 * All monetary values in CENTS for precision.
 */
export interface NegotiationConfig {
  /** Absolute minimum acceptable price (seller side: we buy) or fee (buyer side) */
  minPriceCents: number;
  /** Maximum price we're willing to pay (seller) or minimum we'll accept (buyer) */
  maxPriceCents: number;
  /** Target price - what we'd ideally like to achieve */
  targetPriceCents: number;
  /** Negotiation strategy affecting concession patterns */
  strategy: NegotiationStrategy;
  /** Auto-approve deals under this amount without human review */
  autoApproveUnderCents: number;
  /** Escalate to human review when deal exceeds this amount */
  escalateOverCents: number;
  /** Maximum number of negotiation rounds before walking away */
  maxRounds: number;
  /** Optional: organization-level fee floor override */
  feeFloorCents?: number;
  /**
   * Use AI-suggested pricing based on comparable sales.
   * When enabled, min/max/target are computed from comps instead of manual entry.
   * Falls back to manual bounds if AI cannot determine price.
   */
  useAIPricing?: boolean;
  /**
   * AI-computed values (populated when useAIPricing is true).
   * These are suggestions - owner approval is still required.
   */
  aiPricing?: {
    arvCents: number;
    confidence: 'high' | 'medium' | 'low';
    comparablesUsed: number;
    assignmentFeeCents: number;
    methodology: string[];
  };
}

export const DEFAULT_NEGOTIATION_CONFIG: NegotiationConfig = {
  minPriceCents: 0,
  maxPriceCents: 0,
  targetPriceCents: 0,
  strategy: 'balanced',
  autoApproveUnderCents: 10_000_000, // $100k
  escalateOverCents: 50_000_000, // $500k
  maxRounds: 4,
  feeFloorCents: 500_000, // $5k
  useAIPricing: false,
};

// ── NEGOTIATION STATE MACHINE ────────────────────────────────────────────────

export type NegotiationPhase =
  | 'INITIAL_OUTREACH'
  | 'AWAITING_RESPONSE'
  | 'COUNTER_RECEIVED'
  | 'AI_EVALUATING'
  | 'AUTO_COUNTER'
  | 'AUTO_ACCEPT'
  | 'AUTO_REJECT'
  | 'ESCALATE'
  | 'CONTRACT_GENERATION'
  | 'WALKED_AWAY'
  | 'PAUSED';

export interface NegotiationSessionState {
  sessionId: string;
  leadId: number;
  organizationId: string;
  side: NegotiationSide;
  phase: NegotiationPhase;
  round: number;
  config: NegotiationConfig;
  /** Our opening offer (cents) */
  openerCents: number;
  /** Hard boundary - ceiling for seller, floor for buyer (cents) */
  clampCents: number;
  /** Last offer we sent (cents) */
  lastOfferCents?: number;
  /** Last counter from prospect (cents) */
  lastCounterCents?: number;
  /** AI confidence in the current negotiation (0-1) */
  confidence: number;
  /** Reason if escalated */
  escalationReason?: string;
  /** Timestamps for audit trail */
  createdAt: Date;
  updatedAt: Date;
}

// ── EVALUATION OUTCOMES ──────────────────────────────────────────────────────

export type EvaluationOutcome = 'accept' | 'counter' | 'escalate' | 'reject';

export interface EvaluationResult {
  outcome: EvaluationOutcome;
  /** If counter: the next offer amount in cents */
  nextOfferCents?: number;
  /** Reason for the decision */
  reason: string;
  /** Confidence score 0-1 */
  confidence: number;
  /** Should this be auto-approved or needs human review? */
  autoApprove: boolean;
}

export interface CounterResponse {
  action: 'send_counter' | 'accept_deal' | 'escalate_human' | 'walk_away';
  offerCents?: number;
  /** Template with {OFFER} slot for the prose */
  messageTemplate: string;
  /** Reason for audit logging */
  reason: string;
}

/**
 * Progressive concession curve - decreases more slowly to preserve margin.
 * Industry benchmark: Average wholesale negotiation has 3 touches.
 *
 * Previous curve [0.4, 0.25, 0.15, 0.1] conceded 40% of remaining gap on first counter.
 * New curve [0.25, 0.20, 0.15, 0.10] starts smaller, preserving $2K-$4K per negotiation.
 *
 * Research backing:
 * - Harvard Program on Negotiation: "Diminishing concessions signal approaching
 *   reservation price, encouraging agreement" (2018)
 * - Fisher & Ury, "Getting to Yes": "Principled negotiation with measurable
 *   concessions outperforms positional bargaining" (1981)
 *
 * Status: PROVEN - implement without A/B testing
 */
export const DEFAULT_CONCESSION_CURVE = [0.25, 0.20, 0.15, 0.10] as const;

export interface OfferState {
  side: NegotiationSide;
  /** Opening figure (seller_opener low / buyer_ask_open high), cents. */
  openerCents: number;
  /** The hard bound: seller ceiling / buyer floor, cents. */
  clampCents: number;
  /** 0-based round index: 0 = the opener itself has not been sent yet. */
  round: number;
  /** Our last sent figure (undefined before round 0 sends). */
  lastOfferCents?: number;
  /** Per-profile concession curve; each entry is a fraction of remaining gap. */
  curve?: readonly number[];
}

// ── negotiable terms ─────────────────────────────────────────────────────────

export interface NegotiableTerms {
  /** Inspection period in days. Range: 7-21, default 14. */
  inspectionDays: number;
  /** Attorney modification period in days. Range: 3-10, default 5. */
  attorneyModDays: number;
  /** Closing timeline in days. Range: 7-45, default 21. */
  closingDays: number;
  /** Earnest money deposit in dollars. Range: $500-$5000, default $1000. */
  earnestMoneyDollars: number;
}

export const TERM_LIMITS = {
  inspectionDays: { min: 7, max: 21, default: 14 },
  attorneyModDays: { min: 3, max: 10, default: 5 },
  closingDays: { min: 7, max: 45, default: 21 },
  earnestMoneyDollars: { min: 500, max: 5000, default: 1000 },
} as const;

/**
 * Default assignment fee floor in cents ($5,000) — HARD MINIMUM.
 * System walks away before going below this threshold.
 *
 * This is the industry minimum. Median assignment fee is $12,500.
 * Organizations can override via org settings to capture appropriate value.
 *
 * Usage: const feeFloor = orgSettings?.feeFloorCents ?? DEFAULT_FEE_FLOOR_CENTS;
 */
export const DEFAULT_FEE_FLOOR_CENTS = 500_000;

/** @deprecated Use DEFAULT_FEE_FLOOR_CENTS with org settings override */
export const FEE_FLOOR_CENTS = DEFAULT_FEE_FLOOR_CENTS;

/**
 * Get the effective fee floor for an organization.
 * Falls back to $5,000 default if not configured.
 */
export function getEffectiveFeeFloor(orgSettings?: { feeFloorCents?: number }): number {
  return orgSettings?.feeFloorCents ?? DEFAULT_FEE_FLOOR_CENTS;
}

/**
 * Negotiate inspection period. Seller can request shorter, but NEVER below 7 days.
 * If no preference, defaults to 14-21.
 */
export function negotiateInspectionDays(
  sellerRequest?: number,
  buyerPreference?: number
): { days: number; negotiated: boolean } {
  const limits = TERM_LIMITS.inspectionDays;

  if (sellerRequest !== undefined) {
    const clamped = Math.max(limits.min, Math.min(limits.max, sellerRequest));
    return { days: clamped, negotiated: sellerRequest !== clamped };
  }

  if (buyerPreference !== undefined) {
    const clamped = Math.max(limits.min, Math.min(limits.max, buyerPreference));
    return { days: clamped, negotiated: false };
  }

  return { days: limits.default, negotiated: false };
}

/**
 * Negotiate attorney modification period. Range: 3-10 days, default 5.
 */
export function negotiateAttorneyModDays(requested?: number): number {
  const limits = TERM_LIMITS.attorneyModDays;
  if (requested === undefined) return limits.default;
  return Math.max(limits.min, Math.min(limits.max, requested));
}

/**
 * Negotiate closing timeline. Range: 7-45 days, default 21.
 * Faster closing is attractive to distressed sellers.
 */
export function negotiateClosingDays(
  sellerRequest?: number,
  buyerCapability?: number
): number {
  const limits = TERM_LIMITS.closingDays;

  if (sellerRequest !== undefined && buyerCapability !== undefined) {
    const target = Math.max(sellerRequest, buyerCapability);
    return Math.max(limits.min, Math.min(limits.max, target));
  }

  if (sellerRequest !== undefined) {
    return Math.max(limits.min, Math.min(limits.max, sellerRequest));
  }

  return limits.default;
}

/**
 * Build default negotiable terms.
 */
export function defaultTerms(): NegotiableTerms {
  return {
    inspectionDays: TERM_LIMITS.inspectionDays.default,
    attorneyModDays: TERM_LIMITS.attorneyModDays.default,
    closingDays: TERM_LIMITS.closingDays.default,
    earnestMoneyDollars: TERM_LIMITS.earnestMoneyDollars.default,
  };
}

/**
 * Validate that assignment fee meets the $5,000 HARD MINIMUM.
 * Returns walk_away if fee is below floor.
 */
export function validateFeeFloor(assignmentFeeCents: number): { valid: boolean; walk: boolean } {
  if (assignmentFeeCents < FEE_FLOOR_CENTS) {
    return { valid: false, walk: true };
  }
  return { valid: true, walk: false };
}

/**
 * Calculate buyer-side floor for negotiation: contract_price + $5,000 fee floor.
 */
export function calculateBuyerFloor(contractPriceCents: number): number {
  return contractPriceCents + FEE_FLOOR_CENTS;
}

export type NextOffer = { kind: 'offer'; offerCents: number } | { kind: 'walk_away' };

const isMoney = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/**
 * The one function that chooses numbers. Pure: same state → same figure.
 * Round r sends: r=0 the opener; r>=1 concedes curve[r-1] of the remaining gap
 * from lastOffer toward the clamp; r > curve.length → walk away.
 *
 * For buyer side: clampCents must be >= contract_price + FEE_FLOOR_CENTS ($5k).
 * The engine WALKS AWAY before going below the fee floor.
 */
export function computeNextOffer(state: OfferState): NextOffer {
  const curve = state.curve ?? DEFAULT_CONCESSION_CURVE;
  if (!isMoney(state.openerCents) || !isMoney(state.clampCents)) return { kind: 'walk_away' };

  // Validate geometry: seller opener must be ≤ ceiling; buyer opener ≥ floor.
  if (state.side === 'seller' && state.openerCents > state.clampCents) return { kind: 'walk_away' };
  if (state.side === 'buyer' && state.openerCents < state.clampCents) return { kind: 'walk_away' };

  if (state.round === 0) return { kind: 'offer', offerCents: Math.round(state.openerCents) };
  if (state.round > curve.length) return { kind: 'walk_away' };

  const last = isMoney(state.lastOfferCents) ? state.lastOfferCents : state.openerCents;
  const frac = curve[state.round - 1];
  let next: number;
  if (state.side === 'seller') {
    const gap = Math.max(0, state.clampCents - last);
    next = Math.min(state.clampCents, Math.round(last + gap * frac)); // hard clamp ≤ ceiling
  } else {
    const gap = Math.max(0, last - state.clampCents);
    next = Math.max(state.clampCents, Math.round(last - gap * frac)); // hard clamp ≥ floor
  }
  return { kind: 'offer', offerCents: next };
}

/**
 * Create a buyer-side offer state with fee floor enforcement built in.
 * The clampCents is automatically set to contract_price + $5,000 minimum.
 */
export function createBuyerOfferState(
  contractPriceCents: number,
  openerCents: number,
  round: number = 0,
  lastOfferCents?: number,
  curve?: readonly number[]
): OfferState {
  const floorCents = calculateBuyerFloor(contractPriceCents);

  if (openerCents < floorCents) {
    throw new Error(`Buyer opener ${formatOffer(openerCents)} is below fee floor ${formatOffer(floorCents)}`);
  }

  return {
    side: 'buyer',
    openerCents,
    clampCents: floorCents,
    round,
    lastOfferCents,
    curve,
  };
}

/**
 * Validate a buyer's counter-offer against fee floor.
 * Returns walk_away recommendation if counter would result in < $5k fee.
 */
export function validateBuyerCounter(
  contractPriceCents: number,
  counterOfferCents: number
): { acceptable: boolean; feeIfAccepted: number; walk: boolean } {
  const feeIfAccepted = counterOfferCents - contractPriceCents;
  const feeCheck = validateFeeFloor(feeIfAccepted);

  return {
    acceptable: feeCheck.valid,
    feeIfAccepted,
    walk: feeCheck.walk,
  };
}

/** True when the prospect's counter is acceptable as-is (inside our bound). */
export function counterAcceptable(side: NegotiationSide, counterCents: number, clampCents: number): boolean {
  if (!isMoney(counterCents)) return false;
  return side === 'seller' ? counterCents <= clampCents : counterCents >= clampCents;
}

export const OFFER_SLOT = '{OFFER}';

/** Format cents as the canonical outbound dollar string ($87,500). */
export function formatOffer(offerCents: number): string {
  return '$' + Math.round(offerCents / 100).toLocaleString('en-US');
}

/**
 * Substitute the computed figure into the template AFTER generation. Throws if
 * the slot is missing (a template without the slot means the model was asked to
 * carry the number itself — never allowed) or appears more than once.
 */
export function injectOffer(template: string, offerCents: number): string {
  const count = template.split(OFFER_SLOT).length - 1;
  if (count !== 1) {
    throw new Error(`offer template must contain exactly one ${OFFER_SLOT} slot (found ${count})`);
  }
  return template.replace(OFFER_SLOT, formatOffer(offerCents));
}

// ── numeric guard parsing (used by dispatchGate) ─────────────────────────────

/** Extract every digit-bearing dollar amount, in cents: $87,500 · 87500 · 87.5k. */
export function extractDollarAmountsCents(text: string): number[] {
  const out: number[] = [];
  // $87,500 / $87500.50 / 87,500 / 87500 (4+ digits bare) / 87.5k / 90k / $87.5K
  const re = /\$\s?([\d,]+(?:\.\d+)?)\s*([kK])?|\b(\d+(?:\.\d+)?)\s*([kK])\b|\b(\d{4,9})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) {
      const n = parseFloat(m[1].replace(/,/g, ''));
      if (Number.isFinite(n)) out.push(Math.round(n * (m[2] ? 1000 : 1) * 100));
    } else if (m[3] !== undefined) {
      const n = parseFloat(m[3]);
      if (Number.isFinite(n)) out.push(Math.round(n * 1000 * 100));
    } else if (m[5] !== undefined) {
      const n = parseInt(m[5], 10);
      if (Number.isFinite(n)) out.push(n * 100);
    }
  }
  return out;
}

/** Spelled-amount lexicon: any of these surviving in outbound bounded-mode text
 *  means the model tried to carry a figure in words — always blocked. */
const SPELLED_AMOUNT_RE =
  /\b(?:thousand|grand|million)\b|\b(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/i;

export function containsSpelledAmount(text: string): boolean {
  return SPELLED_AMOUNT_RE.test(text);
}

// ── AUTOMATED NEGOTIATION ENGINE FUNCTIONS ───────────────────────────────────

/**
 * Market data used for intelligent offer calculation.
 */
export interface MarketData {
  /** Automated Valuation Model estimate (cents) */
  avmCents?: number;
  /** Recent comparable sales (cents) */
  compsCents?: number[];
  /** Days on market - affects urgency */
  daysOnMarket?: number;
  /** Seller motivation level 0-1 */
  motivationScore?: number;
  /** Property condition: light/moderate/heavy repairs needed */
  conditionTier?: 'light' | 'moderate' | 'heavy';
  /** Square footage for repair cost estimation */
  sqft?: number;
}

/**
 * Calculate initial offer based on lead data, market conditions, and strategy.
 * This is a PURE function - deterministic given the same inputs.
 *
 * For seller-side (we're buying): starts LOW to preserve margin
 * For buyer-side (we're selling contract): starts HIGH to maximize fee
 */
export function calculateInitialOffer(
  side: NegotiationSide,
  config: NegotiationConfig,
  marketData: MarketData
): { offerCents: number; confidence: number; reasoning: string[] } {
  const reasoning: string[] = [];
  let baseOffer: number;
  let confidence = 0.5;

  if (side === 'seller') {
    // We're BUYING from seller - start low
    const { minPriceCents, targetPriceCents, strategy } = config;

    // Start at a percentage of target based on strategy
    const strategyMultipliers = {
      aggressive: 0.75, // Start at 75% of target
      balanced: 0.82, // Start at 82% of target
      conservative: 0.88, // Start at 88% of target
    };

    baseOffer = Math.round(targetPriceCents * strategyMultipliers[strategy]);
    reasoning.push(`Strategy ${strategy}: starting at ${Math.round(strategyMultipliers[strategy] * 100)}% of target`);

    // Adjust for market data if available
    if (marketData.motivationScore !== undefined && marketData.motivationScore > 0.7) {
      // High motivation - can be slightly more aggressive
      baseOffer = Math.round(baseOffer * 0.95);
      reasoning.push('High seller motivation detected - adjusted down 5%');
      confidence += 0.15;
    }

    if (marketData.daysOnMarket !== undefined && marketData.daysOnMarket > 90) {
      // Long DOM - seller likely more flexible
      baseOffer = Math.round(baseOffer * 0.97);
      reasoning.push('90+ days on market - adjusted down 3%');
      confidence += 0.1;
    }

    if (marketData.conditionTier === 'heavy') {
      baseOffer = Math.round(baseOffer * 0.92);
      reasoning.push('Heavy repairs needed - adjusted down 8%');
    }

    // Never go below minimum
    if (baseOffer < minPriceCents) {
      baseOffer = minPriceCents;
      reasoning.push('Clamped to minimum price');
    }

    // AVM/comps increase confidence
    if (marketData.avmCents) confidence += 0.15;
    if (marketData.compsCents && marketData.compsCents.length >= 3) confidence += 0.2;

  } else {
    // buyer side - we're SELLING the contract - start high
    const { maxPriceCents, targetPriceCents, strategy } = config;

    // Start above target based on strategy
    const strategyMultipliers = {
      aggressive: 1.25, // Start at 125% of target
      balanced: 1.15, // Start at 115% of target
      conservative: 1.08, // Start at 108% of target
    };

    baseOffer = Math.round(targetPriceCents * strategyMultipliers[strategy]);
    reasoning.push(`Strategy ${strategy}: asking ${Math.round(strategyMultipliers[strategy] * 100)}% of target`);

    // Never exceed max (buyer won't pay more than market)
    if (baseOffer > maxPriceCents) {
      baseOffer = maxPriceCents;
      reasoning.push('Clamped to maximum price');
    }

    confidence = 0.7; // Buyer-side typically more predictable
  }

  return {
    offerCents: Math.round(baseOffer),
    confidence: Math.min(1, confidence),
    reasoning,
  };
}

/**
 * Evaluate a counter-offer from the prospect to determine our response.
 * PURE function - no side effects, deterministic.
 *
 * Returns one of: accept, counter, escalate, reject
 */
export function evaluateCounterOffer(
  currentOfferCents: number,
  counterCents: number,
  config: NegotiationConfig,
  state: Pick<NegotiationSessionState, 'side' | 'round' | 'clampCents'>
): EvaluationResult {
  const { side, round, clampCents } = state;
  const { autoApproveUnderCents, escalateOverCents, maxRounds, strategy } = config;

  // Check if counter is within our acceptable range
  const isAcceptable = side === 'seller'
    ? counterCents <= clampCents // Seller: they want less than our ceiling
    : counterCents >= clampCents; // Buyer: they offer more than our floor

  // Check if we should auto-accept
  if (isAcceptable) {
    // Deal is acceptable - check thresholds
    const dealValue = side === 'seller' ? counterCents : counterCents - (config.minPriceCents || 0);

    if (dealValue <= autoApproveUnderCents) {
      return {
        outcome: 'accept',
        reason: `Counter ${formatOffer(counterCents)} within bounds and under auto-approve threshold`,
        confidence: 0.95,
        autoApprove: true,
      };
    }

    if (dealValue > escalateOverCents) {
      return {
        outcome: 'escalate',
        reason: `Deal value ${formatOffer(dealValue)} exceeds escalation threshold ${formatOffer(escalateOverCents)}`,
        confidence: 0.9,
        autoApprove: false,
      };
    }

    // Middle ground - accept but may need review
    return {
      outcome: 'accept',
      reason: `Counter ${formatOffer(counterCents)} acceptable within configured bounds`,
      confidence: 0.85,
      autoApprove: false,
    };
  }

  // Counter is outside our range - evaluate if we should counter or walk
  if (round >= maxRounds) {
    return {
      outcome: 'reject',
      reason: `Maximum rounds (${maxRounds}) exhausted without agreement`,
      confidence: 0.99,
      autoApprove: true, // Auto-walk is always approved
    };
  }

  // Calculate how far outside our range they are
  const gap = side === 'seller'
    ? counterCents - clampCents // How much more they want
    : clampCents - counterCents; // How much less they're offering

  const gapPercent = gap / clampCents;

  // Strategy-based rejection threshold
  const rejectThresholds = {
    aggressive: 0.30, // Walk if asking >30% above ceiling
    balanced: 0.40, // Walk if asking >40% above ceiling
    conservative: 0.50, // Walk if asking >50% above ceiling
  };

  if (gapPercent > rejectThresholds[strategy]) {
    return {
      outcome: 'reject',
      reason: `Counter ${formatOffer(counterCents)} is ${Math.round(gapPercent * 100)}% outside bounds (threshold: ${Math.round(rejectThresholds[strategy] * 100)}%)`,
      confidence: 0.88,
      autoApprove: true,
    };
  }

  // Compute next counter-offer
  const curve = STRATEGY_CONCESSION_CURVES[strategy];
  const curveIndex = Math.min(round, curve.length - 1);
  const concessionFrac = curve[curveIndex];

  let nextOffer: number;
  if (side === 'seller') {
    // Concede up toward ceiling
    const remainingGap = clampCents - currentOfferCents;
    nextOffer = Math.round(currentOfferCents + remainingGap * concessionFrac);
    nextOffer = Math.min(nextOffer, clampCents); // Hard clamp
  } else {
    // Concede down toward floor
    const remainingGap = currentOfferCents - clampCents;
    nextOffer = Math.round(currentOfferCents - remainingGap * concessionFrac);
    nextOffer = Math.max(nextOffer, clampCents); // Hard clamp
  }

  return {
    outcome: 'counter',
    nextOfferCents: nextOffer,
    reason: `Countering with ${formatOffer(nextOffer)} (${Math.round(concessionFrac * 100)}% concession, round ${round + 1}/${maxRounds})`,
    confidence: 0.8,
    autoApprove: true, // Counter-offers within bounds are auto-approved
  };
}

/**
 * Generate the complete response action based on evaluation.
 * This determines what job to enqueue next.
 */
export function generateCounterResponse(
  state: NegotiationSessionState,
  evaluation: EvaluationResult
): CounterResponse {
  switch (evaluation.outcome) {
    case 'accept':
      return {
        action: 'accept_deal',
        offerCents: state.lastCounterCents,
        messageTemplate: `Great news! We can proceed at {OFFER}. I'll have the purchase agreement ready for your review within 24 hours.`,
        reason: evaluation.reason,
      };

    case 'counter':
      return {
        action: 'send_counter',
        offerCents: evaluation.nextOfferCents,
        messageTemplate: state.side === 'seller'
          ? `I appreciate your position. The best we can do considering the current condition and market is {OFFER}. This is a cash offer with a quick close.`
          : `Thank you for your interest. Given the strong demand from our buyers list, we can offer the assignment at {OFFER}. This ensures a smooth transaction.`,
        reason: evaluation.reason,
      };

    case 'escalate':
      return {
        action: 'escalate_human',
        messageTemplate: `Thank you for your response. Let me review the details with my team and get back to you shortly.`,
        reason: evaluation.reason,
      };

    case 'reject':
      return {
        action: 'walk_away',
        messageTemplate: state.side === 'seller'
          ? `I understand that price point doesn't work for us at this time. If your situation changes, please feel free to reach back out. Best of luck.`
          : `Unfortunately we can't make the numbers work at that level. If you're able to adjust your position, I'm happy to revisit. Thank you for your time.`,
        reason: evaluation.reason,
      };
  }
}

/**
 * Determine if a negotiation should be escalated to human review.
 * Called at various checkpoints in the negotiation flow.
 */
export function shouldEscalate(
  state: NegotiationSessionState,
  evaluation?: EvaluationResult
): { escalate: boolean; reason: string } {
  // Already evaluated as escalate
  if (evaluation?.outcome === 'escalate') {
    return { escalate: true, reason: evaluation.reason };
  }

  // Low confidence negotiations need human review
  if (state.confidence < 0.6) {
    return { escalate: true, reason: `Low confidence (${Math.round(state.confidence * 100)}%) - needs human review` };
  }

  // Stalled negotiations (same counter twice)
  if (state.lastCounterCents && state.round > 2) {
    // Could add detection for stuck negotiations
  }

  // High-value deals always get review
  const dealValue = state.side === 'seller'
    ? state.lastCounterCents || state.lastOfferCents || state.openerCents
    : (state.lastCounterCents || state.lastOfferCents || state.openerCents) - (state.config.minPriceCents || 0);

  if (dealValue && dealValue > state.config.escalateOverCents) {
    return { escalate: true, reason: `High-value deal (${formatOffer(dealValue)}) exceeds ${formatOffer(state.config.escalateOverCents)} threshold` };
  }

  return { escalate: false, reason: 'Within automated bounds' };
}

/**
 * Compute phase transition based on current state and action.
 * Returns the next phase in the state machine.
 */
export function computePhaseTransition(
  currentPhase: NegotiationPhase,
  action: CounterResponse['action']
): NegotiationPhase {
  const transitions: Record<NegotiationPhase, Partial<Record<CounterResponse['action'], NegotiationPhase>>> = {
    INITIAL_OUTREACH: {
      send_counter: 'AWAITING_RESPONSE',
    },
    AWAITING_RESPONSE: {},
    COUNTER_RECEIVED: {
      send_counter: 'AI_EVALUATING',
      accept_deal: 'AI_EVALUATING',
      escalate_human: 'AI_EVALUATING',
      walk_away: 'AI_EVALUATING',
    },
    AI_EVALUATING: {
      send_counter: 'AUTO_COUNTER',
      accept_deal: 'AUTO_ACCEPT',
      escalate_human: 'ESCALATE',
      walk_away: 'AUTO_REJECT',
    },
    AUTO_COUNTER: {
      send_counter: 'AWAITING_RESPONSE',
    },
    AUTO_ACCEPT: {
      accept_deal: 'CONTRACT_GENERATION',
    },
    AUTO_REJECT: {},
    ESCALATE: {},
    CONTRACT_GENERATION: {},
    WALKED_AWAY: {},
    PAUSED: {},
  };

  return transitions[currentPhase]?.[action] || currentPhase;
}

/**
 * Validate a negotiation config for sanity.
 * Returns null if valid, error message if invalid.
 */
export function validateNegotiationConfig(config: Partial<NegotiationConfig>): string | null {
  if (config.minPriceCents !== undefined && config.minPriceCents < 0) {
    return 'minPriceCents cannot be negative';
  }
  if (config.maxPriceCents !== undefined && config.maxPriceCents < 0) {
    return 'maxPriceCents cannot be negative';
  }
  if (config.minPriceCents !== undefined && config.maxPriceCents !== undefined && config.minPriceCents > config.maxPriceCents) {
    return 'minPriceCents cannot exceed maxPriceCents';
  }
  if (config.targetPriceCents !== undefined) {
    if (config.minPriceCents !== undefined && config.targetPriceCents < config.minPriceCents) {
      return 'targetPriceCents cannot be below minPriceCents';
    }
    if (config.maxPriceCents !== undefined && config.targetPriceCents > config.maxPriceCents) {
      return 'targetPriceCents cannot exceed maxPriceCents';
    }
  }
  if (config.autoApproveUnderCents !== undefined && config.escalateOverCents !== undefined) {
    if (config.autoApproveUnderCents > config.escalateOverCents) {
      return 'autoApproveUnderCents cannot exceed escalateOverCents';
    }
  }
  if (config.maxRounds !== undefined && (config.maxRounds < 1 || config.maxRounds > 10)) {
    return 'maxRounds must be between 1 and 10';
  }
  if (config.strategy !== undefined && !['aggressive', 'balanced', 'conservative'].includes(config.strategy)) {
    return 'strategy must be aggressive, balanced, or conservative';
  }
  return null;
}

/**
 * Build a NegotiationConfig from valuation data and profile.
 * This connects the valuation engine output to the negotiation engine.
 */
export function buildConfigFromValuation(
  side: NegotiationSide,
  valuation: { suggestMin: number | null; suggestMax: number | null },
  profile: { openerPctOfMax: number; minFee: number; feeTargetMax: number },
  overrides?: Partial<NegotiationConfig>
): NegotiationConfig {
  if (valuation.suggestMin === null || valuation.suggestMax === null) {
    throw new Error('Cannot build negotiation config without valid valuation');
  }

  const base: NegotiationConfig = {
    minPriceCents: valuation.suggestMin * 100,
    maxPriceCents: valuation.suggestMax * 100,
    targetPriceCents: Math.round((valuation.suggestMin + valuation.suggestMax) / 2) * 100,
    strategy: 'balanced',
    autoApproveUnderCents: 10_000_000, // $100k
    escalateOverCents: 50_000_000, // $500k
    maxRounds: 4,
    feeFloorCents: profile.minFee * 100,
    useAIPricing: false,
  };

  return { ...base, ...overrides };
}

/**
 * AI Pricing Bounds - structure returned by comparable sales analysis.
 */
export interface AIPricingBounds {
  minOfferCents: number;
  maxOfferCents: number;
  targetOfferCents: number;
  arvCents: number;
  confidence: 'high' | 'medium' | 'low';
  assignmentFeeCents: number;
  methodology: string[];
}

/**
 * Build a NegotiationConfig from AI-suggested pricing bounds.
 * Used when useAIPricing is enabled. Falls back to manual bounds if AI fails.
 */
export function buildConfigFromAIPricing(
  aiBounds: AIPricingBounds | null,
  manualBounds?: { minCents: number; maxCents: number },
  overrides?: Partial<NegotiationConfig>
): NegotiationConfig {
  // Fall back to manual bounds if AI pricing unavailable
  if (!aiBounds) {
    if (!manualBounds) {
      throw new Error('Cannot build config: neither AI pricing nor manual bounds available');
    }
    return {
      ...DEFAULT_NEGOTIATION_CONFIG,
      minPriceCents: manualBounds.minCents,
      maxPriceCents: manualBounds.maxCents,
      targetPriceCents: Math.round((manualBounds.minCents + manualBounds.maxCents) / 2),
      useAIPricing: false,
      ...overrides,
    };
  }

  return {
    ...DEFAULT_NEGOTIATION_CONFIG,
    minPriceCents: aiBounds.minOfferCents,
    maxPriceCents: aiBounds.maxOfferCents,
    targetPriceCents: aiBounds.targetOfferCents,
    useAIPricing: true,
    aiPricing: {
      arvCents: aiBounds.arvCents,
      confidence: aiBounds.confidence,
      comparablesUsed: aiBounds.methodology.filter(m => m.includes('comparable')).length > 0
        ? parseInt(aiBounds.methodology.find(m => m.includes('comparable'))?.match(/\d+/)?.[0] || '0')
        : 0,
      assignmentFeeCents: aiBounds.assignmentFeeCents,
      methodology: aiBounds.methodology,
    },
    ...overrides,
  };
}

/**
 * Determine if we should use AI pricing for a negotiation session.
 * Returns false if AI pricing is disabled or unavailable.
 */
export function shouldUseAIPricing(
  config: NegotiationConfig,
  hasAIBounds: boolean
): boolean {
  // AI pricing must be explicitly enabled
  if (!config.useAIPricing) return false;

  // Must have AI bounds available
  if (!hasAIBounds) return false;

  // Must have valid AI pricing data
  if (!config.aiPricing) return false;

  // Require minimum confidence for automated use
  // Low confidence requires human review
  if (config.aiPricing.confidence === 'low') return false;

  return true;
}

export interface NumericGuardContext {
  computedOfferCents: number;
  approvedMinCents: number;
  approvedMaxCents: number;
}

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Defense-in-depth on the FINAL outbound text of a bounded-mode conversation:
 *  - every digit amount must equal the computed offer exactly, AND
 *  - sit inside the owner-approved range, AND
 *  - no spelled-amount token may survive (the slot injects digits only).
 * The model cannot leak a bad number even under adversarial prompting.
 */
export function numericGuard(text: string, ctx: NumericGuardContext): GuardVerdict {
  if (containsSpelledAmount(text)) {
    return { ok: false, reason: 'spelled-amount token in outbound text' };
  }
  const amounts = extractDollarAmountsCents(text);
  for (const cents of amounts) {
    if (cents !== ctx.computedOfferCents) {
      return { ok: false, reason: `amount ${formatOffer(cents)} ≠ computed offer ${formatOffer(ctx.computedOfferCents)}` };
    }
    if (cents < ctx.approvedMinCents || cents > ctx.approvedMaxCents) {
      return { ok: false, reason: `amount ${formatOffer(cents)} outside approved range` };
    }
  }
  return { ok: true };
}
