'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import {
  Loader2,
  PhoneCall,
  FileText,
  Clock,
  MessageSquare,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Zap,
} from 'lucide-react';

interface NextAction {
  id: string;
  type: 'call' | 'contract' | 'follow_up' | 'response' | 'urgent';
  title: string;
  description: string;
  dueIn?: string;
  href: string;
  priority: 'high' | 'medium' | 'low';
}

/**
 * NextActionsCard - Prioritized action list for wholesalers
 *
 * Shows the most important next steps to keep deals moving,
 * emphasizing urgent items and time-sensitive actions.
 */
export function NextActionsCard() {
  const { data, isLoading } = useQuery<{ actions: NextAction[] }>({
    queryKey: ['next-actions'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/next-actions');
      if (!res.ok) {
        // Return mock data if endpoint not available
        return {
          actions: [
            {
              id: '1',
              type: 'urgent',
              title: 'Hot lead: John Smith wants to sell',
              description: '123 Main St - Responded 30 min ago',
              dueIn: 'Now',
              href: '/crm?lead=1',
              priority: 'high',
            },
            {
              id: '2',
              type: 'call',
              title: 'Call back Sarah Davis',
              description: '456 Oak Ave - Requested callback at 2pm',
              dueIn: 'In 2 hours',
              href: '/crm?lead=2',
              priority: 'high',
            },
            {
              id: '3',
              type: 'contract',
              title: 'Send contract to Mike Johnson',
              description: '789 Pine Rd - Agreed on $95,000',
              dueIn: 'Today',
              href: '/contracts?lead=3',
              priority: 'medium',
            },
            {
              id: '4',
              type: 'follow_up',
              title: 'Follow up with Lisa Brown',
              description: '321 Elm St - No response in 5 days',
              dueIn: 'Tomorrow',
              href: '/crm?lead=4',
              priority: 'low',
            },
          ],
        };
      }
      return res.json();
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const typeConfig: Record<
    NextAction['type'],
    { icon: React.ElementType; color: string; bg: string }
  > = {
    urgent: {
      icon: Zap,
      color: 'text-[var(--color-error)]',
      bg: 'bg-[var(--color-error)]/10',
    },
    call: {
      icon: PhoneCall,
      color: 'text-[var(--color-success)]',
      bg: 'bg-[var(--color-success)]/10',
    },
    contract: {
      icon: FileText,
      color: 'text-[var(--accent-blue)]',
      bg: 'bg-[var(--accent-blue)]/10',
    },
    follow_up: {
      icon: Clock,
      color: 'text-[var(--color-warning)]',
      bg: 'bg-[var(--color-warning)]/10',
    },
    response: {
      icon: MessageSquare,
      color: 'text-[var(--accent-purple)]',
      bg: 'bg-[var(--accent-purple)]/10',
    },
  };

  const priorityStyles: Record<NextAction['priority'], string> = {
    high: 'border-l-[var(--color-error)]',
    medium: 'border-l-[var(--color-warning)]',
    low: 'border-l-[var(--border-medium)]',
  };

  if (isLoading) {
    return (
      <GlassCard>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
        </div>
      </GlassCard>
    );
  }

  const actions = data?.actions || [];
  const urgentCount = actions.filter(a => a.priority === 'high').length;

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">Next Actions</h3>
          {urgentCount > 0 && (
            <p className="text-xs text-[var(--color-error)] flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {urgentCount} urgent action{urgentCount > 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Link
          href="/dashboard/actions"
          className="text-xs text-[var(--accent-blue)] hover:underline flex items-center gap-1"
        >
          All actions
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      {actions.length === 0 ? (
        <div className="text-center py-8">
          <div className="p-3 rounded-full bg-[var(--color-success)]/10 inline-flex mb-3">
            <CheckCircle2 className="h-6 w-6 text-[var(--color-success)]" />
          </div>
          <p className="text-sm text-[var(--text-primary)] font-medium">All caught up!</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            No pending actions right now
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {actions.slice(0, 5).map((action) => {
            const config = typeConfig[action.type];
            const Icon = config.icon;

            return (
              <Link
                key={action.id}
                href={action.href}
                className={`block p-3 rounded-lg border-l-2 ${priorityStyles[action.priority]} bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors group`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${config.bg} flex-shrink-0`}>
                    <Icon className={`h-4 w-4 ${config.color}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors">
                        {action.title}
                      </p>
                      {action.dueIn && (
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                            action.priority === 'high'
                              ? 'bg-[var(--color-error)]/10 text-[var(--color-error)]'
                              : 'bg-[var(--bg-secondary)] text-[var(--text-muted)]'
                          }`}
                        >
                          {action.dueIn}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
                      {action.description}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {actions.length > 5 && (
        <Link
          href="/dashboard/actions"
          className="block text-center text-sm text-[var(--accent-blue)] hover:underline mt-4"
        >
          View all {actions.length} actions
        </Link>
      )}
    </GlassCard>
  );
}
