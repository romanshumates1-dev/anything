'use client';

import Link from 'next/link';
import { Building2, Scale, AlertCircle, ExternalLink } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';

interface RealEstateDisclaimerProps {
  variant?: 'full' | 'compact' | 'inline';
  className?: string;
}

/**
 * Real Estate Disclaimer component clarifying that the platform is not a brokerage
 * and does not provide real estate, legal, or financial advice.
 */
export function RealEstateDisclaimer({ variant = 'full', className = '' }: RealEstateDisclaimerProps) {
  // Inline variant - single line for footers/headers
  if (variant === 'inline') {
    return (
      <p className={`text-sm text-[var(--text-muted)] ${className}`}>
        {process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME || 'DealFlow AI'} is a software platform, not a real
        estate brokerage.{' '}
        <Link href="/legal/disclaimers" className="text-[var(--accent-blue)] hover:underline">
          Disclaimers
        </Link>
      </p>
    );
  }

  // Compact variant - small box
  if (variant === 'compact') {
    return (
      <div
        className={`p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] ${className}`}
      >
        <div className="flex items-start gap-2">
          <Building2 className="h-4 w-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">Not a Brokerage:</strong> This platform is a
              software tool. We do not provide real estate, legal, or financial advice.
            </p>
            <Link
              href="/legal/disclaimers"
              className="text-xs text-[var(--accent-blue)] hover:underline mt-1 inline-flex items-center gap-1"
            >
              View full disclaimers
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Full variant - comprehensive disclaimer
  return (
    <GlassCard className={className}>
      <div className="flex items-start gap-4">
        <div className="p-3 rounded-xl bg-[var(--accent-blue)]/10 shrink-0">
          <Building2 className="h-6 w-6 text-[var(--accent-blue)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
            Platform Disclaimer
          </h3>

          <div className="space-y-4">
            {/* Not a Brokerage */}
            <div className="flex items-start gap-3">
              <Building2 className="h-5 w-5 text-[var(--text-muted)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Not a Real Estate Brokerage</p>
                <p className="text-sm text-[var(--text-secondary)]">
                  {process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME || 'DealFlow AI'} is a software platform that
                  provides tools for real estate investors. We are not a licensed real estate brokerage and
                  do not buy, sell, list, or represent any property or any party in a transaction.
                </p>
              </div>
            </div>

            {/* Not Legal Advice */}
            <div className="flex items-start gap-3">
              <Scale className="h-5 w-5 text-[var(--text-muted)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Not Legal or Financial Advice</p>
                <p className="text-sm text-[var(--text-secondary)]">
                  Nothing on this platform constitutes legal, financial, tax, or investment advice. Contract
                  templates are examples only. Always consult licensed professionals before entering into any
                  transaction.
                </p>
              </div>
            </div>

            {/* Your Responsibility */}
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-[var(--text-muted)] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">Your Responsibility</p>
                <p className="text-sm text-[var(--text-secondary)]">
                  You are solely responsible for complying with all applicable laws, including real estate
                  licensing requirements, wholesaling regulations, disclosure requirements, and fair housing
                  laws in your jurisdiction.
                </p>
              </div>
            </div>
          </div>

          {/* Learn More Links */}
          <div className="flex flex-wrap gap-4 mt-6 pt-4 border-t border-[var(--border-subtle)]">
            <Link
              href="/legal/disclaimers"
              className="text-sm text-[var(--accent-blue)] hover:underline flex items-center gap-1"
            >
              Full Disclaimers
              <ExternalLink className="h-3 w-3" />
            </Link>
            <Link
              href="/legal/terms"
              className="text-sm text-[var(--accent-blue)] hover:underline flex items-center gap-1"
            >
              Terms of Service
              <ExternalLink className="h-3 w-3" />
            </Link>
            <Link
              href="/trust"
              className="text-sm text-[var(--accent-blue)] hover:underline flex items-center gap-1"
            >
              Compliance Center
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
