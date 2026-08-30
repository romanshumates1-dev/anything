import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Frequently asked questions about DealFlow AI: setup, pricing, AI capabilities, compliance, and integrations.",
};

const faqs = [
  { q: "What is wholesaling assignment?", a: "Wholesaling is putting a property under contract with a seller, then assigning (selling) that contract to an end buyer for a fee before closing. DealFlow AI helps you run the outreach and negotiation side of that process — it is a software tool, not a broker, and does not hold title or funds." },
  { q: "Does the AI send messages autonomously?", a: "The AI drafts and sends routine replies within limits you set, but it never states or confirms a price to a prospect on its own — any message that touches price, terms, or a decision point is held for your review and approval first." },
  { q: "How does consent and opt-out work?", a: "You are responsible for having consent to text each contact before importing them. Every outbound message includes an opt-out path; replying STOP immediately and permanently suppresses that number across all campaigns, server-side — no message can be sent around it." },
  { q: "What happens after a seller agrees to a deal?", a: "The conversation is flagged for your review, terms are locked, and a contract is generated from the agreed details for e-signature. Nothing is sent to a buyer or countersigned without your action." },
  { q: "How is the contract handled?", a: "Contracts are generated from the agreed price and terms, routed through e-signature, and the signed document plus the full negotiation history are stored and available for export at any time." },
  { q: "Who owns my data?", a: "You do. Leads, conversations, contracts, and account data are yours; you can export them at any time and request deletion — see our Privacy Policy for retention and deletion details." },
  { q: "How long does setup take?", a: "Most teams are up and running in under an hour. Import your leads, connect Twilio, and launch your first campaign." },
  { q: "Do I need coding experience?", a: "No. DealFlow AI is designed for real estate operators, not developers. Our onboarding flow guides you through everything." },
  { q: "What happens if the AI is unsure?", a: "The AI automatically escalates to a human when confidence is low or when topics involve offers, contracts, or pricing. You never lose a deal to a bad reply." },
  { q: "Is my data secure?", a: "Data is encrypted in transit (TLS) and at rest, and every AI action, approval, and message event is logged with a user, timestamp, and outcome for audit review." },
  { q: "Can I test before going live?", a: "Yes. Test Mode lets you run campaigns against a sandbox so you can validate copy, routing, and AI behavior before sending to real leads." },
  { q: "Do you support my CRM?", a: "We support CSV/Excel import and REST webhooks for most CRMs. Enterprise plans include custom integrations." },
  { q: "Do you handle 10DLC/A2P carrier registration?", a: "We guide you through the carrier registration and campaign-setup process and enforce opt-out handling and throughput limits in the send path once you're registered. Registration approval is issued by the carriers, not by us." },
  { q: "Am I responsible for complying with TCPA and state wholesaling law?", a: "Yes. You are the sender of your own messages and the party to any wholesale contract; you are responsible for consent, applicable messaging law, and your state's wholesaling/real-estate regulations. See our Terms of Service and Acceptable Use Policy." },
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