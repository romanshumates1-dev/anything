'use client';

import { useState } from 'react';
import Link from 'next/link';
import { X, Zap, TrendingUp, Clock, ArrowRight, Star, Gift } from 'lucide-react';

interface UpgradePromptProps {
  variant?: 'banner' | 'card' | 'modal' | 'inline';
  currentPlan?: string;
  usagePercent?: number;
  daysRemaining?: number;
  dismissible?: boolean;
  className?: string;
}

/**
 * UpgradePrompt - Non-pushy upgrade prompts for free/trial users
 *
 * Ethical guidelines:
 * - Only show when genuinely relevant (usage limits, trial ending)
 * - Always dismissible
 * - Focus on value, not pressure
 * - Show clear pricing with no surprises
 */
export function UpgradePrompt({
  variant = 'banner',
  currentPlan = 'free',
  usagePercent = 0,
  daysRemaining,
  dismissible = true,
  className = '',
}: UpgradePromptProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  // Only show if relevant
  const shouldShow =
    currentPlan === 'free' ||
    usagePercent >= 80 ||
    (daysRemaining !== undefined && daysRemaining <= 3);

  if (!shouldShow) return null;

  const getMessage = () => {
    if (daysRemaining !== undefined && daysRemaining <= 3) {
      return {
        headline: `Your trial ends in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`,
        subtext: 'Upgrade now to keep your AI automation running',
        cta: 'Upgrade Now',
        icon: Clock,
        urgency: 'high' as const,
      };
    }
    if (usagePercent >= 90) {
      return {
        headline: `You've used ${usagePercent}% of your monthly quota`,
        subtext: 'Upgrade for more credits and unlock AI negotiation',
        cta: 'See Plans',
        icon: TrendingUp,
        urgency: 'medium' as const,
      };
    }
    if (usagePercent >= 80) {
      return {
        headline: 'Approaching your monthly limit',
        subtext: `${usagePercent}% used - consider upgrading for unlimited potential`,
        cta: 'View Upgrade Options',
        icon: TrendingUp,
        urgency: 'low' as const,
      };
    }
    return {
      headline: 'Unlock AI Negotiation & More',
      subtext: 'Pro users close 2x more deals with AI-powered features',
      cta: 'See Pro Features',
      icon: Zap,
      urgency: 'none' as const,
    };
  };

  const message = getMessage();
  const Icon = message.icon;

  if (variant === 'banner') {
    const bgColors = {
      high: 'bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-amber-500/20',
      medium: 'bg-gradient-to-r from-[#3B82F6]/10 to-[#8B5CF6]/10 border-[#3B82F6]/20',
      low: 'bg-[#1E293B]/50 border-white/10',
      none: 'bg-[#1E293B]/30 border-white/10',
    };

    return (
      <div
        className={`relative rounded-xl border ${bgColors[message.urgency]} p-4 ${className}`}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-2 rounded-lg ${
                message.urgency === 'high'
                  ? 'bg-amber-500/20'
                  : 'bg-[#3B82F6]/20'
              }`}
            >
              <Icon
                className={`h-5 w-5 ${
                  message.urgency === 'high' ? 'text-amber-400' : 'text-[#3B82F6]'
                }`}
              />
            </div>
            <div>
              <p className="font-medium text-white">{message.headline}</p>
              <p className="text-sm text-slate-400">{message.subtext}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] text-white text-sm font-medium hover:opacity-90 transition-opacity"
            >
              {message.cta}
              <ArrowRight className="h-4 w-4" />
            </Link>
            {dismissible && (
              <button
                onClick={() => setDismissed(true)}
                className="p-1.5 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className={`rounded-2xl border border-white/10 bg-[#1E293B]/50 overflow-hidden ${className}`}>
        <div className="bg-gradient-to-r from-[#3B82F6]/10 to-[#8B5CF6]/10 p-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-[#3B82F6]" />
              <span className="font-medium text-white">Upgrade to Pro</span>
            </div>
            {dismissible && (
              <button
                onClick={() => setDismissed(true)}
                className="p-1 rounded hover:bg-white/10 text-slate-400"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="p-5">
          <ul className="space-y-3 mb-5">
            {[
              'AI negotiation that handles 80% of conversations',
              '500 SMS + 5,000 emails per month',
              'Buyer matching to close deals faster',
              'Priority support response',
            ].map((feature, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <Star className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
                {feature}
              </li>
            ))}
          </ul>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-3xl font-bold text-white">$299</span>
            <span className="text-slate-400">/month</span>
            <span className="text-sm line-through text-slate-600">$599</span>
            <span className="text-xs bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full">
              50% OFF
            </span>
          </div>
          <Link
            href="/pricing"
            className="block w-full text-center px-4 py-3 rounded-lg bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] text-white font-medium hover:opacity-90 transition-opacity"
          >
            Upgrade Now
          </Link>
          <p className="text-xs text-slate-600 text-center mt-3">
            30-day money-back guarantee
          </p>
        </div>
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className={`flex items-center gap-3 text-sm ${className}`}>
        <Zap className="h-4 w-4 text-[#3B82F6]" />
        <span className="text-slate-400">
          {message.headline}.{' '}
          <Link href="/pricing" className="text-[#3B82F6] hover:underline">
            {message.cta}
          </Link>
        </span>
        {dismissible && (
          <button onClick={() => setDismissed(true)} className="text-slate-600 hover:text-slate-400">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  // Modal variant would need more complex state management
  return null;
}

/**
 * UsageMeter - Show current usage with upgrade prompt
 */
interface UsageMeterProps {
  current: number;
  limit: number;
  label: string;
  showUpgrade?: boolean;
  className?: string;
}

export function UsageMeter({
  current,
  limit,
  label,
  showUpgrade = true,
  className = '',
}: UsageMeterProps) {
  const percent = Math.min((current / limit) * 100, 100);
  const isNearLimit = percent >= 80;
  const isAtLimit = percent >= 100;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-slate-400">{label}</span>
        <span
          className={`text-sm font-medium ${
            isAtLimit ? 'text-red-400' : isNearLimit ? 'text-amber-400' : 'text-slate-300'
          }`}
        >
          {current.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <div className="h-2 bg-[#1E293B] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isAtLimit
              ? 'bg-red-500'
              : isNearLimit
              ? 'bg-gradient-to-r from-amber-500 to-orange-500'
              : 'bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6]'
          }`}
          style={{ width: `${percent}%` }}
        />
      </div>
      {showUpgrade && isNearLimit && (
        <Link
          href="/pricing"
          className="text-xs text-[#3B82F6] hover:underline mt-2 inline-block"
        >
          Upgrade for more
        </Link>
      )}
    </div>
  );
}

/**
 * TrialCountdown - Show days remaining in trial
 */
interface TrialCountdownProps {
  daysRemaining: number;
  className?: string;
}

export function TrialCountdown({ daysRemaining, className = '' }: TrialCountdownProps) {
  const isUrgent = daysRemaining <= 3;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-2 rounded-lg ${
        isUrgent ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-white/5'
      } ${className}`}
    >
      <Clock className={`h-4 w-4 ${isUrgent ? 'text-amber-400' : 'text-slate-400'}`} />
      <span className={`text-sm ${isUrgent ? 'text-amber-400' : 'text-slate-400'}`}>
        {daysRemaining === 0 ? (
          'Trial ends today'
        ) : (
          <>
            <span className="font-medium text-white">{daysRemaining}</span> day
            {daysRemaining !== 1 ? 's' : ''} left in trial
          </>
        )}
      </span>
      <Link
        href="/pricing"
        className={`ml-auto text-sm font-medium ${
          isUrgent ? 'text-amber-400 hover:text-amber-300' : 'text-[#3B82F6] hover:text-[#60A5FA]'
        }`}
      >
        Upgrade
      </Link>
    </div>
  );
}
