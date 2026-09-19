'use client';

import { Shield, CheckCircle, RotateCcw, Clock, CreditCard, Zap, Lock, Award } from 'lucide-react';

type GuaranteeType =
  | 'money-back'
  | 'free-trial'
  | 'cancel-anytime'
  | 'no-credit-card'
  | 'uptime'
  | 'security'
  | 'support';

interface GuaranteeBadgeProps {
  type: GuaranteeType;
  variant?: 'default' | 'compact' | 'detailed';
  className?: string;
}

/**
 * GuaranteeBadge - Display trust and guarantee elements
 *
 * Ethical guidelines:
 * - Only display guarantees that are actually offered
 * - Link to terms where applicable
 * - Be specific about conditions
 */

const GUARANTEES: Record<
  GuaranteeType,
  {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    shortTitle: string;
    description: string;
    color: string;
    bgColor: string;
  }
> = {
  'money-back': {
    icon: RotateCcw,
    title: '7-Day Money-Back Guarantee',
    shortTitle: '7-Day Guarantee',
    description: "Not satisfied? Get a full refund within 7 days. No questions asked.",
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
  },
  'free-trial': {
    icon: Clock,
    title: '14-Day Free Trial',
    shortTitle: '14-Day Trial',
    description: "Try everything free for 14 days. Full access, no limits.",
    color: 'text-[#3B82F6]',
    bgColor: 'bg-[#3B82F6]/10',
  },
  'cancel-anytime': {
    icon: CheckCircle,
    title: 'Cancel Anytime',
    shortTitle: 'Cancel Anytime',
    description: "No contracts, no commitments. Cancel with one click.",
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
  },
  'no-credit-card': {
    icon: CreditCard,
    title: 'No Credit Card Required',
    shortTitle: 'No Card Needed',
    description: "Start your trial without entering payment info.",
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
  },
  uptime: {
    icon: Zap,
    title: '99.9% Uptime SLA',
    shortTitle: '99.9% Uptime',
    description: "Enterprise-grade reliability backed by our SLA.",
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
  },
  security: {
    icon: Lock,
    title: 'Enterprise Security',
    shortTitle: 'Secure',
    description: "256-bit encryption, SOC 2 compliant, data protection.",
    color: 'text-slate-300',
    bgColor: 'bg-slate-500/10',
  },
  support: {
    icon: Award,
    title: 'Priority Support',
    shortTitle: 'Priority Support',
    description: "Get help when you need it from real humans.",
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/10',
  },
};

export function GuaranteeBadge({
  type,
  variant = 'default',
  className = '',
}: GuaranteeBadgeProps) {
  const guarantee = GUARANTEES[type];
  const Icon = guarantee.icon;

  if (variant === 'compact') {
    return (
      <div className={`inline-flex items-center gap-2 text-sm ${guarantee.color} ${className}`}>
        <Icon className="h-4 w-4" />
        <span>{guarantee.shortTitle}</span>
      </div>
    );
  }

  if (variant === 'detailed') {
    return (
      <div className={`rounded-xl border border-white/10 bg-[#1E293B]/30 p-5 ${className}`}>
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-lg ${guarantee.bgColor}`}>
            <Icon className={`h-6 w-6 ${guarantee.color}`} />
          </div>
          <div>
            <h4 className="font-semibold text-white">{guarantee.title}</h4>
            <p className="text-sm text-slate-400 mt-1">{guarantee.description}</p>
          </div>
        </div>
      </div>
    );
  }

  // Default variant
  return (
    <div
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg ${guarantee.bgColor} ${className}`}
    >
      <Icon className={`h-4 w-4 ${guarantee.color}`} />
      <span className={`text-sm font-medium ${guarantee.color}`}>{guarantee.shortTitle}</span>
    </div>
  );
}

/**
 * GuaranteeBadgeRow - Display multiple guarantees in a row
 */
interface GuaranteeBadgeRowProps {
  guarantees?: GuaranteeType[];
  variant?: 'default' | 'compact' | 'detailed';
  className?: string;
}

export function GuaranteeBadgeRow({
  guarantees = ['free-trial', 'no-credit-card', 'cancel-anytime', 'money-back'],
  variant = 'compact',
  className = '',
}: GuaranteeBadgeRowProps) {
  return (
    <div className={`flex flex-wrap items-center justify-center gap-4 md:gap-6 ${className}`}>
      {guarantees.map((type) => (
        <GuaranteeBadge key={type} type={type} variant={variant} />
      ))}
    </div>
  );
}

/**
 * TrustBadgeSection - Full trust section with guarantees
 */
export function TrustBadgeSection({ className = '' }: { className?: string }) {
  return (
    <div className={`text-center ${className}`}>
      <h3 className="text-lg font-semibold text-white mb-6">Risk-Free to Try</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
        <GuaranteeBadge type="free-trial" variant="detailed" />
        <GuaranteeBadge type="no-credit-card" variant="detailed" />
        <GuaranteeBadge type="cancel-anytime" variant="detailed" />
        <GuaranteeBadge type="money-back" variant="detailed" />
      </div>
    </div>
  );
}

/**
 * SecurityBadges - Display security/compliance badges
 */
export function SecurityBadges({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap justify-center gap-6 ${className}`}>
      {[
        { icon: Shield, label: 'SOC 2 Compliant' },
        { icon: Lock, label: '256-bit Encryption' },
        { icon: Zap, label: '99.9% Uptime' },
        { icon: CheckCircle, label: '7-Day Guarantee' },
      ].map((badge) => (
        <div
          key={badge.label}
          className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-lg text-slate-400"
        >
          <badge.icon className="h-4 w-4" />
          <span className="text-sm">{badge.label}</span>
        </div>
      ))}
    </div>
  );
}
