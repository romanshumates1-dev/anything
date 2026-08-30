'use client';

import { ArrowUpIcon, ArrowDownIcon } from '@heroicons/react/20/solid';

interface KpiCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ReactNode;
  format?: 'number' | 'currency' | 'percent';
}

export function KpiCard({
  title,
  value,
  change,
  changeLabel = 'vs last period',
  icon,
  format = 'number',
}: KpiCardProps) {
  const formatValue = (val: string | number) => {
    if (typeof val === 'string') return val;
    switch (format) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
        }).format(val);
      case 'percent':
        return `${val}%`;
      default:
        return new Intl.NumberFormat('en-US').format(val);
    }
  };

  const isPositive = change && change > 0;
  const isNegative = change && change < 0;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
      <p className="mt-2 text-3xl font-semibold text-gray-900">
        {formatValue(value)}
      </p>
      {change !== undefined && (
        <div className="mt-2 flex items-center text-sm">
          {isPositive && (
            <ArrowUpIcon className="h-4 w-4 text-green-500 mr-1" />
          )}
          {isNegative && (
            <ArrowDownIcon className="h-4 w-4 text-red-500 mr-1" />
          )}
          <span
            className={
              isPositive
                ? 'text-green-600'
                : isNegative
                ? 'text-red-600'
                : 'text-gray-500'
            }
          >
            {isPositive && '+'}
            {change}%
          </span>
          <span className="text-gray-400 ml-1">{changeLabel}</span>
        </div>
      )}
    </div>
  );
}
