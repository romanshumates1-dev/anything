'use client';

import { GlassCard } from '@/components/ui/GlassCard';
import { BarChart3 } from 'lucide-react';

/**
 * ProfitChart — Monthly P&L.
 *
 * DEFECT FIXED (2026-10-03): this component rendered a HARDCODED series —
 * Jan..Aug, profit climbing $12,000 -> $45,000, spend $3,200 -> $9,500, "Net this
 * month +$36,500". None of it came from the database. It was not a chart of this
 * tenant's business, or anyone's: it was a shape that always looked healthy, and
 * it was the single most misleading element on the dashboard because P&L figures
 * are the numbers a wholesaler makes decisions on.
 *
 * WHY IT IS EMPTY RATHER THAN ESTIMATED
 * -------------------------------------
 * A monthly P&L needs two real series for THIS org:
 *   - spend  — credits actually consumed (the credit ledger has the amounts)
 *   - revenue — assignment fees actually earned (the earnings ledger has them)
 * Deriving those correctly — which events count as revenue, refunds, fee splits,
 * and the month boundary — is real work, not a chart tweak. Until it exists,
 * inventing the series is the one option that must not ship: a plausible number
 * is worse than a gap, because a gap gets fixed and a plausible number gets
 * believed.
 *
 * So the card states the gap. It keeps its place in the layout (a missing card
 * shifts every other panel and hides the work), and it names what is missing.
 *
 * TO WIRE REAL DATA: add a `pnl` slice to `utils/dashboardSlices.ts` returning
 * `Array<{ month: string; profit: number; spend: number }>` (org-scoped, built
 * from the credit and earnings ledgers), read it with `useDashboardSlice('pnl')`
 * like every other card, and render the recharts area chart only when the array
 * is non-empty.
 */
export function ProfitChart() {
  return (
    <GlassCard className="h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Monthly P&amp;L</h3>
      </div>

      <div
        data-testid="profit-chart-empty"
        className="h-64 flex flex-col items-center justify-center text-center px-4 border-t border-[var(--border-subtle)]"
      >
        <div className="p-3 rounded-full bg-[var(--bg-tertiary)] inline-flex mb-3">
          <BarChart3 className="h-6 w-6 text-[var(--text-muted)]" />
        </div>
        <p className="text-sm text-[var(--text-secondary)]">No monthly P&amp;L yet</p>
        <p className="text-xs text-[var(--text-muted)] mt-1 max-w-xs">
          Profit and spend are only shown once they are summed from this
          organization&apos;s own credit and earnings ledgers. No figures are
          estimated.
        </p>
      </div>
    </GlassCard>
  );
}
