'use client';

import Link from 'next/link';
import { Mail, MapPin, ExternalLink } from 'lucide-react';

interface CANSPAMFooterProps {
  variant?: 'email' | 'preview' | 'component';
  /**
   * @deprecated Accepted for API compatibility only. Tokens are minted
   * server-side; this component never builds one from a contact id.
   */
  contactId?: string;
  /** Server-minted, already-signed one-click unsubscribe URL. */
  unsubscribeUrl?: string;
  className?: string;
}

/**
 * CANSPAMFooter - CAN-SPAM compliant footer for email marketing.
 *
 * Use variants:
 * - 'email': Raw HTML for embedding in emails (no React components)
 * - 'preview': React component preview of what the email footer looks like
 * - 'component': Interactive component for display in the app
 *
 * Note: The actual email footer is injected by emailDriver.ts via withCanSpamFooter()
 * This component is for UI display and documentation purposes.
 */
export function CANSPAMFooter({
  variant = 'component',
  unsubscribeUrl,
  className = '',
}: CANSPAMFooterProps) {
  const physicalAddress = process.env.NEXT_PUBLIC_COMPANY_ADDRESS || '123 Main St, Dover, DE 19901';

  // The unsubscribe link MUST be minted server-side (`withCanSpamFooter` in
  // api/utils/emailDriver.ts) and passed in. A previous version built a token
  // here from `${contactId}:placeholder`, which is base64 — not an HMAC — and
  // would have exposed the unsubscribe secret to every recipient. There is
  // deliberately no token construction left in this client component.
  const unsub = unsubscribeUrl || '#';

  // Email variant - return info about what gets injected
  if (variant === 'email') {
    return (
      <div className={`p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] ${className}`}>
        <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Mail className="h-4 w-4" />
          CAN-SPAM Email Footer (Auto-Injected)
        </h4>
        <p className="text-sm text-[var(--text-secondary)] mb-3">
          The following footer is automatically added to all outbound marketing emails by the system:
        </p>
        <div className="p-3 rounded-lg bg-[var(--bg-primary)] border border-dashed border-[var(--border-medium)] text-xs font-mono text-[var(--text-muted)]">
          <p>You are receiving this email as part of a real estate investment inquiry.</p>
          <p className="mt-1">{physicalAddress}</p>
          <p className="mt-1 text-[var(--accent-blue)]">[Unsubscribe Link]</p>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-3">
          This footer is injected by <code className="text-[var(--accent-blue)]">emailDriver.ts</code> and
          includes a unique unsubscribe token for each recipient.
        </p>
      </div>
    );
  }

  // Preview variant - shows what the footer looks like in emails
  if (variant === 'preview') {
    return (
      <div className={`border-t border-[var(--border-subtle)] pt-4 mt-6 ${className}`}>
        <div className="text-center text-sm text-[var(--text-muted)] space-y-2">
          <p>You are receiving this email as part of a real estate investment inquiry.</p>
          <p className="flex items-center justify-center gap-1">
            <MapPin className="h-3 w-3" />
            {physicalAddress}
          </p>
          <p>
            <a href={unsub} className="text-[var(--accent-blue)] hover:underline">
              Unsubscribe
            </a>
          </p>
        </div>
      </div>
    );
  }

  // Component variant (default) - interactive display
  return (
    <div className={`p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] ${className}`}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10">
          <Mail className="h-5 w-5 text-[var(--accent-blue)]" />
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            CAN-SPAM Compliance
          </h4>
          <p className="text-sm text-[var(--text-secondary)] mb-3">
            All marketing emails sent through the platform automatically include:
          </p>
          <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] mt-2 shrink-0" />
              <span>Clear identification as a marketing message</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] mt-2 shrink-0" />
              <span>Your physical mailing address</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-success)] mt-2 shrink-0" />
              <span>One-click unsubscribe link (honored within 10 days)</span>
            </li>
          </ul>
          <div className="flex flex-wrap gap-4 mt-4 pt-3 border-t border-[var(--border-subtle)]">
            <Link
              href="/legal/acceptable-use"
              className="text-xs text-[var(--accent-blue)] hover:underline flex items-center gap-1"
            >
              Acceptable Use Policy
              <ExternalLink className="h-3 w-3" />
            </Link>
            <Link
              href="/trust"
              className="text-xs text-[var(--accent-blue)] hover:underline flex items-center gap-1"
            >
              Compliance Center
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

