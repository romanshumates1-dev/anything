'use client';

/**
 * Dashboard data, fetched ONCE.
 *
 * THE MEASUREMENT THIS FIXES (production, 2026-10-03)
 * ---------------------------------------------------
 * `/dashboard` is a client component, so its cost is the SUM OF ITS FETCHES.
 * One dashboard load fired ~17 separate Cloudflare Worker invocations (5 Shell +
 * 2 page + 10 cards, minus the two keys React Query already deduped) and took
 * ~9.4s to settle. `wrangler tail` put each dashboard endpoint at 13-23ms CPU
 * with 150-400ms of wall time, i.e. the wall clock was NOT one slow query — it
 * was seventeen round trips, each paying its own cold start.
 *
 * `GET /api/dashboard/summary` serves all ten card payloads from one invocation.
 * This provider makes exactly that one request, and each card reads its slice
 * from it. Nothing is faked and nothing is dropped: a slice the batch could not
 * produce (it failed, or the batch request itself failed) makes that ONE card
 * fall back to its own endpoint — the previous behaviour — so the worst case is
 * what the dashboard used to do, never a blank page.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DashboardSummaryPayload } from '@/app/api/utils/dashboardSlices';

export const DASHBOARD_SUMMARY_QUERY_KEY = ['dashboard-summary'] as const;

type SliceKey = keyof Omit<DashboardSummaryPayload, 'errors'>;

type SummaryState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; data: DashboardSummaryPayload };

const DashboardSummaryContext = createContext<SummaryState | null>(null);

export function DashboardSummaryProvider({ children }: { children: ReactNode }) {
  const { data, isError, isPending } = useQuery<DashboardSummaryPayload>({
    queryKey: DASHBOARD_SUMMARY_QUERY_KEY,
    queryFn: async () => {
      const res = await fetch('/api/dashboard/summary');
      if (!res.ok) throw new Error(`dashboard summary failed: ${res.status}`);
      return res.json();
    },
    // One retry, not the default three: the cards fall back on failure, so a long
    // retry chain would only delay the fallback while holding the page's data.
    retry: 1,
    staleTime: 30_000,
  });

  const state: SummaryState = isPending
    ? { status: 'loading' }
    : isError
      ? { status: 'failed' }
      : { status: 'ready', data: data ?? {} };

  return (
    <DashboardSummaryContext.Provider value={state}>{children}</DashboardSummaryContext.Provider>
  );
}

/**
 * Reads one slice of the batch.
 *
 * - `awaitingBatch` — the batch is in flight. The caller must NOT fire its own
 *   request, or the fan-out comes straight back.
 * - `fallback` — the batch cannot supply this key, so the caller should run its
 *   own query (a component rendered outside the provider behaves this way).
 */
export function useDashboardSlice<K extends SliceKey>(key: K): {
  data: DashboardSummaryPayload[K] | undefined;
  awaitingBatch: boolean;
  fallback: boolean;
} {
  const state = useContext(DashboardSummaryContext);

  if (state === null || state.status === 'failed') {
    return { data: undefined, awaitingBatch: false, fallback: true };
  }
  if (state.status === 'loading') {
    return { data: undefined, awaitingBatch: true, fallback: false };
  }

  const present = Object.prototype.hasOwnProperty.call(state.data, key);
  return {
    data: present ? (state.data as DashboardSummaryPayload)[key] : undefined,
    awaitingBatch: false,
    fallback: !present,
  };
}
