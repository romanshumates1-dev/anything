import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Privacy Policy</h1>
      <p className="text-sm text-gray-500 mb-8">
        Last updated: [FOR ATTORNEY REVIEW &mdash; INSERT DATE]
      </p>
      <section className="space-y-6 text-gray-700 leading-relaxed">
        <p>[FOR ATTORNEY REVIEW] This Privacy Policy describes how DealFlow AI (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;) collects, uses, and discloses your information when you use our platform, website, and related services (collectively, the &quot;Service&quot;).</p>
        <h2 className="text-xl font-semibold text-gray-900 pt-4">1. Information We Collect</h2>
        <p>[FOR ATTORNEY REVIEW &mdash; Drafting block. The following categories are typical for a B2B SaaS platform handling real estate lead data: account registration information, communication content (SMS, email), property/lead data uploaded or imported via CRM integration, usage analytics, and payment/billing information.]</p>
        <h2 className="text-xl font-semibold text-gray-900 pt-4">2. How We Use Your Information</h2>
        <p>[FOR ATTORNEY REVIEW &mdash; Drafting block. Typical uses include: providing and maintaining the Service, AI-based lead engagement and negotiation, compliance with A2P 10DLC regulations, opt-out and consent management, platform improvement, and legal obligations.]</p>
        <h2 className="text-xl font-semibold text-gray-900 pt-4">3. Data Sharing and Disclosure</h2>
        <p>[FOR ATTORNEY REVIEW &mdash; Drafting block. We may share data with: service providers and sub-processors (cloud infrastructure, AI model providers, Twilio for SMS), law enforcement when required by law, and business transferees in the event of a merger or acquisition. We do not sell personal information.]</p>
        <h2 className="text-xl font-semibold text-gray-900 pt-4">4. Data Retention and Security</h2>
        <p>[FOR ATTORNEY REVIEW &mdash; Drafting block. Describe retention periods for lead/conversation data, account data, and analytics. Describe technical and organizational security measures (encryption at rest and in transit, access controls, SOC 2 compliance, etc.).]</p>
        <h2 className="text-xl font-semibold text-gray-900 pt-4">5. Your Rights and Choices</h2>
        <p>[FOR ATTORNEY REVIEW &mdash; Drafting block. Depending on jurisdiction (CCPA, GDPR, etc.), users may have rights to access, correct, delete, or port their data, as well as opt out of certain processing activities.]</p>
        <h2 className="text-xl font-semibold text-gray-900 pt-4">6. SMS / Messaging Compliance</h2>
        <p>[FOR ATTORNEY REVIEW &mdash; Drafting block. Describe consent collection for SMS, opt-out mechanisms (STOP/HELP), message frequency, and carrier/aggregator disclosures as required by A2P 10DLC.]</p>
        <h2 className="text-xl font-semibold text-gray-900 pt-4">7. Changes to This Policy</h2>
        <p>[FOR ATTORNEY REVIEW &mdash; Drafting block. We will notify users of material changes via email or in-app notice and update the &quot;Last updated&quot; date.]</p>
        <h2 className="text-xl font-semibold text-gray-900 pt-4">8. Contact Us</h2>
        <p>[FOR ATTORNEY REVIEW &mdash; Insert contact email and mailing address for privacy inquiries.]</p>
        <p className="pt-6 text-sm text-gray-500 italic">[FOR ATTORNEY REVIEW] This document is a draft prepared for legal review. It does not constitute legal advice. The final Privacy Policy should be reviewed and approved by qualified legal counsel before being made publicly available.</p>
      </section>
    </div>
  );
}
