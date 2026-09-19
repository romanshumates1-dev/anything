'use client';

/**
 * Phase P2 — Payment status chip component.
 *
 * Displays payment status on the contract card with amount, status badge,
 * and owner refund button.
 */
import React, { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, ExternalLink, RotateCcw, CheckCircle } from 'lucide-react';

export interface PaymentData {
  id: string;
  amount_cents: number;
  currency: string;
  status: 'created' | 'sent' | 'paid' | 'failed' | 'refunded';
  stripe_payment_intent_id?: string;
  paymentLink?: string;
  paid_at?: string;
  refunded_at?: string;
  reason?: string;
}

interface PaymentChipProps {
  payment: PaymentData;
  onRefund?: (paymentId: string) => Promise<void>;
  onMarkAsPaid?: (paymentId: string) => Promise<void>;
}

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  created: { label: 'Pending', color: 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-subtle)]' },
  sent: { label: 'Payment Sent', color: 'bg-[var(--color-info)]/10 text-[var(--color-info)] border-[var(--color-info)]/30' },
  paid: { label: 'Paid', color: 'bg-[var(--color-success)]/10 text-[var(--color-success)] border-[var(--color-success)]/30' },
  failed: { label: 'Failed', color: 'bg-[var(--color-error)]/10 text-[var(--color-error)] border-[var(--color-error)]/30' },
  refunded: { label: 'Refunded', color: 'bg-[var(--accent-purple)]/10 text-[var(--accent-purple)] border-[var(--accent-purple)]/30' },
};

export default function PaymentChip({ payment, onRefund, onMarkAsPaid }: PaymentChipProps) {
  const [refunding, setRefunding] = useState(false);
  const [markingAsPaid, setMarkingAsPaid] = useState(false);
  const amount = (payment.amount_cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: payment.currency.toUpperCase(),
  });

  const style = STATUS_STYLES[payment.status] || STATUS_STYLES.created;

  const handleRefund = async () => {
    if (!onRefund || !confirm('Refund this payment? This action is logged.')) return;
    setRefunding(true);
    try {
      await onRefund(payment.id);
    } finally {
      setRefunding(false);
    }
  };

  const handleMarkAsPaid = async () => {
    if (!onMarkAsPaid || !confirm('Manually mark this payment as paid? This action is for payments handled externally (e.g., wire transfer) and is logged.')) return;
    setMarkingAsPaid(true);
    try {
      await onMarkAsPaid(payment.id);
    } finally {
      setMarkingAsPaid(false);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm font-medium">{amount}</span>
      <Badge variant="outline" className={style.color}>
        {style.label}
      </Badge>

      {payment.status === 'sent' && payment.paymentLink && (
        <a
          href={payment.paymentLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--accent-blue)] hover:text-[var(--accent-blue)]/80"
        >
          <ExternalLink className="h-3 w-3" />
          Pay
        </a>
      )}

      {payment.status === 'paid' && onRefund && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-[var(--text-muted)] hover:text-[var(--color-error)]"
          onClick={handleRefund}
          disabled={refunding}
        >
          {refunding ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          Refund
        </Button>
      )}

      {(payment.status === 'created' || payment.status === 'sent') && onMarkAsPaid && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-[var(--text-muted)] hover:text-[var(--color-success)]"
          onClick={handleMarkAsPaid}
          disabled={markingAsPaid}
        >
          {markingAsPaid ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <CheckCircle className="h-3 w-3" />
          )}
          Mark as Paid
        </Button>
      )}

      {payment.paid_at && (
        <span className="text-xs text-[var(--text-muted)]">
          Paid {new Date(payment.paid_at).toLocaleDateString()}
        </span>
      )}

      {payment.reason && payment.status === 'refunded' && (
        <span className="text-xs text-[var(--text-muted)]">
          Reason: {payment.reason}
        </span>
      )}
    </div>
  );
}