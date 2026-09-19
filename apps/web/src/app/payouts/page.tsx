'use client';

import { useState, useCallback } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
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
  AlertTriangle,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Types for API responses
interface EarningData {
  id: string;
  contract_id: string | null;
  amount_cents: number;
  status: 'PENDING' | 'AVAILABLE' | 'WITHDRAWN' | 'REFUNDED';
  description: string | null;
  available_at: string;
  deal_closed_at: string;
  refunded_at: string | null;
  refund_reason: string | null;
  withdrawal_id: string | null;
  created_at: string;
  contract_metadata?: {
    property_address?: string;
  } | null;
}

interface WithdrawalData {
  id: string;
  amount_cents: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  payout_method: string;
  payout_reference: string | null;
  requested_at: string;
  processing_started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  failure_reason: string | null;
  estimated_arrival_at: string | null;
}

interface BalanceSummary {
  pending: number;
  available: number;
  withdrawn: number;
  refunded: number;
  total_earned: number;
}

interface BankAccount {
  id: string;
  bank_name: string;
  account_type: string;
  last_four: string;
  verified: boolean;
  verified_at: string | null;
}

type PayoutStatus = 'all' | 'COMPLETED' | 'PENDING' | 'FAILED';
type EarningFilter = 'all' | 'PENDING' | 'AVAILABLE' | 'WITHDRAWN' | 'REFUNDED';

const withdrawalStatusConfig: Record<string, { dot: 'success' | 'warning' | 'error' | 'info' | 'neutral'; label: string; bg: string }> = {
  COMPLETED: { dot: 'success', label: 'Completed', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  PENDING: { dot: 'warning', label: 'Pending', bg: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  PROCESSING: { dot: 'info', label: 'Processing', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  FAILED: { dot: 'error', label: 'Failed', bg: 'bg-red-500/10 text-red-400 border-red-500/20' },
  CANCELLED: { dot: 'neutral', label: 'Cancelled', bg: 'bg-gray-500/10 text-gray-400 border-gray-500/20' },
};

const earningStatusConfig: Record<string, { dot: 'success' | 'warning' | 'error' | 'info' | 'neutral'; label: string; bg: string }> = {
  PENDING: { dot: 'warning', label: 'In Escrow', bg: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  AVAILABLE: { dot: 'success', label: 'Available', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  WITHDRAWN: { dot: 'info', label: 'Withdrawn', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  REFUNDED: { dot: 'error', label: 'Refunded', bg: 'bg-red-500/10 text-red-400 border-red-500/20' },
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

  if (diffDays < 0) return formatDate(dateStr, false);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays <= 7) return `In ${diffDays} days`;
  return formatDate(dateStr, false);
}

function getDaysUntilAvailable(availableAt: string): number {
  const date = new Date(availableAt);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
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

// Escrow countdown for pending earnings
function EscrowCountdown({ availableAt }: { availableAt: string }) {
  const daysLeft = getDaysUntilAvailable(availableAt);

  if (daysLeft <= 0) return null;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-400">
      <Lock className="h-3 w-3" />
      {daysLeft} day{daysLeft !== 1 ? 's' : ''} left
    </span>
  );
}

export default function PayoutsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();
  const [withdrawalStatusFilter, setWithdrawalStatusFilter] = useState<PayoutStatus>('all');
  const [earningFilter, setEarningFilter] = useState<EarningFilter>('all');
  const [payoutMode, setPayoutMode] = useState<'full' | 'custom'>('full');
  const [customAmount, setCustomAmount] = useState('');
  const [activeTab, setActiveTab] = useState<'earnings' | 'withdrawals'>('earnings');

  // Fetch earnings and balance data
  const { data: earningsData, isLoading: earningsLoading, refetch: refetchEarnings } = useQuery({
    queryKey: ['earnings'],
    queryFn: async () => {
      const res = await fetch('/api/earnings');
      if (!res.ok) throw new Error('Failed to fetch earnings');
      return res.json() as Promise<{
        earnings: EarningData[];
        summary: BalanceSummary;
        bankAccount: BankAccount | null;
        minimumPayout: number;
      }>;
    },
    enabled: !!session,
  });

  // Fetch withdrawals
  const { data: withdrawalsData, isLoading: withdrawalsLoading } = useQuery({
    queryKey: ['withdrawals'],
    queryFn: async () => {
      const res = await fetch('/api/withdrawals');
      if (!res.ok) throw new Error('Failed to fetch withdrawals');
      return res.json() as Promise<{ withdrawals: WithdrawalData[] }>;
    },
    enabled: !!session,
  });

  // Request withdrawal mutation
  const withdrawMutation = useMutation({
    mutationFn: async (amountCents: number) => {
      const res = await fetch('/api/withdrawals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to request withdrawal');
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast.success(
        <div className="flex flex-col gap-1">
          <span className="font-medium">Payout requested successfully</span>
          <span className="text-sm text-[var(--text-secondary)]">
            {formatCurrency(data.amountCents)} will arrive in 2-3 business days
          </span>
        </div>,
        { duration: 5000 }
      );
      setPayoutMode('full');
      setCustomAmount('');
      queryClient.invalidateQueries({ queryKey: ['earnings'] });
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const handleRequestPayout = () => {
    const summary = earningsData?.summary;
    if (!summary) return;

    const amountCents = payoutMode === 'full'
      ? summary.available
      : Math.round(parseFloat(customAmount || '0') * 100);

    const minimumPayout = earningsData?.minimumPayout || 10000;

    if (amountCents < minimumPayout) {
      toast.error(`Minimum payout amount is ${formatCurrency(minimumPayout)}`);
      return;
    }

    if (amountCents > summary.available) {
      toast.error('Amount exceeds available balance');
      return;
    }

    withdrawMutation.mutate(amountCents);
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

  const summary = earningsData?.summary || {
    pending: 0,
    available: 0,
    withdrawn: 0,
    refunded: 0,
    total_earned: 0,
  };

  const minimumPayout = earningsData?.minimumPayout || 10000;
  const canRequestPayout = summary.available >= minimumPayout;
  const effectiveAmount = payoutMode === 'full'
    ? summary.available
    : Math.round(parseFloat(customAmount || '0') * 100);
  const isValidAmount = effectiveAmount >= minimumPayout && effectiveAmount <= summary.available;

  // Filter earnings based on selection
  const filteredEarnings = earningsData?.earnings?.filter(
    (e) => earningFilter === 'all' || e.status === earningFilter
  ) || [];

  // Filter withdrawals based on selection
  const filteredWithdrawals = withdrawalsData?.withdrawals?.filter(
    (w) => withdrawalStatusFilter === 'all' || w.status === withdrawalStatusFilter
  ) || [];

  const pendingWithdrawal = withdrawalsData?.withdrawals?.find(
    (w) => w.status === 'PENDING' || w.status === 'PROCESSING'
  );

  const bankAccount = earningsData?.bankAccount;

  return (
    <div className="space-y-8 max-w-5xl pb-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)]">Payouts & Earnings</h1>
          <p className="text-[var(--text-secondary)] mt-1">
            Track your deal earnings and request withdrawals
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetchEarnings()}
          className="gap-2 self-start"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>

      {/* Hero Balance Card */}
      <HeroBalanceCard
        amount={summary.available}
        isLoading={earningsLoading}
      />

      {/* Secondary Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <BalanceCard
          title="In Escrow"
          amount={summary.pending}
          icon={Lock}
          variant="warning"
          description="Inspection period hold"
          isLoading={earningsLoading}
        />
        <BalanceCard
          title="Withdrawn"
          amount={summary.withdrawn}
          icon={ArrowDownToLine}
          variant="muted"
          description="Paid out to bank"
          isLoading={earningsLoading}
        />
        <BalanceCard
          title="Refunded"
          amount={summary.refunded}
          icon={Undo2}
          variant="muted"
          description="Deals that fell through"
          isLoading={earningsLoading}
        />
        <BalanceCard
          title="Total Earned"
          amount={summary.total_earned}
          icon={TrendingUp}
          description="Lifetime earnings"
          isLoading={earningsLoading}
        />
      </div>

      {/* Active Pending Payout Alert */}
      {pendingWithdrawal && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20">
              <CalendarClock className="h-5 w-5 text-amber-400" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-sm font-semibold text-amber-400">Payout in Progress</h4>
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                  {formatCurrency(pendingWithdrawal.amount_cents)}
                </Badge>
              </div>
              <p className="text-sm text-[var(--text-secondary)]">
                Reference: <span className="font-mono">{pendingWithdrawal.payout_reference || '-'}</span>
              </p>
              <PendingPayoutProgress
                requestedAt={pendingWithdrawal.requested_at}
                estimatedArrival={pendingWithdrawal.estimated_arrival_at || undefined}
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
                {formatCurrency(summary.available)}
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
                    max={summary.available / 100}
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
              <span>Min: {formatCurrency(minimumPayout)}</span>
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
            disabled={!canRequestPayout || withdrawMutation.isPending || (payoutMode === 'custom' && !isValidAmount) || !!pendingWithdrawal}
            className="btn-gradient w-full sm:w-auto px-8 py-3 rounded-xl font-medium disabled:opacity-50 disabled:cursor-not-allowed text-base"
          >
            {withdrawMutation.isPending ? (
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
          {pendingWithdrawal && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                You have a pending withdrawal. Please wait for it to complete before requesting another.
              </p>
            </div>
          )}

          {!canRequestPayout && !pendingWithdrawal && (
            <div className="mt-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <p className="text-sm text-amber-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                Your available balance is below the minimum payout threshold of {formatCurrency(minimumPayout)}
              </p>
            </div>
          )}

          {!bankAccount && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
              <p className="text-sm text-red-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                No bank account connected. Add a bank account to enable withdrawals.
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
              {bankAccount ? (
                <div className="flex flex-wrap items-center gap-3 mt-1">
                  <span className="text-sm text-[var(--text-secondary)]">
                    {bankAccount.bank_name}
                  </span>
                  <span className="text-sm font-mono text-[var(--text-muted)]">
                    ****{bankAccount.last_four}
                  </span>
                  <Badge className="bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-subtle)] text-xs capitalize">
                    {bankAccount.account_type}
                  </Badge>
                  {bankAccount.verified && (
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
            {bankAccount ? 'Update' : 'Add Account'}
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </GlassCard>

      {/* Tab Switcher */}
      <div className="flex gap-2 border-b border-[var(--border-subtle)]">
        <button
          onClick={() => setActiveTab('earnings')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'earnings'
              ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          )}
        >
          Earnings History
        </button>
        <button
          onClick={() => setActiveTab('withdrawals')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
            activeTab === 'withdrawals'
              ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]'
              : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
          )}
        >
          Withdrawal History
        </button>
      </div>

      {/* Earnings History */}
      {activeTab === 'earnings' && (
        <GlassCard variant="bordered" padding="none">
          <div className="p-4 sm:p-6 border-b border-[var(--border-subtle)]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <Wallet className="h-5 w-5 text-[var(--text-muted)]" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Earnings from Deals</h2>
              </div>
              <Select value={earningFilter} onValueChange={(v) => setEarningFilter(v as EarningFilter)}>
                <SelectTrigger className="w-full sm:w-[160px] bg-[var(--bg-tertiary)] border-[var(--border-subtle)]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Earnings</SelectItem>
                  <SelectItem value="PENDING">In Escrow</SelectItem>
                  <SelectItem value="AVAILABLE">Available</SelectItem>
                  <SelectItem value="WITHDRAWN">Withdrawn</SelectItem>
                  <SelectItem value="REFUNDED">Refunded</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {earningsLoading ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-[var(--border-subtle)] hover:bg-transparent">
                    <TableHead className="text-[var(--text-secondary)]">Description</TableHead>
                    <TableHead className="text-[var(--text-secondary)]">Amount</TableHead>
                    <TableHead className="text-[var(--text-secondary)]">Status</TableHead>
                    <TableHead className="text-[var(--text-secondary)]">Deal Closed</TableHead>
                    <TableHead className="text-[var(--text-secondary)]">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <TableRowSkeleton key={i} />
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : filteredEarnings.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
                <Wallet className="h-8 w-8 text-[var(--text-muted)]" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">No earnings found</h3>
              <p className="text-sm text-[var(--text-muted)] max-w-sm mx-auto">
                {earningFilter !== 'all'
                  ? 'Try changing the filter to see more results'
                  : 'Your earnings will appear here when deals close'}
              </p>
              {earningFilter !== 'all' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setEarningFilter('all')}
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
                    <TableHead className="text-[var(--text-secondary)] font-medium">Description</TableHead>
                    <TableHead className="text-[var(--text-secondary)] font-medium">Amount</TableHead>
                    <TableHead className="text-[var(--text-secondary)] font-medium">Status</TableHead>
                    <TableHead className="text-[var(--text-secondary)] font-medium">Deal Closed</TableHead>
                    <TableHead className="text-[var(--text-secondary)] font-medium">Available</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEarnings.map((earning) => {
                    const status = earningStatusConfig[earning.status] || earningStatusConfig.PENDING;
                    const StatusIcon =
                      earning.status === 'AVAILABLE'
                        ? CheckCircle2
                        : earning.status === 'PENDING'
                          ? Lock
                          : earning.status === 'WITHDRAWN'
                            ? ArrowDownToLine
                            : XCircle;

                    return (
                      <TableRow
                        key={earning.id}
                        className="border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                      >
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm text-[var(--text-primary)]">
                              {earning.description || 'Deal assignment fee'}
                            </span>
                            {earning.contract_metadata?.property_address && (
                              <span className="text-xs text-[var(--text-muted)]">
                                {earning.contract_metadata.property_address}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold font-mono text-[var(--text-primary)]">
                            {formatCurrency(earning.amount_cents)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge className={cn('border transition-all w-fit', status.bg)}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {status.label}
                            </Badge>
                            {earning.status === 'PENDING' && (
                              <EscrowCountdown availableAt={earning.available_at} />
                            )}
                            {earning.status === 'REFUNDED' && earning.refund_reason && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <span className="text-xs text-red-400 flex items-center gap-1">
                                      <AlertCircle className="h-3 w-3" />
                                      View reason
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{earning.refund_reason}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-[var(--text-secondary)]">
                          {formatDate(earning.deal_closed_at)}
                        </TableCell>
                        <TableCell className="text-sm text-[var(--text-secondary)]">
                          {earning.status === 'PENDING'
                            ? getRelativeTime(earning.available_at)
                            : formatDate(earning.available_at, false)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </GlassCard>
      )}

      {/* Withdrawal History */}
      {activeTab === 'withdrawals' && (
        <GlassCard variant="bordered" padding="none">
          <div className="p-4 sm:p-6 border-b border-[var(--border-subtle)]">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-[var(--text-muted)]" />
                <h2 className="text-lg font-semibold text-[var(--text-primary)]">Withdrawal History</h2>
              </div>
              <Select value={withdrawalStatusFilter} onValueChange={(v) => setWithdrawalStatusFilter(v as PayoutStatus)}>
                <SelectTrigger className="w-full sm:w-[160px] bg-[var(--bg-tertiary)] border-[var(--border-subtle)]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Withdrawals</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="PENDING">Pending</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {withdrawalsLoading ? (
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
          ) : filteredWithdrawals.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-[var(--bg-tertiary)] flex items-center justify-center mb-4">
                <ArrowDownToLine className="h-8 w-8 text-[var(--text-muted)]" />
              </div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">No withdrawals found</h3>
              <p className="text-sm text-[var(--text-muted)] max-w-sm mx-auto">
                {withdrawalStatusFilter !== 'all'
                  ? 'Try changing the filter to see more results'
                  : 'Your withdrawal history will appear here once you request your first payout'}
              </p>
              {withdrawalStatusFilter !== 'all' && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setWithdrawalStatusFilter('all')}
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
                  {filteredWithdrawals.map((withdrawal) => {
                    const status = withdrawalStatusConfig[withdrawal.status] || withdrawalStatusConfig.PENDING;
                    const StatusIcon =
                      withdrawal.status === 'COMPLETED'
                        ? CheckCircle2
                        : withdrawal.status === 'PENDING' || withdrawal.status === 'PROCESSING'
                          ? Clock
                          : XCircle;

                    return (
                      <TableRow
                        key={withdrawal.id}
                        className="border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)]/50 transition-colors"
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm text-[var(--text-primary)]">
                              {withdrawal.payout_reference || withdrawal.id.slice(0, 12)}
                            </span>
                            {withdrawal.payout_reference && (
                              <CopyButton text={withdrawal.payout_reference} label="Reference" />
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="font-semibold font-mono text-[var(--text-primary)]">
                            {formatCurrency(withdrawal.amount_cents)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge className={cn('border transition-all', status.bg)}>
                              <StatusIcon className="h-3 w-3 mr-1" />
                              {status.label}
                            </Badge>
                            {withdrawal.status === 'FAILED' && withdrawal.failure_reason && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger>
                                    <AlertCircle className="h-4 w-4 text-red-400" />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{withdrawal.failure_reason}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-[var(--text-secondary)]">
                          {formatDate(withdrawal.requested_at)}
                        </TableCell>
                        <TableCell className="text-sm text-[var(--text-secondary)]">
                          {withdrawal.completed_at ? (
                            formatDate(withdrawal.completed_at)
                          ) : (withdrawal.status === 'PENDING' || withdrawal.status === 'PROCESSING') ? (
                            <span className="text-amber-400 text-xs">
                              Est. {withdrawal.estimated_arrival_at
                                ? getRelativeTime(withdrawal.estimated_arrival_at)
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
      )}

      {/* Trust & Security Section */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] flex items-start gap-3">
          <div className="p-2 rounded-lg bg-[var(--accent-blue)]/10">
            <ShieldCheck className="h-5 w-5 text-[var(--accent-blue)]" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Escrow Protection</h4>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Funds held until inspection period ends
            </p>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] flex items-start gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h4 className="text-sm font-medium text-[var(--text-primary)]">Refund Safe</h4>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Deal refunds handled automatically
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
