import type { Metadata } from "next";
import Link from "next/link";
import {
  Upload,
  Bot,
  MessageSquare,
  Bell,
  FileText,
  ArrowRight,
  CheckCircle,
  Users,
  Zap,
} from "lucide-react";

export const metadata: Metadata = {
  title: "How It Works",
  description:
    "DealFlow AI's automated real estate wholesaling pipeline: lead import, AI SMS outreach, negotiation within bounds, contract generation, and e-signature.",
  openGraph: {
    title: "How DealFlow AI Works",
    description: "See our complete automated wholesaling pipeline in action.",
  },
};

const steps = [
  {
    step: 1,
    title: "Import Your Leads",
    desc: "Import leads via CSV upload or integrate with your CRM. We automatically normalize phone numbers to E.164 format and deduplicate against your existing list.",
    icon: Upload,
    color: "from-blue-500 to-cyan-500",
    features: [
      "Bulk import via CSV (10,000+ leads)",
      "Automatic phone normalization to E.164",
      "Built-in deduplication",
      "CRM integration available",
    ],
    visual: (
      <div className="space-y-3">
        <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
          <div className="w-8 h-8 rounded bg-emerald-500/20 flex items-center justify-center">
            <CheckCircle className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">leads_batch_03.csv</p>
            <p className="text-xs text-slate-500">2,847 contacts imported</p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3 rounded-lg bg-white/5 border border-white/10">
          <div className="w-8 h-8 rounded bg-blue-500/20 flex items-center justify-center">
            <Users className="h-4 w-4 text-blue-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">147 duplicates removed</p>
            <p className="text-xs text-slate-500">Phone numbers normalized</p>
          </div>
        </div>
      </div>
    ),
  },
  {
    step: 2,
    title: "AI-Powered Outreach",
    desc: "Launch campaigns with smart opener templates. Our AI sends personalized SMS messages and respects TCPA quiet hours (8am-9pm local time).",
    icon: MessageSquare,
    color: "from-purple-500 to-pink-500",
    features: [
      "Quick Launch for test campaigns (1-click)",
      "Local presence number assignment",
      "Quiet hours enforcement per timezone",
      "Smart opener templates",
    ],
    visual: (
      <div className="space-y-3">
        <div className="rounded-lg bg-[#3B82F6]/10 border border-[#3B82F6]/20 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-[#3B82F6]" />
            <span className="text-xs font-medium text-[#3B82F6]">Quick Launch Active</span>
          </div>
          <p className="text-sm text-slate-300">
            "Hi [Name], I noticed your property at [Address] and wanted to reach out..."
          </p>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Sending 150/hr to 2,847 leads</span>
          <span className="text-emerald-400">Active</span>
        </div>
      </div>
    ),
  },
  {
    step: 3,
    title: "Bounded Negotiation",
    desc: "Set your min/max price bounds. The AI negotiates within those bounds, escalating to you only when offers hit your limits or sensitive topics arise.",
    icon: Bot,
    color: "from-emerald-500 to-teal-500",
    features: [
      "Owner-set price boundaries (never exceeded)",
      "Automatic escalation on boundaries",
      "Live negotiation timeline in inbox",
      "Context-aware responses",
    ],
    visual: (
      <div className="space-y-3">
        <div className="rounded-lg bg-white/5 border border-white/10 p-3">
          <p className="text-sm text-slate-300 mb-2">
            "I understand you're looking for $200K. Based on comparable sales, our investors typically offer $165K-$180K..."
          </p>
          <div className="flex items-center gap-2 text-xs">
            <Bot className="h-3 w-3 text-emerald-400" />
            <span className="text-emerald-400">Within approved range: $160K-$185K</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    step: 4,
    title: "Stay Informed",
    desc: "Get notified at key milestones: when sellers respond, counter-offer, or agree. Inspection timelines and urgency alerts keep deals moving.",
    icon: Bell,
    color: "from-amber-500 to-orange-500",
    features: [
      "Real-time notifications in dashboard",
      "Day-3 and final-day urgency alerts",
      "Email/webhook integration ready",
      "One-tap approvals from any device",
    ],
    visual: (
      <div className="space-y-2">
        {[
          { label: "Price Range Approval", status: "Pending", urgent: true },
          { label: "Counter Offer Received", status: "$175K", urgent: false },
          { label: "Contract Ready", status: "Review", urgent: false },
        ].map((item, i) => (
          <div key={i} className={`flex items-center justify-between p-3 rounded-lg ${item.urgent ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-white/5 border border-white/10'}`}>
            <span className={`text-sm ${item.urgent ? 'text-amber-400 font-medium' : 'text-slate-300'}`}>{item.label}</span>
            <span className={`text-xs ${item.urgent ? 'text-amber-400' : 'text-slate-500'}`}>{item.status}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    step: 5,
    title: "Contracts & E-Sign",
    desc: "Generate assignment contracts with correct parties and terms. Sellers sign electronically after E-SIGN consent, with signed docs archived automatically.",
    icon: FileText,
    color: "from-rose-500 to-pink-500",
    features: [
      "PDF contract generation",
      "E-signature with compliance logging",
      "Automatic buyer disposition tracking",
      "Full audit trail",
    ],
    visual: (
      <div className="space-y-3">
        <div className="rounded-lg bg-white/5 border border-white/10 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-white">Assignment Contract</span>
            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full">Signed</span>
          </div>
          <p className="text-xs text-slate-500">123 Main St - $175,000</p>
          <p className="text-xs text-slate-500">Signed: John Smith (Seller)</p>
        </div>
      </div>
    ),
  },
];

export default function HowItWorksPage() {
  return (
    <div className="bg-[#0F172A]">
      <div className="py-20 sm:py-28">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-20">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">How It Works</span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold text-white mb-4">
              The DealFlow AI Pipeline
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              From lead import to closed deal, our automated system handles outreach, AI negotiation,
              and contract generation with full compliance controls.
            </p>
          </div>

          {/* Pipeline Steps */}
          <div className="space-y-24">
            {steps.map((step, i) => (
              <div key={step.step} className={`grid lg:grid-cols-2 gap-12 items-center ${i % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}>
                <div className={i % 2 === 1 ? 'lg:order-2' : ''}>
                  <div className={`inline-flex items-center justify-center w-14 h-14 rounded-xl bg-gradient-to-br ${step.color} mb-6`}>
                    <step.icon className="h-7 w-7 text-white" />
                  </div>
                  <div className="text-sm font-bold text-slate-500 mb-2">STEP {step.step}</div>
                  <h2 className="text-3xl font-bold text-white mb-4">{step.title}</h2>
                  <p className="text-slate-400 mb-6 leading-relaxed">{step.desc}</p>
                  <ul className="space-y-3">
                    {step.features.map((feature, j) => (
                      <li key={j} className="flex items-start gap-3">
                        <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                        <span className="text-slate-300">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={`rounded-2xl border border-white/10 bg-[#1E293B]/50 p-6 ${i % 2 === 1 ? 'lg:order-1' : ''}`}>
                  {step.visual}
                </div>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-24 relative overflow-hidden rounded-3xl">
            <div className="absolute inset-0 bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6]" />
            <div className="relative px-8 py-16 sm:px-16 text-center">
              <h2 className="text-3xl font-bold text-white mb-4">
                Ready to automate your wholesaling pipeline?
              </h2>
              <p className="text-white/80 mb-8 max-w-xl mx-auto">
                Start your 14-day free trial today. No credit card required.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link
                  href="/account/signup"
                  className="inline-flex items-center justify-center gap-2 bg-white text-[#3B82F6] px-8 py-4 rounded-lg font-semibold hover:bg-white/90 transition-colors shadow-xl"
                >
                  Get Started
                  <ArrowRight className="h-5 w-5" />
                </Link>
                <Link
                  href="/features"
                  className="inline-flex items-center justify-center gap-2 border-2 border-white/30 text-white px-8 py-4 rounded-lg font-semibold hover:bg-white/10 transition-colors"
                >
                  View Features
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
