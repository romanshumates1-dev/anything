'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Loader2,
  CreditCard,
  Zap,
  Crown,
  Sparkles,
  Check,
  AlertCircle,
  ArrowUpRight,
  ArrowLeft,
  Package,
  Gift,
  Wallet,
  TrendingUp,
  Clock,
  Star,
  ChevronRight,
  RefreshCw,
  Shield,
  AlertTriangle,
  ExternalLink,
  CheckCircle,
  Info,
  Coins,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

// ============================================================================
// Types
// ============================================================================
interface Plan {
  name: string;
  price: number;
  originalPrice: number;
  aiCredits: number;
  leads: number;
  sms: number;
  campaigns: number;
  users: number;
  features: string[];
}

interface CreditPack {
  id: string;
  credits: number;
  price: number;
  pricePerCredit: number;
  label: string;
  popular?: boolean;
  savings?: string;
}

interface SubscriptionData {
  subscription: {
    tier: string;
    price: number;
    trialEndsAt: string | null;
    isTrialing: boolean;
  };
  limits: {
    aiCredits: number;
    aiCreditsMax: number;
    leads: number;
    sms: number;
    campaigns: number;
    users: number;
  };
  features: string[];
  usage: {
    leads_count: number;
    campaigns_count: number;
    users_count: number;
  } | null;
  plans: Record<string, Plan>;
  creditPacks: Record<string, { credits: number; price: number }>;
}

interface CreditsData {
  balance: number;
  lifetimePurchased: number;
  lifetimeUsed: number;
  tier: string;
  costs: Record<string, number>;
  transactions?: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    description: string;
    createdAt: string;
  }>;
}

interface RefundEligibility {
  eligible: boolean;
  reason?: string;
  details: {
    subscriptionTier: string | null;
    purchasedAt: string | null;
    refundWindowEnds: string | null;
    daysRemaining: number;
    subscriptionPrice: string;
    subscriptionPriceCents: number;
    creditsUsed: number;
    creditsNonRefundable: string;
    creditsNonRefundableCents: number;
    eligibleRefund: string;
    eligibleRefundCents: number;
    alreadyRefunded: boolean;
  };
}

// ============================================================================
// Constants
// ============================================================================
const PLAN_ORDER = ['starter', 'pro', 'business'];

const PLAN_ICONS: Record<string, React.ElementType> = {
  free: Wallet,
  starter: Zap,
  pro: Crown,
  business: Sparkles,
  enterprise: Star,
};

const CREDIT_PACKS: CreditPack[] = [
  { id: 'pack_100', credits: 100, price: 5, pricePerCredit: 0.05, label: '100 Credits', popular: false },
  { id: 'pack_500', credits: 500, price: 20, pricePerCredit: 0.04, label: '500 Credits', popular: true, savings: '20%' },
  { id: 'pack_1000', credits: 1000, price: 35, pricePerCredit: 0.035, label: '1,000 Credits', popular: false, savings: '30%' },
  { id: 'pack_5000', credits: 5000, price: 150, pricePerCredit: 0.03, label: '5,000 Credits', popular: false, savings: '40%' },
  { id: 'pack_10000', credits: 10000, price: 250, pricePerCredit: 0.025, label: '10,000 Credits', popular: false, savings: '50%' },
];

const PLAN_FEATURES: Record<string, string[]> = {
  starter: [
    'AI lead classification',
    'Email campaigns',
    'Basic CRM',
    'Up to 2 team members',
  ],
  pro: [
    'Everything in Starter',
    'AI-powered negotiation',
    'Contract generation',
    'Buyer matching',
    'Priority support',
  ],
  business: [
    'Everything in Pro',
    'Unlimited leads & campaigns',
    'API access',
    'Phone support',
    'Custom integrations',
    'Dedicated account manager',
  ],
};

// ============================================================================
// Loading Skeleton
// ============================================================================
function BillingPageSkeleton() {
  return (
    <div className="space-y-6 max-w-5xl animate-pulse">
      <div className="h-8 w-48 bg-[var(--bg-tertiary)] rounded-lg" />
      <div className="grid lg:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="glass-card p-6 space-y-4">
            <div className="h-6 w-24 bg-[var(--bg-tertiary)] rounded" />
            <div className="h-10 w-20 bg-[var(--bg-tertiary)] rounded-lg" />
            <div className="space-y-2">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="h-4 w-full bg-[var(--bg-tertiary)] rounded" />
              ))}
            </div>
            <div className="h-10 w-full bg-[var(--bg-tertiary)] rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Search Params Handler (needs Suspense boundary)
// ============================================================================
function PurchaseResultHandler() {
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  useEffect(() => {
    const purchase = searchParams.get('purchase');
    const credits = searchParams.get('credits');
    if (purchase === 'success' && credits) {
      toast.success(`Successfully purchased ${parseInt(credits).toLocaleString()} credits!`);
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['billing'] });
    } else if (purchase === 'cancelled') {
      toast.info('Purchase cancelled');
    }
  }, [searchParams, queryClient]);

  return null;
}

// ============================================================================
// Main Billing Page
// ============================================================================
export default function BillingSettingsPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [refundConfirmed, setRefundConfirmed] = useState(false);

  // Fetch billing data
  const { data: billingData, isLoading: billingLoading, error: billingError } = useQuery<SubscriptionData>({
    queryKey: ['billing'],
    queryFn: async () => {
      const res = await fetch('/api/billing/subscribe?usage=true');
      if (!res.ok) throw new Error('Failed to fetch billing data');
      return res.json();
    },
    enabled: !!session,
    retry: 2,
  });

  // Fetch credits data
  const { data: creditsData, isLoading: creditsLoading } = useQuery<CreditsData>({
    queryKey: ['credits', 'history'],
    queryFn: async () => {
      const res = await fetch('/api/credits?history=true&limit=5');
      if (!res.ok) throw new Error('Failed to fetch credits');
      return res.json();
    },
    enabled: !!session,
    retry: 2,
  });

  // Fetch refund eligibility
  const { data: refundData, isLoading: refundLoading } = useQuery<RefundEligibility>({
    queryKey: ['refund-eligibility'],
    queryFn: async () => {
      const res = await fetch('/api/billing/refund');
      if (!res.ok) throw new Error('Failed to fetch refund eligibility');
      return res.json();
    },
    enabled: !!session,
    retry: 1,
  });

  // Upgrade plan mutation
  const upgradeMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to upgrade plan');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['usage'] });
      toast.success(data.message || 'Plan upgraded successfully!');
      setUpgrading(null);
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setUpgrading(null);
    },
  });

  // Purchase credits mutation
  const purchaseMutation = useMutation({
    mutationFn: async (packId: string) => {
      const res = await fetch('/api/credits/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to purchase credits');
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        // Redirect to Stripe checkout
        window.location.href = data.checkoutUrl;
      } else {
        // Direct credit grant (demo mode)
        queryClient.invalidateQueries({ queryKey: ['credits'] });
        queryClient.invalidateQueries({ queryKey: ['billing'] });
        toast.success(`Added ${data.creditsAdded?.toLocaleString()} credits! New balance: ${data.newBalance?.toLocaleString()}`);
        setPurchasing(null);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setPurchasing(null);
    },
  });

  const handleUpgrade = (planId: string) => {
    setUpgrading(planId);
    upgradeMutation.mutate(planId);
  };

  const handlePurchaseCredits = (packId: string) => {
    setPurchasing(packId);
    purchaseMutation.mutate(packId);
  };

  // Refund mutation
  const refundMutation = useMutation({
    mutationFn: async (confirmCreditsLoss: boolean) => {
      const res = await fetch('/api/billing/refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmCreditsLoss }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Failed to process refund');
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['billing'] });
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['refund-eligibility'] });
      toast.success(data.message || 'Refund processed successfully!');
      setShowRefundModal(false);
      setRefundConfirmed(false);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const handleRefundRequest = () => {
    if (!refundConfirmed && refundData?.details?.creditsUsed && refundData.details.creditsUsed > 0) {
      toast.error('Please confirm you understand the credit deduction');
      return;
    }
    refundMutation.mutate(refundConfirmed);
  };

  // Loading state
  if (authLoading || billingLoading) {
    return <BillingPageSkeleton />;
  }

  // Auth redirect
  if (!session) {
    redirect('/account/signin');
  }

  // Error state
  if (billingError) {
    return (
      <div className="max-w-5xl space-y-6">
        <GlassCard variant="bordered" className="p-8 text-center">
          <AlertCircle className="h-12 w-12 text-[var(--color-error)] mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-[var(--text-primary)] mb-2">Failed to load billing data</h2>
          <p className="text-[var(--text-muted)] mb-4">Please try again or contact support if the issue persists.</p>
          <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['billing'] })}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </GlassCard>
      </div>
    );
  }

  const currentTier = billingData?.subscription?.tier || 'free';
  const isTrialing = billingData?.subscription?.isTrialing;
  const trialEndsAt = billingData?.subscription?.trialEndsAt;
  const currentPlan = billingData?.plans?.[currentTier];
  const creditsBalance = creditsData?.balance ?? billingData?.limits?.aiCredits ?? 0;
  const creditsMax = billingData?.limits?.aiCreditsMax ?? 0;
  const creditsPercent = creditsMax > 0 ? Math.min(100, ((creditsMax - creditsBalance) / creditsMax) * 100) : 0;

  return (
    <div className="space-y-8 max-w-5xl pb-12">
      {/* Handle Stripe redirect query params */}
      <Suspense fallback={null}>
        <PurchaseResultHandler />
      </Suspense>

      {/* Back Link */}
      <Link
        href="/settings"
        className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Settings
      </Link>

      {/* Page Header */}
      <header>
        <div className="flex items-center gap-4 mb-2">
          <div className="p-3 rounded-xl bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20 border border-[var(--border-subtle)]">
            <CreditCard className="h-7 w-7 text-[var(--accent-blue)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight">
              Billing & Credits
            </h1>
            <p className="text-[var(--text-secondary)] mt-0.5">
              Manage your subscription and purchase credits
            </p>
          </div>
        </div>
      </header>

      {/* Trial Banner */}
      {isTrialing && trialEndsAt && (
        <div className="p-4 rounded-xl bg-gradient-to-r from-[var(--accent-blue)]/10 to-[var(--accent-purple)]/10 border border-[var(--accent-blue)]/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[var(--accent-blue)]/20">
              <Clock className="h-5 w-5 text-[var(--accent-blue)]" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-[var(--text-primary)]">
                You&apos;re on a free trial
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Trial ends {new Date(trialEndsAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
            <Badge className="bg-[var(--accent-blue)]/20 text-[var(--accent-blue)] border border-[var(--accent-blue)]/30">
              {Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))} days left
            </Badge>
          </div>
        </div>
      )}

      {/* Current Plan Section */}
      <section>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-[var(--text-muted)]" />
          Current Plan
        </h2>
        <GlassCard variant="bordered" className="relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-radial from-[var(--accent-blue)]/5 to-transparent rounded-full blur-3xl" />
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6 p-2">
            <div className="flex items-center gap-5">
              <div className="p-4 rounded-2xl bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20 border border-[var(--accent-blue)]/20">
                {(() => {
                  const PlanIcon = PLAN_ICONS[currentTier] || Wallet;
                  return <PlanIcon className="h-10 w-10 text-[var(--accent-blue)]" />;
                })()}
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="text-xl font-bold text-[var(--text-primary)]">
                    {currentPlan?.name || currentTier.charAt(0).toUpperCase() + currentTier.slice(1)} Plan
                  </h3>
                  {isTrialing && (
                    <Badge className="bg-[var(--accent-purple)]/20 text-[var(--accent-purple)] border border-[var(--accent-purple)]/30">
                      Trial
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-[var(--text-muted)]">
                  {currentTier === 'free' ? (
                    'Limited features - upgrade to unlock more'
                  ) : (
                    <>
                      ${billingData?.subscription?.price || currentPlan?.price || 0}/month
                      {currentPlan?.originalPrice && currentPlan.originalPrice > (currentPlan?.price || 0) && (
                        <span className="ml-2 line-through text-[var(--text-muted)]">
                          ${currentPlan.originalPrice}
                        </span>
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>

            {/* Usage Summary */}
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)]">
                <Coins className="h-4 w-4 text-[var(--accent-blue)]" />
                <span className="text-[var(--text-muted)]">Credits:</span>
                <span className="font-semibold text-[var(--text-primary)]">{creditsBalance.toLocaleString()}</span>
              </div>
              {billingData?.usage && (
                <>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)]">
                    <TrendingUp className="h-4 w-4 text-[var(--color-success)]" />
                    <span className="text-[var(--text-muted)]">Leads:</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {billingData.usage.leads_count?.toLocaleString() || 0}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)]">
                    <Package className="h-4 w-4 text-[var(--accent-purple)]" />
                    <span className="text-[var(--text-muted)]">Campaigns:</span>
                    <span className="font-semibold text-[var(--text-primary)]">
                      {billingData.usage.campaigns_count?.toLocaleString() || 0}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Credit Usage Bar */}
          {creditsMax > 0 && (
            <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-[var(--text-muted)]">Credits used this period</span>
                <span className="text-[var(--text-secondary)] font-medium">
                  {(creditsMax - creditsBalance).toLocaleString()} / {creditsMax.toLocaleString()}
                </span>
              </div>
              <Progress value={creditsPercent} className="h-2 bg-[var(--bg-tertiary)]" />
              {creditsPercent > 80 && (
                <p className="text-xs text-[var(--color-warning)] mt-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Running low on credits - consider purchasing more below
                </p>
              )}
            </div>
          )}
        </GlassCard>
      </section>

      {/* Available Plans Section */}
      <section>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Package className="h-5 w-5 text-[var(--text-muted)]" />
          Available Plans
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
          {PLAN_ORDER.map((planId) => {
            const plan = billingData?.plans?.[planId];
            if (!plan) return null;

            const isCurrentPlan = currentTier === planId;
            const isUpgrade = PLAN_ORDER.indexOf(planId) > PLAN_ORDER.indexOf(currentTier);
            const isDowngrade = PLAN_ORDER.indexOf(planId) < PLAN_ORDER.indexOf(currentTier);
            const PlanIcon = PLAN_ICONS[planId] || Zap;
            const features = PLAN_FEATURES[planId] || [];
            const isLoading = upgrading === planId;

            return (
              <GlassCard
                key={planId}
                variant="bordered"
                className={`relative ${isCurrentPlan ? 'ring-2 ring-[var(--accent-blue)]' : ''}`}
              >
                {/* Current Plan Badge */}
                {isCurrentPlan && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-[var(--accent-blue)] text-white shadow-lg">
                      Current Plan
                    </Badge>
                  </div>
                )}

                {/* Popular Badge */}
                {planId === 'pro' && !isCurrentPlan && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-gradient-to-r from-[var(--accent-purple)] to-[var(--accent-blue)] text-white shadow-lg">
                      <Star className="h-3 w-3 mr-1" />
                      Most Popular
                    </Badge>
                  </div>
                )}

                <div className="pt-4">
                  {/* Plan Header */}
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`p-2.5 rounded-xl ${planId === 'pro' ? 'bg-[var(--accent-purple)]/10' : 'bg-[var(--accent-blue)]/10'}`}>
                      <PlanIcon className={`h-6 w-6 ${planId === 'pro' ? 'text-[var(--accent-purple)]' : 'text-[var(--accent-blue)]'}`} />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--text-primary)]">{plan.name}</h3>
                    </div>
                  </div>

                  {/* Pricing */}
                  <div className="mb-6">
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-[var(--text-primary)]">${plan.price}</span>
                      <span className="text-[var(--text-muted)]">/month</span>
                    </div>
                    {plan.originalPrice > plan.price && (
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-sm line-through text-[var(--text-muted)]">${plan.originalPrice}</span>
                        <Badge className="bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/20 text-xs">
                          50% off launch special
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Plan Limits */}
                  <div className="space-y-2 mb-6 pb-6 border-b border-[var(--border-subtle)]">
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-muted)]">AI Credits/mo</span>
                      <span className="font-medium text-[var(--text-primary)]">{plan.aiCredits.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-muted)]">Leads</span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {plan.leads === -1 ? 'Unlimited' : plan.leads.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-muted)]">SMS/mo</span>
                      <span className="font-medium text-[var(--text-primary)]">{plan.sms.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-muted)]">Campaigns</span>
                      <span className="font-medium text-[var(--text-primary)]">
                        {plan.campaigns === -1 ? 'Unlimited' : plan.campaigns}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--text-muted)]">Team members</span>
                      <span className="font-medium text-[var(--text-primary)]">{plan.users}</span>
                    </div>
                  </div>

                  {/* Features List */}
                  <div className="space-y-2 mb-6">
                    {features.map((feature, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="h-4 w-4 text-[var(--color-success)] mt-0.5 shrink-0" />
                        <span className="text-[var(--text-secondary)]">{feature}</span>
                      </div>
                    ))}
                  </div>

                  {/* Action Button */}
                  {isCurrentPlan ? (
                    <Button variant="outline" className="w-full" disabled>
                      <Check className="h-4 w-4 mr-2" />
                      Current Plan
                    </Button>
                  ) : isUpgrade ? (
                    <Button
                      className="w-full bg-gradient-to-r from-[var(--accent-blue)] to-[var(--accent-purple)] hover:opacity-90 text-white"
                      onClick={() => handleUpgrade(planId)}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <ArrowUpRight className="h-4 w-4 mr-2" />
                      )}
                      Upgrade to {plan.name}
                    </Button>
                  ) : isDowngrade ? (
                    <Button
                      variant="outline"
                      className="w-full text-[var(--text-muted)]"
                      onClick={() => handleUpgrade(planId)}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : null}
                      Downgrade
                    </Button>
                  ) : null}
                </div>
              </GlassCard>
            );
          })}
        </div>

        <p className="text-sm text-[var(--text-muted)] text-center mt-4">
          Need a custom plan?{' '}
          <a href="mailto:support@dealflow.ai" className="text-[var(--accent-blue)] hover:underline">
            Contact us
          </a>{' '}
          for enterprise pricing.
        </p>
      </section>

      {/* Credit Packs Section */}
      <section>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Coins className="h-5 w-5 text-[var(--text-muted)]" />
          Buy Credits
        </h2>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Credits are used for AI operations, SMS, and email. Purchase additional credits anytime.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {CREDIT_PACKS.map((pack) => {
            const isLoading = purchasing === pack.id;

            return (
              <GlassCard
                key={pack.id}
                variant="bordered"
                className={`relative ${pack.popular ? 'ring-2 ring-[var(--accent-blue)]' : ''}`}
              >
                {/* Popular Badge */}
                {pack.popular && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                    <Badge className="bg-[var(--accent-blue)] text-white text-xs shadow">
                      Best Value
                    </Badge>
                  </div>
                )}

                <div className="text-center pt-2">
                  <p className="text-2xl font-bold text-[var(--text-primary)] mb-1">
                    {pack.credits.toLocaleString()}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mb-3">credits</p>

                  <div className="mb-3">
                    <span className="text-xl font-semibold text-[var(--text-primary)]">${pack.price}</span>
                    {pack.savings && (
                      <Badge className="ml-2 bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/20 text-xs">
                        Save {pack.savings}
                      </Badge>
                    )}
                  </div>

                  <p className="text-xs text-[var(--text-muted)] mb-4">
                    ${pack.pricePerCredit.toFixed(3)}/credit
                  </p>

                  <Button
                    variant={pack.popular ? 'default' : 'outline'}
                    size="sm"
                    className={`w-full ${pack.popular ? 'bg-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/90' : ''}`}
                    onClick={() => handlePurchaseCredits(pack.id)}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Buy Now'
                    )}
                  </Button>
                </div>
              </GlassCard>
            );
          })}
        </div>
      </section>

      {/* Recent Transactions */}
      {creditsData?.transactions && creditsData.transactions.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-[var(--text-muted)]" />
            Recent Credit Activity
          </h2>
          <GlassCard variant="bordered" className="p-0 overflow-hidden">
            <div className="divide-y divide-[var(--border-subtle)]">
              {creditsData.transactions.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between p-4 hover:bg-[var(--bg-tertiary)]/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${tx.amount > 0 ? 'bg-[var(--color-success)]/10' : 'bg-[var(--bg-tertiary)]'}`}>
                      {tx.amount > 0 ? (
                        <Gift className="h-4 w-4 text-[var(--color-success)]" />
                      ) : (
                        <Zap className="h-4 w-4 text-[var(--text-muted)]" />
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{tx.description}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {new Date(tx.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-semibold ${tx.amount > 0 ? 'text-[var(--color-success)]' : 'text-[var(--text-secondary)]'}`}>
                      {tx.amount > 0 ? '+' : ''}{tx.amount.toLocaleString()}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Balance: {tx.balanceAfter.toLocaleString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </section>
      )}

      {/* Refund Section */}
      {refundData && !refundData.details?.alreadyRefunded && (
        <section>
          <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
            <RotateCcw className="h-5 w-5 text-[var(--text-muted)]" />
            Refund Policy
          </h2>
          <GlassCard variant="bordered">
            {refundData.eligible ? (
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="p-3 rounded-xl bg-[var(--color-success)]/10">
                    <CheckCircle className="h-6 w-6 text-[var(--color-success)]" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      Eligible for Refund
                    </p>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      {refundData.details.daysRemaining} day{refundData.details.daysRemaining === 1 ? '' : 's'} remaining in your refund window
                    </p>
                  </div>
                  <Badge className="bg-[var(--color-success)]/10 text-[var(--color-success)] border border-[var(--color-success)]/20">
                    {refundData.details.daysRemaining} days left
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-4 p-4 rounded-lg bg-[var(--bg-tertiary)]">
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">Subscription Price</p>
                    <p className="text-lg font-semibold text-[var(--text-primary)]">{refundData.details.subscriptionPrice}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">Credits Used (Non-refundable)</p>
                    <p className="text-lg font-semibold text-[var(--color-warning)]">
                      {refundData.details.creditsUsed} credits
                      <span className="text-sm font-normal ml-1">({refundData.details.creditsNonRefundable})</span>
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--text-muted)]">Eligible Refund</p>
                    <p className="text-lg font-semibold text-[var(--color-success)]">{refundData.details.eligibleRefund}</p>
                  </div>
                </div>

                <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/20">
                  <AlertTriangle className="h-4 w-4 text-[var(--color-warning)] mt-0.5 shrink-0" />
                  <p className="text-xs text-[var(--text-secondary)]">
                    <strong>Credit Usage Deduction:</strong> Credits you&apos;ve used represent third-party costs (SMS via Twilio, emails via AWS, AI processing) that cannot be recovered. These are deducted from your refund amount.
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <Button
                    variant="outline"
                    className="text-[var(--color-error)] border-[var(--color-error)]/30 hover:bg-[var(--color-error)]/10"
                    onClick={() => setShowRefundModal(true)}
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    Request Refund
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-4">
                <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
                  <XCircle className="h-6 w-6 text-[var(--text-muted)]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    Not Eligible for Refund
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {refundData.reason || 'The 7-day refund window has passed or no paid subscription is active.'}
                  </p>
                  {refundData.details.purchasedAt && (
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                      Purchased: {new Date(refundData.details.purchasedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>
            )}
          </GlassCard>
        </section>
      )}

      {/* Refund Confirmation Modal */}
      {showRefundModal && refundData?.eligible && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <GlassCard variant="bordered" className="w-full max-w-md mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-xl bg-[var(--color-warning)]/10">
                <AlertTriangle className="h-6 w-6 text-[var(--color-warning)]" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Confirm Refund Request</h3>
                <p className="text-sm text-[var(--text-muted)]">This action cannot be undone</p>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              <div className="p-4 rounded-lg bg-[var(--bg-tertiary)]">
                <div className="flex justify-between mb-2">
                  <span className="text-sm text-[var(--text-muted)]">Original Subscription</span>
                  <span className="text-sm font-medium text-[var(--text-primary)]">{refundData.details.subscriptionPrice}</span>
                </div>
                {refundData.details.creditsUsed > 0 && (
                  <div className="flex justify-between mb-2">
                    <span className="text-sm text-[var(--text-muted)]">Credits Used ({refundData.details.creditsUsed})</span>
                    <span className="text-sm font-medium text-[var(--color-warning)]">-{refundData.details.creditsNonRefundable}</span>
                  </div>
                )}
                <div className="flex justify-between pt-2 border-t border-[var(--border-subtle)]">
                  <span className="text-sm font-medium text-[var(--text-primary)]">Refund Amount</span>
                  <span className="text-sm font-bold text-[var(--color-success)]">{refundData.details.eligibleRefund}</span>
                </div>
              </div>

              {refundData.details.creditsUsed > 0 && (
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={refundConfirmed}
                    onChange={(e) => setRefundConfirmed(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-[var(--border-default)] text-[var(--accent-blue)] focus:ring-[var(--accent-blue)]"
                  />
                  <span className="text-sm text-[var(--text-secondary)]">
                    I understand that {refundData.details.creditsUsed} credits ({refundData.details.creditsNonRefundable}) I&apos;ve used are non-refundable because they represent third-party costs that cannot be recovered.
                  </span>
                </label>
              )}

              <div className="flex items-start gap-2 p-3 rounded-lg bg-[var(--color-error)]/10 border border-[var(--color-error)]/20">
                <Info className="h-4 w-4 text-[var(--color-error)] mt-0.5 shrink-0" />
                <p className="text-xs text-[var(--text-secondary)]">
                  Your subscription will be downgraded to the free tier immediately. Any remaining credits will be forfeited.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setShowRefundModal(false);
                  setRefundConfirmed(false);
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-[var(--color-error)] hover:bg-[var(--color-error)]/90 text-white"
                onClick={handleRefundRequest}
                disabled={refundMutation.isPending || (refundData.details.creditsUsed > 0 && !refundConfirmed)}
              >
                {refundMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <RotateCcw className="h-4 w-4 mr-2" />
                )}
                Confirm Refund
              </Button>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Payment Method Section */}
      <section>
        <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Wallet className="h-5 w-5 text-[var(--text-muted)]" />
          Payment Method
        </h2>
        <GlassCard variant="bordered">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-[var(--bg-tertiary)]">
                <CreditCard className="h-6 w-6 text-[var(--text-muted)]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">No payment method on file</p>
                <p className="text-xs text-[var(--text-muted)]">Add a card to enable automatic billing</p>
              </div>
            </div>
            <Button variant="outline" className="gap-2">
              <ExternalLink className="h-4 w-4" />
              Add Payment Method
            </Button>
          </div>

          <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
            <div className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <p>
                Your payment information is securely processed by Stripe. We never store your full card details.
              </p>
            </div>
          </div>
        </GlassCard>
      </section>
    </div>
  );
}
