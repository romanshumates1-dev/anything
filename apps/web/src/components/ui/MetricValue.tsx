'use client';

import { cn } from '@/lib/utils';
import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/20/solid';

interface MetricValueProps {
  value: number | string;
  format?: 'number' | 'currency' | 'percent';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  trend?: number;
  trendLabel?: string;
  className?: string;
}

const sizeStyles = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-3xl',
  xl: 'text-4xl',
};

export function MetricValue({
  value,
  format = 'number',
  size = 'lg',
  trend,
  trendLabel,
  className,
}: MetricValueProps) {
  const formatValue = (val: number | string): string => {
    if (typeof val === 'string') return val;
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(val);
      case 'percent':
        return `${val.toFixed(1)}%`;
      default:
        return new Intl.NumberFormat('en-US').format(val);
    }
  };

  const isPositive = trend !== undefined && trend > 0;
  const isNegative = trend !== undefined && trend < 0;

  return (
    <div className={cn('animate-count', className)}>
      <span
        className={cn(
          'font-mono font-semibold text-[var(--text-primary)]',
          sizeStyles[size]
        )}
      >
        {formatValue(value)}
      </span>
      {trend !== undefined && (
        <div className="flex items-center gap-1 mt-1">
          {isPositive && (
            <ArrowUpIcon className="h-4 w-4 text-[var(--color-success)]" />
          )}
          {isNegative && (
            <ArrowDownIcon className="h-4 w-4 text-[var(--color-error)]" />
          )}
          <span
            className={cn(
              'text-sm font-medium',
              isPositive && 'text-[var(--color-success)]',
              isNegative && 'text-[var(--color-error)]',
              !isPositive && !isNegative && 'text-[var(--text-muted)]'
            )}
          >
            {isPositive && '+'}
            {trend}%
          </span>
          {trendLabel && (
            <span className="text-sm text-[var(--text-muted)] ml-1">
              {trendLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
