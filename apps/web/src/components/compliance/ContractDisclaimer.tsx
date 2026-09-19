'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, FileText, Scale, CheckCircle2, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';

interface ContractDisclaimerProps {
  variant?: 'banner' | 'modal' | 'inline' | 'compact';
  showAcknowledgment?: boolean;
  onAcknowledge?: () => void;
  className?: string;
}

/**
 * Contract Disclaimer component to be shown when users view or create contracts.
 * Reminds users that templates are not legal advice and should be reviewed by an attorney.
 */
export function ContractDisclaimer({
  variant = 'banner',
  showAcknowledgment = false,
  onAcknowledge,
  className = '',
}: ContractDisclaimerProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Compact variant for inline use
  if (variant === 'compact') {
    return (
      <div className={`flex items-center gap-2 text-sm text-[var(--text-muted)] ${className}`}>
        <Scale className="h-4 w-4 shrink-0" />
        <span>
          Contract templates are examples only.{' '}
          <Link href="/legal/disclaimers" className="text-[var(--accent-blue)] hover:underline">
            View disclaimers
          </Link>
        </span>
      </div>
    );
  }

  // Inline variant for embedding in forms
  if (variant === 'inline') {
    return (
      <div
        className={`p-4 rounded-xl bg-[var(--color-warning)]/5 border border-[var(--color-warning)]/20 ${className}`}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-[var(--color-warning)] shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-[var(--text-primary)]">Contract Template Disclaimer</p>
            <p className="text-sm text-[var(--text-secondary)] mt-1">
              This template is provided as an example only and may not comply with your jurisdiction's
              requirements. Have an attorney review before use.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Banner variant (default)
  const bannerContent = (
    <div className={`${className}`}>
      <GlassCard className="border-l-4 border-l-[var(--color-warning)]">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-[var(--color-warning)]/10 shrink-0">
            <Scale className="h-6 w-6 text-[var(--color-warning)]" />
          </div>
          <div className="flex-1">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
                  Important Contract Disclaimer
                </h3>
                <p className="text-[var(--text-secondary)]">
                  All contract templates are provided as examples only and do not constitute legal advice.
                </p>
              </div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-2 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                {expanded ? (
                  <ChevronUp className="h-5 w-5 text-[var(--text-muted)]" />
                ) : (
                  <ChevronDown className="h-5 w-5 text-[var(--text-muted)]" />
                )}
              </button>
            </div>

            {expanded && (
              <div className="mt-4 space-y-4 animate-fade-in-up">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="h-4 w-4 text-[var(--text-muted)]" />
                      <span className="text-sm font-medium text-[var(--text-primary)]">Templates Are Examples</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Contract templates may not comply with your state or local requirements. Laws vary by
                      jurisdiction and change over time.
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)]">
                    <div className="flex items-center gap-2 mb-2">
                      <Scale className="h-4 w-4 text-[var(--text-muted)]" />
                      <span className="text-sm font-medium text-[var(--text-primary)]">Consult an Attorney</span>
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">
                      Have all contracts reviewed by a licensed attorney in your jurisdiction before use.
                      The platform does not provide legal advice.
                    </p>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
                  <p className="text-sm text-[var(--text-secondary)]">
                    <strong className="text-[var(--text-primary)]">Your Responsibility:</strong> You are
                    solely responsible for ensuring any contract you use is valid, enforceable, and
                    compliant with all applicable laws. The platform makes no warranty regarding the legal
                    sufficiency of any template.
                  </p>
                </div>

                <div className="flex flex-wrap gap-4 text-sm">
                  <Link
                    href="/legal/disclaimers"
                    className="text-[var(--accent-blue)] hover:underline flex items-center gap-1"
                  >
                    Full Disclaimers
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                  <Link
                    href="/legal/terms"
                    className="text-[var(--accent-blue)] hover:underline flex items-center gap-1"
                  >
                    Terms of Service
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </div>
            )}

            {showAcknowledgment && (
              <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => {
                      setAcknowledged(e.target.checked);
                      if (e.target.checked && onAcknowledge) {
                        onAcknowledge();
                      }
                    }}
                    className="mt-1 h-5 w-5 rounded border-[var(--border-medium)] text-[var(--accent-blue)] focus:ring-[var(--accent-blue)]"
                  />
                  <span className="text-sm text-[var(--text-secondary)]">
                    I understand that these templates are examples only, may not comply with my jurisdiction's
                    requirements, and should be reviewed by a licensed attorney before use. I am solely
                    responsible for the legal validity of any contracts I use.
                  </span>
                </label>
              </div>
            )}
          </div>
        </div>
      </GlassCard>
    </div>
  );

  // Modal variant
  if (variant === 'modal') {
    return (
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="max-w-lg w-full">
          {bannerContent}
          {showAcknowledgment && (
            <button
              onClick={onAcknowledge}
              disabled={!acknowledged}
              className="w-full mt-4 btn-gradient py-3 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              I Understand - Continue
            </button>
          )}
        </div>
      </div>
    );
  }

  return bannerContent;
}
