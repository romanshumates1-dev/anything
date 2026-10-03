/**
 * @vitest-environment jsdom
 *
 * The dashboard must cost ONE Worker invocation for its data, not ten.
 *
 * MEASURED IN PRODUCTION (2026-10-03, `wrangler tail` on the deployed Worker):
 * one `/dashboard` load fired ~17 Worker invocations — 5 from the Shell, 2 from
 * the page, 10 from the cards — and the page took ~9.4s to settle. The
 * per-endpoint CPU was tiny (13-23ms for every dashboard slice), so the cost was
 * never a slow query: it was the NUMBER OF ROUND TRIPS, each paying its own cold
 * start. On Workers every invocation also gets its own fixed CPU budget, which is
 * what turns a wide fan-out into 503s under load.
 *
 * `GET /api/dashboard/summary` serves all of those payloads from one invocation.
 * These tests are the regression guard for that:
 *   1. all the cards together make exactly ONE request;
 *   2. the cards show the batch's real values (the batch is actually consumed,
 *      not merely requested);
 *   3. a slice the batch could not produce falls back to its own endpoint
 *      without dragging the other cards back to per-endpoint fetching;
 *   4. a failing endpoint renders a failure, never the hardcoded sample numbers
 *      that used to stand in for an error.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardSummaryProvider } from '@/components/dashboard/DashboardSummaryProvider';
import { QuickStatsBar } from '@/components/dashboard/QuickStatsBar';
import { LeadFunnelVisualization } from '@/components/dashboard/LeadFunnelVisualization';
import { NextActionsCard } from '@/components/dashboard/NextActionsCard';
import { CampaignProgressCard } from '@/components/dashboard/CampaignProgressCard';
import { CreditBalanceCard } from '@/components/dashboard/CreditBalanceCard';
import { RecentEngagementCard } from '@/components/dashboard/RecentEngagementCard';
import { WeeklyProgressSummary } from '@/components/dashboard/WeeklyProgressSummary';
import { LiveActivityFeed } from '@/components/dashboard/LiveActivityFeed';
import { PipelineStatusCard } from '@/components/dashboard/PipelineStatusCard';
import { PipelineFlowVisualization } from '@/components/dashboard/PipelineFlowVisualization';

// next/link needs a router that does not exist in a unit test; an anchor is
// enough for these assertions.
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href?: string }) => (
    <a href={href ?? '#'}>{children}</a>
  ),
}));

const NOW = '2026-10-03T12:00:00.000Z';

const SUMMARY = {
  stats: { totalLeads: 42, pendingJobs: 3, auditCount: 9, requiresHuman: 1 },
  campaigns: [
    {
      id: 'c1',
      name: 'Tax Delinquent Q3',
      status: 'active',
      member_count: 100,
      sent_count: 40,
      created_at: NOW,
    },
  ],
  credits: {
    balance: 1234,
    lifetimePurchased: 5000,
    lifetimeUsed: 3766,
    tier: 'pro',
    costs: { SMS_SEND: 5, EMAIL_SEND: 1, AI_CLASSIFY: 2 },
    transactions: [],
  },
  funnel: {
    stages: [
      { id: 'leads', count: 42, trend: 5 },
      { id: 'contacted', count: 30, trend: 3 },
      { id: 'responded', count: 12, trend: 1 },
      { id: 'negotiating', count: 6, trend: 0 },
      { id: 'contract', count: 3, trend: 0 },
      { id: 'closed', count: 1, trend: 0 },
    ],
    avgDealValue: 90000,
    projectedRevenue: 270000,
    period: '30d',
  },
  activity: {
    activities: [
      {
        id: 'a1',
        type: 'deal_closed',
        title: 'Deal closed',
        description: '9 Elm St',
        timestamp: NOW,
      },
    ],
  },
  nextActions: {
    actions: [
      {
        id: 'n1',
        type: 'urgent',
        title: 'Real hot lead from the batch',
        description: '9 Elm St - responded 5m ago',
        dueIn: 'Now',
        href: '/crm?lead=42',
        priority: 'high',
      },
    ],
  },
  quickStats: {
    leads: { value: 42, change: 5 },
    contacted: { value: 30, change: -2 },
    responses: { value: 12, change: 1 },
    deals: { value: 1, change: 0 },
  },
  engagements: {
    engagements: [
      {
        id: 'e1',
        leadId: '42',
        leadName: 'Batch Lead',
        propertyAddress: '9 Elm St',
        type: 'hot_lead',
        timestamp: NOW,
      },
    ],
  },
  weeklyProgress: {
    leadsContacted: 7,
    leadsContactedLastWeek: 3,
    responsesReceived: 2,
    responsesLastWeek: 1,
    dealsInProgress: 1,
    dealsLastWeek: 0,
    dealsClosed: 1,
    dealsClosedLastWeek: 0,
    streak: 2,
    milestone: null,
  },
  pipeline: {
    status: {
      isRunning: false,
      pendingActions: [],
      stageHealth: [{ stage: 'outreach', status: 'healthy', errorRate: 0 }],
    },
  },
};

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
}

function renderDashboard(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <DashboardSummaryProvider>
        <QuickStatsBar />
        <LeadFunnelVisualization />
        <NextActionsCard />
        <CampaignProgressCard />
        <CreditBalanceCard />
        <RecentEngagementCard />
        <WeeklyProgressSummary />
        <LiveActivityFeed />
        <PipelineStatusCard />
        <PipelineFlowVisualization />
      </DashboardSummaryProvider>
    </QueryClientProvider>
  );
}

function apiCalls(fetchMock: ReturnType<typeof vi.fn>, matcher?: string) {
  const calls = fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/'));
  return matcher ? calls.filter((call) => String(call[0]).includes(matcher)) : calls;
}

/** Lets any extra, non-deduped request appear before we count. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 300));
}

describe('dashboard data comes from one batched request', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('makes exactly ONE request for every card on the page', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => SUMMARY });
    vi.stubGlobal('fetch', fetchMock);

    renderDashboard(makeClient());

    await waitFor(() => expect(apiCalls(fetchMock, '/api/dashboard/summary').length).toBe(1));
    await settle();

    const calls = apiCalls(fetchMock);
    expect(calls.length, `requests made: ${calls.map((c) => String(c[0])).join(', ')}`).toBe(1);
  });

  it('renders values from the batch, not from per-endpoint fetches', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => SUMMARY });
    vi.stubGlobal('fetch', fetchMock);

    renderDashboard(makeClient());

    // One card per slice, each showing a value that only exists in SUMMARY.
    await waitFor(() => expect(screen.getByText(/real hot lead from the batch/i)).toBeTruthy());
    expect(screen.getByText('Tax Delinquent Q3')).toBeTruthy();
    expect(screen.getByText('Batch Lead')).toBeTruthy();
    expect(screen.getByText(/deal closed/i)).toBeTruthy();

    // The funnel stage count is 42 — only the batch knows that.
    expect(screen.getAllByText('42').length).toBeGreaterThan(0);
  });

  it('falls back per card when the batch omits a slice', async () => {
    const { funnel: _omitted, ...partial } = SUMMARY;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/dashboard/summary')) {
        return { ok: true, json: async () => partial };
      }
      if (String(url).includes('/api/dashboard/funnel')) {
        return { ok: true, json: async () => SUMMARY.funnel };
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderDashboard(makeClient());

    // The missing slice is fetched on its own...
    await waitFor(() => expect(apiCalls(fetchMock, '/api/dashboard/funnel').length).toBe(1));
    // ...and the rest of the cards are still served by the single batch.
    await settle();
    expect(apiCalls(fetchMock).length).toBe(2);
    // The campaign name appears in more than one place on the card.
    expect(screen.getAllByText('Tax Delinquent Q3').length).toBeGreaterThan(0);
  });

  it('falls back for every card when the batch itself fails', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/dashboard/summary')) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      if (String(url).includes('/api/campaigns')) {
        return { ok: true, json: async () => SUMMARY.campaigns };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderDashboard(makeClient());

    // Degradation, not a blank page: the cards fetch their own data. The wait is
    // long because the batch retries once (retry: 1) before the provider reports
    // 'failed' and the cards are released to fetch on their own.
    await waitFor(() => expect(apiCalls(fetchMock, '/api/campaigns').length).toBe(1), {
      timeout: 6000,
    });
    await settle();
    expect(screen.getAllByText('Tax Delinquent Q3').length).toBeGreaterThan(0);
  });

  it('never renders the hardcoded sample numbers that used to stand in for an error', async () => {
    const { quickStats: _omitted, ...partial } = SUMMARY;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/dashboard/summary')) {
        return { ok: true, json: async () => partial };
      }
      return { ok: false, status: 500, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderDashboard(makeClient());

    await waitFor(() => expect(apiCalls(fetchMock, '/api/dashboard/quick-stats').length).toBe(1), {
      timeout: 6000,
    });
    await settle();

    // The card still renders (it is not an error page)...
    // ('Total Leads' is also a funnel stage label, hence getAllByText.)
    expect(screen.getAllByText('Total Leads').length).toBeGreaterThan(0);
    // ...but the fabricated fallback values are gone.
    expect(screen.queryByText('847')).toBeNull();
    expect(screen.queryByText('623')).toBeNull();
  });
});
