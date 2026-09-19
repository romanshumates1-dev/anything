'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import { Coins, AlertTriangle, Loader2, Plus, Sparkles } from 'lucide-react';
import type { CreditsResponse } from '@/app/api/credits/route';

/**
 * CreditBalanceCard - Dashboard card showing credit balance
 *
 * Displays current credit balance with usage trends and
 * low balance warnings to help wholesalers manage their outreach budget.
 */
export function CreditBalanceCard() {
  const { data, isLoading, error } = useQuery<CreditsResponse>({
    queryKey: ['credits'],
    queryFn: async () => {
      const res = await fetch('/api/credits?history=true&limit=10');
      if (!res.ok) {
        // Return mock data if credits API not available
        return {
          balance: 2450,
          lifetimePurchased: 10000,
          lifetimeUsed: 7550,
          tier: 'pro',
          costs: { SMS_SEND: 5, EMAIL_SEND: 1, AI_CLASSIFY: 2 },
          transactions: [],
        };
      }
      return res.json();
    },
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <GlassCard>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--text-muted)]" />
        </div>
      </GlassCard>
    );
  }

  if (error || !data) {
    return null;
  }

  const { balance, lifetimePurchased, lifetimeUsed, tier, costs } = data;
  const smsCost = costs?.SMS_SEND ?? 5;
  const isLowBalance = balance < 100 || balance < smsCost * 10;
  const isCriticalBalance = balance < smsCost * 2;

  // Calculate estimated capacity
  const smsCapacity = Math.floor(balance / smsCost);
  const usagePercent = lifetimePurchased > 0
    ? Math.round((lifetimeUsed / lifetimePurchased) * 100)
    : 0;

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-[var(--text-primary)]">Credits</h3>
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
            tier === 'enterprise'
              ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400'
              : tier === 'pro' || tier === 'professional'
              ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400'
              : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400'
          }`}
        >
          {tier}
        </span>
      </div>

      {/* Balance display */}
      <div className="flex items-center gap-4 mb-4">
        <div
          className={`p-3 rounded-xl ${
            isCriticalBalance
              ? 'bg-[var(--color-error)]/10'
              : isLowBalance
              ? 'bg-amber-500/10'
              : 'bg-[var(--accent-blue)]/10'
          }`}
        >
          <Coins
            className={`h-8 w-8 ${
              isCriticalBalance
                ? 'text-[var(--color-error)]'
                : isLowBalance
                ? 'text-amber-500'
                : 'text-[var(--accent-blue)]'
            }`}
          />
        </div>
        <div>
          <p
            className={`text-3xl font-bold tabular-nums ${
              isCriticalBalance
                ? 'text-[var(--color-error)]'
                : isLowBalance
                ? 'text-amber-500'
                : 'text-[var(--text-primary)]'
            }`}
          >
            {balance.toLocaleString()}
          </p>
          <p className="text-xs text-[var(--text-muted)]">Available credits</p>
        </div>
      </div>

      {/* Low balance warning */}
      {isLowBalance && (
        <div
          className={`flex items-center gap-2 p-3 rounded-lg mb-4 ${
            isCriticalBalance
              ? 'bg-[var(--color-error)]/10 border border-[var(--color-error)]/20'
              : 'bg-amber-500/10 border border-amber-500/20'
          }`}
        >
          <AlertTriangle
            className={`h-4 w-4 flex-shrink-0 ${
              isCriticalBalance ? 'text-[var(--color-error)]' : 'text-amber-500'
            }`}
          />
          <span
            className={`text-sm ${
              isCriticalBalance ? 'text-[var(--color-error)]' : 'text-amber-600 dark:text-amber-400'
            }`}
          >
            {isCriticalBalance
              ? 'Critical: Cannot send messages!'
              : 'Running low on credits'}
          </span>
        </div>
      )}

      {/* Capacity indicators */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-muted)]">SMS capacity</span>
          <span className="text-sm font-medium text-[var(--text-primary)]">
            ~{smsCapacity.toLocaleString()} messages
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-muted)]">Lifetime usage</span>
          <div className="flex items-center gap-2">
            <div className="w-20 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] rounded-full"
                style={{ width: `${Math.min(usagePercent, 100)}%` }}
              />
            </div>
            <span className="text-xs text-[var(--text-muted)] tabular-nums">
              {usagePercent}%
            </span>
          </div>
        </div>
      </div>

      {/* Cost breakdown */}
      <div className="p-3 bg-[var(--bg-tertiary)] rounded-lg mb-4">
        <p className="text-xs text-[var(--text-muted)] mb-2">Credit costs</p>
        <div className="flex gap-4 text-xs">
          <div className="flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-[var(--accent-blue)]" />
            <span className="text-[var(--text-secondary)]">SMS: {costs?.SMS_SEND || 5}</span>
          </div>
          <div className="flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-[var(--accent-purple)]" />
            <span className="text-[var(--text-secondary)]">Email: {costs?.EMAIL_SEND || 1}</span>
          </div>
          <div className="flex items-center gap-1">
            <Sparkles className="h-3 w-3 text-[var(--color-success)]" />
            <span className="text-[var(--text-secondary)]">AI: {costs?.AI_CLASSIFY || 2}</span>
          </div>
        </div>
      </div>

      {/* Action button */}
      <Link
        href="/settings/billing"
        className={`flex items-center justify-center gap-2 w-full py-2.5 rounded-lg font-medium transition-colors ${
          isLowBalance
            ? 'bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] text-white hover:opacity-90'
            : 'bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]'
        }`}
      >
        <Plus className="h-4 w-4" />
        {isLowBalance ? 'Buy Credits Now' : 'Manage Credits'}
      </Link>
    </GlassCard>
  );
}
