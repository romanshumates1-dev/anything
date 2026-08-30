import type { Metadata } from "next";

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
    <div className="py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            About DealFlow AI
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            We're on a mission to make real estate wholesaling more efficient, compliant, and profitable.
          </p>
        </div>

        <div className="prose prose-gray max-w-none">
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Our Story</h2>
            <p className="text-gray-600">
              DealFlow AI was founded by real estate investors who experienced firsthand the challenges of 
              scaling a wholesaling business. After manually sending thousands of SMS messages, negotiating 
              with sellers, and shepherding deals through contracts, we knew there had to be a better way.
            </p>
            <p className="text-gray-600 mt-4">
              The answer wasn't just automation—it was <em>controlled</em> automation. An AI that negotiate 
              within your bounds, respects compliance requirements, and escalates when human judgment is needed.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">The Compliance Difference</h2>
            <p className="text-gray-600">
              Unlike generic outreach tools, DealFlow AI was built from the ground up with messaging compliance 
              as a core feature, not an afterthought:
            </p>
            <ul className="mt-4 space-y-3 text-gray-600">
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold">•</span>
                <span>
                  <strong>Opt-out enforcement:</strong> STOP/HELP replies are honored automatically across 
                  all channels and logged for compliance audits.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold">•</span>
                <span>
                  <strong>Quiet hours:</strong> Messages are never sent outside 8am-9pm in the recipient's 
                  local timezone (DST-safe).
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold">•</span>
                <span>
                  <strong>A2P registration:</strong> Full support for Twilio 10DLC campaigns with proper 
                  opt-in tracking.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-600 font-bold">•</span>
                <span>
                  <strong>Audit trail:</strong> Every message, opt-out, and consent event is logged with 
                  timestamps and metadata.
                </span>
              </li>
            </ul>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Technology Stack</h2>
            <div className="grid md:grid-cols-2 gap-6">
              <div className="p-4 rounded-lg border">
                <h3 className="font-semibold text-gray-900 mb-2">Frontend</h3>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>Next.js 15 (React 19)</li>
                  <li>TypeScript</li>
                  <li>Tailwind CSS + shadcn/ui</li>
                  <li>Electron desktop app</li>
                </ul>
              </div>
              <div className="p-4 rounded-lg border">
                <h3 className="font-semibold text-gray-900 mb-2">Backend</h3>
                <ul className="text-sm text-gray-600 space-y-1">
                  <li>Neon Postgres (serverless)</li>
                  <li>BullMQ job queue</li>
                  <li>Twilio SMS API</li>
                  <li>Stripe payments</li>
                </ul>
              </div>
            </div>
          </section>

          <section className="bg-gray-50 rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Contact Us</h2>
            <p className="text-gray-600 mb-2">
              Have questions? We'd love to hear from you.
            </p>
            <p className="text-gray-600">
              Email: <a href="mailto:support@dealflow.ai" className="text-blue-600 hover:underline">support@dealflow.ai</a>
              {' '}<span className="text-gray-400">|</span>{' '}
              Phone: <span className="text-gray-900">(555) 123-4567</span>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}