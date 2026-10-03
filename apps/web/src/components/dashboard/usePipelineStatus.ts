import { useQuery } from '@tanstack/react-query';
import { useDashboardSlice } from './DashboardSummaryProvider';

/**
 * Shared, DEDUPED pipeline-status fetch.
 *
 * WHY THIS EXISTS (defect: duplicated Worker invocations)
 * ------------------------------------------------------
 * `PipelineFlowVisualization` and `PipelineStatusCard` both render on the
 * dashboard and both fetched the SAME url:
 *
 *     GET /api/pipeline?include_config=false
 *
 * but under DIFFERENT query keys (`pipeline-flow` and `pipeline-status`). React
 * Query dedupes on the key, so the key mismatch meant both requests always went
 * out: two identical Worker invocations, each with its own per-invocation CPU
 * budget, for one piece of data. Both also polled every 60s independently, so
 * the duplication repeated forever on any open dashboard.
 *
 * On Cloudflare Workers every API call is a separate billed invocation against a
 * fixed CPU budget, so a duplicate is not a harmless extra round trip — it is a
 * second chance to exhaust the budget. The dashboard's overall fan-out is what
 * drives its render time and its 503 rate, so removing a guaranteed duplicate is
 * a real saving with no change in user-visible behaviour.
 *
 * One key, one fetcher, one request. `PipelineStatus` is exported because the
 * two components project different shapes out of the same response.
 */

/** The raw `status` object as the API returns it. Minimal on purpose: each
 * consuming component projects its own richer view out of this same payload,
 * and casting here keeps their existing local types authoritative. */
export interface PipelineStatusPayload {
  lastRun?: { stats?: unknown } | null;
  stageHealth?: unknown[];
  [key: string]: unknown;
}

/** Single shared key. Both components MUST use this, or dedupe is lost again. */
export const PIPELINE_STATUS_QUERY_KEY = ['pipeline-status'] as const;

export function usePipelineStatus() {
  // The batched dashboard request also carries pipeline status, so this hook
  // spends an extra Worker invocation only when that slice is unavailable.
  const slice = useDashboardSlice('pipeline');

  const query = useQuery({
    queryKey: PIPELINE_STATUS_QUERY_KEY,
    queryFn: async (): Promise<PipelineStatusPayload> => {
      const res = await fetch('/api/pipeline?include_config=false');
      if (!res.ok) throw new Error('Failed to fetch pipeline status');
      const json = await res.json();
      return (json.status ?? null) as PipelineStatusPayload;
    },
    // Kept at the existing 60s cadence so freshness is unchanged; only the
    // duplication is removed.
    refetchInterval: 60000,
    // A background refetch on tab focus competes with the route's own fan-out
    // for the same CPU budget, which is one of the ways this page goes over it.
    refetchOnWindowFocus: false,
    enabled: slice.fallback,
  });

  const batched = (slice.data as { status?: PipelineStatusPayload } | undefined)?.status;

  return {
    ...query,
    data: slice.awaitingBatch ? query.data : (batched ?? query.data),
    isLoading: slice.awaitingBatch || query.isLoading,
  };
}
