'use client';

import Link from 'next/link';

export default function TermsOfService() {
  const lastUpdated = 'August 5, 2026';
  const effectiveDate = 'August 5, 2026';

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
            <Link href="/privacy" className="text-sm text-slate-600 hover:text-violet-600 transition-colors">
              Privacy Policy
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="bg-gradient-to-b from-white to-slate-50 py-16">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">Terms of Service</h1>
          <p className="text-slate-600">Last updated: {lastUpdated}</p>
        </div>
      </section>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12 space-y-10">

          {/* Introduction */}
          <section>
            <p className="text-slate-700 leading-relaxed">
              Welcome to DealSwift Automation. These Terms of Service (&quot;Terms&quot;) govern your access to and use of the DealSwift Automation platform, including our website, applications, APIs, and related services (collectively, the &quot;Services&quot;). By accessing or using our Services, you agree to be bound by these Terms.
            </p>
            <p className="text-slate-700 leading-relaxed mt-4">
              Please read these Terms carefully. If you do not agree to these Terms, you may not access or use our Services.
            </p>
          </section>

          {/* Quick Summary */}
          <section className="bg-amber-50 rounded-xl p-6 border border-amber-100">
            <h2 className="text-lg font-semibold text-amber-900 mb-3">Key Points</h2>
            <ul className="space-y-2 text-sm text-amber-800">
              <li className="flex items-start gap-2">
                <span className="text-amber-600 mt-1">&#9679;</span>
                <span>You must be 18+ and have authority to bind your organization</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-600 mt-1">&#9679;</span>
                <span>You are responsible for compliance with applicable laws in your use of our Services</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-600 mt-1">&#9679;</span>
                <span>We provide tools; you are responsible for how you use them</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-600 mt-1">&#9679;</span>
                <span>Disputes are resolved through arbitration in Kentucky</span>
              </li>
            </ul>
          </section>

          {/* Section 1 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              1. Acceptance of Terms
            </h2>
            <p className="text-slate-700 mb-4">
              By creating an account, accessing, or using our Services, you acknowledge that you have read, understood, and agree to be bound by these Terms and our <Link href="/privacy" className="text-violet-600 hover:underline">Privacy Policy</Link>.
            </p>
            <p className="text-slate-700">
              If you are using the Services on behalf of a company, organization, or other entity, you represent and warrant that you have the authority to bind that entity to these Terms, and &quot;you&quot; refers to both you individually and that entity.
            </p>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              2. Eligibility
            </h2>
            <p className="text-slate-700 mb-4">To use our Services, you must:</p>
            <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4">
              <li>Be at least 18 years of age</li>
              <li>Have the legal capacity to enter into a binding agreement</li>
              <li>Not be prohibited from using the Services under applicable law</li>
              <li>Provide accurate and complete registration information</li>
            </ul>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              3. Description of Services
            </h2>
            <p className="text-slate-700 mb-4">
              DealSwift Automation provides a real estate investment automation platform that includes:
            </p>
            <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4">
              <li>Lead generation and management tools</li>
              <li>Automated outreach and communication features</li>
              <li>Campaign management and analytics</li>
              <li>Pipeline tracking and deal management</li>
              <li>Integration with third-party services</li>
            </ul>
            <p className="text-slate-700 mt-4">
              We reserve the right to modify, suspend, or discontinue any aspect of the Services at any time, with or without notice.
            </p>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              4. Account Registration and Security
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Account Creation</h3>
            <p className="text-slate-700">
              To access certain features, you must create an account. You agree to provide accurate, current, and complete information during registration and to update such information as necessary.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Account Security</h3>
            <p className="text-slate-700">
              You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You must immediately notify us of any unauthorized use of your account or any other breach of security.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Account Termination</h3>
            <p className="text-slate-700">
              We reserve the right to suspend or terminate your account at any time for violations of these Terms or for any other reason at our sole discretion.
            </p>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              5. Acceptable Use
            </h2>
            <p className="text-slate-700 mb-4">You agree to use the Services only for lawful purposes and in accordance with these Terms. You agree NOT to:</p>

            <div className="space-y-3">
              <div className="bg-rose-50 rounded-lg p-4 border border-rose-100">
                <h4 className="font-medium text-rose-900 mb-2">Illegal Activities</h4>
                <p className="text-sm text-rose-700">Use the Services for any purpose that violates local, state, national, or international law, including but not limited to laws governing telemarketing, spam, and data protection.</p>
              </div>

              <div className="bg-rose-50 rounded-lg p-4 border border-rose-100">
                <h4 className="font-medium text-rose-900 mb-2">Harassment</h4>
                <p className="text-sm text-rose-700">Harass, abuse, threaten, or intimidate any individual or entity through the Services.</p>
              </div>

              <div className="bg-rose-50 rounded-lg p-4 border border-rose-100">
                <h4 className="font-medium text-rose-900 mb-2">Misrepresentation</h4>
                <p className="text-sm text-rose-700">Impersonate any person or entity, or falsely state or misrepresent your affiliation with any person or entity.</p>
              </div>

              <div className="bg-rose-50 rounded-lg p-4 border border-rose-100">
                <h4 className="font-medium text-rose-900 mb-2">System Abuse</h4>
                <p className="text-sm text-rose-700">Attempt to gain unauthorized access to our systems, interfere with or disrupt the Services, or transmit viruses or malicious code.</p>
              </div>

              <div className="bg-rose-50 rounded-lg p-4 border border-rose-100">
                <h4 className="font-medium text-rose-900 mb-2">Scraping and Automation Abuse</h4>
                <p className="text-sm text-rose-700">Use automated means to access the Services in a manner that exceeds reasonable use or circumvents rate limits without authorization.</p>
              </div>
            </div>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              6. Communication Compliance
            </h2>
            <p className="text-slate-700 mb-4">
              When using our automated communication features, you are solely responsible for ensuring compliance with all applicable laws and regulations, including but not limited to:
            </p>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">TCPA</h4>
                <p className="text-sm text-slate-600">Telephone Consumer Protection Act requirements for calls and text messages</p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">CAN-SPAM</h4>
                <p className="text-sm text-slate-600">Requirements for commercial email messages</p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">DNC Registry</h4>
                <p className="text-sm text-slate-600">Do Not Call Registry compliance obligations</p>
              </div>
              <div className="border border-slate-200 rounded-lg p-4">
                <h4 className="font-medium text-slate-900 mb-2">State Laws</h4>
                <p className="text-sm text-slate-600">State-specific telemarketing and consumer protection laws</p>
              </div>
            </div>

            <p className="text-slate-700 mt-4">
              You represent and warrant that you have obtained all necessary consents and permissions before using the Services to contact any individual, and that your communications comply with all applicable laws.
            </p>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              7. Fees and Payment
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Subscription Fees</h3>
            <p className="text-slate-700">
              Certain features of the Services require payment of fees. You agree to pay all applicable fees as described on our pricing page. Fees are non-refundable except as expressly stated in these Terms.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Usage-Based Charges</h3>
            <p className="text-slate-700">
              Some Services may incur usage-based charges (e.g., per message sent, per lead processed). These charges will be clearly disclosed and billed according to your selected plan.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Price Changes</h3>
            <p className="text-slate-700">
              We may change our fees at any time. Price changes will take effect at the start of your next billing cycle, and we will provide at least 30 days&apos; notice of any price increase.
            </p>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              8. Intellectual Property
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Our Intellectual Property</h3>
            <p className="text-slate-700">
              The Services, including all content, features, and functionality, are owned by DealSwift Automation and are protected by copyright, trademark, and other intellectual property laws. You may not copy, modify, distribute, sell, or lease any part of our Services without our prior written consent.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Your Content</h3>
            <p className="text-slate-700">
              You retain ownership of any content you submit through the Services. By submitting content, you grant us a non-exclusive, worldwide, royalty-free license to use, store, and process that content solely for the purpose of providing the Services to you.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Feedback</h3>
            <p className="text-slate-700">
              If you provide feedback, suggestions, or ideas about the Services, we may use them without any obligation to compensate you.
            </p>
          </section>

          {/* Section 9 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              9. Third-Party Services
            </h2>
            <p className="text-slate-700">
              The Services may integrate with or contain links to third-party websites, services, or content. We do not control and are not responsible for third-party services. Your use of third-party services is subject to their respective terms and policies. We encourage you to read the terms and privacy policies of any third-party services you access through our platform.
            </p>
          </section>

          {/* Section 10 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              10. Disclaimers
            </h2>
            <div className="bg-slate-100 rounded-xl p-6 text-sm text-slate-700 space-y-4">
              <p>
                <strong>THE SERVICES ARE PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED.</strong>
              </p>
              <p>
                We disclaim all warranties, including but not limited to implied warranties of merchantability, fitness for a particular purpose, title, and non-infringement.
              </p>
              <p>
                We do not warrant that the Services will be uninterrupted, error-free, secure, or free of viruses or other harmful components.
              </p>
              <p>
                We do not guarantee any specific results from use of the Services. Real estate investing involves risk, and past performance is not indicative of future results.
              </p>
            </div>
          </section>

          {/* Section 11 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              11. Limitation of Liability
            </h2>
            <div className="bg-slate-100 rounded-xl p-6 text-sm text-slate-700 space-y-4">
              <p>
                <strong>TO THE MAXIMUM EXTENT PERMITTED BY LAW, DEALSWIFT AUTOMATION SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO LOSS OF PROFITS, DATA, OR GOODWILL.</strong>
              </p>
              <p>
                Our total liability for any claims arising from or related to these Terms or the Services shall not exceed the greater of (a) the amount you paid us in the 12 months preceding the claim, or (b) $100.
              </p>
              <p>
                These limitations apply regardless of the legal theory on which the claim is based and even if we have been advised of the possibility of such damages.
              </p>
            </div>
          </section>

          {/* Section 12 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              12. Indemnification
            </h2>
            <p className="text-slate-700">
              You agree to indemnify, defend, and hold harmless DealSwift Automation and its officers, directors, employees, agents, and affiliates from and against any and all claims, damages, losses, liabilities, costs, and expenses (including reasonable attorneys&apos; fees) arising from or related to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-slate-700 ml-4 mt-4">
              <li>Your use of the Services</li>
              <li>Your violation of these Terms</li>
              <li>Your violation of any applicable law or regulation</li>
              <li>Your violation of any third-party rights</li>
              <li>Any content you submit through the Services</li>
            </ul>
          </section>

          {/* Section 13 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              13. Dispute Resolution
            </h2>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Informal Resolution</h3>
            <p className="text-slate-700">
              Before filing any claim, you agree to attempt to resolve the dispute informally by contacting us at <a href="mailto:legal@dealswiftautomation.com" className="text-violet-600 hover:underline">legal@dealswiftautomation.com</a>. We will attempt to resolve the dispute within 60 days.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Binding Arbitration</h3>
            <p className="text-slate-700">
              Any dispute not resolved informally shall be resolved by binding arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules. The arbitration shall be conducted in Louisville, Kentucky.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Class Action Waiver</h3>
            <p className="text-slate-700">
              You agree to resolve disputes with us on an individual basis and waive any right to participate in a class action lawsuit or class-wide arbitration.
            </p>

            <h3 className="text-lg font-medium text-slate-800 mt-6 mb-3">Exceptions</h3>
            <p className="text-slate-700">
              Either party may seek injunctive relief in any court of competent jurisdiction to protect intellectual property rights.
            </p>
          </section>

          {/* Section 14 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              14. Governing Law
            </h2>
            <p className="text-slate-700">
              These Terms shall be governed by and construed in accordance with the laws of the Commonwealth of Kentucky, without regard to its conflict of law principles. Any legal action or proceeding not subject to arbitration shall be brought exclusively in the state or federal courts located in Jefferson County, Kentucky.
            </p>
          </section>

          {/* Section 15 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              15. Changes to Terms
            </h2>
            <p className="text-slate-700">
              We may modify these Terms at any time. We will notify you of material changes by posting the updated Terms on our website and updating the &quot;Last updated&quot; date. Your continued use of the Services after changes become effective constitutes your acceptance of the revised Terms. If you do not agree to the changes, you must stop using the Services.
            </p>
          </section>

          {/* Section 16 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              16. General Provisions
            </h2>

            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-slate-900 mb-1">Entire Agreement</h4>
                <p className="text-sm text-slate-600">These Terms, together with the Privacy Policy, constitute the entire agreement between you and DealSwift Automation regarding the Services.</p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">Severability</h4>
                <p className="text-sm text-slate-600">If any provision of these Terms is found unenforceable, the remaining provisions will continue in effect.</p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">Waiver</h4>
                <p className="text-sm text-slate-600">Our failure to enforce any right or provision of these Terms does not constitute a waiver of that right or provision.</p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">Assignment</h4>
                <p className="text-sm text-slate-600">You may not assign or transfer these Terms without our prior written consent. We may assign our rights and obligations without restriction.</p>
              </div>

              <div>
                <h4 className="font-medium text-slate-900 mb-1">Force Majeure</h4>
                <p className="text-sm text-slate-600">We shall not be liable for any failure or delay in performance due to causes beyond our reasonable control.</p>
              </div>
            </div>
          </section>

          {/* Section 17 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-200">
              17. Contact Information
            </h2>
            <p className="text-slate-700 mb-4">
              If you have any questions about these Terms, please contact us:
            </p>
            <div className="bg-slate-50 rounded-xl p-6">
              <p className="font-medium text-slate-900 mb-2">DealSwift Automation LLC</p>
              <div className="text-slate-600 space-y-1">
                <p>Email: <a href="mailto:legal@dealswiftautomation.com" className="text-violet-600 hover:underline">legal@dealswiftautomation.com</a></p>
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
              <Link href="/privacy" className="text-sm text-slate-500 hover:text-slate-700">Privacy Policy</Link>
              <Link href="/terms" className="text-sm text-violet-600 font-medium">Terms of Service</Link>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
