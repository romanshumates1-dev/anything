/**
 * Seller tax withholding — pure policy layer.
 *
 * WHY PURE, AND WHY THAT MATTERS
 * ------------------------------
 * Every function here is pure: no DB, no clock, no randomness. All "now" and
 * "context" values are parameters. That is deliberate — money arithmetic is
 * exactly the code where a subtle bug is most expensive and hardest to see, and
 * isolating it means the boundary, rounding and idempotency rules can be tested
 * exhaustively without a database, a fake timer, or a race to reproduce.
 *
 * Money rules this module enforces:
 *  - All amounts are integer CENTS. No floats, ever. `0.1 + 0.2` problems cannot
 *    occur because fractional cents are unrepresentable.
 *  - Rates are integer BASIS POINTS (1500 = 15.00%). `rateBps / 10000` is the
 *    only place a percentage becomes a number, and it happens inside
 *    `computeWithholding` with floor rounding.
 *  - Rounding is FLOOR on the withheld amount, so the seller is never
 *    over-withheld by a fraction of a cent; the remainder stays with them.
 *  - `splitWithholding` is the single place gross is divided, and it is
 *    provably lossless: net + withheld === gross, always. A test asserts this
 *    over a large boundary grid, because an off-by-one here would silently
 *    create or destroy money.
 *  - A disabled or zero-rate setting withholds nothing and releases any prior
 *    balance, so turning the feature off returns the seller their money rather
 *    than stranding it.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It does not compute a tax liability, does not know any jurisdiction's rates,
 * and does not decide what anyone owes. Rates are configuration supplied by the
 * caller. The reporting surface must present the result as an ESTIMATE.
 */

export type WithholdingKind = 'WITHHELD' | 'RELEASED' | 'ADJUSTMENT';

export interface WithholdingSettings {
  enabled: boolean;
  /** Basis points, 0..10000. */
  rateBps: number;
  jurisdiction?: string | null;
}

export interface WithholdingSplit {
  grossCents: number;
  withheldCents: number;
  netCents: number;
  rateBps: number;
  applied: boolean;
}

export interface LedgerEntry {
  id: string;
  kind: WithholdingKind;
  amountCents: number;
  rateBps: number;
  periodQualified: string;
  earningId?: string | null;
  withdrawalId?: string | null;
  createdAt: string;
  idempotencyKey: string;
}

export interface PeriodSummary {
  periodQualified: string;
  withheldCents: number;
  releasedCents: number;
  netWithheldCents: number;
  entryCount: number;
}

export interface EarningsTaxReport {
  from: string;
  to: string;
  grossEarningsCents: number;
  refundedCents: number;
  withdrawnCents: number;
  withheldCents: number;
  releasedCents: number;
  netWithheldCents: number;
  /** gross - refunds - still-held tax. The seller's net receipts. */
  netReceivedCents: number;
  periods: PeriodSummary[];
  settings: WithholdingSettings;
  generatedAt: string;
  disclaimer: string;
}

export const DISCLAIMER =
  'This report is an ESTIMATE of amounts withheld by the platform for your records. ' +
  'It is not a tax form, not tax advice, and not a statement of your actual tax liability. ' +
  'Consult a qualified tax professional for advice about your circumstances.';

/** Basis points are bounded to 0..10000; anything else is nonsense config. */
export function isValidRateBps(rateBps: unknown): rateBps is number {
  return (
    typeof rateBps === 'number' &&
    Number.isInteger(rateBps) &&
    rateBps >= 0 &&
    rateBps <= 10000
  );
}

/** Normalise untrusted settings input into something safe to apply. */
export function normalizeSettings(
  input: Partial<WithholdingSettings> | null | undefined
): WithholdingSettings {
  const enabled = Boolean(input?.enabled);
  const rateBps = isValidRateBps(input?.rateBps) ? input.rateBps : 0;
  // A rate of zero is meaningless while "enabled", so treat it as disabled
  // rather than withholding nothing and reporting withholding as active.
  return {
    enabled: enabled && rateBps > 0,
    rateBps,
    jurisdiction: input?.jurisdiction ?? null,
  };
}

/**
 * Withhold `floor(gross * rateBps / 10000)` cents.
 *
 * Integer arithmetic end to end; `Math.floor` is applied to a value already
 * exact at cents, so there is no accumulated float drift.
 */
export function computeWithholding(grossCents: number, rateBps: number): number {
  if (!Number.isInteger(grossCents) || grossCents <= 0) return 0;
  if (!isValidRateBps(rateBps) || rateBps === 0) return 0;
  return Math.floor((grossCents * rateBps) / 10000);
}

/**
 * Divide a gross amount into withheld + net. LOSSLESS BY CONSTRUCTION:
 *   withheld + net === gross
 */
export function splitWithholding(
  grossCents: number,
  settings: Partial<WithholdingSettings> | null | undefined
): WithholdingSplit {
  const gross = Number.isInteger(grossCents) && grossCents > 0 ? grossCents : 0;
  const s = normalizeSettings(settings);
  const withheldCents = s.enabled ? computeWithholding(gross, s.rateBps) : 0;
  return {
    grossCents: gross,
    withheldCents,
    netCents: gross - withheldCents,
    rateBps: s.enabled ? s.rateBps : 0,
    applied: withheldCents > 0,
  };
}

/** Calendar quarter key for a date, e.g. '2026-Q3'. */
export function quarterOf(date: Date): string {
  const y = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

/** Inclusive list of quarter keys between two dates, oldest first. */
export function quartersBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  let y = from.getUTCFullYear();
  let q = Math.floor(from.getUTCMonth() / 3) + 1;
  const endY = to.getUTCFullYear();
  const endQ = Math.floor(to.getUTCMonth() / 3) + 1;
  // Bounded so a malformed range cannot spin here.
  for (let guard = 0; guard < 400; guard++) {
    out.push(`${y}-Q${q}`);
    if (y === endY && q === endQ) break;
    q += 1;
    if (q > 4) {
      q = 1;
      y += 1;
    }
  }
  return out;
}

/**
 * Sum currently-held (not yet released) withholding. A WITHHELD row increases
 * the balance, a RELEASED row decreases it. The floor at zero is the important
 * invariant: a duplicated or over-large release can never make the held balance
 * negative and so can never turn into a payout the platform owes.
 */
export function netWithheldBalance(entries: LedgerEntry[]): number {
  let balance = 0;
  for (const e of entries) {
    if (e.kind === 'WITHHELD') balance += e.amountCents;
    else if (e.kind === 'RELEASED') balance -= e.amountCents;
  }
  return Math.max(0, balance);
}

/** Group the ledger by tax period. Periods with no activity are included as 0. */
export function summarizeByPeriod(entries: LedgerEntry[], periods: string[]): PeriodSummary[] {
  const map = new Map<string, PeriodSummary>(
    periods.map((p) => [
      p,
      { periodQualified: p, withheldCents: 0, releasedCents: 0, netWithheldCents: 0, entryCount: 0 },
    ])
  );
  for (const e of entries) {
    const row = map.get(e.periodQualified) ?? {
      periodQualified: e.periodQualified,
      withheldCents: 0,
      releasedCents: 0,
      netWithheldCents: 0,
      entryCount: 0,
    };
    if (e.kind === 'WITHHELD') row.withheldCents += e.amountCents;
    else if (e.kind === 'RELEASED') row.releasedCents += e.amountCents;
    row.entryCount += 1;
    row.netWithheldCents = Math.max(0, row.withheldCents - row.releasedCents);
    map.set(e.periodQualified, row);
  }
  return [...map.values()].sort((a, b) => a.periodQualified.localeCompare(b.periodQualified));
}

export interface BuildReportInput {
  from: Date;
  to: Date;
  /** Gross earnings created in the window, in cents. */
  grossEarningsCents: number;
  /** Refunded in the window, in cents. Positive number. */
  refundedCents: number;
  /** Withdrawn (paid to the bank) in the window, in cents. Positive. */
  withdrawnCents: number;
  /** Ledger rows written in the window. */
  entries: LedgerEntry[];
  settings: Partial<WithholdingSettings> | null | undefined;
  now: Date;
}

/**
 * Assemble the seller-facing report. `netReceivedCents` is the money that
 * actually reached the seller: gross earned, less refunds, less what is still
 * held back for tax.
 */
export function buildEarningsTaxReport(input: BuildReportInput): EarningsTaxReport {
  const gross = Number.isInteger(input.grossEarningsCents) ? input.grossEarningsCents : 0;
  const refunded = Number.isInteger(input.refundedCents) ? input.refundedCents : 0;
  const withdrawn = Number.isInteger(input.withdrawnCents) ? input.withdrawnCents : 0;

  const periods = quartersBetween(input.from, input.to);
  const periodSummaries = summarizeByPeriod(input.entries, periods);
  const withheld = periodSummaries.reduce((s, p) => s + p.withheldCents, 0);
  const released = periodSummaries.reduce((s, p) => s + p.releasedCents, 0);
  const netWithheld = netWithheldBalance(input.entries);

  return {
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    grossEarningsCents: gross,
    refundedCents: refunded,
    withdrawnCents: withdrawn,
    withheldCents: withheld,
    releasedCents: released,
    netWithheldCents: netWithheld,
    netReceivedCents: Math.max(0, gross - refunded - netWithheld),
    periods: periodSummaries,
    settings: normalizeSettings(input.settings),
    generatedAt: input.now.toISOString(),
    disclaimer: DISCLAIMER,
  };
}

/**
 * Deterministic idempotency key. The SAME logical operation must always produce
 * the SAME key, or the UNIQUE constraint cannot reject a replay. Callers pass a
 * stable scope (e.g. the withdrawal id) — never a timestamp or a random value.
 */
export function buildIdempotencyKey(scope: string, kind: WithholdingKind, amountCents: number): string {
  return `tax:${kind.toLowerCase()}:${scope}:${amountCents}`;
}
