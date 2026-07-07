import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Frequently asked questions about DealFlow AI: setup, pricing, AI capabilities, compliance, and integrations.",
};

const faqs = [
  { q: "How long does setup take?", a: "Most teams are up and running in under an hour. Import your leads, connect Twilio, and launch your first campaign." },
  { q: "Do I need coding experience?", a: "No. DealFlow AI is designed for real estate operators, not developers. Our onboarding flow guides you through everything." },
  { q: "What happens if the AI is unsure?", a: "The AI automatically escalates to a human when confidence is low or when topics involve offers, contracts, or pricing. You never lose a deal to a bad reply." },
  { q: "Is my data secure?", a: "Yes. We use TLS in transit, encrypt data at rest, and maintain SOC 2-aligned controls. Audit logs capture every action." },
  { q: "Can I test before going live?", a: "Yes. Test Mode lets you run campaigns against a sandbox so you can validate copy, routing, and AI behavior before sending to real leads." },
  { q: "Do you support my CRM?", a: "We support CSV/Excel import and REST webhooks for most CRMs. Enterprise plans include custom integrations." },
  { q: "What about 10DLC compliance?", a: "Built-in. We guide you through carrier registration, campaign setup, opt-out handling, and throughput management." },
  { q: "Can I cancel anytime?", a: "Yes. Month-to-month plans with no contracts. Cancel in one click from settings." },
];

export default function FAQPage() {
  return (
    <div className="py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900">Frequently asked questions</h1>
          <p className="mt-4 text-lg text-gray-600">Everything you need to know about DealFlow AI.</p>
        </div>
        <div className="space-y-6">
          {faqs.map((item) => (
            <div key={item.q} className="rounded-xl border bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-2">{item.q}</h3>
              <p className="text-sm text-gray-600">{item.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}