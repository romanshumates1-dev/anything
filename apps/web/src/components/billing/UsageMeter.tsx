'use client';

import Link from 'next/link';
import { TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react';

interface UsageMeterProps {
  /** Label for the meter (e.g., "Leads", "Campaigns") */
  label: string;
  /** Current usage count */
  current: number;
  /** Usage limit (-1 for unlimited) */
  limit: number;
  /** Optional percentage override (calculated from current/limit if not provided) */
  percentUsed?: number;
  /** Show the upgrade link when approaching limit */
  showUpgradeLink?: boolean;
  /** Custom class name */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show the numeric values */
  showValues?: boolean;
}

/**
 * UsageMeter - Visual progress bar showing resource usage.
 *
 * Design principles:
 * - Clear visual feedback at a glance
 * - Color-coded based on usage level (green/yellow/red)
 * - No pressure tactics, just transparency
 * - Accessible with proper ARIA attributes
 */
export function UsageMeter({
  label,
  current,
  limit,
  percentUsed: percentOverride,
  showUpgradeLink = false,
  className = '',
  size = 'md',
  showValues = true,
}: UsageMeterProps) {
  // Handle unlimited
  const isUnlimited = limit === -1;
  const percent = isUnlimited
    ? 0
    : percentOverride ?? (limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0);

  // Determine status and colors
  const status = getUsageStatus(percent, isUnlimited);

  // Size classes
  const sizeClasses = {
    sm: { bar: 'h-1', text: 'text-xs', gap: 'gap-1' },
    md: { bar: 'h-1.5', text: 'text-sm', gap: 'gap-1.5' },
    lg: { bar: 'h-2', text: 'text-base', gap: 'gap-2' },
  };

  const sizes = sizeClasses[size];

  return (
    <div className={`space-y-1 ${className}`}>
      {/* Header row */}
      <div className={`flex items-center justify-between ${sizes.text}`}>
        <div className={`flex items-center ${sizes.gap}`}>
          <span className="text-[var(--text-muted)]">{label}</span>
          {status.icon && (
            <status.icon className={`h-3.5 w-3.5 ${status.iconColor}`} />
          )}
        </div>
        {showValues && (
          <span className={status.textColor}>
            {isUnlimited ? (
              'Unlimited'
            ) : (
              <>
                {current.toLocaleString()}
                <span className="text-[var(--text-muted)]"> / </span>
                {limit.toLocaleString()}
              </>
            )}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div
        className={`${sizes.bar} bg-[var(--bg-tertiary)] rounded-full overflow-hidden`}
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${isUnlimited ? 'unlimited' : `${current} of ${limit} used`}`}
      >
        {isUnlimited ? (
          <div className="h-full w-1/4 bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full opacity-30" />
        ) : (
          <div
            className={`h-full rounded-full transition-all duration-300 ${status.barColor}`}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        )}
      </div>

      {/* Optional upgrade link for users approaching limit */}
      {showUpgradeLink && percent >= 80 && !isUnlimited && (
        <Link
          href="/pricing"
          className={`inline-flex items-center ${sizes.gap} ${sizes.text} text-[var(--accent-blue)] hover:underline mt-1`}
        >
          <TrendingUp className="h-3 w-3" />
          <span>Upgrade for more</span>
        </Link>
      )}
    </div>
  );
}

/**
 * Determine status styling based on usage percentage.
 */
function getUsageStatus(percent: number, isUnlimited: boolean) {
  if (isUnlimited) {
    return {
      barColor: 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)]',
      textColor: 'text-[var(--text-secondary)]',
      icon: null,
      iconColor: '',
    };
  }

  if (percent >= 100) {
    return {
      barColor: 'bg-[var(--color-error)]',
      textColor: 'text-[var(--color-error)]',
      icon: AlertTriangle,
      iconColor: 'text-[var(--color-error)]',
    };
  }

  if (percent >= 80) {
    return {
      barColor: 'bg-gradient-to-r from-amber-500 to-orange-500',
      textColor: 'text-amber-500',
      icon: AlertTriangle,
      iconColor: 'text-amber-500',
    };
  }

  if (percent >= 50) {
    return {
      barColor: 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)]',
      textColor: 'text-[var(--text-secondary)]',
      icon: null,
      iconColor: '',
    };
  }

  return {
    barColor: 'bg-[var(--color-success)]',
    textColor: 'text-[var(--text-secondary)]',
    icon: CheckCircle,
    iconColor: 'text-[var(--color-success)]',
  };
}

/**
 * UsageMeterStack - Multiple usage meters stacked vertically.
 * Useful for showing all limits in a settings or dashboard view.
 */
interface UsageMeterStackProps {
  metrics: Array<{
    label: string;
    current: number;
    limit: number;
    percentUsed?: number;
  }>;
  showUpgradeLink?: boolean;
  className?: string;
}

export function UsageMeterStack({
  metrics,
  showUpgradeLink = true,
  className = '',
}: UsageMeterStackProps) {
  // Find the metric closest to limit for upgrade prompt
  const highestUsage = metrics.reduce(
    (max, m) => {
      const percent = m.limit > 0 ? (m.current / m.limit) * 100 : 0;
      return percent > max ? percent : max;
    },
    0
  );

  return (
    <div className={`space-y-4 ${className}`}>
      {metrics.map((metric, idx) => (
        <UsageMeter
          key={`${metric.label}-${idx}`}
          label={metric.label}
          current={metric.current}
          limit={metric.limit}
          percentUsed={metric.percentUsed}
          showUpgradeLink={false} // We show one at the end
        />
      ))}
      {showUpgradeLink && highestUsage >= 80 && (
        <Link
          href="/pricing"
          className="flex items-center gap-1.5 text-sm text-[var(--accent-blue)] hover:underline pt-2"
        >
          <TrendingUp className="h-4 w-4" />
          <span>Upgrade for higher limits</span>
        </Link>
      )}
    </div>
  );
}

/**
 * UsageMeterInline - Compact inline usage indicator.
 * For use in headers or tight spaces where only a visual is needed.
 */
interface UsageMeterInlineProps {
  current: number;
  limit: number;
  className?: string;
  showTooltip?: boolean;
  label?: string;
}

export function UsageMeterInline({
  current,
  limit,
  className = '',
  showTooltip = true,
  label = 'Usage',
}: UsageMeterInlineProps) {
  const isUnlimited = limit === -1;
  const percent = isUnlimited ? 0 : Math.min(100, Math.round((current / limit) * 100));

  const barColor =
    percent >= 100
      ? 'bg-[var(--color-error)]'
      : percent >= 80
      ? 'bg-amber-500'
      : 'bg-[var(--accent-blue)]';

  const tooltipText = isUnlimited
    ? `${label}: Unlimited`
    : `${label}: ${current} / ${limit} (${percent}%)`;

  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      title={showTooltip ? tooltipText : undefined}
    >
      <div className="w-12 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: isUnlimited ? '25%' : `${percent}%` }}
        />
      </div>
      <span className="text-xs text-[var(--text-muted)]">
        {isUnlimited ? 'Unlimited' : `${percent}%`}
      </span>
    </div>
  );
}
