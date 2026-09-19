'use client';

import Link from 'next/link';
import { Sparkles } from 'lucide-react';

interface FreePlanBadgeProps {
  className?: string;
}

/**
 * FreePlanBadge - Shows "Free Plan" badge for free tier users.
 *
 * Design principles:
 * - Clear but not intrusive
 * - Links to pricing for easy upgrade path
 * - No pressure tactics, just transparency
 */
export function FreePlanBadge({ className = '' }: FreePlanBadgeProps) {
  return (
    <Link
      href="/pricing"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
        bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]
        text-xs font-medium text-[var(--text-secondary)]
        hover:bg-[var(--accent-blue)]/10 hover:border-[var(--accent-blue)]/30
        hover:text-[var(--accent-blue)] transition-colors ${className}`}
      title="You're on the Free plan. Click to see upgrade options."
    >
      <Sparkles className="h-3 w-3" />
      <span>Free Plan</span>
    </Link>
  );
}

/**
 * PlanBadge - Generic plan badge that shows the current plan name.
 */
interface PlanBadgeProps {
  planName: string;
  tier: string;
  className?: string;
}

export function PlanBadge({ planName, tier, className = '' }: PlanBadgeProps) {
  const colors: Record<string, string> = {
    free: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-subtle)]',
    starter: 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border-[var(--accent-blue)]/30',
    professional: 'bg-[var(--accent-purple)]/10 text-[var(--accent-purple)] border-[var(--accent-purple)]/30',
    enterprise: 'bg-amber-500/10 text-amber-500 border-amber-500/30',
  };

  const colorClass = colors[tier.toLowerCase()] || colors.starter;

  if (tier.toLowerCase() === 'free') {
    return <FreePlanBadge className={className} />;
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full
        border text-xs font-medium ${colorClass} ${className}`}
    >
      {planName}
    </span>
  );
}
