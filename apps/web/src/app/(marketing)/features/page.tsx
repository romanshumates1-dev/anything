import type { Metadata } from "next";
import { Bot, Shield, Zap, BarChart3, CheckCircle, Lock, Activity, Gauge } from "lucide-react";

export const metadata: Metadata = {
  title: "Features",
  description:
    "DealFlow AI features: AI negotiation, approval workflows, 10DLC compliance, test mode, rate limiting, analytics, and SOC 2 security.",
};

const features = [
  { title: "AI Negotiation", desc: "Gemini-powered conversations that qualify leads, answer objections, and negotiate price ranges autonomously.", icon: Bot },
  { title: "Approval Workflows", desc: "Owner-range and contract approvals with one-tap accept/reject from any device.", icon: Shield },
  { title: "10DLC A2P Compliance", desc: "Built-in opt-out handling, throughput management, and carrier registration workflows.", icon: Zap },
  { title: "Test Mode", desc: "Sandbox campaigns so you can validate copy, pricing, and routing before going live.", icon: CheckCircle },
  { title: "Rate Limiting", desc: "Per-API-key sliding-window rate limiting keeps outbound within carrier and budget caps.", icon: Gauge },
  { title: "Campaign Automation", desc: "Multi-step outreach sequences with adaptive AI follow-ups tailored to each lead.", icon: Activity },
  { title: "Analytics", desc: "Delivery, response, and negotiation analytics in real time.", icon: BarChart3 },
  { title: "SOC 2 Security", desc: "Encryption at rest and in transit, audit logging, role-based access.", icon: Lock },
];

export default function FeaturesPage() {
  return (
    <div className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900">Everything you need to scale</h1>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Production-hardened infrastructure for real estate lead engagement.
          </p>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl border bg-white p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center mb-4">
                <f.icon className="h-5 w-5 text-blue-700" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{f.title}</h3>
              <p className="text-sm text-gray-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}