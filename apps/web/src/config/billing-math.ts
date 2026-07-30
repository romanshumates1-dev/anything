/**
 * billing-math — PURE money functions for the DealFlow AI monetization model.
 *
 * No DB, no network, no env reads at module scope: every function is a
 * deterministic transform of its arguments so it can be unit-tested exhaustively
 * (see billing-math.test.ts). All money is INTEGER CENTS. Segment counts are
 * integers. There is no floating-point money anywhere in the send/charge path.
 *
 * The two owner-stated invariants this module encodes and the tests prove:
 *
 *   (1) MARKUP: the subscription fee charges 2x–3x the true Twilio cost of the
 *       SMS it funds. `retailForTrueCost(cost, markup)` is that retail number.
 *
 *   (2) CAP-BEFORE-SPEND: a plan's included SMS allowance is DERIVED from the
 *       Twilio budget the fee funds, divided by the markup — so the realized
 *       Twilio cost at the cap can never exceed the funded budget, and in fact
 *       leaves a (markup-1)/markup margin. `includedSegmentsForBudget()` is that
 *       derivation; `realizedCostAtCap <= fundedBudget` is asserted in tests.
 */

/** Twilio all-in outbound A2P cost per SMS segment, in cents (Twilio msg fee +
 *  carrier pass-through). Overridable via env for price changes without a
 *  redeploy of the model. Read at CALL time by the config layer, not here. */
export const DEFAULT_TWILIO_COST_PER_SEGMENT_CENTS = 1.1;

/** Retail (customer-facing) cents for a given true cost at a markup multiple.
 *  markup 2 => charge double the true cost; markup 3 => triple. Rounds up to a
 *  whole cent so we never under-charge below the intended margin. */
export function retailForTrueCost(trueCostCents: number, markup: number): number {
  if (trueCostCents < 0) throw new Error('trueCostCents must be >= 0');
  if (markup <= 0) throw new Error('markup must be > 0');
  return Math.ceil(trueCostCents * markup);
}

/** True Twilio cost (cents) of sending `segments` segments. */
export function trueTwilioCostCents(segments: number, costPerSegmentCents: number): number {
  if (segments < 0) throw new Error('segments must be >= 0');
  if (costPerSegmentCents < 0) throw new Error('costPerSegmentCents must be >= 0');
  return segments * costPerSegmentCents;
}

/**
 * Included SMS allowance (whole segments) DERIVED from the Twilio budget the
 * subscription funds, so that realized cost at the cap stays at/under budget.
 *
 * We allow ourselves to actually spend at most `fundedBudget / markup` on
 * Twilio (1/markup of the budget). The included allowance is the whole number
 * of segments that fits in that spend ceiling. Because we FLOOR, realized cost
 * at the cap is always <= fundedBudget/markup <= fundedBudget. This is the
 * "cap them out before the Twilio cost" rule, made mechanical.
 */
export function includedSegmentsForBudget(
  fundedBudgetCents: number,
  markup: number,
  costPerSegmentCents: number
): number {
  if (fundedBudgetCents < 0) throw new Error('fundedBudgetCents must be >= 0');
  if (markup <= 0) throw new Error('markup must be > 0');
  if (costPerSegmentCents <= 0) throw new Error('costPerSegmentCents must be > 0');
  const spendCeilingCents = fundedBudgetCents / markup;
  return Math.floor(spendCeilingCents / costPerSegmentCents);
}

/** Margin (cents) retained after the marked-up allowance is fully consumed:
 *  fundedBudget minus the realized true cost at the cap. Always >= 0 given a
 *  cap produced by includedSegmentsForBudget. */
export function retainedMarginCents(
  fundedBudgetCents: number,
  includedSegments: number,
  costPerSegmentCents: number
): number {
  return fundedBudgetCents - trueTwilioCostCents(includedSegments, costPerSegmentCents);
}

/** Would consuming `requested` more of a metric push `current` past `cap`?
 *  cap === null means unlimited (enterprise). */
export function wouldExceedCap(current: number, requested: number, cap: number | null): boolean {
  if (cap === null) return false;
  return current + requested > cap;
}

/** Remaining allowance for a metric. null cap => Infinity (unlimited). */
export function remainingAllowance(current: number, cap: number | null): number {
  if (cap === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, cap - current);
}

// ── Profit split ────────────────────────────────────────────────────────────
// A revenue/profit split on deals closed through the platform. The COMPANY's
// share is governed by the "profit-split policy" referenced in the Terms — this
// is the arithmetic behind it. Splits are exact in integer cents: the company
// receives any rounding remainder (documented, deterministic).

export type ProfitSplitPolicyId = '25_75' | '50_50' | '90_10';

/** companyBps = company basis points (out of 10000). 25_75 => company keeps 25%. */
export const PROFIT_SPLIT_POLICIES: Record<
  ProfitSplitPolicyId,
  { label: string; companyBps: number }
> = {
  '25_75': { label: '25 / 75 — company 25%, partner 75%', companyBps: 2500 },
  '50_50': { label: '50 / 50 — even split', companyBps: 5000 },
  '90_10': { label: '90 / 10 — company 90%, partner 10%', companyBps: 9000 },
};

export interface ProfitSplitResult {
  grossCents: number;
  companyCents: number;
  partnerCents: number;
  policy: ProfitSplitPolicyId;
}

/** Split gross profit by policy. Exact: companyCents + partnerCents === grossCents
 *  always (company takes the remainder cent when the division isn't clean). */
export function profitSplit(grossCents: number, policy: ProfitSplitPolicyId): ProfitSplitResult {
  if (!Number.isInteger(grossCents) || grossCents < 0) {
    throw new Error('grossCents must be a non-negative integer');
  }
  const def = PROFIT_SPLIT_POLICIES[policy];
  if (!def) throw new Error(`unknown profit-split policy: ${policy}`);
  // Company gets floor(gross * bps / 10000) PLUS the remainder, so no cent is
  // ever created or lost and the identity company + partner === gross holds.
  const partnerCents = Math.floor((grossCents * (10000 - def.companyBps)) / 10000);
  const companyCents = grossCents - partnerCents;
  return { grossCents, companyCents, partnerCents, policy };
}
