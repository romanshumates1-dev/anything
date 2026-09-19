import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Shield, Clock, CheckCircle, Zap } from "lucide-react";

export const metadata: Metadata = {
  title: "About",
  description:
    "DealFlow AI automates real estate wholesaling with AI-powered SMS outreach, compliant negotiation, and contract generation. Built for investors, by investors.",
  openGraph: {
    title: "About DealFlow AI",
    description: "Learn about our mission to automate real estate wholesaling with full compliance.",
  },
};

export default function AboutPage() {
  return (
    <div className="bg-[#0F172A]">
      <div className="py-20 sm:py-28">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">About Us</span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold text-white mb-4">
              About DealFlow AI
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              We're on a mission to make real estate wholesaling more efficient, compliant, and profitable.
            </p>
          </div>

          {/* Content */}
          <div className="space-y-16">
            {/* Our Story */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-6">Our Story</h2>
              <div className="space-y-4 text-slate-400 leading-relaxed">
                <p>
                  DealFlow AI was founded by real estate investors who experienced firsthand the challenges of
                  scaling a wholesaling business. After manually sending thousands of SMS messages, negotiating
                  with sellers, and shepherding deals through contracts, we knew there had to be a better way.
                </p>
                <p>
                  The answer wasn't just automation—it was <span className="text-white">controlled</span> automation.
                  An AI that negotiates within your bounds, respects compliance requirements, and escalates when
                  human judgment is needed.
                </p>
              </div>
            </section>

            {/* The Compliance Difference */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-6">The Compliance Difference</h2>
              <p className="text-slate-400 mb-6 leading-relaxed">
                Unlike generic outreach tools, DealFlow AI was built from the ground up with messaging compliance
                as a core feature, not an afterthought:
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  {
                    icon: Shield,
                    title: "Opt-out enforcement",
                    desc: "STOP/HELP replies are honored automatically across all channels and logged for compliance audits.",
                  },
                  {
                    icon: Clock,
                    title: "Quiet hours",
                    desc: "Messages are never sent outside 8am-9pm in the recipient's local timezone (DST-safe).",
                  },
                  {
                    icon: Zap,
                    title: "A2P registration",
                    desc: "Full support for Twilio 10DLC campaigns with proper opt-in tracking.",
                  },
                  {
                    icon: CheckCircle,
                    title: "Audit trail",
                    desc: "Every message, opt-out, and consent event is logged with timestamps and metadata.",
                  },
                ].map((item) => (
                  <div key={item.title} className="rounded-xl border border-white/10 bg-[#1E293B]/30 p-5">
                    <div className="w-10 h-10 rounded-lg bg-[#3B82F6]/10 flex items-center justify-center mb-4">
                      <item.icon className="h-5 w-5 text-[#3B82F6]" />
                    </div>
                    <h3 className="font-semibold text-white mb-2">{item.title}</h3>
                    <p className="text-sm text-slate-400">{item.desc}</p>
                  </div>
                ))}
              </div>
            </section>

            {/* Technology Stack */}
            <section>
              <h2 className="text-2xl font-bold text-white mb-6">Technology Stack</h2>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-white/10 bg-[#1E293B]/30 p-6">
                  <h3 className="font-semibold text-white mb-4">Frontend</h3>
                  <ul className="space-y-2 text-sm text-slate-400">
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                      Next.js 15 (React 19)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                      TypeScript
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                      Tailwind CSS + shadcn/ui
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" />
                      Electron desktop app
                    </li>
                  </ul>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#1E293B]/30 p-6">
                  <h3 className="font-semibold text-white mb-4">Backend</h3>
                  <ul className="space-y-2 text-sm text-slate-400">
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
                      Neon Postgres (serverless)
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
                      BullMQ job queue
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
                      Twilio SMS API
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#8B5CF6]" />
                      Stripe payments
                    </li>
                  </ul>
                </div>
              </div>
            </section>

            {/* Contact */}
            <section className="rounded-2xl border border-white/10 bg-[#1E293B]/30 p-8">
              <h2 className="text-2xl font-bold text-white mb-4">Contact Us</h2>
              <p className="text-slate-400 mb-4">
                Have questions? We'd love to hear from you.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 sm:gap-8 text-slate-400">
                <a href="mailto:support@dealflow.ai" className="text-[#3B82F6] hover:text-[#60A5FA] transition-colors">
                  support@dealflow.ai
                </a>
                <span className="text-white">(555) 123-4567</span>
              </div>
              <div className="mt-6">
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 text-[#3B82F6] font-medium hover:text-[#60A5FA] transition-colors"
                >
                  Send us a message
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
