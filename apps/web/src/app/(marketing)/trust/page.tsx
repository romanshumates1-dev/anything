// TEMPLATE — requires attorney review before launch
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Compliance Center",
  description:
    "DealFlow AI's messaging practices, consent requirements, and data handling policies. TCPA compliant SMS outreach for real estate investors.",
  openGraph: {
    title: "DealFlow AI Compliance Center",
    description: "Our commitment to responsible messaging and data handling.",
  },
};

export default function TrustPage() {
  return (
    <div className="py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Compliance Center
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Our commitment to responsible messaging and transparent data practices.
          </p>
        </div>

        <div className="prose prose-gray max-w-none space-y-12">
          {/* Consent Requirements */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Consent Requirements</h2>
            <p className="text-gray-600">
              DealFlow AI complies with the Telephone Consumer Protection Act (TCPA) and requires that 
              all contacts have given prior express written consent before receiving SMS messages. 
              This means:
            </p>
            <ul className="mt-4 text-gray-600">
              <li><strong>No purchased lists:</strong> You may only message contacts who have explicitly opted in.</li>
              <li><strong>Opt-in documentation:</strong> Maintain records of how each contact gave consent.</li>
              <li><strong>Clear disclosure:</strong> Consent language must clearly disclose message frequency and purpose.</li>
            </ul>
          </section>

          {/* STOP/HELP Handling */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">STOP/HELP Handling</h2>
            <p className="text-gray-600">
              Every SMS campaign includes automatic opt-out mechanisms:
            </p>
            <ul className="mt-4 text-gray-600">
              <li>
                <strong>STOP keyword:</strong> Any contact can reply "STOP" to immediately unsubscribe. 
                This adds them to our global suppression list, preventing all future messages.
              </li>
              <li>
                <strong>HELP keyword:</strong> Reply "HELP" for information about the program, including 
                how to opt out and contact support.
              </li>
              <li>
                <strong>Confirmation:</strong> STOP replies trigger an automated confirmation that 
                opt-out was processed.
              </li>
            </ul>
          </section>

          {/* Quiet Hours */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Quiet Hours Enforcement</h2>
            <p className="text-gray-600">
              To respect recipient preferences and comply with best practices, messages are only sent 
              during permitted hours:
            </p>
            <ul className="mt-4 text-gray-600">
              <li><strong>8:00 AM to 9:00 PM</strong> in the recipient's local timezone</li>
              <li>Messages scheduled outside these hours are automatically deferred</li>
              <li>Timezones are determined by phone number area code (DST-safe)</li>
            </ul>
          </section>

          {/* Data Handling */}
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Data Handling</h2>
            <p className="text-gray-600">
              We take data protection seriously:
            </p>
            <ul className="mt-4 text-gray-600">
              <li>
                <strong>Subprocessors:</strong> Twilio (SMS), Stripe (Payments), Neon (Database), 
                Anthropic (AI). All providers meet SOC 2 compliance standards.
              </li>
              <li>
                <strong>Encryption:</strong> All data in transit uses TLS 1.3. Sensitive data at rest 
                is encrypted in our database.
              </li>
              <li>
                <strong>Retention:</strong> Contact data is retained until account deletion. 
                Message logs are retained for compliance purposes.
              </li>
              <li>
                <strong>Deletion:</strong> Users may request account deletion and data removal 
                through our privacy portal.
              </li>
            </ul>
          </section>

          {/* Legal Links */}
          <section className="bg-gray-50 rounded-2xl p-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Legal Documents</h2>
            <div className="grid md:grid-cols-2 gap-4">
              <Link href="/legal/terms" className="block p-4 rounded-lg border bg-white hover:border-blue-300 transition-colors">
                <h3 className="font-semibold text-gray-900">Terms of Service</h3>
                <p className="text-sm text-gray-600 mt-1">Platform terms and user obligations</p>
              </Link>
              <Link href="/legal/privacy" className="block p-4 rounded-lg border bg-white hover:border-blue-300 transition-colors">
                <h3 className="font-semibold text-gray-900">Privacy Policy</h3>
                <p className="text-sm text-gray-600 mt-1">How we collect and use data</p>
              </Link>
              <Link href="/legal/acceptable-use" className="block p-4 rounded-lg border bg-white hover:border-blue-300 transition-colors">
                <h3 className="font-semibold text-gray-900">Acceptable Use Policy</h3>
                <p className="text-sm text-gray-600 mt-1">Messaging and content guidelines</p>
              </Link>
              <Link href="/legal/sms-terms" className="block p-4 rounded-lg border bg-white hover:border-blue-300 transition-colors">
                <h3 className="font-semibold text-gray-900">SMS Terms</h3>
                <p className="text-sm text-gray-600 mt-1">Program-specific messaging terms</p>
              </Link>
              <Link href="/legal/refunds" className="block p-4 rounded-lg border bg-white hover:border-blue-300 transition-colors">
                <h3 className="font-semibold text-gray-900">Refund Policy</h3>
                <p className="text-sm text-gray-600 mt-1">Billing and refund terms</p>
              </Link>
              <Link href="/legal/cookies" className="block p-4 rounded-lg border bg-white hover:border-blue-300 transition-colors">
                <h3 className="font-semibold text-gray-900">Cookie Policy</h3>
                <p className="text-sm text-gray-600 mt-1">Website cookie usage</p>
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}