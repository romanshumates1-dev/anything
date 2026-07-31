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
  created: { label: 'Pending', color: 'bg-gray-50 text-gray-600 border-gray-200' },
  sent: { label: 'Payment Sent', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  paid: { label: 'Paid', color: 'bg-green-50 text-green-700 border-green-200' },
  failed: { label: 'Failed', color: 'bg-red-50 text-red-700 border-red-200' },
  refunded: { label: 'Refunded', color: 'bg-purple-50 text-purple-700 border-purple-200' },
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
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
        >
          <ExternalLink className="h-3 w-3" />
          Pay
        </a>
      )}

      {payment.status === 'paid' && onRefund && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs text-gray-500 hover:text-red-600"
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
          className="h-6 text-xs text-gray-500 hover:text-green-600"
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
        <span className="text-xs text-gray-400">
          Paid {new Date(payment.paid_at).toLocaleDateString()}
        </span>
      )}

      {payment.reason && payment.status === 'refunded' && (
        <span className="text-xs text-gray-400">
          Reason: {payment.reason}
        </span>
      )}
    </div>
  );
}