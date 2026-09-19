'use client';

import Link from 'next/link';
import { AlertCircle, Building2, Scale, FileText, X } from 'lucide-react';
import { useState } from 'react';

interface LegalDisclaimerBannerProps {
  variant?: 'full' | 'compact' | 'dismissible';
  showOnce?: boolean;
  storageKey?: string;
  className?: string;
}

/**
 * LegalDisclaimerBanner - Displays platform-wide legal disclaimers.
 * Use at the top of key pages to remind users of platform limitations.
 */
export function LegalDisclaimerBanner({
  variant = 'compact',
  showOnce = false,
  storageKey = 'legal-disclaimer-dismissed',
  className = '',
}: LegalDisclaimerBannerProps) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined' || !showOnce) return false;
    return localStorage.getItem(storageKey) === 'true';
  });

  const handleDismiss = () => {
    setDismissed(true);
    if (showOnce && typeof window !== 'undefined') {
      localStorage.setItem(storageKey, 'true');
    }
  };

  if (dismissed) return null;

  const legalEntity = process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME || 'DealFlow AI';

  // Full variant - comprehensive banner with all disclaimers
  if (variant === 'full') {
    return (
      <div className={`bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-xl p-6 ${className}`}>
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-[var(--accent-blue)]/10 shrink-0">
            <Scale className="h-6 w-6 text-[var(--accent-blue)]" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-3">
              Important Legal Information
            </h3>
            <div className="space-y-3 text-sm text-[var(--text-secondary)]">
              <div className="flex items-start gap-2">
                <Building2 className="h-4 w-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
                <p>
                  <strong className="text-[var(--text-primary)]">Not a Brokerage:</strong>{' '}
                  {legalEntity} is a software platform, not a licensed real estate brokerage.
                  We do not buy, sell, or represent properties or parties.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <Scale className="h-4 w-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
                <p>
                  <strong className="text-[var(--text-primary)]">Not Legal Advice:</strong>{' '}
                  Nothing on this platform constitutes legal, financial, or real estate advice.
                  Contract templates are examples only. Always consult licensed professionals.
                </p>
              </div>
              <div className="flex items-start gap-2">
                <FileText className="h-4 w-4 text-[var(--text-muted)] shrink-0 mt-0.5" />
                <p>
                  <strong className="text-[var(--text-primary)]">Your Responsibility:</strong>{' '}
                  You are solely responsible for compliance with all applicable laws, including
                  TCPA, CAN-SPAM, fair housing laws, and state-specific real estate regulations.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-[var(--border-subtle)]">
              <Link
                href="/legal/disclaimers"
                className="text-sm text-[var(--accent-blue)] hover:underline"
              >
                Full Disclaimers
              </Link>
              <Link
                href="/legal/terms"
                className="text-sm text-[var(--accent-blue)] hover:underline"
              >
                Terms of Service
              </Link>
              <Link
                href="/legal/privacy"
                className="text-sm text-[var(--accent-blue)] hover:underline"
              >
                Privacy Policy
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Dismissible variant - can be closed by user
  if (variant === 'dismissible') {
    return (
      <div className={`bg-[var(--accent-blue)]/5 border border-[var(--accent-blue)]/20 rounded-lg p-4 ${className}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-[var(--accent-blue)] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-[var(--text-secondary)]">
                <strong className="text-[var(--text-primary)]">{legalEntity}</strong> is a software
                tool, not a brokerage. We do not provide legal, financial, or real estate advice.{' '}
                <Link href="/legal/disclaimers" className="text-[var(--accent-blue)] hover:underline">
                  View disclaimers
                </Link>
              </p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors shrink-0"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4 text-[var(--text-muted)]" />
          </button>
        </div>
      </div>
    );
  }

  // Compact variant (default) - single line
  return (
    <div className={`bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg px-4 py-3 ${className}`}>
      <p className="text-sm text-[var(--text-muted)] text-center">
        {legalEntity} is a software platform, not a real estate brokerage.{' '}
        <Link href="/legal/disclaimers" className="text-[var(--accent-blue)] hover:underline">
          View disclaimers
        </Link>
        {' | '}
        <Link href="/legal/terms" className="text-[var(--accent-blue)] hover:underline">
          Terms
        </Link>
        {' | '}
        <Link href="/legal/privacy" className="text-[var(--accent-blue)] hover:underline">
          Privacy
        </Link>
      </p>
    </div>
  );
}
