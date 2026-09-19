'use client';

import Link from 'next/link';
import { Home } from 'lucide-react';

interface ComplianceFooterProps {
  variant?: 'full' | 'minimal';
  showFairHousing?: boolean;
  className?: string;
}

/**
 * Compliance Footer component for use at the bottom of pages.
 * Includes links to legal documents and required compliance notices.
 */
export function ComplianceFooter({
  variant = 'full',
  showFairHousing = true,
  className = '',
}: ComplianceFooterProps) {
  const legalEntity = process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME || 'DealFlow AI';
  const currentYear = new Date().getFullYear();

  // Minimal variant - single line
  if (variant === 'minimal') {
    return (
      <div className={`text-center text-sm text-[var(--text-muted)] ${className}`}>
        <p>
          {legalEntity} is a software platform, not a real estate brokerage.{' '}
          <Link href="/legal/disclaimers" className="text-[var(--accent-blue)] hover:underline">
            Disclaimers
          </Link>{' '}
          |{' '}
          <Link href="/legal/terms" className="text-[var(--accent-blue)] hover:underline">
            Terms
          </Link>{' '}
          |{' '}
          <Link href="/legal/privacy" className="text-[var(--accent-blue)] hover:underline">
            Privacy
          </Link>
        </p>
      </div>
    );
  }

  // Full variant
  return (
    <footer className={`border-t border-[var(--border-subtle)] ${className}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Legal Links */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Legal</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/legal/terms"
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/privacy"
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Privacy Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/acceptable-use"
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Acceptable Use Policy
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/disclaimers"
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Disclaimers
                </Link>
              </li>
            </ul>
          </div>

          {/* Messaging Compliance */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Messaging</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/legal/sms-terms"
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  SMS Terms
                </Link>
              </li>
              <li>
                <Link
                  href="/trust"
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Compliance Center
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/cookies"
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Cookie Policy
                </Link>
              </li>
            </ul>
          </div>

          {/* Other */}
          <div>
            <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Support</h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/contact"
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  Contact Us
                </Link>
              </li>
              <li>
                <Link
                  href="/faq"
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  FAQ
                </Link>
              </li>
              <li>
                <Link
                  href="/legal/dmca"
                  className="text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  DMCA Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-[var(--border-subtle)] mt-8 pt-8">
          {/* Main Disclaimer */}
          <div className="text-center space-y-4">
            <p className="text-sm text-[var(--text-muted)]">
              {legalEntity} is a software platform that provides tools for real estate investors.{' '}
              <strong className="text-[var(--text-secondary)]">
                We are not a real estate brokerage and do not provide legal, financial, or real estate advice.
              </strong>
            </p>

            <p className="text-xs text-[var(--text-muted)]">
              All contract templates are examples only and may not comply with your jurisdiction's requirements.
              Always consult a licensed attorney before entering into any contract or transaction.
            </p>

            {/* Fair Housing Badge */}
            {showFairHousing && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
                  <Home className="h-3.5 w-3.5 text-[var(--accent-blue)]" />
                  <span className="text-xs font-medium text-[var(--text-secondary)]">
                    Equal Housing Opportunity
                  </span>
                </div>
              </div>
            )}

            {/* Copyright */}
            <p className="text-xs text-[var(--text-muted)] pt-4">
              {currentYear} {legalEntity}. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
