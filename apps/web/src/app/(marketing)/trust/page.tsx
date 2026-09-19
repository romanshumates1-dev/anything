// TEMPLATE - requires attorney review before launch
import type { Metadata } from "next";
import Link from "next/link";
import { Shield, Clock, Lock, FileText, AlertTriangle, CheckCircle } from "lucide-react";

export const metadata: Metadata = {
  title: "Compliance Center",
  description:
    "DealFlow AI's messaging practices, consent requirements, and data handling policies. TCPA compliant SMS outreach for real estate investors.",
  openGraph: {
    title: "DealFlow AI Compliance Center",
    description: "Our commitment to responsible messaging and data handling.",
  },
};

const legalDocuments = [
  { href: "/legal/terms", title: "Terms of Service", desc: "Platform terms and user obligations" },
  { href: "/legal/privacy", title: "Privacy Policy", desc: "How we collect and use data" },
  { href: "/legal/acceptable-use", title: "Acceptable Use Policy", desc: "Messaging and content guidelines" },
  { href: "/legal/sms-terms", title: "SMS Terms", desc: "Program-specific messaging terms" },
  { href: "/legal/refunds", title: "Refund Policy", desc: "Billing and refund terms" },
  { href: "/legal/cookies", title: "Cookie Policy", desc: "Website cookie usage" },
];

export default function TrustPage() {
  return (
    <div className="bg-[#0F172A]">
      <div className="py-20 sm:py-28">
        <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
          {/* Hero */}
          <div className="text-center mb-16">
            <span className="text-sm font-medium text-[#3B82F6] uppercase tracking-wider">Trust Center</span>
            <h1 className="mt-4 text-4xl sm:text-5xl font-bold text-white mb-4">
              Compliance Center
            </h1>
            <p className="text-xl text-slate-400 max-w-2xl mx-auto">
              Our commitment to responsible messaging and transparent data practices.
            </p>
          </div>

          {/* Content */}
          <div className="space-y-12">
            {/* Consent Requirements */}
            <section className="rounded-2xl border border-white/10 bg-[#1E293B]/30 p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-[#3B82F6]/10 flex items-center justify-center">
                  <Shield className="h-6 w-6 text-[#3B82F6]" />
                </div>
                <h2 className="text-2xl font-bold text-white">Consent Requirements</h2>
              </div>
              <p className="text-slate-400 mb-6 leading-relaxed">
                DealFlow AI complies with the Telephone Consumer Protection Act (TCPA) and requires that
                all contacts have given prior express written consent before receiving SMS messages.
                This means:
              </p>
              <ul className="space-y-4">
                {[
                  { label: "No purchased lists", desc: "You may only message contacts who have explicitly opted in." },
                  { label: "Opt-in documentation", desc: "Maintain records of how each contact gave consent." },
                  { label: "Clear disclosure", desc: "Consent language must clearly disclose message frequency and purpose." },
                ].map((item) => (
                  <li key={item.label} className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium text-white">{item.label}:</span>{" "}
                      <span className="text-slate-400">{item.desc}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* STOP/HELP Handling */}
            <section className="rounded-2xl border border-white/10 bg-[#1E293B]/30 p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <AlertTriangle className="h-6 w-6 text-amber-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">STOP/HELP Handling</h2>
              </div>
              <p className="text-slate-400 mb-6 leading-relaxed">
                Every SMS campaign includes automatic opt-out mechanisms:
              </p>
              <ul className="space-y-4">
                {[
                  {
                    label: "STOP keyword",
                    desc: "Any contact can reply \"STOP\" to immediately unsubscribe. This adds them to our global suppression list, preventing all future messages.",
                  },
                  {
                    label: "HELP keyword",
                    desc: "Reply \"HELP\" for information about the program, including how to opt out and contact support.",
                  },
                  {
                    label: "Confirmation",
                    desc: "STOP replies trigger an automated confirmation that opt-out was processed.",
                  },
                ].map((item) => (
                  <li key={item.label} className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium text-white">{item.label}:</span>{" "}
                      <span className="text-slate-400">{item.desc}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Quiet Hours */}
            <section className="rounded-2xl border border-white/10 bg-[#1E293B]/30 p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-[#8B5CF6]/10 flex items-center justify-center">
                  <Clock className="h-6 w-6 text-[#8B5CF6]" />
                </div>
                <h2 className="text-2xl font-bold text-white">Quiet Hours Enforcement</h2>
              </div>
              <p className="text-slate-400 mb-6 leading-relaxed">
                To respect recipient preferences and comply with best practices, messages are only sent
                during permitted hours:
              </p>
              <ul className="space-y-4">
                {[
                  { label: "Time window", desc: "8:00 AM to 9:00 PM in the recipient's local timezone" },
                  { label: "Automatic deferral", desc: "Messages scheduled outside these hours are automatically deferred" },
                  { label: "Timezone detection", desc: "Timezones are determined by phone number area code (DST-safe)" },
                ].map((item) => (
                  <li key={item.label} className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium text-white">{item.label}:</span>{" "}
                      <span className="text-slate-400">{item.desc}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Data Handling */}
            <section className="rounded-2xl border border-white/10 bg-[#1E293B]/30 p-8">
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                  <Lock className="h-6 w-6 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Data Handling</h2>
              </div>
              <p className="text-slate-400 mb-6 leading-relaxed">
                We take data protection seriously:
              </p>
              <ul className="space-y-4">
                {[
                  {
                    label: "Subprocessors",
                    desc: "Twilio (SMS), Stripe (Payments), Neon (Database), Anthropic (AI). All providers meet SOC 2 compliance standards.",
                  },
                  {
                    label: "Encryption",
                    desc: "All data in transit uses TLS 1.3. Sensitive data at rest is encrypted in our database.",
                  },
                  {
                    label: "Retention",
                    desc: "Contact data is retained until account deletion. Message logs are retained for compliance purposes.",
                  },
                  {
                    label: "Deletion",
                    desc: "Users may request account deletion and data removal through our privacy portal.",
                  },
                ].map((item) => (
                  <li key={item.label} className="flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <span className="font-medium text-white">{item.label}:</span>{" "}
                      <span className="text-slate-400">{item.desc}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Legal Documents */}
            <section>
              <div className="flex items-center gap-4 mb-6">
                <div className="w-12 h-12 rounded-xl bg-slate-500/10 flex items-center justify-center">
                  <FileText className="h-6 w-6 text-slate-400" />
                </div>
                <h2 className="text-2xl font-bold text-white">Legal Documents</h2>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {legalDocuments.map((doc) => (
                  <Link
                    key={doc.href}
                    href={doc.href}
                    className="block rounded-xl border border-white/10 bg-[#1E293B]/30 p-5 hover:border-[#3B82F6]/50 hover:bg-[#1E293B]/50 transition-all"
                  >
                    <h3 className="font-semibold text-white mb-1">{doc.title}</h3>
                    <p className="text-sm text-slate-500">{doc.desc}</p>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
