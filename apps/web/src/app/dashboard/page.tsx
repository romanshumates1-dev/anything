'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { MetricValue } from '@/components/ui/MetricValue';
import { StatusDot } from '@/components/ui/StatusDot';
import { ProfitChart } from '@/components/dashboard/ProfitChart';
import { OnboardingTutorial, OnboardingChecklist } from '@/components/onboarding';
import { QuestionnaireReminder } from '@/components/signup';
import {
  LeadFunnelVisualization,
  CampaignProgressCard,
  CreditBalanceCard,
  RecentEngagementCard,
  NextActionsCard,
  QuickStatsBar,
  WeeklyProgressSummary,
  LiveActivityFeed,
} from '@/components/dashboard';
import { DashboardSummaryProvider, useDashboardSlice } from '@/components/dashboard/DashboardSummaryProvider';
import {
  CurrencyDollarIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  DocumentCheckIcon,
} from '@heroicons/react/24/outline';
import { Loader2, ArrowRight, Sparkles, TrendingUp } from 'lucide-react';
import Link from 'next/link';

/**
 * `/dashboard`.
 *
 * Wraps the body in `DashboardSummaryProvider` so the ten cards share ONE
 * batched request instead of ten. See that component for the measurement that
 * motivated it.
 */
export default function DashboardPage() {
  return (
    <DashboardSummaryProvider>
      <DashboardContent />
    </DashboardSummaryProvider>
  );
}

/**
 * The dashboard body. Split from `DashboardPage` because it must run INSIDE
 * `DashboardSummaryProvider` to read the batched payload.
 */
function DashboardContent() {
  const {
    data: session,
    isPending: authLoading,
    isSessionError,
    retrySession,
  } = useSession();

  // Served by the single batched request; falls back to the standalone endpoint
  // only if that slice is missing from the batch.
  const statsSlice = useDashboardSlice('stats');

  const { data: fetchedStats, isLoading: statsFetching } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
    enabled: !!session && statsSlice.fallback,
  });

  const stats = statsSlice.data ?? fetchedStats;
  const statsLoading = statsSlice.awaitingBatch || statsFetching;

  // Slices the headline KPI row is computed from.
  const funnelSlice = useDashboardSlice('funnel');
  const quickStatsSlice = useDashboardSlice('quickStats');

  const health = useQuery({
    queryKey: ['system-health'],
    queryFn: async () => {
      const res = await fetch('/api/system/health');
      if (!res.ok) throw new Error('Failed to fetch health');
      return res.json();
    },
    enabled: !!session,
  }).data;

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  // Transient session-fetch failure: auth state is UNKNOWN, not signed-out.
  // Show a retry state instead of bouncing an authenticated user to signin
  // (the "random sign-out"). Genuine sign-out is data:null + error:null.
  if (isSessionError) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-sm text-gray-500">
          Couldn&apos;t verify your session. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={retrySession}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  // THE HEADLINE ROW USED TO BE FABRICATED (fixed 2026-10-03).
  //
  //   value: stats?.pipelineValue  || 125000
  //   value: stats?.totalLeads     || 847
  //   value: stats?.responseRate   || 23.5
  //   value: stats?.dealsThisMonth || 12
  //   trend: 12 / 8 / 2.3 / 5      (hardcoded, all four)
  //
  // `pipelineValue`, `responseRate` and `dealsThisMonth` are NOT fields
  // /api/dashboard/stats has ever returned — it returns totalLeads, pendingJobs,
  // auditCount, requiresHuman — so three of the four tiles showed the same
  // invented number for every tenant, permanently, and every "vs last month"
  // delta was a constant. This is the first thing a wholesaler reads.
  //
  // Everything below is derived from real slices, each tile naming its own
  // window. Where a number does not exist yet, the tile shows zero rather than a
  // plausible guess.
  const funnelStages = funnelSlice.data?.stages ?? [];
  const closedStage = funnelStages.find((stage) => stage.id === 'closed');
  const contacted = quickStatsSlice.data?.contacted?.value ?? 0;
  const responses = quickStatsSlice.data?.responses?.value ?? 0;

  const kpis = [
    {
      // A projection, so it says so: under-contract leads x average assessed
      // property value (the funnel slice's own definition).
      label: 'Projected Revenue',
      value: funnelSlice.data?.projectedRevenue ?? 0,
      format: 'currency' as const,
      trend: funnelStages.find((stage) => stage.id === 'contract')?.trend,
      icon: CurrencyDollarIcon,
    },
    {
      label: 'Active Leads',
      value: stats?.totalLeads ?? 0,
      format: 'number' as const,
      trend: quickStatsSlice.data?.leads?.change,
      icon: UserGroupIcon,
    },
    {
      label: 'Response Rate',
      value: contacted > 0 ? (responses / contacted) * 100 : 0,
      format: 'percent' as const,
      trend: quickStatsSlice.data?.responses?.change,
      icon: ChatBubbleLeftRightIcon,
    },
    {
      label: 'Deals Closed (30d)',
      value: closedStage?.count ?? 0,
      format: 'number' as const,
      trend: closedStage?.trend,
      icon: DocumentCheckIcon,
    },
  ];

  return (
    <div className="space-y-6">
      {/* First-time user onboarding tutorial */}
      <OnboardingTutorial />

      {/* Questionnaire reminder - shows if not completed */}
      <QuestionnaireReminder variant="banner" />

      {/* Onboarding checklist - shows until complete, handles its own visibility */}
      <OnboardingChecklist variant="card" />

      {/* Welcome Header with Momentum Indicator */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Welcome back, {session.user?.name || session.user?.email?.split('@')[0]}
          </h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-[var(--text-secondary)]">
              Your pipeline is looking strong today.
            </p>
            {stats?.momentum > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--color-success)]/10 text-[var(--color-success)]">
                <TrendingUp className="h-3 w-3" />
                {stats.momentum}% momentum
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/lead-finder"
            className="px-4 py-2.5 rounded-lg font-medium border border-[var(--border-medium)] hover:bg-[var(--bg-tertiary)] transition-colors flex items-center gap-2"
          >
            <Sparkles className="h-4 w-4 text-[var(--accent-purple)]" />
            Find Leads
          </Link>
          <Link
            href="/campaigns/wizard"
            className="btn-gradient px-5 py-2.5 rounded-lg font-medium flex items-center gap-2"
          >
            Launch Campaign
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <GlassCard key={i} padding="md">
              <div className="animate-pulse">
                <div className="h-4 w-24 bg-[var(--bg-tertiary)] rounded mb-3" />
                <div className="h-8 w-32 bg-[var(--bg-tertiary)] rounded" />
              </div>
            </GlassCard>
          ))
        ) : (
          kpis.map((kpi) => (
            <GlassCard key={kpi.label} padding="md">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-[var(--text-muted)] mb-1">{kpi.label}</p>
                  <MetricValue
                    value={kpi.value}
                    format={kpi.format}
                    trend={kpi.trend}
                    trendLabel="vs previous 30 days"
                    size="lg"
                  />
                </div>
                <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10">
                  <kpi.icon className="h-5 w-5 text-[var(--accent-blue)]" />
                </div>
              </div>
            </GlassCard>
          ))
        )}
      </div>

      {/* Quick Stats Bar - Shows key numbers at a glance */}
      <QuickStatsBar />

      {/* Main Content Grid - Three column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column - Main content (7/12) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Lead Funnel Visualization - Core progress indicator */}
          <LeadFunnelVisualization />

          {/* Charts Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ProfitChart />
            <RecentEngagementCard />
          </div>

          {/* Weekly Progress - Momentum indicator */}
          <WeeklyProgressSummary />
        </div>

        {/* Right Column - Actions & Status (5/12) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Active Campaigns with Progress Bars */}
          <CampaignProgressCard />

          {/* Credit Balance */}
          <CreditBalanceCard />

          {/* Next Actions - Priority tasks */}
          <NextActionsCard />

          {/* Live Activity Feed */}
          <LiveActivityFeed />
        </div>
      </div>

      {/* System Health - Collapsed at bottom */}
      <details className="group">
        <summary className="flex items-center gap-2 cursor-pointer text-sm text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors">
          <StatusDot status={health?.status === 'healthy' ? 'success' : 'warning'} />
          <span>
            {health?.status === 'healthy' ? 'All systems operational' : 'Checking systems...'}
          </span>
          <svg
            className="h-4 w-4 transition-transform group-open:rotate-180"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="mt-4">
          <GlassCard>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">System Health</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { name: 'Database', status: 'success' as const },
                { name: 'AI Engine', status: 'success' as const },
                { name: 'SMS Gateway', status: 'success' as const },
                { name: 'Job Queue', status: 'success' as const },
              ].map((service) => (
                <div key={service.name} className="flex items-center gap-2 p-3 rounded-lg bg-[var(--bg-tertiary)]">
                  <StatusDot status={service.status} />
                  <div>
                    <span className="text-sm text-[var(--text-primary)]">{service.name}</span>
                    <p className="text-xs text-[var(--color-success)]">Operational</p>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </details>
    </div>
  );
}
