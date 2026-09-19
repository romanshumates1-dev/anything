'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X, AlertCircle, TrendingUp, Zap, Star } from 'lucide-react';

interface LimitExceededModalProps {
  isOpen: boolean;
  onClose: () => void;
  metric: string;
  current: number;
  limit: number;
  upgradeReason?: string;
  isFreeTier: boolean;
}

/**
 * LimitExceededModal - Shows when user hits a tier limit.
 *
 * Design principles:
 * - Clear explanation of what happened
 * - No guilt or pressure
 * - Easy to dismiss
 * - Clear path to upgrade if interested
 */
export function LimitExceededModal({
  isOpen,
  onClose,
  metric,
  current,
  limit,
  upgradeReason,
  isFreeTier,
}: LimitExceededModalProps) {
  if (!isOpen) return null;

  const metricLabels: Record<string, string> = {
    lead: 'leads',
    campaign: 'campaigns',
    sms: 'SMS messages',
    email: 'emails',
    ai_request: 'AI requests',
  };

  const metricLabel = metricLabels[metric] || metric;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--bg-secondary)] rounded-2xl border border-[var(--border-subtle)] shadow-2xl max-w-md w-full">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="p-6 pb-0">
          <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
            <AlertCircle className="h-6 w-6 text-amber-500" />
          </div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">
            {isFreeTier ? 'Free Plan Limit Reached' : 'Plan Limit Reached'}
          </h2>
          <p className="text-[var(--text-secondary)]">
            You've used {current.toLocaleString()} of your {limit.toLocaleString()} monthly {metricLabel}.
          </p>
        </div>

        {/* Content */}
        <div className="p-6">
          {upgradeReason && (
            <div className="mb-6 p-4 bg-[var(--bg-tertiary)] rounded-lg border border-[var(--border-subtle)]">
              <div className="flex items-start gap-3">
                <Zap className="h-5 w-5 text-[var(--accent-blue)] flex-shrink-0 mt-0.5" />
                <p className="text-sm text-[var(--text-secondary)]">
                  {upgradeReason}
                </p>
              </div>
            </div>
          )}

          {/* Upgrade benefits */}
          <div className="space-y-3 mb-6">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              With an upgraded plan, you get:
            </p>
            <ul className="space-y-2">
              {[
                'More leads to grow your pipeline',
                'Higher SMS & email quotas',
                'Unlimited campaigns',
                'Priority support',
              ].map((benefit, i) => (
                <li key={i} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Star className="h-4 w-4 text-amber-400 flex-shrink-0" />
                  {benefit}
                </li>
              ))}
            </ul>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <Link
              href="/pricing"
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white font-medium hover:opacity-90 transition-opacity"
            >
              <TrendingUp className="h-4 w-4" />
              View Upgrade Options
            </Link>
            <button
              onClick={onClose}
              className="w-full px-4 py-2.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              Continue with Free Plan
            </button>
          </div>

          {/* Transparency note */}
          <p className="mt-4 text-xs text-[var(--text-muted)] text-center">
            Your data is safe. Limits reset on the 1st of each month.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Hook to handle limit exceeded responses from API calls.
 */
export function useLimitExceeded() {
  const [limitError, setLimitError] = useState<{
    metric: string;
    current: number;
    limit: number;
    upgradeReason?: string;
    isFreeTier: boolean;
  } | null>(null);

  const handleApiResponse = (response: any) => {
    if (response?.error === 'limit_exceeded') {
      setLimitError({
        metric: response.metric || 'resource',
        current: response.current || 0,
        limit: response.limit || 0,
        upgradeReason: response.upgradeReason,
        isFreeTier: response.isFreeTier ?? true,
      });
      return true;
    }
    return false;
  };

  const clearLimitError = () => setLimitError(null);

  return {
    limitError,
    handleApiResponse,
    clearLimitError,
    isLimitExceeded: limitError !== null,
  };
}
