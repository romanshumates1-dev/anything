/**
 * Seller earnings + tax-preparation report.
 *
 * SCOPE / HONESTY
 * ---------------
 * This is a PLATFORM earnings and withholding-support report. It is NOT an
 * official government tax form, it computes no tax liability, and it does not
 * determine what anyone owes to any authority. It reports what the platform
 * grossed, withheld, refunded, released and paid out, so the seller can hand it
 * to their own accountant. The disclaimer is returned on every response and is
 * repeated in the downloadable export.
 *
 * GRANULARITY
 * -----------
 * `period` accepts day | week | month | quarter | year. All filtering and
 * bucketing happens IN SQL (date_trunc), never by filtering already-loaded rows
 * in JavaScript - otherwise a large history would silently produce wrong period
 * totals, which is the specific failure this design avoids.
 *
 * TENANT SAFETY
 * -------------
 * The organization is taken from the session only. Every aggregate is filtered
 * by BOTH user_id and organization_id in the WHERE clause, so a seller can only
 * ever aggregate their own rows.
 */
import { auth } from '@/lib/auth';
import { getOrganization } from '@/lib/organization-context';
import { headers } from 'next/headers';
import sql from '@/app/api/utils/sql';
import {
  buildEarningsTaxReport,
  DISCLAIMER,
  type LedgerEntry,
  type WithholdingSettings,
} from '@/app/api/utils/taxWithholding';
import {
  getWithholdingSettings,
  listLedger,
  getWithheldBalance,
} from '@/app/api/utils/taxWithholdingStore';

/** Whitelisted so the value can only ever reach date_trunc as one of these. */
const PERIODS = {
  day: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
} as const;

type PeriodName = keyof typeof PERIODS;

const MAX_RANGE_DAYS = 366 * 3; // 3 years - bounds the aggregate cost.

function parseDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const organization = await getOrganization();
    if (!organization) {
      return Response.json({ error: 'No organization found' }, { status: 403 });
    }

    const url = new URL(request.url);
    const periodParam = (url.searchParams.get('period') ?? 'quarter').toLowerCase();
    const period: PeriodName =
      periodParam in PERIODS ? (periodParam as PeriodName) : 'quarter';

    const now = new Date();
    const to = parseDate(url.searchParams.get('to'), now);
    const from = parseDate(
      url.searchParams.get('from'),
      new Date(to.getTime() - 90 * 24 * 60 * 60 * 1000)
    );

    if (from > to) {
      return Response.json({ error: '`from` must not be after `to`' }, { status: 400 });
    }
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
      return Response.json(
        { error: `Date range must not exceed ${MAX_RANGE_DAYS} days` },
        { status: 400 }
      );
    }

    const userId = session.user.id;
    const orgId = organization.id;

    // Aggregates are bucketed in SQL so each period is computed from the rows
    // that actually fall in it.
    const earningsRows = await sql`
      SELECT
        date_trunc(${PERIODS[period]}, COALESCE(available_at, created_at)) AS bucket,
        COALESCE(SUM(amount_cents), 0) AS gross,
        COALESCE(SUM(CASE WHEN status = 'REFUNDED' THEN amount_cents ELSE 0 END), 0) AS refunded,
        COALESCE(SUM(CASE WHEN status = 'WITHDRAWN' THEN amount_cents ELSE 0 END), 0) AS withdrawn,
        COALESCE(SUM(CASE WHEN status = 'PENDING' THEN amount_cents ELSE 0 END), 0) AS pending,
        COALESCE(SUM(CASE WHEN status = 'AVAILABLE' THEN amount_cents ELSE 0 END), 0) AS available
      FROM earnings
      WHERE user_id = ${userId}
        AND organization_id = ${orgId}
        AND COALESCE(available_at, created_at) >= ${from}
        AND COALESCE(available_at, created_at) <= ${to}
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const withdrawalRows = await sql`
      SELECT
        date_trunc(${PERIODS[period]}, COALESCE(completed_at, requested_at)) AS bucket,
        COALESCE(SUM(amount_cents), 0) AS paid
      FROM withdrawals
      WHERE user_id = ${userId}
        AND organization_id = ${orgId}
        AND COALESCE(completed_at, requested_at) >= ${from}
        AND COALESCE(completed_at, requested_at) <= ${to}
        AND status NOT IN ('FAILED', 'CANCELLED')
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const ledger: LedgerEntry[] = await listLedger(userId, orgId, from, to);
    const settings: WithholdingSettings | null = await getWithholdingSettings(
      userId,
      orgId
    );
    const currentlyHeldCents = await getWithheldBalance(userId, orgId);

    const num = (v: unknown) => Number(v ?? 0);
    const sum = (rows: any[], key: string) => rows.reduce((s, r) => s + num(r[key]), 0);

    const report = buildEarningsTaxReport({
      from,
      to,
      now,
      grossEarningsCents: sum(earningsRows, 'gross'),
      refundedCents: sum(earningsRows, 'refunded'),
      withdrawnCents: sum(earningsRows, 'withdrawn'),
      entries: ledger,
      settings,
    });

    // Per-period breakdown, merging the earnings and withdrawal buckets.
    const emptyBucket = (key: string) => ({
      period: key,
      grossCents: 0,
      refundedCents: 0,
      pendingCents: 0,
      availableCents: 0,
      withdrawnCents: 0,
      withheldCents: 0,
      releasedCents: 0,
      netWithheldCents: 0,
    });
    const buckets = new Map<string, ReturnType<typeof emptyBucket>>();
    for (const r of earningsRows) {
      const key = String(r.bucket);
      buckets.set(key, {
        ...emptyBucket(key),
        grossCents: num(r.gross),
        refundedCents: num(r.refunded),
        pendingCents: num(r.pending),
        availableCents: num(r.available),
        withdrawnCents: num(r.withdrawn),
      });
    }
    for (const r of withdrawalRows) {
      const key = String(r.bucket);
      if (!buckets.has(key)) buckets.set(key, emptyBucket(key));
      buckets.get(key)!.withdrawnCents = num(r.paid);
    }
    for (const entry of ledger) {
      const key = entry.periodQualified;
      // The ledger stores calendar quarters. On a day/week/month view the
      // quarter key will not match a bucket, and a quarter-wide total must NOT
      // be smeared onto a single day - so it is only merged on an exact match.
      if (!buckets.has(key)) {
        if (period !== 'quarter') continue;
        buckets.set(key, emptyBucket(key));
      }
      const b = buckets.get(key)!;
      if (entry.kind === 'WITHHELD') b.withheldCents += entry.amountCents;
      else if (entry.kind === 'RELEASED') b.releasedCents += entry.amountCents;
    }
    // Floor at zero per bucket, so an over-large release can never render a
    // negative "still held" figure to the seller.
    for (const b of buckets.values()) {
      b.netWithheldCents = Math.max(0, b.withheldCents - b.releasedCents);
    }

    if (url.searchParams.get('format') === 'csv') {
      const header =
        'period,gross_cents,refunded_cents,withheld_cents,released_cents,net_withheld_cents,pending_cents,available_cents,withdrawn_cents';
      const lines = [...buckets.values()].map((b) =>
        [
          b.period,
          b.grossCents,
          b.refundedCents,
          b.withheldCents,
          b.releasedCents,
          b.netWithheldCents,
          b.pendingCents,
          b.availableCents,
          b.withdrawnCents,
        ].join(',')
      );
      // The disclaimer travels with the file, so a forwarded CSV cannot be
      // mistaken for a filed tax return.
      const csv = [
        `# ${DISCLAIMER}`,
        `# range: ${from.toISOString()} .. ${to.toISOString()}`,
        header,
        ...lines,
      ].join('\n');

      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="earnings-tax-report-${period}.csv"`,
          // Seller financial data must never sit in a shared cache.
          'Cache-Control': 'no-store',
        },
      });
    }

    return Response.json({
      period,
      from: from.toISOString(),
      to: to.toISOString(),
      totals: {
        grossCents: report.grossEarningsCents,
        refundedCents: report.refundedCents,
        withheldCents: report.withheldCents,
        releasedCents: report.releasedCents,
        netWithheldCents: report.netWithheldCents,
        withdrawnCents: report.withdrawnCents,
        netReceivedCents: report.netReceivedCents,
        currentlyHeldCents,
      },
      balances: {
        pendingCents: sum(earningsRows, 'pending'),
        availableCents: sum(earningsRows, 'available'),
        withdrawnCents: sum(earningsRows, 'withdrawn'),
      },
      settings: settings ?? { enabled: false, rateBps: 0, jurisdiction: null },
      periods: [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period)),
      ledger,
      disclaimer: DISCLAIMER,
    });
  } catch (error) {
    console.error('GET /api/tax/report error', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
