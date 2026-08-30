import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "DealFlow AI's automated real estate wholesaling pipeline: lead import, AI SMS outreach, negotiation within bounds, contract generation, and e-signature.",
  openGraph: {
    title: "How DealFlow AI Works",
    description: "See our complete automated wholesaling pipeline in action.",
  },
};

export default function HowItWorksPage() {
  return (
    <div className="py-20">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            The DealFlow AI Pipeline
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            From lead import to closed deal, our automated system handles outreach, AI negotiation, 
            and contract generation with full compliance controls.
          </p>
        </div>

        {/* Pipeline Steps */}
        <div className="space-y-16">
          {/* Step 1: Lead Import */}
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-blue-100 mb-4">
                <span className="text-2xl font-bold text-blue-600">1</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Import Your Leads</h2>
              <p className="text-gray-600 mb-4">
                Import leads via CSV upload or integrate with your CRM. We automatically normalize phone 
                numbers to E.164 format and deduplicate against your existing list.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Bulk import via CSV (10,000+ leads)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Automatic phone normalization to E.164</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Built-in deduplication</span>
                </li>
              </ul>
            </div>
            <ScreenshotFrame src="/screenshots/lead-import.png" alt="Lead import screen showing bulk CSV/paste import and single-lead form" />
          </div>

          {/* Step 2: AI SMS Outreach */}
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <ScreenshotFrame src="/screenshots/campaign-wizard.png" alt="Campaign wizard's Basics step: name, direction, contact source, and opening message" className="md:order-2" />
            <div>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-blue-100 mb-4">
                <span className="text-2xl font-bold text-blue-600">2</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">AI-Powered Outreach</h2>
              <p className="text-gray-600 mb-4">
                Launch campaigns with smart opener templates. Our AI sends personalized SMS messages 
                and respects TCPA quiet hours (8am-9pm local time).
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Quick Launch for test campaigns (1-click activation)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Local presence number assignment (INT-3)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Quiet hours enforcement per lead timezone</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Step 3: AI Negotiation */}
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-blue-100 mb-4">
                <span className="text-2xl font-bold text-blue-600">3</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Bounded Negotiation</h2>
              <p className="text-gray-600 mb-4">
                Set your min/max price bounds. The AI negotiates within those bounds, escalating 
                to you only when offers hit your limits or sensitive topics arise.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Owner-set price boundaries (never exceeded)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Automatic escalation on boundaries</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Live negotiation timeline in inbox</span>
                </li>
              </ul>
            </div>
            <ScreenshotFrame src="/screenshots/negotiation-panel.png" alt="Live SMS negotiation thread between the AI and a seller" />
          </div>

          {/* Step 4: Milestone Notification */}
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <ScreenshotFrame src="/screenshots/notification.png" alt="Approvals feed showing resolved owner-range and contact-message notifications" className="md:order-2" />
            <div>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-blue-100 mb-4">
                <span className="text-2xl font-bold text-blue-600">4</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Stay Informed</h2>
              <p className="text-gray-600 mb-4">
                Get notified at key milestones: when sellers respond, counter-offer, or agree. 
                Inspection timelines and urgency alerts keep deals moving.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Real-time notifications in dashboard</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Day-3 and final-day urgency alerts</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Email/webhook integration ready</span>
                </li>
              </ul>
            </div>
          </div>

          {/* Step 5: Contract Generation */}
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-blue-100 mb-4">
                <span className="text-2xl font-bold text-blue-600">5</span>
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-3">Contracts & E-Sign</h2>
              <p className="text-gray-600 mb-4">
                Generate assignment contracts with correct parties and terms. Sellers sign electronically 
                after E-SIGN consent, with signed docs archived automatically.
              </p>
              <ul className="space-y-2 text-sm text-gray-600">
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>PDF contract generation</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>E-signature with compliance logging</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>Automatic buyer disposition tracking</span>
                </li>
              </ul>
            </div>
            <ScreenshotFrame src="/screenshots/contract-preview.png" alt="Signed contracts list with inspection window and assignment terms" />
          </div>
        </div>

        {/* CTA */}
        <div className="mt-20 text-center bg-blue-50 rounded-2xl p-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">
            Ready to automate your wholesaling pipeline?
          </h2>
          <p className="text-gray-600 mb-6 max-w-lg mx-auto">
            Start your 30-day free trial today. No credit card required.
          </p>
          <Link
            href="/account/signup"
            className="inline-block rounded-lg bg-blue-600 px-6 py-3 text-sm font-semibold text-white hover:bg-blue-700"
          >
            Get Started
          </Link>
        </div>
      </div>
    </div>
  );
}

function ScreenshotFrame({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`bg-gray-50 rounded-2xl p-6 border ${className || ''}`}>
      <div className="aspect-video relative overflow-hidden rounded-lg bg-gray-100">
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(min-width: 768px) 40vw, 90vw"
          className="object-cover object-left-top"
        />
      </div>
    </div>
  );
}