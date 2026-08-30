import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { CheckCircle, Bot, Shield, Zap, BarChart3, MessageSquare } from "lucide-react";
import { auth } from "@/lib/auth";
import { UrgencyBanner } from '@/components/marketing';

// Marketing landing owns "/". Guests see this page; authenticated users are
// sent to the SaaS app at /dashboard. (Previously /app/page.tsx (dashboard)
// and this page both resolved to "/", a route collision that shadowed the
// marketing site entirely.)
export default async function LandingPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect("/dashboard");
  return (
    <div className="min-h-screen">
      {/* Urgency Banner */}
      <UrgencyBanner variant="spots" spotsRemaining={847} discount={50} />
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-8">
              <div className="inline-flex items-center rounded-full border bg-white px-4 py-1.5 text-sm font-medium text-blue-700 shadow-sm">
                ✦ AI-Powered Real Estate Intelligence
              </div>
              <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
                Close more deals with{" "}
                <span className="text-blue-700">AI-driven lead engagement</span>
              </h1>
              <p className="text-lg text-gray-600 max-w-xl">
                DealFlow AI automates your SMS outreach, manages approvals, and keeps
                every negotiation compliant — so you never miss a deal.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <Link
                  href="/account/signup"
                  className="inline-flex items-center justify-center rounded-lg bg-blue-700 px-6 py-3 text-base font-medium text-white hover:bg-blue-800 transition-colors shadow-lg"
                >
                  Start Free Trial
                </Link>
                <Link
                  href="/features"
                  className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-base font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  See Features
                </Link>
              </div>
            </div>
            <div className="hidden lg:block">
              <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-1 shadow-2xl">
                <div className="rounded-xl bg-white p-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 text-sm text-gray-600">
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      AI responding to lead...
                    </div>
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className="text-sm text-gray-700">
                        &ldquo;The offer on 123 Main St looks great. Let&rsquo;s move
                        forward with the paperwork.&rdquo;
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-gray-600">
                      <div className="h-2 w-2 rounded-full bg-amber-500" />
                      Approval required from owner
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <p className="text-sm font-medium text-amber-800">
                        Owner range approval: 123 Main St
                      </p>
                      <p className="text-sm text-amber-700 mt-1">
                        AI negotiated range $180K&ndash;$220K. Tap to approve.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20 bg-white">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900">How It Works</h2>
            <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
              Three steps from lead to close, with AI handling the busywork.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-12">
            {[
              {
                step: "01",
                title: "Import & Enrich",
                desc: "Upload your leads or connect your CRM. DealFlow AI enriches each contact with property context and engagement history.",
                icon: BarChart3,
              },
              {
                step: "02",
                title: "AI Engages",
                desc: "Your AI agent handles the conversation — qualifying leads, answering questions, and negotiating price ranges — 24/7.",
                icon: MessageSquare,
              },
              {
                step: "03",
                title: "You Approve",
                desc: "When the deal hits a key threshold — offers, contracts, price ranges — you get a notification. One tap to approve and move forward.",
                icon: Shield,
              },
            ].map((item) => (
              <div key={item.step} className="text-center">
                <div className="inline-flex items-center justify-center h-16 w-16 rounded-full bg-blue-100 text-blue-700 mb-6">
                  <item.icon className="h-8 w-8" />
                </div>
                <div className="text-sm font-semibold text-blue-700 mb-2">{item.step}</div>
                <h3 className="text-xl font-semibold text-gray-900 mb-3">{item.title}</h3>
                <p className="text-gray-600">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Preview */}
      <section className="py-20 bg-gray-50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-gray-900">
              Everything you need to scale
            </h2>
            <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
              Production-hardened infrastructure for real estate lead engagement.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { title: "AI Negotiation", desc: "Claude-powered conversations that qualify leads and negotiate price ranges autonomously.", icon: Bot },
              { title: "Approval Workflows", desc: "Owner-range and contract approvals with one-tap accept/reject from any device.", icon: Shield },
              { title: "10DLC Compliant", desc: "Built-in A2P 10DLC compliance, opt-out handling, and throughput management.", icon: Zap },
              { title: "Rate Limiting", desc: "Per-API-key sliding-window rate limiting to keep your outbound within carrier caps.", icon: Shield },
              { title: "Test Mode", desc: "Sandbox environment to validate your campaigns before going live.", icon: CheckCircle },
              { title: "Campaign Automation", desc: "Multi-step outreach sequences with AI follow-ups tailored to each lead.", icon: Zap },
            ].map((feature) => (
              <div key={feature.title} className="rounded-xl border bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center mb-4">
                  <feature.icon className="h-5 w-5 text-blue-700" />
                </div>
                <h3 className="font-semibold text-gray-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-gray-600">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-gradient-to-br from-blue-700 to-indigo-800">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to close more deals?
          </h2>
          <p className="text-lg text-blue-100 mb-8 max-w-xl mx-auto">
            Start your free trial. No credit card required. No setup fees.
          </p>
          <Link
            href="/account/signup"
            className="inline-flex items-center justify-center rounded-lg bg-white px-8 py-3 text-base font-medium text-blue-700 hover:bg-blue-50 transition-colors shadow-lg"
          >
            Get Started Free
          </Link>
        </div>
      </section>
    </div>
  );
}