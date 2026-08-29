'use client';

import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { Badge } from '@/components/ui/badge';
import { Loader2, FileText, Shield, ShieldCheck, Clock, Calendar, DollarSign, AlertTriangle, CheckCircle2, Lock, Unlock } from 'lucide-react';
import InspectionClockChip from '@/components/contracts/InspectionClockChip';
import ContractTimeline from '@/components/contracts/ContractTimeline';
import PaymentChip from '@/components/contracts/PaymentChip';

const statusConfig: Record<string, { dot: 'success' | 'warning' | 'error' | 'info' | 'neutral'; bg: string; label: string }> = {
  PENDING_SIGNATURE: { dot: 'warning', bg: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Pending Signature' },
  SIGNED: { dot: 'info', bg: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Signed' },
  DRAFT: { dot: 'neutral', bg: 'bg-gray-50 text-gray-600 border-gray-200', label: 'Draft' },
  EXPIRED: { dot: 'error', bg: 'bg-red-50 text-red-700 border-red-200', label: 'Expired' },
  CLOSED: { dot: 'success', bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Closed' },
};

interface ContractData {
  id: string;
  direction: string;
  status: string;
  signed_at: string | null;
  created_at: string;
  inspection_days: number;
  assigned_at: string | null;
  esign_status: string;
  contract_price_cents: number | null;
  assignment_fee_cents: number | null;
  metadata: {
    closingDate?: string;
    closing_date?: string;
    property_address?: string;
    buyer_name?: string;
    seller_name?: string;
  } | null;
  esign_events: any[];
  payment: any;
}

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function getCloseDateInfo(closingDate: string | undefined): {
  daysRemaining: number;
  urgency: 'normal' | 'approaching' | 'imminent' | 'past';
  label: string;
} {
  if (!closingDate) {
    return { daysRemaining: 0, urgency: 'normal', label: 'TBD' };
  }

  const closeDate = new Date(closingDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  closeDate.setHours(0, 0, 0, 0);

  const diffTime = closeDate.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  let urgency: 'normal' | 'approaching' | 'imminent' | 'past' = 'normal';
  let label: string;

  if (daysRemaining < 0) {
    urgency = 'past';
    label = `${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) !== 1 ? 's' : ''} overdue`;
  } else if (daysRemaining === 0) {
    urgency = 'imminent';
    label = 'Closes today';
  } else if (daysRemaining <= 3) {
    urgency = 'imminent';
    label = `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} to close`;
  } else if (daysRemaining <= 7) {
    urgency = 'approaching';
    label = `${daysRemaining} days to close`;
  } else {
    label = `${daysRemaining} days to close`;
  }

  return { daysRemaining, urgency, label };
}

function isLegallyBinding(contract: ContractData): boolean {
  return contract.esign_status === 'countersigned' || contract.status === 'CLOSED';
}

function CloseCountdownBadge({ closingDate, status }: { closingDate: string | undefined; status: string }) {
  if (status === 'CLOSED' || status === 'EXPIRED') return null;

  const { urgency, label } = getCloseDateInfo(closingDate);

  const urgencyStyles = {
    normal: 'bg-gray-50 text-gray-600 border-gray-200',
    approaching: 'bg-amber-50 text-amber-700 border-amber-200',
    imminent: 'bg-red-50 text-red-700 border-red-200',
    past: 'bg-red-100 text-red-800 border-red-300',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium ${urgencyStyles[urgency]}`}>
      <Clock className="h-3 w-3" />
      {label}
    </span>
  );
}

function FundsHoldIndicator({ contract }: { contract: ContractData }) {
  const binding = isLegallyBinding(contract);
  const isClosed = contract.status === 'CLOSED';

  if (isClosed) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
        <Unlock className="h-4 w-4 text-emerald-600" />
        <div>
          <span className="text-sm font-medium text-emerald-700">Funds Released</span>
          <p className="text-xs text-emerald-600">Transaction complete</p>
        </div>
      </div>
    );
  }

  if (binding) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200">
        <ShieldCheck className="h-4 w-4 text-blue-600" />
        <div>
          <span className="text-sm font-medium text-blue-700">Legally Binding</span>
          <p className="text-xs text-blue-600">Funds protected until close</p>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 cursor-help">
      <Lock className="h-4 w-4 text-amber-600" />
      <div>
        <span className="text-sm font-medium text-amber-700">Funds On Hold</span>
        <p className="text-xs text-amber-600">Pending full execution</p>
      </div>
      <div className="absolute bottom-full left-0 mb-2 hidden group-hover:block w-64 p-2 bg-gray-900 text-white text-xs rounded-lg shadow-lg z-10">
        Funds are held until the contract is fully executed by all parties. This protects against clawbacks and ensures secure transactions.
        <div className="absolute bottom-0 left-4 transform translate-y-1/2 rotate-45 w-2 h-2 bg-gray-900"></div>
      </div>
    </div>
  );
}

function ContractStatusSection({ contract }: { contract: ContractData }) {
  const closingDate = contract.metadata?.closingDate || contract.metadata?.closing_date;
  const { urgency } = getCloseDateInfo(closingDate);

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-3">
      <div className="space-y-1">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Created</span>
        <p className="text-sm font-medium text-gray-900">{formatDate(contract.created_at)}</p>
      </div>
      <div className="space-y-1">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Signed</span>
        <p className="text-sm font-medium text-gray-900">{formatDate(contract.signed_at)}</p>
      </div>
      <div className="space-y-1">
        <span className="text-xs text-gray-500 uppercase tracking-wide">Assigned</span>
        <p className="text-sm font-medium text-gray-900">{formatDate(contract.assigned_at)}</p>
      </div>
      <div className="space-y-1">
        <span className={`text-xs uppercase tracking-wide ${
          urgency === 'past' ? 'text-red-600' : urgency === 'imminent' ? 'text-red-500' : urgency === 'approaching' ? 'text-amber-500' : 'text-gray-500'
        }`}>
          Close Date
        </span>
        <p className={`text-sm font-medium ${
          urgency === 'past' ? 'text-red-700' : urgency === 'imminent' ? 'text-red-600' : 'text-gray-900'
        }`}>
          {formatDate(closingDate)}
        </p>
      </div>
    </div>
  );
}

function ContractLifecycleTimeline({ contract }: { contract: ContractData }) {
  const stages = [
    { key: 'draft', label: 'Draft', icon: FileText },
    { key: 'pending', label: 'Sent', icon: Clock },
    { key: 'signed', label: 'Signed', icon: Shield },
    { key: 'countersigned', label: 'Executed', icon: ShieldCheck },
    { key: 'closed', label: 'Closed', icon: CheckCircle2 },
  ];

  const getStageIndex = () => {
    if (contract.status === 'CLOSED') return 4;
    if (contract.esign_status === 'countersigned') return 3;
    if (contract.esign_status === 'signed') return 2;
    if (contract.esign_status === 'sent' || contract.esign_status === 'viewed') return 1;
    return 0;
  };

  const currentIndex = getStageIndex();

  return (
    <div className="relative">
      <div className="flex items-center justify-between">
        {stages.map((stage, idx) => {
          const Icon = stage.icon;
          const isComplete = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const isPast = contract.status === 'EXPIRED' && idx > 0;

          return (
            <div key={stage.key} className="flex flex-col items-center relative z-10">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all ${
                isPast
                  ? 'bg-gray-100 border-gray-200 text-gray-400'
                  : isComplete
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : isCurrent
                      ? 'bg-blue-500 border-blue-500 text-white ring-4 ring-blue-100'
                      : 'bg-white border-gray-200 text-gray-400'
              }`}>
                <Icon className="h-4 w-4" />
              </div>
              <span className={`mt-1.5 text-xs font-medium ${
                isPast ? 'text-gray-400' : isCurrent ? 'text-blue-600' : isComplete ? 'text-emerald-600' : 'text-gray-400'
              }`}>
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>
      {/* Progress line */}
      <div className="absolute top-4 left-4 right-4 h-0.5 bg-gray-200 -z-0">
        <div
          className="h-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${(currentIndex / (stages.length - 1)) * 100}%` }}
        />
      </div>
    </div>
  );
}

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
        <div className="space-y-4">
          {contracts.map((contract: ContractData) => {
            const status = statusConfig[contract.status] || statusConfig.DRAFT;
            const closingDate = contract.metadata?.closingDate || contract.metadata?.closing_date;
            const { urgency } = getCloseDateInfo(closingDate);
            const binding = isLegallyBinding(contract);

            // Card border color based on urgency
            const cardBorderClass = urgency === 'past'
              ? 'ring-2 ring-red-300'
              : urgency === 'imminent'
                ? 'ring-2 ring-amber-300'
                : '';

            return (
              <GlassCard key={contract.id} className={`relative overflow-hidden ${cardBorderClass}`}>
                {/* Urgency banner for overdue/imminent */}
                {urgency === 'past' && (
                  <div className="absolute top-0 left-0 right-0 bg-red-500 text-white text-xs font-medium py-1 px-3 flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    Past close date - Action required
                  </div>
                )}
                {urgency === 'imminent' && contract.status !== 'CLOSED' && (
                  <div className="absolute top-0 left-0 right-0 bg-amber-500 text-white text-xs font-medium py-1 px-3 flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    Closing soon - Prepare for settlement
                  </div>
                )}

                <div className={urgency === 'past' || urgency === 'imminent' ? 'pt-6' : ''}>
                  {/* Header Section */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-[var(--text-primary)]">
                          Contract #{contract.id.slice(-8).toUpperCase()}
                        </h3>
                        {binding && (
                          <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300">
                            <ShieldCheck className="h-3 w-3 mr-1" />
                            Legally Binding
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${status.bg}`}>
                          <StatusDot status={status.dot} size="sm" />
                          <span className="text-xs font-medium">{status.label}</span>
                        </div>
                        <CloseCountdownBadge closingDate={closingDate} status={contract.status} />
                        <span className="text-xs text-gray-500 px-2 py-1 bg-gray-50 rounded-full border border-gray-200">
                          {contract.direction}
                        </span>
                      </div>
                    </div>

                    {/* Contract Value */}
                    {(contract.contract_price_cents || contract.assignment_fee_cents) && (
                      <div className="text-right">
                        {contract.contract_price_cents && (
                          <div className="mb-1">
                            <span className="text-xs text-gray-500 block">Contract Value</span>
                            <span className="text-xl font-bold text-[var(--text-primary)]">
                              {formatCurrency(contract.contract_price_cents)}
                            </span>
                          </div>
                        )}
                        {contract.assignment_fee_cents && (
                          <div className="flex items-center gap-1 justify-end">
                            <DollarSign className="h-3 w-3 text-emerald-500" />
                            <span className="text-sm font-semibold text-emerald-600">
                              {formatCurrency(contract.assignment_fee_cents)} fee
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Lifecycle Timeline */}
                  <div className="mb-4 p-3 bg-gray-50/50 rounded-lg border border-gray-100">
                    <ContractLifecycleTimeline contract={contract} />
                  </div>

                  {/* Contract Status Dates */}
                  <div className="border-t border-b border-gray-100 mb-4">
                    <ContractStatusSection contract={contract} />
                  </div>

                  {/* Funds Hold and Inspection Row */}
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <FundsHoldIndicator contract={contract} />
                    <InspectionClockChip
                      createdAt={contract.created_at}
                      inspectionDays={contract.inspection_days}
                      assignedAt={contract.assigned_at}
                    />
                  </div>

                  {/* Payment Section */}
                  {contract.payment && (
                    <div className="pt-3 border-t border-gray-100">
                      <h4 className="text-sm font-medium text-gray-500 mb-2">Payment Status</h4>
                      <PaymentChip payment={contract.payment} onRefund={handleRefund} />
                    </div>
                  )}

                  {/* E-Sign Timeline */}
                  {contract.esign_status && contract.esign_status !== 'pending' && (
                    <div className="pt-3 border-t border-gray-100">
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
