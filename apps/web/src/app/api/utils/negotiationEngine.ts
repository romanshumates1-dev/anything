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
 */

export type NegotiationSide = 'seller' | 'buyer';

export const DEFAULT_CONCESSION_CURVE = [0.4, 0.25, 0.15, 0.1] as const;

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

/** $5,000 assignment fee floor in cents — HARD MINIMUM, system walks away before going below. */
export const FEE_FLOOR_CENTS = 500_000;

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
