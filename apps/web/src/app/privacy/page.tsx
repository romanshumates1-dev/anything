'use client';

import Link from 'next/link';

export default function PrivacyPolicy() {
  const lastUpdated = 'August 5, 2026';

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-violet-600 to-indigo-700 rounded-xl flex items-center justify-center shadow-lg">
                <span className="text-white font-bold text-lg">D</span>
              </div>
              <span className="font-semibold text-slate-900">DealSwift Automation</span>
            </Link>
            <Link href="/terms" className="text-sm text-slate-600 hover:text-violet-600 transition-colors">
              Terms of Service
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-white to-slate-50 py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">Privacy Policy</h1>
          <p className="text-slate-600">Last updated: {lastUpdated}</p>
        </div>
      </section>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12 space-y-10">

          {/* Introduction */}
          <section>
            <p className="text-slate-700 leading-relaxed">
              DealSwift Automation LLC (&quot;DealSwift,&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) respects your privacy and is committed to protecting the personal information you share with us. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our real estate investment automation platform and related services.
            </p>
          </section>

          {/* Quick Summary */}
          <section className="bg-violet-50 rounded-xl p-6 border border-violet-100">
            <h2 className="text-lg font-semibold text-violet-900 mb-3">Quick Summary</h2>
            <ul className="space-y-2 text-sm text-violet-800">
              <li className="flex items-start gap-2">
                <span className="text-violet-500 mt-1">&#10003;</span>
                <span>We collect information you provide and data about how you use our services</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-500 mt-1">&#10003;</span>
                <span>We use your data to provide, improve, and personalize our services</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-500 mt-1">&#10003;</span>
                <span>We do not sell your personal information to third parties</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-500 mt-1">&#10003;</span>
                <span>You can access, update, or delete your data at any time</span>
              </li>
            </ul>
          </section>

          {/* Section 1 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              1. Information We Collect
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Information You Provide</h3>
            <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4">
              <li><strong>Account Information:</strong> Name, email address, phone number, company name, and password when you create an account</li>
              <li><strong>Profile Information:</strong> Business details, investment preferences, and target markets</li>
              <li><strong>Payment Information:</strong> Billing address and payment method details (processed securely by our payment processors)</li>
              <li><strong>Communications:</strong> Messages you send through our platform, support requests, and feedback</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Information Collected Automatically</h3>
            <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4">
              <li><strong>Usage Data:</strong> Pages visited, features used, time spent, and interactions with our platform</li>
              <li><strong>Device Information:</strong> Browser type, operating system, device identifiers, and IP address</li>
              <li><strong>Cookies:</strong> Session cookies and persistent cookies to maintain your preferences and analyze usage</li>
            </ul>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Third-Party Data</h3>
            <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4">
              <li><strong>Property Data:</strong> Publicly available property records, tax information, and ownership data from authorized sources</li>
              <li><strong>Contact Data:</strong> Business contact information from public records and data providers for outreach purposes</li>
            </ul>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              2. How We Use Your Information
            </h2>
            <p className="text-slate-700 mb-4">We use the information we collect to:</p>
            <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4">
              <li>Provide, maintain, and improve our services</li>
              <li>Process transactions and send related information</li>
              <li>Send you technical notices, updates, security alerts, and support messages</li>
              <li>Respond to your comments, questions, and customer service requests</li>
              <li>Personalize and improve your experience</li>
              <li>Monitor and analyze trends, usage, and activities</li>
              <li>Detect, investigate, and prevent fraudulent transactions and other illegal activities</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              3. Information Sharing
            </h2>
            <p className="text-slate-700 mb-4">We may share your information in the following circumstances:</p>

            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">Service Providers</h4>
                <p className="text-sm text-slate-600">Third-party vendors who perform services on our behalf, such as payment processing, data analysis, email delivery, hosting, and customer service.</p>
              </div>

              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">Business Transfers</h4>
                <p className="text-sm text-slate-600">In connection with any merger, sale of company assets, financing, or acquisition of all or a portion of our business.</p>
              </div>

              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">Legal Requirements</h4>
                <p className="text-sm text-slate-600">When required by law or to respond to legal process, protect our rights, or ensure the safety of our users.</p>
              </div>

              <div className="bg-slate-50 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">With Your Consent</h4>
                <p className="text-sm text-slate-600">We may share information with third parties when you give us explicit consent to do so.</p>
              </div>
            </div>

            <p className="text-slate-700 mt-4 font-medium">
              We do not sell, rent, or trade your personal information to third parties for their marketing purposes.
            </p>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              4. Data Security
            </h2>
            <p className="text-slate-700 mb-4">
              We implement industry-standard security measures to protect your personal information:
            </p>
            <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4">
              <li>Encryption of data in transit (TLS/SSL) and at rest (AES-256)</li>
              <li>Regular security assessments and penetration testing</li>
              <li>Access controls and authentication requirements</li>
              <li>Employee training on data protection practices</li>
              <li>Incident response procedures</li>
            </ul>
            <p className="text-slate-600 mt-4 text-sm">
              While we strive to protect your information, no method of transmission over the Internet or electronic storage is 100% secure. We cannot guarantee absolute security.
            </p>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              5. Your Rights and Choices
            </h2>
            <p className="text-slate-700 mb-4">You have the following rights regarding your personal information:</p>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">Access</h4>
                <p className="text-sm text-slate-600">Request a copy of the personal information we hold about you.</p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">Correction</h4>
                <p className="text-sm text-slate-600">Update or correct inaccurate or incomplete information.</p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">Deletion</h4>
                <p className="text-sm text-slate-600">Request deletion of your personal information, subject to legal obligations.</p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">Portability</h4>
                <p className="text-sm text-slate-600">Receive your data in a structured, machine-readable format.</p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">Opt-Out</h4>
                <p className="text-sm text-slate-600">Unsubscribe from marketing communications at any time.</p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">Restrict Processing</h4>
                <p className="text-sm text-slate-600">Limit how we use your data in certain circumstances.</p>
              </div>
            </div>

            <p className="text-slate-700 mt-4">
              To exercise these rights, contact us at <a href="mailto:privacy@dealswiftautomation.com" className="text-violet-600 hover:underline">privacy@dealswiftautomation.com</a>.
            </p>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              6. Cookies and Tracking
            </h2>
            <p className="text-slate-700 mb-4">
              We use cookies and similar technologies to enhance your experience:
            </p>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-2 font-medium text-slate-900">Type</th>
                  <th className="text-left py-2 font-medium text-slate-900">Purpose</th>
                </tr>
              </thead>
              <tbody className="text-slate-600">
                <tr className="border-b border-slate-100">
                  <td className="py-2">Essential</td>
                  <td className="py-2">Required for basic site functionality and security</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-2">Functional</td>
                  <td className="py-2">Remember your preferences and settings</td>
                </tr>
                <tr className="border-b border-slate-100">
                  <td className="py-2">Analytics</td>
                  <td className="py-2">Understand how visitors use our site</td>
                </tr>
              </tbody>
            </table>
            <p className="text-slate-600 mt-4 text-sm">
              You can control cookies through your browser settings. Disabling certain cookies may affect site functionality.
            </p>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              7. Data Retention
            </h2>
            <p className="text-slate-700">
              We retain your personal information for as long as necessary to provide our services and fulfill the purposes described in this policy. When you close your account, we will delete or anonymize your information within 90 days, unless retention is required for legal compliance, dispute resolution, or fraud prevention.
            </p>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              8. Children&apos;s Privacy
            </h2>
            <p className="text-slate-700">
              Our services are not directed to individuals under 18 years of age. We do not knowingly collect personal information from children. If we become aware that we have collected personal information from a child, we will take steps to delete that information promptly.
            </p>
          </section>

          {/* Section 9 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              9. International Data Transfers
            </h2>
            <p className="text-slate-700">
              Your information may be transferred to and processed in countries other than your country of residence. These countries may have different data protection laws. We implement appropriate safeguards to protect your information during international transfers, including standard contractual clauses approved by relevant authorities.
            </p>
          </section>

          {/* Section 10 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              10. California Privacy Rights (CCPA)
            </h2>
            <p className="text-slate-700 mb-4">
              California residents have additional rights under the California Consumer Privacy Act (CCPA):
            </p>
            <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4">
              <li>Right to know what personal information is collected, used, shared, or sold</li>
              <li>Right to delete personal information held by businesses</li>
              <li>Right to opt-out of the sale of personal information</li>
              <li>Right to non-discrimination for exercising CCPA rights</li>
            </ul>
            <p className="text-slate-700 mt-4">
              We do not sell personal information as defined by the CCPA.
            </p>
          </section>

          {/* Section 11 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              11. Changes to This Policy
            </h2>
            <p className="text-slate-700">
              We may update this Privacy Policy from time to time. We will notify you of material changes by posting the new policy on this page and updating the &quot;Last updated&quot; date. We encourage you to review this policy periodically. Your continued use of our services after changes constitutes acceptance of the updated policy.
            </p>
          </section>

          {/* Section 12 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              12. Contact Us
            </h2>
            <p className="text-slate-700 mb-4">
              If you have questions about this Privacy Policy or our data practices, please contact us:
            </p>
            <div className="bg-slate-50 rounded-xl p-6">
              <p className="font-medium text-slate-900 mb-2">DealSwift Automation LLC</p>
              <div className="text-slate-600 space-y-1">
                <p>Email: <a href="mailto:privacy@dealswiftautomation.com" className="text-violet-600 hover:underline">privacy@dealswiftautomation.com</a></p>
                <p>Support: <a href="mailto:support@dealswiftautomation.com" className="text-violet-600 hover:underline">support@dealswiftautomation.com</a></p>
                <p>Website: <a href="https://dealswiftautomation.com" className="text-violet-600 hover:underline">dealswiftautomation.com</a></p>
              </div>
            </div>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-slate-200 py-8 mt-12">
        <div className="max-w-4xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-slate-500">
              &copy; {new Date().getFullYear()} DealSwift Automation LLC. All rights reserved.
            </p>
            <div className="flex items-center gap-6">
              <Link href="/privacy" className="text-sm text-violet-600 font-medium">Privacy Policy</Link>
              <Link href="/terms" className="text-sm text-slate-500 hover:text-slate-700">Terms of Service</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
