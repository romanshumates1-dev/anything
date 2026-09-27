/**
 * Seller tax withholding — money-math policy.
 *
 * Technique over repetition, because this is the code where a subtle bug is
 * most expensive:
 *  - EQUIVALENCE PARTITIONING: gross <= 0, fractional, normal, huge, NaN/Inf.
 *  - BOUNDARY VALUE ANALYSIS: 0%, 100%, 1 cent, the exact floor-rounding edge.
 *  - LOSSLESSNESS GRID: net + withheld === gross across a wide cross-product,
 *    because an off-by-one here silently creates or destroys money.
 *  - LEDGER STATE MACHINE: withhold -> release -> re-withhold, plus the
 *    floor-at-zero invariant under duplicate/over-large releases.
 *  - DETERMINISM: the idempotency key must be stable or the UNIQUE constraint
 *    cannot reject a replay.
 */
import { describe, it, expect } from 'vitest';
import {
  computeWithholding,
  splitWithholding,
  normalizeSettings,
  isValidRateBps,
  quarterOf,
  quartersBetween,
  netWithheldBalance,
  summarizeByPeriod,
  buildEarningsTaxReport,
  buildIdempotencyKey,
  DISCLAIMER,
  type LedgerEntry,
} from '@/app/api/utils/taxWithholding';

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: 'tx_1',
  kind: 'WITHHELD',
  amountCents: 1000,
  rateBps: 1500,
  periodQualified: '2026-Q3',
  createdAt: '2026-08-01T00:00:00Z',
  idempotencyKey: 'tax:withheld:w1:1000',
  ...over,
});

describe('isValidRateBps / normalizeSettings', () => {
  it('accepts only integer basis points in 0..10000', () => {
    expect(isValidRateBps(0)).toBe(true);
    expect(isValidRateBps(1500)).toBe(true);
    expect(isValidRateBps(10000)).toBe(true);
    expect(isValidRateBps(-1)).toBe(false);
    expect(isValidRateBps(10001)).toBe(false);
    expect(isValidRateBps(12.5)).toBe(false);
    expect(isValidRateBps('1500' as unknown as number)).toBe(false);
    expect(isValidRateBps(NaN)).toBe(false);
  });

  it('treats "enabled with a zero rate" as disabled', () => {
    // Otherwise the UI claims withholding is on while nothing is withheld.
    expect(normalizeSettings({ enabled: true, rateBps: 0 }).enabled).toBe(false);
  });

  it('rejects hostile config rather than trusting it', () => {
    expect(normalizeSettings({ enabled: true, rateBps: 999999 }).enabled).toBe(false);
    expect(normalizeSettings(null).rateBps).toBe(0);
    expect(normalizeSettings(undefined).enabled).toBe(false);
  });
});

describe('computeWithholding — boundary + partitioning', () => {
  it('withholds nothing for non-positive or fractional gross', () => {
    expect(computeWithholding(0, 1500)).toBe(0);
    expect(computeWithholding(-500, 1500)).toBe(0);
    expect(computeWithholding(10.5, 1500)).toBe(0);
    expect(computeWithholding(NaN, 1500)).toBe(0);
    expect(computeWithholding(Infinity, 1500)).toBe(0);
  });

  it('handles the 0% and 100% edges', () => {
    expect(computeWithholding(100_000, 0)).toBe(0);
    expect(computeWithholding(100_000, 10000)).toBe(100_000);
  });

  it('1 cent at 15% withholds 0 — floor never takes a whole cent', () => {
    expect(computeWithholding(1, 1500)).toBe(0);
  });

  it('6 cents at 15% is 0, 7 cents is 1 — the exact rounding boundary', () => {
    expect(computeWithholding(6, 1500)).toBe(0);
    expect(computeWithholding(7, 1500)).toBe(1);
  });

  it('is exact on round figures (no float drift)', () => {
    expect(computeWithholding(100_000, 1500)).toBe(15_000);
    expect(computeWithholding(1_000_000, 2250)).toBe(225_000);
  });
});

describe('splitWithholding — losslessness grid', () => {
  const grosses = [1, 2, 3, 6, 7, 99, 100, 333, 1_000, 9_999, 123_456, 1_000_000];
  const rates = [0, 1, 7, 100, 1500, 2250, 3333, 9999, 10000];

  it('net + withheld === gross for every gross/rate pair', () => {
    for (const g of grosses) {
      for (const r of rates) {
        const s = splitWithholding(g, { enabled: true, rateBps: r });
        expect(s.netCents + s.withheldCents).toBe(g);
        expect(s.withheldCents).toBeGreaterThanOrEqual(0);
        expect(s.netCents).toBeGreaterThanOrEqual(0);
        expect(s.withheldCents).toBeLessThanOrEqual(g);
      }
    }
  });

  it('withholds nothing when the feature is off', () => {
    const s = splitWithholding(100_000, { enabled: false, rateBps: 1500 });
    expect(s.withheldCents).toBe(0);
    expect(s.netCents).toBe(100_000);
    expect(s.applied).toBe(false);
  });

  it('reports the effective rate it actually applied', () => {
    expect(splitWithholding(100_000, { enabled: true, rateBps: 1500 }).rateBps).toBe(1500);
    expect(splitWithholding(100_000, { enabled: false, rateBps: 1500 }).rateBps).toBe(0);
  });
});

describe('quarterOf / quartersBetween', () => {
  it('maps dates to the right calendar quarter (UTC)', () => {
    expect(quarterOf(new Date('2026-01-01T00:00:00Z'))).toBe('2026-Q1');
    expect(quarterOf(new Date('2026-03-31T23:59:59Z'))).toBe('2026-Q1');
    expect(quarterOf(new Date('2026-04-01T00:00:00Z'))).toBe('2026-Q2');
    expect(quarterOf(new Date('2026-12-31T00:00:00Z'))).toBe('2026-Q4');
  });

  it('enumerates an inclusive range and crosses year boundaries', () => {
    expect(quartersBetween(new Date('2026-01-01Z'), new Date('2026-12-31Z')))
      .toEqual(['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
    expect(quartersBetween(new Date('2025-11-01Z'), new Date('2026-02-01Z')))
      .toEqual(['2025-Q4', '2026-Q1']);
  });

  it('returns one quarter when from and to share a period', () => {
    expect(quartersBetween(new Date('2026-05-01Z'), new Date('2026-06-01Z')))
      .toEqual(['2026-Q2']);
  });

describe('netWithheldBalance — ledger state machine', () => {
  it('is zero for an empty ledger', () => {
    expect(netWithheldBalance([])).toBe(0);
  });

  it('accumulates withholds and subtracts releases', () => {
    const entries = [
      entry({ kind: 'WITHHELD', amountCents: 1500 }),
      entry({ kind: 'WITHHELD', amountCents: 500 }),
      entry({ kind: 'RELEASED', amountCents: 700 }),
    ];
    expect(netWithheldBalance(entries)).toBe(1300);
  });

  it('FLOORS AT ZERO — a duplicate/over-large release can never go negative', () => {
    // If this could go negative, a replayed release would become money the
    // platform owes the seller.
    const entries = [
      entry({ kind: 'WITHHELD', amountCents: 1000 }),
      entry({ kind: 'RELEASED', amountCents: 1000 }),
      entry({ kind: 'RELEASED', amountCents: 1000 }),
    ];
    expect(netWithheldBalance(entries)).toBe(0);
  });

  it('ignores ADJUSTMENT rows when computing the held balance', () => {
    expect(netWithheldBalance([entry({ kind: 'ADJUSTMENT', amountCents: 9999 })])).toBe(0);
  });
});

describe('summarizeByPeriod', () => {
  it('includes requested periods with no activity as zero', () => {
    const rows = summarizeByPeriod([], ['2026-Q1', '2026-Q2', '2026-Q3']);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.entryCount === 0 && r.netWithheldCents === 0)).toBe(true);
  });

  it('separates withheld from released within a period', () => {
    const rows = summarizeByPeriod(
      [
        entry({ periodQualified: '2026-Q3', kind: 'WITHHELD', amountCents: 2000 }),
        entry({ periodQualified: '2026-Q3', kind: 'RELEASED', amountCents: 500 }),
      ],
      ['2026-Q3']
    );
    expect(rows[0]).toMatchObject({
      withheldCents: 2000,
      releasedCents: 500,
      netWithheldCents: 1500,
      entryCount: 2,
    });
  });
});

describe('buildEarningsTaxReport', () => {
  const base = {
    from: new Date('2026-07-01T00:00:00Z'),
    to: new Date('2026-09-30T23:59:59Z'),
    now: new Date('2026-10-01T00:00:00Z'),
  };

  it('produces a consistent report carrying an estimate disclaimer', () => {
    const r = buildEarningsTaxReport({
      ...base,
      grossEarningsCents: 100_000,
      refundedCents: 10_000,
      withdrawnCents: 60_000,
      entries: [entry({ kind: 'WITHHELD', amountCents: 15_000 })],
      settings: { enabled: true, rateBps: 1500 },
    });
    expect(r.grossEarningsCents).toBe(100_000);
    expect(r.netWithheldCents).toBe(15_000);
    // 100,000 gross - 10,000 refunds - 15,000 still held = 75,000
    expect(r.netReceivedCents).toBe(75_000);
    expect(r.disclaimer).toBe(DISCLAIMER);
    expect(r.disclaimer).toMatch(/not a tax form/i);
  });

  it('never reports negative net receipts', () => {
    const r = buildEarningsTaxReport({
      ...base,
      grossEarningsCents: 1000,
      refundedCents: 5000,
      withdrawnCents: 0,
      entries: [],
      settings: null,
    });
    expect(r.netReceivedCents).toBe(0);
  });

  it('handles a no-activity seller without NaN or missing periods', () => {
    const r = buildEarningsTaxReport({
      ...base,
      grossEarningsCents: 0,
      refundedCents: 0,
      withdrawnCents: 0,
      entries: [],
      settings: null,
    });
    expect(Number.isNaN(r.netReceivedCents)).toBe(false);
    expect(r.periods).toHaveLength(1);
  });
});

describe('buildIdempotencyKey — replay protection', () => {
  it('is deterministic for the same logical operation', () => {
    expect(buildIdempotencyKey('wd_123', 'WITHHELD', 1500)).toBe(
      buildIdempotencyKey('wd_123', 'WITHHELD', 1500)
    );
  });

  it('differs by scope, kind, and amount', () => {
    expect(buildIdempotencyKey('wd_1', 'WITHHELD', 100)).not.toBe(
      buildIdempotencyKey('wd_2', 'WITHHELD', 100)
    );
    expect(buildIdempotencyKey('wd_1', 'WITHHELD', 100)).not.toBe(
      buildIdempotencyKey('wd_1', 'RELEASED', 100)
    );
    expect(buildIdempotencyKey('wd_1', 'WITHHELD', 100)).not.toBe(
      buildIdempotencyKey('wd_1', 'WITHHELD', 101)
    );
  });
});
});