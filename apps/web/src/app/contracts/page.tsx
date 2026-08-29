'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText } from 'lucide-react';
import InspectionClockChip from '@/components/contracts/InspectionClockChip';
import ContractTimeline from '@/components/contracts/ContractTimeline';
import PaymentChip from '@/components/contracts/PaymentChip';

const statusConfig: Record<string, { dot: 'success' | 'warning' | 'error' | 'info' | 'neutral'; bg: string }> = {
  PENDING_SIGNATURE: { dot: 'warning', bg: 'bg-[var(--color-warning)]/10 text-[var(--color-warning)]' },
  SIGNED: { dot: 'success', bg: 'bg-[var(--color-success)]/10 text-[var(--color-success)]' },
  DRAFT: { dot: 'neutral', bg: 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]' },
  EXPIRED: { dot: 'error', bg: 'bg-[var(--color-error)]/10 text-[var(--color-error)]' },
};

export default function ContractsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();

  const { data: contracts, isLoading } = useQuery({
    queryKey: ['contracts'],
    queryFn: async () => {
      const res = await fetch('/api/contracts');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!session,
  });

  const handleRefund = async (paymentId: string) => {
    const reason = prompt('Please enter a reason for this refund:');
    if (!reason) return;

    const res = await fetch('/api/payments/refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId, reason }),
    });

    if (res.ok) {
      alert('Refund processed successfully.');
      await queryClient.invalidateQueries({ queryKey: ['contracts'] });
    } else {
      const { error } = await res.json();
      alert(`Error processing refund: ${error}`);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Contracts</h1>
        <p className="text-[var(--text-secondary)] mt-1">Manage and track contracts</p>
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
        </div>
      ) : !contracts || contracts.length === 0 ? (
        <GlassCard className="py-12 text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 text-[var(--text-muted)]" />
          <p className="text-[var(--text-secondary)]">No contracts yet.</p>
          <p className="text-sm text-[var(--text-muted)] mt-1">Contracts will appear here after deals are agreed.</p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {contracts.map((contract: any) => {
            const status = statusConfig[contract.status] || statusConfig.DRAFT;
            return (
              <GlassCard key={contract.id}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">Contract #{contract.id}</h3>
                  <div className={`flex items-center gap-2 px-3 py-1 rounded-full ${status.bg}`}>
                    <StatusDot status={status.dot} size="sm" />
                    <span className="text-xs font-medium">{contract.status}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <InspectionClockChip
                    createdAt={contract.created_at}
                    inspectionDays={contract.inspection_days}
                    assignedAt={contract.assigned_at}
                  />
                  <p className="text-sm text-[var(--text-muted)]">Direction: {contract.direction}</p>
                  <p className="text-sm text-[var(--text-muted)]">Created: {new Date(contract.created_at).toLocaleDateString()}</p>
                  {contract.signed_at && (
                    <p className="text-sm text-[var(--text-muted)]">Signed: {new Date(contract.signed_at).toLocaleDateString()}</p>
                  )}

                  {contract.payment && (
                    <div className="pt-3 border-t border-[var(--border-subtle)]">
                      <PaymentChip payment={contract.payment} onRefund={handleRefund} />
                    </div>
                  )}

                  {contract.esign_status && contract.esign_status !== 'pending' && (
                    <div className="pt-3 border-t border-[var(--border-subtle)]">
                      <ContractTimeline
                        events={contract.esign_events || []}
                        currentStatus={contract.esign_status}
                      />
                    </div>
                  )}
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
