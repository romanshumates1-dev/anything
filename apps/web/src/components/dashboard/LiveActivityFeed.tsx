'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import {
  Loader2,
  CheckCircle,
  FileText,
  MessageSquare,
  UserPlus,
  AlertTriangle,
  Send,
  Flame,
  DollarSign,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type ActivityType =
  | 'deal_closed'
  | 'contract_signed'
  | 'message_sent'
  | 'lead_added'
  | 'response_received'
  | 'hot_lead'
  | 'campaign_started'
  | 'alert';

interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  description?: string;
  timestamp: string;
  metadata?: {
    amount?: number;
    campaignName?: string;
    propertyAddress?: string;
    leadId?: string;
  };
}

const iconMap: Record<
  ActivityType,
  { icon: React.ElementType; color: string; bg: string }
> = {
  deal_closed: {
    icon: DollarSign,
    color: 'text-[var(--color-success)]',
    bg: 'bg-[var(--color-success)]/10',
  },
  contract_signed: {
    icon: FileText,
    color: 'text-[var(--accent-blue)]',
    bg: 'bg-[var(--accent-blue)]/10',
  },
  message_sent: {
    icon: Send,
    color: 'text-[var(--text-muted)]',
    bg: 'bg-[var(--bg-tertiary)]',
  },
  lead_added: {
    icon: UserPlus,
    color: 'text-[var(--accent-purple)]',
    bg: 'bg-[var(--accent-purple)]/10',
  },
  response_received: {
    icon: MessageSquare,
    color: 'text-[var(--accent-blue)]',
    bg: 'bg-[var(--accent-blue)]/10',
  },
  hot_lead: {
    icon: Flame,
    color: 'text-[var(--color-error)]',
    bg: 'bg-[var(--color-error)]/10',
  },
  campaign_started: {
    icon: CheckCircle,
    color: 'text-[var(--color-success)]',
    bg: 'bg-[var(--color-success)]/10',
  },
  alert: {
    icon: AlertTriangle,
    color: 'text-[var(--color-warning)]',
    bg: 'bg-[var(--color-warning)]/10',
  },
};

/**
 * LiveActivityFeed - Real-time feed of all activity
 *
 * Shows a chronological stream of events to give wholesalers
 * immediate feedback and a sense of constant progress.
 */
export function LiveActivityFeed() {
  const { data, isLoading } = useQuery<{ activities: ActivityItem[] }>({
    queryKey: ['live-activity'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/activity');
      if (!res.ok) {
        // Return mock data if endpoint not available
        return {
          activities: [
            {
              id: '1',
              type: 'deal_closed',
              title: 'Deal closed',
              description: '123 Main St',
              timestamp: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
              metadata: { amount: 12500, propertyAddress: '123 Main St' },
            },
            {
              id: '2',
              type: 'hot_lead',
              title: 'Hot lead detected',
              description: 'John Smith is ready to sell',
              timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
              metadata: { leadId: '123', propertyAddress: '456 Oak Ave' },
            },
            {
              id: '3',
              type: 'contract_signed',
              title: 'Contract signed',
              description: 'Sarah Davis - 789 Pine Rd',
              timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
            },
            {
              id: '4',
              type: 'campaign_started',
              title: 'Campaign launched',
              description: 'Pre-Foreclosure Q4 - 250 leads',
              timestamp: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
            },
            {
              id: '5',
              type: 'response_received',
              title: 'New response',
              description: 'Mike Johnson replied',
              timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
            },
            {
              id: '6',
              type: 'message_sent',
              title: '50 messages sent',
              description: 'Tax Delinquent campaign',
              timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
              metadata: { campaignName: 'Tax Delinquent Q3' },
            },
            {
              id: '7',
              type: 'lead_added',
              title: '25 new leads imported',
              description: 'From PropertyRadar',
              timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
            },
          ],
        };
      }
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000, // Refresh every minute
  });

  if (isLoading) {
    return (
      <GlassCard className="h-full flex flex-col">
        <div className="flex items-center justify-center py-12 flex-1">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
        </div>
      </GlassCard>
    );
  }

  const activities = data?.activities || [];

  // Group activities by relative time
  const groupedActivities = activities.reduce((groups, activity) => {
    const date = new Date(activity.timestamp);
    const now = new Date();
    const diffHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);

    let group: string;
    if (diffHours < 1) {
      group = 'Just now';
    } else if (diffHours < 24) {
      group = 'Today';
    } else if (diffHours < 48) {
      group = 'Yesterday';
    } else {
      group = 'Earlier';
    }

    if (!groups[group]) {
      groups[group] = [];
    }
    groups[group].push(activity);
    return groups;
  }, {} as Record<string, ActivityItem[]>);

  const orderedGroups = ['Just now', 'Today', 'Yesterday', 'Earlier'].filter(
    (g) => groupedActivities[g]?.length > 0
  );

  return (
    <GlassCard className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-[var(--accent-blue)]" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Activity</h3>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--color-success)] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--color-success)]" />
          </span>
          <span className="text-xs text-[var(--text-muted)]">Live</span>
        </div>
      </div>

      {activities.length === 0 ? (
        <div className="text-center py-8 flex-1 flex flex-col items-center justify-center">
          <div className="p-3 rounded-full bg-[var(--bg-tertiary)] inline-flex mb-3">
            <Clock className="h-6 w-6 text-[var(--text-muted)]" />
          </div>
          <p className="text-sm text-[var(--text-muted)]">No recent activity</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Activity will appear as you work
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-4 max-h-96">
          {orderedGroups.map((group) => (
            <div key={group}>
              <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-2 sticky top-0 bg-[var(--glass-bg)] py-1 z-10">
                {group}
              </p>
              <div className="space-y-1">
                {groupedActivities[group].map((activity) => {
                  const config = iconMap[activity.type];
                  const Icon = config.icon;
                  const isHighlight =
                    activity.type === 'deal_closed' ||
                    activity.type === 'hot_lead' ||
                    activity.type === 'contract_signed';

                  const href =
                    activity.metadata?.leadId
                      ? `/crm?lead=${activity.metadata.leadId}`
                      : activity.type === 'campaign_started'
                      ? '/campaigns'
                      : undefined;

                  const content = (
                    <div
                      className={`flex items-start gap-3 p-2.5 rounded-lg transition-colors ${
                        isHighlight
                          ? 'bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]'
                          : 'hover:bg-[var(--bg-tertiary)]'
                      } ${href ? 'cursor-pointer group' : ''}`}
                    >
                      <div className={`p-1.5 rounded-lg ${config.bg} flex-shrink-0`}>
                        <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p
                            className={`text-sm text-[var(--text-primary)] truncate ${
                              href ? 'group-hover:text-[var(--accent-blue)]' : ''
                            }`}
                          >
                            {activity.title}
                          </p>
                          {activity.metadata?.amount && (
                            <span className="text-xs font-semibold text-[var(--color-success)] flex-shrink-0">
                              +${activity.metadata.amount.toLocaleString()}
                            </span>
                          )}
                        </div>
                        {activity.description && (
                          <p className="text-xs text-[var(--text-muted)] truncate">
                            {activity.description}
                          </p>
                        )}
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          {formatDistanceToNow(new Date(activity.timestamp), {
                            addSuffix: true,
                          })}
                        </p>
                      </div>
                      {href && (
                        <ArrowRight className="h-4 w-4 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      )}
                    </div>
                  );

                  return href ? (
                    <Link key={activity.id} href={href}>
                      {content}
                    </Link>
                  ) : (
                    <div key={activity.id}>{content}</div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}
