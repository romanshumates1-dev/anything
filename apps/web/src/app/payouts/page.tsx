'use client';

import { useState } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { MetricValue } from '@/components/ui/MetricValue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Loader2,
  Wallet,
  Clock,
  Lock,
  TrendingUp,
  ArrowDownToLine,
  Building2,
  CreditCard,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  XCircle,
  ShieldCheck,
  Info,
} from 'lucide-react';

// Mock data - in production this would come from API
const mockBalanceData = {
  available: 1284500, // cents
  pending: 458000,
  onHold: 125000,
  totalEarnings: 3256800,
  minimumPayout: 10000, // $100 minimum
  bankAccount: {
    last4: '4567',
    bankName: 'Chase Bank',
    type: 'checking',
    verified: true,
  },
};

const mockPayoutHistory = [
  {
    id: 'pyo_1',
    amount: 234500,
    status: 'completed',
    requestedAt: '2026-08-25T14:30:00Z',
    completedAt: '2026-08-27T09:15:00Z',
    method: 'bank_transfer',
    reference: 'TRF-2026082701',
  },
  {
    id: 'pyo_2',
    amount: 156000,
    status: 'pending',
    requestedAt: '2026-08-28T10:00:00Z',
    completedAt: null,
    method: 'bank_transfer',
    reference: 'TRF-2026082801',
  },
  {
    id: 'pyo_3',
    amount: 89000,
    status: 'completed',
    requestedAt: '2026-08-15T16:45:00Z',
    completedAt: '2026-08-17T11:30:00Z',
    method: 'bank_transfer',
    reference: 'TRF-2026081701',
  },
  {
    id: 'pyo_4',
    amount: 45000,
    status: 'failed',
    requestedAt: '2026-08-10T09:20:00Z',
    completedAt: null,
    method: 'bank_transfer',
    reference: 'TRF-2026081001',
    failureReason: 'Invalid account details',
  },
  {
    id: 'pyo_5',
    amount: 312000,
    status: 'completed',
    requestedAt: '2026-08-01T12:00:00Z',
    completedAt: '2026-08-03T14:20:00Z',
    method: 'bank_transfer',
    reference: 'TRF-2026080301',
  },
];

type PayoutStatus = 'all' | 'completed' | 'pending' | 'failed';

const statusConfig: Record<string, { dot: 'success' | 'warning' | 'error' | 'info' | 'neutral'; label: string; bg: string }> = {
  completed: { dot: 'success', label: 'Completed', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  pending: { dot: 'warning', label: 'Processing', bg: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  failed: { dot: 'error', label: 'Failed', bg: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function BalanceCard({
  title,
  amount,
  icon: Icon,
  variant = 'default',
  description,
}: {
  title: string;
  amount: number;
  icon: React.ElementType;
  variant?: 'default' | 'success' | 'warning' | 'muted';
  description?: string;
}) {
  const variantStyles = {
    default: 'text-[var(--accent-blue)]',
    success: 'text-[var(--color-success)]',
    warning: 'text-amber-400',
    muted: 'text-[var(--text-muted)]',
  };

  return (
    <GlassCard variant="bordered" padding="md">
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm font-medium text-[var(--text-secondary)]">{title}</span>
        <div className={`p-2 rounded-lg bg-[var(--bg-tertiary)] ${variantStyles[variant]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <MetricValue value={amount / 100} format="currency" size="lg" />
      {description && (
        <p className="text-xs text-[var(--text-muted)] mt-2">{description}</p>
      )}
    </GlassCard>
  );
}

export default function PayoutsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const [statusFilter, setStatusFilter] = useState<PayoutStatus>('all');
  const [isRequestingPayout, setIsRequestingPayout] = useState(false);

  // In production, replace with actual API call
  const { data: balanceData, isLoading: balanceLoading } = useQuery({
    queryKey: ['payout-balance'],
    queryFn: async () => {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));
      return mockBalanceData;
    },
    enabled: !!session,
  });

  const { data: payoutHistory, isLoading: historyLoading } = useQuery({
    queryKey: ['payout-history', statusFilter],
    queryFn: async () => {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (statusFilter === 'all') {
        return mockPayoutHistory;
      }
      return mockPayoutHistory.filter((p) => p.status === statusFilter);
    },
    enabled: !!session,
  });

  const handleRequestPayout = async () => {
    if (!balanceData) return;

    if (balanceData.available < balanceData.minimumPayout) {
      alert(`Minimum payout amount is ${formatCurrency(balanceData.minimumPayout)}`);
      return;
    }

    setIsRequestingPayout(true);
    try {
      // In production, call actual API
      await new Promise((resolve) => setTimeout(resolve, 1000));
      alert('Payout request submitted successfully. Funds will be transferred within 2-3 business days.');
    } catch {
      alert('Failed to request payout. Please try again.');
    } finally {
      setIsRequestingPayout(false);
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

  const canRequestPayout = balanceData && balanceData.available >= balanceData.minimumPayout;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">Payouts</h1>
        <p className="text-[var(--text-secondary)] mt-1">
          Manage your earnings and request withdrawals
        </p>
      </div>

      {/* Balance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {balanceLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <GlassCard key={i} variant="bordered" padding="md">
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-[var(--bg-tertiary)] rounded w-24" />
                <div className="h-8 bg-[var(--bg-tertiary)] rounded w-32" />
              </div>
            </GlassCard>
          ))
        ) : balanceData ? (
          <>
            <BalanceCard
              title="Available Balance"
              amount={balanceData.available}
              icon={Wallet}
              variant="success"
              description="Ready for withdrawal"
            />
            <BalanceCard
              title="Pending"
              amount={balanceData.pending}
              icon={Clock}
              variant="warning"
              description="Contracts in progress"
            />
            <BalanceCard
              title="On Hold"
              amount={balanceData.onHold}
              icon={Lock}
              variant="muted"
              description="Awaiting legal binding"
            />
            <BalanceCard
              title="Total Earnings"
              amount={balanceData.totalEarnings}
              icon={TrendingUp}
              description="Lifetime earnings"
            />
          </>
        ) : null}
      </div>

      {/* Request Payout Section */}
      <GlassCard variant="elevated" padding="lg">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-1">
              Request Payout
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Transfer your available balance to your connected bank account
            </p>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-2 text-sm">
                <Info className="h-4 w-4 text-[var(--text-muted)]" />
                <span className="text-[var(--text-muted)]">
                  Minimum payout: {balanceData ? formatCurrency(balanceData.minimumPayout) : '-'}
                </span>
              </div>
              {balanceData?.bankAccount && (
                <div className="flex items-center gap-2">
                  <StatusDot status={balanceData.bankAccount.verified ? 'success' : 'warning'} size="sm" />
                  <span className="text-sm text-[var(--text-secondary)]">
                    Bank account on file
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={handleRequestPayout}
              disabled={!canRequestPayout || isRequestingPayout}
              className="btn-gradient px-6 py-2.5 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRequestingPayout ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ArrowDownToLine className="h-4 w-4 mr-2" />
              )}
              Request Payout
            </Button>
          </div>
        </div>
        {!canRequestPayout && balanceData && (
          <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <p className="text-sm text-amber-400 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Your available balance is below the minimum payout threshold
            </p>
          </div>
        )}
      </GlassCard>

      {/* Connected Account */}
      <GlassCard variant="bordered" padding="md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-lg bg-[var(--bg-tertiary)]">
              <Building2 className="h-6 w-6 text-[var(--text-secondary)]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                Connected Bank Account
              </h3>
              {balanceData?.bankAccount ? (
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-sm text-[var(--text-secondary)]">
                    {balanceData.bankAccount.bankName}
                  </span>
                  <span className="text-sm text-[var(--text-muted)]">
                    ****{balanceData.bankAccount.last4}
                  </span>
                  <Badge className="bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-subtle)] text-xs">
                    {balanceData.bankAccount.type}
                  </Badge>
                  {balanceData.bankAccount.verified && (
                    <div className="flex items-center gap-1 text-[var(--color-success)]">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">Verified</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)] mt-1">No bank account connected</p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2">
            <CreditCard className="h-4 w-4" />
            Update Payment Method
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </GlassCard>

      {/* Payout History */}
      <GlassCard variant="bordered" padding="none">
        <div className="p-4 border-b border-[var(--border-subtle)]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">Payout History</h2>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as PayoutStatus)}>
              <SelectTrigger className="w-[160px] bg-[var(--bg-tertiary)] border-[var(--border-subtle)]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payouts</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="pending">Processing</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {historyLoading ? (
          <div className="py-12 flex justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--accent-blue)]" />
          </div>
        ) : !payoutHistory || payoutHistory.length === 0 ? (
          <div className="py-12 text-center">
            <Wallet className="h-12 w-12 mx-auto mb-4 text-[var(--text-muted)]" />
            <p className="text-[var(--text-secondary)]">No payouts found</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              {statusFilter !== 'all'
                ? 'Try changing the filter to see more results'
                : 'Request your first payout when you have available funds'}
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-[var(--border-subtle)] hover:bg-transparent">
                <TableHead className="text-[var(--text-secondary)]">Reference</TableHead>
                <TableHead className="text-[var(--text-secondary)]">Amount</TableHead>
                <TableHead className="text-[var(--text-secondary)]">Status</TableHead>
                <TableHead className="text-[var(--text-secondary)]">Requested</TableHead>
                <TableHead className="text-[var(--text-secondary)]">Completed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payoutHistory.map((payout) => {
                const status = statusConfig[payout.status];
                const StatusIcon =
                  payout.status === 'completed'
                    ? CheckCircle2
                    : payout.status === 'pending'
                      ? Clock
                      : XCircle;

                return (
                  <TableRow
                    key={payout.id}
                    className="border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]/50"
                  >
                    <TableCell className="font-mono text-sm text-[var(--text-primary)]">
                      {payout.reference}
                    </TableCell>
                    <TableCell className="font-semibold text-[var(--text-primary)]">
                      {formatCurrency(payout.amount)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge className={`${status.bg} border`}>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {status.label}
                        </Badge>
                        {payout.status === 'failed' && payout.failureReason && (
                          <span
                            className="text-xs text-red-400 cursor-help"
                            title={payout.failureReason}
                          >
                            <AlertCircle className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-[var(--text-secondary)]">
                      {formatDate(payout.requestedAt)}
                    </TableCell>
                    <TableCell className="text-sm text-[var(--text-secondary)]">
                      {formatDate(payout.completedAt)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </GlassCard>

      {/* Security Notice */}
      <div className="p-4 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border-subtle)]">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-[var(--accent-blue)] mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-[var(--text-primary)]">
              Secure Transfers
            </h4>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              All payouts are processed through secure banking channels with bank-level encryption.
              Transfers typically complete within 2-3 business days.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
