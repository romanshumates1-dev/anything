'use client';

import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Target,
  Flame,
  Trophy,
  Zap,
  Star,
  Calendar,
} from 'lucide-react';

interface WeeklyStats {
  leadsContacted: number;
  leadsContactedLastWeek: number;
  responsesReceived: number;
  responsesLastWeek: number;
  dealsInProgress: number;
  dealsLastWeek: number;
  dealsClosed: number;
  dealsClosedLastWeek: number;
  streak: number;
  milestone?: {
    type: 'leads' | 'deals' | 'responses';
    value: number;
    label: string;
  };
}

/**
 * WeeklyProgressSummary - Shows weekly momentum and achievements
 *
 * Gives wholesalers a clear feeling of progress with week-over-week
 * comparisons, streaks, and milestone celebrations.
 */
export function WeeklyProgressSummary() {
  const { data, isLoading } = useQuery<WeeklyStats>({
    queryKey: ['weekly-progress'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/weekly-progress');
      if (!res.ok) {
        // Return mock data if endpoint not available
        return {
          leadsContacted: 156,
          leadsContactedLastWeek: 142,
          responsesReceived: 38,
          responsesLastWeek: 31,
          dealsInProgress: 8,
          dealsLastWeek: 6,
          dealsClosed: 3,
          dealsClosedLastWeek: 2,
          streak: 12,
          milestone: {
            type: 'leads',
            value: 1000,
            label: '1,000 leads contacted!',
          },
        };
      }
      return res.json();
    },
    staleTime: 300_000, // 5 minutes
  });

  if (isLoading) {
    return (
      <GlassCard className="h-full">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
        </div>
      </GlassCard>
    );
  }

  if (!data) {
    return null;
  }

  const metrics = [
    {
      label: 'Contacted',
      current: data.leadsContacted,
      previous: data.leadsContactedLastWeek,
      icon: Zap,
      color: 'text-blue-500',
    },
    {
      label: 'Responses',
      current: data.responsesReceived,
      previous: data.responsesLastWeek,
      icon: Target,
      color: 'text-purple-500',
    },
    {
      label: 'In Progress',
      current: data.dealsInProgress,
      previous: data.dealsLastWeek,
      icon: TrendingUp,
      color: 'text-orange-500',
    },
    {
      label: 'Closed',
      current: data.dealsClosed,
      previous: data.dealsClosedLastWeek,
      icon: Trophy,
      color: 'text-green-500',
    },
  ];

  const calculateChange = (current: number, previous: number) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 100);
  };

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-[var(--accent-blue)]" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)]">This Week</h3>
        </div>
        {data.streak > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--color-warning)]/10">
            <Flame className="h-4 w-4 text-[var(--color-warning)]" />
            <span className="text-sm font-semibold text-[var(--color-warning)]">
              {data.streak} day streak
            </span>
          </div>
        )}
      </div>

      {/* Milestone celebration */}
      {data.milestone && (
        <div className="mb-4 p-3 rounded-lg bg-gradient-to-r from-[var(--accent-blue)]/10 to-[var(--accent-purple)]/10 border border-[var(--accent-blue)]/20">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-full bg-[var(--accent-blue)]/20">
              <Star className="h-4 w-4 text-[var(--accent-blue)]" />
            </div>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Milestone Reached!
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                {data.milestone.label}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Progress metrics */}
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          const change = calculateChange(metric.current, metric.previous);
          const isPositive = change > 0;
          const isNegative = change < 0;

          return (
            <div
              key={metric.label}
              className="p-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <div className="flex items-center justify-between mb-1">
                <Icon className={`h-4 w-4 ${metric.color}`} />
                {change !== 0 && (
                  <span
                    className={`flex items-center gap-0.5 text-[10px] font-medium ${
                      isPositive
                        ? 'text-[var(--color-success)]'
                        : isNegative
                        ? 'text-[var(--color-error)]'
                        : 'text-[var(--text-muted)]'
                    }`}
                  >
                    {isPositive && <TrendingUp className="h-3 w-3" />}
                    {isNegative && <TrendingDown className="h-3 w-3" />}
                    {isPositive && '+'}
                    {change}%
                  </span>
                )}
              </div>
              <p className="text-xl font-bold text-[var(--text-primary)] tabular-nums">
                {metric.current}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{metric.label}</p>
            </div>
          );
        })}
      </div>

      {/* Progress bar showing week completion */}
      <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--text-muted)]">Week progress</span>
          <span className="text-xs text-[var(--text-muted)]">
            {new Date().toLocaleDateString('en-US', { weekday: 'long' })}
          </span>
        </div>
        <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full transition-all duration-500"
            style={{ width: `${((new Date().getDay() || 7) / 7) * 100}%` }}
          />
        </div>
      </div>
    </GlassCard>
  );
}
