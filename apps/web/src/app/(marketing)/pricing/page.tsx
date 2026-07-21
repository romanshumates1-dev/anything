import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import sql from "@/app/api/utils/sql";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple pricing for DealFlow AI. Starter $99/mo, Professional $249/mo, Enterprise custom. 30-day free trial.",
};

// Marketing copy per tier — feature bullets aren't in subscription_plans.limits
// (that jsonb holds machine limits like automation_limit, not sales copy), so
// this stays hand-authored. PRICE is the single source of truth issue (bug
// audit Phase 1) — it now comes from the DB, matching what billing charges.
// 10DLC/SOC 2 claims removed (bug #31 — not certifications we hold).
const TIER_COPY: Record<string, { cta: string; href: string; features: string[] }> = {
  starter: {
    cta: "Start Free Trial",
    href: "/contact",
    features: ["1,000 leads/month", "1 campaign", "AI negotiation", "Basic compliance", "Email support"],
  },
  professional: {
    cta: "Start Free Trial",
    href: "/contact",
    features: ["10,000 leads/month", "Unlimited campaigns", "Advanced approval workflows", "Priority support"],
  },
  enterprise: {
    cta: "Contact Sales",
    href: "/contact",
    features: ["Unlimited leads", "Custom integrations", "Dedicated infrastructure", "SLA + 24/7 support"],
  },
};
const TIER_ORDER = ["starter", "professional", "enterprise"];

// Static fallback used only if the DB is unreachable at build/request time —
// values must stay identical to migration 035's seed so there is never a
// second number in play.
const FALLBACK_PRICE_CENTS: Record<string, number> = {
  starter: 9900,
  professional: 24900,
  enterprise: 0,
};

async function getPlans() {
  try {
    const rows = await sql`SELECT tier, name, price_cents FROM subscription_plans`;
    const byTier = new Map(rows.map((r: any) => [r.tier, r]));
    return TIER_ORDER.map((tier) => ({
      tier,
      name: byTier.get(tier)?.name ?? tier[0].toUpperCase() + tier.slice(1),
      priceCents: byTier.get(tier)?.price_cents ?? FALLBACK_PRICE_CENTS[tier],
    }));
  } catch {
    return TIER_ORDER.map((tier) => ({
      tier,
      name: tier[0].toUpperCase() + tier.slice(1),
      priceCents: FALLBACK_PRICE_CENTS[tier],
    }));
  }
}

export default async function PricingPage() {
  const plans = await getPlans();

  return (
    <div className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900">Simple, transparent pricing</h1>
          <p className="mt-4 text-lg text-gray-600">Month-to-month. 30-day free trial. No credit card required.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {plans.map((plan) => {
            const copy = TIER_COPY[plan.tier];
            const dollars = plan.priceCents > 0 ? Math.round(plan.priceCents / 100) : null;
            return (
              <div key={plan.tier} className="rounded-2xl border bg-white p-8 shadow-sm flex flex-col">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                  <div className="mt-4 flex items-baseline gap-1">
                    {dollars ? (
                      <>
                        <span className="text-4xl font-bold text-gray-900">${dollars}</span>
                        <span className="text-gray-500">/mo</span>
                      </>
                    ) : (
                      <span className="text-4xl font-bold text-gray-900">Let&rsquo;s talk</span>
                    )}
                  </div>
                </div>
                <ul className="mt-6 space-y-3 flex-1">
                  {copy.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                      <Check className="h-4 w-4 text-green-600 mt-0.5" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={copy.href}
                  className="mt-8 block w-full text-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors"
                >
                  {copy.cta}
                </Link>
              </div>
            );
          })}
        </div>
        <div className="mt-12 text-center">
          <Link href="/legal/refunds" className="text-sm text-blue-700 hover:underline">
            Refund &amp; billing policy
          </Link>
        </div>
      </div>
    </div>
  );
}
