/**
 * Regional Min-Max Wholesaling Fee Engine
 *
 * Computes realistic assignment fee ranges based on regional property values
 * and inflation. The $5,000 floor is NON-NEGOTIABLE (FEE_FLOOR_CENTS), but
 * regional markets warrant different fee ceilings and targets.
 *
 * Regional factors:
 *   - Median home price (2024-2026 data with inflation adjustment)
 *   - Market velocity (days on market → affects urgency premium)
 *   - Investor activity (investor % → higher competition = lower fees)
 *   - Distress rate (foreclosure + pre-foreclosure → opportunity premium)
 *   - State regulations (disclosure requirements affect margins)
 *
 * Fee calculation:
 *   base_fee = property_value × base_rate
 *   adjusted_fee = base_fee × velocity_mult × distress_mult ÷ competition_mult
 *   final_fee = clamp(adjusted_fee, floor, regional_ceiling)
 *
 * All amounts in CENTS.
 */

import { FEE_FLOOR_CENTS } from './negotiationEngine';

/** $5,000 floor in dollars for easier readability in configs */
export const FEE_FLOOR_DOLLARS = FEE_FLOOR_CENTS / 100;

/** Annual inflation rate for property values (2024-2026 average projection) */
export const ANNUAL_INFLATION_RATE = 0.035; // 3.5%

/** Base assignment fee rate as % of property value */
export const BASE_FEE_RATE = 0.05; // 5% baseline

export type USState =
  | 'TX' | 'FL' | 'CA' | 'AZ' | 'NV' | 'GA' | 'NC' | 'SC' | 'TN' | 'OH'
  | 'PA' | 'MI' | 'IN' | 'IL' | 'MO' | 'AL' | 'LA' | 'MS' | 'AR' | 'OK'
  | 'CO' | 'UT' | 'WA' | 'OR' | 'NY' | 'NJ' | 'MD' | 'VA' | 'MA' | 'OTHER';

export interface RegionalMarketData {
  state: USState;
  /** 2024 median home price in dollars */
  medianHomePriceDollars: number;
  /** Average days on market (DOM) - lower = hotter market */
  avgDaysOnMarket: number;
  /** Investor purchase percentage (0-1) */
  investorActivityRate: number;
  /** Foreclosure + pre-foreclosure rate (0-1) */
  distressRate: number;
  /** State disclosure requirements (stricter = higher compliance cost) */
  disclosureLevel: 'minimal' | 'moderate' | 'strict';
  /** Regional fee ceiling multiplier (vs base) */
  feeCeilingMultiplier: number;
}

/**
 * Regional market data — 2024 baseline, adjusted for inflation at runtime.
 *
 * Sources: NAR, Zillow, ATTOM Data, state RE commission reports
 * Last updated: 2024-Q4 (will auto-inflate)
 */
export const REGIONAL_MARKETS: Record<USState, RegionalMarketData> = {
  TX: {
    state: 'TX',
    medianHomePriceDollars: 340_000,
    avgDaysOnMarket: 45,
    investorActivityRate: 0.18,
    distressRate: 0.015,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.2,
  },
  FL: {
    state: 'FL',
    medianHomePriceDollars: 410_000,
    avgDaysOnMarket: 52,
    investorActivityRate: 0.22,
    distressRate: 0.018,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.3,
  },
  CA: {
    state: 'CA',
    medianHomePriceDollars: 785_000,
    avgDaysOnMarket: 38,
    investorActivityRate: 0.15,
    distressRate: 0.012,
    disclosureLevel: 'strict',
    feeCeilingMultiplier: 1.5,
  },
  AZ: {
    state: 'AZ',
    medianHomePriceDollars: 435_000,
    avgDaysOnMarket: 42,
    investorActivityRate: 0.20,
    distressRate: 0.016,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 1.25,
  },
  NV: {
    state: 'NV',
    medianHomePriceDollars: 450_000,
    avgDaysOnMarket: 48,
    investorActivityRate: 0.19,
    distressRate: 0.020,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 1.25,
  },
  GA: {
    state: 'GA',
    medianHomePriceDollars: 360_000,
    avgDaysOnMarket: 40,
    investorActivityRate: 0.21,
    distressRate: 0.014,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 1.15,
  },
  NC: {
    state: 'NC',
    medianHomePriceDollars: 365_000,
    avgDaysOnMarket: 44,
    investorActivityRate: 0.16,
    distressRate: 0.013,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.15,
  },
  SC: {
    state: 'SC',
    medianHomePriceDollars: 320_000,
    avgDaysOnMarket: 50,
    investorActivityRate: 0.14,
    distressRate: 0.015,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 1.1,
  },
  TN: {
    state: 'TN',
    medianHomePriceDollars: 375_000,
    avgDaysOnMarket: 38,
    investorActivityRate: 0.17,
    distressRate: 0.012,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 1.2,
  },
  OH: {
    state: 'OH',
    medianHomePriceDollars: 235_000,
    avgDaysOnMarket: 55,
    investorActivityRate: 0.15,
    distressRate: 0.018,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.0,
  },
  PA: {
    state: 'PA',
    medianHomePriceDollars: 280_000,
    avgDaysOnMarket: 52,
    investorActivityRate: 0.13,
    distressRate: 0.016,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.05,
  },
  MI: {
    state: 'MI',
    medianHomePriceDollars: 245_000,
    avgDaysOnMarket: 48,
    investorActivityRate: 0.14,
    distressRate: 0.019,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.0,
  },
  IN: {
    state: 'IN',
    medianHomePriceDollars: 240_000,
    avgDaysOnMarket: 42,
    investorActivityRate: 0.12,
    distressRate: 0.014,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 1.0,
  },
  IL: {
    state: 'IL',
    medianHomePriceDollars: 275_000,
    avgDaysOnMarket: 50,
    investorActivityRate: 0.16,
    distressRate: 0.017,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.1,
  },
  MO: {
    state: 'MO',
    medianHomePriceDollars: 250_000,
    avgDaysOnMarket: 45,
    investorActivityRate: 0.13,
    distressRate: 0.015,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 1.0,
  },
  AL: {
    state: 'AL',
    medianHomePriceDollars: 230_000,
    avgDaysOnMarket: 55,
    investorActivityRate: 0.11,
    distressRate: 0.016,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 0.95,
  },
  LA: {
    state: 'LA',
    medianHomePriceDollars: 220_000,
    avgDaysOnMarket: 60,
    investorActivityRate: 0.10,
    distressRate: 0.020,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 0.95,
  },
  MS: {
    state: 'MS',
    medianHomePriceDollars: 195_000,
    avgDaysOnMarket: 65,
    investorActivityRate: 0.08,
    distressRate: 0.022,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 0.9,
  },
  AR: {
    state: 'AR',
    medianHomePriceDollars: 215_000,
    avgDaysOnMarket: 58,
    investorActivityRate: 0.09,
    distressRate: 0.017,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 0.9,
  },
  OK: {
    state: 'OK',
    medianHomePriceDollars: 210_000,
    avgDaysOnMarket: 52,
    investorActivityRate: 0.11,
    distressRate: 0.016,
    disclosureLevel: 'minimal',
    feeCeilingMultiplier: 0.95,
  },
  CO: {
    state: 'CO',
    medianHomePriceDollars: 550_000,
    avgDaysOnMarket: 35,
    investorActivityRate: 0.14,
    distressRate: 0.010,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.35,
  },
  UT: {
    state: 'UT',
    medianHomePriceDollars: 505_000,
    avgDaysOnMarket: 40,
    investorActivityRate: 0.13,
    distressRate: 0.011,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.3,
  },
  WA: {
    state: 'WA',
    medianHomePriceDollars: 605_000,
    avgDaysOnMarket: 32,
    investorActivityRate: 0.12,
    distressRate: 0.009,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.4,
  },
  OR: {
    state: 'OR',
    medianHomePriceDollars: 490_000,
    avgDaysOnMarket: 38,
    investorActivityRate: 0.11,
    distressRate: 0.011,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.3,
  },
  NY: {
    state: 'NY',
    medianHomePriceDollars: 450_000,
    avgDaysOnMarket: 48,
    investorActivityRate: 0.18,
    distressRate: 0.015,
    disclosureLevel: 'strict',
    feeCeilingMultiplier: 1.35,
  },
  NJ: {
    state: 'NJ',
    medianHomePriceDollars: 510_000,
    avgDaysOnMarket: 42,
    investorActivityRate: 0.17,
    distressRate: 0.014,
    disclosureLevel: 'strict',
    feeCeilingMultiplier: 1.4,
  },
  MD: {
    state: 'MD',
    medianHomePriceDollars: 420_000,
    avgDaysOnMarket: 40,
    investorActivityRate: 0.15,
    distressRate: 0.013,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.25,
  },
  VA: {
    state: 'VA',
    medianHomePriceDollars: 405_000,
    avgDaysOnMarket: 38,
    investorActivityRate: 0.14,
    distressRate: 0.012,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.25,
  },
  MA: {
    state: 'MA',
    medianHomePriceDollars: 620_000,
    avgDaysOnMarket: 30,
    investorActivityRate: 0.11,
    distressRate: 0.008,
    disclosureLevel: 'strict',
    feeCeilingMultiplier: 1.45,
  },
  OTHER: {
    state: 'OTHER',
    medianHomePriceDollars: 350_000,
    avgDaysOnMarket: 50,
    investorActivityRate: 0.15,
    distressRate: 0.015,
    disclosureLevel: 'moderate',
    feeCeilingMultiplier: 1.0,
  },
};

export interface RegionalFeeInputs {
  state: USState;
  /** Property value in dollars (required) */
  propertyValueDollars: number;
  /** Override days on market if known */
  daysOnMarket?: number;
  /** True if property is in distress (foreclosure, pre-foreclosure, probate) */
  isDistressed?: boolean;
  /** True if this is a luxury property (>2x regional median) */
  isLuxury?: boolean;
  /** Reference date for inflation calculation (defaults to now) */
  referenceDate?: Date;
}

export interface RegionalFeeResult {
  /** Minimum fee in cents ($5,000 hard floor) */
  minFeeCents: number;
  /** Maximum fee in cents (regional ceiling) */
  maxFeeCents: number;
  /** Target fee in cents (sweet spot for negotiation) */
  targetFeeCents: number;
  /** Fee as percentage of property value */
  feePercent: number;
  /** Regional multiplier applied */
  regionalMultiplier: number;
  /** Breakdown for transparency */
  breakdown: {
    baseFee: number;
    velocityAdjustment: number;
    distressAdjustment: number;
    competitionAdjustment: number;
    disclosureAdjustment: number;
    inflationAdjustment: number;
  };
  /** Human-readable explanation */
  explanation: string[];
}

/** Baseline date for inflation calculation (2024-01-01) */
const BASELINE_DATE = new Date('2024-01-01');

/**
 * Calculate years elapsed since baseline for inflation adjustment.
 */
function yearsFromBaseline(referenceDate: Date): number {
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  return Math.max(0, (referenceDate.getTime() - BASELINE_DATE.getTime()) / msPerYear);
}

/**
 * Adjust regional median for inflation.
 */
function inflationAdjustedMedian(medianDollars: number, referenceDate: Date): number {
  const years = yearsFromBaseline(referenceDate);
  return medianDollars * Math.pow(1 + ANNUAL_INFLATION_RATE, years);
}

/**
 * Calculate velocity multiplier based on days on market.
 * Hot markets (low DOM) = higher urgency = higher fees.
 */
function velocityMultiplier(dom: number): number {
  if (dom < 30) return 1.15; // Very hot
  if (dom < 40) return 1.10;
  if (dom < 50) return 1.05;
  if (dom < 60) return 1.00;
  if (dom < 75) return 0.95;
  return 0.90; // Slow market
}

/**
 * Calculate distress premium.
 * Distressed properties command higher fees due to complexity/risk.
 */
function distressMultiplier(isDistressed: boolean, regionalDistressRate: number): number {
  if (!isDistressed) return 1.0;
  // Higher regional distress = more competition = lower premium
  // Lower regional distress = opportunity = higher premium
  return 1.15 - (regionalDistressRate * 5); // 1.05-1.15 range
}

/**
 * Calculate competition adjustment.
 * Higher investor activity = lower fees due to competition.
 */
function competitionMultiplier(investorRate: number): number {
  if (investorRate > 0.20) return 1.10; // High competition
  if (investorRate > 0.15) return 1.05;
  if (investorRate > 0.10) return 1.00;
  return 0.95; // Low competition = higher margin opportunity
}

/**
 * Calculate disclosure cost adjustment.
 * Stricter states have higher compliance costs = need higher fees.
 */
function disclosureMultiplier(level: 'minimal' | 'moderate' | 'strict'): number {
  if (level === 'strict') return 1.08;
  if (level === 'moderate') return 1.03;
  return 1.0;
}

/**
 * Calculate regional min-max assignment fee.
 *
 * FLOOR: $5,000 (FEE_FLOOR_CENTS) — NON-NEGOTIABLE
 * CEILING: property_value × base_rate × regional_multiplier × adjustments
 */
export function calculateRegionalFee(inputs: RegionalFeeInputs): RegionalFeeResult {
  const {
    state,
    propertyValueDollars,
    daysOnMarket,
    isDistressed = false,
    isLuxury = false,
    referenceDate = new Date(),
  } = inputs;

  const market = REGIONAL_MARKETS[state] || REGIONAL_MARKETS.OTHER;
  const explanation: string[] = [];

  // Get inflation-adjusted regional median
  const adjustedMedian = inflationAdjustedMedian(market.medianHomePriceDollars, referenceDate);
  const inflationYears = yearsFromBaseline(referenceDate);
  const inflationFactor = Math.pow(1 + ANNUAL_INFLATION_RATE, inflationYears);

  explanation.push(`State: ${state}, Median: $${Math.round(adjustedMedian).toLocaleString()} (${(inflationYears).toFixed(1)}yr inflation @ ${(ANNUAL_INFLATION_RATE * 100).toFixed(1)}%)`);

  // Base fee calculation
  const baseFeeRate = BASE_FEE_RATE * market.feeCeilingMultiplier;
  const baseFee = propertyValueDollars * baseFeeRate;
  explanation.push(`Base fee: $${propertyValueDollars.toLocaleString()} × ${(baseFeeRate * 100).toFixed(1)}% = $${Math.round(baseFee).toLocaleString()}`);

  // Calculate multipliers
  const dom = daysOnMarket ?? market.avgDaysOnMarket;
  const velMult = velocityMultiplier(dom);
  const distMult = distressMultiplier(isDistressed, market.distressRate);
  const compMult = competitionMultiplier(market.investorActivityRate);
  const discMult = disclosureMultiplier(market.disclosureLevel);

  explanation.push(`Velocity (${dom} DOM): ×${velMult.toFixed(2)}`);
  if (isDistressed) explanation.push(`Distress premium: ×${distMult.toFixed(2)}`);
  explanation.push(`Competition (${(market.investorActivityRate * 100).toFixed(0)}% investor): ÷${compMult.toFixed(2)}`);
  if (market.disclosureLevel !== 'minimal') explanation.push(`Disclosure (${market.disclosureLevel}): ×${discMult.toFixed(2)}`);

  // Adjusted fee
  let adjustedFee = baseFee * velMult * distMult * discMult / compMult;

  // Luxury premium
  if (isLuxury || propertyValueDollars > adjustedMedian * 2) {
    adjustedFee *= 1.20;
    explanation.push('Luxury property premium: ×1.20');
  }

  // Apply floor and ceiling
  const floorDollars = FEE_FLOOR_DOLLARS;
  const ceilingDollars = Math.round(adjustedFee);

  // Target is 70% of ceiling but at least the floor
  const targetDollars = Math.max(floorDollars, Math.round(ceilingDollars * 0.70));

  // Final values
  const minFeeCents = FEE_FLOOR_CENTS; // ALWAYS $5,000 floor
  const maxFeeCents = Math.max(FEE_FLOOR_CENTS, ceilingDollars * 100);
  const targetFeeCents = Math.max(FEE_FLOOR_CENTS, targetDollars * 100);

  const feePercent = (maxFeeCents / 100) / propertyValueDollars;

  explanation.push(`Fee range: $${(minFeeCents / 100).toLocaleString()} - $${(maxFeeCents / 100).toLocaleString()} (${(feePercent * 100).toFixed(1)}% of property)`);

  return {
    minFeeCents,
    maxFeeCents,
    targetFeeCents,
    feePercent,
    regionalMultiplier: market.feeCeilingMultiplier,
    breakdown: {
      baseFee: Math.round(baseFee * 100),
      velocityAdjustment: Math.round((velMult - 1) * baseFee * 100),
      distressAdjustment: Math.round((distMult - 1) * baseFee * 100),
      competitionAdjustment: Math.round((1 - 1 / compMult) * baseFee * 100),
      disclosureAdjustment: Math.round((discMult - 1) * baseFee * 100),
      inflationAdjustment: Math.round((inflationFactor - 1) * market.medianHomePriceDollars),
    },
    explanation,
  };
}

/**
 * Get regional market data with inflation adjustment.
 */
export function getRegionalMarket(state: USState, referenceDate: Date = new Date()): RegionalMarketData & { inflatedMedian: number } {
  const market = REGIONAL_MARKETS[state] || REGIONAL_MARKETS.OTHER;
  return {
    ...market,
    inflatedMedian: inflationAdjustedMedian(market.medianHomePriceDollars, referenceDate),
  };
}

/**
 * Check if a fee amount is within regional bounds.
 */
export function validateRegionalFee(
  feeCents: number,
  state: USState,
  propertyValueDollars: number
): { valid: boolean; reason?: string } {
  if (feeCents < FEE_FLOOR_CENTS) {
    return { valid: false, reason: `Fee $${(feeCents / 100).toLocaleString()} is below $${FEE_FLOOR_DOLLARS.toLocaleString()} hard floor` };
  }

  const regional = calculateRegionalFee({ state, propertyValueDollars });
  if (feeCents > regional.maxFeeCents * 1.5) {
    return { valid: false, reason: `Fee $${(feeCents / 100).toLocaleString()} exceeds 1.5x regional ceiling $${(regional.maxFeeCents / 100).toLocaleString()}` };
  }

  return { valid: true };
}
