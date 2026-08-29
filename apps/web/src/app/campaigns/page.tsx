'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, Play, Pause, Copy, MoreHorizontal, Rocket } from 'lucide-react';

const statusConfig = {
  DRAFT: { label: 'Draft', dot: 'neutral' as const, bg: 'bg-[var(--text-muted)]/10' },
  ACTIVE: { label: 'Active', dot: 'success' as const, bg: 'bg-[var(--color-success)]/10' },
  PAUSED: { label: 'Paused', dot: 'warning' as const, bg: 'bg-[var(--color-warning)]/10' },
  COMPLETE: { label: 'Complete', dot: 'info' as const, bg: 'bg-[var(--color-info)]/10' },
  SCHEDULED: { label: 'Scheduled', dot: 'info' as const, bg: 'bg-[var(--color-info)]/10' },
};

function CampaignCard({ campaign }: { campaign: any }) {
  const queryClient = useQueryClient();
  const status = statusConfig[campaign.status as keyof typeof statusConfig] || statusConfig.DRAFT;

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

  return (
    <GlassCard padding="none" className="overflow-hidden">
      {/* Header gradient */}
      <div className={`h-2 ${campaign.status === 'ACTIVE' ? 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)]' : 'bg-[var(--bg-tertiary)]'}`} />

      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{campaign.name}</h3>
            <p className="text-sm text-[var(--text-muted)]">
              {campaign.total_contacts || 0} contacts · {campaign.direction || 'outbound'}
            </p>
          </div>
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${status.bg}`}>
            <StatusDot status={status.dot} size="sm" />
            <span className="text-xs font-medium text-[var(--text-primary)]">{status.label}</span>
          </div>
        </div>

        {/* Metrics */}
        <div className="grid grid-cols-5 gap-2 mb-4">
          {[
            { label: 'Sent', value: metrics.sent },
            { label: 'Delivered', value: `${deliveryRate}%` },
            { label: 'Opened', value: metrics.opened },
            { label: 'Replied', value: metrics.replied },
            { label: 'Interested', value: metrics.interested, highlight: true },
          ].map((m) => (
            <div key={m.label} className="text-center">
              <p className={`text-lg font-mono font-semibold ${m.highlight ? 'text-[var(--color-success)]' : 'text-[var(--text-primary)]'}`}>
                {m.value}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{m.label}</p>
            </div>
          ))}
        </div>

        {/* Funnel bar */}
        <div className="h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden mb-4">
          <div
            className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--color-success)] rounded-full"
            style={{ width: `${Math.min(100, replyRate * 5)}%` }}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {campaign.status === 'ACTIVE' ? (
            <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-primary)]">
              <Pause className="h-4 w-4" />
              Pause
            </button>
          ) : (
            <button
              onClick={() => launch.mutate()}
              disabled={launch.isPending}
              className="flex-1 btn-gradient flex items-center justify-center gap-2 px-4 py-2 rounded-lg"
            >
              {launch.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Rocket className="h-4 w-4" />
              )}
              {campaign.status === 'PAUSED' ? 'Resume' : 'Launch'}
            </button>
          )}
          <button className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <Copy className="h-4 w-4" />
          </button>
          <button className="p-2 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>
    </GlassCard>
  );
}

export default function CampaignsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const [filter, setFilter] = useState<string>('all');

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ['outreach-campaigns'],
    queryFn: async () => {
      const res = await fetch('/api/outreach/campaigns');
      if (!res.ok) throw new Error('Failed to fetch campaigns');
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

  const filters = ['all', 'active', 'paused', 'draft', 'complete'];
  const filteredCampaigns = campaigns?.filter((c: any) =>
    filter === 'all' ? true : c.status?.toLowerCase() === filter
  ) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Campaigns</h1>
          <p className="text-[var(--text-secondary)] mt-1">Manage your outreach sequences</p>
        </div>
        <Link href="/campaigns/wizard" className="btn-gradient px-5 py-2.5 rounded-lg font-medium flex items-center gap-2">
          <Plus className="h-4 w-4" />
          New Campaign
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
              filter === f
                ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Campaign grid */}
      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : filteredCampaigns.length === 0 ? (
        <GlassCard className="text-center py-12">
          <p className="text-[var(--text-muted)]">No campaigns found</p>
          <Link href="/campaigns/wizard" className="text-[var(--accent-blue)] hover:underline mt-2 inline-block">
            Create your first campaign
          </Link>
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filteredCampaigns.map((c: any) => (
            <CampaignCard key={c.id} campaign={c} />
          ))}
        </div>
      )}
    </div>
  );
}
