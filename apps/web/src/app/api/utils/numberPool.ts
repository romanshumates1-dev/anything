import { AREA_CODES, areaCodeOf, type GeoPoint } from './area-codes';

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

// ─────────────────────────────────────────────────────────────────────────────
// INT-3 — local-presence selection (pure; DB I/O lives in numberPoolStore.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Owner Decision 2: the carrier limit is not the reputation-safe limit for cold
 * outreach, so the sends-per-number-per-day used is
 *   min(rotationCap, computeDailyCapacity(number))
 * `rotationCap` is the tunable reputation guard; the carrier number is the hard
 * ceiling we must never exceed. Both are surfaced per-number in the UI.
 */
export const DEFAULT_ROTATION_CAP = 125;

/** Default send-window hours used for capacity math (10-11am + 2-4pm ≈ 3h of
 *  window, but capacity is quoted over the full lead-local day the gate allows). */
export const DEFAULT_WINDOW_HOURS = 13; // 8am-9pm quiet-hours span

export type PoolCandidate = {
  phoneNumber: string;
  numberType: NumberPoolEntry['numberType'];
  trustLevel: TrustLevel;
  dailySent: number;
  active: boolean;
};

export type DailyCap = {
  rotationCap: number;
  carrierCap: number;
  effective: number;
  limitedBy: 'rotation' | 'carrier';
};

export function effectiveDailyCap(
  entry: Pick<PoolCandidate, 'numberType' | 'trustLevel'>,
  rotationCap: number,
  windowHours: number = DEFAULT_WINDOW_HOURS
): DailyCap {
  const carrierCap =
    entry.numberType === '10dlc'
      ? computeDailyCapacity(DEFAULT_THROUGHPUT[entry.trustLevel], windowHours)
      : Math.floor(computeThroughputCeiling(entry.numberType) * windowHours * 3600);

  const effective = Math.min(rotationCap, carrierCap);
  return {
    rotationCap,
    carrierCap,
    effective,
    limitedBy: rotationCap <= carrierCap ? 'rotation' : 'carrier',
  };
}

/** Great-circle distance in km. Region centroids are metro-level approximations
 *  (see area-codes.ts) — this ranks candidates, it does not locate anybody. */
function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Pick the best local-presence number for a lead.
 *
 * Order (owner-specified): exact area code → nearest region → least-used.
 * Locality intentionally outranks usage-balancing: a same-area-code number is
 * the entire point of local presence, so a busy local number beats an idle
 * out-of-region one. Usage only breaks ties within a locality tier.
 *
 * Returns null when nothing is eligible (all capped / inactive / empty pool) —
 * callers must treat null as "do not send", never as "send from anything".
 */
export function selectNumber(
  pool: PoolCandidate[],
  leadPhone: string | null | undefined,
  rotationCap: number = DEFAULT_ROTATION_CAP,
  windowHours: number = DEFAULT_WINDOW_HOURS
): PoolCandidate | null {
  const eligible = pool.filter(
    (n) => n.active && n.dailySent < effectiveDailyCap(n, rotationCap, windowHours).effective
  );
  if (eligible.length === 0) return null;

  const leastUsed = (list: PoolCandidate[]) =>
    list.reduce((best, n) => (n.dailySent < best.dailySent ? n : best));

  const leadAc = areaCodeOf(leadPhone);

  // 1. exact area-code match
  if (leadAc) {
    const exact = eligible.filter((n) => areaCodeOf(n.phoneNumber) === leadAc);
    if (exact.length > 0) return leastUsed(exact);
  }

  // 2. nearest region by centroid distance
  const leadGeo = leadAc ? AREA_CODES[leadAc] : undefined;
  if (leadGeo) {
    const located = eligible
      .map((n) => {
        const ac = areaCodeOf(n.phoneNumber);
        const geo = ac ? AREA_CODES[ac] : undefined;
        return geo ? { n, km: distanceKm(leadGeo, geo) } : null;
      })
      .filter((x): x is { n: PoolCandidate; km: number } => x !== null);

    if (located.length > 0) {
      const nearestKm = Math.min(...located.map((x) => x.km));
      // Ties at the same distance fall through to least-used.
      return leastUsed(located.filter((x) => x.km === nearestKm).map((x) => x.n));
    }
  }

  // 3. unknown area code (or no located candidates) → least-used.
  // We do NOT guess a locality here: claiming local presence we cannot support
  // is worse than a neutral number.
  return leastUsed(eligible);
}
