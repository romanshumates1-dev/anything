interface LegalDocRendererProps {
  docType: string;
  title: string;
}

export function LegalDocRenderer({ docType, title }: LegalDocRendererProps) {
  const content = getLegalContent(docType);

  return (
    <div className="py-20">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">{title}</h1>
          <p className="text-sm text-amber-700 font-medium">[FOR ATTORNEY REVIEW]</p>
        </div>
        <div className="prose prose-gray max-w-none">
          {content.sections.map((section, i) => (
            <section key={i} className="mb-8">
              <h2 className="text-xl font-bold text-gray-900">{section.heading}</h2>
              {section.content.split('\n\n').map((para, j) => (
                <p key={j} className="text-gray-600 mt-3">{para}</p>
              ))}
            </section>
          ))}
          <div className="mt-12 pt-6 border-t text-xs text-gray-500">
            Version: {content.version} | Effective: {content.effectiveDate}
          </div>
        </div>
      </div>
    </div>
  );
}

function getLegalContent(docType: string) {
  const docs: Record<string, { version: string; effectiveDate: string; sections: { heading: string; content: string }[] }> = {
    acceptable_use: {
      version: "1.0",
      effectiveDate: "2025-01-01",
      sections: [
        {
          heading: "1. Purpose",
          content: "This Acceptable Use Policy governs your use of DealFlow AI's messaging services. You agree to comply with all applicable laws including the TCPA, CTIA Guidelines, and state regulations.\n\nBy using our platform, you represent that you have obtained prior express written consent from all recipients before sending SMS messages."
        },
        {
          heading: "2. Prohibited Content (SHAFT)",
          content: "Messages must not include content related to:\n\n• Sexually explicit material\n• Hate speech or discriminatory content\n• Alcohol, firearms, or tobacco\n• Financial products or services\n• Illegal or controlled substances\n\nViolations may result in immediate account suspension."
        },
        {
          heading: "3. Consent Requirements",
          content: "You must have documented proof of prior express written consent for each recipient. Consent must include:\n\n• Clear disclosure of message frequency\n• Purpose of the messages\n• Opt-out instructions\n• Your business identity"
        },
        {
          heading: "4. STOP/HELP Compliance",
          content: "STOP and HELP keywords must be honored immediately:\n\n• STOP adds recipients to the global suppression list\n• HELP must return program information\n• Opt-out confirmations must be sent within minutes\n• Do not re-subscribe suppressed numbers without explicit re-consent"
        },
        {
          heading: "5. Quiet Hours",
          content: "Messages may only be sent during permitted hours:\n\n• 8:00 AM to 9:00 PM in the recipient's local timezone\n• Respects DST automatically\n• Messages outside these hours are deferred automatically"
        },
        {
          heading: "6. Violations and Suspension",
          content: "We reserve the right to suspend accounts that:\n\n• Send messages to contacts without consent\n• Violate quiet hours or opt-out requests\n• Include prohibited content\n• Generate excessive complaints or opt-outs\n\nRepeated violations may result in permanent account termination."
        },
      ]
    },
    sms_terms: {
      version: "1.0",
      effectiveDate: "2025-01-01",
      sections: [
        {
          heading: "SMS Program Terms",
          content: "By opting into our SMS service, you agree to these terms:"
        },
        {
          heading: "Message Frequency",
          content: "You may receive up to 10 messages per month. We do not send more than necessary to communicate effectively."
        },
        {
          heading: "Msg & Data Rates",
          content: "Standard message and data rates apply. Check with your carrier for details."
        },
        {
          heading: "HELP Instructions",
          content: "Reply HELP for help. We will respond with program information, including how to opt out and contact support."
        },
        {
          heading: "STOP Instructions",
          content: "Reply STOP to unsubscribe. After sending STOP, you will receive a confirmation that you have been unsubscribed."
        },
        {
          heading: "Carrier Disclaimer",
          content: "Carriers are not responsible for delayed or undelivered messages. We are not liable for any failures in the delivery of messages."
        },
      ]
    },
    refunds: {
      version: "1.0",
      effectiveDate: "2025-01-01",
      sections: [
        {
          heading: "Refund Policy",
          content: "DealFlow AI offers flexible month-to-month pricing with a 30-day money-back guarantee."
        },
        {
          heading: "30-Day Money-Back Guarantee",
          content: "If you're not satisfied within 30 days of your initial subscription, contact us for a full refund. No questions asked."
        },
        {
          heading: "Refund Process",
          content: "Refunds are processed through our support team. Provide your account email and reason for refund. Refunds typically process within 5-7 business days."
        },
        {
          heading: "Partial Period Refunds",
          content: "For mid-cycle cancellations, refunds are prorated based on unused service time, minus any one-time fees or setup costs."
        },
        {
          heading: "Chargebacks",
          content: "If you dispute a charge with your bank, we reserve the right to suspend your account until the dispute is resolved. Chargebacks may affect future service eligibility."
        },
      ]
    },
    cookies: {
      version: "1.0",
      effectiveDate: "2025-01-01",
      sections: [
        {
          heading: "Cookie Policy",
          content: "DealFlow AI uses cookies and similar technologies to enhance your experience."
        },
        {
          heading: "What We Collect",
          content: "• Essential cookies: Authentication and session management (required)\n• Analytics cookies: Usage statistics (optional)\n• Preference cookies: Your settings (optional)"
        },
        {
          heading: "Your Choices",
          content: "You may disable non-essential cookies in your browser settings. Essential cookies cannot be disabled as they are required for the service to function."
        },
        {
          heading: "Third-Party Services",
          content: "We may use third-party services that set their own cookies: Google Analytics, Stripe, Twilio. Each has their own privacy and cookie policies."
        },
      ]
    },
    disclaimers: {
      version: "1.0",
      effectiveDate: "2025-01-01",
      sections: [
        {
          heading: "Disclaimers",
          content: "DealFlow AI provides software tools only. We do not provide legal, financial, or real estate advice."
        },
        {
          heading: "Results Not Typical",
          content: "Success in real estate wholesaling depends on many factors including market conditions, skill, and effort. Past performance does not guarantee future results."
        },
        {
          heading: "No Guarantee",
          content: "We make no guarantees about deal closure rates, profits, or earnings. Investing in real estate involves risk."
        },
        {
          heading: "Not a Brokerage",
          content: "DealFlow AI is not a real estate brokerage. We do not buy, sell, or represent properties."
        },
        {
          heading: "Legal Compliance",
          content: "You are solely responsible for complying with all federal, state, and local laws in your jurisdiction when using our service."
        },
      ]
    },
    esign: {
      version: "1.0",
      effectiveDate: "2025-01-01",
      sections: [
        {
          heading: "E-SIGN Disclosure",
          content: "You agree that electronic signatures and records have the same legal effect as paper documents."
        },
        {
          heading: "Before You Sign",
          content: "Before signing electronically, you must affirmatively consent to receive and sign documents electronically. This consent applies to all contracts generated through our platform."
        },
        {
          heading: "Hardware and Software Requirements",
          content: "To sign electronically, you need:\n\n• A device capable of accessing the internet\n• A current web browser\n• A valid email address\n• The ability to view and download PDF documents"
        },
        {
          heading: "Withdrawing Consent",
          content: "You may withdraw your consent to electronic records by contacting support. However, this does not invalidate contracts you have already signed electronically."
        },
        {
          heading: "Keeping Copies",
          content: "We recommend downloading and saving copies of all signed documents. Copies are available in your account for as long as your account is active."
        },
      ]
    },
    dmca: {
      version: "1.0",
      effectiveDate: "2025-01-01",
      sections: [
        {
          heading: "DMCA Agent Information",
          content: "For DMCA takedown notices, contact our agent:"
        },
        {
          heading: "Designated Agent",
          content: "[AGENT NAME]\n[COMPANY NAME]\n[ADDRESS]\n[EMAIL]\n[PHONE]"
        },
        {
          heading: "Notification Process",
          content: "To file a DMCA complaint, send a written notice including:\n\n• Identification of copyrighted work\n• Identification of infringing material\n• Your contact information\n• Statement of good faith belief\n• Statement of accuracy under penalty of perjury\n• Your signature"
        },
      ]
    },
  };

  return docs[docType] || {
    version: "1.0",
    effectiveDate: "2025-01-01",
    sections: [{ heading: "Document Not Found", content: "The requested legal document is not available." }]
  };
}