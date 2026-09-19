'use client';

import Link from 'next/link';
import { Home, Users, Scale, ExternalLink } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';

interface FairHousingNoticeProps {
  variant?: 'full' | 'compact' | 'badge';
  className?: string;
}

/**
 * Fair Housing Notice component displaying equal opportunity and fair housing compliance.
 * Should be shown on marketing materials, campaign pages, and property listings.
 */
export function FairHousingNotice({ variant = 'badge', className = '' }: FairHousingNoticeProps) {
  // Badge variant - small inline badge
  if (variant === 'badge') {
    return (
      <div className={`inline-flex items-center gap-2 ${className}`}>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
          <Home className="h-3.5 w-3.5 text-[var(--accent-blue)]" />
          <span className="text-xs font-medium text-[var(--text-secondary)]">Equal Housing Opportunity</span>
        </div>
      </div>
    );
  }

  // Compact variant - small box with essential info
  if (variant === 'compact') {
    return (
      <div
        className={`p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] ${className}`}
      >
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10">
            <Home className="h-5 w-5 text-[var(--accent-blue)]" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-1">
              Fair Housing Commitment
            </h4>
            <p className="text-sm text-[var(--text-secondary)]">
              We are committed to fair housing practices and do not discriminate based on race, color,
              religion, national origin, sex, familial status, disability, or any other protected class.
            </p>
            <Link
              href="/legal/disclaimers#fair-housing-statement"
              className="text-xs text-[var(--accent-blue)] hover:underline mt-2 inline-flex items-center gap-1"
            >
              Learn more
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Full variant - comprehensive fair housing notice
  return (
    <GlassCard className={className}>
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20 mb-4">
          <Home className="h-8 w-8 text-[var(--accent-blue)]" />
        </div>
        <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">
          Equal Housing Opportunity
        </h3>
        <p className="text-[var(--text-secondary)] mb-6 max-w-2xl mx-auto">
          We are committed to fair housing and equal opportunity in all real estate activities.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Fair Housing Statement */}
        <div className="p-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 mb-3">
            <Scale className="h-5 w-5 text-[var(--accent-blue)]" />
            <h4 className="font-semibold text-[var(--text-primary)]">Fair Housing Act Compliance</h4>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            We comply with the Fair Housing Act and all applicable fair housing laws. We do not discriminate
            in the provision of services, marketing, or any real estate activities based on:
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[var(--text-secondary)]">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)]" />
              Race, color, or national origin
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)]" />
              Religion or creed
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)]" />
              Sex, gender identity, or sexual orientation
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)]" />
              Familial status (families with children)
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-blue)]" />
              Disability or handicap
            </li>
          </ul>
        </div>

        {/* User Expectations */}
        <div className="p-4 rounded-xl bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-5 w-5 text-[var(--accent-purple)]" />
            <h4 className="font-semibold text-[var(--text-primary)]">User Expectations</h4>
          </div>
          <p className="text-sm text-[var(--text-secondary)]">
            All users of this platform are expected to comply with fair housing laws in their marketing,
            communications, and transactions. This includes:
          </p>
          <ul className="mt-3 space-y-1 text-sm text-[var(--text-secondary)]">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-purple)]" />
              Non-discriminatory marketing practices
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-purple)]" />
              Equal treatment of all potential buyers/sellers
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-purple)]" />
              Avoiding discriminatory criteria in campaigns
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-purple)]" />
              Compliance with local fair housing ordinances
            </li>
          </ul>
          <div className="mt-4 p-3 rounded-lg bg-[var(--color-warning)]/5 border border-[var(--color-warning)]/20">
            <p className="text-xs text-[var(--color-warning)]">
              <strong>Note:</strong> Discriminatory use of our platform is strictly prohibited and may
              result in immediate account termination.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 pt-4 border-t border-[var(--border-subtle)] flex flex-wrap justify-center gap-6">
        <Link
          href="/legal/disclaimers"
          className="text-sm text-[var(--accent-blue)] hover:underline flex items-center gap-1"
        >
          Full Disclaimers
          <ExternalLink className="h-3 w-3" />
        </Link>
        <Link
          href="/legal/acceptable-use"
          className="text-sm text-[var(--accent-blue)] hover:underline flex items-center gap-1"
        >
          Acceptable Use Policy
          <ExternalLink className="h-3 w-3" />
        </Link>
        <a
          href="https://www.hud.gov/program_offices/fair_housing_equal_opp"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1"
        >
          HUD Fair Housing
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </GlassCard>
  );
}
