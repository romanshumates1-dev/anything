import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Frequently asked questions about DealFlow AI: setup, pricing, AI capabilities, compliance, and integrations.",
};

const faqs = [
  {
    category: "Getting Started",
    questions: [
      { q: "How long does setup take?", a: "Most teams are up and running in under an hour. Import your leads, connect Twilio, and launch your first campaign." },
      { q: "Do I need coding experience?", a: "No. DealFlow AI is designed for real estate operators, not developers. Our onboarding flow guides you through everything." },
      { q: "Can I test before going live?", a: "Yes. Test Mode lets you run campaigns against a sandbox so you can validate copy, routing, and AI behavior before sending to real leads." },
    ],
  },
  {
    category: "AI & Automation",
    questions: [
      { q: "Does the AI send messages autonomously?", a: "The AI drafts and sends routine replies within limits you set, but it never states or confirms a price to a prospect on its own — any message that touches price, terms, or a decision point is held for your review and approval first." },
      { q: "What happens if the AI is unsure?", a: "The AI automatically escalates to a human when confidence is low or when topics involve offers, contracts, or pricing. You never lose a deal to a bad reply." },
      { q: "What happens after a seller agrees to a deal?", a: "The conversation is flagged for your review, terms are locked, and a contract is generated from the agreed details for e-signature. Nothing is sent to a buyer or countersigned without your action." },
    ],
  },
  {
    category: "Contracts & Compliance",
    questions: [
      { q: "What is wholesaling assignment?", a: "Wholesaling is putting a property under contract with a seller, then assigning (selling) that contract to an end buyer for a fee before closing. DealFlow AI helps you run the outreach and negotiation side of that process — it is a software tool, not a broker, and does not hold title or funds." },
      { q: "How is the contract handled?", a: "Contracts are generated from the agreed price and terms, routed through e-signature, and the signed document plus the full negotiation history are stored and available for export at any time." },
      { q: "How does consent and opt-out work?", a: "You are responsible for having consent to text each contact before importing them. Every outbound message includes an opt-out path; replying STOP immediately and permanently suppresses that number across all campaigns, server-side — no message can be sent around it." },
      { q: "Do you handle 10DLC/A2P carrier registration?", a: "We guide you through the carrier registration and campaign-setup process and enforce opt-out handling and throughput limits in the send path once you're registered. Registration approval is issued by the carriers, not by us." },
      { q: "Am I responsible for complying with TCPA and state wholesaling law?", a: "Yes. You are the sender of your own messages and the party to any wholesale contract; you are responsible for consent, applicable messaging law, and your state's wholesaling/real-estate regulations. See our Terms of Service and Acceptable Use Policy." },
    ],
  },
  {
    category: "Data & Security",
    questions: [
      { q: "Who owns my data?", a: "You do. Leads, conversations, contracts, and account data are yours; you can export them at any time and request deletion — see our Privacy Policy for retention and deletion details." },
      { q: "Is my data secure?", a: "Data is encrypted in transit (TLS) and at rest, and every AI action, approval, and message event is logged with a user, timestamp, and outcome for audit review." },
    ],
  },
  {
    category: "Billing & Support",
    questions: [
      { q: "Can I cancel anytime?", a: "Yes. Month-to-month plans with no contracts. Cancel in one click from settings." },
      { q: "Do you support my CRM?", a: "We support CSV/Excel import and REST webhooks for most CRMs. Enterprise plans include custom integrations." },
    ],
  },
];

export default function FAQPage() {
  return (
    <div className="bg-[#0F172A]">
      <div className="py-20 sm:py-28">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">FAQ</span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold text-white mb-4">
              Frequently asked questions
            </h1>
            <p className="text-xl text-slate-400">
              Everything you need to know about DealFlow AI.
            </p>
          </div>

          {/* FAQ Categories */}
          <div className="space-y-12">
            {faqs.map((category) => (
              <div key={category.category}>
                <h2 className="text-lg font-semibold text-white mb-6 pb-2 border-b border-white/10">
                  {category.category}
                </h2>
                <div className="space-y-4">
                  {category.questions.map((item) => (
                    <details key={item.q} className="group rounded-xl border border-white/10 bg-[#1E293B]/30">
                      <summary className="flex items-center justify-between p-6 cursor-pointer list-none">
                        <span className="font-medium text-white pr-4">{item.q}</span>
                        <span className="text-slate-400 group-open:rotate-180 transition-transform flex-shrink-0">
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </span>
                      </summary>
                      <div className="px-6 pb-6 text-slate-400 leading-relaxed">{item.a}</div>
                    </details>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Still Have Questions */}
          <div className="mt-20 text-center rounded-2xl border border-white/10 bg-[#1E293B]/30 p-12">
            <h2 className="text-2xl font-bold text-white mb-4">Still have questions?</h2>
            <p className="text-slate-400 mb-6 max-w-md mx-auto">
              Can't find what you're looking for? Our team is here to help.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center gap-2 bg-gradient-to-r from-[#3B82F6] to-[#8B5CF6] text-white px-6 py-3 rounded-lg font-semibold hover:opacity-90 transition-all shadow-lg shadow-blue-500/25"
            >
              Contact Support
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
