import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";

import { getPublicPlans, type PublicPlan } from "@/config/plans";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple pricing for DealFlow AI. Starter $99/mo, Professional $249/mo, Enterprise custom. 30-day free trial. Your subscription covers your Twilio SMS usage.",
};

// Single source of truth — the SAME data the entitlement gate enforces server-
// side. No hardcoded prices or limits live in this component.
function fmt(n: number | null): string {
  return n === null ? "Unlimited" : n.toLocaleString("en-US");
}

function includedRows(plan: PublicPlan): { label: string; value: string }[] {
  return [
    { label: "SMS segments / mo (Twilio, included)", value: fmt(plan.includedSmsSegments) },
    { label: "Leads / mo", value: fmt(plan.limits.leadsPerMonth) },
    { label: "Active campaigns", value: fmt(plan.limits.campaignsActiveMax) },
    { label: "AI replies / mo", value: fmt(plan.limits.aiRepliesPerMonth) },
    { label: "Stored contacts (memory)", value: fmt(plan.limits.contactsStored) },
    { label: "AI memory window (days)", value: fmt(plan.limits.aiMemoryDays) },
    { label: "Bring your own Claude key", value: plan.byoAiKeyAllowed ? "Yes" : "Ollama (free) only" },
  ];
}

export default function PricingPage() {
  const plans = getPublicPlans();
  return (
    <div className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold text-gray-900">Simple, transparent pricing</h1>
          <p className="mt-4 text-lg text-gray-600">
            Month-to-month. 30-day free trial. Your subscription includes your Twilio SMS usage — no
            separate messaging bill until you exceed your tier.
          </p>
        </div>
        <p className="text-center text-sm text-gray-500 mb-14">
          Every tier can run the free self-hosted Ollama model, or connect your own Claude key for higher
          close quality. Prefer to bring your own 10DLC number? Registration traffic doesn&rsquo;t count
          against your subscription.
        </p>

        <div className="grid md:grid-cols-3 gap-8">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`rounded-2xl border bg-white p-8 shadow-sm flex flex-col ${
                plan.id === "professional" ? "ring-2 ring-blue-600" : ""
              }`}
            >
              <div>
                <h3 className="text-lg font-semibold text-gray-900">{plan.name}</h3>
                <p className="mt-1 text-sm text-gray-500">{plan.tagline}</p>
                <div className="mt-4 flex items-baseline gap-1">
                  {plan.priceMonthly !== null ? (
                    <>
                      <span className="text-4xl font-bold text-gray-900">${plan.priceMonthly}</span>
                      <span className="text-gray-500">/mo</span>
                    </>
                  ) : (
                    <span className="text-4xl font-bold text-gray-900">Let&rsquo;s talk</span>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-400">{plan.trialDays}-day free trial</p>
              </div>

              <dl className="mt-6 space-y-2 flex-1 border-t pt-6">
                {includedRows(plan).map((row) => (
                  <div key={row.label} className="flex items-start justify-between gap-2 text-sm">
                    <dt className="text-gray-600">{row.label}</dt>
                    <dd className="font-medium text-gray-900 text-right">{row.value}</dd>
                  </div>
                ))}
              </dl>

              <ul className="mt-6 space-y-2">
                {plan.featureBullets.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href={plan.cta.href}
                className="mt-8 block w-full text-center rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 transition-colors"
              >
                {plan.cta.label}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-14 text-center text-sm text-gray-500">
          <p>
            Prices are billed monthly and include your messaging allowance. Usage caps are enforced
            before your bundled Twilio budget is exhausted, so you never receive a surprise carrier
            bill on top of your plan.
          </p>
          <p className="mt-3">
            By subscribing you agree to our{" "}
            <Link href="/legal/terms" className="text-blue-700 underline">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="text-blue-700 underline">
              Privacy Policy
            </Link>
            . Questions? See the{" "}
            <Link href="/faq" className="text-blue-700 underline">
              FAQ
            </Link>{" "}
            or{" "}
            <Link href="/contact" className="text-blue-700 underline">
              contact us
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
