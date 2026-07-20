/**
 * Phase N — valuation engine (PURE, deterministic, OWNER-ONLY).
 *
 * Computes a SUGGESTED min/max range and confidence for the OWNER to review and
 * approve. It is not AI, it never touches a prospect, and the escalation
 * invariant is untouched: the AI still never emits a number on any channel.
 * Owner approval writes the actual min/max exactly as today.
 *
 * Formula (parameterized per profile):
 *   repairs     = sqft × tier_psf + Σ big_ticket_adders   (foundation → ESCALATE)
 *   buyer_max   = ARV × arv_multiplier − repairs
 *   suggest_max = buyer_max − min_fee
 *   suggest_min = suggest_max × opener_pct_of_max
 *   confidence  = f(has_avm, comps, requires_manual_comps, sqft) → HIGH|MED|LOW
 *
 * Garbage in → escalate + null suggestions. Never NaN, never a negative offer.
 */

export type ConditionTier = 'light' | 'moderate' | 'heavy';
export type Confidence = 'HIGH' | 'MED' | 'LOW';

/** Adder value is a dollar number, OR the sentinel 'ESCALATE' (e.g. foundation). */
export type BigTicketAdders = Record<string, number | 'ESCALATE'>;

export interface NegotiationProfileParams {
  arvMultiplier: number;
  repairLightPsf: number;
  repairModeratePsf: number;
  repairHeavyPsf: number;
  bigTicketAdders: BigTicketAdders;
  minFee: number;
  feeTargetMax: number;
  openerPctOfMax: number;
  requiresManualComps: boolean;
  // Phase V fee economics (defaults applied by feeEconomics() when absent).
  /** Absolute minimum acceptable assignment profit. Default $3,000. */
  feeFloor?: number;
  /** Target assignment fee for owner-facing suggestions. Default $10,000. */
  feeTarget?: number;
  /** Upper band the buyer-side opener reaches for. Default $30,000. */
  feeStretch?: number;
}

export const DEFAULT_FEE_FLOOR = 3000;
export const DEFAULT_FEE_TARGET = 10000;
export const DEFAULT_FEE_STRETCH = 30000;

/** Resolve fee bands with realistic wholesale defaults ($3k floor / $10k target
 *  / $30k stretch). Luxury profiles pass their own larger bands. Optional
 *  market_multiplier calibrates for state-level fee norms. */
export function feeEconomics(p: NegotiationProfileParams, marketMultiplier = 1): { floor: number; target: number; stretch: number } {
  const m = Number.isFinite(marketMultiplier) && marketMultiplier > 0 ? marketMultiplier : 1;
  return {
    floor: Math.round((finitePositive(p.feeFloor) ? p.feeFloor : DEFAULT_FEE_FLOOR) * m),
    target: Math.round((finitePositive(p.feeTarget) ? p.feeTarget : Math.max(p.minFee, DEFAULT_FEE_TARGET)) * m),
    stretch: Math.round((finitePositive(p.feeStretch) ? p.feeStretch : Math.max(p.feeTargetMax, DEFAULT_FEE_STRETCH)) * m),
  };
}

export interface ValuationInputs {
  arv: number;
  sqft: number;
  conditionTier: ConditionTier;
  /** Keys into the profile's bigTicketAdders. */
  bigTicketFlags: string[];
  hasAvm: boolean;
  compsCount: number;
  /** Luxury/owner-entered repair total (overrides psf math when provided). */
  manualRepairs?: number;
}

export interface ValuationResult {
  suggestMin: number | null;
  suggestMax: number | null;
  confidence: Confidence;
  /** True when a number cannot/should not be produced (bad inputs, foundation). */
  escalate: boolean;
  /** Human-readable line items for the "How was this calculated?" UI expander. */
  formulaTrace: string[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const finitePositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

function psfForTier(tier: ConditionTier, p: NegotiationProfileParams): number {
  return tier === 'light' ? p.repairLightPsf : tier === 'heavy' ? p.repairHeavyPsf : p.repairModeratePsf;
}

export function computeValuation(
  inputs: ValuationInputs,
  profile: NegotiationProfileParams
): ValuationResult {
  const trace: string[] = [];

  // Hard reject: ARV must be a real positive number or there is nothing to compute.
  if (!finitePositive(inputs.arv)) {
    return { suggestMin: null, suggestMax: null, confidence: 'LOW', escalate: true, formulaTrace: ['ARV missing or invalid — escalate to a human for a manual comp.'] };
  }

  // Repairs: owner-entered total wins (luxury); otherwise sqft × tier psf.
  let repairs: number;
  if (finitePositive(inputs.manualRepairs)) {
    repairs = inputs.manualRepairs;
    trace.push(`Repairs (owner-entered): ${money(repairs)}`);
  } else {
    const psf = psfForTier(inputs.conditionTier, profile);
    const sqft = Number.isFinite(inputs.sqft) && inputs.sqft > 0 ? inputs.sqft : 0;
    repairs = sqft * psf;
    trace.push(`Repairs: ${sqft.toLocaleString()} sqft × $${psf}/sqft (${inputs.conditionTier}) = ${money(repairs)}`);
  }

  // Big-ticket adders. A 'foundation' (or any ESCALATE sentinel) flag forces a
  // human — we never put a number on structural risk.
  let escalate = false;
  for (const flag of inputs.bigTicketFlags) {
    const adder = profile.bigTicketAdders[flag];
    if (adder === 'ESCALATE') {
      escalate = true;
      trace.push(`Big-ticket: ${flag} → ESCALATE (no number — human review required)`);
    } else if (finitePositive(adder)) {
      repairs += adder;
      trace.push(`Big-ticket: ${flag} +${money(adder)}`);
    }
  }

  const buyerMax = inputs.arv * profile.arvMultiplier - repairs;
  trace.push(`Buyer max: ${money(inputs.arv)} × ${profile.arvMultiplier} − ${money(repairs)} = ${money(buyerMax)}`);

  const suggestMaxRaw = buyerMax - profile.minFee;
  trace.push(`Suggested max: ${money(buyerMax)} − ${money(profile.minFee)} min fee = ${money(suggestMaxRaw)}`);

  // Confidence: f(has_avm, comps_count, requires_manual_comps, sqft_present).
  // A missing sqft (with no owner-entered repairs) makes the repair estimate
  // unreliable, so it caps confidence at MED regardless of AVM/comps.
  const sqftPresent = (Number.isFinite(inputs.sqft) && inputs.sqft > 0) || finitePositive(inputs.manualRepairs);
  let confidence: Confidence;
  if (profile.requiresManualComps) {
    confidence = 'LOW';
    trace.push('Confidence: LOW (profile requires manual comps — owner must confirm comps).');
  } else if (inputs.hasAvm && inputs.compsCount >= 3 && sqftPresent) {
    confidence = 'HIGH';
  } else if ((inputs.hasAvm || inputs.compsCount >= 3) && sqftPresent) {
    confidence = 'MED';
  } else if (inputs.hasAvm || inputs.compsCount >= 3) {
    // some comp signal but no sqft — cannot be HIGH, degrade to MED
    confidence = 'MED';
  } else {
    confidence = 'LOW';
  }

  // Guard: negative / non-finite suggested max → escalate, never a negative offer.
  if (escalate || !Number.isFinite(suggestMaxRaw) || suggestMaxRaw <= 0) {
    return {
      suggestMin: null,
      suggestMax: null,
      confidence: escalate ? 'LOW' : confidence,
      escalate: true,
      formulaTrace: [...trace, escalate ? 'One or more inputs require human review — no numeric suggestion produced.' : 'Repairs exceed the buyer max — this deal does not pencil; escalate.'],
    };
  }

  const suggestMax = Math.round(suggestMaxRaw);
  const suggestMin = Math.round(suggestMax * profile.openerPctOfMax);
  trace.push(`Suggested min (opener): ${money(suggestMax)} × ${profile.openerPctOfMax} = ${money(suggestMin)}`);
  trace.push('These are SUGGESTIONS — you approve every range. The AI never sends a number.');

  return { suggestMin, suggestMax, confidence, escalate: false, formulaTrace: trace };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase V — two-sided deal economics + the 7-14-day assignability guarantee.
// Seller range and buyer range are ONE system: the ranges are constructed so a
// deal signed at seller_suggest can always be assigned to a cash buyer while
// still clearing the fee floor within the inspection window.
// ─────────────────────────────────────────────────────────────────────────────

export interface DealEconInputs {
  arv: number;
  repairs: number; // resolved repair total (from computeValuation or owner-entered)
  /** Signed/target contract price (buyer-side math needs it; omit pre-contract). */
  contractPrice?: number;
  /** State-level fee calibration; default 1. */
  marketMultiplier?: number;
}

export interface DealEconomics {
  buyerMax: number;          // what cash buyers actually pay
  sellerMax: number;         // buyer_max − fee_floor (worst case you still clear the floor)
  sellerSuggest: number;     // buyer_max − fee_target (owner-facing suggested max)
  sellerOpener: number;      // seller_suggest × opener_pct
  buyerAskMin: number | null;   // contract + fee_floor (after contract)
  buyerAskOpen: number | null;  // min(contract + fee_stretch, buyer_max)
  fees: { floor: number; target: number; stretch: number };
  /** ASSIGNABLE ⇔ contract + fee_floor ≤ buyer_max. */
  assignable: boolean | null;
  /** True when the owner overrode above seller_max (projected fee < floor). */
  thinDeal: boolean;
  formulaTrace: string[];
  valid: boolean;
}

export function computeDealEconomics(inputs: DealEconInputs, profile: NegotiationProfileParams): DealEconomics {
  const fees = feeEconomics(profile, inputs.marketMultiplier ?? 1);
  const trace: string[] = [];

  if (!finitePositive(inputs.arv) || !(Number.isFinite(inputs.repairs) && inputs.repairs >= 0)) {
    return {
      buyerMax: 0, sellerMax: 0, sellerSuggest: 0, sellerOpener: 0,
      buyerAskMin: null, buyerAskOpen: null, fees, assignable: null, thinDeal: false,
      formulaTrace: ['ARV/repairs invalid — cannot compute economics; escalate.'], valid: false,
    };
  }

  const buyerMax = Math.round(inputs.arv * profile.arvMultiplier - inputs.repairs);
  const sellerMax = buyerMax - fees.floor;
  const sellerSuggest = buyerMax - fees.target;
  const sellerOpener = Math.round(sellerSuggest * profile.openerPctOfMax);
  trace.push(`Buyer max: ${money(inputs.arv)} × ${profile.arvMultiplier} − ${money(inputs.repairs)} = ${money(buyerMax)}`);
  trace.push(`Seller max (still clears floor): ${money(buyerMax)} − ${money(fees.floor)} floor = ${money(sellerMax)}`);
  trace.push(`Seller suggested max: ${money(buyerMax)} − ${money(fees.target)} target = ${money(sellerSuggest)}`);
  trace.push(`Seller opener: ${money(sellerSuggest)} × ${profile.openerPctOfMax} = ${money(sellerOpener)}`);

  let buyerAskMin: number | null = null;
  let buyerAskOpen: number | null = null;
  let assignable: boolean | null = null;
  let thinDeal = false;

  if (finitePositive(inputs.contractPrice)) {
    const cp = inputs.contractPrice;
    buyerAskMin = cp + fees.floor;
    buyerAskOpen = Math.min(cp + fees.stretch, buyerMax);
    // The 7-14-day guarantee: assignable ⇔ we can still net the floor selling to a cash buyer.
    assignable = cp + fees.floor <= buyerMax;
    thinDeal = cp > sellerMax; // owner override above seller_max ⇒ projected fee < floor
    trace.push(`Buyer ask (min): contract ${money(cp)} + ${money(fees.floor)} floor = ${money(buyerAskMin)}`);
    trace.push(`Buyer ask (open): min(contract + ${money(fees.stretch)} stretch, buyer max) = ${money(buyerAskOpen)}`);
    trace.push(`Assignable (contract + floor ≤ buyer max): ${assignable ? 'YES' : 'NO — disposition risk'}`);
    if (thinDeal) trace.push(`⚠ THIN DEAL: contract ${money(cp)} > seller max ${money(sellerMax)} — projected fee < ${money(fees.floor)} floor.`);
  }

  return {
    buyerMax, sellerMax, sellerSuggest, sellerOpener,
    buyerAskMin, buyerAskOpen, fees, assignable, thinDeal,
    formulaTrace: trace, valid: true,
  };
}
