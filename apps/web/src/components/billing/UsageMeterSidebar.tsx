'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Loader2, TrendingUp } from 'lucide-react';
import type { UsageResponse } from '@/app/api/usage/route';

interface UsageMeterSidebarProps {
  className?: string;
}

/**
 * UsageMeterSidebar - Shows current usage in the sidebar.
 *
 * Displays the most important usage metrics with progress bars.
 * Links to full usage breakdown page.
 *
 * Design principles:
 * - Transparent about limits
 * - Color-coded based on usage level
 * - Clear upgrade path when approaching limits
 */
export function UsageMeterSidebar({ className = '' }: UsageMeterSidebarProps) {
  const { data, isLoading, error } = useQuery<UsageResponse>({
    queryKey: ['usage'],
    queryFn: async () => {
      const res = await fetch('/api/usage');
      if (!res.ok) throw new Error('Failed to fetch usage');
      return res.json();
    },
    staleTime: 60_000, // Cache for 1 minute
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className={`px-4 py-3 border-t border-[var(--border-subtle)] ${className}`}>
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return null; // Silently hide on error
  }

  const { usage, subscription, isFreeTier } = data;

  // Show the most relevant metrics
  const primaryMetric = usage.lead?.limit !== -1 ? usage.lead : usage.sms;
  const secondaryMetric = usage.sms?.limit !== -1 ? usage.sms : null;

  return (
    <div className={`px-4 py-3 border-t border-[var(--border-subtle)] ${className}`}>
      {/* Primary usage meter */}
      <UsageMeterBar
        label={usage.lead?.limit !== -1 ? 'Leads' : 'SMS'}
        current={primaryMetric?.current ?? 0}
        limit={primaryMetric?.limit ?? 0}
        percentUsed={primaryMetric?.percentUsed ?? 0}
      />

      {/* Secondary usage meter (if applicable) */}
      {secondaryMetric && secondaryMetric.limit !== -1 && (
        <UsageMeterBar
          label="SMS"
          current={secondaryMetric.current}
          limit={secondaryMetric.limit}
          percentUsed={secondaryMetric.percentUsed}
          className="mt-3"
        />
      )}

      {/* Plan label with upgrade link */}
      <div className="flex items-center justify-between mt-3">
        <span className="text-xs text-[var(--text-muted)]">
          {subscription.planName}
        </span>
        {isFreeTier && (
          <Link
            href="/pricing"
            className="text-xs text-[var(--accent-blue)] hover:underline flex items-center gap-1"
          >
            <TrendingUp className="h-3 w-3" />
            Upgrade
          </Link>
        )}
      </div>
    </div>
  );
}

interface UsageMeterBarProps {
  label: string;
  current: number;
  limit: number;
  percentUsed: number;
  className?: string;
}

function UsageMeterBar({
  label,
  current,
  limit,
  percentUsed,
  className = '',
}: UsageMeterBarProps) {
  // Unlimited
  if (limit === -1) {
    return (
      <div className={className}>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-[var(--text-muted)]">{label}</span>
          <span className="text-[var(--text-secondary)]">Unlimited</span>
        </div>
        <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div className="h-full w-1/4 bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full opacity-30" />
        </div>
      </div>
    );
  }

  // Color based on usage level
  const getBarColor = () => {
    if (percentUsed >= 100) {
      return 'bg-[var(--color-error)]';
    }
    if (percentUsed >= 80) {
      return 'bg-gradient-to-r from-amber-500 to-orange-500';
    }
    return 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)]';
  };

  const getTextColor = () => {
    if (percentUsed >= 100) return 'text-[var(--color-error)]';
    if (percentUsed >= 80) return 'text-amber-500';
    return 'text-[var(--text-secondary)]';
  };

  return (
    <div className={className}>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-[var(--text-muted)]">{label}</span>
        <span className={getTextColor()}>
          {current.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${getBarColor()}`}
          style={{ width: `${Math.min(percentUsed, 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Compact usage indicator for very limited space.
 */
export function UsageIndicatorCompact() {
  const { data } = useQuery<UsageResponse>({
    queryKey: ['usage'],
    queryFn: async () => {
      const res = await fetch('/api/usage');
      if (!res.ok) throw new Error('Failed to fetch usage');
      return res.json();
    },
    staleTime: 60_000,
    retry: 1,
  });

  if (!data) return null;

  const { usage, isFreeTier } = data;

  // Find the metric closest to limit
  const metrics = Object.values(usage).filter((u) => u.limit !== -1);
  const mostUsed = metrics.reduce(
    (max, u) => (u.percentUsed > max.percentUsed ? u : max),
    { percentUsed: 0 }
  );

  if (mostUsed.percentUsed < 50) return null;

  const colorClass =
    mostUsed.percentUsed >= 100
      ? 'bg-[var(--color-error)]'
      : mostUsed.percentUsed >= 80
      ? 'bg-amber-500'
      : 'bg-[var(--accent-blue)]';

  return (
    <div
      className="flex items-center gap-2"
      title={`${mostUsed.percentUsed}% of monthly limit used`}
    >
      <div className="w-16 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${colorClass}`}
          style={{ width: `${Math.min(mostUsed.percentUsed, 100)}%` }}
        />
      </div>
      <span className="text-xs text-[var(--text-muted)]">{mostUsed.percentUsed}%</span>
    </div>
  );
}
