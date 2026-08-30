import type { Metadata } from "next";
import { AcceptForm } from "./AcceptForm";
import { getLegalDoc } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Review & Accept",
  robots: { index: false },
};

// Re-accept interstitial. The middleware redirects here any authenticated user
// who has not accepted the current ToS + Privacy versions (initial signup gap
// or a version bump). Server-renders the current versions so the form records
// exactly what's shown.
export default function LegalAcceptPage() {
  const terms = getLegalDoc("terms");
  const privacy = getLegalDoc("privacy");

  return (
    <div className="py-20">
      <div className="mx-auto max-w-lg px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">Please review our updated policies</h1>
        <p className="text-gray-600 mb-8">
          To continue, please review and accept the current Terms of Service and Privacy Policy.
        </p>
        <AcceptForm
          termsVersion={terms?.version ?? "1.0.0"}
          privacyVersion={privacy?.version ?? "1.0.0"}
        />
      </div>
    </div>
  );
}
