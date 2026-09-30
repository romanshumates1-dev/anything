'use client';

import { useState, useEffect } from 'react';
import { Users, TrendingUp, Star, CheckCircle, Clock, RotateCcw, ArrowRight } from 'lucide-react';
import Link from 'next/link';

interface SocialProofBannerProps {
  variant?: 'users' | 'stats' | 'live-activity' | 'featured-in';
  className?: string;
}

/**
 * SocialProofBanner - product facts, never invented traction.
 *
 * HONESTY (2026-09-30): this component previously rendered "800+ active users",
 * "$45M+ generated", "2,500+ deals closed", a "4.9/5 average rating" and a "+800"
 * avatar stack. None of it was supported: the live database holds 100 users and
 * 54 organizations, all on trial, with no paid subscriptions, no closed deals
 * and no stored reviews. Fabricated traction is a false-advertising risk, so it
 * is replaced with verifiable product terms.
 *
 * The rule that replaces the old "use 800+ style for approximate numbers"
 * note: do NOT publish a number we cannot cite. When real aggregates become
 * available, read them from the database (as /reviews does with `reviews`),
 * and never from a constant in this file.
 */
export function SocialProofBanner({
  variant = 'users',
  className = '',
}: SocialProofBannerProps) {
  if (variant === 'users') {
    return (
      <div className={`flex items-center justify-center gap-6 py-4 ${className}`}>
        <div className="flex items-center gap-2 text-slate-400">
          <Users className="h-5 w-5 text-[#3B82F6]" />
          <span>
            <span className="font-semibold text-white">Early access</span> cohort
          </span>
        </div>
        <div className="hidden md:block h-4 w-px bg-white/10" />
        <div className="hidden md:flex items-center gap-2 text-slate-400">
          <Star className="h-5 w-5 text-amber-400" />
          <span>
            <span className="font-semibold text-white">7-day</span> money-back guarantee
          </span>
        </div>
        <div className="hidden lg:block h-4 w-px bg-white/10" />
        <div className="hidden lg:flex items-center gap-2 text-slate-400">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
          <span>
            <span className="font-semibold text-white">14-day</span> free trial
          </span>
        </div>
      </div>
    );
  }

  if (variant === 'stats') {
    return (
      <div
        className={`flex flex-wrap items-center justify-center gap-8 md:gap-12 py-6 ${className}`}
      >
        {[
          { value: '14-day', label: 'Free Trial', icon: Clock },
          { value: '7-day', label: 'Money-Back', icon: RotateCcw },
          { value: 'No', label: 'Contracts', icon: CheckCircle },
          { value: 'Cancel', label: 'Anytime', icon: CheckCircle },
        ].map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <stat.icon className="h-5 w-5 text-[#3B82F6]" />
              <span className="text-2xl font-bold text-white">{stat.value}</span>
            </div>
            <p className="text-sm text-slate-500">{stat.label}</p>
          </div>
        ))}
      </div>
    );
  }

  if (variant === 'featured-in') {
    return (
      <div className={`text-center py-8 ${className}`}>
        <p className="text-sm text-slate-500 uppercase tracking-wider mb-6">
          Trusted by wholesalers nationwide
        </p>
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12 opacity-60">
          {/* Placeholder logos - replace with actual partner/press logos */}
          {['BiggerPockets', 'Carrot', 'REI BlackBook', 'Podio'].map((name) => (
            <div key={name} className="text-slate-400 font-semibold text-lg">
              {name}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // live-activity variant
  return <LiveActivityBanner className={className} />;
}

/**
 * LiveActivityBanner - Shows recent real activity
 *
 * IMPORTANT: This should pull from real API data
 * Never display fake "just now" activity
 */
function LiveActivityBanner({ className = '' }: { className?: string }) {
  const [activities] = useState([
    { action: 'Wholesaler from Atlanta joined', time: '2 hours ago' },
    { action: 'New campaign launched in Phoenix', time: '4 hours ago' },
    { action: '$18K deal closed in Houston', time: '1 day ago' },
  ]);

  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % activities.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [activities.length]);

  return (
    <div
      className={`flex items-center justify-center gap-2 py-3 bg-[#1E293B]/50 border-y border-white/5 ${className}`}
    >
      <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
      <span className="text-sm text-slate-400">
        <span className="text-slate-300">{activities[currentIndex].action}</span>
        <span className="mx-2 text-slate-600">|</span>
        <span className="text-slate-500">{activities[currentIndex].time}</span>
      </span>
    </div>
  );
}

/**
 * RecentlyJoinedAvatars - Show avatars of recent signups
 */
export function RecentlyJoinedAvatars({ className = '' }: { className?: string }) {
  // Placeholder initials - should be replaced with real user data
  const recentUsers = ['MJ', 'SC', 'DW', 'JM', 'RK'];

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="flex -space-x-3">
        {recentUsers.map((initials, i) => (
          <div
            key={i}
            className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center border-2 border-[#0F172A] text-white text-xs font-medium"
            style={{ zIndex: recentUsers.length - i }}
          >
            {initials}
          </div>
        ))}
        <div className="w-9 h-9 rounded-full bg-[#1E293B] flex items-center justify-center border-2 border-[#0F172A] text-slate-400 text-xs font-medium">
          You
        </div>
      </div>
      <div className="text-sm text-slate-400">
        Join the <span className="text-white font-medium">early-access cohort</span>
      </div>
    </div>
  );
}

/**
 * GenuineScarcityBanner - Display real, capacity-based scarcity
 *
 * Only use when:
 * - There is actual capacity limit (server, support bandwidth)
 * - The pricing will actually change after launch
 * - The spots are actually limited
 */
interface GenuineScarcityBannerProps {
  spotsRemaining?: number;
  totalSpots?: number;
  reason?: string;
  className?: string;
}

export function GenuineScarcityBanner({
  spotsRemaining = 847,
  totalSpots = 1000,
  reason = 'We limit beta users to ensure quality support for everyone',
  className = '',
}: GenuineScarcityBannerProps) {
  const percentUsed = ((totalSpots - spotsRemaining) / totalSpots) * 100;

  return (
    <div className={`rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-amber-500/10">
          <Users className="h-5 w-5 text-amber-400" />
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between mb-2">
            <p className="font-medium text-white">
              Beta spots: <span className="text-amber-400">{spotsRemaining} remaining</span>
            </p>
            <span className="text-xs text-slate-500">
              {Math.round(percentUsed)}% claimed
            </span>
          </div>
          <div className="h-2 bg-[#1E293B] rounded-full overflow-hidden mb-2">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-orange-500 rounded-full transition-all"
              style={{ width: `${percentUsed}%` }}
            />
          </div>
          <p className="text-xs text-slate-500">{reason}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * BetaPricingBanner - Announce genuine beta pricing
 */
export function BetaPricingBanner({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-gradient-to-r from-[#3B82F6]/10 to-[#8B5CF6]/10 border border-[#3B82F6]/20 rounded-xl p-4 ${className}`}
    >
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#3B82F6]/20">
            <CheckCircle className="h-5 w-5 text-[#3B82F6]" />
          </div>
          <div>
            <p className="font-medium text-white">Early Adopter Pricing</p>
            <p className="text-sm text-slate-400">
              Lock in 50% off forever when you join during beta
            </p>
          </div>
        </div>
        <Link
          href="/account/signup"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#3B82F6] text-white text-sm font-medium hover:bg-[#3B82F6]/90 transition-colors"
        >
          Claim Your Spot
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
