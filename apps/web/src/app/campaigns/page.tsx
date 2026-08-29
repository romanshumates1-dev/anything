'use client';

import { useMemo } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import {
  Loader2,
  Plus,
  Pause,
  Copy,
  MoreHorizontal,
  Rocket,
  TrendingUp,
  Send,
  MessageSquare,
  Target,
  Sparkles,
  ArrowRight,
  Zap,
  Clock,
  CheckCircle2,
  FileEdit,
  ChevronRight,
} from 'lucide-react';

// ----------------------------------------------------------------------------
// Types & Config
// ----------------------------------------------------------------------------

interface Campaign {
  id: string;
  name: string;
  status: string;
  direction?: string;
  total_contacts?: number;
  total_sent?: number;
  total_delivered?: number;
  total_opened?: number;
  total_replied?: number;
  total_interested?: number;
  created_at?: string;
  updated_at?: string;
}

const statusConfig = {
  DRAFT: { label: 'Draft', dot: 'neutral' as const, bg: 'bg-[var(--text-muted)]/10', icon: FileEdit },
  ACTIVE: { label: 'Active', dot: 'success' as const, bg: 'bg-[var(--color-success)]/10', icon: Zap },
  PAUSED: { label: 'Paused', dot: 'warning' as const, bg: 'bg-[var(--color-warning)]/10', icon: Clock },
  COMPLETE: { label: 'Complete', dot: 'info' as const, bg: 'bg-[var(--color-info)]/10', icon: CheckCircle2 },
  SCHEDULED: { label: 'Scheduled', dot: 'info' as const, bg: 'bg-[var(--color-info)]/10', icon: Clock },
};

// ----------------------------------------------------------------------------
// Quick Stats Summary
// ----------------------------------------------------------------------------

function QuickStats({ campaigns }: { campaigns: Campaign[] }) {
  const stats = useMemo(() => {
    const total = campaigns.length;
    const active = campaigns.filter((c) => c.status === 'ACTIVE').length;
    const totalSent = campaigns.reduce((sum, c) => sum + (c.total_sent || 0), 0);
    const totalReplied = campaigns.reduce((sum, c) => sum + (c.total_replied || 0), 0);
    const totalInterested = campaigns.reduce((sum, c) => sum + (c.total_interested || 0), 0);

    return { total, active, totalSent, totalReplied, totalInterested };
  }, [campaigns]);

  const statItems = [
    {
      label: 'Total Campaigns',
      value: stats.total,
      icon: Target,
      color: 'text-[var(--accent-blue)]',
      bgColor: 'bg-[var(--accent-blue)]/10',
    },
    {
      label: 'Active Now',
      value: stats.active,
      icon: Zap,
      color: 'text-[var(--color-success)]',
      bgColor: 'bg-[var(--color-success)]/10',
    },
    {
      label: 'Messages Sent',
      value: stats.totalSent.toLocaleString(),
      icon: Send,
      color: 'text-[var(--accent-purple)]',
      bgColor: 'bg-[var(--accent-purple)]/10',
    },
    {
      label: 'Responses',
      value: stats.totalReplied.toLocaleString(),
      icon: MessageSquare,
      color: 'text-[var(--color-info)]',
      bgColor: 'bg-[var(--color-info)]/10',
    },
    {
      label: 'Interested Leads',
      value: stats.totalInterested.toLocaleString(),
      icon: TrendingUp,
      color: 'text-[var(--color-success)]',
      bgColor: 'bg-[var(--color-success)]/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {statItems.map((stat) => {
        const Icon = stat.icon;
        return (
          <GlassCard key={stat.label} padding="sm" className="relative overflow-hidden group">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-[var(--text-muted)] mb-1">{stat.label}</p>
                <p className={`text-2xl font-bold font-mono ${stat.color}`}>{stat.value}</p>
              </div>
              <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                <Icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </div>
            {/* Subtle glow effect */}
            <div className={`absolute inset-0 ${stat.bgColor} opacity-0 group-hover:opacity-30 transition-opacity duration-300 pointer-events-none`} />
          </GlassCard>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Section Header
// ----------------------------------------------------------------------------

function SectionHeader({
  title,
  description,
  count,
  icon: Icon,
  accentColor,
}: {
  title: string;
  description: string;
  count: number;
  icon: React.ElementType;
  accentColor: string;
}) {
  return (
    <div className="flex items-center gap-4 mb-4">
      <div className={`p-2.5 rounded-xl ${accentColor}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-3">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">{title}</h2>
          <span className="text-sm font-mono text-[var(--text-muted)]">({count})</span>
        </div>
        <p className="text-sm text-[var(--text-muted)]">{description}</p>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Campaign Card (Compact for Lists)
// ----------------------------------------------------------------------------

function CampaignCard({ campaign, variant = 'default' }: { campaign: Campaign; variant?: 'default' | 'featured' }) {
  const queryClient = useQueryClient();
  const status = statusConfig[campaign.status as keyof typeof statusConfig] || statusConfig.DRAFT;
  const StatusIcon = status.icon;

  const metrics = {
    sent: campaign.total_sent || 0,
    delivered: campaign.total_delivered || 0,
    opened: campaign.total_opened || 0,
    replied: campaign.total_replied || 0,
    interested: campaign.total_interested || 0,
  };

  const deliveryRate = metrics.sent > 0 ? Math.round((metrics.delivered / metrics.sent) * 100) : 0;
  const replyRate = metrics.delivered > 0 ? Math.round((metrics.replied / metrics.delivered) * 100) : 0;

  const launch = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/outreach/campaigns/${campaign.id}/start`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to launch');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['outreach-campaigns'] }),
  });

  const pause = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/outreach/campaigns/${campaign.id}/pause`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to pause');
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['outreach-campaigns'] }),
  });

  const isFeatured = variant === 'featured';

  return (
    <GlassCard padding="none" className={`overflow-hidden group ${isFeatured ? 'ring-1 ring-[var(--color-success)]/30' : ''}`}>
      {/* Header gradient - more prominent for active */}
      <div
        className={`h-1.5 ${
          campaign.status === 'ACTIVE'
            ? 'bg-gradient-to-r from-[var(--color-success)] via-[var(--accent-blue)] to-[var(--accent-purple)]'
            : 'bg-[var(--bg-tertiary)]'
        }`}
      />

      <div className="p-5">
        {/* Top Row: Name + Status */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <Link
              href={`/campaigns/${campaign.id}`}
              className="text-lg font-semibold text-[var(--text-primary)] hover:text-[var(--accent-blue)] transition-colors inline-flex items-center gap-2 group/link"
            >
              <span className="truncate">{campaign.name}</span>
              <ChevronRight className="h-4 w-4 opacity-0 group-hover/link:opacity-100 transition-opacity" />
            </Link>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {campaign.total_contacts || 0} contacts
              <span className="mx-2 opacity-50">|</span>
              {campaign.direction || 'outbound'}
            </p>
          </div>

          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full ${status.bg}`}>
            <StatusIcon className="h-3.5 w-3.5 text-[var(--text-primary)]" />
            <span className="text-xs font-medium text-[var(--text-primary)]">{status.label}</span>
          </div>
        </div>

        {/* Key Metrics - Horizontal strip */}
        <div className="grid grid-cols-5 gap-1 mb-4 p-3 rounded-xl bg-[var(--bg-primary)]/50">
          {[
            { label: 'Sent', value: metrics.sent, format: 'number' },
            { label: 'Delivery', value: `${deliveryRate}%`, format: 'percent' },
            { label: 'Opens', value: metrics.opened, format: 'number' },
            { label: 'Replies', value: metrics.replied, format: 'number' },
            { label: 'Hot', value: metrics.interested, format: 'number', highlight: true },
          ].map((m) => (
            <div key={m.label} className="text-center">
              <p
                className={`text-base font-mono font-semibold ${
                  m.highlight ? 'text-[var(--color-success)]' : 'text-[var(--text-primary)]'
                }`}
              >
                {m.value}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Progress Funnel Bar */}
        <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--color-success)] rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, replyRate * 5)}%` }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {campaign.status === 'ACTIVE' ? (
            <button
              onClick={() => pause.mutate()}
              disabled={pause.isPending}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {pause.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pause className="h-4 w-4" />}
              Pause Campaign
            </button>
          ) : campaign.status === 'DRAFT' ? (
            <button
              onClick={() => launch.mutate()}
              disabled={launch.isPending}
              className="flex-1 btn-gradient flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium"
            >
              {launch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
              Launch Campaign
            </button>
          ) : campaign.status === 'PAUSED' ? (
            <button
              onClick={() => launch.mutate()}
              disabled={launch.isPending}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--color-success)]/10 text-[var(--color-success)] hover:bg-[var(--color-success)]/20 transition-colors font-medium"
            >
              {launch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Resume Campaign
            </button>
          ) : (
            <Link
              href={`/campaigns/${campaign.id}`}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              View Results
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}

          <button className="p-2.5 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors">
            <Copy className="h-4 w-4" />
          </button>
          <button className="p-2.5 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)] transition-colors">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </GlassCard>
  );
}

// ----------------------------------------------------------------------------
// Empty States
// ----------------------------------------------------------------------------

function EmptyStateActive() {
  return (
    <GlassCard className="text-center py-10">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[var(--color-success)]/10 mb-4">
        <Zap className="h-7 w-7 text-[var(--color-success)]" />
      </div>
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">No Active Campaigns</h3>
      <p className="text-[var(--text-muted)] mb-6 max-w-md mx-auto">
        Launch a campaign to start reaching out to your leads automatically. Active campaigns will appear here.
      </p>
      <Link
        href="/campaigns/wizard"
        className="btn-gradient inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-medium"
      >
        <Rocket className="h-4 w-4" />
        Create Your First Campaign
      </Link>
    </GlassCard>
  );
}

function EmptyStateDrafts() {
  return (
    <div className="p-8 rounded-xl border border-dashed border-[var(--border-subtle)] text-center">
      <FileEdit className="h-8 w-8 text-[var(--text-muted)] mx-auto mb-3" />
      <p className="text-[var(--text-muted)]">No drafts yet</p>
    </div>
  );
}

function EmptyStateCompleted() {
  return (
    <div className="p-8 rounded-xl border border-dashed border-[var(--border-subtle)] text-center">
      <CheckCircle2 className="h-8 w-8 text-[var(--text-muted)] mx-auto mb-3" />
      <p className="text-[var(--text-muted)]">No completed campaigns</p>
    </div>
  );
}

function EmptyStateAll() {
  return (
    <GlassCard className="text-center py-16">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20 mb-6">
        <Sparkles className="h-10 w-10 text-[var(--accent-blue)]" />
      </div>
      <h3 className="text-2xl font-bold text-[var(--text-primary)] mb-3">Launch Your First Campaign</h3>
      <p className="text-[var(--text-secondary)] mb-8 max-w-lg mx-auto">
        Campaigns automate your outreach with multi-touch sequences. Set it up once, and let AI handle the rest while
        you focus on closing deals.
      </p>
      <Link
        href="/campaigns/wizard"
        className="btn-gradient inline-flex items-center gap-2 px-8 py-3 rounded-xl font-semibold text-lg"
      >
        <Plus className="h-5 w-5" />
        Create Campaign
      </Link>
    </GlassCard>
  );
}

// ----------------------------------------------------------------------------
// Main Page
// ----------------------------------------------------------------------------

export default function CampaignsPage() {
  const { data: session, isPending: authLoading } = useSession();

  const { data: campaigns = [], isLoading } = useQuery<Campaign[]>({
    queryKey: ['outreach-campaigns'],
    queryFn: async () => {
      const res = await fetch('/api/outreach/campaigns');
      if (!res.ok) throw new Error('Failed to fetch campaigns');
      return res.json();
    },
    enabled: !!session,
  });

  // Group campaigns by status
  const grouped = useMemo(() => {
    const active = campaigns.filter((c) => c.status === 'ACTIVE' || c.status === 'SCHEDULED');
    const paused = campaigns.filter((c) => c.status === 'PAUSED');
    const drafts = campaigns.filter((c) => c.status === 'DRAFT');
    const completed = campaigns.filter((c) => c.status === 'COMPLETE');

    return { active, paused, drafts, completed };
  }, [campaigns]);

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

  const hasCampaigns = campaigns.length > 0;
  const hasActiveOrPaused = grouped.active.length > 0 || grouped.paused.length > 0;

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">Campaigns</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Automate multi-touch outreach sequences to convert leads into deals
          </p>
        </div>
        <Link
          href="/campaigns/wizard"
          className="btn-gradient px-5 py-2.5 rounded-xl font-medium flex items-center gap-2 shrink-0"
        >
          <Plus className="h-4 w-4" />
          New Campaign
        </Link>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="py-20 flex justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
            <p className="text-[var(--text-muted)]">Loading campaigns...</p>
          </div>
        </div>
      )}

      {/* Empty State - No Campaigns */}
      {!isLoading && !hasCampaigns && <EmptyStateAll />}

      {/* Main Content - Has Campaigns */}
      {!isLoading && hasCampaigns && (
        <>
          {/* Quick Stats */}
          <QuickStats campaigns={campaigns} />

          {/* Active + Paused Campaigns Section */}
          <section>
            <SectionHeader
              title="Running Campaigns"
              description="Campaigns that are actively sending messages or paused"
              count={grouped.active.length + grouped.paused.length}
              icon={Zap}
              accentColor="bg-[var(--color-success)]/10 text-[var(--color-success)]"
            />

            {hasActiveOrPaused ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {grouped.active.map((c) => (
                  <CampaignCard key={c.id} campaign={c} variant="featured" />
                ))}
                {grouped.paused.map((c) => (
                  <CampaignCard key={c.id} campaign={c} />
                ))}
              </div>
            ) : (
              <EmptyStateActive />
            )}
          </section>

          {/* Drafts Section */}
          <section>
            <SectionHeader
              title="Drafts"
              description="Campaigns in progress - finish setting them up and launch"
              count={grouped.drafts.length}
              icon={FileEdit}
              accentColor="bg-[var(--text-muted)]/10 text-[var(--text-muted)]"
            />

            {grouped.drafts.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {grouped.drafts.map((c) => (
                  <CampaignCard key={c.id} campaign={c} />
                ))}
              </div>
            ) : (
              <EmptyStateDrafts />
            )}
          </section>

          {/* Completed Section */}
          <section>
            <SectionHeader
              title="Completed"
              description="Finished campaigns - review performance and duplicate winning strategies"
              count={grouped.completed.length}
              icon={CheckCircle2}
              accentColor="bg-[var(--color-info)]/10 text-[var(--color-info)]"
            />

            {grouped.completed.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {grouped.completed.map((c) => (
                  <CampaignCard key={c.id} campaign={c} />
                ))}
              </div>
            ) : (
              <EmptyStateCompleted />
            )}
          </section>
        </>
      )}
    </div>
  );
}
