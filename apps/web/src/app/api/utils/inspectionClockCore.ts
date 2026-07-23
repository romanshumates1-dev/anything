/**
 * Phase V-R — inspection clock PURE CORE (client-safe: no sql/jobs imports,
 * so the UI chip and the server handlers share one implementation).
 *
 * PURE math here (fake-clock testable, no DB); the job handler at the bottom is
 * the thin I/O layer. Day counting is CALENDAR-DAY based in the OWNER'S
 * timezone (default America/New_York, env OWNER_TIMEZONE): a contract signed at
 * 11pm is "day 2" the next morning — matching how a wholesaler actually counts
 * an inspection period ("we signed Tuesday, so Friday is day 3"), rather than
 * rolling 24h blocks that drift across the day. DST-safe because day identity
 * comes from Intl-formatted Y-M-D in the zone, never from offset arithmetic.
 */
import { DEFAULT_FEE_FLOOR } from './valuationEngine';

export const OWNER_TIMEZONE = process.env.OWNER_TIMEZONE || 'America/New_York';

export type ClockStage = 'green' | 'amber' | 'red' | 'expired';

export interface ClockState {
  /** 1-based: signing day is day 1. */
  day: number;
  totalDays: number;
  daysRemaining: number;
  stage: ClockStage;
  label: string; // "Day 4 of 10 — 6 days to assign"
}

/** Y-M-D identity of an instant in a zone (calendar day, DST-safe). */
function ymdInZone(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/** Whole calendar days between two instants in a zone (0 = same day). */
export function calendarDaysBetween(from: Date, to: Date, tz: string = OWNER_TIMEZONE): number {
  const [fy, fm, fd] = ymdInZone(from, tz).split('-').map(Number);
  const [ty, tm, td] = ymdInZone(to, tz).split('-').map(Number);
  // UTC-noon anchoring removes DST length differences from the subtraction.
  const a = Date.UTC(fy, fm - 1, fd, 12);
  const b = Date.UTC(ty, tm - 1, td, 12);
  return Math.round((b - a) / 86_400_000);
}

export function clockState(createdAt: Date, inspectionDays: number, now: Date, tz: string = OWNER_TIMEZONE): ClockState {
  const total = Math.min(14, Math.max(7, Math.round(inspectionDays) || 10));
  const day = Math.max(1, calendarDaysBetween(createdAt, now, tz) + 1); // signing day = day 1
  const remaining = Math.max(0, total - day);
  let stage: ClockStage;
  if (day > total) stage = 'expired';
  else if (remaining <= 2) stage = 'red';
  else if (remaining <= total / 2) stage = 'amber';
  else stage = 'green';
  const label =
    stage === 'expired'
      ? `Inspection window expired (day ${day} of ${total})`
      : `Day ${day} of ${total} — ${remaining} day${remaining === 1 ? '' : 's'} to assign`;
  return { day: Math.min(day, total + 99), totalDays: total, daysRemaining: remaining, stage, label };
}

/**
 * Day-N−2 math: the LOWEST viable buyer ask that still clears the fee floor.
 * maxCut (vs a current ask, when known) = currentAsk − lowestViableAsk.
 * Returns null when contract price is unknown or nothing clears the floor.
 */
export function lowestViableAsk(contractPriceCents: number | null | undefined, feeFloorDollars: number = DEFAULT_FEE_FLOOR): {
  lowestAskCents: number;
  maxCutCents: (currentAskCents: number) => number;
} | null {
  if (typeof contractPriceCents !== 'number' || !Number.isFinite(contractPriceCents) || contractPriceCents <= 0) return null;
  const lowestAskCents = contractPriceCents + Math.round(feeFloorDollars * 100);
  return {
    lowestAskCents,
    maxCutCents: (currentAskCents: number) => Math.max(0, currentAskCents - lowestAskCents),
  };
}

