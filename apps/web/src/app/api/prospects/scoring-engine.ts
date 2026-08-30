/**
 * Prospect Scoring Engine
 * Scores sellers and buyers for wholesaling pipeline.
 * All scores are 0-100. Higher = more qualified.
 */

// ── types ────────────────────────────────────────────────────────────────────

export interface SellerSignals {
  preForeclosure?: boolean;
  taxDelinquentYears?: number;
  probateOrInherited?: boolean;
  codeViolations?: boolean;
  absenteeOwner?: boolean;
  absenteeOwnerOutOfState?: boolean; // Additional boost for out-of-state absentee
  equityPercent?: number;
  vacantProperty?: boolean;
  ownershipYears?: number;
  tiredLandlord?: boolean;
  recentDivorce?: boolean;
  // Motivated seller indicators (new)
  urgentSale?: boolean;
  behindOnMortgage?: boolean;
  propertyDeteriorating?: boolean;
  multipleListings?: boolean;
  priceDrops?: number;
  // Time-based urgency indicators (revenue optimization)
  daysOnMarket?: number; // 60+ DOM = 2.9x higher motivation
  recentPriceDrop?: boolean; // Price drop in last 30 days
  priceDropInLast30Days?: boolean;
  // Lead source quality tracking (new)
  leadSource?: string;
  leadSourceQuality?: 'high' | 'medium' | 'low';
  // Enhanced equity calculation inputs (new)
  estimatedArv?: number;
  estimatedDebt?: number;
  estimatedRepairs?: number;
}

export interface BuyerSignals {
  cashPurchases?: boolean;
  purchasesLast12Months?: number;
  llcOrEntity?: boolean;
  verifiedProofOfFunds?: boolean;
  previousClosedDeal?: boolean;
  zipCodeMatch?: boolean;
  priceRangeMatch?: boolean;
  propertyTypeMatch?: boolean;
  avgResponseTimeHours?: number;
}

export type SellerTier = 'HOT' | 'WARM' | 'COOL' | 'COLD';
export type BuyerTier = 'VIP' | 'VERIFIED' | 'PROSPECT' | 'UNVERIFIED';

export interface SellerScore {
  score: number;
  tier: SellerTier;
  signals: string[];
  recommendedAction: string;
}

export interface BuyerScore {
  score: number;
  tier: BuyerTier;
  earnestMoney: { min: number; max: number };
  signals: string[];
  priority: string;
}

// ── scoring weights ──────────────────────────────────────────────────────────

const SELLER_WEIGHTS = {
  preForeclosure: 30,
  taxDelinquent: 25,
  probateOrInherited: 20,
  codeViolations: 15,
  absenteeOwner: 15,
  absenteeOwnerOutOfState: 5, // Additional boost for out-of-state absentee
  highEquity: 10,
  veryHighEquity: 5, // Additional boost for >70% equity
  vacantProperty: 10,
  longOwnership: 5,
  tiredLandlord: 10,
  recentDivorce: 10,
  // Motivated seller indicators
  urgentSale: 20,
  behindOnMortgage: 15,
  propertyDeteriorating: 10,
  multipleListings: 5,
  priceDrops: 10, // Per significant price drop
  // Time-based urgency (research: 60+ DOM = 2.9x higher motivation)
  daysOnMarket60Plus: 10, // 60+ days on market
  recentPriceDrop: 15, // Price drop in last 30 days (increased from 10)
  // Lead source quality bonuses
  highQualitySource: 10,
  mediumQualitySource: 5,
} as const;

// Lead source quality mappings
const LEAD_SOURCE_QUALITY: Record<string, 'high' | 'medium' | 'low'> = {
  // High quality sources (direct distress indicators)
  'pre_foreclosure_list': 'high',
  'tax_delinquent_list': 'high',
  'probate_filing': 'high',
  'code_violation': 'high',
  'eviction_filing': 'high',
  'divorce_filing': 'high',
  // Medium quality sources
  'absentee_owner_list': 'medium',
  'vacant_property_list': 'medium',
  'pva_records': 'medium',
  'driving_for_dollars': 'medium',
  'direct_mail_response': 'medium',
  // Low quality sources
  'cold_list': 'low',
  'purchased_list': 'low',
  'website_form': 'low',
  'unknown': 'low',
};

const BUYER_WEIGHTS = {
  cashPurchases: 30,
  multiplePurchases: 25,
  previousClosedDeal: 20,
  verifiedPOF: 20,
  llcOrEntity: 15,
  zipCodeMatch: 10,
  priceRangeMatch: 10,
  propertyTypeMatch: 5,
  fastResponse: 5,
} as const;

// ── tier thresholds ──────────────────────────────────────────────────────────

const SELLER_TIERS: { tier: SellerTier; min: number; action: string }[] = [
  { tier: 'HOT', min: 70, action: 'Immediate outreach, priority follow-up' },
  { tier: 'WARM', min: 50, action: 'Standard campaign cadence' },
  { tier: 'COOL', min: 30, action: 'Low-priority drip only' },
  { tier: 'COLD', min: 0, action: 'Do not contact' },
];

// [LOW FIX] Adjusted VIP tier earnest money range from $100-$500 to $500-$2,500
// Industry norm for VIP cash buyers is $500-$2,500 to adequately protect against tire-kickers
// Higher earnest deposits correlate with 30% lower fallthrough rate
const BUYER_TIERS: { tier: BuyerTier; min: number; earnest: { min: number; max: number }; priority: string }[] = [
  { tier: 'VIP', min: 80, earnest: { min: 500, max: 2500 }, priority: 'First look, 2hr exclusive' },
  { tier: 'VERIFIED', min: 60, earnest: { min: 1000, max: 2500 }, priority: 'Standard deal blasts' },
  { tier: 'PROSPECT', min: 40, earnest: { min: 2000, max: 4000 }, priority: 'Deals after 24hr if unsold' },
  { tier: 'UNVERIFIED', min: 0, earnest: { min: 3500, max: 5000 }, priority: 'Require POF first' },
];

// ── seller scoring ───────────────────────────────────────────────────────────

export function scoreSeller(signals: SellerSignals): SellerScore {
  let score = 0;
  const matched: string[] = [];

  if (signals.preForeclosure) {
    score += SELLER_WEIGHTS.preForeclosure;
    matched.push('Pre-foreclosure/NOD (+30)');
  }

  // Industry data: 1+ years tax delinquency indicates motivated sellers with 4% response vs 0.5% cold
  if (signals.taxDelinquentYears && signals.taxDelinquentYears >= 1) {
    score += SELLER_WEIGHTS.taxDelinquent;
    matched.push(`Tax delinquent ${signals.taxDelinquentYears}+ years (+25)`);
  }

  if (signals.probateOrInherited) {
    score += SELLER_WEIGHTS.probateOrInherited;
    matched.push('Probate/Inherited property (+20)');
  }

  if (signals.codeViolations) {
    score += SELLER_WEIGHTS.codeViolations;
    matched.push('Code violations (+15)');
  }

  if (signals.absenteeOwner) {
    score += SELLER_WEIGHTS.absenteeOwner;
    matched.push('Absentee owner (+15)');

    // Additional boost for out-of-state absentee owners (research: higher motivation)
    if (signals.absenteeOwnerOutOfState) {
      score += SELLER_WEIGHTS.absenteeOwnerOutOfState;
      matched.push('Out-of-state absentee owner (+5)');
    }
  }

  // Calculate equity from ARV and debt if available (more accurate than equityPercent alone)
  const calculatedEquityPercent = calculateEquityPercent(signals);
  const effectiveEquityPercent = calculatedEquityPercent ?? signals.equityPercent;

  if (effectiveEquityPercent !== undefined && effectiveEquityPercent > 50) {
    score += SELLER_WEIGHTS.highEquity;
    matched.push(`High equity ${Math.round(effectiveEquityPercent)}% (+10)`);

    // Additional boost for very high equity (>70%)
    if (effectiveEquityPercent > 70) {
      score += SELLER_WEIGHTS.veryHighEquity;
      matched.push(`Very high equity ${Math.round(effectiveEquityPercent)}% (+5)`);
    }
  }

  if (signals.vacantProperty) {
    score += SELLER_WEIGHTS.vacantProperty;
    matched.push('Vacant property (+10)');
  }

  if (signals.ownershipYears !== undefined && signals.ownershipYears >= 10) {
    score += SELLER_WEIGHTS.longOwnership;
    matched.push(`Long ownership ${signals.ownershipYears} years (+5)`);
  }

  if (signals.tiredLandlord) {
    score += SELLER_WEIGHTS.tiredLandlord;
    matched.push('Tired landlord signals (+10)');
  }

  if (signals.recentDivorce) {
    score += SELLER_WEIGHTS.recentDivorce;
    matched.push('Recent divorce filing (+10)');
  }

  // === Motivated seller indicators ===
  if (signals.urgentSale) {
    score += SELLER_WEIGHTS.urgentSale;
    matched.push('Urgent sale indicated (+20)');
  }

  if (signals.behindOnMortgage) {
    score += SELLER_WEIGHTS.behindOnMortgage;
    matched.push('Behind on mortgage (+15)');
  }

  if (signals.propertyDeteriorating) {
    score += SELLER_WEIGHTS.propertyDeteriorating;
    matched.push('Property deteriorating (+10)');
  }

  if (signals.multipleListings) {
    score += SELLER_WEIGHTS.multipleListings;
    matched.push('Multiple listings (+5)');
  }

  if (signals.priceDrops !== undefined && signals.priceDrops > 0) {
    // Cap at 3 price drops for scoring purposes
    const drops = Math.min(signals.priceDrops, 3);
    const dropBonus = drops * SELLER_WEIGHTS.priceDrops;
    score += dropBonus;
    matched.push(`${signals.priceDrops} price drop(s) (+${dropBonus})`);
  }

  // === Time-based urgency scoring (research: 60+ DOM = 2.9x higher motivation) ===
  if (signals.daysOnMarket !== undefined && signals.daysOnMarket >= 60) {
    score += SELLER_WEIGHTS.daysOnMarket60Plus;
    matched.push(`${signals.daysOnMarket} days on market (60+ DOM = 2.9x motivation) (+10)`);
  }

  // Price drop in last 30 days is a strong urgency signal
  if (signals.recentPriceDrop || signals.priceDropInLast30Days) {
    score += SELLER_WEIGHTS.recentPriceDrop;
    matched.push('Recent price drop (last 30 days) (+15)');
  }

  // === Lead source quality scoring ===
  const sourceQuality = signals.leadSourceQuality ??
    (signals.leadSource ? getLeadSourceQuality(signals.leadSource) : undefined);

  if (sourceQuality === 'high') {
    score += SELLER_WEIGHTS.highQualitySource;
    matched.push(`High-quality source${signals.leadSource ? ` (${signals.leadSource})` : ''} (+10)`);
  } else if (sourceQuality === 'medium') {
    score += SELLER_WEIGHTS.mediumQualitySource;
    matched.push(`Medium-quality source${signals.leadSource ? ` (${signals.leadSource})` : ''} (+5)`);
  }

  // Cap at 100
  score = Math.min(100, score);

  // Determine tier
  const tierInfo = SELLER_TIERS.find(t => score >= t.min) || SELLER_TIERS[SELLER_TIERS.length - 1];

  return {
    score,
    tier: tierInfo.tier,
    signals: matched,
    recommendedAction: tierInfo.action,
  };
}

// ── equity calculation helper ────────────────────────────────────────────────

/**
 * Calculate equity percent from ARV, debt, and repairs if available.
 * Uses formula: equity = (ARV - debt - repairs) / ARV * 100
 * This is more accurate than a simple equityPercent when full data is available.
 */
export function calculateEquityPercent(signals: SellerSignals): number | undefined {
  const { estimatedArv, estimatedDebt, estimatedRepairs } = signals;

  if (estimatedArv === undefined || estimatedArv <= 0) {
    return undefined;
  }

  const debt = estimatedDebt ?? 0;
  const repairs = estimatedRepairs ?? 0;

  const netEquity = estimatedArv - debt - repairs;
  const equityPercent = (netEquity / estimatedArv) * 100;

  // Return bounded between 0 and 100
  return Math.max(0, Math.min(100, equityPercent));
}

// ── lead source quality helper ───────────────────────────────────────────────

/**
 * Get the quality rating for a lead source.
 * High-quality sources have direct distress indicators.
 * Medium-quality sources have indirect motivation signals.
 * Low-quality sources are general lists without distress context.
 */
export function getLeadSourceQuality(source: string): 'high' | 'medium' | 'low' {
  const normalizedSource = source.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  return LEAD_SOURCE_QUALITY[normalizedSource] ?? 'low';
}

// ── buyer scoring ────────────────────────────────────────────────────────────

export function scoreBuyer(signals: BuyerSignals): BuyerScore {
  let score = 0;
  const matched: string[] = [];

  if (signals.cashPurchases) {
    score += BUYER_WEIGHTS.cashPurchases;
    matched.push('Cash purchases (+30)');
  }

  if (signals.purchasesLast12Months !== undefined && signals.purchasesLast12Months >= 2) {
    score += BUYER_WEIGHTS.multiplePurchases;
    matched.push(`${signals.purchasesLast12Months} purchases in 12mo (+25)`);
  }

  if (signals.previousClosedDeal) {
    score += BUYER_WEIGHTS.previousClosedDeal;
    matched.push('Previous closed deal with us (+20)');
  }

  if (signals.verifiedProofOfFunds) {
    score += BUYER_WEIGHTS.verifiedPOF;
    matched.push('Verified proof of funds (+20)');
  }

  if (signals.llcOrEntity) {
    score += BUYER_WEIGHTS.llcOrEntity;
    matched.push('LLC/Entity buyer (+15)');
  }

  if (signals.zipCodeMatch) {
    score += BUYER_WEIGHTS.zipCodeMatch;
    matched.push('Zip code match (+10)');
  }

  if (signals.priceRangeMatch) {
    score += BUYER_WEIGHTS.priceRangeMatch;
    matched.push('Price range match (+10)');
  }

  if (signals.propertyTypeMatch) {
    score += BUYER_WEIGHTS.propertyTypeMatch;
    matched.push('Property type match (+5)');
  }

  if (signals.avgResponseTimeHours !== undefined && signals.avgResponseTimeHours < 1) {
    score += BUYER_WEIGHTS.fastResponse;
    matched.push('Fast response time <1hr (+5)');
  }

  // Cap at 100
  score = Math.min(100, score);

  // Determine tier
  const tierInfo = BUYER_TIERS.find(t => score >= t.min) || BUYER_TIERS[BUYER_TIERS.length - 1];

  return {
    score,
    tier: tierInfo.tier,
    earnestMoney: tierInfo.earnest,
    signals: matched,
    priority: tierInfo.priority,
  };
}

// ── earnest money calculator ─────────────────────────────────────────────────

export function calculateEarnestMoney(tier: BuyerTier): { min: number; max: number } {
  const tierInfo = BUYER_TIERS.find(t => t.tier === tier);
  if (!tierInfo) {
    return { min: 3000, max: 5000 }; // Default to UNVERIFIED
  }
  return tierInfo.earnest;
}

/**
 * Calculate specific earnest money amount within tier range based on deal size and market velocity.
 * Higher deal value = higher earnest within tier range.
 *
 * [REVENUE OPTIMIZATION] Scale earnest money with deal size and market velocity:
 * - earnestBase = tierRange.default (midpoint)
 * - marketMultiplier = (deal.arv > 500000) ? 2.0 : (deal.arv > 300000) ? 1.5 : 1.0
 * - velocityBonus = (dom < 30) ? 1.25 : 1.0
 * - finalEarnest = earnestBase * marketMultiplier * velocityBonus
 *
 * Industry standard: Larger earnest correlates with 30% lower fallthrough rate.
 * $500K+ deals should require $2,500-$10,000 earnest to match risk.
 *
 * @param tier - Buyer tier (VIP, VERIFIED, PROSPECT, UNVERIFIED)
 * @param dealValue - Deal value in dollars (purchase price or ARV)
 * @param daysOnMarket - Optional days on market for velocity adjustment
 */
export function calculateEarnestAmount(
  tier: BuyerTier,
  dealValue: number,
  daysOnMarket?: number
): number {
  const range = calculateEarnestMoney(tier);

  // Calculate base earnest (midpoint of tier range)
  const earnestBase = Math.round((range.min + range.max) / 2);

  // Market multiplier based on deal size (ARV/purchase price)
  // Higher value deals need higher earnest to reduce fallthrough risk
  let marketMultiplier = 1.0;
  if (dealValue >= 500000) {
    marketMultiplier = 2.0; // $500K+ deals
  } else if (dealValue >= 300000) {
    marketMultiplier = 1.5; // $300K-$500K deals
  } else if (dealValue >= 150000) {
    marketMultiplier = 1.25; // $150K-$300K deals
  }

  // Velocity bonus: hot markets (low DOM) justify higher earnest
  let velocityMultiplier = 1.0;
  if (daysOnMarket !== undefined) {
    if (daysOnMarket < 30) {
      velocityMultiplier = 1.25; // Very hot market
    } else if (daysOnMarket < 45) {
      velocityMultiplier = 1.1; // Active market
    }
  }

  // Calculate final earnest with multipliers
  const calculatedEarnest = Math.round(earnestBase * marketMultiplier * velocityMultiplier);

  // Clamp to tier range (allow overflow up to 2x max for high-value deals)
  const maxAllowed = dealValue >= 500000 ? range.max * 2 : range.max;
  return Math.max(range.min, Math.min(maxAllowed, calculatedEarnest));
}

// ── tier utilities ───────────────────────────────────────────────────────────

export function getSellerTierInfo(tier: SellerTier) {
  return SELLER_TIERS.find(t => t.tier === tier);
}

export function getBuyerTierInfo(tier: BuyerTier) {
  return BUYER_TIERS.find(t => t.tier === tier);
}

export function isContactable(sellerTier: SellerTier): boolean {
  return sellerTier !== 'COLD';
}

export function requiresPOF(buyerTier: BuyerTier): boolean {
  return buyerTier === 'UNVERIFIED';
}
