/**
 * capacityPlanner — Phase 1: Plan A/B + 10–30/mo gap model.
 *
 * "What does my next $X buy, and how far from 10–30/mo am I?"
 *
 * All conversion inputs are labeled BENCHMARK (unverified for this account)
 * until real data exists, then MEASURED (n=…). The 10–30/mo target is reported
 * as a gap-to-close, never asserted as delivered.
 *
 * Plan A: breadth — N contacts × 2 SMS touches
 * Plan B: depth  — N/4 contacts × 10 mixed touches (email+SMS+call)
 *
 * Gap model: given current jurisdiction count, channel mix, JV relationships,
 * and buyer coverage, compute expected fees/month and the honest gap.
 */

export interface CostRates {
  traceAndScrubCents: number;   // per new contact (skip-trace + DNC scrub)
  smsTouchCents: number;        // per SMS touch to already-traced contact
  emailTouchCents: number;      // per email touch (free-tier)
  callTouchCents: number;       // per manual call touch ($0 cash, owner time)
  directMailCents: number;      // per mail piece
}

export const DEFAULT_RATES: CostRates = {
  traceAndScrubCents: 13,   // $0.09–0.17 midpoint
  smsTouchCents: 1,         // ~$0.011
  emailTouchCents: 0,       // free-tier
  callTouchCents: 0,        // $0 cash
  directMailCents: 55,      // $0.50–1.00 midpoint
};

export interface PlanInputs {
  budgetCents: number;
  rates: CostRates;
  /** Conversion rate: fraction of contacts that become a contract. BENCHMARK until measured. */
  conversionRate: number;
  /** Number of active jurisdictions in the Lead Finder registry. */
  jurisdictionCount: number;
  /** Number of active JV relationships. */
  jvRelationshipCount: number;
  /** Buyer coverage score 0–1 (fraction of target zips with ≥1 verified buyer). */
  buyerCoverageScore: number;
}

export interface TouchPlan {
  label: string;
  contactCount: number;
  touchesPerContact: number;
  channelMix: { sms: number; email: number; call: number };
  totalCostCents: number;
  totalTouches: number;
  /** Poisson λ = contactCount × conversionRate */
  lambda: number;
  /** P(≥1 contract) via Poisson */
  pAtLeastOne: number;
  /** P(≥2 contracts) */
  pAtLeastTwo: number;
  /** P(≥3 contracts) */
  pAtLeastThree: number;
  costPerExpectedContract: number;
  dataLabel: 'BENCHMARK (unverified for this account)' | string;
}

export interface GapModel {
  expectedFeesPerMonth: number;
  targetMin: number;
  targetMax: number;
  gapToTarget: number;
  /** Ranked levers to close the gap */
  rankedLevers: Array<{
    lever: 'more_markets' | 'more_depth' | 'more_jv' | 'more_buyers';
    description: string;
    estimatedImpact: number;
    priority: number;
  }>;
  dataLabel: string;
}

export interface CapacityPlan {
  planA: TouchPlan;
  planB: TouchPlan;
  gapModel: GapModel;
  /** N contacts needed for 80% confidence of ≥1 contract */
  nFor80pct: number;
  /** N contacts needed for 95% confidence of ≥1 contract */
  nFor95pct: number;
}

/** Poisson CDF: P(X >= k) = 1 - P(X < k) */
function poissonAtLeast(lambda: number, k: number): number {
  if (lambda <= 0) return 0;
  // P(X < k) = sum_{i=0}^{k-1} e^{-λ} * λ^i / i!
  let cumulative = 0;
  let term = Math.exp(-lambda);
  for (let i = 0; i < k; i++) {
    cumulative += term;
    term *= lambda / (i + 1);
  }
  return Math.max(0, Math.min(1, 1 - cumulative));
}

/** N contacts needed so P(≥1 contract) >= targetProb */
function nForProbability(conversionRate: number, targetProb: number): number {
  if (conversionRate <= 0) return Infinity;
  // P(≥1) = 1 - e^{-λ} >= p  =>  λ >= -ln(1-p)  =>  N >= -ln(1-p)/rate
  return Math.ceil(-Math.log(1 - targetProb) / conversionRate);
}

function buildPlan(
  label: string,
  contactCount: number,
  touchesPerContact: number,
  channelMix: { sms: number; email: number; call: number },
  rates: CostRates,
  conversionRate: number
): TouchPlan {
  const smsCost = channelMix.sms * rates.smsTouchCents;
  const emailCost = channelMix.email * rates.emailTouchCents;
  const callCost = channelMix.call * rates.callTouchCents;
  const touchCostPerContact = smsCost + emailCost + callCost;
  const totalCostCents = contactCount * (rates.traceAndScrubCents + touchCostPerContact);
  const totalTouches = contactCount * touchesPerContact;
  const lambda = contactCount * conversionRate;
  const pAtLeastOne = poissonAtLeast(lambda, 1);
  const pAtLeastTwo = poissonAtLeast(lambda, 2);
  const pAtLeastThree = poissonAtLeast(lambda, 3);
  const costPerExpectedContract = lambda > 0 ? totalCostCents / lambda : Infinity;

  return {
    label,
    contactCount,
    touchesPerContact,
    channelMix,
    totalCostCents,
    totalTouches,
    lambda,
    pAtLeastOne,
    pAtLeastTwo,
    pAtLeastThree,
    costPerExpectedContract,
    dataLabel: 'BENCHMARK (unverified for this account)',
  };
}

export function computeCapacityPlan(inputs: PlanInputs): CapacityPlan {
  const { budgetCents, rates, conversionRate, jurisdictionCount, jvRelationshipCount, buyerCoverageScore } = inputs;

  // Plan A: breadth — spend all budget on new contacts, 2 SMS touches each
  const planAContactCost = rates.traceAndScrubCents + 2 * rates.smsTouchCents;
  const planAContacts = Math.floor(budgetCents / planAContactCost);
  const planA = buildPlan(
    'Plan A — Breadth (N contacts × 2 SMS)',
    planAContacts,
    2,
    { sms: 2, email: 0, call: 0 },
    rates,
    conversionRate
  );

  // Plan B: depth — N/4 contacts, 10 mixed touches (3 SMS + 5 email + 2 call)
  const planBTouchCost = 3 * rates.smsTouchCents + 5 * rates.emailTouchCents + 2 * rates.callTouchCents;
  const planBContactCost = rates.traceAndScrubCents + planBTouchCost;
  const planBContacts = Math.floor(budgetCents / planBContactCost / 4) * 4; // round to multiple of 4
  const planB = buildPlan(
    'Plan B — Depth (N/4 contacts × 10 mixed touches)',
    Math.max(1, planBContacts),
    10,
    { sms: 3, email: 5, call: 2 },
    rates,
    conversionRate * 1.5 // depth multiplier: more touches → higher effective conversion (BENCHMARK)
  );

  // Gap model: expected fees/month from all four levers
  // Base: jurisdictions × contacts/jurisdiction × conversion
  const contactsPerJurisdiction = 200; // BENCHMARK
  const baseExpected = jurisdictionCount * contactsPerJurisdiction * conversionRate;
  const jvBoost = jvRelationshipCount * 0.5; // BENCHMARK: each JV relationship adds ~0.5 fees/mo
  const buyerBoost = buyerCoverageScore * 2; // BENCHMARK: full buyer coverage adds ~2 fees/mo
  const expectedFeesPerMonth = baseExpected + jvBoost + buyerBoost;

  const targetMin = 10;
  const targetMax = 30;
  const gapToTarget = Math.max(0, targetMin - expectedFeesPerMonth);

  // Rank levers by impact-per-unit-effort
  const levers: GapModel['rankedLevers'] = [
    {
      lever: 'more_markets',
      description: `Add jurisdictions (currently ${jurisdictionCount}). Each new market adds ~${(contactsPerJurisdiction * conversionRate).toFixed(2)} fees/mo at current conversion.`,
      estimatedImpact: contactsPerJurisdiction * conversionRate,
      priority: 0,
    },
    {
      lever: 'more_depth',
      description: 'Increase touches per contact (Plan B vs Plan A). Depth multiplier ~1.5× conversion at same acquisition cost.',
      estimatedImpact: baseExpected * 0.5,
      priority: 0,
    },
    {
      lever: 'more_jv',
      description: `Add JV relationships (currently ${jvRelationshipCount}). Each adds ~0.5 fees/mo at $0 acquisition cost.`,
      estimatedImpact: 0.5,
      priority: 0,
    },
    {
      lever: 'more_buyers',
      description: `Improve buyer coverage (currently ${Math.round(buyerCoverageScore * 100)}%). Full coverage adds ~2 fees/mo and enables accepting more JV intakes.`,
      estimatedImpact: (1 - buyerCoverageScore) * 2,
      priority: 0,
    },
  ].sort((a, b) => b.estimatedImpact - a.estimatedImpact)
   .map((l, i) => ({ ...l, priority: i + 1 })) as GapModel['rankedLevers'];

  const gapModel: GapModel = {
    expectedFeesPerMonth,
    targetMin,
    targetMax,
    gapToTarget,
    rankedLevers: levers,
    dataLabel: 'BENCHMARK (unverified for this account) — inputs are industry estimates until real campaign data exists',
  };

  return {
    planA,
    planB,
    gapModel,
    nFor80pct: nForProbability(conversionRate, 0.80),
    nFor95pct: nForProbability(conversionRate, 0.95),
  };
}
