/**
 * @vitest-environment jsdom
 *
 * The dashboard must not fetch the pipeline status twice.
 *
 * DEFECT (measured 2026-10-03)
 * --------------------------
 * `PipelineFlowVisualization` and `PipelineStatusCard` both render on
 * `/dashboard` and both requested `GET /api/pipeline?include_config=false`, but
 * under different React Query keys (`pipeline-flow` vs `pipeline-status`). Query
 * dedupe is key-based, so both requests always went out: two identical Worker
 * invocations for one payload, repeated every 60s on any open dashboard. On
 * Workers each invocation carries its own CPU budget, so a guaranteed duplicate
 * is a real cost, not a cosmetic round trip.
 *
 * This test renders BOTH components against one QueryClient and asserts exactly
 * one request is made. It is the regression guard: reintroducing a second query
 * key in either component fails here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PipelineStatusCard } from '@/components/dashboard/PipelineStatusCard';
import { PipelineFlowVisualization } from '@/components/dashboard/PipelineFlowVisualization';

const PAYLOAD = {
  status: {
    isRunning: false,
    pendingActions: [],
    stageHealth: [{ stage: 'outreach', status: 'healthy', errorRate: 0 }],
    lastRun: {
      stats: {
        leadIngestion: { processed: 3, errors: 0 },
        outreach: { sent: 2, deferred: 0, suppressed: 0 },
        responses: { classified: 1, escalated: 0 },
        negotiations: { advanced: 0, walkAway: 0 },
        contracts: { generated: 0, sent: 0 },
        closings: { completed: 0 },
      },
    },
  },
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function renderBoth(ui: React.ReactElement, client: QueryClient) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('pipeline status is fetched once for two components', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders both components with exactly ONE network request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => PAYLOAD,
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = makeClient();
    renderBoth(
      <>
        <PipelineStatusCard />
        <PipelineFlowVisualization />
      </>,
      client
    );

    // Wait for the shared query to settle before counting.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 5000 });
    // Let any second, non-deduped request have a chance to appear.
    await new Promise((r) => setTimeout(r, 250));

    const pipelineCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/pipeline')
    );
    expect(
      pipelineCalls.length,
      `expected 1 pipeline request, saw ${pipelineCalls.length}`
    ).toBe(1);

    // Both components must actually have rendered, otherwise this proves nothing.
    await waitFor(() => {
      expect(screen.getAllByText(/outreach/i).length).toBeGreaterThan(0);
    });
  });

  it('still surfaces data to both components (dedupe did not starve one)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => PAYLOAD });
    vi.stubGlobal('fetch', fetchMock);

    const client = makeClient();
    renderBoth(
      <>
        <PipelineStatusCard />
        <PipelineFlowVisualization />
      </>,
      client
    );

    await waitFor(() => {
      expect(screen.getAllByText(/outreach/i).length).toBeGreaterThan(0);
    });
    // PipelineFlowVisualization renders the stage names for its flow diagram.
    expect(screen.getAllByText(/Lead Ingestion/i).length).toBeGreaterThan(0);
  });
});
