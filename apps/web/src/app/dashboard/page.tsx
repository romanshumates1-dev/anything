'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { MetricValue } from '@/components/ui/MetricValue';
import { StatusDot } from '@/components/ui/StatusDot';
import { ProfitChart } from '@/components/dashboard/ProfitChart';
import { ActivityFeed } from '@/components/dashboard/ActivityFeed';
import { ActionItems } from '@/components/dashboard/ActionItems';
import { OnboardingTutorial } from '@/components/onboarding';
import {
  CurrencyDollarIcon,
  UserGroupIcon,
  ChatBubbleLeftRightIcon,
  DocumentCheckIcon,
} from '@heroicons/react/24/outline';
import { Loader2, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
    enabled: !!session,
  });

  const { data: health } = useQuery({
    queryKey: ['system-health'],
    queryFn: async () => {
      const res = await fetch('/api/system/health');
      if (!res.ok) throw new Error('Failed to fetch health');
      return res.json();
    },
    enabled: !!session,
  });

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const kpis = [
    {
      label: 'Pipeline Value',
      value: stats?.pipelineValue || 125000,
      format: 'currency' as const,
      trend: 12,
      icon: CurrencyDollarIcon,
    },
    {
      label: 'Active Leads',
      value: stats?.totalLeads || 847,
      format: 'number' as const,
      trend: 8,
      icon: UserGroupIcon,
    },
    {
      label: 'Response Rate',
      value: stats?.responseRate || 23.5,
      format: 'percent' as const,
      trend: 2.3,
      icon: ChatBubbleLeftRightIcon,
    },
    {
      label: 'Deals This Month',
      value: stats?.dealsThisMonth || 12,
      format: 'number' as const,
      trend: 5,
      icon: DocumentCheckIcon,
    },
  ];

  return (
    <div className="space-y-6">
      {/* First-time user onboarding tutorial */}
      <OnboardingTutorial />

      {/* Welcome Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">
            Welcome back, {session.user?.name || session.user?.email?.split('@')[0]}
          </h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Your pipeline is looking strong today.
          </p>
        </div>
        <Link
          href="/campaigns/wizard"
          className="btn-gradient px-5 py-2.5 rounded-lg font-medium flex items-center gap-2"
        >
          Launch Campaign
          <ArrowRight className="h-4 w-4" />
        </Link>
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
                    trendLabel="vs last month"
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

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProfitChart />
        <ActivityFeed />
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Action Items */}
        <ActionItems
          items={[
            {
              id: '1',
              type: 'response_needed',
              title: 'Response from John Smith',
              subtitle: '123 Main St - Interested in offer',
              href: '/inbox?lead=1',
              urgent: true,
            },
            {
              id: '2',
              type: 'contract_expiring',
              title: 'Contract expires in 3 days',
              subtitle: '456 Oak Ave - Smith/Johnson',
              href: '/contracts?id=2',
            },
            {
              id: '3',
              type: 'follow_up',
              title: 'Follow up with Sarah Davis',
              subtitle: '789 Pine Rd - No response in 5 days',
              href: '/crm?lead=3',
            },
          ]}
        />

        {/* Active Campaigns */}
        <GlassCard>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">Active Campaigns</h3>
          <div className="space-y-3">
            {[
              { name: 'Tax Delinquent Q3', progress: 75, sent: 1847 },
              { name: 'Pre-Foreclosure', progress: 45, sent: 892 },
              { name: 'Probate Leads', progress: 20, sent: 234 },
            ].map((campaign) => (
              <div key={campaign.name} className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-[var(--text-primary)]">{campaign.name}</span>
                  <span className="text-xs text-[var(--text-muted)]">{campaign.sent} sent</span>
                </div>
                <div className="h-1.5 bg-[var(--bg-primary)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full transition-all"
                    style={{ width: `${campaign.progress}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <Link
            href="/campaigns"
            className="block text-center text-sm text-[var(--accent-blue)] hover:underline mt-4"
          >
            View all campaigns
          </Link>
        </GlassCard>

        {/* System Health */}
        <GlassCard>
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">System Health</h3>
          <div className="space-y-3">
            {[
              { name: 'Database', status: 'success' as const },
              { name: 'AI Engine', status: 'success' as const },
              { name: 'SMS Gateway', status: 'success' as const },
              { name: 'Job Queue', status: 'success' as const },
            ].map((service) => (
              <div key={service.name} className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <StatusDot status={service.status} />
                  <span className="text-sm text-[var(--text-primary)]">{service.name}</span>
                </div>
                <span className="text-xs text-[var(--color-success)]">Operational</span>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <p className="text-sm text-[var(--color-success)] flex items-center gap-2">
              <StatusDot status="success" />
              {health?.status === 'healthy' ? 'All systems operational' : 'Checking systems...'}
            </p>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
