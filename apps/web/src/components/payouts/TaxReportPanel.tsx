'use client';

/**
 * TaxReportPanel
 *
 * Seller earnings + withholding report surface (requirements #16-#17).
 * Talks ONLY to GET /api/tax/report, which is tenant-scoped server-side;
 * this component never computes money totals itself beyond displaying what
 * the API returns, so a UI bug can never misstate a financial figure.
 *
 * Period granularity (day | week | month | quarter | year) is passed through
 * to the server, which buckets in SQL via date_trunc. An in-flight request is
 * aborted when the user switches period, so a slow older response can never
 * overwrite a newer selection (stale-response race).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, Download, AlertTriangle, FileText } from 'lucide-react';

export type TaxReportPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year';

const PERIODS: ReadonlyArray<{ value: TaxReportPeriod; label: string }> = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
];

export interface TaxReportPeriodBucket {
  period: string;
  grossCents: number;
  refundedCents: number;
  pendingCents: number;
  availableCents: number;
  withdrawnCents: number;
  withheldCents: number;
  releasedCents: number;
  netWithheldCents: number;
}

export interface TaxReport {
  period: TaxReportPeriod;
  from: string;
  to: string;
  totals: {
    grossCents: number;
    refundedCents: number;
    withheldCents: number;
    releasedCents: number;
    netWithheldCents: number;
    withdrawnCents: number;
    netReceivedCents: number;
    currentlyHeldCents: number;
  };
  balances: {
    pendingCents: number;
    availableCents: number;
    withdrawnCents: number;
  };
  settings: {
    enabled: boolean;
    rateBps: number;
    jurisdiction: string | null;
  };
  periods: TaxReportPeriodBucket[];
  disclaimer: string;
}

interface TaxReportPanelProps {
  /**
   * Injectable fetch for tests. Must behave like window.fetch for the one
   * URL it is given. Defaults to global fetch.
   */
  fetcher?: typeof fetch;
}

function formatCents(cents: number): string {
  const n = Number(cents) || 0;
  return (n / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  });
}

function csvHref(period: TaxReportPeriod): string {
  return `/api/tax/report?period=${period}&format=csv`;
}

export function TaxReportPanel({ fetcher }: TaxReportPanelProps) {
  const [period, setPeriod] = useState<TaxReportPeriod>('quarter');
  const [report, setReport] = useState<TaxReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Aborts the previous in-flight request whenever period changes, so only
  // the latest selection can ever land in state.
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (target: TaxReportPeriod, signal: AbortSignal) => {
      setLoading(true);
      setError(null);
      try {
        const doFetch = fetcher ?? fetch;
        const response = await doFetch(`/api/tax/report?period=${target}`, {
          signal,
        });
        if (!response.ok) {
          throw new Error(`Report request failed (${response.status})`);
        }
        const data = (await response.json()) as TaxReport;
        if (signal.aborted) return;
        setReport(data);
      } catch (err) {
        if (signal.aborted) return;
        setReport(null);
        setError(err instanceof Error ? err.message : 'Failed to load report');
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [fetcher]
  );

  useEffect(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    void load(period, controller.signal);
    return () => controller.abort();
  }, [period, load]);

  const totals = report?.totals;
  const ratePercent = report
    ? (report.settings.rateBps / 100).toFixed(2)
    : '0.00';

  return (
    <GlassCard variant="bordered" padding="none" data-testid="tax-report-panel">
      <div className="p-4 sm:p-6 border-b border-[var(--border-subtle)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-[var(--text-muted)]" />
            <div>
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                Tax &amp; Earnings Report
              </h2>
              <p className="text-xs text-[var(--text-muted)]">
                {report
                  ? `${new Date(report.from).toLocaleDateString()} – ${new Date(
                      report.to
                    ).toLocaleDateString()}`
                  : 'Loading period…'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div
              role="group"
              aria-label="Report period"
              className="flex rounded-md border border-[var(--border-subtle)] overflow-hidden"
            >
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  aria-pressed={period === p.value}
                  onClick={() => setPeriod(p.value)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                    period === p.value
                      ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <a
              href={csvHref(period)}
              download
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </a>
          </div>
        </div>
      </div>

      {loading && !report && (
        <div className="p-8 flex items-center justify-center gap-2 text-[var(--text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="text-sm">Loading report…</span>
        </div>
      )}

      {error && (
        <div className="p-6 flex flex-col items-start gap-3">
          <div className="flex items-center gap-2 text-red-400">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">{error}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              abortRef.current?.abort();
              const controller = new AbortController();
              abortRef.current = controller;
              void load(period, controller.signal);
            }}
          >
            Retry
          </Button>
        </div>
      )}


      {report && !error && (
        <>
          {/* Totals */}
          <div className="p-4 sm:p-6 grid grid-cols-2 md:grid-cols-4 gap-4 border-b border-[var(--border-subtle)]">
            <div>
              <p className="text-xs text-[var(--text-muted)]">Gross earnings</p>
              <p className="text-lg font-semibold font-mono text-[var(--text-primary)]">
                {formatCents(totals?.grossCents ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">Withdrawn</p>
              <p className="text-lg font-semibold font-mono text-[var(--text-primary)]">
                {formatCents(totals?.withdrawnCents ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">
                Net received (after withholding)
              </p>
              <p className="text-lg font-semibold font-mono text-[var(--text-primary)]">
                {formatCents(totals?.netReceivedCents ?? 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--text-muted)]">
                Tax currently held
              </p>
              <p className="text-lg font-semibold font-mono text-amber-400">
                {formatCents(totals?.currentlyHeldCents ?? 0)}
              </p>
            </div>
          </div>

          {/* Settings strip */}
          <div className="px-4 sm:px-6 py-3 border-b border-[var(--border-subtle)] flex items-center gap-3 flex-wrap">
            <Badge
              className={
                report.settings.enabled
                  ? 'border border-amber-500/30 bg-amber-500/10 text-amber-400'
                  : 'border border-[var(--border-subtle)] text-[var(--text-muted)]'
              }
            >
              {report.settings.enabled
                ? `Withholding ON · ${ratePercent}%`
                : 'Withholding OFF'}
            </Badge>
            {report.settings.jurisdiction && (
              <span className="text-xs text-[var(--text-muted)]">
                Jurisdiction: {report.settings.jurisdiction}
              </span>
            )}
            <span className="text-xs text-[var(--text-muted)]">
              Withheld {formatCents(totals?.withheldCents ?? 0)} · Released{' '}
              {formatCents(totals?.releasedCents ?? 0)}
            </span>
          </div>

          {/* Per-period breakdown */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-[var(--border-subtle)] hover:bg-transparent">
                  <TableHead className="text-[var(--text-secondary)] font-medium">
                    Period
                  </TableHead>
                  <TableHead className="text-[var(--text-secondary)] font-medium">
                    Gross
                  </TableHead>
                  <TableHead className="text-[var(--text-secondary)] font-medium">
                    Refunded
                  </TableHead>
                  <TableHead className="text-[var(--text-secondary)] font-medium">
                    Withheld
                  </TableHead>
                  <TableHead className="text-[var(--text-secondary)] font-medium">
                    Released
                  </TableHead>
                  <TableHead className="text-[var(--text-secondary)] font-medium">
                    Still held
                  </TableHead>
                  <TableHead className="text-[var(--text-secondary)] font-medium">
                    Withdrawn
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.periods.length === 0 ? (
                  <TableRow className="border-[var(--border-subtle)] hover:bg-transparent">
                    <TableCell
                      colSpan={7}
                      className="text-center text-sm text-[var(--text-muted)] py-8"
                    >
                      No activity in this period
                    </TableCell>
                  </TableRow>
                ) : (
                  report.periods.map((bucket) => (
                    <TableRow
                      key={bucket.period}
                      className="border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                    >
                      <TableCell className="font-mono text-sm text-[var(--text-primary)]">
                        {bucket.period}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-[var(--text-primary)]">
                        {formatCents(bucket.grossCents)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-[var(--text-muted)]">
                        {formatCents(bucket.refundedCents)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-amber-400">
                        {formatCents(bucket.withheldCents)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-[var(--text-muted)]">
                        {formatCents(bucket.releasedCents)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-amber-400">
                        {formatCents(bucket.netWithheldCents)}
                      </TableCell>
                      <TableCell className="font-mono text-sm text-[var(--text-primary)]">
                        {formatCents(bucket.withdrawnCents)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Disclaimer travels with every rendered report. */}
          <p className="px-4 sm:px-6 py-4 text-xs text-[var(--text-muted)] border-t border-[var(--border-subtle)]">
            {report.disclaimer}
          </p>
        </>
      )}
    </GlassCard>
  );
}


