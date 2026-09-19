"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Check, X, Star, ArrowRight, Zap, Users, Shield, Sparkles, Building2, Crown, Rocket, TrendingUp, Calculator } from "lucide-react";
import {
  PRICING_TIERS,
  type TierName,
  type BillingPeriod,
  getEffectiveMonthlyPrice,
  getDiscountPercentage,
  getTierOrder,
} from "@/app/api/utils/pricingTiers";

const BILLING_PERIODS: { value: BillingPeriod; label: string; shortLabel: string; savingsLabel: string }[] = [
  { value: 1, label: "Monthly", shortLabel: "1 mo", savingsLabel: "" },
  { value: 3, label: "Quarterly", shortLabel: "3 mo", savingsLabel: "Save 10%" },
  { value: 6, label: "Semi-Annual", shortLabel: "6 mo", savingsLabel: "Save 20%" },
  { value: 12, label: "Annual", shortLabel: "12 mo", savingsLabel: "Save 27%" },
];

// Tier-specific colors for differentiation
const TIER_COLORS: Record<TierName, { bg: string; text: string; border: string; gradient: string }> = {
  STARTER: { bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/30", gradient: "from-slate-500 to-slate-600" },
  PRO: { bg: "bg-blue-500/10", text: "text-blue-400", border: "border-blue-500/50", gradient: "from-blue-500 to-blue-600" },
  BUSINESS: { bg: "bg-emerald-500/10", text: "text-emerald-400", border: "border-emerald-500/50", gradient: "from-emerald-500 to-emerald-600" },
  GROWTH: { bg: "bg-amber-500/10", text: "text-amber-400", border: "border-amber-500/50", gradient: "from-amber-500 to-amber-600" },
  SCALE: { bg: "bg-purple-500/10", text: "text-purple-400", border: "border-purple-500/50", gradient: "from-purple-500 to-purple-600" },
  PROFESSIONAL: { bg: "bg-rose-500/10", text: "text-rose-400", border: "border-rose-500/50", gradient: "from-rose-500 to-rose-600" },
  ENTERPRISE: { bg: "bg-indigo-500/10", text: "text-indigo-400", border: "border-indigo-500/50", gradient: "from-indigo-500 to-indigo-600" },
  ELITE: { bg: "bg-yellow-500/10", text: "text-yellow-400", border: "border-yellow-500/50", gradient: "from-yellow-400 to-yellow-600" },
};

const TIER_ICONS: Record<TierName, React.ReactNode> = {
  STARTER: <Zap className="h-5 w-5" />,
  PRO: <Star className="h-5 w-5" />,
  BUSINESS: <Users className="h-5 w-5" />,
  GROWTH: <TrendingUp className="h-5 w-5" />,
  SCALE: <Rocket className="h-5 w-5" />,
  PROFESSIONAL: <Building2 className="h-5 w-5" />,
  ENTERPRISE: <Shield className="h-5 w-5" />,
  ELITE: <Crown className="h-5 w-5" />,
};

const TIER_DESCRIPTIONS: Record<TierName, string> = {
  STARTER: "Perfect for getting started",
  PRO: "For serious investors",
  BUSINESS: "For growing teams",
  GROWTH: "For high-volume operations",
  SCALE: "For large organizations",
  PROFESSIONAL: "For power users",
  ENTERPRISE: "For enterprise needs",
  ELITE: "For maximum scale",
};

const TIER_HIGHLIGHTS: Record<TierName, string[]> = {
  STARTER: ["100 leads/mo", "500 SMS/mo", "Basic analytics", "1 team seat"],
  PRO: ["500 leads/mo", "2,000 SMS/mo", "Phone outreach", "Standard analytics", "3 team seats"],
  BUSINESS: ["2,000 leads/mo", "5,000 SMS/mo", "Advanced analytics", "5 team seats"],
  GROWTH: ["5,000 leads/mo", "10,000 SMS/mo", "Priority support", "10 team seats"],
  SCALE: ["10,000 leads/mo", "20,000 SMS/mo", "Full analytics", "15 team seats"],
  PROFESSIONAL: ["25,000 leads/mo", "50,000 SMS/mo", "API access", "25 team seats"],
  ENTERPRISE: ["Unlimited leads", "100,000 SMS/mo", "Dedicated support", "50 team seats"],
  ELITE: ["Unlimited everything", "White-label option", "Custom integrations", "SLA guarantee"],
};

const POPULAR_TIER: TierName = "PRO";
const BEST_VALUE_TIER: TierName = "BUSINESS";

// Feature comparison data
const FEATURE_CATEGORIES = [
  {
    name: "Usage Limits",
    features: [
      { key: "leads", label: "Leads per month", format: (v: number | string) => typeof v === "string" ? v : v.toLocaleString() },
      { key: "campaigns", label: "Active campaigns", format: (v: number | string) => typeof v === "string" ? v : v.toString() },
      { key: "smsPerMonth", label: "SMS per month", format: (v: number | string) => typeof v === "string" ? v : v.toLocaleString() },
      { key: "emailPerMonth", label: "Emails per month", format: (v: number | string) => typeof v === "string" ? v : v.toLocaleString() },
    ],
  },
  {
    name: "Core Features",
    features: [
      { key: "aiMessages", label: "AI-powered messaging", format: (v: boolean) => v },
      { key: "phoneOutreach", label: "Phone outreach", format: (v: boolean) => v },
      { key: "teamSeats", label: "Team seats", format: (v: number | string) => typeof v === "string" ? v : v.toString() },
    ],
  },
  {
    name: "Advanced Features",
    features: [
      { key: "analytics", label: "Analytics level", format: (v: string) => v.charAt(0).toUpperCase() + v.slice(1) },
      { key: "apiAccess", label: "API access", format: (v: boolean) => v },
      { key: "dedicatedSupport", label: "Dedicated support", format: (v: boolean) => v },
      { key: "whiteLabel", label: "White-label option", format: (v: boolean) => v },
    ],
  },
];

export default function PricingTierSelector() {
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(1);
  const [isAnnual, setIsAnnual] = useState(false);
  const [showAllTiers, setShowAllTiers] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  // Sync annual toggle with billing period
  const effectivePeriod = isAnnual ? 12 : billingPeriod;

  const tiers = useMemo(() => {
    return getTierOrder().map((tierKey) => {
      const tier = PRICING_TIERS[tierKey];
      const totalPrice = tier.prices[effectivePeriod];
      const monthlyPrice = getEffectiveMonthlyPrice(tierKey, effectivePeriod);
      const discount = getDiscountPercentage(tierKey, effectivePeriod);
      const baseMonthlyPrice = tier.prices[1];
      const colors = TIER_COLORS[tierKey];

      // Calculate total savings over billing period
      const totalSavings = (baseMonthlyPrice * effectivePeriod) - totalPrice;

      return {
        key: tierKey,
        name: tier.name,
        description: TIER_DESCRIPTIONS[tierKey],
        icon: TIER_ICONS[tierKey],
        highlights: TIER_HIGHLIGHTS[tierKey],
        colors,
        totalPrice,
        monthlyPrice,
        baseMonthlyPrice,
        discount,
        totalSavings,
        credits: tier.credits,
        features: tier.features,
        isPopular: tierKey === POPULAR_TIER,
        isBestValue: tierKey === BEST_VALUE_TIER,
      };
    });
  }, [effectivePeriod]);

  // Show first 4 tiers prominently, rest in expandable section
  const primaryTiers = tiers.slice(0, 4);
  const advancedTiers = tiers.slice(4);

  // Calculate max savings for the annual period
  const maxSavings = useMemo(() => {
    if (effectivePeriod === 1) return 0;
    return tiers.reduce((max, tier) => Math.max(max, tier.totalSavings), 0);
  }, [tiers, effectivePeriod]);

  return (
    <div className="space-y-12">
      {/* Billing Period Selector */}
      <div className="flex flex-col items-center gap-6">
        {/* Monthly/Annual Toggle with enhanced visuals */}
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <div className="flex items-center gap-4">
            <span className={`text-sm font-medium transition-colors ${!isAnnual ? "text-white" : "text-slate-500"}`}>
              Flexible Billing
            </span>
            <button
              onClick={() => setIsAnnual(!isAnnual)}
              className={`relative w-16 h-8 rounded-full transition-all duration-300 ${
                isAnnual ? "bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-lg shadow-emerald-500/25" : "bg-slate-600"
              }`}
              aria-label="Toggle annual billing"
            >
              <span
                className={`absolute top-1 left-1 w-6 h-6 rounded-full bg-white shadow-md transition-transform duration-300 ${
                  isAnnual ? "translate-x-8" : ""
                }`}
              />
            </button>
            <span className={`text-sm font-medium transition-colors ${isAnnual ? "text-white" : "text-slate-500"}`}>
              Annual
            </span>
          </div>
          {isAnnual && (
            <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-3 py-1.5 rounded-full text-sm font-medium animate-pulse">
              <Sparkles className="h-4 w-4" />
              Save up to 27% + Bonus Credits
            </div>
          )}
        </div>

        {/* Detailed Period Selector - Enhanced */}
        {!isAnnual && (
          <div className="w-full max-w-2xl">
            <div className="flex flex-wrap justify-center gap-2 sm:gap-3 p-1.5 bg-slate-800/50 rounded-xl border border-white/5">
              {BILLING_PERIODS.map((period) => {
                const isSelected = billingPeriod === period.value;
                const discount = period.value > 1 ? getDiscountPercentage("PRO", period.value) : 0;

                return (
                  <button
                    key={period.value}
                    onClick={() => setBillingPeriod(period.value)}
                    className={`relative flex flex-col items-center px-4 sm:px-6 py-2.5 rounded-lg text-sm font-medium transition-all ${
                      isSelected
                        ? "bg-gradient-to-r from-[#3B82F6] to-[#6366F1] text-white shadow-lg shadow-blue-500/25"
                        : "text-slate-400 hover:text-white hover:bg-slate-700/50"
                    }`}
                  >
                    <span className="hidden sm:inline font-semibold">{period.label}</span>
                    <span className="sm:hidden font-semibold">{period.shortLabel}</span>
                    {period.value > 1 && (
                      <span className={`text-xs mt-0.5 ${isSelected ? "text-emerald-200" : "text-emerald-400"}`}>
                        Save {discount}%
                      </span>
                    )}
                    {period.value === 12 && (
                      <span className="absolute -top-2 -right-2 bg-emerald-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                        BEST
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Enhanced Savings Callout */}
        {effectivePeriod > 1 && (
          <div className="w-full max-w-lg">
            <div className="bg-gradient-to-r from-emerald-500/10 to-blue-500/10 border border-emerald-500/20 rounded-xl p-4">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/20 rounded-lg">
                    <Calculator className="h-5 w-5 text-emerald-400" />
                  </div>
                  <div className="text-center sm:text-left">
                    <p className="text-sm text-slate-400">
                      Billed every {effectivePeriod} months
                    </p>
                    <p className="text-white font-semibold">
                      ${primaryTiers[1].totalPrice} total ({primaryTiers[1].name} plan)
                    </p>
                  </div>
                </div>
                <div className="text-center sm:text-right">
                  <p className="text-emerald-400 font-bold text-lg">
                    Save ${primaryTiers[1].totalSavings}
                  </p>
                  <p className="text-xs text-slate-500">vs monthly billing</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Primary Tier Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
        {primaryTiers.map((tier) => (
          <div
            key={tier.key}
            className={`relative rounded-2xl p-5 lg:p-6 flex flex-col transition-all duration-300 hover:translate-y-[-4px] ${
              tier.isPopular
                ? `border-2 ${tier.colors.border} bg-[#1E293B]/80 scale-[1.02] z-10 shadow-xl shadow-blue-500/20`
                : tier.isBestValue
                ? `border-2 ${tier.colors.border} bg-[#1E293B]/60 shadow-lg shadow-emerald-500/10`
                : `border border-white/10 bg-[#1E293B]/30 hover:border-white/20 hover:shadow-lg`
            }`}
          >
            {/* Badges */}
            {tier.isPopular && (
              <div className={`absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r ${tier.colors.gradient} text-white text-xs font-semibold px-4 py-1.5 rounded-full flex items-center gap-1.5 shadow-lg`}>
                <Star className="h-3.5 w-3.5 fill-white" /> Most Popular
              </div>
            )}
            {tier.isBestValue && !tier.isPopular && (
              <div className={`absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r ${tier.colors.gradient} text-white text-xs font-semibold px-4 py-1.5 rounded-full shadow-lg`}>
                Best Value
              </div>
            )}

            {/* Header with tier-specific color accent */}
            <div className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <div className={`p-2 rounded-lg ${tier.colors.bg} ${tier.colors.text}`}>
                  {tier.icon}
                </div>
                <h3 className="text-xl font-bold text-white">{tier.name}</h3>
              </div>
              <p className="text-sm text-slate-400">{tier.description}</p>
            </div>

            {/* Enhanced Pricing Display */}
            <div className="mb-5">
              <div className="flex items-baseline gap-1">
                <span className={`text-4xl font-bold ${tier.isPopular ? tier.colors.text : "text-white"}`}>
                  ${tier.monthlyPrice}
                </span>
                <span className="text-slate-400">/mo</span>
              </div>
              {effectivePeriod > 1 && (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-500 line-through">${tier.baseMonthlyPrice}/mo</span>
                    <span className={`text-xs ${tier.colors.bg} ${tier.colors.text} px-2 py-0.5 rounded-full font-semibold`}>
                      Save {tier.discount}%
                    </span>
                  </div>
                  <div className="mt-2 p-2 bg-white/5 rounded-lg">
                    <p className="text-xs text-slate-400">
                      <span className="text-white font-medium">${tier.totalPrice}</span> billed every {effectivePeriod} months
                    </p>
                    <p className="text-xs text-emerald-400 font-medium mt-0.5">
                      You save ${tier.totalSavings} per cycle
                    </p>
                  </div>
                </>
              )}
            </div>

            {/* Credits with visual indicator */}
            <div className={`mb-4 p-3 rounded-lg ${tier.colors.bg} border ${tier.colors.border}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-300">AI Credits</span>
                <span className={`text-lg font-bold ${tier.colors.text}`}>{tier.credits.toLocaleString()}</span>
              </div>
              <div className="mt-2 h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full bg-gradient-to-r ${tier.colors.gradient} rounded-full`}
                  style={{ width: `${Math.min(100, (tier.credits / 10000) * 100)}%` }}
                />
              </div>
            </div>

            {/* Key Features */}
            <ul className="space-y-2.5 flex-1 mb-6">
              {tier.highlights.map((feature, i) => (
                <li key={i} className="flex items-start gap-2">
                  <Check className={`h-4 w-4 flex-shrink-0 mt-0.5 ${tier.colors.text}`} />
                  <span className="text-sm text-slate-300">{feature}</span>
                </li>
              ))}
            </ul>

            {/* CTA Button with tier-specific styling */}
            <Link
              href={`/account/signup?plan=${tier.key.toLowerCase()}&period=${effectivePeriod}`}
              className={`w-full text-center rounded-lg px-4 py-3 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                tier.isPopular
                  ? `bg-gradient-to-r ${tier.colors.gradient} text-white hover:opacity-90 shadow-lg shadow-blue-500/25`
                  : tier.isBestValue
                  ? `bg-gradient-to-r ${tier.colors.gradient} text-white hover:opacity-90 shadow-lg shadow-emerald-500/25`
                  : `bg-white/5 text-white border ${tier.colors.border} hover:bg-white/10`
              }`}
            >
              Get Started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ))}
      </div>

      {/* Advanced Tiers - Enhanced Collapsible */}
      {advancedTiers.length > 0 && (
        <div className="mt-12">
          <button
            onClick={() => setShowAllTiers(!showAllTiers)}
            className="w-full flex items-center justify-center gap-2 py-4 text-slate-400 hover:text-white transition-colors group"
          >
            <span className="text-sm font-medium">
              {showAllTiers ? "Hide" : "View"} high-volume enterprise plans
            </span>
            <div className={`p-1 rounded-full bg-white/5 group-hover:bg-white/10 transition-all ${showAllTiers ? "rotate-180" : ""}`}>
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </button>

          {showAllTiers && (
            <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6 animate-in slide-in-from-top-4 duration-300">
              {advancedTiers.map((tier) => (
                <div
                  key={tier.key}
                  className={`relative rounded-2xl p-5 lg:p-6 flex flex-col border ${tier.colors.border} bg-gradient-to-b from-[#1E293B]/60 to-[#1E293B]/30 hover:from-[#1E293B]/80 transition-all duration-300 hover:translate-y-[-4px] hover:shadow-lg`}
                >
                  {/* Enterprise badge for top tiers */}
                  {(tier.key === "ENTERPRISE" || tier.key === "ELITE") && (
                    <div className={`absolute -top-3 right-4 bg-gradient-to-r ${tier.colors.gradient} text-white text-[10px] font-bold px-2 py-1 rounded-md`}>
                      ENTERPRISE
                    </div>
                  )}

                  {/* Header with tier color */}
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`p-2 rounded-lg ${tier.colors.bg} ${tier.colors.text}`}>
                        {tier.icon}
                      </div>
                      <h3 className="text-xl font-bold text-white">{tier.name}</h3>
                    </div>
                    <p className="text-sm text-slate-400">{tier.description}</p>
                  </div>

                  {/* Pricing */}
                  <div className="mb-5">
                    <div className="flex items-baseline gap-1">
                      <span className={`text-3xl font-bold ${tier.colors.text}`}>${tier.monthlyPrice.toLocaleString()}</span>
                      <span className="text-slate-400">/mo</span>
                    </div>
                    {effectivePeriod > 1 && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-sm text-slate-500 line-through">${tier.baseMonthlyPrice.toLocaleString()}/mo</span>
                        <span className={`text-xs ${tier.colors.bg} ${tier.colors.text} px-2 py-0.5 rounded-full font-semibold`}>
                          Save {tier.discount}%
                        </span>
                      </div>
                    )}
                    {effectivePeriod > 1 && (
                      <p className="mt-2 text-xs text-slate-500">
                        ${tier.totalPrice.toLocaleString()} billed every {effectivePeriod} months
                      </p>
                    )}
                  </div>

                  {/* Credits */}
                  <div className={`mb-4 p-3 rounded-lg ${tier.colors.bg} border ${tier.colors.border}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">AI Credits</span>
                      <span className={`text-lg font-bold ${tier.colors.text}`}>{tier.credits.toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Key Features */}
                  <ul className="space-y-2 flex-1 mb-6">
                    {tier.highlights.map((feature, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className={`h-4 w-4 flex-shrink-0 mt-0.5 ${tier.colors.text}`} />
                        <span className="text-sm text-slate-300">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Link
                    href={tier.key === "ELITE" || tier.key === "ENTERPRISE" ? "/contact?plan=enterprise" : `/account/signup?plan=${tier.key.toLowerCase()}&period=${effectivePeriod}`}
                    className={`w-full text-center rounded-lg px-4 py-3 text-sm font-semibold transition-all flex items-center justify-center gap-2 bg-gradient-to-r ${tier.colors.gradient} text-white hover:opacity-90 shadow-lg`}
                  >
                    {tier.key === "ELITE" || tier.key === "ENTERPRISE" ? "Contact Sales" : "Get Started"}
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Feature Comparison Table */}
      <div className="mt-16">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white mb-2">Compare All Plans</h2>
          <p className="text-slate-400 mb-4">Detailed feature comparison across all tiers</p>

          {/* Toggle to show all tiers in comparison */}
          <button
            onClick={() => setShowComparison(!showComparison)}
            className="inline-flex items-center gap-2 text-sm text-[#3B82F6] hover:text-blue-300 transition-colors"
          >
            {showComparison ? "Show fewer plans" : "Compare all 8 plans"}
            <svg
              className={`w-4 h-4 transition-transform ${showComparison ? "rotate-180" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#1E293B]/50">
                <th className="text-left p-4 font-medium text-slate-400 sticky left-0 bg-[#1E293B] z-20 min-w-[160px]">
                  Feature
                </th>
                {(showComparison ? tiers : tiers.slice(0, 4)).map((tier) => (
                  <th
                    key={tier.key}
                    className={`text-center p-4 font-medium min-w-[120px] ${
                      tier.isPopular ? `${tier.colors.text} ${tier.colors.bg}` : "text-slate-400"
                    }`}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <div className={`p-1.5 rounded-lg ${tier.colors.bg}`}>
                        <div className={tier.colors.text}>{tier.icon}</div>
                      </div>
                      <span className="font-semibold">{tier.name}</span>
                      {tier.isPopular && (
                        <span className={`text-[10px] ${tier.colors.text} font-medium px-1.5 py-0.5 rounded-full ${tier.colors.bg}`}>
                          POPULAR
                        </span>
                      )}
                      {tier.isBestValue && !tier.isPopular && (
                        <span className={`text-[10px] ${tier.colors.text} font-medium px-1.5 py-0.5 rounded-full ${tier.colors.bg}`}>
                          BEST VALUE
                        </span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Pricing Row at Top */}
              <tr className="bg-gradient-to-r from-[#1E293B]/80 to-[#1E293B]/60 border-b-2 border-white/10">
                <td className="p-4 text-sm font-semibold text-white sticky left-0 bg-[#1E293B] z-10">
                  <div className="flex items-center gap-2">
                    <Calculator className="h-4 w-4 text-[#3B82F6]" />
                    Effective Price
                    <span className="text-xs text-slate-500 font-normal">
                      ({effectivePeriod === 1 ? "monthly" : `${effectivePeriod} mo billing`})
                    </span>
                  </div>
                </td>
                {(showComparison ? tiers : tiers.slice(0, 4)).map((tier) => (
                  <td
                    key={tier.key}
                    className={`p-4 text-center ${tier.isPopular ? tier.colors.bg : ""}`}
                  >
                    <div className={`text-xl font-bold ${tier.colors.text}`}>
                      ${tier.monthlyPrice.toLocaleString()}
                      <span className="text-sm text-slate-400 font-normal">/mo</span>
                    </div>
                    {effectivePeriod > 1 && (
                      <div className="flex flex-col items-center gap-0.5 mt-1">
                        <span className="text-xs text-slate-500 line-through">${tier.baseMonthlyPrice.toLocaleString()}/mo</span>
                        <span className={`text-xs ${tier.colors.text} font-semibold`}>
                          Save {tier.discount}%
                        </span>
                      </div>
                    )}
                  </td>
                ))}
              </tr>

              {/* AI Credits Row */}
              <tr className="border-b border-white/5 bg-white/[0.02]">
                <td className="p-4 text-sm text-slate-300 sticky left-0 bg-[#0F172A] z-10 font-medium">
                  AI Credits / month
                </td>
                {(showComparison ? tiers : tiers.slice(0, 4)).map((tier) => (
                  <td
                    key={tier.key}
                    className={`p-4 text-center ${tier.isPopular ? tier.colors.bg : ""}`}
                  >
                    <span className={`text-sm font-bold ${tier.colors.text}`}>
                      {tier.credits.toLocaleString()}
                    </span>
                  </td>
                ))}
              </tr>

              {FEATURE_CATEGORIES.map((category, catIdx) => (
                <>
                  <tr key={`cat-${catIdx}`} className="bg-[#1E293B]/30">
                    <td colSpan={(showComparison ? tiers.length : 4) + 1} className="p-3 text-sm font-semibold text-white border-t border-white/10">
                      {category.name}
                    </td>
                  </tr>
                  {category.features.map((feature, featIdx) => {
                    return (
                      <tr
                        key={`${catIdx}-${featIdx}`}
                        className={`border-b border-white/5 ${featIdx % 2 === 0 ? "" : "bg-white/[0.02]"} hover:bg-white/[0.04] transition-colors`}
                      >
                        <td className="p-4 text-sm text-slate-300 sticky left-0 bg-[#0F172A] z-10">
                          {feature.label}
                        </td>
                        {(showComparison ? tiers : tiers.slice(0, 4)).map((tier) => {
                          const value = tier.features[feature.key as keyof typeof tier.features];
                          const formatted = value !== undefined ? feature.format(value as never) : false;

                          return (
                            <td
                              key={tier.key}
                              className={`p-4 text-center ${tier.isPopular ? tier.colors.bg : ""}`}
                            >
                              {typeof formatted === "boolean" ? (
                                formatted ? (
                                  <Check className={`h-5 w-5 mx-auto ${tier.colors.text}`} />
                                ) : (
                                  <X className="h-5 w-5 text-slate-600 mx-auto" />
                                )
                              ) : (
                                <span
                                  className={`text-sm ${
                                    tier.isPopular ? `font-semibold ${tier.colors.text}` : "text-slate-300"
                                  }`}
                                >
                                  {formatted}
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </>
              ))}

              {/* CTA Row at Bottom */}
              <tr className="bg-[#1E293B]/50 border-t-2 border-white/10">
                <td className="p-4 text-sm font-semibold text-white sticky left-0 bg-[#1E293B] z-10">
                  Get Started
                </td>
                {(showComparison ? tiers : tiers.slice(0, 4)).map((tier) => (
                  <td
                    key={tier.key}
                    className={`p-4 text-center ${tier.isPopular ? tier.colors.bg : ""}`}
                  >
                    <Link
                      href={tier.key === "ELITE" || tier.key === "ENTERPRISE"
                        ? "/contact?plan=enterprise"
                        : `/account/signup?plan=${tier.key.toLowerCase()}&period=${effectivePeriod}`
                      }
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all bg-gradient-to-r ${tier.colors.gradient} text-white hover:opacity-90`}
                    >
                      {tier.key === "ELITE" || tier.key === "ENTERPRISE" ? "Contact" : "Select"}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {/* Comparison Legend */}
        <div className="mt-4 flex flex-wrap justify-center gap-4 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <Check className="h-4 w-4 text-emerald-400" />
            <span>Included</span>
          </div>
          <div className="flex items-center gap-1.5">
            <X className="h-4 w-4 text-slate-600" />
            <span>Not available</span>
          </div>
        </div>
      </div>

      {/* Billing Period Benefits */}
      <div className="mt-12 rounded-2xl border border-white/10 bg-gradient-to-b from-[#1E293B]/50 to-[#1E293B]/20 p-8">
        <h3 className="text-xl font-bold text-white mb-2 text-center">Why Choose Longer Billing Periods?</h3>
        <p className="text-center text-slate-400 mb-8 text-sm">Commit longer, save more. Simple as that.</p>

        {/* Savings Comparison */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8 max-w-2xl mx-auto">
          {BILLING_PERIODS.map((period) => {
            const discount = period.value > 1 ? getDiscountPercentage("PRO", period.value) : 0;
            const isSelected = effectivePeriod === period.value || (isAnnual && period.value === 12);

            return (
              <button
                key={period.value}
                onClick={() => {
                  if (period.value === 12) {
                    setIsAnnual(true);
                  } else {
                    setIsAnnual(false);
                    setBillingPeriod(period.value);
                  }
                }}
                className={`relative p-4 rounded-xl border transition-all ${
                  isSelected
                    ? "border-[#3B82F6] bg-[#3B82F6]/10 scale-105"
                    : "border-white/10 bg-white/5 hover:border-white/20"
                }`}
              >
                {period.value === 12 && (
                  <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                    BEST
                  </div>
                )}
                <div className={`text-2xl font-bold ${isSelected ? "text-[#3B82F6]" : "text-white"}`}>
                  {period.value}
                </div>
                <div className="text-xs text-slate-400">
                  {period.value === 1 ? "month" : "months"}
                </div>
                <div className={`mt-2 text-sm font-semibold ${discount > 0 ? "text-emerald-400" : "text-slate-500"}`}>
                  {discount > 0 ? `${discount}% OFF` : "No discount"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Benefits Grid */}
        <div className="grid md:grid-cols-3 gap-6">
          <div className="text-center p-4 rounded-xl bg-white/5">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-500/20 to-emerald-600/20 text-emerald-400 rounded-xl flex items-center justify-center mx-auto mb-4">
              <TrendingUp className="h-6 w-6" />
            </div>
            <h4 className="font-semibold text-white mb-2">Save Up to 27%</h4>
            <p className="text-sm text-slate-400">
              Annual plans offer the biggest discounts. That's up to <span className="text-emerald-400 font-semibold">${maxSavings.toLocaleString()}</span> back in your pocket.
            </p>
          </div>
          <div className="text-center p-4 rounded-xl bg-white/5">
            <div className="w-12 h-12 bg-gradient-to-br from-[#3B82F6]/20 to-[#6366F1]/20 text-[#3B82F6] rounded-xl flex items-center justify-center mx-auto mb-4">
              <Shield className="h-6 w-6" />
            </div>
            <h4 className="font-semibold text-white mb-2">Price Lock Guarantee</h4>
            <p className="text-sm text-slate-400">
              Lock in your rate for the full term. <span className="text-[#3B82F6] font-semibold">No surprise price increases</span>, ever.
            </p>
          </div>
          <div className="text-center p-4 rounded-xl bg-white/5">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500/20 to-purple-600/20 text-purple-400 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Sparkles className="h-6 w-6" />
            </div>
            <h4 className="font-semibold text-white mb-2">Bonus Credits</h4>
            <p className="text-sm text-slate-400">
              Annual subscribers get <span className="text-purple-400 font-semibold">10% bonus AI credits</span> each month. More power, same price.
            </p>
          </div>
        </div>

        {/* Quick CTA */}
        {!isAnnual && (
          <div className="mt-8 text-center">
            <button
              onClick={() => setIsAnnual(true)}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition-all shadow-lg shadow-emerald-500/25"
            >
              Switch to Annual & Save
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
