'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Users,
  Send,
  MessageSquare,
  Handshake,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';

interface QuickStat {
  label: string;
  value: number;
  change?: number;
  icon: React.ElementType;
  color: string;
}

/**
 * QuickStatsBar - Horizontal bar of key metrics
 *
 * Shows the most important numbers at a glance with
 * trend indicators to highlight momentum.
 */
export function QuickStatsBar() {
  const { data, isLoading } = useQuery({
    queryKey: ['quick-stats'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/quick-stats');
      if (!res.ok) {
        // Return mock data if endpoint not available
        return {
          leads: { value: 847, change: 12 },
          contacted: { value: 623, change: 8 },
          responses: { value: 198, change: -3 },
          deals: { value: 12, change: 25 },
        };
      }
      return res.json();
    },
    staleTime: 60_000,
  });

  const stats: QuickStat[] = [
    {
      label: 'Total Leads',
      value: data?.leads?.value || 0,
      change: data?.leads?.change,
      icon: Users,
      color: 'text-blue-500',
    },
    {
      label: 'Contacted',
      value: data?.contacted?.value || 0,
      change: data?.contacted?.change,
      icon: Send,
      color: 'text-indigo-500',
    },
    {
      label: 'Responses',
      value: data?.responses?.value || 0,
      change: data?.responses?.change,
      icon: MessageSquare,
      color: 'text-purple-500',
    },
    {
      label: 'Deals Closed',
      value: data?.deals?.value || 0,
      change: data?.deals?.change,
      icon: Handshake,
      color: 'text-green-500',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((stat) => {
        const Icon = stat.icon;
        const isPositive = stat.change !== undefined && stat.change > 0;
        const isNegative = stat.change !== undefined && stat.change < 0;

        return (
          <div
            key={stat.label}
            className="p-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-subtle)] hover:border-[var(--border-medium)] transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <Icon className={`h-5 w-5 ${stat.color}`} />
              {stat.change !== undefined && (
                <div
                  className={`flex items-center gap-0.5 text-xs font-medium ${
                    isPositive
                      ? 'text-[var(--color-success)]'
                      : isNegative
                      ? 'text-[var(--color-error)]'
                      : 'text-[var(--text-muted)]'
                  }`}
                >
                  {isPositive && <TrendingUp className="h-3 w-3" />}
                  {isNegative && <TrendingDown className="h-3 w-3" />}
                  <span>
                    {isPositive && '+'}
                    {stat.change}%
                  </span>
                </div>
              )}
            </div>
            <p
              className={`text-2xl font-bold text-[var(--text-primary)] tabular-nums ${
                isLoading ? 'animate-pulse' : ''
              }`}
            >
              {isLoading ? '-' : stat.value.toLocaleString()}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{stat.label}</p>
          </div>
        );
      })}
    </div>
  );
}
