'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Shield, CheckCircle2, AlertTriangle, Loader2, FileText, ExternalLink } from 'lucide-react';
import { GlassCard } from '@/components/ui/GlassCard';

interface MessagingComplianceWallProps {
  onComplete: () => void;
  className?: string;
}

/**
 * Messaging Compliance Wall - A one-time gate that users must pass before
 * they can activate any campaign or send messages through the platform.
 * Records acceptance in legal_acceptances table.
 */
export function MessagingComplianceWall({ onComplete, className = '' }: MessagingComplianceWallProps) {
  const [acceptedTerms, setAcceptedTerms] = useState({
    tcpa: false,
    canSpam: false,
    dnc: false,
    liability: false,
  });

  const allAccepted = Object.values(acceptedTerms).every(Boolean);

  // Check if user has already accepted
  const { data: hasAccepted, isLoading: checkingAcceptance } = useQuery({
    queryKey: ['messaging-acceptance'],
    queryFn: async () => {
      const res = await fetch('/api/legal/messaging-acceptance');
      if (!res.ok) return false;
      const data = await res.json();
      return data.accepted;
    },
  });

  // Submit acceptance
  const acceptMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/legal/messaging-acceptance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acceptedTerms: {
            tcpa_acknowledged: true,
            canspam_acknowledged: true,
            dnc_acknowledged: true,
            liability_acknowledged: true,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to record acceptance');
      }
      return res.json();
    },
    onSuccess: () => {
      onComplete();
    },
  });

  // If already accepted, just proceed
  if (hasAccepted) {
    onComplete();
    return null;
  }

  if (checkingAcceptance) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  const requirements = [
    {
      key: 'tcpa' as const,
      title: 'TCPA Compliance',
      description:
        'I understand that I must obtain prior express written consent before sending SMS messages, and that violations can result in $500-$1,500 per message penalties.',
      icon: Shield,
    },
    {
      key: 'canSpam' as const,
      title: 'CAN-SPAM Compliance',
      description:
        'I understand that all email marketing must comply with CAN-SPAM, including accurate header information, clear identification as advertising, and honoring unsubscribe requests within 10 business days.',
      icon: FileText,
    },
    {
      key: 'dnc' as const,
      title: 'Do Not Call Compliance',
      description:
        'I understand that I must scrub my contact lists against the National Do Not Call Registry and honor all opt-out requests. I am responsible for maintaining my own internal DNC list.',
      icon: AlertTriangle,
    },
    {
      key: 'liability' as const,
      title: 'Acknowledgment of Liability',
      description:
        'I understand that I am solely responsible for all messages sent through my account. The platform is a tool that facilitates communication but does not provide legal advice or guarantee compliance. I agree to indemnify the platform for any claims arising from my messaging activities.',
      icon: CheckCircle2,
    },
  ];

  return (
    <div className={`max-w-2xl mx-auto space-y-6 ${className}`}>
      <GlassCard>
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--color-success)]/20 mb-4">
            <Shield className="h-8 w-8 text-[var(--accent-blue)]" />
          </div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
            Messaging Compliance Agreement
          </h2>
          <p className="text-[var(--text-secondary)]">
            Before you can send messages through the platform, you must acknowledge your legal
            responsibilities for compliance with messaging laws.
          </p>
        </div>

        <div className="space-y-4 mb-8">
          {requirements.map((req) => {
            const Icon = req.icon;
            const isChecked = acceptedTerms[req.key];

            return (
              <label
                key={req.key}
                className={`
                  flex items-start gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all
                  ${
                    isChecked
                      ? 'border-[var(--color-success)] bg-[var(--color-success)]/5'
                      : 'border-[var(--border-subtle)] hover:border-[var(--accent-blue)]'
                  }
                `}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) =>
                    setAcceptedTerms((prev) => ({ ...prev, [req.key]: e.target.checked }))
                  }
                  className="mt-1 h-5 w-5 rounded border-[var(--border-medium)] text-[var(--color-success)] focus:ring-[var(--color-success)]"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon
                      className={`h-4 w-4 ${
                        isChecked ? 'text-[var(--color-success)]' : 'text-[var(--text-muted)]'
                      }`}
                    />
                    <h3
                      className={`font-medium ${
                        isChecked ? 'text-[var(--color-success)]' : 'text-[var(--text-primary)]'
                      }`}
                    >
                      {req.title}
                    </h3>
                  </div>
                  <p className="text-sm text-[var(--text-secondary)]">{req.description}</p>
                </div>
              </label>
            );
          })}
        </div>

        {/* Important Notice */}
        <div className="p-4 rounded-xl bg-[var(--color-warning)]/5 border border-[var(--color-warning)]/30 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-[var(--color-warning)] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--color-warning)]">Important Notice</p>
              <p className="text-sm text-[var(--text-secondary)] mt-1">
                This agreement is legally binding. By accepting, you acknowledge that you have read and
                understood our{' '}
                <Link href="/legal/acceptable-use" className="text-[var(--accent-blue)] hover:underline">
                  Acceptable Use Policy
                </Link>
                ,{' '}
                <Link href="/legal/sms-terms" className="text-[var(--accent-blue)] hover:underline">
                  SMS Terms
                </Link>
                , and{' '}
                <Link href="/legal/terms" className="text-[var(--accent-blue)] hover:underline">
                  Terms of Service
                </Link>
                .
              </p>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          onClick={() => acceptMutation.mutate()}
          disabled={!allAccepted || acceptMutation.isPending}
          className="w-full btn-gradient py-3 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {acceptMutation.isPending ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Recording acceptance...
            </>
          ) : (
            <>
              <CheckCircle2 className="h-5 w-5" />
              I Accept - Enable Messaging
            </>
          )}
        </button>

        {acceptMutation.isError && (
          <p className="text-sm text-[var(--color-error)] text-center mt-4">
            {acceptMutation.error?.message || 'An error occurred. Please try again.'}
          </p>
        )}

        {/* Footer Links */}
        <div className="flex justify-center gap-6 mt-6 text-sm">
          <Link
            href="/trust"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1"
          >
            Compliance Center
            <ExternalLink className="h-3 w-3" />
          </Link>
          <Link
            href="/contact"
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] flex items-center gap-1"
          >
            Questions? Contact Us
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </GlassCard>
    </div>
  );
}
