/**
 * planner — "how many leads do I need to close N deals?"
 *
 * Pure functions, no DB, no I/O: the route layer supplies inventory and this
 * module supplies arithmetic. That split exists so the funnel math is unit
 * testable to the decimal without a Postgres branch.
 *
 * WHY A DECOMPOSED FUNNEL RATHER THAN ONE "1-in-N" NUMBER
 *
 * A single close rate is unfalsifiable and unimprovable — when it moves you
 * cannot say which stage moved. Worse, at pre-revenue volumes it is not even
 * measurable: detecting a 1-in-2,000 -> 1-in-1,500 improvement at 80% power
 * needs ~328,000 sends PER ARM. Reply rate (2% -> 3%) needs ~3,825 per arm.
 * So the stages exist to be optimised individually against metrics that are
 * actually reachable at this budget, while the product of them gives the
 * volume estimate.
 *
 * NOTE ON THE DEFAULTS: they are planning assumptions, not measurements. Each
 * is individually defensible for cold SMS real-estate prospecting, and their
 * product implies ~5,750 seller contacts per closed deal — consistent with the
 * ~6,000 working figure. They are deliberately NOT tuned to hit a round number:
 * reverse-engineering stage rates to produce a predetermined total is how a
 * model becomes decorative. Override them, or switch to observed mode once
 * there is enough real funnel data.
 */

export type SellerFunnel = {
  /** Fraction of sends that reach a handset (carrier filtering, bad numbers). */
  deliverability: number;
  /** Fraction of delivered messages that get any reply. */
  replyRate: number;
  /** Fraction of replies that are not an immediate hard no. */
  engagedRate: number;
  /** Fraction of engaged conversations that reach a real offer discussion. */
  offerRate: number;
  /** Fraction of offer discussions that go under contract. */
  contractRate: number;
  /** Fraction of contracts that actually assign/close. */
  closeRate: number;
};

export type BuyerFunnel = {
  /** Fraction of buyer contacts who reply. */
  replyRate: number;
  /** Fraction of replies expressing interest in the deal profile. */
  interestRate: number;
  /** Fraction of interested buyers who take an assignment. */
  takeRate: number;
};

/**
 * Planning defaults. See the module note — assumptions, not measurements.
 *
 * Industry benchmarks for cold SMS real-estate prospecting:
 *   - Cold lists: 0.5% reply rate
 *   - Warm (absentee): 1.5% reply rate
 *   - Motivated (multiple signals): 2.5% reply rate
 *   - Distressed (probate/foreclosure): 4% reply rate
 *
 * Using 2% as the default assumes mixed lead quality. The original 5% was
 * optimistic and inflated deal projections. Conservative planning avoids
 * under-sized campaigns that waste cycles.
 */
export const DEFAULT_SELLER_FUNNEL: SellerFunnel = {
  deliverability: 0.9,
  replyRate: 0.02, // Conservative 2% for mixed lead quality (was 5%)
  engagedRate: 0.32,
  offerRate: 0.28,
  contractRate: 0.12,
  closeRate: 0.2,
};

/**
 * Segment-specific funnel rates for more accurate campaign sizing.
 * Use these with sizeCampaign() for segment-aware planning.
 */
export const SEGMENT_FUNNEL_RATES: Record<string, Partial<SellerFunnel>> = {
  // Distressed leads: probate, pre-foreclosure, tax delinquent
  distressed: { replyRate: 0.04 }, // 4% - highest motivation
  // Motivated leads: multiple signals, code violations
  motivated: { replyRate: 0.025 }, // 2.5%
  // Warm leads: absentee owners, long ownership
  warm: { replyRate: 0.015 }, // 1.5%
  // Cold leads: generic lists, no distress signals
  cold: { replyRate: 0.005 }, // 0.5%
};

/**
 * Get segment-appropriate funnel rates based on lead signals.
 * Use with sizeCampaign({ seller: getSegmentFunnel(signals) })
 */
export function getSegmentFunnel(signals: string[]): Partial<SellerFunnel> {
  const signalSet = new Set(signals.map(s => s.toLowerCase()));

  // Distressed: probate, foreclosure, or severe tax delinquency
  if (signalSet.has('probate') || signalSet.has('pre_foreclosure') ||
      signalSet.has('foreclosure') || signalSet.has('tax_delinquent')) {
    return SEGMENT_FUNNEL_RATES.distressed;
  }

  // Motivated: multiple signals or code violations
  if (signals.length >= 2 || signalSet.has('code_violation') || signalSet.has('vacant_or_code')) {
    return SEGMENT_FUNNEL_RATES.motivated;
  }

  // Warm: absentee or long ownership
  if (signalSet.has('absentee') || signalSet.has('absentee_owner')) {
    return SEGMENT_FUNNEL_RATES.warm;
  }

  // Default to cold
  return SEGMENT_FUNNEL_RATES.cold;
}

export const DEFAULT_BUYER_FUNNEL: BuyerFunnel = {
  replyRate: 0.25,
  interestRate: 0.2,
  takeRate: 0.1,
};

/**
 * Below this many observed closed deals, observed rates are statistically
 * meaningless and the planner refuses to use them. Two closes do not establish
 * a conversion rate; pretending otherwise produces a confident wrong number,
 * which is worse than an honest default.
 */
export const MIN_OBSERVED_DEALS = 30;

export type FunnelStage = { stage: string; rate: number; remaining: number };

export type SizingResult = {
  targetDeals: number;
  sellersNeeded: number;
  buyersNeeded: number;
  /** Product of every seller stage — the implied end-to-end conversion. */
  sellerConversion: number;
  buyerConversion: number;
  /** Contacts per single deal, the headline "1 in N". */
  sellersPerDeal: number;
  buyersPerDeal: number;
  /** Stage-by-stage walk-down, so the total is inspectable rather than magic. */
  sellerStages: FunnelStage[];
  buyerStages: FunnelStage[];
  /** Multi-touch adjusted metrics (accounts for 85% cumulative lift from 3-touch sequences) */
  multiTouchAdjusted?: {
    sellersNeeded: number;
    effectiveReplyRate: number;
    touchSequence: string;
  };
};

/**
 * Multi-touch campaign lift constants.
 * Industry data: 3-touch sequences yield +85% cumulative response over single touch.
 * Recommended cadence: Day 1, 3, 7, 14 (proven 2.1x lift)
 */
export const MULTI_TOUCH_LIFT = {
  touch1: 1.0, // Baseline
  touch2: 1.4, // +40% cumulative
  touch3: 1.85, // +85% cumulative (capped)
  recommendedCadence: [1, 3, 7, 14], // Days
} as const;

function product(values: number[]): number {
  return values.reduce((a, b) => a * b, 1);
}

/** Every rate must be a real number in (0, 1]; a zero makes the funnel infinite. */
function assertRates(obj: Record<string, number>, label: string): void {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1) {
      throw new Error(`${label}.${k} must be a finite rate in (0, 1], got ${v}`);
    }
  }
}

/**
 * Size a campaign from a deal target.
 *
 * Rounds UP at the end only. Rounding each stage would compound error upward
 * and silently inflate the ask by hundreds of contacts.
 */
export function sizeCampaign(opts: {
  targetDeals: number;
  seller?: Partial<SellerFunnel>;
  buyer?: Partial<BuyerFunnel>;
  /** Apply multi-touch lift adjustment (recommended for accurate sizing) */
  multiTouch?: boolean | number; // true = 3 touches, or specify touch count (2-3)
}): SizingResult {
  const targetDeals = opts.targetDeals;
  if (!Number.isFinite(targetDeals) || targetDeals <= 0) {
    throw new Error(`targetDeals must be a positive number, got ${targetDeals}`);
  }

  const seller: SellerFunnel = { ...DEFAULT_SELLER_FUNNEL, ...opts.seller };
  const buyer: BuyerFunnel = { ...DEFAULT_BUYER_FUNNEL, ...opts.buyer };
  assertRates(seller as unknown as Record<string, number>, 'seller');
  assertRates(buyer as unknown as Record<string, number>, 'buyer');

  const sellerOrder: [string, number][] = [
    ['delivered', seller.deliverability],
    ['replied', seller.replyRate],
    ['engaged', seller.engagedRate],
    ['offer_discussed', seller.offerRate],
    ['under_contract', seller.contractRate],
    ['closed', seller.closeRate],
  ];
  const buyerOrder: [string, number][] = [
    ['replied', buyer.replyRate],
    ['interested', buyer.interestRate],
    ['took_assignment', buyer.takeRate],
  ];

  const sellerConversion = product(sellerOrder.map(([, r]) => r));
  const buyerConversion = product(buyerOrder.map(([, r]) => r));

  const sellersNeeded = Math.ceil(targetDeals / sellerConversion);
  const buyersNeeded = Math.ceil(targetDeals / buyerConversion);

  // Walk the real starting volume down so the numbers shown are the numbers
  // used — not a separate illustrative example.
  let remaining = sellersNeeded;
  const sellerStages: FunnelStage[] = sellerOrder.map(([stage, rate]) => {
    remaining = remaining * rate;
    return { stage, rate, remaining: Math.round(remaining * 100) / 100 };
  });

  let bRemaining = buyersNeeded;
  const buyerStages: FunnelStage[] = buyerOrder.map(([stage, rate]) => {
    bRemaining = bRemaining * rate;
    return { stage, rate, remaining: Math.round(bRemaining * 100) / 100 };
  });

  // Calculate multi-touch adjusted metrics if requested
  let multiTouchAdjusted: SizingResult['multiTouchAdjusted'] = undefined;
  if (opts.multiTouch) {
    const touchCount = typeof opts.multiTouch === 'number'
      ? Math.min(3, Math.max(1, opts.multiTouch))
      : 3;

    const lift = touchCount >= 3 ? MULTI_TOUCH_LIFT.touch3
      : touchCount === 2 ? MULTI_TOUCH_LIFT.touch2
      : MULTI_TOUCH_LIFT.touch1;

    const effectiveReplyRate = seller.replyRate * lift;
    const adjustedSeller = { ...seller, replyRate: effectiveReplyRate };
    const adjustedConversion = product([
      adjustedSeller.deliverability,
      adjustedSeller.replyRate,
      adjustedSeller.engagedRate,
      adjustedSeller.offerRate,
      adjustedSeller.contractRate,
      adjustedSeller.closeRate,
    ]);

    multiTouchAdjusted = {
      sellersNeeded: Math.ceil(targetDeals / adjustedConversion),
      effectiveReplyRate,
      touchSequence: `${touchCount}-touch (Day ${MULTI_TOUCH_LIFT.recommendedCadence.slice(0, touchCount).join(', ')})`,
    };
  }

  return {
    targetDeals,
    sellersNeeded,
    buyersNeeded,
    sellerConversion,
    buyerConversion,
    sellersPerDeal: Math.ceil(1 / sellerConversion),
    buyersPerDeal: Math.ceil(1 / buyerConversion),
    sellerStages,
    buyerStages,
    multiTouchAdjusted,
  };
}

export type InventoryCheck = {
  requested: number;
  available: number;
  shortfall: number;
  feasible: boolean;
};

/** Compare a sizing requirement against what is actually in inventory. */
export function checkInventory(requested: number, available: number): InventoryCheck {
  const shortfall = Math.max(0, requested - available);
  return { requested, available, shortfall, feasible: shortfall === 0 };
}

/**
 * Derive stage rates from real funnel counts, but ONLY when the sample can
 * support it. Returns null (caller falls back to defaults) when it cannot —
 * an explicit "not enough data" beats a confident wrong number.
 */
export function observedSellerFunnel(counts: {
  sent: number;
  delivered: number;
  replied: number;
  engaged: number;
  offerDiscussed: number;
  underContract: number;
  closed: number;
}): { funnel: SellerFunnel; usable: boolean; reason?: string } {
  const { sent, delivered, replied, engaged, offerDiscussed, underContract, closed } = counts;

  if (closed < MIN_OBSERVED_DEALS) {
    return {
      funnel: DEFAULT_SELLER_FUNNEL,
      usable: false,
      reason: `only ${closed} observed closes; need >= ${MIN_OBSERVED_DEALS} before observed rates beat planning defaults`,
    };
  }

  // A zero at any stage would make the funnel infinite. If the sample is large
  // enough to trust yet contains a zero stage, that is a data problem, not a
  // rate — say so rather than emitting Infinity.
  const safe = (num: number, den: number, stage: string): number | string =>
    den <= 0 || num <= 0 ? `stage ${stage} has no volume (${num}/${den})` : num / den;

  const parts = [
    safe(delivered, sent, 'delivered'),
    safe(replied, delivered, 'replied'),
    safe(engaged, replied, 'engaged'),
    safe(offerDiscussed, engaged, 'offer_discussed'),
    safe(underContract, offerDiscussed, 'under_contract'),
    safe(closed, underContract, 'closed'),
  ];
  const bad = parts.find((p) => typeof p === 'string');
  if (bad) return { funnel: DEFAULT_SELLER_FUNNEL, usable: false, reason: String(bad) };

  const [deliverability, replyRate, engagedRate, offerRate, contractRate, closeRate] =
    parts as number[];
  return {
    funnel: { deliverability, replyRate, engagedRate, offerRate, contractRate, closeRate },
    usable: true,
  };
}
