import type { Metadata } from "next";
import Link from "next/link";
import { Check, X, Users, Star, ArrowRight, Gift } from "lucide-react";
import {
  GuaranteeBadgeRow,
  SecurityBadges,
  TimeSavedCalculator,
  RecentlyJoinedAvatars,
  ScarcityBadge,
  ScarcityBar,
  LimitedTimeOffer,
  LiveSocialProof,
} from "@/components/marketing";
import sql from "@/app/api/utils/sql";
import PricingTierSelector from "./PricingTierSelector";

export const metadata: Metadata = {
  title: "Pricing - DealFlow AI",
  description:
    "AI-powered real estate deal-finding automation. Start free, scale as you grow. Compare to PropStream, REsimpli, BatchLeads.",
};

interface TierFeature {
  text: string;
  included: boolean;
  highlight?: boolean;
}

interface Tier {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  originalPrice?: number;
  period?: string;
  popular: boolean;
  cta: string;
  href: string;
  features: TierFeature[] | string[];
  limits: {
    users?: number;
    aiCredits?: number | string;
    leads?: string;
    sms: number | string;
    email: number;
    ai: number;
  };
  overage?: {
    sms: number;
    email: number;
    ai: number;
  };
}

// Tier descriptions and UI metadata (not pricing - that comes from DB)
const TIER_METADATA: Record<string, { description: string; popular: boolean; cta: string; featureLabels: string[] }> = {
  free: {
    description: 'Try before you buy',
    popular: false,
    cta: 'Start Free',
    featureLabels: ['Basic CRM', 'Lead tracking'],
  },
  starter: {
    description: 'For new investors',
    popular: false,
    cta: 'Get Started',
    featureLabels: ['Basic analytics', 'Email support'],
  },
  pro: {
    description: 'For active investors',
    popular: true,
    cta: 'Go Pro',
    featureLabels: ['AI handles negotiations', 'Priority support', 'Find buyers for your deals'],
  },
  business: {
    description: 'For growing teams',
    popular: false,
    cta: 'Scale Up',
    featureLabels: ['Team features', 'API access', 'Dedicated success manager'],
  },
  scale: {
    description: 'For high-volume operations',
    popular: false,
    cta: 'Contact Sales',
    featureLabels: ['White-label options', 'Custom integrations', 'SLA guarantee'],
  },
};

/**
 * Fetch pricing tiers from database (single source of truth)
 * Prices come from subscription_plans table (see migration 067)
 */
async function getTiersFromDB(): Promise<Tier[]> {
  try {
    const rows = await sql`
      SELECT id, name, tier, price_cents, limits
      FROM subscription_plans
      WHERE tier IN ('free', 'starter', 'pro', 'business', 'scale')
      ORDER BY price_cents ASC
    `;

    return (rows as any[]).map((row) => {
      const limits = row.limits;
      const meta = TIER_METADATA[row.tier] || { description: '', popular: false, cta: 'Get Started', featureLabels: [] };

      // Build feature list from limits
      const features: string[] = [];
      if (limits.monthly_sms_allowance > 0) features.push(`${limits.monthly_sms_allowance.toLocaleString()} SMS/month`);
      if (limits.monthly_email_allowance > 0) features.push(`${limits.monthly_email_allowance.toLocaleString()} emails/month`);
      if (limits.monthly_ai_credits > 0) features.push(`${limits.monthly_ai_credits.toLocaleString()} AI credits`);
      features.push(...meta.featureLabels);

      // Calculate overage rates (convert from cents)
      const overage = limits.overage_sms_cents !== null ? {
        sms: limits.overage_sms_cents / 100,
        email: limits.overage_email_cents / 100,
        ai: limits.overage_ai_credit_cents / 100,
      } : undefined;

      return {
        id: row.tier,
        name: row.name,
        slug: row.tier,
        description: meta.description,
        price: row.price_cents / 100,
        originalPrice: row.price_cents > 0 ? (row.price_cents / 100) * 2 : undefined, // Early adopter 50% off
        period: '/mo',
        popular: meta.popular,
        cta: meta.cta,
        href: `/account/signup?plan=${row.tier}`,
        features,
        limits: {
          sms: limits.monthly_sms_allowance || 0,
          email: limits.monthly_email_allowance || 0,
          ai: limits.monthly_ai_credits || 0,
        },
        overage,
      };
    });
  } catch (error) {
    console.error('[PRICING] Failed to fetch tiers from DB:', error);
    // Return empty array - will show error state
    return [];
  }
}


const CREDIT_PACKS = [
  { credits: 500, price: 29, perCredit: 0.058, savings: null },
  { credits: 2500, price: 99, perCredit: 0.0396, savings: 32 },
  { credits: 10000, price: 299, perCredit: 0.0299, savings: 48 },
  { credits: 50000, price: 1199, perCredit: 0.024, savings: 59 },
];

// Build competitor comparison dynamically based on starter price
function buildCompetitorComparison(starterPrice: number) {
  return [
    { feature: 'AI Sends Messages For You', dealflow: true, propstream: false, resimpli: 'Add-on $99+', batchleads: 'Add-on $89' },
    { feature: 'AI Handles Price Negotiations', dealflow: true, propstream: false, resimpli: false, batchleads: false },
    { feature: 'Finds Buyers for Your Deals', dealflow: true, propstream: false, resimpli: false, batchleads: false },
    { feature: 'Generates Contracts Automatically', dealflow: true, propstream: false, resimpli: true, batchleads: false },
    { feature: 'Built-in SMS/Email', dealflow: true, propstream: false, resimpli: true, batchleads: 'Per-use' },
    { feature: 'Starting Price', dealflow: `Free / $${starterPrice}`, propstream: '$99/mo', resimpli: '$149/mo', batchleads: '$119/mo' },
    { feature: 'Users Included', dealflow: '2-50', propstream: '1', resimpli: '1-10', batchleads: '1' },
    { feature: 'Free Trial', dealflow: '14 days', propstream: '7 days', resimpli: '14 days', batchleads: '7 days' },
  ];
}

// COMPETITOR_COMPARISON is generated dynamically from starter tier price
// Feature comparison is handled by PricingTierSelector component using pricingTiers.ts

const TESTIMONIALS = [
  {
    name: 'Marcus Johnson',
    role: 'Real Estate Investor, Atlanta',
    quote: 'Made $32K profit on my first deal in 6 weeks. The AI handled 80% of my conversations with property owners.',
    deal: '$32,000',
    avatar: 'MJ',
  },
  {
    name: 'Sarah Chen',
    role: 'Real Estate Investor, Phoenix',
    quote: 'Switched from REsimpli. DealFlow saves me $200/month and finding buyers for my deals has doubled my close rate.',
    deal: '$87,000',
    avatar: 'SC',
  },
  {
    name: 'David Williams',
    role: 'Team Lead, Houston',
    quote: 'We went from 2 deals/month to 8 deals/month. The automation handles what used to take 3 virtual assistants.',
    deal: '8 deals/mo',
    avatar: 'DW',
  },
];

const FAQS = [
  {
    q: 'How does billing work?',
    a: 'We bill monthly on the anniversary of your signup date. All plans are billed in advance and include your monthly allocation of SMS, emails, and AI credits. You can upgrade anytime and we\'ll prorate the difference.',
  },
  {
    q: 'What is your refund policy?',
    a: 'We offer a 7-day refund window from your subscription date. If you\'re not satisfied within the first 7 days, contact support for a full refund - no questions asked. After 7 days, you can cancel anytime but refunds are not available for the current billing period.',
  },
  {
    q: 'What are AI credits and how do they work?',
    a: 'AI credits power automatic property analysis (1 credit), AI negotiation responses (5 credits), and contract review (10 credits). Credits reset monthly with your plan. Unused credits do not roll over, but purchased credit packs never expire.',
  },
  {
    q: 'What happens if I run out of credits?',
    a: 'You can purchase additional AI credits or SMS at transparent overage rates. We\'ll notify you at 80% usage so there are no surprises. Credit packs are available for one-time purchase and never expire.',
  },
  {
    q: 'Can I change or cancel my plan anytime?',
    a: 'Yes! Upgrade instantly and we\'ll prorate the cost. Downgrade at the end of your billing cycle. No long-term contracts - cancel anytime with no cancellation fees.',
  },
  {
    q: 'How does DealFlow compare to PropStream/REsimpli?',
    a: 'Unlike data-only platforms, DealFlow handles everything from start to finish: AI outreach, price negotiation, contracts, AND connecting you with buyers. No expensive add-ons required.',
  },
];

export default async function PricingPage() {
  // Fetch tiers from database (single source of truth)
  const TIERS = await getTiersFromDB();

  // Build dynamic comparisons from DB data
  const starterTier = TIERS.find(t => t.id === 'starter');
  const COMPETITOR_COMPARISON = buildCompetitorComparison(starterTier?.price || 129);

  // Promo end date - configurable
  const promoEndDate = new Date('2026-10-15T23:59:59Z');

  return (
    <div className="bg-[#0F172A]">
      {/* Signup Notification Popup */}
      <LiveSocialProof variant="popup" fetchFromApi />

      {/* Ethical Urgency Banner - Real beta pricing */}
      <div className="bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] text-white py-3 px-4 text-center text-sm">
        <span className="font-semibold">Early Adopter Pricing: 50% OFF</span>
        <span className="mx-3 opacity-50">|</span>
        <span className="opacity-90">Lock in this rate before general launch</span>
        <span className="ml-2 inline-flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full text-xs">
          <Users className="h-3 w-3" /> 800+ active users
        </span>
      </div>

      <div className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Limited Time Offer at Top */}
          <div className="max-w-lg mx-auto mb-12">
            <LimitedTimeOffer
              endDate={promoEndDate}
              discount={50}
              headline="50% off first month with code LAUNCH"
              description="Lock in early adopter pricing - limited spots available"
              ctaText="Claim Offer"
              ctaHref="/account/signup?promo=LAUNCH"
              promoCode="LAUNCH"
              fetchFromApi
            />
          </div>

          {/* Hero */}
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 bg-emerald-500/10 text-emerald-400 px-4 py-1.5 rounded-full text-sm font-medium mb-6">
              <Gift className="h-4 w-4" />
              50% OFF - Was ${starterTier?.originalPrice || 258}/mo, Now ${starterTier?.price || 129}/mo
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
              Simple, Transparent Pricing
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Everything you need to automate your wholesaling business. No hidden fees, no surprises.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-slate-400">
              <span className="flex items-center gap-2">
                <Check className="h-5 w-5 text-emerald-400" />
                14-day free trial
              </span>
              <span className="flex items-center gap-2">
                <Check className="h-5 w-5 text-emerald-400" />
                No credit card required
              </span>
              <span className="flex items-center gap-2">
                <Check className="h-5 w-5 text-emerald-400" />
                30-day money-back guarantee
              </span>
            </div>

            {/* Scarcity Badge */}
            <div className="mt-6 flex justify-center">
              <ScarcityBadge
                spotsRemaining={200}
                fetchFromApi
                size="lg"
                animated
              />
            </div>
          </div>

          {/* Scarcity Bar - Shows spots remaining */}
          <div className="max-w-md mx-auto mb-12">
            <ScarcityBar
              spotsRemaining={200}
              totalSpots={1000}
              fetchFromApi
            />
          </div>

          {/* 3-Step Process */}
          <div className="mb-20 rounded-2xl border border-white/10 bg-[#1E293B]/30 p-8">
            <h2 className="text-center text-lg font-semibold text-white mb-8">Get Started in 3 Simple Steps</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-12 h-12 bg-[#3B82F6]/10 text-[#3B82F6] rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">1</div>
                <h3 className="font-semibold text-white mb-2">Start Free Trial</h3>
                <p className="text-sm text-slate-400">Sign up in 30 seconds. No credit card needed.</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-[#8B5CF6]/10 text-[#8B5CF6] rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">2</div>
                <h3 className="font-semibold text-white mb-2">Launch Your First Campaign</h3>
                <p className="text-sm text-slate-400">Import leads or use our finder. AI does the outreach.</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-emerald-500/10 text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">3</div>
                <h3 className="font-semibold text-white mb-2">Close Deals</h3>
                <p className="text-sm text-slate-400">AI negotiates prices, generates contracts, finds buyers.</p>
              </div>
            </div>
          </div>

          {/* Interactive Pricing Tier Selector with Billing Period Toggle */}
          <div className="mb-24">
            <PricingTierSelector />
          </div>

          {/* Competitor Comparison */}
          <div className="mb-24">
            <div className="text-center mb-12">
              <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Comparison</span>
              <h2 className="mt-4 text-3xl font-bold text-white mb-4">See How We Compare</h2>
              <p className="text-slate-400">Why pay more for less? DealFlow includes AI features others charge extra for.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse rounded-xl overflow-hidden">
                <thead>
                  <tr className="bg-[#1E293B]">
                    <th className="text-left p-4 font-medium text-slate-400">Feature</th>
                    <th className="text-center p-4 font-bold text-[#3B82F6] bg-[#3B82F6]/10">DealFlow AI</th>
                    <th className="text-center p-4 font-medium text-slate-400">PropStream</th>
                    <th className="text-center p-4 font-medium text-slate-400">REsimpli</th>
                    <th className="text-center p-4 font-medium text-slate-400">BatchLeads</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPETITOR_COMPARISON.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-[#1E293B]/30' : 'bg-[#1E293B]/50'}>
                      <td className="p-4 text-sm text-white font-medium">{row.feature}</td>
                      <td className="p-4 text-center bg-[#3B82F6]/5">
                        {typeof row.dealflow === 'boolean' ? (
                          row.dealflow ? <Check className="h-5 w-5 text-emerald-400 mx-auto" /> : <X className="h-5 w-5 text-slate-600 mx-auto" />
                        ) : (
                          <span className="text-sm font-semibold text-[#3B82F6]">{row.dealflow}</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {typeof row.propstream === 'boolean' ? (
                          row.propstream ? <Check className="h-5 w-5 text-emerald-400 mx-auto" /> : <X className="h-5 w-5 text-slate-600 mx-auto" />
                        ) : (
                          <span className="text-sm text-slate-400">{row.propstream}</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {typeof row.resimpli === 'boolean' ? (
                          row.resimpli ? <Check className="h-5 w-5 text-emerald-400 mx-auto" /> : <X className="h-5 w-5 text-slate-600 mx-auto" />
                        ) : (
                          <span className="text-sm text-amber-400">{row.resimpli}</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {typeof row.batchleads === 'boolean' ? (
                          row.batchleads ? <Check className="h-5 w-5 text-emerald-400 mx-auto" /> : <X className="h-5 w-5 text-slate-600 mx-auto" />
                        ) : (
                          <span className="text-sm text-amber-400">{row.batchleads}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Rotating Social Proof */}
          <div className="mb-12">
            <LiveSocialProof variant="rotating" autoRotate rotationInterval={5000} />
          </div>

          {/* Testimonials */}
          <div className="mb-24">
            <div className="text-center mb-12">
              <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Testimonials</span>
              <h2 className="mt-4 text-3xl font-bold text-white mb-4">Real Results from Real Investors</h2>
              <p className="text-slate-400">Join 500+ investors already closing more deals with AI</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {TESTIMONIALS.map((t, i) => (
                <div key={i} className="rounded-2xl border border-white/10 bg-[#1E293B]/30 p-6">
                  <div className="flex gap-1 mb-4">
                    {[...Array(5)].map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>
                  <p className="text-slate-300 mb-6 leading-relaxed">"{t.quote}"</p>
                  <div className="flex items-center justify-between pt-4 border-t border-white/10">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6] flex items-center justify-center text-white font-semibold text-sm">
                        {t.avatar}
                      </div>
                      <div>
                        <div className="font-medium text-white text-sm">{t.name}</div>
                        <div className="text-xs text-slate-500">{t.role}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-lg font-bold text-emerald-400">{t.deal}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Credit Packs */}
          <div className="mb-24 rounded-2xl border border-white/10 bg-[#1E293B]/30 p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Need More AI Credits?</h2>
              <p className="text-slate-400">Buy credit packs anytime. Never expire. Use across any feature.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
              {CREDIT_PACKS.map((pack) => (
                <div key={pack.credits} className="rounded-xl border border-white/10 bg-white/5 p-4 text-center hover:bg-white/10 transition-colors">
                  <div className="text-2xl font-bold text-white">{pack.credits.toLocaleString()}</div>
                  <div className="text-sm text-slate-500 mb-2">credits</div>
                  <div className="text-xl font-semibold text-white">${pack.price}</div>
                  <div className="text-xs text-slate-500">${pack.perCredit}/credit</div>
                  {pack.savings && (
                    <div className="mt-2 text-xs bg-emerald-500/10 text-emerald-400 rounded-full px-2 py-0.5 inline-block font-medium">
                      Save {pack.savings}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>


          {/* Time Saved Calculator */}
          <div className="mb-24 max-w-md mx-auto">
            <TimeSavedCalculator />
          </div>

          {/* FAQ */}
          <div className="mb-24">
            <div className="text-center mb-12">
              <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">FAQ</span>
              <h2 className="mt-4 text-3xl font-bold text-white mb-4">Frequently Asked Questions</h2>
            </div>
            <div className="max-w-3xl mx-auto space-y-4">
              {FAQS.map((faq, i) => (
                <details key={i} className="group rounded-xl border border-white/10 bg-[#1E293B]/30">
                  <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                    <span className="font-medium text-white pr-4">{faq.q}</span>
                    <span className="text-slate-400 group-open:rotate-180 transition-transform">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </summary>
                  <div className="px-6 pb-6 text-slate-400 leading-relaxed">{faq.a}</div>
                </details>
              ))}
            </div>
          </div>

          {/* Final CTA */}
          <div className="relative overflow-hidden rounded-3xl">
            <div className="absolute inset-0 bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6]" />
            <div className="relative px-8 py-16 sm:px-16 text-center">
              <h2 className="text-3xl font-bold text-white mb-4">Ready to Automate Your Wholesaling?</h2>
              <p className="text-white/80 mb-8 max-w-xl mx-auto">
                Join 500+ investors using AI to find homeowners ready to sell, negotiate better prices, and connect with buyers faster.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/account/signup"
                  className="inline-flex items-center justify-center gap-2 bg-white text-[#3B82F6] px-8 py-4 rounded-lg font-semibold hover:bg-white/90 transition-colors shadow-xl"
                >
                  Start Free Trial
                  <ArrowRight className="h-5 w-5" />
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center justify-center gap-2 border-2 border-white/30 text-white px-8 py-4 rounded-lg font-semibold hover:bg-white/10 transition-colors"
                >
                  Talk to Sales
                </Link>
              </div>
              {/* Guarantee Badges */}
              <div className="mt-8">
                <GuaranteeBadgeRow
                  guarantees={['free-trial', 'no-credit-card', 'cancel-anytime', 'money-back']}
                  variant="compact"
                />
              </div>
            </div>
          </div>

          {/* Social Proof */}
          <div className="mt-12 flex justify-center">
            <RecentlyJoinedAvatars />
          </div>

          {/* Trust Footer */}
          <div className="mt-12">
            <SecurityBadges />
            <div className="mt-6 text-center">
              <Link href="/legal/refunds" className="text-sm text-[#3B82F6] hover:underline">
                Refund &amp; billing policy
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
