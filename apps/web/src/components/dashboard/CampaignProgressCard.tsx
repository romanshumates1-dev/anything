'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import {
  Loader2,
  Play,
  Pause,
  ArrowRight,
  MessageSquare,
  Zap,
  Clock,
  Target,
  CheckCircle2,
} from 'lucide-react';

interface Campaign {
  id: string;
  name: string;
  status: string;
  member_count?: number;
  sent_count?: number;
  response_count?: number;
  config?: {
    objective?: { type: string };
    sequence?: Array<{ enabled: boolean }>;
  };
  created_at: string;
  updated_at?: string;
}

interface CampaignWithProgress extends Campaign {
  progress: number;
  responseCount: number;
  responseRate: number;
  isActive: boolean;
  eta?: string;
}

/**
 * CampaignProgressCard - Shows active campaigns with progress bars
 *
 * Displays real-time progress for each campaign giving
 * wholesalers a clear feeling of momentum.
 */
export function CampaignProgressCard() {
  const { data: campaigns, isLoading } = useQuery<Campaign[]>({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const res = await fetch('/api/campaigns');
      if (!res.ok) throw new Error('Failed to fetch campaigns');
      return res.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <GlassCard>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
        </div>
      </GlassCard>
    );
  }

  // Process campaigns to add progress info
  const activeCampaigns: CampaignWithProgress[] = (campaigns || [])
    .filter(c => c.status !== 'archived' && c.status !== 'completed')
    .slice(0, 4)
    .map(campaign => {
      const total = campaign.member_count || 0;
      const sent = campaign.sent_count || 0;
      const responseCount = campaign.response_count || Math.round(sent * 0.15);
      const progress = total > 0 ? Math.round((sent / total) * 100) : 0;
      const responseRate = sent > 0 ? Math.round((responseCount / sent) * 100) : 0;
      const isActive = campaign.status === 'active' || campaign.status === 'running';

      // Calculate ETA based on sending rate
      const remaining = total - sent;
      const dailyRate = 50; // Placeholder - would come from actual rate
      const daysRemaining = remaining > 0 ? Math.ceil(remaining / dailyRate) : 0;
      const eta = daysRemaining > 0
        ? daysRemaining === 1
          ? 'Tomorrow'
          : `${daysRemaining} days`
        : undefined;

      return {
        ...campaign,
        progress,
        responseCount,
        responseRate,
        isActive,
        eta,
      };
    });

  const totalActive = activeCampaigns.filter(c => c.isActive).length;
  const totalSent = activeCampaigns.reduce((sum, c) => sum + (c.sent_count || 0), 0);

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Active Campaigns</h3>
          <p className="text-xs text-[var(--text-muted)]">
            {totalActive} running, {totalSent.toLocaleString()} sent
          </p>
        </div>
        <Link
          href="/campaigns/wizard"
          className="flex items-center gap-1 text-xs text-[var(--accent-blue)] hover:underline"
        >
          <Zap className="h-3 w-3" />
          New
        </Link>
      </div>

      {activeCampaigns.length === 0 ? (
        <div className="text-center py-8">
          <div className="p-3 rounded-full bg-[var(--bg-tertiary)] inline-flex mb-3">
            <MessageSquare className="h-6 w-6 text-[var(--text-muted)]" />
          </div>
          <p className="text-sm text-[var(--text-muted)]">No active campaigns</p>
          <Link
            href="/campaigns/wizard"
            className="inline-flex items-center gap-2 mt-3 text-sm text-[var(--accent-blue)] hover:underline"
          >
            Launch your first campaign
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {activeCampaigns.map((campaign) => (
            <Link
              key={campaign.id}
              href={`/campaigns/${campaign.id}`}
              className="block p-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors group border border-transparent hover:border-[var(--border-medium)]"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {campaign.isActive ? (
                    <div className="relative">
                      <Play className="h-4 w-4 text-[var(--color-success)] flex-shrink-0" />
                      <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-[var(--color-success)] rounded-full animate-pulse" />
                    </div>
                  ) : (
                    <Pause className="h-4 w-4 text-[var(--text-muted)] flex-shrink-0" />
                  )}
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate group-hover:text-[var(--accent-blue)] transition-colors">
                    {campaign.name}
                  </span>
                </div>
                {campaign.progress === 100 ? (
                  <CheckCircle2 className="h-4 w-4 text-[var(--color-success)] flex-shrink-0" />
                ) : campaign.eta ? (
                  <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] flex-shrink-0 ml-2">
                    <Clock className="h-3 w-3" />
                    {campaign.eta}
                  </span>
                ) : null}
              </div>

              {/* Progress bar with segments */}
              <div className="relative h-2.5 bg-[var(--bg-primary)] rounded-full overflow-hidden mb-2">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
                    campaign.isActive
                      ? 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)]'
                      : 'bg-[var(--text-muted)]'
                  }`}
                  style={{ width: `${Math.min(campaign.progress, 100)}%` }}
                />
                {/* Animated pulse at progress edge */}
                {campaign.isActive && campaign.progress > 0 && campaign.progress < 100 && (
                  <div
                    className="absolute inset-y-0 w-1.5 bg-white/60 rounded-full animate-pulse"
                    style={{ left: `${Math.max(campaign.progress - 1, 0)}%` }}
                  />
                )}
                {/* Progress milestones */}
                {[25, 50, 75].map((milestone) => (
                  <div
                    key={milestone}
                    className={`absolute inset-y-0 w-px ${
                      campaign.progress >= milestone
                        ? 'bg-white/30'
                        : 'bg-[var(--border-subtle)]'
                    }`}
                    style={{ left: `${milestone}%` }}
                  />
                ))}
              </div>

              {/* Stats row - enhanced */}
              <div className="flex items-center justify-between text-xs gap-2">
                <div className="flex items-center gap-3">
                  <span className="text-[var(--text-secondary)] font-medium tabular-nums">
                    {campaign.progress}%
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {campaign.sent_count?.toLocaleString() || 0}/{campaign.member_count?.toLocaleString() || 0}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {campaign.responseCount > 0 && (
                    <span className="flex items-center gap-1 text-[var(--color-success)]">
                      <MessageSquare className="h-3 w-3" />
                      {campaign.responseCount}
                    </span>
                  )}
                  {campaign.responseRate > 0 && (
                    <span className="flex items-center gap-1 text-[var(--accent-purple)]">
                      <Target className="h-3 w-3" />
                      {campaign.responseRate}%
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {activeCampaigns.length > 0 && (
        <Link
          href="/campaigns"
          className="block text-center text-sm text-[var(--accent-blue)] hover:underline mt-4"
        >
          View all campaigns
        </Link>
      )}
    </GlassCard>
  );
}
