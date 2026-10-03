'use client';

import { useQuery } from '@tanstack/react-query';
import { useDashboardSlice } from './DashboardSummaryProvider';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import {
  Loader2,
  MessageSquare,
  XCircle,
  Clock,
  ArrowRight,
  Flame,
  Sparkles,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

interface Engagement {
  id: string;
  leadName: string;
  propertyAddress: string;
  type: 'response' | 'interested' | 'not_interested' | 'callback' | 'hot_lead';
  message?: string;
  timestamp: string;
  campaignName?: string;
}

/**
 * RecentEngagementCard - Shows latest responses and engagement
 *
 * Real-time feed of prospect responses to give wholesalers
 * immediate feedback on their campaigns.
 */
export function RecentEngagementCard() {
  // Prefer the batched dashboard payload; fetch the standalone endpoint only
  // when the batch cannot supply this slice.
  const slice = useDashboardSlice('engagements');

  const { data: fetched, isLoading: fetching } = useQuery<{ engagements: Engagement[] }>({
    queryKey: ['recent-engagements'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/engagements');
      if (!res.ok) {
        // Reported as a failure. This returned four invented people (John Smith,
        // Sarah Davis) with invented replies for any non-2xx — a wholesaler
        // could act on a conversation that never happened.
        throw new Error(`engagements failed: ${res.status}`);
      }
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000, // Refresh every minute
    enabled: slice.fallback,
  });

  const data = slice.data ?? fetched;
  const isLoading = slice.awaitingBatch || fetching;

  const typeConfig: Record<
    Engagement['type'],
    { icon: React.ElementType; color: string; bg: string; label: string }
  > = {
    hot_lead: {
      icon: Flame,
      color: 'text-[var(--color-error)]',
      bg: 'bg-[var(--color-error)]/10',
      label: 'Hot Lead',
    },
    interested: {
      icon: Sparkles,
      color: 'text-[var(--color-success)]',
      bg: 'bg-[var(--color-success)]/10',
      label: 'Interested',
    },
    response: {
      icon: MessageSquare,
      color: 'text-[var(--accent-blue)]',
      bg: 'bg-[var(--accent-blue)]/10',
      label: 'Response',
    },
    callback: {
      icon: Clock,
      color: 'text-[var(--color-warning)]',
      bg: 'bg-[var(--color-warning)]/10',
      label: 'Callback',
    },
    not_interested: {
      icon: XCircle,
      color: 'text-[var(--text-muted)]',
      bg: 'bg-[var(--bg-tertiary)]',
      label: 'Not Interested',
    },
  };

  if (isLoading) {
    return (
      <GlassCard className="h-full flex flex-col">
        <div className="flex items-center justify-center py-12 flex-1">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
        </div>
      </GlassCard>
    );
  }

  const engagements = data?.engagements || [];
  const hotLeads = engagements.filter(e => e.type === 'hot_lead' || e.type === 'interested').length;

  return (
    <GlassCard className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Recent Responses</h3>
          {hotLeads > 0 && (
            <p className="text-xs text-[var(--color-success)] flex items-center gap-1">
              <Flame className="h-3 w-3" />
              {hotLeads} hot lead{hotLeads > 1 ? 's' : ''} today!
            </p>
          )}
        </div>
        <Link
          href="/inbox"
          className="text-xs text-[var(--accent-blue)] hover:underline flex items-center gap-1"
        >
          Inbox
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {engagements.length === 0 ? (
        <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
          <div className="p-3 rounded-full bg-[var(--bg-tertiary)] inline-flex mb-3">
            <MessageSquare className="h-6 w-6 text-[var(--text-muted)]" />
          </div>
          <p className="text-sm text-[var(--text-muted)]">No responses yet</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Responses will appear here as leads reply
          </p>
        </div>
      ) : (
        <div className="space-y-2 flex-1 overflow-y-auto max-h-80">
          {engagements.slice(0, 6).map((engagement) => {
            const config = typeConfig[engagement.type];
            const Icon = config.icon;

            return (
              <Link
                key={engagement.id}
                href={`/crm?lead=${engagement.id}`}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors group"
              >
                <div className={`p-2 rounded-lg ${config.bg} flex-shrink-0`}>
                  <Icon className={`h-4 w-4 ${config.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                      {engagement.leadName}
                    </p>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${config.bg} ${config.color}`}
                    >
                      {config.label}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] truncate">
                    {engagement.propertyAddress}
                  </p>
                  {engagement.message && (
                    <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2 italic">
                      "{engagement.message}"
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-[var(--text-muted)]">
                    <span>{formatDistanceToNow(new Date(engagement.timestamp), { addSuffix: true })}</span>
                    {engagement.campaignName && (
                      <>
                        <span>-</span>
                        <span>{engagement.campaignName}</span>
                      </>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {engagements.length > 6 && (
        <Link
          href="/inbox"
          className="block text-center text-sm text-[var(--accent-blue)] hover:underline mt-4 pt-4 border-t border-[var(--border-subtle)]"
        >
          View all {engagements.length} responses
        </Link>
      )}
    </GlassCard>
  );
}
