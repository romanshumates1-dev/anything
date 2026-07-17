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
