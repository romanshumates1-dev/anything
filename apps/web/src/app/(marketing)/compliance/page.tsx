import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Compliance",
  description:
    "DealFlow AI compliance: 10DLC, A2P messaging, opt-out handling, throughput management, SOC 2, and data encryption.",
};

export default function CompliancePage() {
  return (
    <div className="py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-bold text-gray-900">Compliance built in</h1>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto">
            Real estate outreach is heavily regulated. We handle the compliance heavy lifting so you can focus on deals.
          </p>
        </div>
        <div className="grid md:grid-cols-2 gap-8">
          {[
            { title: "10DLC & A2P", body: "We maintain carrier-grade 10DLC registrations, campaign onboarding, and A2P branding to keep your messages deliverable." },
            { title: "Opt-Out Handling", body: "Every outbound message includes a compliant opt-out path. STOP/START keywords are handled automatically per carrier rules." },
            { title: "Throughput Management", body: "Daily and per-second throughput caps respect your 10DLC assigned MPS and T-Mobile daily caps to avoid penalties." },
            { title: "SOC 2", body: "Security controls, audit logging, and role-based access are designed around SOC 2 principles." },
            { title: "Data Encryption", body: "Data is encrypted in transit (TLS) and at rest. Access is logged and auditable." },
            { title: "Audit Trail", body: "Every AI action, approval, and message event is logged with user, timestamp, and outcome for compliance review." },
          ].map((item) => (
            <div key={item.title} className="rounded-xl border bg-white p-6 shadow-sm">
              <h3 className="font-semibold text-gray-900 mb-2">{item.title}</h3>
              <p className="text-sm text-gray-600">{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}