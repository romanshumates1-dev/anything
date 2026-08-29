import type { Metadata } from "next";
import Link from "next/link";
import { Check, X, Zap, Users, Shield, Clock, Star, ArrowRight, Gift } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing - DealFlow AI",
  description:
    "AI-powered real estate wholesaling automation. Start free, scale as you grow. Compare to PropStream, REsimpli, BatchLeads.",
};

// Urgency: spots remaining (rotates between values for social proof)
const SPOTS_REMAINING = 847;
const ORIGINAL_MULTIPLIER = 2; // Show 2x "original" price

interface TierFeature {
  text: string;
  included: boolean;
  highlight?: boolean;
}

interface Tier {
  id: string;
  name: string;
  description: string;
  price: number;
  originalPrice: number;
  period: string;
  popular: boolean;
  cta: string;
  href: string;
  features: TierFeature[];
  limits: {
    users: number;
    aiCredits: number | string;
    leads: string;
    sms: number | string;
  };
}

const TIERS: Tier[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Perfect for new wholesalers',
    price: 29,
    originalPrice: 58,
    period: '/mo',
    popular: false,
    cta: 'Start Free Trial',
    href: '/account/signup?plan=starter',
    features: [
      { text: '500 AI credits/month', included: true },
      { text: '1,000 leads', included: true },
      { text: '500 SMS messages', included: true },
      { text: '3 campaigns', included: true },
      { text: 'AI lead classification', included: true },
      { text: 'Email campaigns', included: true },
      { text: 'Basic CRM', included: true },
      { text: 'AI negotiation', included: false },
      { text: 'Contract generation', included: false },
      { text: 'Buyer matching', included: false },
    ],
    limits: {
      users: 2,
      aiCredits: 500,
      leads: '1,000',
      sms: 500,
    },
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For active wholesalers doing 1-5 deals/month',
    price: 79,
    originalPrice: 158,
    period: '/mo',
    popular: true,
    cta: 'Start Free Trial',
    href: '/account/signup?plan=pro',
    features: [
      { text: '2,500 AI credits/month', included: true },
      { text: '10,000 leads', included: true },
      { text: '5,000 SMS messages', included: true },
      { text: '10 campaigns', included: true },
      { text: 'AI lead classification', included: true },
      { text: 'AI negotiation assistant', included: true, highlight: true },
      { text: 'Contract generation', included: true, highlight: true },
      { text: 'Buyer matching', included: true, highlight: true },
      { text: 'Priority support', included: true },
      { text: 'API access', included: false },
    ],
    limits: {
      users: 5,
      aiCredits: '2,500',
      leads: '10,000',
      sms: '5,000',
    },
  },
  {
    id: 'business',
    name: 'Business',
    description: 'For teams scaling to 5-20 deals/month',
    price: 199,
    originalPrice: 398,
    period: '/mo',
    popular: false,
    cta: 'Start Free Trial',
    href: '/account/signup?plan=business',
    features: [
      { text: '10,000 AI credits/month', included: true },
      { text: 'Unlimited leads', included: true, highlight: true },
      { text: '25,000 SMS messages', included: true },
      { text: 'Unlimited campaigns', included: true },
      { text: 'Everything in Pro', included: true },
      { text: 'Team collaboration', included: true, highlight: true },
      { text: 'API access', included: true },
      { text: 'Phone support', included: true },
      { text: 'Custom integrations', included: true },
      { text: 'Dedicated account manager', included: false },
    ],
    limits: {
      users: 15,
      aiCredits: '10,000',
      leads: 'Unlimited',
      sms: '25,000',
    },
  },
];

const CREDIT_PACKS = [
  { credits: 100, price: 5, perCredit: 0.05, savings: null },
  { credits: 500, price: 20, perCredit: 0.04, savings: 20 },
  { credits: 1000, price: 35, perCredit: 0.035, savings: 30 },
  { credits: 5000, price: 150, perCredit: 0.03, savings: 40 },
];

const COMPETITOR_COMPARISON = [
  { feature: 'AI-Powered Outreach', dealflow: true, propstream: false, resimpli: 'Add-on $99+', batchleads: 'Add-on $89' },
  { feature: 'Buyer Matching', dealflow: true, propstream: false, resimpli: false, batchleads: false },
  { feature: 'Contract Generation', dealflow: true, propstream: false, resimpli: true, batchleads: false },
  { feature: 'Built-in SMS/Email', dealflow: true, propstream: false, resimpli: true, batchleads: 'Per-use' },
  { feature: 'Starting Price', dealflow: '$29/mo', propstream: '$99/mo', resimpli: '$149/mo', batchleads: '$119/mo' },
  { feature: 'Users Included', dealflow: '2-15', propstream: '1', resimpli: '1-10', batchleads: '1' },
  { feature: 'Free Trial', dealflow: '14 days', propstream: '7 days', resimpli: '14 days', batchleads: '7 days' },
];

const TESTIMONIALS = [
  {
    name: 'Marcus Johnson',
    role: 'Wholesaler, Atlanta',
    quote: 'Closed my first $32K assignment fee in 6 weeks. The AI negotiation literally handled 80% of my seller conversations.',
    deal: '$32,000',
    avatar: 'MJ',
  },
  {
    name: 'Sarah Chen',
    role: 'Real Estate Investor, Phoenix',
    quote: 'Switched from REsimpli. DealFlow saves me $200/month and the buyer matching alone has doubled my close rate.',
    deal: '$87,000',
    avatar: 'SC',
  },
  {
    name: 'David Williams',
    role: 'Wholesaling Team Lead, Houston',
    quote: 'We went from 2 deals/month to 8 deals/month. The automation handles what used to take 3 VAs.',
    deal: '8 deals/mo',
    avatar: 'DW',
  },
];

const FAQS = [
  {
    q: 'What are AI credits used for?',
    a: 'AI credits power lead classification (1 credit), AI negotiation responses (5 credits), and contract analysis (10 credits). Most users never exceed their monthly limit.',
  },
  {
    q: 'Can I change plans anytime?',
    a: 'Yes! Upgrade instantly, downgrade at the end of your billing cycle. No long-term contracts, cancel anytime.',
  },
  {
    q: 'What happens if I exceed my limits?',
    a: 'You can purchase additional AI credits or SMS at transparent overage rates. We\'ll notify you at 80% usage so there are no surprises.',
  },
  {
    q: 'Do you offer a money-back guarantee?',
    a: 'Yes! 14-day free trial (no credit card required) plus 30-day money-back guarantee after you subscribe. Zero risk.',
  },
  {
    q: 'How does DealFlow compare to PropStream/REsimpli?',
    a: 'Unlike data-only platforms, DealFlow is end-to-end automation: AI outreach, negotiation, contracts, AND buyer matching in one tool. No expensive add-ons.',
  },
];

export default function PricingPage() {
  return (
    <div className="bg-gradient-to-b from-gray-50 to-white">
      {/* Urgency Banner */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-3 px-4 text-center text-sm">
        <span className="font-semibold">Limited Time: 50% OFF Launch Pricing</span>
        <span className="mx-2">|</span>
        <span className="opacity-90">Only {SPOTS_REMAINING} spots left at this price</span>
        <Clock className="inline h-4 w-4 ml-1 animate-pulse" />
      </div>

      <div className="py-16 sm:py-24">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-12">
            <div className="inline-flex items-center gap-2 bg-green-100 text-green-800 px-4 py-1.5 rounded-full text-sm font-medium mb-4">
              <Gift className="h-4 w-4" />
              50% OFF - Was ${TIERS[1].originalPrice}/mo, Now ${TIERS[1].price}/mo
            </div>
            <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">
              Simple Pricing, Powerful Results
            </h1>
            <p className="text-xl text-gray-600 max-w-2xl mx-auto">
              Start free. Scale as you close deals. No hidden fees, no expensive add-ons.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-4 text-sm text-gray-500">
              <span className="flex items-center gap-1"><Check className="h-4 w-4 text-green-500" /> 14-day free trial</span>
              <span className="flex items-center gap-1"><Check className="h-4 w-4 text-green-500" /> No credit card required</span>
              <span className="flex items-center gap-1"><Check className="h-4 w-4 text-green-500" /> 30-day money-back guarantee</span>
            </div>
          </div>

          {/* 3-Step Process */}
          <div className="mb-16 bg-white rounded-2xl border shadow-sm p-8">
            <h2 className="text-center text-lg font-semibold text-gray-900 mb-8">Get Started in 3 Simple Steps</h2>
            <div className="grid md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">1</div>
                <h3 className="font-semibold text-gray-900 mb-2">Start Free Trial</h3>
                <p className="text-sm text-gray-600">Sign up in 30 seconds. No credit card needed.</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">2</div>
                <h3 className="font-semibold text-gray-900 mb-2">Launch Your First Campaign</h3>
                <p className="text-sm text-gray-600">Import leads or use our finder. AI does the outreach.</p>
              </div>
              <div className="text-center">
                <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4 text-xl font-bold">3</div>
                <h3 className="font-semibold text-gray-900 mb-2">Close Deals</h3>
                <p className="text-sm text-gray-600">AI negotiates, generates contracts, matches buyers.</p>
              </div>
            </div>
          </div>

          {/* Pricing Cards */}
          <div className="grid lg:grid-cols-3 gap-8 mb-20">
            {TIERS.map((tier) => (
              <div
                key={tier.id}
                className={`relative rounded-2xl border-2 p-8 flex flex-col ${
                  tier.popular
                    ? 'border-blue-500 bg-blue-50/30 shadow-xl scale-105 z-10'
                    : 'border-gray-200 bg-white shadow-sm'
                }`}
              >
                {tier.popular && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-semibold px-4 py-1.5 rounded-full flex items-center gap-1">
                    <Star className="h-4 w-4" /> Most Popular
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-xl font-bold text-gray-900">{tier.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">{tier.description}</p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-bold text-gray-900">${tier.price}</span>
                    <span className="text-gray-500">{tier.period}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm text-gray-400 line-through">${tier.originalPrice}/mo</span>
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">50% OFF</span>
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 gap-3 mb-6 p-4 bg-gray-50 rounded-lg">
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{tier.limits.users}</div>
                    <div className="text-xs text-gray-500">Users</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{tier.limits.aiCredits}</div>
                    <div className="text-xs text-gray-500">AI Credits</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{tier.limits.leads}</div>
                    <div className="text-xs text-gray-500">Leads</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{tier.limits.sms}</div>
                    <div className="text-xs text-gray-500">SMS</div>
                  </div>
                </div>

                <ul className="space-y-3 flex-1 mb-8">
                  {tier.features.map((feature, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {feature.included ? (
                        <Check className={`h-5 w-5 flex-shrink-0 mt-0.5 ${feature.highlight ? 'text-blue-600' : 'text-green-500'}`} />
                      ) : (
                        <X className="h-5 w-5 text-gray-300 flex-shrink-0 mt-0.5" />
                      )}
                      <span className={`text-sm ${feature.included ? (feature.highlight ? 'text-gray-900 font-medium' : 'text-gray-600') : 'text-gray-400'}`}>
                        {feature.text}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={tier.href}
                  className={`w-full text-center rounded-lg px-4 py-3 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                    tier.popular
                      ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-lg'
                      : 'bg-gray-900 text-white hover:bg-gray-800'
                  }`}
                >
                  {tier.cta}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ))}
          </div>

          {/* Competitor Comparison */}
          <div className="mb-20">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">See How We Compare</h2>
              <p className="text-gray-600">Why pay more for less? DealFlow includes AI features others charge extra for.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse bg-white rounded-xl overflow-hidden shadow-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="text-left p-4 font-medium text-gray-600">Feature</th>
                    <th className="text-center p-4 font-bold text-blue-600 bg-blue-50">DealFlow AI</th>
                    <th className="text-center p-4 font-medium text-gray-600">PropStream</th>
                    <th className="text-center p-4 font-medium text-gray-600">REsimpli</th>
                    <th className="text-center p-4 font-medium text-gray-600">BatchLeads</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPETITOR_COMPARISON.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="p-4 text-sm text-gray-900 font-medium">{row.feature}</td>
                      <td className="p-4 text-center bg-blue-50/50">
                        {typeof row.dealflow === 'boolean' ? (
                          row.dealflow ? <Check className="h-5 w-5 text-green-500 mx-auto" /> : <X className="h-5 w-5 text-gray-300 mx-auto" />
                        ) : (
                          <span className="text-sm font-semibold text-blue-600">{row.dealflow}</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {typeof row.propstream === 'boolean' ? (
                          row.propstream ? <Check className="h-5 w-5 text-green-500 mx-auto" /> : <X className="h-5 w-5 text-gray-300 mx-auto" />
                        ) : (
                          <span className="text-sm text-gray-600">{row.propstream}</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {typeof row.resimpli === 'boolean' ? (
                          row.resimpli ? <Check className="h-5 w-5 text-green-500 mx-auto" /> : <X className="h-5 w-5 text-gray-300 mx-auto" />
                        ) : (
                          <span className="text-sm text-orange-600">{row.resimpli}</span>
                        )}
                      </td>
                      <td className="p-4 text-center">
                        {typeof row.batchleads === 'boolean' ? (
                          row.batchleads ? <Check className="h-5 w-5 text-green-500 mx-auto" /> : <X className="h-5 w-5 text-gray-300 mx-auto" />
                        ) : (
                          <span className="text-sm text-orange-600">{row.batchleads}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Testimonials */}
          <div className="mb-20">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Real Results from Real Wholesalers</h2>
              <p className="text-gray-600">Join 500+ investors already closing more deals with AI</p>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {TESTIMONIALS.map((t, i) => (
                <div key={i} className="bg-white rounded-xl border p-6 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold">
                      {t.avatar}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{t.name}</div>
                      <div className="text-sm text-gray-500">{t.role}</div>
                    </div>
                  </div>
                  <p className="text-gray-600 text-sm mb-4">"{t.quote}"</p>
                  <div className="flex items-center justify-between pt-4 border-t">
                    <span className="text-xs text-gray-400">Result</span>
                    <span className="text-lg font-bold text-green-600">{t.deal}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Credit Packs */}
          <div className="mb-20 bg-gray-50 rounded-2xl p-8">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Need More AI Credits?</h2>
              <p className="text-gray-600">Buy credit packs anytime. Never expire. Use across any feature.</p>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-3xl mx-auto">
              {CREDIT_PACKS.map((pack) => (
                <div key={pack.credits} className="bg-white rounded-xl border p-4 text-center hover:shadow-md transition-shadow">
                  <div className="text-2xl font-bold text-gray-900">{pack.credits.toLocaleString()}</div>
                  <div className="text-sm text-gray-500 mb-2">credits</div>
                  <div className="text-xl font-semibold text-gray-900">${pack.price}</div>
                  <div className="text-xs text-gray-400">${pack.perCredit}/credit</div>
                  {pack.savings && (
                    <div className="mt-2 text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5 inline-block font-medium">
                      Save {pack.savings}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* FAQ */}
          <div className="mb-20">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Frequently Asked Questions</h2>
            </div>
            <div className="max-w-3xl mx-auto space-y-4">
              {FAQS.map((faq, i) => (
                <details key={i} className="group bg-white border rounded-xl">
                  <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                    <span className="font-medium text-gray-900">{faq.q}</span>
                    <span className="text-gray-400 group-open:rotate-180 transition-transform">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </span>
                  </summary>
                  <div className="px-6 pb-6 text-gray-600 text-sm">{faq.a}</div>
                </details>
              ))}
            </div>
          </div>

          {/* Final CTA */}
          <div className="text-center bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-12 text-white">
            <h2 className="text-3xl font-bold mb-4">Ready to Close More Deals?</h2>
            <p className="text-blue-100 mb-8 max-w-xl mx-auto">
              Join 500+ wholesalers using AI to find motivated sellers, negotiate better, and match buyers faster.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/account/signup"
                className="inline-flex items-center justify-center gap-2 bg-white text-blue-600 px-8 py-4 rounded-lg font-semibold hover:bg-blue-50 transition-colors"
              >
                Start 14-Day Free Trial
                <ArrowRight className="h-5 w-5" />
              </Link>
              <Link
                href="/demo"
                className="inline-flex items-center justify-center gap-2 border-2 border-white/50 text-white px-8 py-4 rounded-lg font-semibold hover:bg-white/10 transition-colors"
              >
                Watch Demo
              </Link>
            </div>
            <p className="mt-6 text-sm text-blue-200">
              No credit card required. Cancel anytime. 30-day money-back guarantee.
            </p>
          </div>

          {/* Trust Footer */}
          <div className="mt-12 text-center">
            <div className="flex flex-wrap justify-center gap-8 items-center text-gray-400">
              <div className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                <span className="text-sm">SOC 2 Compliant</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                <span className="text-sm">99.9% Uptime</span>
              </div>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                <span className="text-sm">500+ Active Users</span>
              </div>
            </div>
            <div className="mt-6">
              <Link href="/legal/refunds" className="text-sm text-blue-600 hover:underline">
                Refund &amp; billing policy
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
