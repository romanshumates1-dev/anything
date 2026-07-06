export type TrustLevel = 'low' | 'medium' | 'high';

export type ThroughputConfig = {
  mps: number; // messages per second
  tMobileDailyCap: number; // T-Mobile daily cap (most restrictive US carrier)
  trustLevel: TrustLevel;
};

export type NumberPoolEntry = {
  number: string;
  numberType: '10dlc' | 'toll-free' | 'short-code';
  dailySent: number;
  dailyLimit: number;
};

/**
 * Default throughput configs for 10DLC by A2P trust score.
 * These represent conservative estimates; actual values come from Twilio
 * after campaign registration approval.
 *
 * Sources:
 * - AT&T MPS: assigned per campaign, typically 1-100+ based on trust
 * - T-Mobile daily cap: ~2,000/day for unvetted/sole-proprietor brands,
 *   ~10,000/day for vetted brands, higher for enterprise
 */
export const DEFAULT_THROUGHPUT: Record<TrustLevel, ThroughputConfig> = {
  low: {
    mps: 1,
    tMobileDailyCap: 2000,
    trustLevel: 'low',
  },
  medium: {
    mps: 10,
    tMobileDailyCap: 10000,
    trustLevel: 'medium',
  },
  high: {
    mps: 50,
    tMobileDailyCap: 50000,
    trustLevel: 'high',
  },
};

/**
 * Compute max daily volume under real A2P constraints.
 *
 * Real 10DLC throughput is constrained by TWO factors:
 * 1. MPS (messages per second) × send-window seconds → speed limit
 * 2. T-Mobile daily cap → the most restrictive carrier limit
 *
 * Daily capacity = min(MPS × windowSec, tMobileDailyCap)
 */
export function computeDailyCapacity(
  config: ThroughputConfig,
  windowHours: number
): number {
  const windowSec = windowHours * 3600;
  const speedLimit = config.mps * windowSec;
  return Math.min(speedLimit, config.tMobileDailyCap);
}

export function requiredNumbersForVolume(
  dailyVolume: number,
  windowHours: number,
  numberType: NumberPoolEntry['numberType'],
  trustLevel: TrustLevel = 'medium'
): number {
  if (numberType !== '10dlc') {
    // Toll-free and short-code use simple speed limits
    const ceiling = computeThroughputCeiling(numberType);
    const windowSec = windowHours * 3600;
    const maxPerNumber = Math.floor(ceiling * windowSec);
    return Math.ceil(dailyVolume / maxPerNumber);
  }

  const config = DEFAULT_THROUGHPUT[trustLevel];
  const capacity = computeDailyCapacity(config, windowHours);
  return Math.ceil(dailyVolume / capacity);
}

export function canFitDailyVolume(
  dailyVolume: number,
  windowHours: number,
  numberType: NumberPoolEntry['numberType'],
  trustLevel: TrustLevel = 'medium'
): boolean {
  if (numberType !== '10dlc') {
    const ceiling = computeThroughputCeiling(numberType);
    const windowSec = windowHours * 3600;
    const maxPossible = Math.floor(ceiling * windowSec);
    return dailyVolume <= maxPossible;
  }

  const config = DEFAULT_THROUGHPUT[trustLevel];
  const capacity = computeDailyCapacity(config, windowHours);
  return dailyVolume <= capacity;
}

export function computeThroughputCeiling(numberType: NumberPoolEntry['numberType']): number {
  switch (numberType) {
    case '10dlc':
      return 1; // base MPS, overridden by trust-level config
    case 'toll-free':
      return 10;
    case 'short-code':
      return 100;
    default:
      return 1;
  }
}

export function getTrustLevelFromNumberType(
  numberType: NumberPoolEntry['numberType']
): TrustLevel {
  if (numberType === '10dlc') return 'medium';
  if (numberType === 'toll-free') return 'medium';
  return 'high';
}
