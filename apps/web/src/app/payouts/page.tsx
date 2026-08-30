'use client';

import { useState, useCallback } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { StatusDot } from '@/components/ui/StatusDot';
import { MetricValue } from '@/components/ui/MetricValue';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  Copy,
  Check,
  Banknote,
  CalendarClock,
  Sparkles,
  ArrowRight,
  RefreshCw,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Mock data - in production this would come from API
const mockBalanceData = {
  available: 1284500, // cents
  pending: 458000,
  onHold: 125000,
  totalEarnings: 3256800,
  minimumPayout: 10000, // $100 minimum
  processingFee: 0, // Free transfers
  estimatedArrivalDays: 2,
  bankAccount: {
    last4: '4567',
    bankName: 'Chase Bank',
    type: 'checking',
    verified: true,
    addedAt: '2026-05-15T10:00:00Z',
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
    estimatedArrival: '2026-08-30T17:00:00Z',
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

function formatDate(dateStr: string | null, includeTime = true): string {
  if (!dateStr) return '-';
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  };
  if (includeTime) {
    options.hour = '2-digit';
    options.minute = '2-digit';
  }
  return new Date(dateStr).toLocaleDateString('en-US', options);
}

function getRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays > 1 && diffDays <= 7) return `In ${diffDays} days`;
  return formatDate(dateStr, false);
}

// Skeleton components for loading states
function BalanceCardSkeleton() {
  return (
    <div className="glass-card p-6 rounded-xl animate-pulse">
      <div className="flex items-start justify-between mb-4">
        <div className="h-4 bg-[var(--bg-tertiary)] rounded w-24" />
        <div className="h-10 w-10 bg-[var(--bg-tertiary)] rounded-lg" />
      </div>
      <div className="h-10 bg-[var(--bg-tertiary)] rounded w-36 mb-2" />
      <div className="h-3 bg-[var(--bg-tertiary)] rounded w-28" />
    </div>
  );
}

function TableRowSkeleton() {
  return (
    <TableRow className="border-[var(--border-subtle)]">
      <TableCell><div className="h-4 bg-[var(--bg-tertiary)] rounded w-28 animate-pulse" /></TableCell>
      <TableCell><div className="h-4 bg-[var(--bg-tertiary)] rounded w-20 animate-pulse" /></TableCell>
      <TableCell><div className="h-6 bg-[var(--bg-tertiary)] rounded w-24 animate-pulse" /></TableCell>
      <TableCell><div className="h-4 bg-[var(--bg-tertiary)] rounded w-32 animate-pulse" /></TableCell>
      <TableCell><div className="h-4 bg-[var(--bg-tertiary)] rounded w-32 animate-pulse" /></TableCell>
    </TableRow>
  );
}

// Hero balance card with gradient background
function HeroBalanceCard({
  amount,
  isLoading,
}: {
  amount: number;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="relative overflow-hidden rounded-2xl p-8 animate-pulse"
        style={{
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%)',
        }}>
        <div className="h-5 bg-[var(--bg-tertiary)] rounded w-32 mb-4" />
        <div className="h-16 bg-[var(--bg-tertiary)] rounded w-48 mb-2" />
        <div className="h-4 bg-[var(--bg-tertiary)] rounded w-40" />
      </div>
    );
  }

  return (
    <div
      className="relative overflow-hidden rounded-2xl p-8 transition-all duration-300 hover:shadow-[0_0_40px_rgba(16,185,129,0.2)] group"
      style={{
        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(59, 130, 246, 0.1) 100%)',
        border: '1px solid rgba(16, 185, 129, 0.3)',
      }}
    >
      {/* Decorative elements */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:bg-emerald-500/15 transition-colors duration-500" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-4">
          <Wallet className="h-5 w-5 text-emerald-400" />
          <span className="text-sm font-medium text-emerald-400 uppercase tracking-wide">
            Available Balance
          </span>
        </div>

        <div className="mb-2">
          <span className="text-5xl md:text-6xl font-bold text-[var(--text-primary)] font-mono tracking-tight">
            {formatCurrency(amount)}
          </span>
        </div>

        <p className="text-sm text-[var(--text-secondary)] flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          Ready for instant withdrawal
        </p>
      </div>
    </div>
  );
}

// Enhanced balance cards with hover effects
function BalanceCard({
  title,
  amount,
  icon: Icon,
  variant = 'default',
  description,
  isLoading,
}: {
  title: string;
  amount: number;
  icon: React.ElementType;
  variant?: 'default' | 'success' | 'warning' | 'muted';
  description?: string;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return <BalanceCardSkeleton />;
  }

  const variantStyles = {
    default: {
      icon: 'text-[var(--accent-blue)] bg-blue-500/10',
      glow: 'group-hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]',
    },
    success: {
      icon: 'text-emerald-400 bg-emerald-500/10',
      glow: 'group-hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]',
    },
    warning: {
      icon: 'text-amber-400 bg-amber-500/10',
      glow: 'group-hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]',
    },
    muted: {
      icon: 'text-[var(--text-muted)] bg-[var(--bg-tertiary)]',
      glow: 'group-hover:shadow-[0_0_20px_rgba(100,116,139,0.1)]',
    },
  };

  const styles = variantStyles[variant];

  return (
    <div
      className={cn(
        'glass-card p-6 rounded-xl transition-all duration-300 group cursor-default',
        'hover:translate-y-[-2px] hover:border-[var(--border-medium)]',
        styles.glow
      )}
    >
      <div className="flex items-start justify-between mb-3">
        <span className="text-sm font-medium text-[var(--text-secondary)]">{title}</span>
        <div className={cn('p-2.5 rounded-lg transition-transform duration-300 group-hover:scale-110', styles.icon)}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <MetricValue value={amount / 100} format="currency" size="lg" />
      {description && (
        <p className="text-xs text-[var(--text-muted)] mt-2">{description}</p>
      )}
    </div>
  );
}

// Progress indicator for pending payouts
function PendingPayoutProgress({ requestedAt, estimatedArrival }: { requestedAt: string; estimatedArrival?: string }) {
  const start = new Date(requestedAt).getTime();
  const end = estimatedArrival ? new Date(estimatedArrival).getTime() : start + (2 * 24 * 60 * 60 * 1000);
  const now = Date.now();
  const progress = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1.5">
        <span>Processing</span>
        <span>{estimatedArrival ? getRelativeTime(estimatedArrival) : 'Est. 2-3 days'}</span>
      </div>
      <div className="h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

// Copy button component
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(label ? `${label} copied` : 'Copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  }, [text, label]);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{copied ? 'Copied!' : 'Copy reference'}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function PayoutsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<PayoutStatus>('all');
  const [isRequestingPayout, setIsRequestingPayout] = useState(false);
  const [payoutMode, setPayoutMode] = useState<'full' | 'custom'>('full');
  const [customAmount, setCustomAmount] = useState('');

  // In production, replace with actual API call
  const { data: balanceData, isLoading: balanceLoading, refetch: refetchBalance } = useQuery({
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

    const amountCents = payoutMode === 'full'
      ? balanceData.available
      : Math.round(parseFloat(customAmount || '0') * 100);

    if (amountCents < balanceData.minimumPayout) {
      toast.error(`Minimum payout amount is ${formatCurrency(balanceData.minimumPayout)}`);
      return;
    }

    if (amountCents > balanceData.available) {
      toast.error('Amount exceeds available balance');
      return;
    }

    setIsRequestingPayout(true);
    try {
      // In production, call actual API
      await new Promise((resolve) => setTimeout(resolve, 1200));

      toast.success(
        <div className="flex flex-col gap-1">
          <span className="font-medium">Payout requested successfully</span>
          <span className="text-sm text-[var(--text-secondary)]">
            {formatCurrency(amountCents)} will arrive in 2-3 business days
          </span>
        </div>,
        { duration: 5000 }
      );

      // Reset form
      setPayoutMode('full');
      setCustomAmount('');

      // Refetch data
      queryClient.invalidateQueries({ queryKey: ['payout-balance'] });
      queryClient.invalidateQueries({ queryKey: ['payout-history'] });
    } catch {
      toast.error('Failed to request payout. Please try again.');
    } finally {
      setIsRequestingPayout(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
          <p className="text-sm text-[var(--text-muted)]">Loading your payouts...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    redirect('/account/signin');
  }

  const canRequestPayout = balanceData && balanceData.available >= balanceData.minimumPayout;
  const effectiveAmount = payoutMode === 'full'
    ? (balanceData?.available || 0)
    : Math.round(parseFloat(customAmount || '0') * 100);
  const isValidAmount = effectiveAmount >= (balanceData?.minimumPayout || 0) && effectiveAmount <= (balanceData?.available || 0);

  const pendingPayout = payoutHistory?.find(p => p.status === 'pending');

  return (
    <div className="space-y-8 max-w-5xl pb-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Payouts</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Manage your earnings and request withdrawals
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchBalance()}
          className="gap-2 self-start"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Hero Balance Card */}
      <HeroBalanceCard
        amount={balanceData?.available || 0}
        isLoading={balanceLoading}
      />

      {/* Secondary Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <BalanceCard
          title="Pending"
          amount={balanceData?.pending || 0}
          icon={Clock}
          variant="warning"
          description="Contracts in progress"
          isLoading={balanceLoading}
        />
        <BalanceCard
          title="On Hold"
          amount={balanceData?.onHold || 0}
          icon={Lock}
          variant="muted"
          description="Awaiting legal binding"
          isLoading={balanceLoading}
        />
        <BalanceCard
          title="Total Earnings"
          amount={balanceData?.totalEarnings || 0}
          icon={TrendingUp}
          description="Lifetime earnings"
          isLoading={balanceLoading}
        />
      </div>

      {/* Active Pending Payout Alert */}
      {pendingPayout && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20">
              <CalendarClock className="h-5 w-5 text-amber-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-sm font-semibold text-amber-400">Payout in Progress</h4>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                  {formatCurrency(pendingPayout.amount)}
                </Badge>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                Reference: <span className="font-mono">{pendingPayout.reference}</span>
              </p>
              <PendingPayoutProgress
                requestedAt={pendingPayout.requestedAt}
                estimatedArrival={(pendingPayout as typeof pendingPayout & { estimatedArrival?: string }).estimatedArrival}
              />
            </div>
          </div>
        </div>
      )}

      {/* Request Payout Section */}
      <GlassCard variant="elevated" padding="none" className="overflow-hidden">
        <div className="p-6 border-b border-[var(--border-subtle)]">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20">
              <ArrowDownToLine className="h-5 w-5 text-[var(--accent-blue)]" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">
              Request Payout
            </h2>
          </div>
          <p className="text-sm text-[var(--text-secondary)] ml-12">
            Transfer your available balance to your connected bank account
          </p>
        </div>

        <div className="p-6">
          {/* Quick Actions */}
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <button
              onClick={() => setPayoutMode('full')}
              className={cn(
                'flex-1 p-4 rounded-xl border-2 transition-all duration-200 text-left',
                payoutMode === 'full'
                  ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/5'
                  : 'border-[var(--border-subtle)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-tertiary)]/50'
              )}
            >
              <div className="flex items-center gap-3 mb-2">
                <Sparkles className={cn(
                  'h-5 w-5 transition-colors',
                  payoutMode === 'full' ? 'text-[var(--accent-blue)]' : 'text-[var(--text-muted)]'
                )} />
                <span className="font-medium text-[var(--text-primary)]">Full Amount</span>
              </div>
              <p className="text-2xl font-bold font-mono text-[var(--text-primary)]">
                {formatCurrency(balanceData?.available || 0)}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Withdraw your entire available balance</p>
            </button>

            <button
              onClick={() => setPayoutMode('custom')}
              className={cn(
                'flex-1 p-4 rounded-xl border-2 transition-all duration-200 text-left',
                payoutMode === 'custom'
                  ? 'border-[var(--accent-blue)] bg-[var(--accent-blue)]/5'
                  : 'border-[var(--border-subtle)] hover:border-[var(--border-medium)] hover:bg-[var(--bg-tertiary)]/50'
              )}
            >
              <div className="flex items-center gap-3 mb-2">
                <Banknote className={cn(
                  'h-5 w-5 transition-colors',
                  payoutMode === 'custom' ? 'text-[var(--accent-blue)]' : 'text-[var(--text-muted)]'
                )} />
                <span className="font-medium text-[var(--text-primary)]">Custom Amount</span>
              </div>
              {payoutMode === 'custom' ? (
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">$</span>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="pl-7 text-xl font-bold font-mono bg-[var(--bg-tertiary)] border-[var(--border-subtle)]"
                    min={0}
                    max={(balanceData?.available || 0) / 100}
                    step="0.01"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : (
                <>
                  <p className="text-2xl font-bold font-mono text-[var(--text-muted)]">$0.00</p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">Specify a partial withdrawal</p>
                </>
              )}
            </button>
          </div>

          {/* Info Row */}
          <div className="flex flex-wrap items-center gap-4 mb-6 text-sm">
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <Info className="h-4 w-4" />
              <span>Min: {balanceData ? formatCurrency(balanceData.minimumPayout) : '-'}</span>
            </div>
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <Clock className="h-4 w-4" />
              <span>Arrives in 2-3 business days</span>
            </div>
            <div className="flex items-center gap-2 text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              <span>No fees</span>
            </div>
          </div>

          {/* Submit Button */}
          <Button
            onClick={handleRequestPayout}
            disabled={!canRequestPayout || isRequestingPayout || (payoutMode === 'custom' && !isValidAmount)}
            className="btn-gradient w-full sm:w-auto px-8 py-3 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed text-base"
          >
            {isRequestingPayout ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              <>
                <ArrowDownToLine className="h-5 w-5 mr-2" />
                Request {formatCurrency(effectiveAmount)}
                <ArrowRight className="h-4 w-4 ml-2" />
              </>
            )}
          </Button>

          {/* Warnings */}
          {!canRequestPayout && balanceData && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                Your available balance is below the minimum payout threshold of {formatCurrency(balanceData.minimumPayout)}
              </p>
            </div>
          )}
        </div>
      </GlassCard>

      {/* Connected Account */}
      <GlassCard variant="bordered" padding="md" className="group hover:border-[var(--border-medium)] transition-all duration-300">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 rounded-xl bg-gradient-to-br from-[var(--bg-tertiary)] to-[var(--bg-surface)] border border-[var(--border-subtle)] group-hover:border-[var(--border-medium)] transition-colors">
              <Building2 className="h-6 w-6 text-[var(--text-secondary)]" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-[var(--text-primary)]">
                Connected Bank Account
              </h3>
              {balanceData?.bankAccount ? (
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <span className="text-sm text-[var(--text-secondary)]">
                    {balanceData.bankAccount.bankName}
                  </span>
                  <span className="text-sm font-mono text-[var(--text-muted)]">
                    ****{balanceData.bankAccount.last4}
                  </span>
                  <Badge className="bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-subtle)] text-xs capitalize">
                    {balanceData.bankAccount.type}
                  </Badge>
                  {balanceData.bankAccount.verified && (
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-xs font-medium text-emerald-400">Verified</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-muted)] mt-1">No bank account connected</p>
              )}
            </div>
          </div>
          <Button variant="outline" size="sm" className="gap-2 self-start sm:self-center">
            <CreditCard className="h-4 w-4" />
            Update
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </GlassCard>

      {/* Payout History */}
      <GlassCard variant="bordered" padding="none">
        <div className="p-4 sm:p-6 border-b border-[var(--border-subtle)]">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-[var(--text-muted)]" />
              <h2 className="text-lg font-semibold text-[var(--text-primary)]">Payout History</h2>
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as PayoutStatus)}>
              <SelectTrigger className="w-full sm:w-[160px] bg-[var(--bg-tertiary)] border-[var(--border-subtle)]">
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
          <div className="overflow-x-auto">
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
                {Array.from({ length: 3 }).map((_, i) => (
                  <TableRowSkeleton key={i} />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : !payoutHistory || payoutHistory.length === 0 ? (
          <div className="py-16 text-center">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
              <Wallet className="h-8 w-8 text-[var(--text-muted)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">No payouts found</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-sm mx-auto">
              {statusFilter !== 'all'
                ? 'Try changing the filter to see more results'
                : 'Your payout history will appear here once you request your first withdrawal'}
            </p>
            {statusFilter !== 'all' && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => setStatusFilter('all')}
              >
                Clear filter
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-[var(--border-subtle)] hover:bg-transparent">
                  <TableHead className="text-[var(--text-secondary)] font-medium">Reference</TableHead>
                  <TableHead className="text-[var(--text-secondary)] font-medium">Amount</TableHead>
                  <TableHead className="text-[var(--text-secondary)] font-medium">Status</TableHead>
                  <TableHead className="text-[var(--text-secondary)] font-medium">Requested</TableHead>
                  <TableHead className="text-[var(--text-secondary)] font-medium">Completed</TableHead>
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
                      className="border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm text-[var(--text-primary)]">
                            {payout.reference}
                          </span>
                          <CopyButton text={payout.reference} label="Reference" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="font-semibold font-mono text-[var(--text-primary)]">
                          {formatCurrency(payout.amount)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge className={cn('border transition-all', status.bg)}>
                            <StatusIcon className="h-3 w-3 mr-1" />
                            {status.label}
                          </Badge>
                          {payout.status === 'failed' && payout.failureReason && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger>
                                  <AlertCircle className="h-4 w-4 text-red-400" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p>{payout.failureReason}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-[var(--text-secondary)]">
                        {formatDate(payout.requestedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-[var(--text-secondary)]">
                        {payout.completedAt ? (
                          formatDate(payout.completedAt)
                        ) : payout.status === 'pending' ? (
                          <span className="text-amber-400 text-xs">
                            Est. {(payout as typeof payout & { estimatedArrival?: string }).estimatedArrival
                              ? getRelativeTime((payout as typeof payout & { estimatedArrival?: string }).estimatedArrival!)
                              : '2-3 days'}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </GlassCard>

      {/* Trust & Security Section */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] flex items-start gap-3">
          <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10">
            <ShieldCheck className="h-5 w-5 text-[var(--accent-blue)]" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Bank-Level Security</h4>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              256-bit SSL encryption for all transfers
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] flex items-start gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-[var(--text-primary)]">No Hidden Fees</h4>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Zero fees on all bank transfers
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10">
            <Clock className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Fast Processing</h4>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Funds arrive in 2-3 business days
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
