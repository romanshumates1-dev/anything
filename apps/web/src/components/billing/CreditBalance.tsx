'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Coins, TrendingUp, AlertTriangle, Loader2, Plus } from 'lucide-react';
import type { CreditsResponse } from '@/app/api/credits/route';

interface CreditBalanceProps {
  className?: string;
  /** Compact mode for tight spaces */
  compact?: boolean;
  /** Show the buy more link */
  showBuyLink?: boolean;
}

/**
 * CreditBalance - Displays current credit balance.
 *
 * Shows the organization's platform credit balance with
 * visual indicators for low balance states.
 *
 * Design principles:
 * - Clear balance display at a glance
 * - Non-intrusive low balance warning
 * - Direct path to purchase more credits
 */
export function CreditBalance({
  className = '',
  compact = false,
  showBuyLink = true,
}: CreditBalanceProps) {
  const { data, isLoading, error } = useQuery<CreditsResponse>({
    queryKey: ['credits'],
    queryFn: async () => {
      const res = await fetch('/api/credits');
      if (!res.ok) throw new Error('Failed to fetch credits');
      return res.json();
    },
    staleTime: 30_000, // Cache for 30 seconds
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Loader2 className="h-4 w-4 animate-spin text-[var(--text-muted)]" />
        {!compact && <span className="text-sm text-[var(--text-muted)]">Loading...</span>}
      </div>
    );
  }

  if (error || !data) {
    return null; // Silently hide on error
  }

  const { balance, tier, costs } = data;

  // Determine if balance is low (less than 50 credits or can't afford 5 SMS)
  const smsCost = costs?.SMS_SEND ?? 5;
  const isLowBalance = balance < 50 || balance < smsCost * 5;
  const isCriticalBalance = balance < smsCost;

  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 ${className}`}
        title={`${balance.toLocaleString()} credits (${tier} tier)`}
      >
        <Coins
          className={`h-4 w-4 ${
            isCriticalBalance
              ? 'text-[var(--color-error)]'
              : isLowBalance
              ? 'text-amber-500'
              : 'text-[var(--accent-blue)]'
          }`}
        />
        <span
          className={`text-sm font-medium ${
            isCriticalBalance
              ? 'text-[var(--color-error)]'
              : isLowBalance
              ? 'text-amber-500'
              : 'text-[var(--text-secondary)]'
          }`}
        >
          {balance.toLocaleString()}
        </span>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Balance display */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Coins
            className={`h-5 w-5 ${
              isCriticalBalance
                ? 'text-[var(--color-error)]'
                : isLowBalance
                ? 'text-amber-500'
                : 'text-[var(--accent-blue)]'
            }`}
          />
          <span className="text-sm text-[var(--text-muted)]">Credits</span>
        </div>
        <span
          className={`text-lg font-semibold ${
            isCriticalBalance
              ? 'text-[var(--color-error)]'
              : isLowBalance
              ? 'text-amber-500'
              : 'text-[var(--text-primary)]'
          }`}
        >
          {balance.toLocaleString()}
        </span>
      </div>

      {/* Low balance warning */}
      {isLowBalance && (
        <div
          className={`flex items-center gap-2 text-xs ${
            isCriticalBalance ? 'text-[var(--color-error)]' : 'text-amber-500'
          }`}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>
            {isCriticalBalance
              ? 'Insufficient credits for operations'
              : 'Running low on credits'}
          </span>
        </div>
      )}

      {/* Buy more link */}
      {showBuyLink && (
        <Link
          href="/settings/billing"
          className="flex items-center gap-1.5 text-xs text-[var(--accent-blue)] hover:underline"
        >
          <Plus className="h-3 w-3" />
          <span>Buy more credits</span>
        </Link>
      )}

      {/* Tier badge */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--text-muted)]">Tier</span>
        <span className="capitalize text-[var(--text-secondary)]">{tier}</span>
      </div>
    </div>
  );
}

/**
 * CreditBalanceInline - Compact inline credit display.
 * For use in headers or navigation bars.
 */
export function CreditBalanceInline({ className = '' }: { className?: string }) {
  const { data, isLoading } = useQuery<CreditsResponse>({
    queryKey: ['credits'],
    queryFn: async () => {
      const res = await fetch('/api/credits');
      if (!res.ok) throw new Error('Failed to fetch credits');
      return res.json();
    },
    staleTime: 30_000,
    retry: 1,
  });

  if (isLoading || !data) {
    return null;
  }

  const { balance, costs } = data;
  const smsCost = costs?.SMS_SEND ?? 5;
  const isLowBalance = balance < 50 || balance < smsCost * 5;

  return (
    <Link
      href="/settings/billing"
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-colors ${
        isLowBalance
          ? 'border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20'
          : 'border-[var(--border-subtle)] bg-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)]'
      } ${className}`}
      title="Click to manage credits"
    >
      <Coins
        className={`h-4 w-4 ${
          isLowBalance ? 'text-amber-500' : 'text-[var(--accent-blue)]'
        }`}
      />
      <span
        className={`text-sm font-medium ${
          isLowBalance ? 'text-amber-500' : 'text-[var(--text-secondary)]'
        }`}
      >
        {balance.toLocaleString()}
      </span>
    </Link>
  );
}

/**
 * CreditCostBadge - Shows the credit cost for an action.
 * Useful in UI elements that trigger credit-consuming operations.
 */
interface CreditCostBadgeProps {
  action: string;
  className?: string;
  showLabel?: boolean;
}

export function CreditCostBadge({
  action,
  className = '',
  showLabel = true,
}: CreditCostBadgeProps) {
  const { data } = useQuery<CreditsResponse>({
    queryKey: ['credits'],
    queryFn: async () => {
      const res = await fetch('/api/credits');
      if (!res.ok) throw new Error('Failed to fetch credits');
      return res.json();
    },
    staleTime: 30_000,
    retry: 1,
  });

  const cost = data?.costs?.[action as keyof typeof data.costs];
  if (!cost) return null;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-[var(--text-muted)] ${className}`}
      title={`This action costs ${cost} credits`}
    >
      <Coins className="h-3 w-3" />
      {showLabel && <span>{cost}</span>}
      {!showLabel && <span className="sr-only">{cost} credits</span>}
    </span>
  );
}
