import type { Metadata } from "next";
import Link from "next/link";
import {
  Bot,
  Shield,
  Zap,
  BarChart3,
  CheckCircle,
  Lock,
  Activity,
  Gauge,
  MessageSquare,
  FileText,
  Users,
  ArrowRight,
  Sparkles,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Features",
  description:
    "DealFlow AI features: AI negotiation, approval workflows, 10DLC compliance, test mode, rate limiting, analytics, and enterprise security.",
};

const features = [
  {
    title: "AI Negotiation",
    desc: "Claude-powered conversations that qualify leads, answer objections, and negotiate price ranges autonomously. Your AI works 24/7, even while you sleep.",
    icon: Bot,
    color: "from-blue-500 to-cyan-500",
  },
  {
    title: "Approval Workflows",
    desc: "Owner-range and contract approvals with one-tap accept/reject from any device. Stay in control without the busywork.",
    icon: Shield,
    color: "from-purple-500 to-pink-500",
  },
  {
    title: "10DLC A2P Compliance",
    desc: "Built-in opt-out handling, throughput management, and carrier registration workflows. Stay compliant automatically.",
    icon: Zap,
    color: "from-amber-500 to-orange-500",
  },
  {
    title: "Test Mode",
    desc: "Sandbox campaigns so you can validate copy, pricing, and routing before going live. No more testing on real leads.",
    icon: CheckCircle,
    color: "from-emerald-500 to-teal-500",
  },
  {
    title: "Rate Limiting",
    desc: "Per-API-key sliding-window rate limiting keeps outbound within carrier and budget caps. Intelligent throttling included.",
    icon: Gauge,
    color: "from-red-500 to-rose-500",
  },
  {
    title: "Campaign Automation",
    desc: "Multi-step outreach sequences with adaptive AI follow-ups tailored to each lead's engagement patterns.",
    icon: Activity,
    color: "from-indigo-500 to-violet-500",
  },
  {
    title: "Smart Analytics",
    desc: "Delivery, response, and negotiation analytics in real time. Track every metric that matters to your bottom line.",
    icon: BarChart3,
    color: "from-cyan-500 to-blue-500",
  },
  {
    title: "Enterprise Security",
    desc: "Encryption at rest and in transit, audit logging, role-based access. Your data is protected at every layer.",
    icon: Lock,
    color: "from-slate-500 to-zinc-500",
  },
  {
    title: "Contract Generation",
    desc: "Auto-generate contracts from agreed terms with e-signature integration. Close deals faster with less paperwork.",
    icon: FileText,
    color: "from-pink-500 to-fuchsia-500",
  },
  {
    title: "Buyer Matching",
    desc: "AI-powered buyer matching connects your deals with the right cash buyers based on their criteria and history.",
    icon: Users,
    color: "from-teal-500 to-green-500",
  },
  {
    title: "SMS & Email",
    desc: "Built-in multi-channel messaging with deliverability monitoring and automatic retries for failed sends.",
    icon: MessageSquare,
    color: "from-violet-500 to-purple-500",
  },
  {
    title: "AI Insights",
    desc: "Get AI-powered insights on lead quality, deal potential, and recommended next actions for every conversation.",
    icon: Sparkles,
    color: "from-yellow-500 to-amber-500",
  },
];

export default function FeaturesPage() {
  return (
    <div className="bg-[#0F172A]">
      <div className="py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-20">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Features</span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold text-white mb-4">
              Everything you need to scale
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Production-hardened infrastructure for real estate lead engagement. Built by wholesalers, for wholesalers.
            </p>
          </div>

          {/* Features Grid */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-20">
            {features.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-white/10 bg-[#1E293B]/30 p-6 transition-all hover:border-white/20 hover:bg-[#1E293B]/60"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.color} flex items-center justify-center mb-5`}>
                  <f.icon className="h-6 w-6 text-white" />
                </div>
                <h3 className="text-lg font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-slate-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>

          {/* Feature Highlights */}
          <div className="mb-20">
            <div className="grid lg:grid-cols-2 gap-16 items-center mb-20">
              <div>
                <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">AI Negotiation</span>
                <h2 className="mt-4 text-3xl font-bold text-white mb-4">
                  Let AI handle the back-and-forth
                </h2>
                <p className="text-slate-400 mb-6 leading-relaxed">
                  Our Claude-powered AI understands context, handles objections, and negotiates price ranges — all while maintaining your brand voice. It knows when to push and when to escalate to you.
                </p>
                <ul className="space-y-3">
                  {[
                    "Qualifies leads automatically based on your criteria",
                    "Handles common objections with customizable responses",
                    "Negotiates within your approved price ranges",
                    "Escalates to you for final approval on key decisions",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-slate-300">
                      <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-white/10 bg-[#1E293B]/50 p-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3 text-sm">
                    <div className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-emerald-400">AI is negotiating with John Smith</span>
                  </div>
                  <div className="rounded-lg bg-slate-700/50 p-4">
                    <p className="text-sm text-slate-300">
                      "I understand you're looking for $200K for the property. Based on comparable sales in the area and the current condition, our investors typically offer between $165K-$180K for properties like yours. Would a price in that range work for you?"
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <Bot className="h-4 w-4" />
                    <span>AI response - within your approved range of $160K-$185K</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-16 items-center">
              <div className="order-2 lg:order-1 rounded-2xl border border-white/10 bg-[#1E293B]/50 p-6">
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-4 border-b border-white/10">
                    <span className="text-sm font-medium text-white">Pending Approvals</span>
                    <span className="text-xs bg-amber-500/10 text-amber-400 px-2 py-1 rounded-full">3 waiting</span>
                  </div>
                  {[
                    { lead: "123 Main St", type: "Price Range", range: "$180K-$220K" },
                    { lead: "456 Oak Ave", type: "Contract", range: "Ready to sign" },
                    { lead: "789 Pine Rd", type: "Counter Offer", range: "$165K" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/5">
                      <div>
                        <p className="text-sm font-medium text-white">{item.lead}</p>
                        <p className="text-xs text-slate-500">{item.type}: {item.range}</p>
                      </div>
                      <div className="flex gap-2">
                        <button className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-500 text-white">
                          Approve
                        </button>
                        <button className="px-3 py-1.5 text-xs font-medium rounded-md bg-slate-600 text-slate-300">
                          Review
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="order-1 lg:order-2">
                <span className="text-sm font-medium text-[#8B5CF6] uppercase tracking-wider">Approval Workflows</span>
                <h2 className="mt-4 text-3xl font-bold text-white mb-4">
                  Stay in control without the busywork
                </h2>
                <p className="text-slate-400 mb-6 leading-relaxed">
                  Set your parameters once, then let AI handle the routine. You only get notified when it matters — price approvals, contract reviews, and key decision points.
                </p>
                <ul className="space-y-3">
                  {[
                    "One-tap approve/reject from any device",
                    "Customizable approval thresholds",
                    "Full audit trail for every decision",
                    "Team permissions and delegation",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-slate-300">
                      <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* CTA Section */}
          <div className="relative overflow-hidden rounded-3xl">
            <div className="absolute inset-0 bg-gradient-to-br from-[#3B82F6] to-[#8B5CF6]" />
            <div className="relative px-8 py-16 sm:px-16 text-center">
              <h2 className="text-3xl font-bold text-white mb-4">Ready to automate your wholesaling?</h2>
              <p className="text-white/80 mb-8 max-w-xl mx-auto">
                Start your 14-day free trial. No credit card required. Join 800+ active users generating $45M+ in deals.
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
                  href="/pricing"
                  className="inline-flex items-center justify-center gap-2 border-2 border-white/30 text-white px-8 py-4 rounded-lg font-semibold hover:bg-white/10 transition-colors"
                >
                  View Pricing
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
