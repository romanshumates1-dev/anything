import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple pricing for DealFlow AI. Starter $99/mo, Professional $249/mo, Enterprise custom. 30-day free trial.",
};

const tiers = [
  {
    name: "Starter",
    price: 99,
    cta: "Start Free Trial",
    href: "/contact",
    features: ["1,000 leads/month", "1 campaign", "AI negotiation", "Basic compliance", "Email support"],
  },
  {
    name: "Professional",
    price: 249,
    cta: "Start Free Trial",
    href: "/contact",
    features: ["10,000 leads/month", "Unlimited campaigns", "Advanced approval workflows", "10DLC compliance", "Priority support"],
  },
  {
    name: "Enterprise",
    price: null,
    cta: "Contact Sales",
    href: "/contact",
    features: ["Unlimited leads", "Custom integrations", "Dedicated infrastructure", "SOC 2 reports", "SLA + 24/7 support"],
  },
];

export default function PricingPage() {
  return (
    <div className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900">Simple, transparent pricing</h1>
          <p className="mt-4 text-lg text-gray-600">Month-to-month. 30-day free trial. No credit card required.</p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          {tiers.map((tier) => (
            <div key={tier.name} className="rounded-2xl border bg-white p-8 shadow-sm flex flex-col">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{tier.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  {tier.price ? (
                    <>
                      <span className="text-4xl font-bold text-gray-900">${tier.price}</span>
                      <span className="text-gray-500">/mo</span>
                    </>
                  ) : (
                    <span className="text-4xl font-bold text-gray-900">Let&rsquo;s talk</span>
                  )}
                </div>
              </div>
              <ul className="mt-6 space-y-3 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check className="h-4 w-4 text-green-600 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={tier.href}
                className="mt-8 block w-full text-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors"
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}